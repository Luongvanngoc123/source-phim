//! The episode's second upstream server, "HDX", hosted by Abyss.
//!
//! Its page hands the browser an encrypted description of the video files instead of a
//! playlist: one MP4 per resolution, cut into parts, with the first 64 KiB of the first part
//! scrambled. This module turns an episode link into those file URLs and the keys that open
//! them, so the browser can read the video straight from the storage host.

use crate::{parent_host, scraper, url_encode, watch_page_on, DEFAULT_UA};
use aes::cipher::{KeyIvInit, StreamCipher};
use base64::{engine::general_purpose::STANDARD as B64_STD, Engine as _};
use md5::{Digest, Md5};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};

type Aes256Ctr = ctr::Ctr128BE<aes::Aes256>;

/// The bytes at the start of the first part that are scrambled.
const ENCRYPTED_HEAD: u64 = 65536;

/// Host that serves the same embed page as `abyssplayer.com`, which several Vietnamese
/// networks refuse to connect to.
const EMBED_HOST: &str = "player.abyssplayer.com";

#[derive(Debug, PartialEq)]
pub struct ServerButton {
    pub id: String,
    pub play: String,
    pub href: String,
    pub name: String,
}

/// Lowercase hexadecimal MD5 of `input`, the form every Abyss key is written in.
pub fn md5_hex(input: &str) -> String {
    let digest = Md5::digest(input.as_bytes());
    let mut out = String::with_capacity(32);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// The key the player signs its chunk tokens with for a path-addressed file.
///
/// It hashes the size's decimal digits as raw byte values, not their text, which is how the
/// player's own hash coerces the number before signing.
pub fn size_token_key(size: u64) -> String {
    let digits: Vec<u8> = size.to_string().bytes().map(|b| b - b'0').collect();
    let digest = Md5::digest(&digits);
    let mut out = String::with_capacity(32);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// The signed token the storage host wants for one part of a path-addressed file.
///
/// It is the part's path encrypted with AES-CTR under the size key, then written as base64
/// twice with the padding dropped, exactly as the backup server's own player does.
pub fn sora_token(path: &str, part: u64, size: u64) -> String {
    let key = size_token_key(size);
    let mut data = format!("{path}/{part}").into_bytes();
    let mut cipher = Aes256Ctr::new(key.as_bytes().into(), key.as_bytes()[..16].into());
    cipher.apply_keystream(&mut data);
    let inner = B64_STD.encode(&data);
    let inner = inner.trim_end_matches('=');
    B64_STD.encode(inner).trim_end_matches('=').to_string()
}

/// An HTTP client for reading parts, so one request reuses its connection to the host.
static SORA_AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
    ureq::AgentBuilder::new()
        .user_agent(DEFAULT_UA)
        .timeout_connect(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .max_idle_connections(64)
        .max_idle_connections_per_host(16)
        .build()
});

pub fn shared_sora_agent() -> &'static ureq::Agent {
    &SORA_AGENT
}

type Flight = (Mutex<Option<Result<Arc<Vec<u8>>, String>>>, Condvar);

struct CacheEntry {
    bytes: Arc<Vec<u8>>,
    last_used: Instant,
    inserted_at: Instant,
}

struct CacheState {
    entries: HashMap<String, CacheEntry>,
    in_flight: HashMap<String, Arc<Flight>>,
    total_bytes: usize,
}

/// Bounded, expiring cache for HDX parts with single-flight fetch deduplication.
pub struct HdxPartCache {
    state: Mutex<CacheState>,
    max_bytes: usize,
    ttl: Duration,
    active_prefetches: AtomicUsize,
}

impl HdxPartCache {
    pub fn new(max_bytes: usize, ttl: Duration) -> Self {
        Self {
            state: Mutex::new(CacheState {
                entries: HashMap::new(),
                in_flight: HashMap::new(),
                total_bytes: 0,
            }),
            max_bytes,
            ttl,
            active_prefetches: AtomicUsize::new(0),
        }
    }

    fn remove_expired(&self, state: &mut CacheState, now: Instant) {
        let ttl = self.ttl;
        let mut expired = Vec::new();
        for (key, entry) in &state.entries {
            if now.duration_since(entry.inserted_at) >= ttl {
                expired.push(key.clone());
            }
        }
        for key in expired {
            if let Some(entry) = state.entries.remove(&key) {
                state.total_bytes = state.total_bytes.saturating_sub(entry.bytes.len());
            }
        }
    }

    fn cache_insert(&self, state: &mut CacheState, key: String, bytes: Arc<Vec<u8>>, now: Instant) {
        let incoming_len = bytes.len();
        if incoming_len > self.max_bytes {
            return;
        }
        self.remove_expired(state, now);
        if let Some(previous) = state.entries.remove(&key) {
            state.total_bytes = state.total_bytes.saturating_sub(previous.bytes.len());
        }
        while state.total_bytes + incoming_len > self.max_bytes {
            let Some(oldest_key) = state
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            if let Some(oldest) = state.entries.remove(&oldest_key) {
                state.total_bytes = state.total_bytes.saturating_sub(oldest.bytes.len());
            }
        }
        state.total_bytes += incoming_len;
        state.entries.insert(
            key,
            CacheEntry {
                bytes,
                last_used: now,
                inserted_at: now,
            },
        );
    }

    pub fn get_or_fetch_with<F>(&self, key: &str, fetcher: F) -> Result<Arc<Vec<u8>>, String>
    where
        F: FnOnce() -> Result<Vec<u8>, String>,
    {
        let now = Instant::now();
        let (slot, leader) = {
            let mut state = self.state.lock().unwrap();
            self.remove_expired(&mut state, now);
            if let Some(entry) = state.entries.get_mut(key) {
                entry.last_used = now;
                return Ok(Arc::clone(&entry.bytes));
            }
            if let Some(slot) = state.in_flight.get(key) {
                (Arc::clone(slot), false)
            } else {
                let slot = Arc::new((Mutex::new(None), Condvar::new()));
                state.in_flight.insert(key.to_string(), Arc::clone(&slot));
                (slot, true)
            }
        };

        if !leader {
            let (result, condvar) = (&slot.0, &slot.1);
            let mut result = result.lock().unwrap();
            while result.is_none() {
                result = condvar.wait(result).unwrap();
            }
            return result.as_ref().cloned().unwrap();
        }

        let mut cleanup = InFlightGuard {
            cache: self,
            key: key.to_string(),
            slot: Arc::clone(&slot),
            completed: false,
        };
        let result = fetcher().map(Arc::new);
        let mut state = self.state.lock().unwrap();
        state.in_flight.remove(key);
        if let Ok(bytes) = &result {
            self.cache_insert(&mut state, key.to_string(), Arc::clone(bytes), Instant::now());
        }
        {
            let mut slot_result = slot.0.lock().unwrap();
            *slot_result = Some(result.clone());
            slot.1.notify_all();
        }
        cleanup.completed = true;
        result
    }

    pub fn get_or_fetch(
        &self,
        origin: &str,
        path: &str,
        size: u64,
        part: u64,
    ) -> Result<Arc<Vec<u8>>, String> {
        let key = format!("{origin}|{path}|{size}|{part}");
        self.get_or_fetch_with(&key, || {
            fetch_sora_part(shared_sora_agent(), origin, path, size, part)
        })
    }

    pub fn prefetch(self: &Arc<Self>, origin: String, path: String, size: u64, part: u64) {
        let key = format!("{origin}|{path}|{size}|{part}");
        {
            let mut state = self.state.lock().unwrap();
            self.remove_expired(&mut state, Instant::now());
            if state.entries.contains_key(&key) || state.in_flight.contains_key(&key) {
                return;
            }
        }
        loop {
            let active = self.active_prefetches.load(Ordering::Acquire);
            if active >= 4 {
                return;
            }
            if self
                .active_prefetches
                .compare_exchange(active, active + 1, Ordering::AcqRel, Ordering::Relaxed)
                .is_ok()
            {
                break;
            }
        }
        let cache = Arc::clone(self);
        let spawn = thread::Builder::new().spawn(move || {
            struct PrefetchGuard<'a>(&'a AtomicUsize);
            impl Drop for PrefetchGuard<'_> {
                fn drop(&mut self) {
                    self.0.fetch_sub(1, Ordering::AcqRel);
                }
            }
            let _guard = PrefetchGuard(&cache.active_prefetches);
            let _ = cache.get_or_fetch(&origin, &path, size, part);
        });
        if spawn.is_err() {
            self.active_prefetches.fetch_sub(1, Ordering::AcqRel);
        }
    }

    pub fn stats(&self) -> (usize, usize) {
        let mut state = self.state.lock().unwrap();
        self.remove_expired(&mut state, Instant::now());
        (state.entries.len(), state.total_bytes)
    }
}

struct InFlightGuard<'a> {
    cache: &'a HdxPartCache,
    key: String,
    slot: Arc<Flight>,
    completed: bool,
}

impl Drop for InFlightGuard<'_> {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        let error = "UPSTREAM_DOWN: Yêu cầu phần phim HDX bị gián đoạn".to_string();
        let mut result = match self.slot.0.lock() {
            Ok(result) => result,
            Err(poisoned) => poisoned.into_inner(),
        };
        if result.is_none() {
            *result = Some(Err(error));
            self.slot.1.notify_all();
        }
        drop(result);
        let mut state = match self.cache.state.lock() {
            Ok(state) => state,
            Err(poisoned) => poisoned.into_inner(),
        };
        if state
            .in_flight
            .get(&self.key)
            .is_some_and(|slot| Arc::ptr_eq(slot, &self.slot))
        {
            state.in_flight.remove(&self.key);
        }
    }
}

/// Read one part of a path-addressed file from the storage host.
///
/// The host serves `/sora/` only to requests that carry no browser `Origin` header, so the
/// engine fetches it: a plain HTTP client sends none. The whole part comes back at once.
pub fn fetch_sora_part(
    agent: &ureq::Agent,
    origin: &str,
    path: &str,
    size: u64,
    part: u64,
) -> Result<Vec<u8>, String> {
    let url = format!("{origin}/sora/{size}/{}", sora_token(path, part, size));
    let resp = loop {
        match agent
            .get(&url)
            .set("Referer", "https://abyssplayer.com/")
            .call()
        {
            Ok(resp) => break resp,
            Err(error)
                if matches!(
                    error,
                    ureq::Error::Transport(_) | ureq::Error::Status(500..=599, _)
                ) =>
            {
                thread::sleep(Duration::from_millis(100));
                match agent
                    .get(&url)
                    .set("Referer", "https://abyssplayer.com/")
                    .call()
                {
                    Ok(resp) => break resp,
                    Err(error) => {
                        return Err(format!(
                            "UPSTREAM_DOWN: Không tải được phần phim HDX: {error}"
                        ))
                    }
                }
            }
            Err(error) => {
                return Err(format!(
                    "UPSTREAM_DOWN: Không tải được phần phim HDX: {error}"
                ))
            }
        }
    };
    let mut body = Vec::with_capacity(SORA_CHUNK as usize);
    resp.into_reader()
        .read_to_end(&mut body)
        .map_err(|e| format!("UPSTREAM_DOWN: Đọc phần phim HDX lỗi: {e}"))?;
    Ok(body)
}

/// Decrypt what the embed page hands its player: AES-256-CTR with the key written as
/// hexadecimal text and its first half used again as the counter block.
pub fn decrypt_with_hex_key(key_hex: &str, data: &mut [u8]) -> Result<(), String> {
    let key = key_hex.as_bytes();
    let counter = key.get(..16).ok_or("Khóa HDX quá ngắn")?;
    if key.len() != 32 {
        return Err("Khóa HDX không đủ 32 ký tự".into());
    }
    let mut cipher = Aes256Ctr::new(key.into(), counter.into());
    cipher.apply_keystream(data);
    Ok(())
}

/// Read the `<a class="btn3dsv" …>` buttons of the site's server picker.
pub fn parse_server_buttons(html: &str) -> Vec<ServerButton> {
    let mut buttons = Vec::new();
    for chunk in html.split("<a ").skip(1) {
        let Some(tag_end) = chunk.find('>') else {
            continue;
        };
        let tag = &chunk[..tag_end];
        let rest = &chunk[tag_end + 1..];
        let name = rest
            .split('<')
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();
        let (Some(id), Some(play), Some(href)) = (
            scraper::extract_attr(tag, "data-id"),
            scraper::extract_attr(tag, "data-play"),
            scraper::extract_attr(tag, "data-href"),
        ) else {
            continue;
        };
        buttons.push(ServerButton {
            id: id.to_string(),
            play: play.to_string(),
            href: href.to_string(),
            name,
        });
    }
    buttons
}

/// Read the `const datas = "…"` payload of an embed page.
///
/// Its base64 holds bytes, not text: the page's own player reads them one byte per character,
/// so each byte becomes the character of the same value before the JSON is parsed.
pub fn decode_embed_payload(html: &str) -> Result<Value, String> {
    let encoded = scraper::extract_between(html, "const datas = \"", "\"")
        .ok_or("NO_SOURCE: Trang phát HDX không có dữ liệu phim")?;
    let padded = match encoded.len() % 4 {
        0 => encoded.to_string(),
        remainder => format!("{encoded}{}", "=".repeat(4 - remainder)),
    };
    let bytes = B64_STD
        .decode(padded.as_bytes())
        .map_err(|e| format!("Dữ liệu HDX không phải base64: {e}"))?;
    let text: String = bytes.iter().map(|byte| *byte as char).collect();
    serde_json::from_str(&text).map_err(|e| format!("Dữ liệu HDX không phải JSON: {e}"))
}

/// The bytes of a JSON string that carries one byte per character.
fn latin1_bytes(value: &str) -> Result<Vec<u8>, String> {
    value
        .chars()
        .map(|c| u8::try_from(c as u32).map_err(|_| "Chuỗi HDX chứa ký tự ngoài một byte".into()))
        .collect()
}

/// A number that may be written as a number or as a string.
fn scalar_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// Decrypt the embed payload's `media` field into the file description it hides.
pub fn decode_media(payload: &Value) -> Result<Value, String> {
    let (Some(user_id), Some(slug), Some(md5_id)) = (
        scalar_text(payload.get("user_id")),
        payload.get("slug").and_then(Value::as_str),
        scalar_text(payload.get("md5_id")),
    ) else {
        return Err("NO_SOURCE: Trang phát HDX thiếu thông tin phim".into());
    };
    let media = payload
        .get("media")
        .and_then(Value::as_str)
        .ok_or("NO_SOURCE: Trang phát HDX thiếu danh sách file")?;
    let mut bytes = latin1_bytes(media)?;
    decrypt_with_hex_key(&md5_hex(&format!("{user_id}:{slug}:{md5_id}")), &mut bytes)?;
    let text = String::from_utf8(bytes).map_err(|_| "Giải mã HDX hỏng (không phải UTF-8)")?;
    serde_json::from_str(&text).map_err(|e| format!("Danh sách file HDX không phải JSON: {e}"))
}

/// The leading digits of a label such as `1080p`; files are offered from best to worst.
fn height_of(label: &str) -> u64 {
    let digits: String = label.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().unwrap_or(0)
}

/// The parts a path-addressed file is cut into, in bytes; the player uses this size too.
const SORA_CHUNK: u64 = 2_097_152;

/// Turn the decrypted file description into this engine's own source list.
///
/// The backup server stores a film in one of two ways. The older way names a whole file by
/// URL whose first bytes are scrambled. The newer way gives only a storage host and ids, and
/// the file is read part by part from a `/sora/` path whose token this engine signs for the
/// browser (the browser has no MD5 to sign it itself). Both end up as one source per quality.
pub fn shape_sources(media: &Value, md5_id: &str) -> Vec<Value> {
    let mut sources: Vec<(u64, Value)> = Vec::new();
    let mp4 = media.get("mp4");
    let entries = mp4
        .and_then(|mp4| mp4.get("sources"))
        .and_then(Value::as_array);
    let domains = mp4
        .and_then(|mp4| mp4.get("domains"))
        .and_then(Value::as_array);
    for entry in entries.into_iter().flatten() {
        if entry.get("status").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let Some(size) = entry.get("size").and_then(Value::as_u64).filter(|s| *s > 0) else {
            continue;
        };
        let label = entry
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let height = height_of(&label);
        let codec = entry.get("codec").and_then(Value::as_str).unwrap_or("h264");
        if let (Some(base), Some(path)) = (
            entry.get("url").and_then(Value::as_str),
            entry.get("path").and_then(Value::as_str),
        ) {
            if !base.starts_with("https://") {
                continue;
            }
            let url = format!(
                "{}/{}",
                base.trim_end_matches('/'),
                path.trim_start_matches('/')
            );
            let Some(file_name) = url.rsplit('/').next().filter(|name| !name.is_empty()) else {
                continue;
            };
            // A part size of zero means the file is whole.
            let part_size = match entry.get("partSize").and_then(Value::as_u64) {
                Some(value) if value > 0 && value < size => value,
                _ => size,
            };
            sources.push((
                height,
                json!({
                    "label": label, "height": height, "codec": codec, "size": size,
                    "part_size": part_size,
                    "url": url, "key": md5_hex(file_name), "encrypted_head": ENCRYPTED_HEAD,
                }),
            ));
        } else if let (Some(sub), Some(res_id), Some(domains)) = (
            entry.get("sub").and_then(Value::as_str),
            entry.get("res_id").and_then(Value::as_u64),
            domains.filter(|list| !list.is_empty()),
        ) {
            let host = domains
                .iter()
                .filter_map(Value::as_str)
                .find(|domain| domain.contains(sub))
                .or_else(|| domains[size as usize % domains.len()].as_str());
            let Some(host) = host else {
                continue;
            };
            // The storage host only serves /sora/ to its own player's origin, which a browser
            // on this site cannot present. So the file is read back through the engine, which
            // signs each part's token and asks the host without a browser's Origin header.
            let origin = format!("https://{host}");
            let path = format!("/mp4/{md5_id}/{res_id}/{size}/{SORA_CHUNK}");
            let proxy = format!(
                "/api/hdx?o={}&pa={}&s={size}&p={SORA_CHUNK}",
                url_encode(&origin),
                url_encode(&path),
            );
            sources.push((
                height,
                json!({
                    "label": label, "height": height, "codec": codec, "size": size,
                    "proxy": proxy,
                }),
            ));
        }
    }
    sources.sort_by(|left, right| right.0.cmp(&left.0));
    sources.into_iter().map(|(_, source)| source).collect()
}

fn ajax_player(form: &str) -> Result<Map<String, Value>, String> {
    let url = format!("https://{}/ajax/player", parent_host());
    let body = scraper::fetch_avs_html(&url, Some(form))?;
    let parsed: Value = serde_json::from_str(&body)
        .map_err(|e| format!("UPSTREAM_DOWN: Trả lời /ajax/player không phải JSON: {e}"))?;
    match parsed {
        Value::Object(map) => Ok(map),
        _ => Err("UPSTREAM_DOWN: Trả lời /ajax/player không phải đối tượng JSON".into()),
    }
}

/// The hosts that serve one embed link, best first.
fn embed_candidates(link: &str) -> Result<Vec<String>, String> {
    let rest = link
        .strip_prefix("https://")
        .ok_or("NO_SOURCE: Liên kết HDX không dùng https")?;
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = host.split('@').next_back().unwrap_or(host);
    if host != "abyssplayer.com" && !host.ends_with(".abyssplayer.com") {
        return Err("NO_SOURCE: Liên kết HDX trỏ tới một dịch vụ lạ".into());
    }
    let slug = path.split(['?', '#']).next().unwrap_or(path);
    let mut candidates = vec![format!("https://{EMBED_HOST}/{slug}")];
    if host != EMBED_HOST {
        candidates.push(format!("https://{host}/{slug}"));
    }
    Ok(candidates)
}

fn fetch_embed_page(link: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new()
        .user_agent(DEFAULT_UA)
        .timeout_connect(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .build();
    let referer = format!("https://{}/", parent_host());
    let mut last = String::from("NO_SOURCE: Không mở được trang phát HDX");
    for candidate in embed_candidates(link)? {
        match agent.get(&candidate).set("Referer", &referer).call() {
            Ok(response) => {
                return response
                    .into_string()
                    .map_err(|e| format!("UPSTREAM_DOWN: Không đọc được trang phát HDX: {e}"))
            }
            Err(ureq::Error::Status(404, _)) => {
                last = "NO_SOURCE: Trang phát HDX không còn".into();
            }
            Err(error) => {
                last = format!("UPSTREAM_DOWN: Không mở được trang phát HDX: {error}");
            }
        }
    }
    Err(last)
}

/// Every video file HDX offers for one episode link, ready for the browser.
pub fn hdx_sources(input: &str) -> Result<Value, String> {
    let page = watch_page_on(parent_host(), input)?;
    let html = scraper::fetch_avs_html(&page.url, None)?;
    if !html.contains(&format!("/phim/{}/", page.slug)) {
        return Err(format!("NOT_FOUND: Phim '{}' không tồn tại", page.slug));
    }
    let episode_id = match &page.episode_id {
        Some(id) => {
            if !html.contains(&format!("data-id=\"{id}\"")) {
                return Err(format!(
                    "NOT_FOUND: Tập phim ID '{id}' không tồn tại trong phim '{}'",
                    page.slug
                ));
            }
            id.clone()
        }
        None => scraper::extract_between(&html, "\"episode_id\":\"", "\"")
            .ok_or("NO_SOURCE: Trang phim không cho biết tập nào đang phát")?
            .to_string(),
    };

    let servers = ajax_player(&format!("episodeId={}&backup=1", url_encode(&episode_id)))?;
    let server_html = servers
        .get("html")
        .and_then(Value::as_str)
        .ok_or("NO_SOURCE: Tập phim không có máy chủ phát nào")?;
    let embeds: Vec<ServerButton> = parse_server_buttons(server_html)
        .into_iter()
        .filter(|button| button.play == "embed" && !button.href.is_empty())
        .collect();
    if embeds.is_empty() {
        return Err("NO_SOURCE: Tập phim không có máy chủ dự phòng".into());
    }

    let mut last = String::from("NO_SOURCE: Máy chủ dự phòng không trả về nguồn phát");
    for button in embeds {
        let form = format!(
            "link={}&play=embed&id={}&backuplinks=1",
            url_encode(&button.href),
            url_encode(&button.id)
        );
        let answer = match ajax_player(&form) {
            Ok(value) => value,
            Err(error) => {
                last = error;
                continue;
            }
        };
        let Some(link) = answer.get("link").and_then(Value::as_str) else {
            continue;
        };
        let html = match fetch_embed_page(link) {
            Ok(value) => value,
            Err(error) => {
                last = error;
                continue;
            }
        };
        let payload = match decode_embed_payload(&html) {
            Ok(value) => value,
            Err(error) => {
                last = error;
                continue;
            }
        };
        let media = match decode_media(&payload) {
            Ok(value) => value,
            Err(error) => {
                last = error;
                continue;
            }
        };
        // The path-addressed form signs its tokens with a key derived from the film id.
        let md5_id = scalar_text(payload.get("md5_id")).unwrap_or_default();
        let sources = shape_sources(&media, &md5_id);
        if sources.is_empty() {
            continue;
        }
        return Ok(json!({
            "success": true,
            "type": "mp4",
            "server": button.name,
            "sources": sources,
        }));
    }
    Err(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUTTONS: &str = r##"<h3>Chọn Server:</h3> <a class="btn3dsv active" href="#" data-id="0" data-play="api" data-href="bsaqMmxT">DU</a><a class="btn3dsv" href="#" data-id="3" data-play="embed" data-href="IdXN1dHR4">HDX(ADS)</a>"##;

    #[test]
    fn the_embed_button_is_read_with_its_token() {
        let buttons = parse_server_buttons(BUTTONS);
        assert_eq!(buttons.len(), 2);
        assert_eq!(
            buttons[1],
            ServerButton {
                id: "3".into(),
                play: "embed".into(),
                href: "IdXN1dHR4".into(),
                name: "HDX(ADS)".into(),
            }
        );
    }

    #[test]
    fn known_keys_match_the_players_own() {
        assert_eq!(
            md5_hex("1058:nJ2aZEsPe:31853281"),
            "ce5cf60ed77848f5ad4e7d3fe3817a86"
        );
        assert_eq!(
            md5_hex("ad14fc01f0c8fc4439df1fad8afae.131941583.3"),
            "eae413ce2b802e76c2bc2aeb599626aa"
        );
    }

    #[test]
    fn a_recorded_payload_decrypts_to_its_file_list() {
        let mut bytes = [
            0x1d, 0x81, 0xed, 0xc4, 0xeb, 0x97, 0x3f, 0x34, 0x4d, 0x4d, 0x12, 0x0b, 0x8e, 0xa6,
            0xb3, 0x30, 0x0c, 0x4b, 0x2a, 0x1f, 0x89, 0x27, 0x70, 0x03,
        ];
        decrypt_with_hex_key("ce5cf60ed77848f5ad4e7d3fe3817a86", &mut bytes).unwrap();
        assert_eq!(&bytes, br#"{"mp4":{"sources":[{"lab"#);
    }

    #[test]
    fn the_payload_is_read_one_byte_per_character() {
        // How the page writes a byte above 127 and a control byte: the first raw, the second
        // as a JSON escape.
        let raw = b"{\"media\":\"\xff\\u0001\",\"slug\":\"s\",\"user_id\":1,\"md5_id\":\"2\"}";
        let html = format!(
            "const datas = \"{}\";",
            B64_STD.encode(raw).replace('=', "")
        );
        let payload = decode_embed_payload(&html).unwrap();
        assert_eq!(payload["slug"], "s");
        assert_eq!(
            latin1_bytes(payload["media"].as_str().unwrap()).unwrap(),
            vec![0xff, 0x01]
        );
        assert!(latin1_bytes("Ā").is_err());
    }

    #[test]
    fn the_token_matches_the_one_the_storage_host_accepts() {
        // Captured from the real player and verified to return 200 from the storage host.
        assert_eq!(
            size_token_key(253594379),
            "b4b056630031d54e7abb3c9606292557"
        );
        assert_eq!(
            sora_token("/mp4/27621160/2/253594379/2097152", 40, 253594379),
            "MTE5QzhLcnUzQXVqYWtwcm5KVk53c3h6SmRuc3RET3orVzY3MFpvRU9hKzBxUjFB"
        );
    }

    #[test]
    fn a_path_addressed_source_becomes_a_proxied_source() {
        // The newer form carries only sub/res_id/size; it is read back through the engine.
        let media = json!({"mp4": {"sources": [
            {"label": "360p", "res_id": 2, "size": 253594379, "codec": "h264", "status": true, "sub": "gi7owxbf32"}
        ], "domains": ["other.sssrr.org", "gi7owxbf32.sssrr.org"]}});
        let sources = shape_sources(&media, "27621160");
        assert_eq!(sources.len(), 1);
        let proxy = sources[0]["proxy"].as_str().unwrap();
        assert!(proxy.starts_with("/api/hdx?o=https%3A%2F%2Fgi7owxbf32.sssrr.org"));
        assert!(proxy.contains("pa=%2Fmp4%2F27621160%2F2%2F253594379%2F2097152"));
        assert!(proxy.contains("s=253594379"));
        assert!(proxy.contains("p=2097152"));
        assert!(sources[0].get("url").is_none());
    }

    #[test]
    fn files_are_offered_best_first_with_the_key_that_opens_them() {
        let media = json!({"mp4": {"sources": [
            {"label": "480p", "size": 131941583, "status": true, "partSize": 0, "codec": "h264",
             "path": "d/9/9/ad14fc01f0c8fc4439df1fad8afae.131941583.3", "url": "https://a.example/"},
            {"label": "1080p", "size": 647632531, "status": true, "partSize": 324009984, "codec": "h264",
             "path": "f/0/0/file.647632531.5", "url": "https://b.example"},
            {"label": "720p", "size": 10, "status": false, "partSize": 0, "codec": "h264",
             "path": "c/720.ts", "url": "https://c.example"}
        ]}});
        let sources = shape_sources(&media, "x");
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0]["label"], "1080p");
        assert_eq!(sources[0]["height"], 1080);
        assert_eq!(sources[0]["part_size"], 324009984u64);
        assert_eq!(
            sources[0]["url"],
            "https://b.example/f/0/0/file.647632531.5"
        );
        assert_eq!(
            sources[1]["url"],
            "https://a.example/d/9/9/ad14fc01f0c8fc4439df1fad8afae.131941583.3"
        );
        // A whole file is one part as long as itself.
        assert_eq!(sources[1]["part_size"], 131941583u64);
        assert_eq!(sources[1]["key"], "eae413ce2b802e76c2bc2aeb599626aa");
    }

    #[test]
    fn the_embed_page_is_asked_of_the_host_that_answers_vietnamese_networks() {
        assert_eq!(
            embed_candidates("https://abyssplayer.com/nJ2aZEsPe").unwrap(),
            vec![
                "https://player.abyssplayer.com/nJ2aZEsPe".to_string(),
                "https://abyssplayer.com/nJ2aZEsPe".to_string(),
            ]
        );
        assert_eq!(
            embed_candidates("https://player.abyssplayer.com/x?a=1").unwrap(),
            vec!["https://player.abyssplayer.com/x".to_string()]
        );
        assert!(embed_candidates("https://evil.example/abyssplayer.com/x").is_err());
        assert!(embed_candidates("http://abyssplayer.com/x").is_err());
    }

    #[test]
    fn part_cache_evicts_lru_entries_within_byte_cap() {
        let cache = HdxPartCache::new(6, Duration::from_secs(600));
        let payload = |value| vec![value; 3];
        cache
            .get_or_fetch_with("a", || Ok(payload(1)))
            .expect("cache a");
        thread::sleep(Duration::from_millis(1));
        cache
            .get_or_fetch_with("b", || Ok(payload(2)))
            .expect("cache b");
        thread::sleep(Duration::from_millis(1));
        let _ = cache.get_or_fetch_with("a", || panic!("a should be cached"));
        thread::sleep(Duration::from_millis(1));
        cache
            .get_or_fetch_with("c", || Ok(payload(3)))
            .expect("cache c");
        assert_eq!(cache.stats(), (2, 6));
        assert_eq!(
            &*cache
                .get_or_fetch_with("a", || panic!("a should remain"))
                .unwrap(),
            &[1, 1, 1]
        );
        assert_eq!(
            &*cache
                .get_or_fetch_with("c", || panic!("c should remain"))
                .unwrap(),
            &[3, 3, 3]
        );
        assert_eq!(
            cache
                .get_or_fetch_with("b", || Ok(payload(4)))
                .unwrap()
                .as_slice(),
            &[4, 4, 4]
        );
    }

    #[test]
    fn part_cache_single_flight_fetches_once() {
        let cache = Arc::new(HdxPartCache::new(1024, Duration::from_secs(600)));
        let barrier = Arc::new(std::sync::Barrier::new(4));
        let fetches = Arc::new(AtomicUsize::new(0));
        let mut workers = Vec::new();
        for _ in 0..4 {
            let cache = Arc::clone(&cache);
            let barrier = Arc::clone(&barrier);
            let fetches = Arc::clone(&fetches);
            workers.push(thread::spawn(move || {
                barrier.wait();
                cache
                    .get_or_fetch_with("same", || {
                        fetches.fetch_add(1, Ordering::SeqCst);
                        thread::sleep(Duration::from_millis(40));
                        Ok(vec![7, 8, 9])
                    })
                    .unwrap()
            }));
        }
        for worker in workers {
            assert_eq!(&*worker.join().unwrap(), &[7, 8, 9]);
        }
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
    }
}
