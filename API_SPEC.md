# AnimeVietSub (`https://animevietsub.bid/`) — Extracted Client-Side API & Source Inventory

> **Scope & Provenance:** Extracted from shipped client-side JavaScript and passive/controlled browser observation via REA (`capture_browser_scenario`, `export_web_scripts`, `analyze_javascript_application`, `trace_application_feature`). Server-side backend code (PHP) is not accessible from client-side artifacts.

## 1. Evidence IDs & Extracted Artifacts

- **Homepage capture (`/`):** `ev_93dbd9529d2241e1e557a61f08d041d677a1616940579f1c8114b1ae93b66e52`
  - Script export: `ev_78149bb8c92518c7cfc472a52a16710f80af3d35c7168046e4ddd32e19755861` -> `d:\anime\animevietsub_scripts`
  - Static JS analysis: `ev_f822f1f33bfafec38c00dad358c159dfecdd4568e7bfc5b8789df59822a3609f`
- **Watch page capture (`/phim/black-clover-2nd-season-a6073/xem-phim.html`):** `ev_3edc07e11c15e7a3e7d8fc46324ff783dfe57daa04b3456430527452813becfb`
  - Script export: `ev_67173bc1278788200d135dfaab97488584b9148d6fcfb2be152bee601cf6129d` -> `d:\anime\animevietsub_watch_scripts`
  - Static JS analysis: `ev_03c4e7e511b4f855355b3ba1d60fd688f64670097e83987f7aa892acfb1af13f`
  - Feature trace (`/ajax/`): `ev_8e16af2bb03a220b0385559745d83d97ce73f3745996a71a032356ecac9765ed`
- **Large JS bundles (>64 KiB, captured via step DOM):** `d:\anime\animevietsub_extra_scripts`
  - Static JS analysis: `ev_4632620351b33d0d810c63e4ccc17fc7d57c47b65b6a1af82a5e99818edb2f33`
- **Cleanly organized API client sources:** `d:\anime\animevietsub_api\sources\`
- **Exported REA evidence bundle:** `d:\anime\animevietsub_api\rea_evidence.json`

## 2. Movie Player / Streaming API (`pl.watchbk2.js` + Watch HTML)

### 2.1 Embedded Watch Page State (No extra AJAX needed for initial load)
On `.../xem-phim.html` or `.../tap-XX-<episodeId>.html`, the server renders inline `<script>` blocks:
- `window.PLAYER_DATA`:
  ```json
  {
    "_fxStatus": 1,
    "success": 1,
    "title": "AnimeVsub",
    "link": "https://stream.googleapiscdn.com/player/<hex>?nextName=02&nextUrl=...",
    "playTech": "iframe",
    "img": "https://cdn.animevietsub.bid/data/banner/...",
    "episode_id": 115975
  }
  ```
- `window._epHash`: encrypted episode URL token (`Encryption->encode($EpisodeURL)`).
- `window._epID`: numeric episode ID (e.g. `115975`).
- `filmInfo`: `{ episodeID, filmID, filmVIEWED, playTech, isAdult, slug }`.
- Episode list items (`ul.list-episode li a.episode-link`): carry `data-id`, `data-play`, `data-source`, `data-hash`, and `href`.

### 2.2 Player AJAX Endpoints (`POST https://animevietsub.bid/ajax/player`)

| Operation | Source | Method & URL | Form Parameters | Observed / Client-Expected Response |
|---|---|---|---|---|
| Load backup server buttons | `pl.watchbk2.js` (`LoadLinksBackup`) | `POST /ajax/player` | `episodeId=<id>&backup=1` | JSON `{ success: 1, html: "<a class=\"btn3dsv\" data-id=\"0\" data-play=\"api\" data-href=\"...\">DU</a>..." }` |
| Select backup server | `pl.watchbk2.js` (`#links-backup a`) | `POST /ajax/player` | `link=<data-href>&play=<data-play>&id=<data-id>&backuplinks=1` | JSON `{ _fxStatus, success, title, link, playTech }` (for `DU` `id=0`, observed `playTech: "iframe"`, `link: "https://stream.googleapiscdn.com/player/..."`; clicking `HDX(ADS)` `id=3` rendered `<iframe src="https://abyssplayer.com/nJ2aZEsPe">`) |
| Switch episode / fallback load | `pl.watchbk2.js` (`AnimeVsub`) | `POST /ajax/player` | `link=<epHash>&id=<filmID>` | JSON `{ success, playTech, link }` (`playTech` in `"api" \| "all" \| "embed" \| "iframe"`) |
| Reload server list | `pl.watchbk2.js` (`#reload-list-server`) | `POST /ajax/player` | `filmLoadserver=1&filmId=<filmID>` | JSON `{ _fxStatus, ... }` |
| Episode notice message | `pl.watchbk2.js` (`PLTV.Player`) | `POST /ajax/all` | `EpisodeMess=1&EpisodeID=<episodeId>` | `0` or HTML notice string |

Also present in `pl.watchbk2.js`: `PLTV.output(h)` / `PLTV.decode(key)` for unscrambling `expire=` query parameters. Note that if `window.fx.token` is set, `fx_util.js` appends `_fxToken=<fx.token>` to jQuery AJAX URLs via `jQuery.ajaxSetup`.

### 2.3 Observed Limitations & Access Blocks for Non-Browser Usage
1. **Initial HTTP `403` JS redirect on `animevietsub.bid`:** In both the homepage and watch-page browser captures, the first `GET` request returned `HTTP 403` containing `<script>window.location.href = "/";</script>` plus Cloudflare Rocket Loader / beacon scripts before succeeding with `HTTP 200` on reload.
2. **Player returns third-party embed iframes, not raw video streams:** For episode `115975`, both `window.PLAYER_DATA` and `POST /ajax/player` (`DU`, `id=0`) returned `playTech: "iframe"` pointing to `https://stream.googleapiscdn.com/player/<hash>`, and `HDX(ADS)` (`id=3`) embedded `https://abyssplayer.com/<id>`.
3. **`stream.googleapiscdn.com` returned `HTTP 403` (`net::ERR_BLOCKED_BY_RESPONSE`):** Even inside the captured browser scenario, requests to `https://stream.googleapiscdn.com/player/...` failed with `403`, so raw `.m3u8`/`.mp4` media URLs from that downstream player host were not exposed and are gated.

## 3. Site & Community AJAX + WebSocket APIs

### 3.1 Catalog, Search, User & Film Interactions
- `POST /ajax/item` (`home-v1.js`): `widget=list-film&type=<tag>` — returns HTML list items for homepage tabs.
- `POST /ajax/suggest` (`home-v1.js`): `ajaxSearch=1&keysearch=<query>` — returns HTML `<li>` search suggestions.
- `GET /ajax/suggest` (`home-v1.js`): `Bookmark=true&filmId=<id>&type=add` — JSON `{ status }`.
- `GET /ajax/notification` (`home-v1.js`):
  - `notif=true` — observed JSON `{ status: 0, html: "Not login", total: 0 }` when unauthenticated.
  - `Bookmark=true&filmId=<id>` or `&type=add|remove` — check or toggle film bookmark.
- `POST /ajax/notification` (`home-v1.js`): `Delete=all` | `Delete=true&id=<id>` | `MarkRead=true&id=<id>`.
- `POST /ajax/like` (`pl.watchbk2.js`): `filmLike=1&filmID=<filmID>` — returns `1` (not logged in), `2` (unfollowed), `3` (followed).
- `GET /ajax/rate` (`film.rating.js`): `_fxAjax=1&_fxResponseType=json&score=<1-10>&film=<filmID>` — JSON `{ _fxStatus, _fxMessage, rateCount, ratePoint }`.
- `GET /ajax/film-fans` (`film.rating.js`): `film_id=<id>&page=<n>&size=20` — JSON `{ success, fans, has_more }`.
- `GET /ajax/user-card` (`user-hover-card.js`): `uid=<userId>` — JSON `{ status, data }` (profile card details).
- `POST /ajax/report-error` (`inline-report-error.js`): `film_id`, `episode_id`, `error_type`, `error_description` — JSON `{ success, message, error }`.

### 3.2 Comments, Activity & Centrifugo Realtime (`comment.js`, `recent-comments.js`, `inline-activity-home.js`, `centrifugo-shared.js`)
- `GET /ajax/comment`:
  - `action=token&_=<ts>` — refresh Centrifugo JWT `{ token }`.
  - `action=get&film_id=<id>&sort=<sort>&offset=<offset>[&page_url=<url>]&_=<ts>`
  - `action=get_replies&comment_id=<id>&sort=<sort>&offset=<offset>&_=<ts>`
  - `action=get_voters&comment_id=<id>&vote_type=<type>&page=<page>&_=<ts>`
  - `action=poll&film_id=<id>[&page_url=<url>]&last_id=<id>&_=<ts>`
  - `action=get_recent[&last_id=<id>]&_=<ts>`
  - `action=get_top_comments&_=<ts>`
  - `action=get_hot_films&_=<ts>`
  - `action=get_most_commented_films&_=<ts>`
  - `action=get_active_members&_=<ts>`
  - `action=get_most_liked_members&_=<ts>`
- `POST /ajax/comment`:
  - `action=post` (`film_id`, `episode_id`, `content`, `is_spoiler`, `thread_key`, `parent_id`)
  - `action=vote` (`comment_id`, `vote_type`)
  - `action=edit` (`comment_id`, `content`, `is_spoiler`)
  - `action=delete` (`comment_id`)
  - `action=report` (`comment_id`)
- **WebSocket (`wss://rt.animevietsub.bid/connection/websocket`):** Centrifugo v5 client using `window.AVS_CENTRIFUGO_CFG = { url, token }`, subscribing to channels `recent`, `film_<filmId>`, and `page_<md5>`.
