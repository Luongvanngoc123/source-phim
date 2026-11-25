mod accounts;
mod http;
mod store;

use accounts::AccountState;

use avs_direct_m3u8::{
    abyss::{fetch_sora_part, hdx_sources, sora_agent},
    build_direct_cdn_m3u8, cdn_host, du_down_for, parent_host,
    scraper::{
        fetch_anime_detail, fetch_catalog_list, fetch_genres_and_seasons, fetch_home_page,
        fetch_schedule, refresh_cached_schedule_countdowns, search_anime, suggest_anime,
    },
    url_encode, DirectM3u8Result, DEFAULT_UA,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

type StreamCacheMap = Arc<Mutex<HashMap<String, (Instant, DirectM3u8Result)>>>;
type JsonCacheMap = Arc<Mutex<HashMap<String, (Instant, String)>>>;
type ImageCacheMap = Arc<Mutex<HashMap<String, (Instant, String, Vec<u8>)>>>;
type BannerCacheMap = Arc<Mutex<BannerCache>>;

#[derive(Default)]
struct BannerCache {
    entries: HashMap<String, (Instant, String)>,
    queued: HashSet<String>,
    failures: HashMap<String, Instant>,
}

const STREAM_CACHE_TTL: Duration = Duration::from_secs(1800); // 30 minutes
const META_CACHE_TTL: Duration = Duration::from_secs(300); // 5 minutes
const IMAGE_CACHE_TTL: Duration = Duration::from_secs(86400); // 24 hours
const BANNER_CACHE_TTL: Duration = Duration::from_secs(86400); // 24 hours
const IMAGE_CACHE_MAX_BYTES: usize = 64 * 1024 * 1024;
/// A cached page is a few tens of kilobytes of JSON; 512 of them stay in the low tens of megabytes.
const JSON_CACHE_MAX_ENTRIES: usize = 512;
/// Each stream is stored under two keys and carries the playlist twice (plain and as a data URI).
const STREAM_CACHE_MAX_ENTRIES: usize = 128;
const BANNER_RETRY_DELAY: Duration = Duration::from_secs(600);

fn percent_decode(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let raw = input.as_bytes();
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' && i + 2 < raw.len() {
            if let Ok(hex_str) = std::str::from_utf8(&raw[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex_str, 16) {
                    bytes.push(val);
                    i += 3;
                    continue;
                }
            }
        } else if raw[i] == b'+' {
            bytes.push(b' ');
            i += 1;
            continue;
        }
        bytes.push(raw[i]);
        i += 1;
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

struct ResolvedStaticFile {
    path: PathBuf,
    content_type: &'static str,
    cache_control: &'static str,
}

fn decode_static_path(raw_path: &str) -> Option<Vec<String>> {
    let raw = raw_path.strip_prefix('/')?;
    let mut bytes = Vec::with_capacity(raw.len());
    let raw_bytes = raw.as_bytes();
    let mut i = 0;
    while i < raw_bytes.len() {
        if raw_bytes[i] == b'%' {
            if i + 2 >= raw_bytes.len() {
                return None;
            }
            let hex = std::str::from_utf8(&raw_bytes[i + 1..i + 3]).ok()?;
            bytes.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            bytes.push(raw_bytes[i]);
            i += 1;
        }
    }
    while bytes.last() == Some(&b'/') {
        bytes.pop();
    }
    let decoded = String::from_utf8(bytes).ok()?;
    if decoded.is_empty() {
        return Some(Vec::new());
    }
    decoded
        .split('/')
        .map(|segment| {
            if segment.is_empty()
                || segment == ".."
                || segment.contains('\\')
                || segment.as_bytes().contains(&0)
                || segment.starts_with('.')
            {
                None
            } else {
                Some(segment.to_string())
            }
        })
        .collect()
}

fn canonical_file_inside(root: &Path, candidate: &Path) -> Option<PathBuf> {
    let canonical_root = fs::canonicalize(root).ok()?;
    let canonical_candidate = fs::canonicalize(candidate).ok()?;
    if !canonical_candidate.starts_with(&canonical_root)
        || !fs::metadata(&canonical_candidate).ok()?.is_file()
    {
        return None;
    }
    Some(canonical_candidate)
}

fn bracket_entry(dir: &Path, want_dir: bool) -> Option<PathBuf> {
    let mut candidates = fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let matching = if want_dir {
                name.starts_with('[') && name.ends_with(']')
            } else {
                name.starts_with('[') && name.ends_with("].html")
            };
            if !matching {
                return None;
            }
            let metadata = fs::metadata(entry.path()).ok()?;
            (metadata.is_dir() == want_dir && metadata.is_file() != want_dir)
                .then_some((name, entry.path()))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    candidates.into_iter().next().map(|(_, path)| path)
}

fn content_type_for(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

fn static_file(root: &Path, path: PathBuf, request_path: &str) -> Option<ResolvedStaticFile> {
    let path = canonical_file_inside(root, &path)?;
    Some(ResolvedStaticFile {
        content_type: content_type_for(&path),
        cache_control: cache_control_for(request_path, &path),
        path,
    })
}

fn resolve_static_file(root: &Path, request_path: &str) -> Option<ResolvedStaticFile> {
    let segments = decode_static_path(request_path)?;
    let canonical_root = fs::canonicalize(root).ok()?;
    if !fs::metadata(&canonical_root).ok()?.is_dir() {
        return None;
    }

    if segments.is_empty() {
        return static_file(&canonical_root, canonical_root.join("index.html"), request_path);
    }

    // The complete path as a file wins over every other reading of it.
    let mut exact = canonical_root.clone();
    for segment in &segments {
        exact.push(segment);
    }
    if exact.is_file() {
        return static_file(&canonical_root, exact, request_path);
    }

    // Next.js exports a page as `<path>.html`.
    let mut extensionless = canonical_root.clone();
    for (index, segment) in segments.iter().enumerate() {
        if index + 1 == segments.len() {
            extensionless.push(format!("{segment}.html"));
        } else {
            extensionless.push(segment);
        }
    }
    if extensionless.is_file() {
        return static_file(&canonical_root, extensionless, request_path);
    }
    if exact.is_dir() {
        return static_file(&canonical_root, exact.join("index.html"), request_path);
    }

    // Finally walk the path one segment at a time, substituting a deterministic bracket
    // entry whenever the exact segment is absent.
    let mut current = canonical_root.clone();
    for (index, segment) in segments.iter().enumerate() {
        let is_last = index + 1 == segments.len();
        let exact = current.join(segment);
        if exact.is_dir() {
            current = exact;
            continue;
        }
        if exact.is_file() {
            return if is_last {
                static_file(&canonical_root, exact, request_path)
            } else {
                None
            };
        }
        if is_last {
            return bracket_entry(&current, false)
                .and_then(|candidate| static_file(&canonical_root, candidate, request_path));
        }
        current = bracket_entry(&current, true)?;
    }
    static_file(
        &canonical_root,
        current.join("index.html"),
        request_path,
    )
}

fn cache_control_for(request_path: &str, path: &Path) -> &'static str {
    let immutable = decode_static_path(request_path).is_some_and(|segments| {
        segments.len() >= 3 && segments[0] == "_next" && segments[1] == "static"
    });
    if immutable {
        "public, max-age=31536000, immutable"
    } else if path.extension().and_then(|ext| ext.to_str()) == Some("html") {
        "no-cache"
    } else {
        "public, max-age=86400"
    }
}

fn send_file_response(
    mut stream: TcpStream,
    status: &str,
    file: &ResolvedStaticFile,
    head_only: bool,
) {
    let Ok(metadata) = fs::metadata(&file.path) else {
        return;
    };
    let header = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Cache-Control: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cross-Origin-Resource-Policy: cross-origin\r\n\
         Connection: close\r\n\r\n",
        file.content_type,
        metadata.len(),
        file.cache_control
    );
    let _ = stream.write_all(header.as_bytes());
    if !head_only {
        if let Ok(mut body) = fs::File::open(&file.path) {
            let _ = std::io::copy(&mut body, &mut stream);
        }
    }
    let _ = stream.flush();
}

fn parse_query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(percent_decode(v));
            }
        }
    }
    None
}

fn parse_page_param(query: &str) -> u32 {
    parse_query_param(query, "page")
        .and_then(|s| s.parse::<u32>().ok())
        .filter(|&p| p >= 1)
        .unwrap_or(1)
}

/// Drops expired entries, then the oldest ones, until one more entry fits under `max_entries`.
/// Without it every distinct search or episode would stay in memory for the life of the process.
fn make_room<V>(cache: &mut HashMap<String, (Instant, V)>, ttl: Duration, max_entries: usize) {
    cache.retain(|_, (stored, _)| stored.elapsed() < ttl);
    while cache.len() >= max_entries {
        let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, (stored, _))| *stored)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        cache.remove(&oldest);
    }
}

fn get_or_extract(
    target: &str,
    cache: &StreamCacheMap,
) -> Result<(bool, DirectM3u8Result), String> {
    {
        let mut guard = cache.lock().unwrap();
        if let Some((ts, res)) = guard.get(target) {
            if ts.elapsed() < STREAM_CACHE_TTL {
                return Ok((true, res.clone()));
            } else {
                guard.remove(target);
            }
        }
    }
    if du_down_for() > 0 {
        return Err("UNAVAILABLE: Máy chủ DU tạm thời không khả dụng".into());
    }
    let res = build_direct_cdn_m3u8(target, true)?;
    {
        let mut guard = cache.lock().unwrap();
        make_room(&mut guard, STREAM_CACHE_TTL, STREAM_CACHE_MAX_ENTRIES - 1);
        guard.insert(target.to_string(), (Instant::now(), res.clone()));
        guard.insert(res.player_id.clone(), (Instant::now(), res.clone()));
    }
    Ok((false, res))
}

/// What the browser should play for one episode link.
///
/// DU is the first choice: its playlist keeps the player's own ad handling and the exact
/// resume. When DU cannot be reached the episode's second server is asked instead, and its
/// answer is kept for as long as any other page, because its links expire slowly.
fn resolve_stream(
    target: &str,
    stream_cache: &StreamCacheMap,
    json_cache: &JsonCacheMap,
) -> Result<Value, String> {
    match get_or_extract(target, stream_cache) {
        Ok(_) => {
            return Ok(json!({
                "success": true,
                "type": "hls",
                "server": "DU",
                "url": format!("/api/playlist.m3u8?url={}", url_encode(target)),
            }))
        }
        Err(err) if err.starts_with("BAD_REQUEST:") || err.starts_with("NOT_FOUND:") => {
            return Err(err)
        }
        Err(_) => {}
    }
    let body = get_or_fetch_json(&format!("hdx:{target}"), json_cache, || hdx_sources(target))?;
    serde_json::from_str(&body)
        .map_err(|e| format!("UNAVAILABLE: Không đọc được nguồn phát dự phòng: {e}"))
}

fn get_or_fetch_json<F>(key: &str, cache: &JsonCacheMap, fetcher: F) -> Result<String, String>
where
    F: FnOnce() -> Result<Value, String>,
{
    {
        let mut guard = cache.lock().unwrap();
        if let Some((ts, body)) = guard.get(key) {
            if ts.elapsed() < META_CACHE_TTL {
                return Ok(body.clone());
            } else {
                guard.remove(key);
            }
        }
    }
    let val = fetcher()?;
    let serialized = val.to_string();
    {
        let mut guard = cache.lock().unwrap();
        make_room(&mut guard, META_CACHE_TTL, JSON_CACHE_MAX_ENTRIES);
        guard.insert(key.to_string(), (Instant::now(), serialized.clone()));
    }
    Ok(serialized)
}

fn send_response_with_head(
    mut stream: TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    head_only: bool,
) {
    let header = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: *\r\n\
         Cross-Origin-Resource-Policy: cross-origin\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
    let _ = stream.flush();
}


fn cache_image(
    guard: &mut HashMap<String, (Instant, String, Vec<u8>)>,
    key: String,
    content_type: String,
    body: Vec<u8>,
) {
    let now = Instant::now();
    guard.retain(|_, (ts, _, _)| ts.elapsed() < IMAGE_CACHE_TTL);
    guard.remove(&key);
    if body.len() > IMAGE_CACHE_MAX_BYTES {
        return;
    }
    let mut total = guard.values().map(|(_, _, bytes)| bytes.len()).sum::<usize>();
    while total + body.len() > IMAGE_CACHE_MAX_BYTES {
        let Some(oldest_key) = guard
            .iter()
            .min_by_key(|(_, (ts, _, _))| *ts)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        if let Some((_, _, bytes)) = guard.remove(&oldest_key) {
            total = total.saturating_sub(bytes.len());
        }
    }
    if total + body.len() <= IMAGE_CACHE_MAX_BYTES {
        guard.insert(key, (now, content_type, body));
    }
}
fn banner_for_slug(cache: &BannerCacheMap, slug: &str) -> String {
    cache
        .lock()
        .ok()
        .and_then(|guard| guard.entries.get(slug).cloned())
        .filter(|(ts, _)| ts.elapsed() < BANNER_CACHE_TTL)
        .map(|(_, banner)| banner)
        .unwrap_or_default()
}

fn remember_banner(cache: &BannerCacheMap, slug: &str, detail: &Value) {
    let banner = detail
        .get("banner")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if let Ok(mut guard) = cache.lock() {
        guard.entries.insert(slug.to_string(), (Instant::now(), banner));
        guard.failures.remove(slug);
        guard.queued.remove(slug);
    }
}

fn queue_featured_banners(cache: &BannerCacheMap, slugs: &[String], pending: &mut Vec<String>) {
    let Ok(mut guard) = cache.lock() else {
        return;
    };
    for slug in slugs {
        if slug.is_empty()
            || guard
                .entries
                .get(slug)
                .is_some_and(|(ts, _)| ts.elapsed() < BANNER_CACHE_TTL)
            || guard.queued.contains(slug)
            || guard
                .failures
                .get(slug)
                .is_some_and(|ts| ts.elapsed() < BANNER_RETRY_DELAY)
        {
            continue;
        }
        guard.queued.insert(slug.clone());
        guard.failures.remove(slug);
        pending.push(slug.clone());
    }
}

fn featured_slugs(body: &str) -> Vec<String> {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value.get("featured").cloned())
        .and_then(|featured| featured.as_array().cloned())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("slug").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn decorate_home_response(
    body: String,
    banner_cache: &BannerCacheMap,
    banner_tx: &Sender<Vec<String>>,
) -> String {
    let Ok(mut root) = serde_json::from_str::<Value>(&body) else {
        return body;
    };
    let Some(featured) = root.get_mut("featured").and_then(Value::as_array_mut) else {
        return body;
    };
    let mut slugs = Vec::with_capacity(featured.len());
    for item in featured {
        if let Some(object) = item.as_object_mut() {
            let slug = object
                .get("slug")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if !slug.is_empty() {
                slugs.push(slug.clone());
            }
            object.insert(
                "banner".to_string(),
                Value::String(banner_for_slug(banner_cache, &slug)),
            );
        }
    }
    let _ = banner_tx.send(slugs);
    root.to_string()
}

fn run_banner_worker(
    json_cache: JsonCacheMap,
    banner_cache: BannerCacheMap,
    banner_rx: Receiver<Vec<String>>,
    startup_tx: Sender<Vec<String>>,
) {
    let startup_cache = Arc::clone(&json_cache);
    thread::spawn(move || {
        if let Ok(body) = get_or_fetch_json("home:1", &startup_cache, || fetch_home_page(1)) {
            let _ = startup_tx.send(featured_slugs(&body));
        }
    });
    let mut pending = Vec::new();
    let mut last_fetch: Option<Instant> = Some(Instant::now());
    loop {
        while let Ok(slugs) = banner_rx.try_recv() {
            queue_featured_banners(&banner_cache, &slugs, &mut pending);
        }
        if pending.is_empty() {
            match banner_rx.recv_timeout(Duration::from_secs(30)) {
                Ok(slugs) => queue_featured_banners(&banner_cache, &slugs, &mut pending),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
        if pending.is_empty() {
            continue;
        }
        // Oldest request first: the hero shows the featured titles in list order.
        let slug = pending.remove(0);
        if let Some(previous) = last_fetch {
            let elapsed = previous.elapsed();
            if elapsed < Duration::from_millis(500) {
                thread::sleep(Duration::from_millis(500) - elapsed);
            }
        }
        let result = fetch_anime_detail(&slug);
        last_fetch = Some(Instant::now());
        match result {
            Ok(detail) => remember_banner(&banner_cache, &slug, &detail),
            Err(_) => {
                if let Ok(mut guard) = banner_cache.lock() {
                    guard.queued.remove(&slug);
                    guard.failures.insert(slug, Instant::now());
                }
            }
        }
    }
}

fn send_json_result_with_head(
    stream: TcpStream,
    res: Result<String, String>,
    head_only: bool,
) {
    match res {
        Ok(body) => send_response_with_head(
            stream,
            "200 OK",
            "application/json; charset=utf-8",
            body.as_bytes(),
            head_only,
        ),
        Err(err) => {
            let (status, clean_msg) = map_error_status_and_message(&err);
            let body = json!({ "success": false, "error": clean_msg }).to_string();
            send_response_with_head(
                stream,
                status,
                "application/json; charset=utf-8",
                body.as_bytes(),
                head_only,
            );
        }
    }
}

fn send_image_response(
    mut stream: TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    head_only: bool,
) {
    let header = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
         Cross-Origin-Resource-Policy: cross-origin\r\n\
         Cache-Control: public, max-age=2592000, immutable\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
    let _ = stream.flush();
}

fn handle_image_proxy(
    stream: TcpStream,
    raw_target: &str,
    cache: &ImageCacheMap,
    head_only: bool,
) {

    let trimmed = raw_target.trim();
    if trimmed.is_empty() {
        send_json_result_with_head(
            stream,
            Err("BAD_REQUEST: Missing image path or url parameter".into()),
            head_only,
        );
        return;
    }

    let target_url = if trimmed.starts_with("/data/") {
        format!("https://{}{trimmed}", cdn_host())
    } else if let Some(pos) = trimmed.find("/data/") {
        format!("https://{}{}", cdn_host(), &trimmed[pos..])
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        send_json_result_with_head(
            stream,
            Err("BAD_REQUEST: Invalid image URL".into()),
            head_only,
        );
        return;
    };

    {
        let mut guard = cache.lock().unwrap();
        if let Some((ts, ct, bytes)) = guard.get(&target_url) {
            if ts.elapsed() < IMAGE_CACHE_TTL {
                send_image_response(stream, "200 OK", ct, bytes, head_only);
                return;
            } else {
                guard.remove(&target_url);
            }
        }
    }

    let agent = ureq::AgentBuilder::new()
        .user_agent(DEFAULT_UA)
        .timeout(Duration::from_secs(12))
        .build();

    let resp = match agent
        .get(&target_url)
        .set("Referer", &format!("https://{}/", parent_host()))
        .call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(404, _)) => {
            send_json_result_with_head(
                stream,
                Err("NOT_FOUND: Image not found".into()),
                head_only,
            );
            return;
        }
        Err(e) => {
            send_json_result_with_head(
                stream,
                Err(format!("Upstream image fetch failed: {e}")),
                head_only,
            );
            return;
        }
    };

    let content_type = resp
        .header("Content-Type")
        .unwrap_or_else(|| {
            if target_url.ends_with(".png") {
                "image/png"
            } else if target_url.ends_with(".webp") {
                "image/webp"
            } else {
                "image/jpeg"
            }
        })
        .to_string();

    let mut body = Vec::with_capacity(40960);
    if resp.into_reader().read_to_end(&mut body).is_err() {
        send_json_result_with_head(
            stream,
            Err("Failed to read upstream image body".into()),
            head_only,
        );
        return;
    }

    {
        let mut guard = cache.lock().unwrap();
        cache_image(
            &mut guard,
            target_url.clone(),
            content_type.clone(),
            body.clone(),
        );
    }

    send_image_response(stream, "200 OK", &content_type, &body, head_only);
}

/// The only part size the proxy signs for; it matches what the backup player uses.
const HDX_CHUNK: u64 = 2_097_152;

/// Whether a proxy request names a real Abyss storage file and nothing else.
///
/// The path and host shapes are fixed, so this never lets the proxy fetch an arbitrary URL.
fn hdx_params_ok(origin: &str, path: &str, size: u64, chunk: u64) -> bool {
    let Some(host) = origin.strip_prefix("https://") else {
        return false;
    };
    let Some(label) = host.strip_suffix(".sssrr.org") else {
        return false;
    };
    if label.is_empty() || !label.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return false;
    }
    let segments: Vec<&str> = path.split('/').collect();
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    segments.len() == 6
        && segments[0].is_empty()
        && segments[1] == "mp4"
        && digits(segments[2])
        && digits(segments[3])
        && segments[4] == size.to_string()
        && segments[5] == chunk.to_string()
        && chunk == HDX_CHUNK
        && size >= chunk
        && size <= 8_000_000_000
}

/// The inclusive byte span a `Range` header asks for, or the whole file when it has none.
fn parse_byte_range(header: Option<&str>, size: u64) -> Option<(u64, u64)> {
    let Some(header) = header else {
        return Some((0, size - 1));
    };
    let spec = header.trim().strip_prefix("bytes=")?;
    let (first, last) = spec.split_once('-')?;
    let start: u64 = first.trim().parse().ok()?;
    if start >= size {
        return None;
    }
    let end = if last.trim().is_empty() {
        size - 1
    } else {
        last.trim().parse::<u64>().ok()?.min(size - 1)
    };
    (end >= start).then_some((start, end))
}

/// Stream a path-addressed backup file to the browser part by part.
///
/// Each part is a signed `/sora/` request the storage host answers only without a browser's
/// Origin header, so the engine makes it. One part is held in memory at a time.
fn handle_hdx_proxy(
    mut stream: TcpStream,
    query: &str,
    range_header: Option<&str>,
    head_only: bool,
) {
    let (Some(origin), Some(path), Some(size), Some(chunk)) = (
        parse_query_param(query, "o"),
        parse_query_param(query, "pa"),
        parse_query_param(query, "s").and_then(|v| v.parse::<u64>().ok()),
        parse_query_param(query, "p").and_then(|v| v.parse::<u64>().ok()),
    ) else {
        send_json_result_with_head(
            stream,
            Err("BAD_REQUEST: Thiếu tham số nguồn phát".into()),
            head_only,
        );
        return;
    };
    if !hdx_params_ok(&origin, &path, size, chunk) {
        send_json_result_with_head(
            stream,
            Err("BAD_REQUEST: Tham số nguồn phát không hợp lệ".into()),
            head_only,
        );
        return;
    }
    let Some((start, end)) = parse_byte_range(range_header, size) else {
        let header = format!(
            "HTTP/1.1 416 Range Not Satisfiable\r\n\
             Content-Range: bytes */{size}\r\n\
             Access-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
        );
        let _ = stream.write_all(header.as_bytes());
        let _ = stream.flush();
        return;
    };
    let header = format!(
        "HTTP/1.1 206 Partial Content\r\n\
         Content-Type: video/mp4\r\n\
         Content-Length: {}\r\n\
         Content-Range: bytes {start}-{end}/{size}\r\n\
         Accept-Ranges: bytes\r\n\
         Cache-Control: no-store\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cross-Origin-Resource-Policy: cross-origin\r\n\
         Connection: close\r\n\r\n",
        end - start + 1
    );
    if stream.write_all(header.as_bytes()).is_err() {
        return;
    }
    if head_only {
        let _ = stream.flush();
        return;
    }
    let agent = sora_agent();
    let last_part = (size - 1) / chunk;
    let mut part = start / chunk;
    loop {
        let part_start = part * chunk;
        if part_start > end {
            break;
        }
        let bytes = match fetch_sora_part(&agent, &origin, &path, size, part) {
            Ok(bytes) => bytes,
            // The head is already sent, so a failure can only drop the connection.
            Err(_) => return,
        };
        let from = (start.max(part_start) - part_start) as usize;
        let to = ((end + 1).min(part_start + bytes.len() as u64) - part_start) as usize;
        if from < to && from < bytes.len() {
            if stream.write_all(&bytes[from..to.min(bytes.len())]).is_err() {
                return;
            }
        }
        if part >= last_part {
            break;
        }
        part += 1;
    }
    let _ = stream.flush();
}

fn map_error_status_and_message(err: &str) -> (&'static str, &str) {
    if let Some(msg) = err.strip_prefix("NOT_FOUND:").or_else(|| err.strip_prefix("NO_SOURCE:")) {
        ("404 Not Found", msg.trim())
    } else if let Some(msg) = err.strip_prefix("BAD_REQUEST:") {
        ("400 Bad Request", msg.trim())
    } else if let Some(msg) = err.strip_prefix("UPSTREAM_DOWN:") {
        ("502 Bad Gateway", msg.trim())
    } else if let Some(msg) = err.strip_prefix("UNAVAILABLE:") {
        ("503 Service Unavailable", msg.trim())
    } else {
        ("502 Bad Gateway", err)
    }
}


const INDEX_HTML: &str = r#"<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AnimeVietSub Direct-CDN HLS API (Rust)</title>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js"></script>
  <style>
    body { margin: 0; background: #0b0d12; color: #e2e8f0; font-family: system-ui, sans-serif; padding: 24px; }
    .container { max-width: 1040px; margin: 0 auto; background: #141821; border: 1px solid #262d3d; border-radius: 12px; padding: 20px; }
    .top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
    h1 { margin: 0; font-size: 20px; color: #38bdf8; }
    .nav a { color: #38bdf8; text-decoration: none; background: #1e293b; padding: 7px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 1px solid #334155; }
    .nav a:hover { background: #334155; }
    .bar { display: flex; gap: 8px; margin: 14px 0; }
    input { flex: 1; background: #090b10; border: 1px solid #334155; color: #f8fafc; padding: 10px 12px; border-radius: 8px; font-family: monospace; }
    button { background: #0284c7; color: #fff; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-weight: 600; }
    button:hover { background: #0369a1; }
    video { width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 8px; margin-top: 10px; }
    .endpoints { background: #090b10; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 13px; color: #94a3b8; margin-top: 14px; line-height: 1.8; }
    .endpoints a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="top">
      <h1>AnimeVietSub Full Catalog & Direct-CDN HLS API (Rust)</h1>
      <div class="nav">
        <a href="/hdsd">📖 Xem HDSD đầy đủ (/hdsd)</a>
        <a href="/health">🩺 Health (/health)</a>
      </div>
    </div>
    <div class="bar">
      <input id="urlInput" value="https://animevietsub.bid/phim/black-clover-2nd-season-a6073/tap-01-115975.html" placeholder="Nhập link tập phim animevietsub.bid, stream.googleapiscdn.com/player/<id> hoặc player_id..." />
      <button onclick="playStream()">Giải mã & Phát thử</button>
    </div>
    <video id="video" controls playsinline></video>
    <div class="endpoints">
      <div>• <b><a href="/hdsd">GET /hdsd</a></b> — Tài liệu hướng dẫn sử dụng toàn bộ API</div>
      <div>• <b><a href="/api/home">GET /api/home</a></b> — Trang chủ tách rõ 3 khối: <code>latest</code> (10), <code>upcoming</code> (10), <code>featured</code> (10) &amp; <code>items</code> (30) kèm <code>genres</code>, <code>studio</code></div>
      <div>• <b><a href="/api/schedule">GET /api/schedule</a></b> — Lịch chiếu phim kèm giờ chiếu tuyệt đối ISO-8601 (<code>air_at</code>) &amp; đếm ngược thời gian thực (<code>countdown_seconds</code>)</div>
      <div>• <b><a href="/api/upcoming?page=1">GET /api/upcoming?page=1</a></b> — Danh sách phim sắp chiếu &amp; thời gian dự kiến</div>
      <div>• <b><a href="/api/movies?page=1">GET /api/movies?page=1</a></b> — Danh sách Anime Lẻ / Movie</div>
      <div>• <b><a href="/api/series?page=1">GET /api/series?page=1</a></b> — Danh sách Anime Bộ / TV Series</div>
      <div>• <b><a href="/api/genres">GET /api/genres</a></b> — Danh sách tất cả Thể loại &amp; Mùa/Năm</div>
      <div>• <b><a href="/api/genre?slug=hanh-dong&page=1">GET /api/genre?slug=hanh-dong&amp;page=1</a></b> — Lọc phim theo thể loại</div>
      <div>• <b><a href="/api/suggest?q=black+clover">GET /api/suggest?q=black+clover</a></b> — Gợi ý tìm kiếm siêu tốc khi đang gõ (chỉ 1 request <code>/ajax/suggest</code>)</div>
      <div>• <b><a href="/api/search?q=black+clover&page=1">GET /api/search?q=black+clover&amp;page=1</a></b> — Tìm kiếm phim đầy đủ có phân trang</div>
      <div>• <b><a href="/api/anime?slug=black-clover-2nd-season-a6073">GET /api/anime?slug=black-clover-2nd-season-a6073</a></b> — Chi tiết phim, Season &amp; danh sách Tập gọn nhẹ (trả 404 nếu sai slug)</div>
      <div>• <b><a href="/data/poster/animevsub-P0miGCR3CY.jpg">GET /data/poster/&lt;file&gt;.jpg</a></b> &amp; <b><a href="/api/image?url=https://cdn.animevietsub.bid/data/poster/animevsub-P0miGCR3CY.jpg">GET /api/image?url=&lt;url&gt;</a></b> — Proxy ảnh Poster/Banner vượt Cloudflare Challenge &amp; lỗi <code>NotSameOrigin</code></div>
      <div>• <b><a href="/api/playlist.m3u8?url=https://animevietsub.bid/phim/black-clover-2nd-season-a6073/tap-01-115975.html">GET /api/playlist.m3u8?url=&lt;watch_or_player_url&gt;</a></b> — Xuất trực tiếp file .m3u8 chuẩn (trả 404 nếu link tập không tồn tại)</div>
      <div>• <b><a href="/api/stream?url=https://animevietsub.zone/phim/black-clover-2nd-season-a6073/tap-01-115975.html">GET /api/stream?url=&lt;watch_url&gt;</a></b> — Chọn nguồn phát cho tập: DU (HLS) hoặc máy chủ dự phòng HDX (MP4 nhiều độ phân giải)</div>
    </div>
  </div>
  <script>
    const BaseLoader = Hls.DefaultConfig.loader;
    class DirectGoogleCdnLoader extends BaseLoader {
      load(context, config, callbacks) {
        if (context.url && context.url.includes('googleusercontent.com')) {
          const start = typeof context.rangeStart === 'number' ? context.rangeStart : 128;
          const end = typeof context.rangeEnd === 'number' ? context.rangeEnd : undefined;
          context.rangeStart = undefined;
          context.rangeEnd = undefined;
          const origSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function(response, stats, ctx, networkDetails) {
            if (response.data instanceof ArrayBuffer) {
              response.data = response.data.slice(start, end);
            }
            origSuccess(response, stats, ctx, networkDetails);
          };
        }
        super.load(context, config, callbacks);
      }
    }
    let hlsInstance = null;
    function playStream() {
      const val = document.getElementById('urlInput').value.trim();
      if (!val) return;
      const video = document.getElementById('video');
      const m3u8Url = '/api/playlist.m3u8?url=' + encodeURIComponent(val);
      if (hlsInstance) hlsInstance.destroy();
      if (Hls.isSupported()) {
        hlsInstance = new Hls({ fLoader: DirectGoogleCdnLoader });
        hlsInstance.loadSource(m3u8Url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => video.play());
      }
    }
  </script>
</body>
</html>"#;

const HDSD_HTML: &str = r#"<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HDSD — AnimeVietSub Full Catalog & Direct-CDN HLS API (cdn1.lvn123.site)</title>
  <style>
    :root {
      --bg: #0b0d13;
      --card: #131722;
      --border: #252d3d;
      --accent: #38bdf8;
      --green: #34d399;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --code-bg: #080a0f;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; line-height: 1.65; padding: 28px 16px 60px; }
    .wrap { max-width: 1020px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px 24px; margin-bottom: 22px; }
    .header h1 { margin: 0; font-size: 22px; color: var(--accent); }
    .header p { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .badge { background: #064e3b; color: #6ee7b7; padding: 4px 12px; border-radius: 99px; font-size: 12px; font-weight: 600; }
    .badge.blue { background: #0c4a6e; color: #7dd3fc; }
    .nav-btns { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { display: inline-block; background: #1e293b; color: var(--accent); text-decoration: none; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 1px solid #334155; }
    .btn:hover { background: #334155; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 22px 24px; margin-bottom: 20px; }
    h2 { margin: 0 0 14px; font-size: 18px; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    h3 { margin: 18px 0 8px; font-size: 15px; color: #f8fafc; }
    p, li { font-size: 14.5px; color: #cbd5e1; }
    ul, ol { padding-left: 20px; margin: 8px 0; }
    code { background: var(--code-bg); color: #7dd3fc; padding: 2px 6px; border-radius: 5px; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
    pre { background: var(--code-bg); border: 1px solid #1e293b; border-radius: 10px; padding: 14px 16px; overflow-x: auto; font-family: ui-monospace, Consolas, monospace; font-size: 13px; color: #e2e8f0; margin: 10px 0; line-height: 1.55; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13.5px; }
    th, td { border: 1px solid var(--border); padding: 10px 12px; text-align: left; }
    th { background: #1a2030; color: var(--accent); }
    .endpoint-box { background: var(--code-bg); border: 1px solid #1e293b; border-radius: 10px; padding: 12px 16px; margin-bottom: 12px; }
    .method { display: inline-block; background: #0284c7; color: #fff; font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 5px; margin-right: 8px; font-family: monospace; }
    .url { font-family: monospace; color: var(--green); font-size: 13.5px; word-break: break-all; }
    .try-link { float: right; color: var(--accent); font-size: 12.5px; text-decoration: none; font-weight: 600; }
    .try-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div>
        <h1>📖 Hướng Dẫn Sử Dụng API — cdn1.lvn123.site</h1>
        <p>Full Anime Catalog, Search, Suggest, Schedule, Seasons/Episodes &amp; Direct-CDN HLS Stream (Rust Engine)</p>
      </div>
      <div class="nav-btns">
        <a class="btn" href="/console">▶️ Trình phát thử nghiệm (/console)</a>
        <a class="btn" href="/health">🩺 Health (/health)</a>
        <a class="btn" href="https://github.com/Luongvanngoc123/source-phim" target="_blank">📦 GitHub Repo</a>
      </div>
    </div>

    <div class="card">
      <h2>1. Danh sách API Catalog, Tìm kiếm, Gợi ý nhanh, Lịch chiếu &amp; Thông tin Phim</h2>

      <div class="endpoint-box">
        <a class="try-link" href="/api/home" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/home</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Trang chủ (tách riêng 3 khối):</b> Trả về <code>latest</code> (10 phim mới cập nhật), <code>upcoming</code> (10 phim sắp chiếu), <code>featured</code> (10 phim đề cử) và giữ nguyên <code>items</code> (30 phim) để tương thích ngược. Mọi phim đều có đủ <code>poster</code>, <code>episode_badge</code>, <code>rating</code>, <code>year</code>, <code>views</code>, <code>studio</code>, <code>genres</code> và <code>description</code>.</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/schedule" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/schedule</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Lịch chiếu phim &amp; giờ chiếu tuyệt đối:</b> Chia theo từng Thứ/Ngày trong tuần, kèm giờ chiếu tuyệt đối ISO-8601 theo múi giờ Việt Nam (<code>air_at</code>: <code>"2026-11-25T21:00:00+07:00"</code>, <code>air_at_unix</code>, <code>air_date</code>). Trường <code>countdown_seconds</code> và <code>schedule_badge</code> được tính lại theo thời gian thực ở mỗi request (không bị lệch bởi cache 5 phút).</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/upcoming?page=1" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/upcoming?page=1</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Danh sách phim sắp chiếu:</b> Gồm ảnh poster, trạng thái <i>"SẮP CHIẾU"</i>, năm/thời gian ra mắt dự kiến (<code>air_time</code>: <i>"2027"</i>), trailer/PV, <code>studio</code> và mảng <code>genres</code> đầy đủ.</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/anime?slug=black-clover-2nd-season-a6073" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/anime?slug=&lt;slug_or_url&gt;</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Thông tin chi tiết phim + Season (Phần 1, Phần 2, Movie, Special) + Danh sách Tập tối ưu dung lượng:</b>
          Trả về HTTP <code>404 Not Found</code> (<code>{"success": false, "error": "..."}</code>) nếu <code>slug</code> không tồn tại. Mảng <code>episodes</code> được tối ưu gọn nhẹ (<code>episode</code>, <code>title</code>, <code>episode_id</code>, <code>source</code>, <code>watch_url</code>) giúp các bộ phim dài trên 1.200 tập (như Conan) giảm từ 680 KB xuống ~160 KB.</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/suggest?q=black+clover" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/suggest?q=&lt;tu_khoa&gt;</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Gợi ý nhanh khi đang gõ (Autocomplete):</b> Chỉ gọi 1 request duy nhất tới <code>/ajax/suggest</code>, trả nhanh <code>{ "success": true, "query": "...", "count": N, "items": [{ "title", "slug", "poster", "episode_note", "url", "detail_api" }] }</code>.</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/search?q=black+clover&page=1" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/search?q=&lt;tu_khoa&gt;&amp;page=1</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Tìm kiếm phim đầy đủ có phân trang:</b> Chỉ gọi 1 request tới trang tìm kiếm <code>/tim-kiem/&lt;q&gt;/</code>, trả đầy đủ <code>items</code> kèm <code>genres</code>, <code>studio</code>, <code>rating</code>, <code>description</code>.</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/genres" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/genres</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Danh sách Thể loại &amp; Mùa/Năm:</b> Liệt kê toàn bộ thể loại (Action, Fantasy, Romance, Shounen, ...) và danh sách Mùa/Năm phát hành.</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/genre?slug=hanh-dong&page=1" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/genre?slug=&lt;genre_slug&gt;&amp;page=1</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Lọc phim theo thể loại</b> (ví dụ: <code>hanh-dong</code>, <code>phieu-luu</code>, <code>phep-thuat</code>, <code>tinh-cam</code>, <code>hai-huoc</code>) có phân trang.</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/movies?page=1" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/movies?page=1</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Danh sách Anime Lẻ / Movie</b> (<code>/anime-le/</code>) có phân trang.</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/series?page=1" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/series?page=1</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Danh sách Anime Bộ / TV Series</b> (<code>/anime-bo/</code>) có phân trang.</p>
      </div>
    </div>

    <div class="card">
      <h2>2. API Proxy Ảnh Poster &amp; Banner (Bypass Cloudflare Challenge &amp; CORP <code>NotSameOrigin</code>)</h2>
      <p style="margin:0 0 12px;font-size:14px;color:#cbd5e1;">
        Host gốc <code>cdn.animevietsub.bid</code> bật <b>Cloudflare Managed Challenge</b> (<code>cf-mitigated: challenge</code>) đối với mạng bật WARP/VPN và trả kèm header <code>Cross-Origin-Resource-Policy: same-origin</code> khiến trình duyệt ở domain khác bị lỗi <code>ERR_BLOCKED_BY_RESPONSE.NotSameOrigin</code>. Hệ thống đã tích hợp sẵn bộ <b>Image Proxy có RAM Cache (TTL 24h)</b> và <b>tự động rewrite toàn bộ trường <code>poster</code>, <code>banner</code> trong mọi JSON API</b> sang domain <code>https://cdn1.lvn123.site/data/...</code>.
      </p>

      <div class="endpoint-box">
        <a class="try-link" href="/data/poster/animevsub-P0miGCR3CY.jpg" target="_blank">Mở ảnh Poster mẫu ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/data/poster/&lt;ten_file&gt;.jpg</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Đường dẫn trực tiếp cho Poster:</b> Tự động trả về trong trường <code>poster</code> của tất cả API (<code>/api/home</code>, <code>/api/schedule</code>, <code>/api/upcoming</code>, <code>/api/movies</code>, <code>/api/series</code>, <code>/api/genre</code>, <code>/api/search</code>, <code>/api/suggest</code>, <code>/api/anime</code>). Kèm sẵn header <code>Access-Control-Allow-Origin: *</code>, <code>Cross-Origin-Resource-Policy: cross-origin</code> và <code>Cache-Control: public, max-age=2592000, immutable</code> (cache 30 ngày).</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/data/big_banner/animevsub-I4Edz2vXVI.jpg" target="_blank">Mở ảnh Banner mẫu ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/data/big_banner/&lt;ten_file&gt;.jpg</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Đường dẫn trực tiếp cho Big Banner:</b> Tự động trả về trong trường <code>banner</code> của <code>GET /api/anime?slug=...</code>.</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/image?url=https://cdn.animevietsub.bid/data/poster/animevsub-0dfhZ0TW1G.jpg" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/image?url=&lt;url_anh_goc_hoac_path&gt;</span>
        <p style="margin:6px 0 0;font-size:13.5px;"><b>Endpoint Proxy tùy chọn qua query param:</b> Truyền bất kỳ URL ảnh gốc nào của <code>cdn.animevietsub.bid</code> vào tham số <code>?url=</code> để tải ảnh vượt qua Cloudflare Challenge &amp; CORP.</p>
      </div>

      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;background:#080a0f;border:1px solid #1e293b;border-radius:10px;padding:12px 16px;margin-top:12px;">
        <img src="/data/poster/animevsub-P0miGCR3CY.jpg" alt="Poster Preview" style="height:110px;border-radius:8px;border:1px solid #334155;" />
        <img src="/data/big_banner/animevsub-I4Edz2vXVI.jpg" alt="Banner Preview" style="height:110px;border-radius:8px;border:1px solid #334155;max-width:100%;object-fit:cover;" />
        <div style="font-size:13px;color:#94a3b8;flex:1;min-width:220px;">
          <b style="color:#34d399;">✓ Live Preview ngay trên trình duyệt:</b><br/>
          Hai ảnh bên cạnh được tải trực tiếp qua <code>/data/poster/...</code> và <code>/data/big_banner/...</code> với header <code>Cross-Origin-Resource-Policy: cross-origin</code>.
        </div>
      </div>
    </div>

    <div class="card">
      <h2>3. API Giải mã Stream Video HLS Direct-CDN (0 Server Bandwidth)</h2>

      <div class="endpoint-box">
        <a class="try-link" href="/api/playlist.m3u8?url=https://animevietsub.bid/phim/black-clover-2nd-season-a6073/tap-01-115975.html" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/playlist.m3u8?url=&lt;watch_url_or_player_url_or_id&gt;</span>
        <p style="margin:6px 0 0;font-size:13.5px;">Nhận trực tiếp link tập phim (<code>watch_url</code> từ <code>/api/anime</code>), link <code>stream.googleapiscdn.com/player/&lt;id&gt;</code> hoặc mã hash 64 ký tự và trả về file <code>#EXTM3U</code> chuẩn chứa khóa AES-128 inline cùng các segment <code>https://lh3.googleusercontent.com/...=d</code>.<br/>
        • Nếu thiếu tham số <code>url</code>/<code>id</code>: trả HTTP <code>400 Bad Request</code>.<br/>
        • Nếu link tập không tồn tại hoặc <code>episode_id</code> không thuộc về bộ phim đó: trả HTTP <code>404 Not Found</code> (<code>{"success": false, "error": "..."}</code>).</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/stream?url=https://animevietsub.zone/phim/black-clover-2nd-season-a6073/tap-01-115975.html" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/stream?url=&lt;watch_url&gt;</span>
        <p style="margin:6px 0 0;font-size:13.5px;">Chọn nguồn phát cho một tập. Thử máy chủ DU trước; DU không phản hồi thì lấy máy chủ dự phòng HDX của chính tập đó.<br/>
        • DU: <code>{"type":"hls","server":"DU","url":"/api/playlist.m3u8?url=..."}</code>.<br/>
        • HDX: <code>{"type":"mp4","server":"HDX(ADS)","sources":[{"label":"1080p","height":1080,"size":...,"part_size":...,"url":"https://...","key":"&lt;32 hex&gt;","encrypted_head":65536}]}</code> — file tải thẳng từ máy chủ lưu trữ, phần nằm sau <code>part_size</code> nằm ở URL có thêm số thứ tự phần, <code>encrypted_head</code> byte đầu của phần 0 được xáo bằng AES-256-CTR với khóa <code>key</code>.<br/>
        • Thiếu <code>url</code>: <code>400</code>. Phim/tập không tồn tại: <code>404</code>. Không nguồn nào mở được: <code>503</code>.</p>
      </div>

      <div class="endpoint-box">
        <a class="try-link" href="/api/extract?url=https://animevietsub.bid/phim/black-clover-2nd-season-a6073/tap-01-115975.html" target="_blank">Mở thử ↗</a>
        <span class="method">GET</span>
        <span class="url">https://cdn1.lvn123.site/api/extract?url=&lt;watch_url_or_player_url_or_id&gt;</span>
        <p style="margin:6px 0 0;font-size:13.5px;">Trả JSON chứa metadata luồng phát, trạng thái cache, số lượng segment, nội dung <code>m3u8</code> và chuỗi <code>m3u8_data_uri</code>.</p>
      </div>
    </div>

    <div class="card">
      <h2>4. Mẫu JSON trả về của các Endpoint chính</h2>

      <h3>4.1. Trang chủ — <code>GET /api/home</code> (Tách riêng 3 khối <code>latest</code>, <code>upcoming</code>, <code>featured</code>)</h3>
      <pre>{
  "success": true,
  "path": "",
  "page": 1,
  "count": 30,
  "latest": [ /* 10 phim mới cập nhật */ ],
  "upcoming": [ /* 10 phim sắp chiếu */ ],
  "featured": [ /* 10 phim đề cử */ ],
  "items": [ /* 30 phim tổng hợp (giữ tương thích ngược) */ ]
}</pre>

      <h3>4.2. Lịch chiếu — <code>GET /api/schedule</code> (Giờ chiếu tuyệt đối <code>air_at</code> &amp; đếm ngược thời gian thực)</h3>
      <pre>{
  "success": true,
  "generated_at_unix": 1795396000,
  "day_count": 7,
  "schedule": [
    {
      "day": "Thứ Tư , Ngày 25 tháng 11",
      "date": "2026-11-25",
      "count": 1,
      "items": [
        {
          "title": "Thám Tử Đã Chết 2",
          "slug": "tantei-wa-mou-shindeiru-2nd-season-a4659",
          "poster": "https://cdn1.lvn123.site/data/poster/animevsub-0dfhZ0TW1G.jpg",
          "air_time": "21 giờ 00 phút",
          "air_date": "2026-11-25",
          "air_at": "2026-11-25T21:00:00+07:00",
          "air_at_unix": 1795615200,
          "countdown_seconds": 219200,
          "schedule_badge": "2d 12h 53m 20s",
          "progress": "07/13",
          "rating": "9.2",
          "studio": "Kurihara Manabu",
          "detail_api": "/api/anime?slug=tantei-wa-mou-shindeiru-2nd-season-a4659"
        }
      ]
    }
  ]
}</pre>

      <h3>4.3. Gợi ý nhanh — <code>GET /api/suggest?q=black+clover</code></h3>
      <pre>{
  "success": true,
  "query": "black clover",
  "count": 4,
  "items": [
    {
      "title": "Black Clover 2nd Season",
      "slug": "black-clover-2nd-season-a6073",
      "poster": "https://cdn1.lvn123.site/data/poster/animevsub-P0miGCR3CY.jpg",
      "episode_note": "Black Clover Season 2",
      "url": "https://animevietsub.bid/phim/black-clover-2nd-season-a6073/",
      "detail_api": "/api/anime?slug=black-clover-2nd-season-a6073"
    }
  ]
}</pre>

      <h3>4.4. Chi tiết phim &amp; danh sách tập tối ưu — <code>GET /api/anime?slug=black-clover-2nd-season-a6073</code></h3>
      <pre>{
  "success": true,
  "slug": "black-clover-2nd-season-a6073",
  "film_id": "6073",
  "type": "series",
  "title": "Black Clover 2nd Season",
  "sub_title": "Black Clover Season 2",
  "poster": "https://cdn1.lvn123.site/data/poster/animevsub-P0miGCR3CY.jpg",
  "banner": "https://cdn1.lvn123.site/data/big_banner/animevsub-I4Edz2vXVI.jpg",
  "description": "Mùa 2 tập trung vào cuộc chiến tổng lực tại Vương quốc Spade...",
  "rating": "9.7",
  "rating_count": "612",
  "views": "2,124,172 Lượt Xem",
  "schedule": "Thứ Bảy vào lúc 23 giờ 00 phút hàng tuần",
  "status": "Phim đang chiếu/Cập Nhật Tập 08 VietSub",
  "duration": "08/??",
  "quality": "FHD",
  "studio": "Studio Pierrot",
  "season_release": "Mùa Thu - 2026",
  "genres": [
    { "name": "Anime bộ", "slug": "anime-bo" },
    { "name": "Shounen", "slug": "shounen" },
    { "name": "Fantasy", "slug": "phep-thuat" }
  ],
  "seasons": [
    { "name": "Phần Special", "slug": "the-gioi-phep-thuat-ban-dac-biet-a2794", "type": "special", "active": false },
    { "name": "Phần TV Series", "slug": "the-gioi-phep-thuat-a474", "type": "series", "active": false },
    { "name": "Phần Movie", "slug": "black-clover-mahou-tei-no-ken-a4254", "type": "movie", "active": false },
    { "name": "Phần 2", "slug": "black-clover-2nd-season-a6073", "type": "series", "active": true }
  ],
  "episode_count": 8,
  "episodes": [
    {
      "episode": "01",
      "title": "Tập 01",
      "episode_id": "115975",
      "source": "du",
      "watch_url": "https://animevietsub.bid/phim/black-clover-2nd-season-a6073/tap-01-115975.html"
    }
  ]
}</pre>
    </div>

    <div class="card">
      <h2>5. Code mẫu tích hợp Frontend (Hls.js — 0 Server Bandwidth)</h2>
      <p>Ghép trực tiếp <code>watch_url</code> từ <code>episodes</code> vào <code>/api/playlist.m3u8?url=</code> và truyền vào <code>Hls.js</code> kèm <code>DirectGoogleCdnLoader</code>:</p>
      <pre>&lt;video id="video" controls playsinline style="width:100%;max-width:960px;"&gt;&lt;/video&gt;
&lt;script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js"&gt;&lt;/script&gt;
&lt;script&gt;
  const BaseLoader = Hls.DefaultConfig.loader;

  class DirectGoogleCdnLoader extends BaseLoader {
    load(context, config, callbacks) {
      if (context.url &amp;&amp; context.url.includes('googleusercontent.com')) {
        const start = typeof context.rangeStart === 'number' ? context.rangeStart : 128;
        const end = typeof context.rangeEnd === 'number' ? context.rangeEnd : undefined;
        context.rangeStart = undefined;
        context.rangeEnd = undefined;

        const origSuccess = callbacks.onSuccess;
        callbacks.onSuccess = function (response, stats, ctx, networkDetails) {
          if (response.data instanceof ArrayBuffer) {
            response.data = response.data.slice(start, end);
          }
          origSuccess(response, stats, ctx, networkDetails);
        };
      }
      super.load(context, config, callbacks);
    }
  }

  const video = document.getElementById('video');
  const episodeWatchUrl = 'https://animevietsub.bid/phim/black-clover-2nd-season-a6073/tap-01-115975.html';
  const apiM3u8 = 'https://cdn1.lvn123.site/api/playlist.m3u8?url=' + encodeURIComponent(episodeWatchUrl);

  if (Hls.isSupported()) {
    const hls = new Hls({ fLoader: DirectGoogleCdnLoader });
    hls.loadSource(apiM3u8);
    hls.attachMedia(video);
  }
&lt;/script&gt;</pre>
    </div>
  </div>
</body>
</html>"#;

fn handle_client(
    stream: TcpStream,
    stream_cache: StreamCacheMap,
    json_cache: JsonCacheMap,
    image_cache: ImageCacheMap,
    banner_cache: BannerCacheMap,
    banner_tx: Sender<Vec<String>>,
    web_root: Option<PathBuf>,
    account_state: AccountState,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let peer_addr = match stream.peer_addr() {
        Ok(value) => value,
        Err(_) => return,
    };
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let request = match http::read_request(&mut reader, peer_addr) {
        Ok(value) => value,
        Err(error) => {
            let (status, body) = http::parse_error_body(error);
            http::send_response(stream, status, "application/json; charset=utf-8", &body, false, None, true, &[]);
            return;
        }
    };
    let method = request.method.as_str();
    let path = request.path.as_str();
    let query = request.query.as_str();
    let head_only = method == "HEAD";
    let account_stream = match stream.try_clone() {
        Ok(value) => value,
        Err(_) => return,
    };
    if accounts::handle_request(account_stream, &request, &account_state, head_only) {
        return;
    }
    if method == "OPTIONS" {
        send_response_with_head(stream, "204 No Content", "text/plain", b"", false);
        return;
    }
    // API routes answer other methods as they always have; files are only ever read.
    let may_serve_files = method == "GET" || head_only;

    match path {
        "/watch" | "/console" => {
            send_response_with_head(
                stream,
                "200 OK",
                "text/html; charset=utf-8",
                INDEX_HTML.as_bytes(),
                head_only,
            );
        }
        "/" => {
            if let Some(root) = web_root.as_ref().filter(|_| may_serve_files) {
                if let Some(file) = resolve_static_file(root, path) {
                    send_file_response(stream, "200 OK", &file, head_only);
                } else {
                    send_response_with_head(
                        stream,
                        "200 OK",
                        "text/html; charset=utf-8",
                        INDEX_HTML.as_bytes(),
                        head_only,
                    );
                }
            } else {
                send_response_with_head(
                    stream,
                    "200 OK",
                    "text/html; charset=utf-8",
                    INDEX_HTML.as_bytes(),
                    head_only,
                );
            }
        }
        "/hdsd" | "/hdsd/" | "/docs" | "/docs/" => {
            send_response_with_head(
                stream,
                "200 OK",
                "text/html; charset=utf-8",
                HDSD_HTML.as_bytes(),
                head_only,
            );
        }
        "/health" => {
            let s_count = stream_cache.lock().map(|g| g.len()).unwrap_or(0);
            let m_count = json_cache.lock().map(|g| g.len()).unwrap_or(0);
            let i_count = image_cache.lock().map(|g| g.len()).unwrap_or(0);
            let body = json!({
                "status": "ok",
                "service": "avs-direct-m3u8-api",
                "engine": "rust",
                "docs_url": "https://cdn1.lvn123.site/hdsd",
                "upstream_host": parent_host(),
                "image_host": cdn_host(),
                "du_down_for_seconds": du_down_for(),
                "cached_streams": s_count,
                "cached_pages": m_count,
                "cached_images": i_count,
                "web_root": web_root.is_some(),
                "account_store_open": account_state.store.as_ref().is_some_and(|store| store.is_open()),
                "endpoints": [
                    "/console",
                    "/hdsd",
                    "/api/home",
                    "/api/schedule",
                    "/api/upcoming?page=1",
                    "/api/movies?page=1",
                    "/api/series?page=1",
                    "/api/genres",
                    "/api/genre?slug=hanh-dong&page=1",
                    "/api/suggest?q=black+clover",
                    "/api/search?q=black+clover&page=1",
                    "/api/anime?slug=black-clover-2nd-season-a6073",
                    "/data/poster/<file>.jpg",
                    "/api/image?url=<image_url>",
                    "/api/stream?url=<watch_url>",
                    "/api/hdx?o=<host>&pa=<path>&s=<size>&p=<chunk>",
                    "/api/playlist.m3u8?url=<watch_or_player_url>",
                    "/api/extract?url=<watch_or_player_url>"
                ]
            })
            .to_string();
            send_response_with_head(
                stream,
                "200 OK",
                "application/json; charset=utf-8",
                body.as_bytes(),
                head_only,
            );
        }
        "/api/image" | "/image" => {
            let url = parse_query_param(query, "url").unwrap_or_default();
            handle_image_proxy(stream, &url, &image_cache, head_only);
        }
        p if p.starts_with("/data/") => {
            handle_image_proxy(stream, p, &image_cache, head_only);
        }
        "/api/home" | "/home" => {
            let page = parse_page_param(query);
            let key = format!("home:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || fetch_home_page(page))
                .map(|body| decorate_home_response(body, &banner_cache, &banner_tx));
            send_json_result_with_head(stream, res, head_only);
        }
        "/api/schedule" | "/schedule" => {
            let res = get_or_fetch_json("schedule", &json_cache, fetch_schedule)
                .map(|body| refresh_cached_schedule_countdowns(&body));
            send_json_result_with_head(stream, res, head_only);
        }
        "/api/upcoming" | "/upcoming" => {
            let page = parse_page_param(query);
            let key = format!("upcoming:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || {
                fetch_catalog_list("anime-sap-chieu", page)
            });
            send_json_result_with_head(stream, res, head_only);
        }
        "/api/movies" | "/movies" => {
            let page = parse_page_param(query);
            let key = format!("movies:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || fetch_catalog_list("anime-le", page));
            send_json_result_with_head(stream, res, head_only);
        }
        "/api/series" | "/series" => {
            let page = parse_page_param(query);
            let key = format!("series:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || fetch_catalog_list("anime-bo", page));
            send_json_result_with_head(stream, res, head_only);
        }
        "/api/genres" | "/genres" => {
            let res = get_or_fetch_json("genres", &json_cache, fetch_genres_and_seasons);
            send_json_result_with_head(stream, res, head_only);
        }
        "/api/genre" | "/genre" => {
            let slug = parse_query_param(query, "slug").unwrap_or_else(|| "hanh-dong".to_string());
            let page = parse_page_param(query);
            let key = format!("genre:{slug}:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || {
                fetch_catalog_list(&format!("the-loai/{}", slug.trim_matches('/')), page)
            });
            send_json_result_with_head(stream, res, head_only);
        }
        "/api/catalog" | "/catalog" => {
            let cat_path = parse_query_param(query, "path").unwrap_or_default();
            let page = parse_page_param(query);
            let key = format!("catalog:{cat_path}:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || fetch_catalog_list(&cat_path, page));
            send_json_result_with_head(stream, res, head_only);
        }
        "/api/suggest" | "/suggest" => {
            let q = parse_query_param(query, "q")
                .or_else(|| parse_query_param(query, "keyword"))
                .unwrap_or_default();
            let key = format!("suggest:{}", q.trim().to_lowercase());
            let res = get_or_fetch_json(&key, &json_cache, || suggest_anime(&q));
            send_json_result_with_head(stream, res, head_only);
        }
        "/api/search" | "/search" => {
            let q = parse_query_param(query, "q")
                .or_else(|| parse_query_param(query, "keyword"))
                .unwrap_or_default();
            let page = parse_page_param(query);
            let key = format!("search:{}:{page}", q.trim().to_lowercase());
            let res = get_or_fetch_json(&key, &json_cache, || search_anime(&q, page));
            send_json_result_with_head(stream, res, head_only);
        }
        "/api/anime" | "/anime" | "/api/info" | "/info" => {
            let slug = parse_query_param(query, "slug")
                .or_else(|| parse_query_param(query, "url"))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            match slug {
                Some(s) => {
                    let key = format!("anime:{s}");
                    let res = get_or_fetch_json(&key, &json_cache, || fetch_anime_detail(&s));
                    if let Ok(body) = &res {
                        if let Ok(detail) = serde_json::from_str::<Value>(body) {
                            remember_banner(&banner_cache, &s, &detail);
                        }
                    }
                    send_json_result_with_head(stream, res, head_only);
                }
                None => {
                    send_json_result_with_head(
                        stream,
                        Err("BAD_REQUEST: Missing required query parameter: slug".into()),
                        head_only,
                    );
                }
            }
        }
        "/api/playlist.m3u8" | "/playlist.m3u8" => {
            let target = parse_query_param(query, "url")
                .or_else(|| parse_query_param(query, "id"))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let Some(target) = target else {
                send_json_result_with_head(
                    stream,
                    Err("BAD_REQUEST: Missing required query parameter: url or id".into()),
                    head_only,
                );
                return;
            };
            match get_or_extract(&target, &stream_cache) {
                Ok((_cached, res)) => {
                    send_response_with_head(
                        stream,
                        "200 OK",
                        "application/vnd.apple.mpegurl; charset=utf-8",
                        res.m3u8.as_bytes(),
                        head_only,
                    );
                }
                Err(err) => {
                    send_json_result_with_head(stream, Err(err), head_only);
                }
            }
        }
        "/api/stream" | "/stream" => {
            let target = parse_query_param(query, "url")
                .or_else(|| parse_query_param(query, "id"))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let Some(target) = target else {
                send_json_result_with_head(
                    stream,
                    Err("BAD_REQUEST: Missing required query parameter: url or id".into()),
                    head_only,
                );
                return;
            };
            let body = resolve_stream(&target, &stream_cache, &json_cache);
            match body {
                Ok(value) => send_response_with_head(
                    stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    value.to_string().as_bytes(),
                    head_only,
                ),
                Err(err) => send_json_result_with_head(stream, Err(err), head_only),
            }
        }
        "/api/hdx" => {
            handle_hdx_proxy(stream, query, request.header("range"), head_only);
        }
        "/api/extract" | "/extract" => {
            let target = parse_query_param(query, "url")
                .or_else(|| parse_query_param(query, "id"))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let Some(target) = target else {
                send_json_result_with_head(
                    stream,
                    Err("BAD_REQUEST: Missing required query parameter: url or id".into()),
                    head_only,
                );
                return;
            };
            match get_or_extract(&target, &stream_cache) {
                Ok((cached, res)) => {
                    let body = json!({
                        "success": true,
                        "cached": cached,
                        "player_id": res.player_id,
                        "segment_count": res.segment_count,
                        "seg_key_data_uri": res.seg_key_data_uri,
                        "playlist_endpoint": format!("/api/playlist.m3u8?id={}", res.player_id),
                        "m3u8_data_uri": res.m3u8_data_uri,
                        "m3u8": res.m3u8
                    })
                    .to_string();
                    send_response_with_head(
                        stream,
                        "200 OK",
                        "application/json; charset=utf-8",
                        body.as_bytes(),
                        head_only,
                    );
                }
                Err(err) => {
                    send_json_result_with_head(stream, Err(err), head_only);
                }
            }
        }
        _ => {
            if let Some(root) = web_root.as_ref().filter(|_| {
                may_serve_files && path != "/api" && !path.starts_with("/api/")
            })
            {
                if let Some(file) = resolve_static_file(root, path) {
                    send_file_response(stream, "200 OK", &file, head_only);
                } else if let Some(file) = resolve_static_file(root, "/404.html") {
                    send_file_response(stream, "404 Not Found", &file, head_only);
                } else {
                    let body = json!({
                        "success": false,
                        "error": "Not Found",
                        "docs": "https://cdn1.lvn123.site/hdsd"
                    })
                    .to_string();
                    send_response_with_head(
                        stream,
                        "404 Not Found",
                        "application/json; charset=utf-8",
                        body.as_bytes(),
                        head_only,
                    );
                }
            } else {
                let body = json!({
                    "success": false,
                    "error": "Not Found",
                    "docs": "https://cdn1.lvn123.site/hdsd"
                })
                .to_string();
                send_response_with_head(
                    stream,
                    "404 Not Found",
                    "application/json; charset=utf-8",
                    body.as_bytes(),
                    head_only,
                );
            }
        }
    }
}

fn configured_web_root() -> Option<PathBuf> {
    let configured = env::var_os("WEB_ROOT")?;
    let root = fs::canonicalize(configured).ok()?;
    if !fs::metadata(&root).ok()?.is_dir()
        || !fs::metadata(root.join("index.html")).ok()?.is_file()
    {
        return None;
    }
    Some(root)
}

fn run_server(bind_addr: &str) {
    let listener = TcpListener::bind(bind_addr).unwrap_or_else(|e| {
        eprintln!("[ERR] Could not bind to {bind_addr}: {e}");
        std::process::exit(1);
    });
    println!("[OK] AnimeVietSub Direct-CDN Rust API Server listening on http://{bind_addr}");
    let stream_cache: StreamCacheMap = Arc::new(Mutex::new(HashMap::new()));
    let json_cache: JsonCacheMap = Arc::new(Mutex::new(HashMap::new()));
    let image_cache: ImageCacheMap = Arc::new(Mutex::new(HashMap::new()));
    let banner_cache: BannerCacheMap = Arc::new(Mutex::new(BannerCache::default()));
    let (banner_tx, banner_rx) = mpsc::channel();
    let worker_json_cache = Arc::clone(&json_cache);
    let worker_banner_cache = Arc::clone(&banner_cache);
    let worker_startup_tx = banner_tx.clone();
    thread::spawn(move || {
        run_banner_worker(
            worker_json_cache,
            worker_banner_cache,
            banner_rx,
            worker_startup_tx,
        )
    });
    let web_root = configured_web_root();
    let data_dir = env::var_os("DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("./data"));
    let account_store = match store::AccountStore::open(&data_dir) {
        Ok(store) => Some(Arc::new(store)),
        Err(error) => {
            eprintln!("[ERR] Account store unavailable: {error:?}");
            None
        }
    };
    let account_state = AccountState::new(account_store);

    for stream in listener.incoming().flatten() {
        let sc = Arc::clone(&stream_cache);
        let jc = Arc::clone(&json_cache);
        let ic = Arc::clone(&image_cache);
        let bc = Arc::clone(&banner_cache);
        let bt = banner_tx.clone();
        let root = web_root.clone();
        let accounts = account_state.clone();
        thread::spawn(move || {
            handle_client(stream, sc, jc, ic, bc, bt, root, accounts);
        });
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() == 1 || args.get(1).map(|s| s.as_str()) == Some("--serve") {
        let port = env::var("PORT").unwrap_or_else(|_| "8095".to_string());
        let bind_addr = args
            .get(2)
            .cloned()
            .unwrap_or_else(|| format!("0.0.0.0:{port}"));
        run_server(&bind_addr);
        return;
    }

    let target_url = &args[1];
    let out_file = args
        .get(2)
        .map(|s| s.as_str())
        .unwrap_or("direct_cdn_playlist.m3u8");

    let start = Instant::now();
    match build_direct_cdn_m3u8(target_url, true) {
        Ok(res) => {
            let elapsed = start.elapsed();
            if let Err(e) = fs::write(out_file, &res.m3u8) {
                eprintln!("[ERR] Failed to write {out_file}: {e}");
                std::process::exit(1);
            }
            println!("[OK] Player ID    : {}", res.player_id);
            println!(
                "[OK] Segments     : {} direct lh3.googleusercontent.com links",
                res.segment_count
            );
            println!(
                "[OK] Inline Key   : {}",
                res.seg_key_data_uri.as_deref().unwrap_or("none")
            );
            println!(
                "[OK] Saved M3U8   : {} ({} bytes) in {:.2?}",
                out_file,
                res.m3u8.len(),
                elapsed
            );
        }
        Err(err) => {
            eprintln!("[ERR] Extraction failed: {err}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_errors_preserve_their_status_without_internal_prefixes() {
        for (prefix, status) in [
            ("BAD_REQUEST", "400 Bad Request"),
            ("NOT_FOUND", "404 Not Found"),
            ("NO_SOURCE", "404 Not Found"),
            ("UPSTREAM_DOWN", "502 Bad Gateway"),
            ("UNAVAILABLE", "503 Service Unavailable"),
        ] {
            assert_eq!(map_error_status_and_message(&format!("{prefix}: lỗi")), (status, "lỗi"));
        }
    }

    fn test_root() -> PathBuf {
        let root = env::temp_dir().join(format!(
            "avs-static-test-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        fs::create_dir_all(root.join("phim/[slug]/[tap]")).expect("create test tree");
        fs::create_dir_all(root.join("phim")).expect("create phim");
        fs::create_dir_all(root.join("_next/static")).expect("create assets");
        fs::write(root.join("index.html"), b"index").expect("write index");
        fs::write(root.join("404.html"), b"not found").expect("write 404");
        fs::write(root.join("exact.js"), b"exact").expect("write exact");
        fs::write(root.join("about.html"), b"about").expect("write html");
        fs::write(root.join("phim/index.html"), b"phim index").expect("write phim index");
        fs::write(root.join("phim/[slug].html"), b"film").expect("write film");
        fs::write(root.join("phim/[slug]/[tap].html"), b"episode").expect("write episode");
        root
    }

    #[test]
    fn resolves_static_export_routes() {
        let root = test_root();
        assert_eq!(
            fs::read(resolve_static_file(&root, "/exact.js").expect("exact").path).unwrap(),
            b"exact"
        );
        assert_eq!(
            fs::read(resolve_static_file(&root, "/about").expect("html suffix").path).unwrap(),
            b"about"
        );
        assert_eq!(
            fs::read(resolve_static_file(&root, "/").expect("index").path).unwrap(),
            b"index"
        );
        assert_eq!(
            fs::read(resolve_static_file(&root, "/phim/").expect("trailing slash").path).unwrap(),
            b"phim index"
        );
        assert_eq!(
            fs::read(resolve_static_file(&root, "/phim/abc").expect("last param").path).unwrap(),
            b"film"
        );
        assert_eq!(
            fs::read(
                resolve_static_file(&root, "/phim/abc/tap-01-1")
                    .expect("inner and last params")
                    .path
            )
            .unwrap(),
            b"episode"
        );
        assert!(resolve_static_file(&root, "/../Cargo.toml").is_none());
        assert!(resolve_static_file(&root, "/..%2f..%2fCargo.toml").is_none());
        assert!(resolve_static_file(&root, "/.env").is_none());
        assert!(resolve_static_file(&root, "/missing").is_none());
        assert!(resolve_static_file(&root.join("does-not-exist"), "/").is_none());
        fs::remove_dir_all(root).expect("remove test tree");
    }

    #[test]
    fn image_cache_stays_within_byte_cap() {
        let mut cache = HashMap::new();
        let body_size = IMAGE_CACHE_MAX_BYTES / 2;
        cache_image(
            &mut cache,
            "one".into(),
            "image/png".into(),
            vec![0; body_size],
        );
        thread::sleep(Duration::from_millis(1));
        cache_image(
            &mut cache,
            "two".into(),
            "image/png".into(),
            vec![0; body_size],
        );
        thread::sleep(Duration::from_millis(1));
        cache_image(
            &mut cache,
            "three".into(),
            "image/png".into(),
            vec![0; body_size],
        );
        let total: usize = cache.values().map(|(_, _, bytes)| bytes.len()).sum();
        assert!(total <= IMAGE_CACHE_MAX_BYTES);
        assert!(!cache.contains_key("one"));
        assert!(cache.contains_key("three"));
    }
}
