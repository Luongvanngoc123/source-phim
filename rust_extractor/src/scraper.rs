use crate::{parent_host, DEFAULT_UA};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static AVS_COOKIE: OnceLock<Mutex<String>> = OnceLock::new();

fn cookie_store() -> &'static Mutex<String> {
    AVS_COOKIE.get_or_init(|| Mutex::new(String::new()))
}

/// Absolute URL of `path` on the upstream site's current domain.
fn site_url(path: &str) -> String {
    format!("https://{}/{path}", parent_host())
}

fn update_cookies_from_headers(set_cookies: &[&str]) {
    if set_cookies.is_empty() {
        return;
    }
    let mut store = cookie_store().lock().unwrap();
    let mut map: Vec<(String, String)> = store
        .split("; ")
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();

    for sc in set_cookies {
        if let Some(first_part) = sc.split(';').next() {
            if let Some((k, v)) = first_part.split_once('=') {
                let key = k.trim().to_string();
                let val = v.trim().to_string();
                if let Some(existing) = map.iter_mut().find(|(ek, _)| ek == &key) {
                    existing.1 = val;
                } else {
                    map.push((key, val));
                }
            }
        }
    }

    *store = map
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ");
}

/// Fetch any page or AJAX endpoint of the upstream site, automatically handling the
/// initial HTTP 403 cookie challenge (`Set-Cookie` + retry).
pub fn fetch_avs_html(url: &str, post_form: Option<&str>) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new().user_agent(DEFAULT_UA).build();

    for _attempt in 0..2 {
        let current_cookie = cookie_store().lock().unwrap().clone();
        let mut req = if post_form.is_some() {
            agent
                .post(url)
                .set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                .set("X-Requested-With", "XMLHttpRequest")
        } else {
            agent.get(url)
        };
        req = req.set("Referer", &site_url(""));
        if !current_cookie.is_empty() {
            req = req.set("Cookie", &current_cookie);
        }

        let res = if let Some(body) = post_form {
            req.send_string(body)
        } else {
            req.call()
        };

        match res {
            Ok(resp) => {
                let sc = resp.all("Set-Cookie");
                if !sc.is_empty() {
                    update_cookies_from_headers(&sc);
                }
                let final_url = resp.get_url().to_string();
                let text = resp
                    .into_string()
                    .map_err(|e| format!("Failed reading response body: {e}"))?;
                if text.len() < 1500 && text.contains("window.location.href") {
                    continue;
                }
                if final_url.contains("/404/") {
                    return Err(format!("NOT_FOUND: Resource not found ({url})"));
                }
                return Ok(text);
            }
            Err(ureq::Error::Status(403, resp)) => {
                let sc = resp.all("Set-Cookie");
                update_cookies_from_headers(&sc);
                continue;
            }
            Err(ureq::Error::Status(404, _)) => {
                return Err(format!("NOT_FOUND: HTTP 404 for {url}"));
            }
            Err(e) => return Err(format!("HTTP error for {url}: {e}")),
        }
    }

    Err(format!("Failed to bypass 403 challenge for {url}"))
}

pub fn extract_between<'a>(haystack: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
    let start = haystack.find(prefix)? + prefix.len();
    let rest = &haystack[start..];
    let end = rest.find(suffix)?;
    Some(&rest[..end])
}

pub fn extract_attr<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let pat_dq = format!("{attr}=\"");
    if let Some(val) = extract_between(tag, &pat_dq, "\"") {
        return Some(val);
    }
    let pat_sq = format!("{attr}='");
    extract_between(tag, &pat_sq, "'")
}

pub fn clean_html_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let replaced = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&#39;", "'")
        .replace("&#39s", "'s")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">");
    replaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn extract_slug_from_url(url: &str) -> String {
    if let Some(pos) = url.find("/phim/") {
        let rest = &url[pos + 6..];
        let slug = rest.split('/').next().unwrap_or(rest);
        return slug.trim_end_matches(".html").to_string();
    }
    url.trim_matches('/').to_string()
}

pub fn extract_film_id_from_slug(slug: &str) -> Option<String> {
    if let Some(pos) = slug.rfind("-a") {
        let digits = &slug[pos + 2..];
        if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
            return Some(digits.to_string());
        }
    }
    None
}

/// Rewrite the site's `https://cdn.<site domain>/data/...` image URLs to go through our
/// Direct-CDN Image Proxy (`https://cdn1.lvn123.site/data/...`) so browsers on any
/// origin and clients behind Cloudflare WARP never hit Cloudflare challenge or
/// `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`.
pub fn proxy_image_url(raw_url: &str) -> String {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let base = std::env::var("PUBLIC_CDN_ORIGIN")
        .unwrap_or_else(|_| "https://cdn1.lvn123.site".to_string());
    let base = base.trim_end_matches('/');
    if let Some(pos) = trimmed.find("/data/") {
        return format!("{base}{}", &trimmed[pos..]);
    }
    trimmed.to_string()
}

/// Match only `<li class="TPostMv">` list items (avoids matching `<div class="TPostMv">` in top owl-carousel).
pub fn parse_tpost_list(html: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut cursor = html;

    while let Some(pos) = cursor.find("<li class=\"TPostMv\"") {
        let after = &cursor[pos..];
        let end_pos = after.find("</li>").unwrap_or(after.len());
        let block = &after[..end_pos];
        cursor = &after[end_pos..];

        let url = extract_between(block, "<a href=\"", "\"")
            .unwrap_or_default()
            .to_string();
        if url.is_empty() {
            continue;
        }
        let slug = extract_slug_from_url(&url);
        let film_id = extract_film_id_from_slug(&slug)
            .or_else(|| extract_between(block, "id=\"post-", "\"").map(|s| s.to_string()));

        let title = extract_between(block, "<h2 class=\"Title\">", "</h2>")
            .map(clean_html_text)
            .unwrap_or_default();

        let poster = extract_between(block, "<img ", ">")
            .and_then(|img_tag| extract_attr(img_tag, "src"))
            .map(proxy_image_url)
            .unwrap_or_default();

        let episode_badge = extract_between(block, "<span class=\"mli-eps\">", "</span>")
            .map(clean_html_text);

        let schedule_badge = if let Some(ts_pos) = block.find("class=\"mli-timeschedule\"") {
            let sub = &block[ts_pos..];
            extract_between(sub, ">", "</span>").map(clean_html_text)
        } else {
            None
        };

        let countdown_seconds = if let Some(ts_pos) = block.find("class=\"mli-timeschedule\"") {
            let sub = &block[ts_pos..];
            let tag_end = sub.find('>').unwrap_or(sub.len());
            extract_attr(&sub[..tag_end], "data-timer_second")
                .and_then(|s| s.parse::<i64>().ok())
        } else {
            None
        };

        let air_time_or_year_badge = extract_between(block, "<span class=\"b\">", "</span>")
            .map(clean_html_text);

        let rating = extract_between(block, "class=\"Vote AAIco-star\">", "</span>")
            .map(clean_html_text)
            .or_else(|| {
                extract_between(block, "class=\"fa fa-star\"></i>", "</div>").map(clean_html_text)
            });

        let quality = extract_between(block, "<span class=\"Qlty\">", "</span>")
            .map(clean_html_text);

        let progress = extract_between(block, "class=\"Time AAIco-access_time\">", "</span>")
            .map(clean_html_text);

        let year = extract_between(block, "class=\"Date AAIco-date_range\">", "</span>")
            .map(clean_html_text);

        let views_or_sub = extract_between(block, "<span class=\"Year\">", "</span>")
            .map(clean_html_text);

        let description = extract_between(block, "<div class=\"Description\">", "</div>")
            .and_then(|d| extract_between(d, "<p>", "</p>"))
            .map(clean_html_text);

        // Homepage uses `class="Studio AAIco-videocam"`, catalog/schedule uses `class="Director AAIco-videocam"`
        let studio = extract_between(block, "class=\"Studio", "</p>")
            .or_else(|| extract_between(block, "class=\"Director", "</p>"))
            .and_then(|d| d.find('>').map(|i| &d[i + 1..]))
            .map(clean_html_text)
            .map(|s| {
                s.trim_start_matches("Studio:")
                    .trim_start_matches("Đạo diễn:")
                    .trim()
                    .to_string()
            })
            .filter(|s| !s.is_empty());

        let mut genres = Vec::new();
        if let Some(g_block) = extract_between(block, "class=\"Genre", "</p>") {
            let mut g_cur = g_block;
            while let Some(a_pos) = g_cur.find("<a ") {
                let a_sub = &g_cur[a_pos..];
                let a_end = a_sub.find("</a>").unwrap_or(a_sub.len());
                let a_tag = &a_sub[..a_end];
                if let Some(href) = extract_attr(a_tag, "href") {
                    let g_name = a_tag.split('>').nth(1).unwrap_or_default();
                    let g_slug = href
                        .trim_end_matches('/')
                        .rsplit('/')
                        .next()
                        .unwrap_or_default();
                    let name_clean = clean_html_text(g_name);
                    if !name_clean.is_empty() {
                        genres.push(json!({
                            "name": name_clean,
                            "slug": g_slug
                        }));
                    }
                }
                g_cur = &a_sub[a_end..];
            }
        }

        items.push(json!({
            "title": title,
            "slug": slug,
            "film_id": film_id,
            "url": url,
            "poster": poster,
            "episode_badge": episode_badge,
            "schedule_badge": schedule_badge,
            "countdown_seconds": countdown_seconds,
            "air_time": air_time_or_year_badge,
            "rating": rating,
            "quality": quality,
            "progress": progress,
            "year": year,
            "views_or_subtitle": views_or_sub,
            "description": description,
            "studio": studio,
            "genres": genres,
            "detail_api": format!("/api/anime?slug={slug}")
        }));
    }

    items
}
fn extract_total_pages(html: &str) -> Option<u32> {
    if let Some(start) = html.find("<span class=\"pages\">") {
        let text_start = start + "<span class=\"pages\">".len();
        if let Some(end) = html[text_start..].find("</span>") {
            let text = &html[text_start..text_start + end];
            if let Some(of_pos) = text.find("của") {
                let digits: String = text[of_pos + "của".len()..]
                    .chars()
                    .skip_while(|ch| !ch.is_ascii_digit())
                    .take_while(|ch| ch.is_ascii_digit())
                    .collect();
                if let Ok(total) = digits.parse::<u32>() {
                    if total > 0 {
                        return Some(total);
                    }
                }
            }
        }
    }

    let mut max_page: Option<u32> = None;
    let mut cursor = html;
    while let Some(marker) = cursor.find("trang-") {
        let after = &cursor[marker + "trang-".len()..];
        let digits = after
            .bytes()
            .take_while(u8::is_ascii_digit)
            .count();
        if digits > 0 {
            if let Ok(page) = after[..digits].parse::<u32>() {
                if page > 0 {
                    max_page = Some(max_page.map_or(page, |current| current.max(page)));
                }
            }
        }
        cursor = &after[digits..];
    }
    max_page
}

/// Fetch homepage (`/`) separated into `latest` (Mới cập nhật), `upcoming` (Sắp chiếu),
/// `featured` (Đề cử), plus combined `items` for backward compatibility.
pub fn fetch_home_page(page: u32) -> Result<Value, String> {
    if page > 1 {
        return fetch_catalog_list("anime-moi", page);
    }
    let html = fetch_avs_html(&site_url(""), None)?;

    let mut sections: Vec<Vec<Value>> = Vec::new();
    let mut cursor = html.as_str();
    while let Some(pos) = cursor.find("<ul class=\"MovieList Rows") {
        let after = &cursor[pos..];
        let end_pos = after.find("</ul>").unwrap_or(after.len());
        let ul_block = &after[..end_pos];
        cursor = &after[end_pos..];
        let parsed = parse_tpost_list(ul_block);
        if !parsed.is_empty() {
            sections.push(parsed);
        }
    }

    let latest = sections.first().cloned().unwrap_or_default();
    let upcoming = sections.get(1).cloned().unwrap_or_default();
    let featured = sections.get(2).cloned().unwrap_or_default();

    let mut all_items = Vec::with_capacity(latest.len() + upcoming.len() + featured.len());
    all_items.extend(latest.iter().cloned());
    all_items.extend(upcoming.iter().cloned());
    all_items.extend(featured.iter().cloned());

    Ok(json!({
        "success": true,
        "path": "",
        "page": 1,
        "latest_count": latest.len(),
        "upcoming_count": upcoming.len(),
        "featured_count": featured.len(),
        "count": all_items.len(),
        "latest": latest,
        "upcoming": upcoming,
        "featured": featured,
        "items": all_items
    }))
}

fn current_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn is_leap_year(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = y - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era as i64) * 146097 + (doe as i64) - 719468
}

fn civil_year_month_from_unix_vn(unix_secs: i64) -> (i32, u32) {
    let vn_secs = unix_secs + 7 * 3600;
    let z = vn_secs.div_euclid(86400) + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i32) + (era as i32) * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m)
}

/// Extract `(day, month)` from `"Thứ Tư , Ngày 25 tháng 11"`.
fn parse_day_month_vn(day_header: &str) -> Option<(u32, u32)> {
    let lower = day_header.to_lowercase();
    let ngay_pos = lower.find("ngày")?;
    let after_ngay = &lower[ngay_pos + "ngày".len()..];
    let mut nums = after_ngay
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<u32>().ok());
    let d = nums.next()?;
    let m = nums.next()?;
    if (1..=31).contains(&d) && (1..=12).contains(&m) {
        Some((d, m))
    } else {
        None
    }
}

/// Extract `(hour, minute)` from `"21 giờ 00 phút"` or `"15 giờ 30"`.
fn parse_hour_min_vn(air_time: &str) -> Option<(u32, u32)> {
    let mut nums = air_time
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<u32>().ok());
    let h = nums.next()?;
    let m = nums.next().unwrap_or(0);
    if h <= 23 && m <= 59 {
        Some((h, m))
    } else {
        None
    }
}

fn format_countdown_badge(secs: i64) -> String {
    if secs <= 0 {
        return "Đã chiếu".to_string();
    }
    let d = secs / 86400;
    let h = (secs % 86400) / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if d > 0 {
        format!("{d}d {h}h {m}m {s}s")
    } else if h > 0 {
        format!("{h}h {m}m {s}s")
    } else {
        format!("{m}m {s}s")
    }
}

/// Parse `/lich-chieu-phim.html` grouped by broadcast day & time, attaching exact
/// ISO-8601 `air_at` (`2026-11-25T21:00:00+07:00`) and `air_at_unix`.
pub fn fetch_schedule() -> Result<Value, String> {
    let html = fetch_avs_html(&site_url("lich-chieu-phim.html"), None)?;
    let now_unix = current_unix_secs();
    let (cur_year, cur_month) = civil_year_month_from_unix_vn(now_unix);

    let mut days = Vec::new();
    let mut cursor = html.as_str();

    while let Some(pos) = cursor.find("class=\"Homeschedule\"") {
        let after = &cursor[pos..];
        let end_pos = after.find("</section>").unwrap_or(after.len());
        let sec = &after[..end_pos];
        cursor = &after[end_pos..];

        let day_title = extract_between(sec, "<h1>", "</h1>")
            .map(clean_html_text)
            .unwrap_or_default();

        let dm = parse_day_month_vn(&day_title);
        let mut air_date_str = None;
        let mut resolved_ymd = None;

        if let Some((d, m)) = dm {
            let mut y = cur_year;
            if cur_month == 12 && m == 1 {
                y += 1;
            } else if cur_month == 1 && m == 12 {
                y -= 1;
            }
            let max_d = match m {
                2 => if is_leap_year(y) { 29 } else { 28 },
                4 | 6 | 9 | 11 => 30,
                _ => 31,
            };
            let d_valid = d.min(max_d);
            air_date_str = Some(format!("{y:04}-{m:02}-{d_valid:02}"));
            resolved_ymd = Some((y, m, d_valid));
        }

        let mut items = parse_tpost_list(sec);
        for item in &mut items {
            if let Some(obj) = item.as_object_mut() {
                let mut computed_unix: Option<i64> = None;
                let mut computed_iso: Option<String> = None;

                if let (Some((y, m, d)), Some(air_t)) = (
                    resolved_ymd,
                    obj.get("air_time").and_then(|v| v.as_str()),
                ) {
                    if let Some((hh, mm)) = parse_hour_min_vn(air_t) {
                        let days_since_epoch = days_from_civil(y, m, d);
                        let utc_secs =
                            days_since_epoch * 86400 + (hh as i64) * 3600 + (mm as i64) * 60 - 7 * 3600;
                        computed_unix = Some(utc_secs);
                        computed_iso = Some(format!(
                            "{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:00+07:00"
                        ));
                    }
                }

                if computed_unix.is_none() {
                    if let Some(cd) = obj.get("countdown_seconds").and_then(|v| v.as_i64()) {
                        computed_unix = Some(now_unix + cd);
                    }
                }

                if let Some(u_ts) = computed_unix {
                    let live_cd = (u_ts - now_unix).max(0);
                    obj.insert("air_at_unix".to_string(), json!(u_ts));
                    obj.insert("countdown_seconds".to_string(), json!(live_cd));
                    obj.insert(
                        "schedule_badge".to_string(),
                        json!(format_countdown_badge(live_cd)),
                    );
                }
                if let Some(iso) = computed_iso {
                    obj.insert("air_at".to_string(), json!(iso));
                }
                if let Some(ref d_str) = air_date_str {
                    obj.insert("air_date".to_string(), json!(d_str));
                }
            }
        }

        days.push(json!({
            "day": day_title,
            "date": air_date_str,
            "count": items.len(),
            "items": items
        }));
    }

    Ok(json!({
        "success": true,
        "generated_at_unix": now_unix,
        "day_count": days.len(),
        "schedule": days
    }))
}

/// Refresh `countdown_seconds` and `schedule_badge` on a cached schedule JSON using current wall-clock time
/// so cached responses never have 5-minute countdown drift.
pub fn refresh_cached_schedule_countdowns(cached_json: &str) -> String {
    let Ok(mut root) = serde_json::from_str::<Value>(cached_json) else {
        return cached_json.to_string();
    };
    let now_unix = current_unix_secs();
    if let Some(root_obj) = root.as_object_mut() {
        root_obj.insert("server_time_unix".to_string(), json!(now_unix));
        if let Some(days) = root_obj.get_mut("schedule").and_then(|v| v.as_array_mut()) {
            for day in days {
                if let Some(items) = day.get_mut("items").and_then(|v| v.as_array_mut()) {
                    for item in items {
                        if let Some(obj) = item.as_object_mut() {
                            if let Some(air_unix) = obj.get("air_at_unix").and_then(|v| v.as_i64()) {
                                let live_cd = (air_unix - now_unix).max(0);
                                obj.insert("countdown_seconds".to_string(), json!(live_cd));
                                obj.insert(
                                    "schedule_badge".to_string(),
                                    json!(format_countdown_badge(live_cd)),
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    root.to_string()
}

/// Fetch catalog page (`/anime-sap-chieu/`, `/anime-le/`, `/anime-bo/`, `/the-loai/<slug>/`, etc.).
pub fn fetch_catalog_list(path: &str, page: u32) -> Result<Value, String> {
    let clean_path = path.trim_matches('/');
    let url = if clean_path.is_empty() {
        site_url("")
    } else if page > 1 {
        site_url(&format!("{clean_path}/trang-{page}.html"))
    } else {
        site_url(&format!("{clean_path}/"))
    };

    let html = fetch_avs_html(&url, None)?;
    let items = parse_tpost_list(&html);
    Ok(json!({
        "success": true,
        "path": clean_path,
        "page": page,
        "total_pages": extract_total_pages(&html),
        "count": items.len(),
        "items": items
    }))
}

/// Extract all genres and seasons from the homepage navigation.
pub fn fetch_genres_and_seasons() -> Result<Value, String> {
    let html = fetch_avs_html(&site_url(""), None)?;
    let mut genres = Vec::new();
    let mut seen_genres = HashSet::new();
    let mut seasons = Vec::new();
    let mut seen_seasons = HashSet::new();

    let mut cur = html.as_str();
    while let Some(pos) = cur.find("<a ") {
        let sub = &cur[pos..];
        let end = sub.find("</a>").unwrap_or(sub.len());
        let a_tag = &sub[..end];
        cur = &sub[end..];

        if let Some(href) = extract_attr(a_tag, "href") {
            let label = a_tag.split('>').nth(1).map(clean_html_text).unwrap_or_default();
            if label.is_empty() {
                continue;
            }
            if let Some(g_pos) = href.find("/the-loai/") {
                let slug = href[g_pos + 10..].trim_matches('/').to_string();
                if !slug.is_empty() && seen_genres.insert(slug.clone()) {
                    genres.push(json!({
                        "name": label,
                        "slug": slug,
                        "api_url": format!("/api/genre?slug={slug}&page=1")
                    }));
                }
            } else if let Some(s_pos) = href.find("/season/") {
                let slug = href[s_pos + 8..].trim_matches('/').to_string();
                if !slug.is_empty() && seen_seasons.insert(slug.clone()) {
                    seasons.push(json!({
                        "name": label,
                        "slug": slug,
                        "api_url": format!("/api/catalog?path=season/{slug}&page=1")
                    }));
                }
            }
        }
    }

    Ok(json!({
        "success": true,
        "categories": [
            { "name": "Anime Bộ (TV Series)", "path": "anime-bo", "api_url": "/api/series?page=1" },
            { "name": "Anime Lẻ (Movie / OVA)", "path": "anime-le", "api_url": "/api/movies?page=1" },
            { "name": "Anime Sắp Chiếu", "path": "anime-sap-chieu", "api_url": "/api/upcoming?page=1" },
            { "name": "Lịch Chiếu Phim", "path": "lich-chieu-phim.html", "api_url": "/api/schedule" }
        ],
        "genre_count": genres.len(),
        "genres": genres,
        "season_count": seasons.len(),
        "seasons": seasons
    }))
}

fn encode_search_keyword(q_trimmed: &str) -> String {
    q_trimmed
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.') {
                (b as char).to_string()
            } else if b == b' ' {
                "+".to_string()
            } else {
                format!("%{:02X}", b)
            }
        })
        .collect::<String>()
}

/// Fast autocomplete suggestions (`POST /ajax/suggest` only — single lightweight upstream request).
pub fn suggest_anime(query: &str) -> Result<Value, String> {
    let q_trimmed = query.trim();
    if q_trimmed.is_empty() {
        return Err("BAD_REQUEST: Missing search query parameter `q`".into());
    }
    let encoded_q = encode_search_keyword(q_trimmed);
    let form = format!("ajaxSearch=1&keysearch={encoded_q}");
    let sug_html = fetch_avs_html(&site_url("ajax/suggest"), Some(&form))?;

    let mut items = Vec::new();
    let mut cur = sug_html.as_str();
    while let Some(li_pos) = cur.find("<li>") {
        let sub = &cur[li_pos..];
        let end = sub.find("</li>").unwrap_or(sub.len());
        let block = &sub[..end];
        cur = &sub[end..];

        let href = extract_between(block, "href=\"", "\"").unwrap_or_default();
        let slug = extract_slug_from_url(href);
        let poster = extract_between(block, "url('", "')")
            .or_else(|| extract_between(block, "url(\"", "\")"))
            .map(proxy_image_url)
            .unwrap_or_default();
        let title = extract_between(block, "class=\"ss-title\">", "</a>")
            .map(clean_html_text)
            .unwrap_or_default();
        let episode_note = extract_between(block, "<p>", "</p>").map(clean_html_text);

        if !title.is_empty() {
            items.push(json!({
                "title": title,
                "slug": slug,
                "url": href,
                "poster": poster,
                "episode_note": episode_note,
                "detail_api": format!("/api/anime?slug={slug}")
            }));
        }
    }

    Ok(json!({
        "success": true,
        "query": q_trimmed,
        "count": items.len(),
        "items": items
    }))
}

/// Full search page (`GET /tim-kiem/<q>/` only — 1 single upstream request).
pub fn search_anime(query: &str, page: u32) -> Result<Value, String> {
    let q_trimmed = query.trim();
    if q_trimmed.is_empty() {
        return Err("BAD_REQUEST: Missing search query parameter `q`".into());
    }
    let encoded_q = encode_search_keyword(q_trimmed);

    let search_url = if page > 1 {
        site_url(&format!("tim-kiem/{encoded_q}/trang-{page}.html"))
    } else {
        site_url(&format!("tim-kiem/{encoded_q}/"))
    };

    let html = fetch_avs_html(&search_url, None)?;
    let items = parse_tpost_list(&html);

    Ok(json!({
        "success": true,
        "query": q_trimmed,
        "page": page,
        "total_pages": extract_total_pages(&html),
        "count": items.len(),
        "items": items
    }))
}

/// Fetch full anime details, poster, big banner, seasons (SS1/SS2/Movie/Special),
/// metadata attributes, and compact episode list (`episode`, `title`, `episode_id`, `source`, `watch_url`).
pub fn fetch_anime_detail(slug_or_url: &str) -> Result<Value, String> {
    let slug = extract_slug_from_url(slug_or_url);
    if slug.is_empty() {
        return Err("BAD_REQUEST: Missing anime `slug` or `url`".into());
    }
    let info_url = site_url(&format!("phim/{slug}/"));
    let info_html = fetch_avs_html(&info_url, None)?;

    let Some(single_pos) = info_html.find("class=\"TPost Single\"") else {
        return Err(format!("NOT_FOUND: Không tìm thấy phim với slug '{slug}'"));
    };
    let single_block = &info_html[single_pos..];

    let title = extract_between(single_block, "<h1 class=\"Title\">", "</h1>")
        .map(clean_html_text)
        .unwrap_or_default();
    if title.is_empty() {
        return Err(format!("NOT_FOUND: Không tìm thấy phim với slug '{slug}'"));
    }

    let watch_url = site_url(&format!("phim/{slug}/xem-phim.html"));
    let watch_html = fetch_avs_html(&watch_url, None).unwrap_or_default();

    let sub_title = extract_between(single_block, "<h2 class=\"SubTitle\">", "</h2>")
        .map(clean_html_text);
    let poster = extract_between(single_block, "<figure class=\"Objf\">", "</figure>")
        .and_then(|f| extract_between(f, "<img ", ">"))
        .and_then(|img| extract_attr(img, "src"))
        .map(proxy_image_url)
        .unwrap_or_default();
    let banner = extract_between(single_block, "class=\"TPostBg Objf\">", "</div>")
        .and_then(|b| extract_between(b, "<img ", ">"))
        .and_then(|img| extract_attr(img, "src"))
        .map(proxy_image_url)
        .unwrap_or_default();
    let description = extract_between(single_block, "<div class=\"Description\">", "</div>")
        .map(clean_html_text)
        .unwrap_or_default();

    let rating = extract_between(single_block, "id=\"average_score\">", "</strong>")
        .map(clean_html_text);
    let rating_count = extract_between(single_block, "class=\"num-rating\">", "</strong>")
        .map(clean_html_text);
    let views = extract_between(single_block, "class=\"View AAIco-remove_red_eye\">", "</span>")
        .map(clean_html_text);

    // Parse Seasons / Related Parts (SS1, SS2, Movie, Special, OVA)
    let mut seasons = Vec::new();
    if let Some(s_block) = extract_between(single_block, "<div class=\"season_item\">", "</div>") {
        let mut s_cur = s_block;
        while let Some(a_pos) = s_cur.find("<a ") {
            let sub = &s_cur[a_pos..];
            let end = sub.find("</a>").unwrap_or(sub.len());
            let a_tag = &sub[..end];
            s_cur = &sub[end..];

            let href = extract_attr(a_tag, "href").unwrap_or_default();
            let s_slug = extract_slug_from_url(href);
            let s_title = extract_attr(a_tag, "title").map(clean_html_text);
            let is_active = a_tag.contains("active");
            let label = a_tag.split('>').nth(1).map(clean_html_text).unwrap_or_default();

            let part_type = if label.to_lowercase().contains("movie") {
                "movie"
            } else if label.to_lowercase().contains("special") || label.to_lowercase().contains("ova") {
                "special"
            } else {
                "series"
            };

            seasons.push(json!({
                "name": label,
                "title": s_title,
                "slug": s_slug,
                "type": part_type,
                "active": is_active,
                "url": href,
                "detail_api": format!("/api/anime?slug={s_slug}")
            }));
        }
    }

    // Parse MvTb-Info attributes
    let mut schedule_text = None;
    let mut status_text = None;
    let mut director = None;
    let mut country = None;
    let mut followers = None;
    let mut duration = None;
    let mut quality = None;
    let mut age_rating = None;
    let mut language = None;
    let mut studio = None;
    let mut season_release = None;
    let mut genres = Vec::new();
    let mut film_type = "series".to_string();

    if let Some(info_tab) = extract_between(single_block, "id=\"MvTb-Info\">", "<div class=\"MvTbCn") {
        let mut l_cur = info_tab;
        while let Some(li_pos) = l_cur.find("<li") {
            let sub = &l_cur[li_pos..];
            let end = sub.find("</li>").unwrap_or(sub.len());
            let li_block = &sub[..end];
            l_cur = &sub[end..];

            let text_clean = clean_html_text(li_block);
            if text_clean.starts_with("Lịch chiếu:") {
                schedule_text = Some(text_clean.trim_start_matches("Lịch chiếu:").trim().to_string());
            } else if text_clean.starts_with("Trạng thái:") {
                status_text = Some(text_clean.trim_start_matches("Trạng thái:").trim().to_string());
            } else if text_clean.starts_with("Đạo diễn:") {
                director = Some(text_clean.trim_start_matches("Đạo diễn:").trim().to_string());
            } else if text_clean.starts_with("Quốc gia:") {
                country = Some(text_clean.trim_start_matches("Quốc gia:").trim_end_matches(',').trim().to_string());
            } else if text_clean.starts_with("Số người theo dõi:") {
                followers = Some(text_clean.trim_start_matches("Số người theo dõi:").trim().to_string());
            } else if text_clean.starts_with("Thời lượng:") {
                duration = Some(text_clean.trim_start_matches("Thời lượng:").trim().to_string());
            } else if text_clean.starts_with("Chất lượng:") {
                quality = Some(text_clean.trim_start_matches("Chất lượng:").trim().to_string());
            } else if text_clean.starts_with("Rating:") {
                age_rating = Some(text_clean.trim_start_matches("Rating:").trim().to_string());
            } else if text_clean.starts_with("Ngôn ngữ:") {
                language = Some(text_clean.trim_start_matches("Ngôn ngữ:").trim().to_string());
            } else if text_clean.starts_with("Studio:") {
                studio = Some(text_clean.trim_start_matches("Studio:").trim().to_string());
            } else if text_clean.starts_with("Season:") {
                season_release = Some(text_clean.trim_start_matches("Season:").trim().to_string());
            } else if text_clean.starts_with("Thể loại:") {
                if li_block.contains("/anime-le/") {
                    film_type = "movie".to_string();
                }
                let mut g_cur = li_block;
                while let Some(a_pos) = g_cur.find("<a ") {
                    let a_sub = &g_cur[a_pos..];
                    let a_end = a_sub.find("</a>").unwrap_or(a_sub.len());
                    let a_tag = &a_sub[..a_end];
                    g_cur = &a_sub[a_end..];
                    if let Some(href) = extract_attr(a_tag, "href") {
                        let g_name = a_tag.split('>').nth(1).map(clean_html_text).unwrap_or_default();
                        let g_slug = href.trim_end_matches('/').rsplit('/').next().unwrap_or_default();
                        if !g_name.is_empty() {
                            genres.push(json!({ "name": g_name, "slug": g_slug }));
                        }
                    }
                }
            }
        }
    }

    // Parse compact Episodes from watch_html (omits bulky `hash`, `playlist_m3u8`, `extract_api` so 1200+ ep anime stay <200KB)
    let mut episodes = Vec::new();
    let mut e_cur = watch_html.as_str();
    while let Some(a_pos) = e_cur.find("<a ") {
        let sub = &e_cur[a_pos..];
        let end = sub.find("</a>").unwrap_or(sub.len());
        let a_tag = &sub[..end];
        e_cur = &sub[end..];

        if !a_tag.contains("episode-link") {
            continue;
        }
        let ep_id = extract_attr(a_tag, "data-id").unwrap_or_default();
        let ep_title = extract_attr(a_tag, "title").unwrap_or_default();
        let ep_href = extract_attr(a_tag, "href").unwrap_or_default();
        let ep_source = extract_attr(a_tag, "data-source").unwrap_or_default();
        let ep_num = a_tag.split('>').nth(1).map(clean_html_text).unwrap_or_default();

        if !ep_href.is_empty() {
            episodes.push(json!({
                "episode": ep_num,
                "title": ep_title,
                "episode_id": ep_id,
                "source": ep_source,
                "watch_url": ep_href
            }));
        }
    }

    let initial_player_url = if let Some(pos) = watch_html.find("stream.googleapiscdn.com") {
        let start = watch_html[..pos].rfind("https:").unwrap_or(pos);
        let slice = &watch_html[start..];
        let end = slice
            .find(|c: char| matches!(c, '"' | '\'' | '<' | '>' | ' ' | '\n' | '\r'))
            .unwrap_or(slice.len());
        Some(slice[..end].replace("\\/", "/"))
    } else {
        None
    };

    Ok(json!({
        "success": true,
        "slug": slug,
        "film_id": extract_film_id_from_slug(&slug),
        "type": film_type,
        "title": title,
        "sub_title": sub_title,
        "poster": poster,
        "banner": banner,
        "description": description,
        "rating": rating,
        "rating_count": rating_count,
        "views": views,
        "schedule": schedule_text,
        "status": status_text,
        "duration": duration,
        "quality": quality,
        "age_rating": age_rating,
        "language": language,
        "studio": studio,
        "director": director,
        "country": country,
        "season_release": season_release,
        "followers": followers,
        "genres": genres,
        "seasons": seasons,
        "episode_count": episodes.len(),
        "initial_player_url": initial_player_url,
        "episodes": episodes
    }))
}

#[cfg(test)]
mod tests {
    use super::extract_total_pages;

    #[test]
    fn extracts_pages_from_wp_pagenavi_pages_text() {
        let fixture = r#"<div class='wp-pagenavi'><span class="pages">Trang 1 của 156</span><span class="current" title="Trang 1">1</span><a class="page larger" title="Trang 2" href="https://animevietsub.zone/anime-bo/trang-2.html" data="2">2</a><a class="page larger" title="Trang Cuối" href="https://animevietsub.zone/anime-bo/trang-156.html" data="156">Trang Cuối</a></div>"#;
        assert_eq!(extract_total_pages(fixture), Some(156));
    }

    #[test]
    fn falls_back_to_last_page_link() {
        let fixture = r#"<div class='wp-pagenavi'><a href="/anime-bo/trang-2.html">2</a><a href="/anime-bo/trang-17.html">17</a></div>"#;
        assert_eq!(extract_total_pages(fixture), Some(17));
        assert_eq!(extract_total_pages("<ul class='rows'></ul>"), None);
    }
}
