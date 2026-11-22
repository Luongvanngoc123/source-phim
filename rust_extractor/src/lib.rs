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

pub mod scraper;

type HmacSha256 = Hmac<Sha256>;
type Aes256Ctr = ctr::Ctr128BE<aes::Aes256>;

pub const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
pub const PARENT_HOST: &str = "animevietsub.bid";

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
    let mut seed = js_parse_int_16(&sk[..prefix_len]);

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

fn url_encode(s: &str) -> String {
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
    if trimmed.contains("stream.googleapiscdn.com/player/") {
        return Ok(trimmed.to_string());
    }

    let full_url = if trimmed.starts_with("/phim/") {
        format!("https://{PARENT_HOST}{trimmed}")
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        return Err(format!("BAD_REQUEST: Unsupported URL or player ID: {trimmed}"));
    };

    // Parse requested film slug and optional episode segment if this is an animevietsub /phim/ URL
    let mut req_slug: Option<String> = None;
    let mut req_ep_id: Option<String> = None;

    if let Some(phim_idx) = full_url.find("/phim/") {
        let after_phim = &full_url[phim_idx + 6..];
        let path_only = after_phim.split(['?', '#']).next().unwrap_or(after_phim);
        let mut segments = path_only.split('/').filter(|s| !s.is_empty());
        if let Some(slug) = segments.next() {
            req_slug = Some(slug.to_string());
            if let Some(ep_seg) = segments.next() {
                if ep_seg != "xem-phim.html" {
                    let stem = ep_seg.strip_suffix(".html").unwrap_or(ep_seg);
                    if let Some((_, tail_id)) = stem.rsplit_once('-') {
                        if !tail_id.is_empty() && tail_id.bytes().all(|b| b.is_ascii_digit()) {
                            req_ep_id = Some(tail_id.to_string());
                        } else {
                            return Err(format!(
                                "NOT_FOUND: Link tập phim không hợp lệ ({ep_seg})"
                            ));
                        }
                    } else {
                        return Err(format!(
                            "NOT_FOUND: Link tập phim không hợp lệ ({ep_seg})"
                        ));
                    }
                }
            }
        } else {
            return Err("BAD_REQUEST: Missing film slug in /phim/ URL".into());
        }
    }

    // If URL is a bare film page `/phim/<slug>` or `/phim/<slug>/`, redirect to `/phim/<slug>/xem-phim.html`
    let fetch_target = if let (Some(ref slug), None) = (&req_slug, &req_ep_id) {
        if !full_url.contains("xem-phim.html") {
            format!("https://{PARENT_HOST}/phim/{slug}/xem-phim.html")
        } else {
            full_url.clone()
        }
    } else {
        full_url.clone()
    };

    let html = scraper::fetch_avs_html(&fetch_target, None)?;

    if let Some(ref slug) = req_slug {
        let expected_path = format!("/phim/{slug}/");
        if !html.contains(&expected_path) {
            return Err(format!("NOT_FOUND: Phim '{slug}' không tồn tại"));
        }
    }

    if let Some(ref ep_id) = req_ep_id {
        let expected_data_id = format!("data-id=\"{ep_id}\"");
        if !html.contains(&expected_data_id) {
            let slug_label = req_slug.as_deref().unwrap_or("unknown");
            return Err(format!(
                "NOT_FOUND: Tập phim ID '{ep_id}' không tồn tại trong phim '{slug_label}'"
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

    Err("NOT_FOUND: Không tìm thấy nguồn phát (stream.googleapiscdn.com/player) cho tập phim này".into())
}

/// Full end-to-end extraction from `https://stream.googleapiscdn.com/player/<id>`
/// (or a 64-hex player ID / watch URL) to a self-contained `.m3u8` pointing directly to `lh3.googleusercontent.com`.
pub fn build_direct_cdn_m3u8(player_input: &str, inline_key: bool) -> Result<DirectM3u8Result, String> {
    let resolved_url = resolve_player_url(player_input)?;
    let player_url = resolved_url.as_str();
    let agent = ureq::AgentBuilder::new()
        .user_agent(DEFAULT_UA)
        .build();

    // 1. Fetch Player HTML
    let html = match agent
        .get(player_url)
        .set("Referer", &format!("https://{PARENT_HOST}/"))
        .call()
    {
        Ok(resp) => resp
            .into_string()
            .map_err(|e| format!("Read player HTML failed: {e}"))?,
        Err(ureq::Error::Status(404, _)) => {
            return Err(format!("NOT_FOUND: Player URL không tồn tại ({player_url})"));
        }
        Err(e) => return Err(format!("GET player failed: {e}")),
    };

    let player_id = extract_between(&html, "const id = \"", "\";")
        .ok_or_else(|| "NOT_FOUND: Player ID không tồn tại hoặc đã bị xóa".to_string())?
        .to_string();
    let avs_token = extract_between(&html, "const avsToken = \"", "\";")
        .ok_or_else(|| "NOT_FOUND: Không tìm thấy avsToken cho Player ID này".to_string())?
        .to_string();

    let session_key = extract_session_key(&avs_token)?;
    let fc = B64_STD.encode(PARENT_HOST.as_bytes());

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
                "NOT_FOUND: Playlist không tồn tại cho player_id '{player_id}'"
            ));
        }
        Err(e) => return Err(format!("GET playlist failed: {e}")),
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
        .map_err(|e| format!("Read carrier M3U8 failed: {e}"))?;

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
                    .map_err(|e| format!("GET seg-key failed: {e}"))?
                    .into_reader()
                    .read_to_end(&mut key_bytes)
                    .map_err(|e| format!("Read seg-key failed: {e}"))?;

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
