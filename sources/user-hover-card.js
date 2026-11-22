/**
 * User hover-card popup — replaces direct navigation on avatar/name clicks
 * with a compact profile preview. Modifier-key clicks pass through to browser.
 *
 * Architecture:
 *   - Client cache: Map<uid, {data, fetchedAt}> with 5min TTL
 *   - In-flight dedup: Map<uid, Promise> shared across concurrent clicks
 *   - Fetch via GET /ajax/user-card?uid=X (Redis-cached server-side 60s)
 *   - Desktop: floating card positioned near click point, auto-flip near edges
 *   - Mobile (<768px): bottom sheet with slide-up animation + backdrop
 */
(function () {
    'use strict';

    var CACHE_TTL_MS = 5 * 60 * 1000; // 5 min client cache
    var SELECTORS = 'a.avs-username, a.avs-author, a.avs-avatar-link, a.avs-tag, a.upp-mention, a.fc-avatar-chip';
    var ENDPOINT = '/ajax/user-card';

    var cache = new Map();      // uid -> { data, fetchedAt }
    var inFlight = new Map();   // uid -> Promise

    var $popup = null;          // jQuery popup element (created lazily)
    var $backdrop = null;
    var currentUid = null;
    var isMobile = function () { return window.innerWidth < 768; };

    function escHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Whitelist FA icon class — defense in depth (server already validates)
    function safeIcon(icon) {
        return /^fa-[a-z0-9-]+$/.test(icon) ? icon : '';
    }

    // Whitelist color — hex or rgb/rgba
    function safeColor(color) {
        return /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9,.\s]+\))$/.test(color) ? color : '#888';
    }

    function getCached(uid) {
        var hit = cache.get(uid);
        if (!hit) return null;
        if (Date.now() - hit.fetchedAt > CACHE_TTL_MS) {
            cache.delete(uid);
            return null;
        }
        return hit.data;
    }

    function fetchUserCard(uid) {
        // 1. Memory cache
        var cached = getCached(uid);
        if (cached) return Promise.resolve(cached);

        // 2. In-flight dedup
        if (inFlight.has(uid)) return inFlight.get(uid);

        // 3. Network fetch — use then(cleanup, cleanup) pattern instead of .finally
        //    for compatibility with older Promise polyfills that lack ES2018 .finally.
        var p = new Promise(function (resolve, reject) {
            jQuery.ajax({
                method: 'GET',
                url: ENDPOINT,
                data: { uid: uid },
                dataType: 'json',
                success: function (res) {
                    if (res && res.status === 1 && res.data) {
                        cache.set(uid, { data: res.data, fetchedAt: Date.now() });
                        resolve(res.data);
                    } else {
                        reject(new Error((res && res.error) || 'Không tải được thông tin'));
                    }
                },
                error: function () { reject(new Error('Lỗi kết nối')); }
            });
        });
        var cleanup = function () { inFlight.delete(uid); };
        p.then(cleanup, cleanup);

        inFlight.set(uid, p);
        return p;
    }

    function buildPopupDom() {
        var html = '' +
            '<div class="uhc-popup" id="uhc-popup">' +
                '<div class="uhc-banner"></div>' +
                '<button type="button" class="uhc-close" aria-label="Đóng">×</button>' +
                '<div class="uhc-avatar-wrap"><div class="uhc-avatar uhc-skeleton"></div></div>' +
                '<div class="uhc-body">' +
                    '<div class="uhc-name-row">' +
                        '<span class="uhc-name uhc-skeleton-text"></span>' +
                        '<span class="uhc-verified" style="display:none" title="Đã xác minh qua Google"><i class="fa fa-check-circle"></i></span>' +
                    '</div>' +
                    '<div class="uhc-handle uhc-skeleton-text-sm"></div>' +
                    '<div class="uhc-bio uhc-skeleton-text-block"></div>' +
                    '<div class="uhc-socials" style="display:none"></div>' +
                    '<div class="uhc-badges"></div>' +
                    '<div class="uhc-meta-row">' +
                        '<span class="uhc-joined"></span>' +
                        '<span class="uhc-gender" style="display:none"></span>' +
                    '</div>' +
                    '<a class="uhc-profile-btn" href="#"><i class="fa fa-user"></i> Xem hồ sơ</a>' +
                '</div>' +
            '</div>';
        $popup = jQuery(html);
        $backdrop = jQuery('<div class="uhc-backdrop"></div>');
        jQuery('body').append($backdrop).append($popup);

        $popup.on('click', '.uhc-close', closePopup);
        $popup.on('click', function (e) { e.stopPropagation(); });
        $backdrop.on('click', closePopup);
    }

    function showSkeleton() {
        $popup.find('.uhc-avatar').addClass('uhc-skeleton').empty();
        $popup.find('.uhc-name').addClass('uhc-skeleton-text').text('');
        $popup.find('.uhc-handle').addClass('uhc-skeleton-text-sm').text('');
        $popup.find('.uhc-bio').addClass('uhc-skeleton-text-block').text('');
        $popup.find('.uhc-verified').hide();
        $popup.find('.uhc-socials').hide().empty();
        $popup.find('.uhc-badges').empty();
        $popup.find('.uhc-joined').text('');
        $popup.find('.uhc-gender').hide().empty().removeAttr('data-code');
        $popup.find('.uhc-profile-btn').attr('href', '#');
        $popup.removeClass('uhc-error');
    }

    function renderData(data) {
        // Avatar — empty = user chưa đặt avatar → letter-circle fallback
        // (đồng bộ pattern với comment list / fan chips, tránh broken <img>)
        var $av = $popup.find('.uhc-avatar').removeClass('uhc-skeleton').empty();
        if (data.avatar) {
            $av.append(jQuery('<img>', { src: data.avatar, alt: data.fullname, loading: 'lazy' }));
        } else {
            var initial = (data.fullname || data.handle || '?').trim().charAt(0).toUpperCase();
            $av.append(jQuery('<span>', { 'class': 'uhc-avatar-fallback', text: initial }));
        }

        // Name (textContent-safe via .text())
        $popup.find('.uhc-name').removeClass('uhc-skeleton-text').text(data.fullname);

        // Verified
        if (data.is_verified) $popup.find('.uhc-verified').show();
        else $popup.find('.uhc-verified').hide();

        // Handle
        $popup.find('.uhc-handle').removeClass('uhc-skeleton-text-sm').text(data.handle ? '@' + data.handle : '');

        // Bio — server already htmlspecialchars'd, but use text() defense-in-depth
        var $bio = $popup.find('.uhc-bio').removeClass('uhc-skeleton-text-block').empty();
        if (data.bio) {
            // Server escaped HTML entities; decode then re-render via textContent to render escapes literally
            var tmp = document.createElement('textarea');
            tmp.innerHTML = data.bio;
            $bio.text(tmp.value).show();
        } else {
            $bio.hide();
        }

        // Socials — icon row có link. Server đã whitelist scheme http(s) cho url;
        // href set qua jQuery attr (an toàn). Discord không có url → span + tooltip.
        // brands=true → class `fab` (tiktok/threads không có trong FA v4-shim).
        var $soc = $popup.find('.uhc-socials').empty();
        if (data.socials && data.socials.length > 0) {
            var faOk = /^[a-z0-9-]+$/;
            data.socials.forEach(function (s) {
                if (!s || !faOk.test(s.fa || '')) return;
                var base = s.brands ? 'fab' : 'fa';
                var color = s.color === 'inherit' ? 'inherit' : safeColor(s.color);
                var $icon = jQuery('<i>').addClass(base + ' fa-' + s.fa);
                var el;
                if (s.url && /^https?:\/\//i.test(s.url)) {
                    el = jQuery('<a>', { 'class': 'uhc-social', href: s.url, target: '_blank', rel: 'noopener nofollow', title: s.label || '' });
                } else {
                    var lblDec = document.createElement('textarea');
                    lblDec.innerHTML = s.label || '';
                    el = jQuery('<span>', { 'class': 'uhc-social', title: lblDec.value });
                }
                el.css('color', color).append($icon);
                $soc.append(el);
            });
            if ($soc.children().length > 0) $soc.show();
        }

        // Badges — name was htmlspecialchars'd server-side; decode entities via
        // textarea trick so users see "<x>" not "&lt;x&gt;" (defense in depth
        // for the rare case an admin names a badge with HTML chars).
        var $badges = $popup.find('.uhc-badges').empty();
        if (data.badges && data.badges.length > 0) {
            var nameDecoder = document.createElement('textarea');
            data.badges.forEach(function (b) {
                var color = safeColor(b.color);
                var icon  = safeIcon(b.icon);
                nameDecoder.innerHTML = b.name || '';
                var $chip = jQuery('<span class="uhc-badge"></span>').css('background', color);
                if (icon) $chip.append('<i class="fa ' + icon + '"></i> ');
                $chip.append(document.createTextNode(nameDecoder.value));
                $badges.append($chip);
            });
            $badges.show();
        } else {
            $badges.hide();
        }

        // Joined
        $popup.find('.uhc-joined').text(data.joined ? 'Tham gia ' + data.joined : '');

        // Gender chip (hidden if not set on profile)
        var $gender = $popup.find('.uhc-gender');
        if (data.gender && data.gender.label) {
            var icon = safeIcon(data.gender.icon);
            var code = String(data.gender.code || '');
            $gender.attr('data-code', code).empty();
            if (icon) $gender.append('<i class="fa ' + icon + '"></i> ');
            $gender.append(document.createTextNode(data.gender.label));
            $gender.show();
        } else {
            $gender.hide();
        }

        // Profile button
        $popup.find('.uhc-profile-btn').attr('href', data.profile_url || ('/thanh-vien/' + currentUid + '/'));
    }

    function renderError(uid, message) {
        $popup.addClass('uhc-error');
        $popup.find('.uhc-avatar').removeClass('uhc-skeleton').empty().append('<i class="fa fa-user-circle"></i>');
        $popup.find('.uhc-name').removeClass('uhc-skeleton-text').text('Không tải được');
        $popup.find('.uhc-handle').removeClass('uhc-skeleton-text-sm').text('');
        $popup.find('.uhc-bio').removeClass('uhc-skeleton-text-block').text(message || 'Không tải được thông tin người dùng');
        $popup.find('.uhc-verified').hide();
        $popup.find('.uhc-badges').empty().hide();
        $popup.find('.uhc-joined').text('');
        $popup.find('.uhc-gender').hide().empty();
        $popup.find('.uhc-profile-btn').attr('href', '/thanh-vien/' + uid + '/');
    }

    function positionPopup(triggerEl) {
        if (isMobile()) {
            $popup.removeAttr('style');
            $popup.addClass('uhc-mobile').removeClass('uhc-desktop');
            $backdrop.addClass('uhc-backdrop-visible');
            return;
        }
        $popup.removeClass('uhc-mobile').addClass('uhc-desktop');
        $backdrop.removeClass('uhc-backdrop-visible');

        var rect = triggerEl.getBoundingClientRect();
        var popupW = 320;
        var popupH = $popup.outerHeight() || 380;
        var pad = 8;

        // Default: below + left-aligned
        var top = rect.bottom + window.scrollY + pad;
        var left = rect.left + window.scrollX;

        // Flip up if not enough space below
        if (rect.bottom + popupH + pad > window.innerHeight) {
            top = rect.top + window.scrollY - popupH - pad;
            if (top < window.scrollY + pad) top = window.scrollY + pad;
        }
        // Flip left if would overflow right edge
        if (left + popupW > window.innerWidth - pad) {
            left = window.innerWidth - popupW - pad + window.scrollX;
        }
        if (left < pad + window.scrollX) left = pad + window.scrollX;

        $popup.css({ top: top + 'px', left: left + 'px' });
    }

    function openPopup(uid, triggerEl) {
        if (!$popup) buildPopupDom();
        currentUid = uid;

        // Show skeleton immediately
        showSkeleton();
        $popup.addClass('uhc-visible');
        positionPopup(triggerEl);

        fetchUserCard(uid).then(function (data) {
            if (currentUid !== uid) return; // popup was closed/reopened
            renderData(data);
            // Re-position after content size changes (desktop only)
            if (!isMobile()) positionPopup(triggerEl);
        }).catch(function (err) {
            if (currentUid !== uid) return;
            renderError(uid, err && err.message);
        });
    }

    function closePopup() {
        if (!$popup) return;
        $popup.removeClass('uhc-visible');
        $backdrop.removeClass('uhc-backdrop-visible');
        currentUid = null;
    }

    function extractUid(el) {
        var direct = el.getAttribute('data-user-id');
        if (direct && /^\d+$/.test(direct)) return parseInt(direct, 10);
        var href = el.getAttribute('href') || '';
        var m = href.match(/\/thanh-vien\/(\d+)\//);
        if (m) return parseInt(m[1], 10);
        return 0;
    }

    // Delegated click handler — accept plain mouse left-click (which===1) and
    // keyboard activation via Enter (which===13). Modifier keys always pass
    // through to browser default (navigate to /thanh-vien/).
    jQuery(document).on('click', SELECTORS, function (e) {
        var isPlainLeftClick = (e.which === 1);
        var isEnterKey = (e.which === 13);
        if (!isPlainLeftClick && !isEnterKey) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var uid = extractUid(this);
        if (uid <= 0) return;
        e.preventDefault();
        openPopup(uid, this);
    });

    // Close on outside click (anywhere not the popup)
    jQuery(document).on('click', function (e) {
        if (!$popup || !$popup.hasClass('uhc-visible')) return;
        if (jQuery(e.target).closest('#uhc-popup').length) return;
        // Don't close if click was on a trigger element (delegated handler will reopen)
        if (jQuery(e.target).closest(SELECTORS).length) return;
        closePopup();
    });

    // ESC key
    jQuery(document).on('keydown', function (e) {
        if (e.key === 'Escape' && $popup && $popup.hasClass('uhc-visible')) closePopup();
    });

    // Reposition on resize (debounced)
    var resizeTimer = null;
    jQuery(window).on('resize', function () {
        if (!$popup || !$popup.hasClass('uhc-visible')) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(closePopup, 200); // simpler: close on resize
    });
})();
