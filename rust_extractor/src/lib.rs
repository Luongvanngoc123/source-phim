use aes::cipher::{KeyIvInit, StreamCipher};
use aes_gcm::{
    aead::{Aead, KeyInit as AeadKeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64_STD, Engine as _};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub mod abyss;
pub mod scraper;

static DU_DOWN_UNTIL: AtomicU64 = AtomicU64::new(0);

fn unix_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

pub fn du_down_for() -> u64 {
    DU_DOWN_UNTIL.load(Ordering::Relaxed).saturating_sub(unix_seconds())
}

/// A DU answer that says the server itself is unreachable rather than the episode missing.
///
/// Its host answers a request without a browser's fingerprint with a Cloudflare challenge, so
/// a 403 means the same thing here as a timeout: nothing this engine sends will be served.
fn du_request_error(step: &str, error: ureq::Error) -> String {
    let unreachable = matches!(
        error,
        ureq::Error::Transport(_) | ureq::Error::Status(500.., _) | ureq::Error::Status(403 | 429, _)
    );
    if unreachable {
        format!("UPSTREAM_DOWN: Không thể kết nối với DU ({step}): {error}")
    } else {
        format!("Yêu cầu tới DU thất bại ({step}): {error}")
    }
}

type HmacSha256 = Hmac<Sha256>;
type Aes256Ctr = ctr::Ctr128BE<aes::Aes256>;

pub const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// Domain the upstream site is served from when `AVS_PARENT_HOST` is not set.
///
/// The site moves to a new domain whenever the current one is blocked: `animevietsub.bid`
/// stopped answering from Vietnamese networks on 2026-11-23 (connections that name it are
/// dropped) and the site went on at `animevietsub.zone`. Set `AVS_PARENT_HOST` to follow the
/// next move without a rebuild.
pub const DEFAULT_PARENT_HOST: &str = "animevietsub.zone";

static PARENT_HOST: LazyLock<String> = LazyLock::new(|| {
    host_from_env("AVS_PARENT_HOST").unwrap_or_else(|| DEFAULT_PARENT_HOST.to_string())
});

static CDN_HOST: LazyLock<String> = LazyLock::new(|| {
    host_from_env("AVS_CDN_HOST").unwrap_or_else(|| format!("cdn.{}", parent_host()))
});

/// A bare host name from the environment; a scheme or trailing slash is tolerated.
fn host_from_env(var: &str) -> Option<String> {
    let raw = std::env::var(var).ok()?;
    let host = raw
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    let is_host_name = !host.is_empty()
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.'));
    if !is_host_name {
        eprintln!("[WARN] Ignoring {var}={raw:?}: not a host name");
        return None;
    }
    Some(host)
}

/// Host of the upstream site: `AVS_PARENT_HOST`, else [`DEFAULT_PARENT_HOST`].
pub fn parent_host() -> &'static str {
    &PARENT_HOST
}

/// Host that serves posters and banners: `AVS_CDN_HOST`, else `cdn.<parent host>`.
pub fn cdn_host() -> &'static str {
    &CDN_HOST
}

#[derive(Debug, Clone)]
pub struct Envelope {
    pub cn: String,
    pub sk: String,
    pub ts: String,
    pub uid: String,
}

#[derive(Debug, Clone)]
pub struct DirectM3u8Result {
    pub player_id: String,
    pub segment_count: usize,
    pub seg_key_data_uri: Option<String>,
    pub m3u8: String,
    pub m3u8_data_uri: String,
}

/// Base64url / Base64 tolerant decoder.
pub fn b64url_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut s = String::with_capacity(input.len() + 4);
    for ch in input.trim().chars() {
        match ch {
            '-' => s.push('+'),
            '_' => s.push('/'),
            c => s.push(c),
        }
    }
    let rem = s.len() % 4;
    if rem != 0 {
        for _ in 0..(4 - rem) {
            s.push('=');
        }
    }
    B64_STD
        .decode(s.as_bytes())
        .map_err(|e| format!("base64 decode error: {e}"))
}

/// Unpack `X-Envelope` (`USDK\x01` + 2-byte BE length + JSON + 4-byte CRC32).
pub fn unpack_envelope(env_b64: &str) -> Result<Envelope, String> {
    let raw = b64url_decode(env_b64)?;
    if raw.len() < 11 || &raw[0..4] != b"USDK" || raw[4] != 1 {
        return Err("Invalid X-Envelope magic or version".into());
    }
    let json_len = ((raw[5] as usize) << 8) | (raw[6] as usize);
    if raw.len() < 7 + json_len {
        return Err("Truncated X-Envelope payload".into());
    }
    let v: Value = serde_json::from_slice(&raw[7..7 + json_len])
        .map_err(|e| format!("Envelope JSON error: {e}"))?;

    let cn = v
        .get("cn")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    let sk = v
        .get("sk")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    let ts = match v.get("ts") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => "0".to_string(),
    };
    let uid = v
        .get("uid")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();

    Ok(Envelope { cn, sk, ts, uid })
}

/// Emulate JavaScript `parseInt(s, 16) >>> 0`.
#[inline]
pub fn js_parse_int_16(s: &str) -> u32 {
    let hex_len = s
        .as_bytes()
        .iter()
        .take_while(|&&b| b.is_ascii_hexdigit())
        .count();
    if hex_len == 0 {
        return 0;
    }
    u64::from_str_radix(&s[..hex_len], 16).unwrap_or(0) as u32
}

/// Emulate `(Math.imul(seed, 1664525) + 1013904223) >>> 0`.
#[inline]
pub fn lcg_step(seed: u32) -> u32 {
    seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223)
}

/// Reverse Fisher-Yates LCG string shuffle on joined `_t` chunks (`Y(aC, sk)`).
/// Operates in-place on raw ASCII bytes for minimal memory usage.
pub fn unshuffle_ciphertext(mut bytes: Vec<u8>, sk: &str) -> Result<String, String> {
    let n = bytes.len();
    if n <= 1 {
        return String::from_utf8(bytes).map_err(|e| e.to_string());
    }
    let prefix_len = sk.len().min(8);
    let prefix = sk.get(..prefix_len).ok_or("Tiền tố khóa DU không hợp lệ")?;
    let mut seed = js_parse_int_16(prefix);

    // Store only the swap target index j for i = (n-1) down to 1 (u32 saves 50% RAM on 64-bit)
    let mut targets = Vec::with_capacity(n - 1);
    for i in (1..n).rev() {
        seed = lcg_step(seed);
        let j = ((seed as usize) % (i + 1)) as u32;
        targets.push(j);
    }

    // Reverse swaps: i goes from 1 up to n-1
    for (rev_idx, &j) in targets.iter().rev().enumerate() {
        let i = rev_idx + 1;
        bytes.swap(i, j as usize);
    }

    String::from_utf8(bytes).map_err(|e| format!("UTF-8 error after unshuffle: {e}"))
}

/// FNV-1a 32-bit hash seeded xorshift32 PRNG (`H(seed)`).
pub struct FnvXorshift32 {
    state: u32,
}

impl FnvXorshift32 {
    pub fn new(seed_str: &str) -> Self {
        let mut h: u32 = 0x811C_9DC5;
        for b in seed_str.bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(0x0100_0193);
        }
        Self {
            state: if h == 0 { 1 } else { h },
        }
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let mut s = self.state;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.state = s;
        s
    }
}

/// Reverse WebCrypto post-decrypt byte permutation and XOR mask (`J(raw, sk, ts)`).
pub fn unpermute_bytes(data: &[u8], sk: &str, ts: &str) -> Vec<u8> {
    let n = data.len();
    if n == 0 {
        return Vec::new();
    }
    let mut prng = FnvXorshift32::new(&format!("{sk}|{ts}"));
    let mut idx: Vec<u32> = (0..n as u32).collect();
    for i in (1..n).rev() {
        let j = (prng.next_u32() as usize) % (i + 1);
        idx.swap(i, j);
    }

    let mut out = vec![0u8; n];
    let mut word = 0u32;
    for i in 0..n {
        if (i & 3) == 0 {
            word = prng.next_u32();
        }
        let xor_byte = ((word >> (8 * (i & 3))) & 0xFF) as u8;
        out[idx[i] as usize] = data[i] ^ xor_byte;
    }
    out
}

/// Extract 64-char hex sessionKey from odd indices of JWT `jti` (`a3(avsToken)`).
pub fn extract_session_key(avs_token: &str) -> Result<String, String> {
    let payload_b64 = avs_token
        .split('.')
        .nth(1)
        .ok_or_else(|| "Invalid JWT format in avsToken".to_string())?;
    let decoded = b64url_decode(payload_b64)?;
    let v: Value =
        serde_json::from_slice(&decoded).map_err(|e| format!("JWT JSON parse error: {e}"))?;
    let jti = v
        .get("jti")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "Missing jti in avsToken".to_string())?;

    let mut sk = String::with_capacity(jti.len() / 2);
    for (idx, ch) in jti.chars().enumerate() {
        if idx % 2 == 1 {
            sk.push(ch);
        }
    }
    Ok(sk)
}

/// Compute HMAC-SHA256(key, msg).
pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key).expect("HMAC accepts any key size");
    mac.update(msg);
    let result = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Decrypt G6 placeholder `/hls/<fileId>.ts?e=<enc_b64>&i=<seg_index>` into direct Google CDN URL.
pub fn decrypt_g6_segment_url(
    session_key: &str,
    file_id: &str,
    seg_index: u32,
    enc_b64: &str,
    key_cache: &mut HashMap<String, [u8; 32]>,
) -> Result<String, String> {
    let aes_key = *key_cache.entry(file_id.to_string()).or_insert_with(|| {
        let msg = format!("url-cipher|{file_id}");
        hmac_sha256(session_key.as_bytes(), msg.as_bytes())
    });

    let mut counter_block = [0u8; 16];
    counter_block[12..16].copy_from_slice(&seg_index.to_be_bytes());

    let mut buf = b64url_decode(enc_b64)?;
    let mut cipher = Aes256Ctr::new((&aes_key).into(), (&counter_block).into());
    cipher.apply_keystream(&mut buf);

    String::from_utf8(buf).map_err(|e| format!("Invalid UTF-8 in G6 URL: {e}"))
}

fn extract_between<'a>(haystack: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
    let start = haystack.find(prefix)? + prefix.len();
    let rest = &haystack[start..];
    let end = rest.find(suffix)?;
    Some(&rest[..end])
}

fn extract_query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(v);
            }
        }
    }
    None
}

/// Percent-encode a value for a URL query or an `x-www-form-urlencoded` body.
pub fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 16);
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// A watch page of the upstream site: where to fetch it and what it must contain.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct WatchPage {
    pub(crate) url: String,
    pub(crate) slug: String,
    pub(crate) episode_id: Option<String>,
}

/// One path segment that may be copied into an upstream URL.
fn is_plain_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// Turn any `/phim/<slug>[/<episode>.html]` link into the same page on `host`.
///
/// Clients keep `watch_url`s around, and those can name a domain the site has since left, so
/// only the path of the link is used; the page is always fetched from the configured host.
pub(crate) fn watch_page_on(host: &str, input: &str) -> Result<WatchPage, String> {
    let Some(phim_idx) = input.find("/phim/") else {
        return Err(format!("BAD_REQUEST: Unsupported URL or player ID: {input}"));
    };
    let after_phim = &input[phim_idx + 6..];
    let path_only = after_phim.split(['?', '#']).next().unwrap_or(after_phim);
    let mut segments = path_only.split('/').filter(|s| !s.is_empty());

    let Some(slug) = segments.next().filter(|s| is_plain_segment(s)) else {
        return Err("BAD_REQUEST: Missing film slug in /phim/ URL".into());
    };
    let Some(ep_seg) = segments.next().filter(|seg| *seg != "xem-phim.html") else {
        return Ok(WatchPage {
            url: format!("https://{host}/phim/{slug}/xem-phim.html"),
            slug: slug.to_string(),
            episode_id: None,
        });
    };

    let stem = ep_seg.strip_suffix(".html").unwrap_or(ep_seg);
    let episode_id = stem
        .rsplit_once('-')
        .map(|(_, tail)| tail)
        .filter(|tail| !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()));
    match episode_id {
        Some(id) if is_plain_segment(ep_seg) => Ok(WatchPage {
            url: format!("https://{host}/phim/{slug}/{ep_seg}"),
            slug: slug.to_string(),
            episode_id: Some(id.to_string()),
        }),
        _ => Err(format!("NOT_FOUND: Link tập phim không hợp lệ ({ep_seg})")),
    }
}

/// Resolve either a 64-char hex player ID, a `stream.googleapiscdn.com/player/<id>` URL,
/// or an `animevietsub.*` watch page URL into a canonical `https://stream.googleapiscdn.com/player/<id>` URL.
pub fn resolve_player_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("BAD_REQUEST: Missing or empty url/id parameter".into());
    }
    if trimmed.len() == 64 && trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Ok(format!("https://stream.googleapiscdn.com/player/{trimmed}"));
    }
    if trimmed.starts_with("https://stream.googleapiscdn.com/player/") {
        return Ok(trimmed.to_string());
    }

    let page = watch_page_on(parent_host(), trimmed)?;
    let html = scraper::fetch_avs_html(&page.url, None)?;

    let expected_path = format!("/phim/{}/", page.slug);
    if !html.contains(&expected_path) {
        return Err(format!("NOT_FOUND: Phim '{}' không tồn tại", page.slug));
    }

    if let Some(ep_id) = &page.episode_id {
        let expected_data_id = format!("data-id=\"{ep_id}\"");
        if !html.contains(&expected_data_id) {
            return Err(format!(
                "NOT_FOUND: Tập phim ID '{ep_id}' không tồn tại trong phim '{}'",
                page.slug
            ));
        }
    }

    let normalized_html = html.replace("\\/", "/");
    if let Some(pos) = normalized_html.find("https://stream.googleapiscdn.com/player/") {
        let slice = &normalized_html[pos..];
        let end = slice
            .find(|c: char| matches!(c, '"' | '\'' | '<' | '>' | ' ' | '\n' | '\r'))
            .unwrap_or(slice.len());
        let raw_url = &slice[..end];
        return Ok(raw_url.to_string());
    }

    Err("NO_SOURCE: Không tìm thấy nguồn phát DU cho tập phim này".into())
}

/// Full end-to-end extraction from `https://stream.googleapiscdn.com/player/<id>`
/// (or a 64-hex player ID / watch URL) to a self-contained `.m3u8` pointing directly to `lh3.googleusercontent.com`.
pub fn build_direct_cdn_m3u8(player_input: &str, inline_key: bool) -> Result<DirectM3u8Result, String> {
    let result = extract_du(player_input, inline_key);
    match &result {
        Ok(_) => DU_DOWN_UNTIL.store(0, Ordering::Relaxed),
        Err(error) if error.starts_with("UPSTREAM_DOWN:") => {
            DU_DOWN_UNTIL.store(unix_seconds().saturating_add(300), Ordering::Relaxed);
        }
        _ => {}
    }
    result
}

fn extract_du(player_input: &str, inline_key: bool) -> Result<DirectM3u8Result, String> {
    let resolved_url = resolve_player_url(player_input)?;
    let player_url = resolved_url.as_str();
    let agent = ureq::AgentBuilder::new()
        .user_agent(DEFAULT_UA)
        .timeout_connect(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .build();

    // 1. Fetch Player HTML
    let html = match agent
        .get(player_url)
        .set("Referer", &format!("https://{}/", parent_host()))
        .call()
    {
        Ok(resp) => resp
            .into_string()
            .map_err(|e| format!("UPSTREAM_DOWN: Không đọc được trang phát DU: {e}"))?,
        Err(ureq::Error::Status(404, _)) => {
            return Err(format!("NO_SOURCE: Player URL không tồn tại ({player_url})"));
        }
        Err(e) => return Err(du_request_error("player", e)),
    };

    let player_id = extract_between(&html, "const id = \"", "\";")
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "NO_SOURCE: Player ID không tồn tại hoặc đã bị xóa".to_string())?
        .to_string();
    let avs_token = extract_between(&html, "const avsToken = \"", "\";")
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "NO_SOURCE: Không tìm thấy avsToken cho Player ID này".to_string())?
        .to_string();

    let session_key = extract_session_key(&avs_token)?;
    let fc = B64_STD.encode(parent_host().as_bytes());

    // 2. Fetch Carrier Playlist + X-Envelope
    let pl_url = format!(
        "https://stream.googleapiscdn.com/playlist/{}/playlist.m3u8?token={}&fc={}",
        player_id,
        url_encode(&avs_token),
        url_encode(&fc)
    );

    let pl_resp = match agent
        .get(&pl_url)
        .set("Referer", player_url)
        .set("Origin", "https://stream.googleapiscdn.com")
        .call()
    {
        Ok(resp) => resp,
        Err(ureq::Error::Status(404, _)) => {
            return Err(format!(
                "NO_SOURCE: Playlist không tồn tại cho player_id '{player_id}'"
            ));
        }
        Err(e) => return Err(du_request_error("playlist", e)),
    };

    let env = if let Some(env_h) = pl_resp.header("X-Envelope") {
        unpack_envelope(env_h)?
    } else {
        Envelope {
            cn: pl_resp.header("X-Edge-Tag").unwrap_or_default().to_string(),
            sk: pl_resp.header("X-Cache-Node").unwrap_or_default().to_string(),
            ts: pl_resp.header("X-Request-Trace").unwrap_or("0").to_string(),
            uid: pl_resp.header("X-Proxy-Digest").unwrap_or_default().to_string(),
        }
    };

    let carrier_m3u8 = pl_resp
        .into_string()
        .map_err(|e| format!("UPSTREAM_DOWN: Không đọc được danh sách phát DU: {e}"))?;

    // 3. Decrypt Carrier M3U8 (Layer 1)
    let mut header_lines = Vec::new();
    let mut joined_t = Vec::with_capacity(carrier_m3u8.len() / 2);

    for line in carrier_m3u8.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            if !(trimmed.starts_with("#EXTINF:")
                || trimmed.starts_with("#EXT-X-ENDLIST")
                || trimmed.starts_with("#EXT-X-KEY"))
            {
                header_lines.push(trimmed);
            }
        } else if let Some(pos) = trimmed.find("_t=") {
            let rest = &trimmed[pos + 3..];
            let end = rest.find('&').unwrap_or(rest.len());
            joined_t.extend_from_slice(&rest.as_bytes()[..end]);
        }
    }

    let unshuffled_t = unshuffle_ciphertext(joined_t, &env.sk)?;
    let cn_bytes = b64url_decode(&env.cn)?;
    if cn_bytes.len() < 12 {
        return Err("X-Envelope cn shorter than 12 bytes".into());
    }

    let hmac_msg = format!("{}:{}:{}:0", env.uid, env.ts, env.sk);
    let aes_gcm_key = hmac_sha256(&cn_bytes, hmac_msg.as_bytes());
    let cipher_gcm = Aes256Gcm::new_from_slice(&aes_gcm_key)
        .map_err(|e| format!("AES-GCM key init error: {e}"))?;
    let nonce = Nonce::from_slice(&cn_bytes[..12]);
    let ct_bytes = b64url_decode(&unshuffled_t)?;

    let raw_decrypted = cipher_gcm
        .decrypt(nonce, ct_bytes.as_ref())
        .map_err(|e| format!("AES-256-GCM decrypt failed: {e}"))?;

    let unpermuted = unpermute_bytes(&raw_decrypted, &env.sk, &env.ts);
    let inner_body = String::from_utf8(unpermuted)
        .map_err(|e| format!("Inner M3U8 UTF-8 error: {e}"))?;

    // 4. Decrypt G6 Placeholder Segment URLs -> Direct Google CDN & Inline 16-Byte Key (Layer 2)
    let mut key_cache: HashMap<String, [u8; 32]> = HashMap::new();
    let mut seg_key_data_uri: Option<String> = None;
    let mut output_m3u8 = String::with_capacity(65536);
    let mut segment_count = 0usize;

    for h in header_lines {
        output_m3u8.push_str(h);
        output_m3u8.push('\n');
    }

    for line in inner_body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("#EXT-X-KEY:") && inline_key {
            if let Some(uri) = extract_between(trimmed, "URI=\"", "\"") {
                let full_key_url = if uri.starts_with('/') {
                    format!("https://stream.googleapiscdn.com{uri}")
                } else {
                    uri.to_string()
                };

                let mut key_bytes = Vec::with_capacity(16);
                agent
                    .get(&full_key_url)
                    .set("Referer", player_url)
                    .set("Origin", "https://stream.googleapiscdn.com")
                    .call()
                    .map_err(|e| du_request_error("seg-key", e))?
                    .into_reader()
                    .read_to_end(&mut key_bytes)
                    .map_err(|e| format!("UPSTREAM_DOWN: Không đọc được khóa phát DU: {e}"))?;

                let b64_key = B64_STD.encode(&key_bytes);
                let data_uri = format!("data:application/octet-stream;base64,{b64_key}");
                let replaced = trimmed.replacen(uri, &data_uri, 1);
                seg_key_data_uri = Some(data_uri);
                output_m3u8.push_str(&replaced);
                output_m3u8.push('\n');
                continue;
            }
        } else if let Some(hls_pos) = trimmed.find("/hls/") {
            let after_hls = &trimmed[hls_pos + 5..];
            if let Some(ts_pos) = after_hls.find(".ts?") {
                let file_id = &after_hls[..ts_pos];
                let query = &after_hls[ts_pos + 4..];
                if let (Some(e_val), Some(i_str)) = (
                    extract_query_param(query, "e"),
                    extract_query_param(query, "i"),
                ) {
                    if let Ok(seg_idx) = i_str.parse::<u32>() {
                        let cdn_url = decrypt_g6_segment_url(
                            &session_key,
                            file_id,
                            seg_idx,
                            e_val,
                            &mut key_cache,
                        )?;
                        output_m3u8.push_str(&cdn_url);
                        output_m3u8.push('\n');
                        segment_count += 1;
                        continue;
                    }
                }
            }
        }

        output_m3u8.push_str(trimmed);
        output_m3u8.push('\n');
    }

    let m3u8_data_uri = format!(
        "data:application/vnd.apple.mpegurl;base64,{}",
        B64_STD.encode(output_m3u8.as_bytes())
    );

    Ok(DirectM3u8Result {
        player_id,
        segment_count,
        seg_key_data_uri,
        m3u8: output_m3u8,
        m3u8_data_uri,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOST: &str = "animevietsub.zone";

    #[test]
    fn malformed_key_prefix_returns_an_error() {
        assert!(unshuffle_ciphertext(vec![0, 1], "1234567é").is_err());
    }

    #[test]
    fn a_blocked_or_broken_du_marks_it_down_but_a_missing_page_does_not() {
        for (status, down) in [(401, false), (404, false), (403, true), (429, true), (500, true), (522, true)] {
            let response = ureq::Response::new(status, "", "").unwrap();
            let error = du_request_error("playlist", ureq::Error::Status(status, response));
            assert_eq!(error.starts_with("UPSTREAM_DOWN:"), down, "status {status}");
        }
    }

    #[test]
    fn episode_link_from_a_domain_the_site_left_is_rebuilt_on_the_current_host() {
        let page = watch_page_on(
            HOST,
            "https://animevietsub.bid/phim/black-clover-2nd-season-a6073/tap-01-115975.html?ref=1#t",
        )
        .unwrap();

        assert_eq!(
            page,
            WatchPage {
                url: "https://animevietsub.zone/phim/black-clover-2nd-season-a6073/tap-01-115975.html"
                    .into(),
                slug: "black-clover-2nd-season-a6073".into(),
                episode_id: Some("115975".into()),
            }
        );
    }

    #[test]
    fn film_link_without_an_episode_opens_its_watch_page() {
        for input in [
            "/phim/abc-a1",
            "https://animevietsub.bid/phim/abc-a1/",
            "https://animevietsub.zone/phim/abc-a1/xem-phim.html",
        ] {
            let page = watch_page_on(HOST, input).unwrap();
            assert_eq!(page.url, "https://animevietsub.zone/phim/abc-a1/xem-phim.html");
            assert_eq!(page.episode_id, None);
        }
    }

    #[test]
    fn episode_segment_without_a_numeric_id_is_not_found() {
        for input in [
            "https://animevietsub.zone/phim/abc-a1/tap-full.html",
            "https://animevietsub.zone/phim/abc-a1/tap-01-12%2F..-9.html",
        ] {
            let error = watch_page_on(HOST, input).unwrap_err();
            assert!(error.starts_with("NOT_FOUND:"), "{input}: {error}");
        }
    }

    #[test]
    fn links_that_are_not_film_pages_are_rejected_without_a_fetch() {
        for input in [
            "https://example.com/",
            "https://animevietsub.bid/",
            "https://animevietsub.zone/phim/",
            "https://animevietsub.zone/phim/../admin",
        ] {
            let error = watch_page_on(HOST, input).unwrap_err();
            assert!(error.starts_with("BAD_REQUEST:"), "{input}: {error}");
        }
    }

    #[test]
    fn player_ids_and_player_urls_need_no_site_lookup() {
        let id = "225a9b1cda0dbe429acb3283d030bba90a2195d755376c99d30fbb70c84a5a06";
        let url = format!("https://stream.googleapiscdn.com/player/{id}");

        assert_eq!(resolve_player_url(id).unwrap(), url);
        assert_eq!(resolve_player_url(&url).unwrap(), url);
    }
}
