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
├── Dockerfile                      # Multi-stage Docker build (Node build giao diện + Rust -> debian:bookworm-slim)
├── docker-compose.yml              # Cấu hình chạy container tự động khởi động lại
├── direct_m3u8_extractor.py        # Module giải mã viết bằng Python thuần
├── direct_cdn_playlist.m3u8        # File playlist mẫu đã giải mã hoàn chỉnh (311 segments Google CDN)
├── captured_scripts/               # Toàn bộ các gói JS gốc gom về 1 thư mục duy nhất
├── rust_extractor/                 # Dự án Rust hiệu năng cao (HTTP API Server, CLI & Library Crate)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                  # Lõi giải mã 2 lớp In-place (Zero-Regex, u32 index)
│       ├── main.rs                 # HTTP API Server đa luồng kèm bộ nhớ đệm TTL 30 phút & CLI
│       ├── http.rs                 # Đọc request có giới hạn (header 16 KiB, body 32 KiB) và ghi response
│       ├── store.rs                # Kho tài khoản SQLite (người dùng, phiên, phim đã lưu, tiến độ xem)
│       └── accounts.rs             # API tài khoản: Argon2id, cookie phiên, kiểm tra Origin, giới hạn tần suất
├── web/                            # Giao diện web (Next.js 16, xuất tĩnh ra web/out); engine Rust phục vụ trực tiếp
└── sources/                        # Mã nguồn JS client-side đã làm sạch
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

## Endpoint API Live (Docker trên Ubuntu)

API đã được triển khai qua Docker (`avs-direct-m3u8-api`, chỉ chiếm **~3.36 MB RAM**) và gắn SSL tự động qua Caddy tại **`https://cdn1.lvn123.site`**:

- **Tài liệu HDSD trực tuyến:** `https://cdn1.lvn123.site/hdsd`
- **Giao diện Web Console & Trình phát thử nghiệm:** `https://cdn1.lvn123.site/`
- **Healthcheck:** `GET https://cdn1.lvn123.site/health`
- **Trang chủ (Tách riêng 3 khối `latest`, `upcoming`, `featured` + giữ `items` tương thích ngược, kèm `genres` & `studio`):**
  `GET https://cdn1.lvn123.site/api/home`
- **Lịch chiếu phim trong tuần (Giờ chiếu tuyệt đối ISO-8601 `air_at`: `"2026-11-25T21:00:00+07:00"` + `countdown_seconds` tính theo thời gian thực không bị lệch bởi cache):**
  `GET https://cdn1.lvn123.site/api/schedule`
- **Danh sách phim sắp chiếu / Anime Lẻ (Movie) / Anime Bộ (Series):**
  - `GET https://cdn1.lvn123.site/api/upcoming?page=1`
  - `GET https://cdn1.lvn123.site/api/movies?page=1`
  - `GET https://cdn1.lvn123.site/api/series?page=1`
- **Danh sách Thể loại & Lọc theo Thể loại:**
  - `GET https://cdn1.lvn123.site/api/genres`
  - `GET https://cdn1.lvn123.site/api/genre?slug=hanh-dong&page=1`
- **Gợi ý tìm kiếm siêu tốc khi đang gõ (chỉ 1 request `/ajax/suggest`):**
  `GET https://cdn1.lvn123.site/api/suggest?q=black+clover`
- **Tìm kiếm phim đầy đủ có phân trang (chỉ 1 request `/tim-kiem/<q>/`):**
  `GET https://cdn1.lvn123.site/api/search?q=black+clover&page=1`
- **Thông tin chi tiết phim + Season (Phần 1/Phần 2/Movie/Special) + Danh sách Tập gọn nhẹ (trả `404` nếu sai `slug`):**
  `GET https://cdn1.lvn123.site/api/anime?slug=black-clover-2nd-season-a6073`
- **Proxy Ảnh Poster & Banner (Tự động rewrite trong mọi API để vượt Cloudflare Managed Challenge & lỗi `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`):**
  - `GET https://cdn1.lvn123.site/data/poster/animevsub-P0miGCR3CY.jpg`
  - `GET https://cdn1.lvn123.site/data/big_banner/animevsub-I4Edz2vXVI.jpg`
  - `GET https://cdn1.lvn123.site/api/image?url=https://cdn.animevietsub.bid/data/poster/animevsub-P0miGCR3CY.jpg`
- **Xuất trực tiếp file `.m3u8` (nhúng sẵn khóa AES-128 & các link `lh3.googleusercontent.com`, trả `404` nếu link tập không tồn tại):**
  `GET https://cdn1.lvn123.site/api/playlist.m3u8?url=https://animevietsub.bid/phim/black-clover-2nd-season-a6073/tap-01-115975.html`
- **Xuất JSON đầy đủ (`player_id`, `segment_count`, `m3u8`, `m3u8_data_uri`):**
  `GET https://cdn1.lvn123.site/api/extract?url=https://animevietsub.bid/phim/black-clover-2nd-season-a6073/tap-01-115975.html`

### Tên miền của trang nguồn (`AVS_PARENT_HOST`)

Trang nguồn đổi tên miền mỗi khi tên miền đang dùng bị chặn. Ngày 2026-11-23 `animevietsub.bid` ngừng trả lời từ mạng Việt Nam (đo trên VNPT và Viettel: kết nối nêu tên miền này không được hồi đáp, DNS của Viettel trả `127.0.0.1`), nên mọi endpoint danh mục của engine trả `502`; trang đã chuyển sang `animevietsub.zone`. Engine đọc tên miền từ biến môi trường, không cần build lại:

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `AVS_PARENT_HOST` | `animevietsub.zone` | Tên miền trang nguồn: mọi trang, `Referer` và tham số `fc` của playlist đều dùng nó |
| `AVS_CDN_HOST` | `cdn.<AVS_PARENT_HOST>` | Tên miền ảnh poster/banner mà `/data/**` và `/api/image` lấy về |

- `GET /health` trả `upstream_host` và `image_host` đang dùng.
- Link tập phim cũ (ví dụ `https://animevietsub.bid/phim/<slug>/tap-01-<id>.html`) vẫn dùng được: engine chỉ lấy phần đường dẫn rồi tải trang trên tên miền hiện tại.
- Khi trang lại đổi tên miền: xem link rút gọn trang tự công bố (`bit.ly/animevietsubtv`) chuyển tới đâu, sửa `AVS_PARENT_HOST` trong `docker-compose.yml`, rồi `docker compose up -d`.

---

## Giao diện web (Next.js xuất tĩnh, do engine Rust phục vụ)

Giao diện nằm ở `web/`: một ứng dụng Next.js 16 (pages router) được build một lần thành file tĩnh (`web/out`). Lúc chạy, máy chủ chỉ có **một tiến trình Rust**: engine vừa trả API vừa trả file của giao diện. Không có Node, Java, MongoDB hay Redis; tài khoản nằm trong một file SQLite do chính engine mở.

| Thành phần | Việc nó làm |
|---|---|
| `web/` | Trang chủ, danh sách và bộ lọc của hai nguồn phim, tìm kiếm có gợi ý khi đang gõ, lịch chiếu, chi tiết phim, trang xem, tài khoản, phim đã lưu, xem tiếp, đề xuất |
| Rust engine | Cào dữ liệu anime, giải mã `.m3u8`, proxy ảnh `/data/**`, API tài khoản, trả file tĩnh trong `WEB_ROOT` |

Trình duyệt gọi `/api/...` cùng origin cho anime và tài khoản. Ảnh poster/banner anime được tải thẳng từ URL `https://cdn1.lvn123.site/data/...` có sẵn trong JSON; segment video được tải thẳng từ `lh3.googleusercontent.com`.

### Hai nguồn phim

| Nguồn | Nội dung | Trình duyệt lấy dữ liệu từ đâu | Mã phim |
|---|---|---|---|
| AnimeVietSub | Anime bộ, anime lẻ, sắp chiếu, chủ đề, mùa, lịch chiếu | engine (`/api/...`) | slug gốc, ví dụ `black-clover-2nd-season-a6073` |
| KKPhim | Phim bộ, phim lẻ, hoạt hình, TV shows, thể loại, quốc gia | thẳng tới `https://phimapi.com` (API công khai, có CORS `*`) | `kk_<slug>`, ví dụ `kk_bok-soo-tro-ve` |

- Engine không proxy KKPhim: máy chủ không tốn băng thông hay CPU cho nguồn này, và không mở thêm đường gọi ra ngoài nào ở phía máy chủ. Gốc API đặt bằng `NEXT_PUBLIC_KK_API` lúc build.
- `web/lib/catalog.ts` là lớp chung: `getFilm`, `getCatalogPage`, `searchFilms`, `suggestFilms`, `getRelated`. Trang và component không gọi thẳng hai nguồn.
- Tập của KKPhim có slug `sv<số máy chủ>-<slug tập>` (ví dụ `/phim/kk_bok-soo-tro-ve/sv0-tap-01`); tập anime giữ slug gốc.

| Đường dẫn | Nội dung |
|---|---|
| `/phim-bo`, `/phim-le`, `/hoat-hinh`, `/tv-shows` | Danh sách KKPhim, lọc theo thể loại, quốc gia, năm, ngôn ngữ, sắp xếp (tham số nằm trên URL) |
| `/the-loai/<slug>`, `/quoc-gia/<slug>` | Thể loại và quốc gia của KKPhim |
| `/anime-bo`, `/anime-le`, `/sap-chieu`, `/chu-de`, `/chu-de/<slug>`, `/mua/<slug>`, `/lich-chieu` | Danh sách anime |
| `/tim-kiem?q=` | Kết quả của cả hai nguồn |
| `/phim/<mã phim>`, `/phim/<mã phim>/<tập>` | Chi tiết phim và trang xem |
| `/tai-khoan`, `/phim-da-luu`, `/xem-tiep` | Tài khoản, phim đã lưu, phim đang xem dở |

### Trình phát và bỏ đoạn quảng cáo

Trình phát là [ArtPlayer](https://artplayer.org) (giấy phép MIT) phát HLS bằng `hls.js`, giao diện tiếng Việt: lùi/tiến 10 giây, tập sau, tốc độ phát, hình trong hình, toàn màn hình, phím tắt (Space, ←, →, F, M), chạm hai lần để tua trên điện thoại, và nhớ vị trí đang xem.

- **Anime:** playlist lấy từ `/api/playlist.m3u8`; mỗi segment trên `googleusercontent.com` được tải nguyên file rồi cắt bỏ 128 byte đầu (không gửi header `Range`, nên không phát sinh preflight CORS).
- **KKPhim:** playlist tải thẳng từ máy chủ video của nguồn. Nguồn chèn quảng cáo vào giữa phim bằng các đoạn nằm giữa hai thẻ `#EXT-X-DISCONTINUITY` có segment ở thư mục khác thư mục của phim. `web/lib/adfilter.ts` (`stripAdBreaks`) bỏ các đoạn đó ngay khi `hls.js` nhận playlist, trước lúc phát:
  - thư mục chứa nhiều thời lượng nhất là thư mục của phim;
  - một đoạn bị bỏ khi mọi segment của nó nằm ngoài thư mục đó và đoạn dài không quá 2 phút;
  - nếu tổng phần định bỏ vượt 1/5 thời lượng thì giữ nguyên playlist (thà còn quảng cáo hơn là mất phim);
  - `#EXT-X-KEY` và `#EXT-X-MAP` đang có hiệu lực được ghi lại sau chỗ cắt.

  Trình phát báo "Đã bỏ qua m:ss quảng cáo". Kiểm thử: `cd web && node --test lib/adfilter.test.ts` (playlist mẫu thật nằm ở `web/lib/__fixtures__/`). Nếu nguồn đổi cách chèn (ví dụ đặt quảng cáo cùng thư mục với phim) thì đoạn quảng cáo sẽ không bị bỏ; lúc đó cần thêm playlist mẫu mới và sửa luật.

### Tài khoản, phim đã lưu, xem tiếp

Tài khoản do engine quản lý, lưu trong `DATA_DIR/accounts.db` (SQLite, chế độ WAL). Người dùng đăng ký bằng tên đăng nhập và mật khẩu, không cần e-mail; vì vậy không có luồng "quên mật khẩu" (đổi mật khẩu trong `/tai-khoan` khi còn đăng nhập).

| Endpoint | Việc nó làm |
|---|---|
| `POST /api/auth/register` `{username, password, display_name?}` | Tạo tài khoản và đăng nhập luôn |
| `POST /api/auth/login` `{username, password}` | Đăng nhập |
| `POST /api/auth/logout` | Xoá phiên hiện tại |
| `GET /api/auth/me` | Người dùng của phiên hiện tại (`401` nếu chưa đăng nhập) |
| `POST /api/auth/profile` `{display_name}` | Đổi tên hiển thị |
| `POST /api/auth/password` `{current_password, new_password}` | Đổi mật khẩu, xoá mọi phiên khác |
| `GET` / `PUT {film}` / `DELETE ?id=` `/api/me/favorites` | Phim đã lưu (tối đa 500 phim mỗi tài khoản) |
| `GET [?id=]` / `PUT {film, episode, position, duration}` / `DELETE ?id=` hoặc `DELETE ?all=1` `/api/me/progress` | Vị trí đang xem của từng tập (giữ 2000 mục mới nhất). `GET` không kèm `id` trả tập mới nhất của mỗi phim, tối đa 100 phim. `DELETE ?id=` xoá mọi tập của một phim; `DELETE ?all=1` xoá toàn bộ lịch sử của tài khoản |

- Mật khẩu được băm bằng Argon2id (19 MiB, 2 vòng) với muối ngẫu nhiên; chỉ một phép băm chạy tại một thời điểm để giới hạn RAM.
- Phiên là 32 byte ngẫu nhiên đặt trong cookie `avs_session` (`HttpOnly`, `SameSite=Lax`, `Secure` khi đi qua HTTPS, 30 ngày); cơ sở dữ liệu chỉ giữ SHA-256 của nó.
- Request `POST`/`PUT`/`DELETE` có header `Origin` khác `Host` bị từ chối (`403 forbidden_origin`); body phải là `application/json`. Response của các endpoint này không có header CORS và là `no-store`.
- Đăng ký và đăng nhập: tối đa 10 lần mỗi phút và 60 lần mỗi giờ cho một địa chỉ IP; sai mật khẩu 5 lần liên tiếp thì tên đăng nhập đó bị khoá 5 phút. Engine lấy IP của khách từ phần tử cuối của `X-Forwarded-For` khi kết nối đến từ mạng nội bộ (Caddy).
- Tên đăng nhập: 3-32 ký tự `A-Z a-z 0-9 _ . -`, không phân biệt hoa thường. Mật khẩu: 8-128 ký tự. Tên hiển thị: 1-40 ký tự.
- Khách chưa đăng nhập vẫn có "Xem tiếp": tiến độ nằm trong `localStorage` của trình duyệt và được chuyển lên tài khoản ở lần đăng nhập kế tiếp.
- Tải lại trang là xem tiếp đúng vị trí: trình phát ghi vị trí vào `localStorage` (`animora_live_progress`) mỗi giây và ngay lúc trang bị đóng hoặc tải lại; với tài khoản, vị trí còn được gửi lên máy chủ khi tạm dừng, khi rời trang (`keepalive`) và tối đa 10 giây một lần trong lúc phát. Lúc mở lại, `hls.js` bắt đầu tải thẳng từ vị trí đó.
- Xoá là xoá hẳn: nút × ở `/xem-tiep` xoá một phim, nút "Xóa tất cả lịch sử" xoá mọi vị trí đã lưu (kể cả những phim không hiện trong danh sách vì tập gần nhất đã xem xong hoặc mới xem dưới 30 giây); cả hai cũng xoá bản sao trong trình duyệt. Database chạy với `secure_delete`, và sau mỗi lần xoá lịch sử hay phim đã lưu engine gộp rồi cắt file WAL, nên nội dung đã xoá không còn nằm lại trong `accounts.db` hay `accounts.db-wal`. Database tạo bởi bản trước (schema 1) được `VACUUM` một lần khi engine mở nó.
- `GET /health` trả `account_store_open`. Không mở được cơ sở dữ liệu thì phần còn lại của engine vẫn chạy, riêng các endpoint tài khoản trả `503`.

**Sao lưu:** toàn bộ dữ liệu người dùng là volume `avs-accounts` (thư mục `/data` trong container). Mất volume là mất tài khoản.

### Đề xuất cho bạn

Khối "Đề xuất cho bạn" ở cuối trang chủ chạy hoàn toàn trong trình duyệt bằng luật, **không dùng mô hình AI nào**: mỗi thể loại của phim đã xem (trọng số 3) và phim đã lưu (trọng số 2) được cộng điểm, điểm giảm dần theo tuổi của lượt xem (còn một nửa sau 14 ngày); các thể loại điểm cao nhất thành các hàng "Vì bạn đã xem ..." và "Vì bạn thích ...", bỏ những phim đã xem, đã lưu hoặc đã hiện ở hàng trước. Người chưa có lịch sử thấy các hàng "Gợi ý hôm nay" theo danh sách thể loại xoay vòng mỗi ngày. Mã nằm ở `web/lib/recommend.ts`.

### Tên miền

Engine nghe ở cổng 8095; Caddy trên máy chủ gắn TLS cho `cdn1.lvn123.site` và `phim.lvn123.site` rồi chuyển tiếp về cổng đó. Để `phim.lvn123.site` chạy, DNS phải có bản ghi `CNAME phim -> cdn1.lvn123.site` (hoặc `A` tới IP máy chủ) ở chế độ DNS-only.

### Engine trả file của giao diện thế nào

Với mỗi đường dẫn không phải API, engine tìm trong `WEB_ROOT` theo thứ tự: đúng file đó, `<đường dẫn>.html`, `<đường dẫn>/index.html`, rồi tới các route động của Next (thư mục hoặc file tên `[tham số]`, ví dụ `/phim/abc/tap-01-1` trả `phim/[slug]/[tap].html`); không khớp thì trả `404.html` với mã 404.

- `/_next/static/**` là `immutable` 1 năm, file `.html` là `no-cache`, file tĩnh khác là 1 ngày.
- Các đường dẫn API giữ nguyên và được ưu tiên: `/api/**`, `/data/**`, `/health`, `/hdsd`. Trang thử API trước đây ở `/` nay ở `/console`.
- Không đặt `WEB_ROOT` (hoặc thư mục không có `index.html`) thì engine chỉ phục vụ API như trước.

### Phát triển giao diện

```bash
cd web
npm install
NEXT_PUBLIC_API_BASE=https://cdn1.lvn123.site npm run dev   # http://localhost:3000, gọi API thẳng tới engine (engine bật CORS)
```

### Build và chạy trên máy

```bash
cd web && npm ci && npm run build                 # tạo web/out
cd ../rust_extractor && cargo build --release
WEB_ROOT=../web/out ./target/release/avs_direct_m3u8 --serve 127.0.0.1:8095   # http://127.0.0.1:8095
```

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `WEB_ROOT` | không đặt (image Docker đặt `/app/web`) | Thư mục chứa bản xuất tĩnh của `web/` |
| `DATA_DIR` | `data` (image Docker đặt `/data`) | Thư mục chứa `accounts.db` |
| `NEXT_PUBLIC_API_BASE` | rỗng (cùng origin) | Chỉ dùng khi build/dev giao diện: gốc URL của engine |
| `NEXT_PUBLIC_KK_API` | `https://phimapi.com` | Chỉ dùng khi build giao diện: gốc API của KKPhim |

### Docker

```bash
docker compose up -d --build
```

Image build `web/` bằng Node (chỉ ở bước build), build engine bằng Rust; image chạy chỉ chứa binary và bản xuất tĩnh. `docker-compose.yml` gắn volume `avs-accounts` vào `/data` để tài khoản còn nguyên qua các lần build lại.

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
