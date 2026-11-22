# AnimeVietSub Direct-CDN HLS Extractor (Rust & Python)

Bộ công cụ giải mã tĩnh 2 lớp mật mã của player `stream.googleapiscdn.com` (`AnimeVietSub`) để xuất ra file HLS Playlist (`.m3u8`) chuẩn quốc tế trỏ thẳng về **Google CDN (`lh3.googleusercontent.com`)** kèm khóa `#EXT-X-KEY` (AES-128) nhúng trực tiếp dạng `data:application/octet-stream;base64,...`.

## Ưu điểm kiến trúc

- **0 Server Video Bandwidth:** Máy chủ của bạn không phải làm proxy tải video. Trình duyệt của người xem tự động kéo trực tiếp từng phân đoạn video (1080p) từ máy chủ Google (`lh3.googleusercontent.com`).
- **Siêu nhẹ RAM & CPU (< 5 MB RAM, ~15ms CPU):** Không dùng trình duyệt ngầm (Headless Chrome / Puppeteer / Playwright). Toàn bộ quá trình giải mã chạy bằng thuật toán mật mã thuần (`HMAC-SHA256`, `AES-256-GCM`, `AES-256-CTR`, `LCG`, `FNV-1a + xorshift32`).
- **Bypass Cloudflare 403:** Bản Rust sử dụng `ureq` + `rustls` (`ring`) tương thích TLS fingerprint, vượt thẳng lớp chặn `403` mà không cần cookie trình duyệt.
- **Độc lập hoàn toàn ở phía Client:** File `.m3u8` đầu ra (~64 KB) không còn bất kỳ kết nối nào tới `stream.googleapiscdn.com` hay `animevietsub.bid`.

---

## Cấu trúc thư mục

```text
├── README.md                       # Hướng dẫn sử dụng chi tiết
├── API_SPEC.md                     # Đặc tả toàn bộ Client-side API & giao thức giải mã
├── direct_m3u8_extractor.py        # Module giải mã viết bằng Python thuần
├── direct_cdn_playlist.m3u8        # File playlist mẫu đã giải mã hoàn chỉnh (311 segments Google CDN)
├── rust_extractor/                 # Dự án Rust hiệu năng cao (CLI & Library Crate)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                  # Lõi giải mã 2 lớp In-place (Zero-Regex, u32 index)
│       └── main.rs                 # CLI binary
└── sources/                        # Mã nguồn JS client-side trích xuất từ trang gốc
```

---

## Cơ chế giải mã 2 lớp (Reverse Engineered Protocol)

1. **Trích xuất thông tin phiên từ `/player/<id>`:**
   - Gửi `GET https://stream.googleapiscdn.com/player/<id>` với `Referer: https://animevietsub.bid/`.
   - Lấy `id` và `avsToken` (JWT). Trích xuất `sessionKey` (64 ký tự hex) bằng cách lấy các ký tự ở vị trí lẻ `jti[1::2]` trong payload của JWT.
2. **Giải mã Lớp 1 — Carrier M3U8 (`X-Envelope` + `LCG` + `AES-256-GCM` + `FNV-1a/xorshift32`):**
   - Gửi `GET /playlist/<id>/playlist.m3u8?token=<avsToken>&fc=YW5pbWV2aWV0c3ViLmJpZA==` (`fc = btoa("animevietsub.bid")`).
   - Đọc header `X-Envelope` (cấu trúc nhị phân `USDK\x01` + 2-byte độ dài big-endian + JSON `{cn, sk, ts, uid}`).
   - Ghép toàn bộ chuỗi query `_t=...` từ các URL giả `segXXX.html`, đảo hoán vị ký tự bằng bộ sinh `LCG` (`seed = parseInt(sk[:8], 16) >>> 0`).
   - Giải mã `AES-256-GCM` với:
     - `Key = HMAC-SHA256(base64url_decode(cn), "{uid}:{ts}:{sk}:0")`
     - `IV = base64url_decode(cn)[:12]`
   - Đảo mặt nạ XOR và hoán vị mảng byte bằng bộ sinh giả ngẫu nhiên `FNV-1a + xorshift32` khởi tạo từ chuỗi `"{sk}|{ts}"`.
3. **Giải mã Lớp 2 — G6 URL-Cipher (`HMAC-SHA256` + `AES-256-CTR`) sang link Google CDN:**
   - Mỗi link placeholder `/hls/<fileId>.ts?e=<cipher>&i=<seq>` trong playlist lớp 1 được giải mã `AES-256-CTR` với:
     - `Key = HMAC-SHA256(sessionKey, "url-cipher|" + fileId)`
     - `Counter = (seq as u128).to_be_bytes()` (16 bytes big-endian)
   - Kết quả thu được là link trực tiếp trên Google CDN: `https://lh3.googleusercontent.com/...=d`.
4. **Nhúng khóa `#EXT-X-KEY` (AES-128) trực tiếp vào `.m3u8`:**
   - Tải các khóa 16-byte từ `/seg-key/...` một lần duy nhất trên Backend và nhúng thẳng vào `.m3u8` dưới dạng `URI="data:application/octet-stream;base64,..."`.

---

## Hướng dẫn sử dụng (HDSD)

### 1. Bản Rust (Khuyên dùng cho Production)

#### Biên dịch
```bash
cd rust_extractor
cargo build --release
```
File thực thi sẽ nằm tại `rust_extractor/target/release/avs_direct_m3u8` (hoặc `.exe` trên Windows).

#### Chạy qua CLI
```bash
./target/release/avs_direct_m3u8 "https://stream.googleapiscdn.com/player/225a9b1cda0dbe429acb3283d030bba90a2195d755376c99d30fbb70c84a5a06" "output.m3u8"
```

Kết quả mẫu:
```text
[OK] Player ID    : 225a9b1cda0dbe429acb3283d030bba90a2195d755376c99d30fbb70c84a5a06
[OK] Segments     : 311 direct lh3.googleusercontent.com links
[OK] Inline Key   : data:application/octet-stream;base64,QCw8iT+rbPSCn6Wn5J1sRg==
[OK] Saved M3U8   : output.m3u8 (64991 bytes) in 3.19s
```

#### Nhúng làm thư viện trong Backend Rust (Axum / Actix-Web)
```rust
use avs_direct_m3u8::build_direct_cdn_m3u8;

fn get_episode_m3u8(player_url: &str) -> Result<String, String> {
    // Tham số thứ 2 = true để tự động tải và nhúng khóa AES-128 dạng data: URI
    let res = build_direct_cdn_m3u8(player_url, true)?;
    Ok(res.m3u8)
}
```

---

### 2. Bản Python

#### Cài đặt thư viện
```bash
pip install cryptography
```

#### Chạy qua CLI
```bash
python direct_m3u8_extractor.py "https://stream.googleapiscdn.com/player/225a9b1cda0dbe429acb3283d030bba90a2195d755376c99d30fbb70c84a5a06"
```

#### Nhúng vào FastAPI / Flask
```python
from direct_m3u8_extractor import build_direct_cdn_m3u8

data = build_direct_cdn_m3u8("https://stream.googleapiscdn.com/player/225a9b1cda0dbe429acb3283d030bba90a2195d755376c99d30fbb70c84a5a06")
m3u8_content = data["m3u8"]          # Nội dung file .m3u8
m3u8_data_uri = data["m3u8_data_uri"] # Chuỗi data:application/vnd.apple.mpegurl;base64,...
```

---

### 3. Tích hợp trình phát `Hls.js` ở Frontend (Tránh lỗi CORS Range Preflight)

Các segment lưu trên `lh3.googleusercontent.com` có 128 byte đầu là header ảnh PNG giả (`#EXT-X-BYTERANGE:<len>@128`) và mở sẵn `Access-Control-Allow-Origin: *`. Tuy nhiên, để trình duyệt không gửi request `OPTIONS` preflight cho header `Range`, bạn chỉ cần cấu hình custom `fLoader` 15 dòng dưới đây cho `Hls.js` để tải bằng **Simple CORS GET** và cắt 128 byte đầu ngay trên RAM trình duyệt:

```javascript
const BaseLoader = Hls.DefaultConfig.loader;

class DirectGoogleCdnLoader extends BaseLoader {
  load(context, config, callbacks) {
    if (context.url && context.url.includes('googleusercontent.com')) {
      const start = typeof context.rangeStart === 'number' ? context.rangeStart : 128;
      const end = typeof context.rangeEnd === 'number' ? context.rangeEnd : undefined;
      // Xóa rangeStart/rangeEnd để trình duyệt không gửi header Range (tránh OPTIONS preflight)
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

// Khởi tạo Hls.js với playlist .m3u8 lấy từ Backend của bạn
const hls = new Hls({ fLoader: DirectGoogleCdnLoader });
hls.loadSource('/api/playlist/115975.m3u8'); // Hoặc truyền trực tiếp Blob URL / Data URI
hls.attachMedia(document.getElementById('video'));
```

---

### 4. Cách lấy link `/player/<id>` từ trang tập phim AnimeVietSub

Trên trang xem phim (`https://animevietsub.bid/phim/<slug>/tap-XX-<episodeId>.html`):
- **Cách 1 (Không cần gọi AJAX):** Đọc biến inline `window.PLAYER_DATA.link` ngay trong mã HTML của trang tập phim.
- **Cách 2 (Qua API `/ajax/player`):**
  1. Gửi `POST https://animevietsub.bid/ajax/player` với body `episodeId=<episodeId>&backup=1` để lấy danh sách nút server (`data-href`, `data-play`, `data-id`).
  2. Gửi `POST https://animevietsub.bid/ajax/player` với body `link=<data-href>&play=api&id=0&backuplinks=1` (Server `DU`) để nhận JSON `{ "link": "https://stream.googleapiscdn.com/player/<id>", "playTech": "iframe" }`.

Chi tiết đầy đủ về các endpoint khác của trang được ghi chú trong [API_SPEC.md](./API_SPEC.md).
