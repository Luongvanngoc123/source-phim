use crate::{DEFAULT_UA, PARENT_HOST};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

static AVS_COOKIE: OnceLock<Mutex<String>> = OnceLock::new();

fn cookie_store() -> &'static Mutex<String> {
    AVS_COOKIE.get_or_init(|| Mutex::new(String::new()))
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

/// Fetch any `animevietsub.bid` page or AJAX endpoint, automatically handling the
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
        req = req.set("Referer", &format!("https://{PARENT_HOST}/"));
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
                let text = resp
                    .into_string()
                    .map_err(|e| format!("Failed reading response body: {e}"))?;
                if text.len() < 1500 && text.contains("window.location.href") {
                    continue;
                }
                return Ok(text);
            }
            Err(ureq::Error::Status(403, resp)) => {
                let sc = resp.all("Set-Cookie");
                update_cookies_from_headers(&sc);
                continue;
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

/// Parse all `<li class="TPostMv">...</li>` cards in a page.
pub fn parse_tpost_list(html: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut cursor = html;

    while let Some(pos) = cursor.find("class=\"TPostMv\"") {
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
            .unwrap_or_default()
            .to_string();

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
                .and_then(|s| s.parse::<u64>().ok())
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

        let studio = extract_between(block, "class=\"Director", "</p>")
            .and_then(|d| d.find('>').map(|i| &d[i + 1..]))
            .map(clean_html_text)
            .map(|s| {
                s.trim_start_matches("Studio:")
                    .trim_start_matches("Đạo diễn:")
                    .trim()
                    .to_string()
            });

        let mut genres = Vec::new();
        if let Some(g_block) = extract_between(block, "class=\"Genre", "</p>") {
            let mut g_cur = g_block;
            while let Some(a_pos) = g_cur.find("<a ") {
                let a_sub = &g_cur[a_pos..];
                let a_end = a_sub.find("</a>").unwrap_or(a_sub.len());
                let a_tag = &a_sub[..a_end];
                if let Some(href) = extract_attr(a_tag, "href") {
                    let g_name = extract_between(a_tag, ">", "")
                        .unwrap_or_else(|| a_tag.split('>').nth(1).unwrap_or_default());
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

/// Parse `/lich-chieu-phim.html` grouped by broadcast day & time.
pub fn fetch_schedule() -> Result<Value, String> {
    let html = fetch_avs_html(&format!("https://{PARENT_HOST}/lich-chieu-phim.html"), None)?;
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
        let items = parse_tpost_list(sec);
        days.push(json!({
            "day": day_title,
            "count": items.len(),
            "items": items
        }));
    }

    Ok(json!({
        "success": true,
        "day_count": days.len(),
        "schedule": days
    }))
}

/// Fetch catalog page (`/anime-sap-chieu/`, `/anime-le/`, `/anime-bo/`, `/the-loai/<slug>/`, etc.).
pub fn fetch_catalog_list(path: &str, page: u32) -> Result<Value, String> {
    let clean_path = path.trim_matches('/');
    let url = if clean_path.is_empty() {
        format!("https://{PARENT_HOST}/")
    } else if page > 1 {
        format!("https://{PARENT_HOST}/{clean_path}/trang-{page}.html")
    } else {
        format!("https://{PARENT_HOST}/{clean_path}/")
    };

    let html = fetch_avs_html(&url, None)?;
    let items = parse_tpost_list(&html);
    Ok(json!({
        "success": true,
        "path": clean_path,
        "page": page,
        "count": items.len(),
        "items": items
    }))
}

/// Extract all genres and seasons from the homepage navigation.
pub fn fetch_genres_and_seasons() -> Result<Value, String> {
    let html = fetch_avs_html(&format!("https://{PARENT_HOST}/"), None)?;
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

/// Search anime by keyword (combines full search cards + quick AJAX suggest).
pub fn search_anime(query: &str, page: u32) -> Result<Value, String> {
    let q_trimmed = query.trim();
    if q_trimmed.is_empty() {
        return Err("Missing search query parameter `q`".into());
    }
    let encoded_q = q_trimmed
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
        .collect::<String>();

    let search_url = if page > 1 {
        format!("https://{PARENT_HOST}/tim-kiem/{encoded_q}/trang-{page}.html")
    } else {
        format!("https://{PARENT_HOST}/tim-kiem/{encoded_q}/")
    };

    let html = fetch_avs_html(&search_url, None)?;
    let items = parse_tpost_list(&html);

    // Also fetch quick suggest on page 1
    let mut suggestions = Vec::new();
    if page == 1 {
        let form = format!("ajaxSearch=1&keysearch={encoded_q}");
        if let Ok(sug_html) = fetch_avs_html(&format!("https://{PARENT_HOST}/ajax/suggest"), Some(&form)) {
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
                    .unwrap_or_default();
                let title = extract_between(block, "class=\"ss-title\">", "</a>")
                    .map(clean_html_text)
                    .unwrap_or_default();
                let episode_note = extract_between(block, "<p>", "</p>").map(clean_html_text);

                if !title.is_empty() {
                    suggestions.push(json!({
                        "title": title,
                        "slug": slug,
                        "url": href,
                        "poster": poster,
                        "episode_note": episode_note,
                        "detail_api": format!("/api/anime?slug={slug}")
                    }));
                }
            }
        }
    }

    Ok(json!({
        "success": true,
        "query": q_trimmed,
        "page": page,
        "count": items.len(),
        "items": items,
        "quick_suggestions": suggestions
    }))
}

/// Fetch full anime details, poster, big banner, seasons (SS1/SS2/Movie/Special),
/// metadata attributes, and complete episode list with direct `.m3u8` stream links.
pub fn fetch_anime_detail(slug_or_url: &str) -> Result<Value, String> {
    let slug = extract_slug_from_url(slug_or_url);
    if slug.is_empty() {
        return Err("Missing anime `slug` or `url`".into());
    }
    let info_url = format!("https://{PARENT_HOST}/phim/{slug}/");
    let watch_url = format!("https://{PARENT_HOST}/phim/{slug}/xem-phim.html");

    let info_html = fetch_avs_html(&info_url, None)?;
    let watch_html = fetch_avs_html(&watch_url, None).unwrap_or_default();

    let single_block = if let Some(pos) = info_html.find("class=\"TPost Single\"") {
        &info_html[pos..]
    } else {
        info_html.as_str()
    };

    let title = extract_between(single_block, "<h1 class=\"Title\">", "</h1>")
        .map(clean_html_text)
        .unwrap_or_default();
    let sub_title = extract_between(single_block, "<h2 class=\"SubTitle\">", "</h2>")
        .map(clean_html_text);
    let poster = extract_between(single_block, "<figure class=\"Objf\">", "</figure>")
        .and_then(|f| extract_between(f, "<img ", ">"))
        .and_then(|img| extract_attr(img, "src"))
        .unwrap_or_default()
        .to_string();
    let banner = extract_between(single_block, "class=\"TPostBg Objf\">", "</div>")
        .and_then(|b| extract_between(b, "<img ", ">"))
        .and_then(|img| extract_attr(img, "src"))
        .unwrap_or_default()
        .to_string();
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

    // Parse Episodes from watch_html
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
        let ep_hash = extract_attr(a_tag, "data-hash").unwrap_or_default();
        let ep_num = a_tag.split('>').nth(1).map(clean_html_text).unwrap_or_default();

        if !ep_href.is_empty() {
            episodes.push(json!({
                "episode": ep_num,
                "title": ep_title,
                "episode_id": ep_id,
                "source": ep_source,
                "hash": ep_hash,
                "watch_url": ep_href,
                "playlist_m3u8": format!("/api/playlist.m3u8?url={ep_href}"),
                "extract_api": format!("/api/extract?url={ep_href}")
            }));
        }
    }

    // Extract current initial player link from watch_html if available
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
