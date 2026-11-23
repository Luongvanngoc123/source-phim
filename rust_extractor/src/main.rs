use avs_direct_m3u8::{
    build_direct_cdn_m3u8, cdn_host, parent_host,
    scraper::{
        fetch_anime_detail, fetch_catalog_list, fetch_genres_and_seasons, fetch_home_page,
        fetch_schedule, refresh_cached_schedule_countdowns, search_anime, suggest_anime,
    },
    DirectM3u8Result, DEFAULT_UA,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

type StreamCacheMap = Arc<Mutex<HashMap<String, (Instant, DirectM3u8Result)>>>;
type JsonCacheMap = Arc<Mutex<HashMap<String, (Instant, String)>>>;
type ImageCacheMap = Arc<Mutex<HashMap<String, (Instant, String, Vec<u8>)>>>;

const STREAM_CACHE_TTL: Duration = Duration::from_secs(1800); // 30 minutes
const META_CACHE_TTL: Duration = Duration::from_secs(300); // 5 minutes
const IMAGE_CACHE_TTL: Duration = Duration::from_secs(86400); // 24 hours

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
    let res = build_direct_cdn_m3u8(target, true)?;
    {
        let mut guard = cache.lock().unwrap();
        guard.insert(target.to_string(), (Instant::now(), res.clone()));
        guard.insert(res.player_id.clone(), (Instant::now(), res.clone()));
    }
    Ok((false, res))
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
        guard.insert(key.to_string(), (Instant::now(), serialized.clone()));
    }
    Ok(serialized)
}

fn send_response(
    mut stream: TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) {
    let header = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: *\r\n\
         Cross-Origin-Resource-Policy: cross-origin\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn send_image_response(
    mut stream: TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) {
    let header = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, OPTIONS\r\n\
         Cross-Origin-Resource-Policy: cross-origin\r\n\
         Cache-Control: public, max-age=2592000, immutable\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn handle_image_proxy(stream: TcpStream, raw_target: &str, cache: &ImageCacheMap) {
    let trimmed = raw_target.trim();
    if trimmed.is_empty() {
        send_json_result(
            stream,
            Err("BAD_REQUEST: Missing image path or url parameter".into()),
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
        send_json_result(
            stream,
            Err("BAD_REQUEST: Invalid image URL".into()),
        );
        return;
    };

    {
        let mut guard = cache.lock().unwrap();
        if let Some((ts, ct, bytes)) = guard.get(&target_url) {
            if ts.elapsed() < IMAGE_CACHE_TTL {
                send_image_response(stream, "200 OK", ct, bytes);
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
            send_json_result(stream, Err("NOT_FOUND: Image not found".into()));
            return;
        }
        Err(e) => {
            send_json_result(stream, Err(format!("Upstream image fetch failed: {e}")));
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
        send_json_result(stream, Err("Failed to read upstream image body".into()));
        return;
    }

    if body.len() <= 256 * 1024 {
        let mut guard = cache.lock().unwrap();
        if guard.len() >= 120 {
            let keys: Vec<String> = guard.keys().take(25).cloned().collect();
            for k in keys {
                guard.remove(&k);
            }
        }
        guard.insert(
            target_url,
            (Instant::now(), content_type.clone(), body.clone()),
        );
    }

    send_image_response(stream, "200 OK", &content_type, &body);
}

fn map_error_status_and_message(err: &str) -> (&'static str, &str) {
    if let Some(msg) = err.strip_prefix("NOT_FOUND:") {
        ("404 Not Found", msg.trim())
    } else if let Some(msg) = err.strip_prefix("BAD_REQUEST:") {
        ("400 Bad Request", msg.trim())
    } else {
        ("502 Bad Gateway", err)
    }
}

fn send_json_result(stream: TcpStream, res: Result<String, String>) {
    match res {
        Ok(body) => send_response(stream, "200 OK", "application/json; charset=utf-8", body.as_bytes()),
        Err(err) => {
            let (status, clean_msg) = map_error_status_and_message(&err);
            let body = json!({ "success": false, "error": clean_msg }).to_string();
            send_response(stream, status, "application/json; charset=utf-8", body.as_bytes());
        }
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
        <a class="btn" href="/">▶️ Trình phát thử nghiệm (/)</a>
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
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.is_empty() {
        return;
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let full_path = parts[1];

    if method == "OPTIONS" {
        send_response(stream, "204 No Content", "text/plain", b"");
        return;
    }

    let (path, query) = full_path.split_once('?').unwrap_or((full_path, ""));

    match path {
        "/" | "/watch" => {
            send_response(stream, "200 OK", "text/html; charset=utf-8", INDEX_HTML.as_bytes());
        }
        "/hdsd" | "/hdsd/" | "/docs" | "/docs/" => {
            send_response(stream, "200 OK", "text/html; charset=utf-8", HDSD_HTML.as_bytes());
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
                "cached_streams": s_count,
                "cached_pages": m_count,
                "cached_images": i_count,
                "endpoints": [
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
                    "/api/playlist.m3u8?url=<watch_or_player_url>",
                    "/api/extract?url=<watch_or_player_url>"
                ]
            })
            .to_string();
            send_response(stream, "200 OK", "application/json; charset=utf-8", body.as_bytes());
        }
        "/api/image" | "/image" => {
            let url = parse_query_param(query, "url").unwrap_or_default();
            handle_image_proxy(stream, &url, &image_cache);
        }
        p if p.starts_with("/data/") => {
            handle_image_proxy(stream, p, &image_cache);
        }
        "/api/home" | "/home" => {
            let page = parse_page_param(query);
            let key = format!("home:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || fetch_home_page(page));
            send_json_result(stream, res);
        }
        "/api/schedule" | "/schedule" => {
            let res = get_or_fetch_json("schedule", &json_cache, fetch_schedule)
                .map(|body| refresh_cached_schedule_countdowns(&body));
            send_json_result(stream, res);
        }
        "/api/upcoming" | "/upcoming" => {
            let page = parse_page_param(query);
            let key = format!("upcoming:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || {
                fetch_catalog_list("anime-sap-chieu", page)
            });
            send_json_result(stream, res);
        }
        "/api/movies" | "/movies" => {
            let page = parse_page_param(query);
            let key = format!("movies:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || fetch_catalog_list("anime-le", page));
            send_json_result(stream, res);
        }
        "/api/series" | "/series" => {
            let page = parse_page_param(query);
            let key = format!("series:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || fetch_catalog_list("anime-bo", page));
            send_json_result(stream, res);
        }
        "/api/genres" | "/genres" => {
            let res = get_or_fetch_json("genres", &json_cache, fetch_genres_and_seasons);
            send_json_result(stream, res);
        }
        "/api/genre" | "/genre" => {
            let slug = parse_query_param(query, "slug").unwrap_or_else(|| "hanh-dong".to_string());
            let page = parse_page_param(query);
            let key = format!("genre:{slug}:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || {
                fetch_catalog_list(&format!("the-loai/{}", slug.trim_matches('/')), page)
            });
            send_json_result(stream, res);
        }
        "/api/catalog" | "/catalog" => {
            let cat_path = parse_query_param(query, "path").unwrap_or_default();
            let page = parse_page_param(query);
            let key = format!("catalog:{cat_path}:{page}");
            let res = get_or_fetch_json(&key, &json_cache, || fetch_catalog_list(&cat_path, page));
            send_json_result(stream, res);
        }
        "/api/suggest" | "/suggest" => {
            let q = parse_query_param(query, "q")
                .or_else(|| parse_query_param(query, "keyword"))
                .unwrap_or_default();
            let key = format!("suggest:{}", q.trim().to_lowercase());
            let res = get_or_fetch_json(&key, &json_cache, || suggest_anime(&q));
            send_json_result(stream, res);
        }
        "/api/search" | "/search" => {
            let q = parse_query_param(query, "q")
                .or_else(|| parse_query_param(query, "keyword"))
                .unwrap_or_default();
            let page = parse_page_param(query);
            let key = format!("search:{}:{page}", q.trim().to_lowercase());
            let res = get_or_fetch_json(&key, &json_cache, || search_anime(&q, page));
            send_json_result(stream, res);
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
                    send_json_result(stream, res);
                }
                None => {
                    send_json_result(
                        stream,
                        Err("BAD_REQUEST: Missing required query parameter: slug".into()),
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
                send_json_result(
                    stream,
                    Err("BAD_REQUEST: Missing required query parameter: url or id".into()),
                );
                return;
            };
            match get_or_extract(&target, &stream_cache) {
                Ok((_cached, res)) => {
                    send_response(
                        stream,
                        "200 OK",
                        "application/vnd.apple.mpegurl; charset=utf-8",
                        res.m3u8.as_bytes(),
                    );
                }
                Err(err) => {
                    send_json_result(stream, Err(err));
                }
            }
        }
        "/api/extract" | "/extract" => {
            let target = parse_query_param(query, "url")
                .or_else(|| parse_query_param(query, "id"))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let Some(target) = target else {
                send_json_result(
                    stream,
                    Err("BAD_REQUEST: Missing required query parameter: url or id".into()),
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
                    send_response(
                        stream,
                        "200 OK",
                        "application/json; charset=utf-8",
                        body.as_bytes(),
                    );
                }
                Err(err) => {
                    send_json_result(stream, Err(err));
                }
            }
        }
        _ => {
            let body = json!({
                "success": false,
                "error": "Not Found",
                "docs": "https://cdn1.lvn123.site/hdsd"
            })
            .to_string();
            send_response(
                stream,
                "404 Not Found",
                "application/json; charset=utf-8",
                body.as_bytes(),
            );
        }
    }
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

    for stream in listener.incoming().flatten() {
        let sc = Arc::clone(&stream_cache);
        let jc = Arc::clone(&json_cache);
        let ic = Arc::clone(&image_cache);
        thread::spawn(move || {
            handle_client(stream, sc, jc, ic);
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
