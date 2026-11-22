use avs_direct_m3u8::{build_direct_cdn_m3u8, DirectM3u8Result};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

type CacheMap = Arc<Mutex<HashMap<String, (Instant, DirectM3u8Result)>>>;
const CACHE_TTL: Duration = Duration::from_secs(1800); // 30 minutes
const DEFAULT_SAMPLE_URL: &str =
    "https://stream.googleapiscdn.com/player/225a9b1cda0dbe429acb3283d030bba90a2195d755376c99d30fbb70c84a5a06";

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

fn get_or_extract(
    target: &str,
    cache: &CacheMap,
) -> Result<(bool, DirectM3u8Result), String> {
    {
        let mut guard = cache.lock().unwrap();
        if let Some((ts, res)) = guard.get(target) {
            if ts.elapsed() < CACHE_TTL {
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
         Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
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
    h1 { margin: 0 0 8px; font-size: 20px; color: #38bdf8; }
    .bar { display: flex; gap: 8px; margin: 14px 0; }
    input { flex: 1; background: #090b10; border: 1px solid #334155; color: #f8fafc; padding: 10px 12px; border-radius: 8px; font-family: monospace; }
    button { background: #0284c7; color: #fff; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-weight: 600; }
    button:hover { background: #0369a1; }
    video { width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 8px; margin-top: 10px; }
    .endpoints { background: #090b10; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 13px; color: #94a3b8; margin-top: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>AnimeVietSub Direct-CDN HLS API (Rust • 0 Server Bandwidth)</h1>
    <div class="bar">
      <input id="urlInput" value="https://stream.googleapiscdn.com/player/225a9b1cda0dbe429acb3283d030bba90a2195d755376c99d30fbb70c84a5a06" placeholder="Nhập link stream.googleapiscdn.com/player/<id> hoặc player_id..." />
      <button onclick="playStream()">Giải mã & Phát thử</button>
    </div>
    <video id="video" controls playsinline></video>
    <div class="endpoints" id="statusBox">
      <div>• <b>GET /health</b> — Kiểm tra trạng thái máy chủ & bộ nhớ đệm</div>
      <div>• <b>GET /api/playlist.m3u8?url=&lt;player_url_or_id&gt;</b> — Xuất trực tiếp file .m3u8 chuẩn (nhúng thẳng key AES-128 & link lh3.googleusercontent.com)</div>
      <div>• <b>GET /api/extract?url=&lt;player_url_or_id&gt;</b> — Xuất JSON chứa metadata, m3u8, và m3u8_data_uri</div>
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

fn handle_client(stream: TcpStream, cache: CacheMap) {
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
        "/health" => {
            let count = cache.lock().map(|g| g.len()).unwrap_or(0);
            let body = json!({
                "status": "ok",
                "service": "avs-direct-m3u8-api",
                "engine": "rust",
                "cached_entries": count
            })
            .to_string();
            send_response(stream, "200 OK", "application/json; charset=utf-8", body.as_bytes());
        }
        "/api/playlist.m3u8" | "/playlist.m3u8" => {
            let target = parse_query_param(query, "url")
                .or_else(|| parse_query_param(query, "id"))
                .unwrap_or_else(|| DEFAULT_SAMPLE_URL.to_string());
            match get_or_extract(&target, &cache) {
                Ok((_cached, res)) => {
                    send_response(
                        stream,
                        "200 OK",
                        "application/vnd.apple.mpegurl; charset=utf-8",
                        res.m3u8.as_bytes(),
                    );
                }
                Err(err) => {
                    let body = json!({ "success": false, "error": err }).to_string();
                    send_response(
                        stream,
                        "502 Bad Gateway",
                        "application/json; charset=utf-8",
                        body.as_bytes(),
                    );
                }
            }
        }
        "/api/extract" | "/extract" => {
            let target = parse_query_param(query, "url")
                .or_else(|| parse_query_param(query, "id"))
                .unwrap_or_else(|| DEFAULT_SAMPLE_URL.to_string());
            match get_or_extract(&target, &cache) {
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
                    let body = json!({ "success": false, "error": err }).to_string();
                    send_response(
                        stream,
                        "502 Bad Gateway",
                        "application/json; charset=utf-8",
                        body.as_bytes(),
                    );
                }
            }
        }
        _ => {
            let body = json!({
                "error": "Not Found",
                "endpoints": ["/health", "/api/extract?url=<player_url>", "/api/playlist.m3u8?url=<player_url>"]
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
    let cache: CacheMap = Arc::new(Mutex::new(HashMap::new()));

    for stream in listener.incoming().flatten() {
        let cache_ref = Arc::clone(&cache);
        thread::spawn(move || {
            handle_client(stream, cache_ref);
        });
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();

    // Serve mode: `--serve [addr]` or when no arguments are passed
    if args.len() == 1 || args.get(1).map(|s| s.as_str()) == Some("--serve") {
        let port = env::var("PORT").unwrap_or_else(|_| "8095".to_string());
        let bind_addr = args
            .get(2)
            .cloned()
            .unwrap_or_else(|| format!("0.0.0.0:{port}"));
        run_server(&bind_addr);
        return;
    }

    // CLI one-shot mode: `avs_direct_m3u8 <url_or_id> [output.m3u8]`
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
