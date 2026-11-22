/* Recent Comments Widget — sidebar polling module with carousel */
(function ($) {
    'use strict';

    var POLL_INTERVAL = 60000; // Increased from 30s to 60s for TV performance
    var AJAX_URL_RECENT = '/ajax/comment?action=get_recent';
    var AJAX_URL_TOP = '/ajax/comment?action=get_top_comments';
    var MAX_CONTENT_LEN = 100;
    var CAROUSEL_AUTO_INTERVAL = 0; // Disable auto-slide (0 = manual only)
    var ITEMS_PER_SLIDE = 5; // Show 5 comments per slide

    var $widgetRecent = null;
    var $widgetTop = null;
    var lastMaxId = 0;
    var pollTimer = null;
    var prevIds = [];
    var activeTab = 'recent';
    var topLoaded = false;

    // Carousel state
    var carouselState = {
        recent: { currentIndex: 0, autoTimer: null, isPaused: false, isTransitioning: false },
        top: { currentIndex: 0, autoTimer: null, isPaused: false, isTransitioning: false }
    };

    function escHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function timeAgo(ts) {
        var diff = Math.floor(Date.now() / 1000) - parseInt(ts, 10);
        if (diff < 0) diff = 0;
        if (diff < 60) return diff + ' giây trước';
        if (diff < 3600) return Math.floor(diff / 60) + ' phút trước';
        if (diff < 86400) return Math.floor(diff / 3600) + ' giờ trước';
        if (diff < 2592000) return Math.floor(diff / 86400) + ' ngày trước';
        if (diff < 31536000) return Math.floor(diff / 2592000) + ' tháng trước';
        return Math.floor(diff / 31536000) + ' năm trước';
    }

    function decodeEntities(s) {
        if (!s) return '';
        return $('<textarea>').html(s).text();
    }

    function safeUsernameText(str) {
        return escHtml(decodeEntities(str));
    }

    function truncate(s, max) {
        if (!s) return '';
        s = decodeEntities(s);
        // Chỉ bỏ tag thật, giữ nguyên text <script>...</script>
        s = s.replace(/\[sticker:[^\]]+\]/g, '');
        s = s.trim();
        if (s.length > max) return s.substring(0, max) + '…';
        return s;
    }

    function extractStickerUrls(s) {
        if (!s) return [];
        s = decodeEntities(s);
        var urls = [];
        var re = /\[sticker:(https?:\/\/[^\]]+)\]/g;
        var m;
        while ((m = re.exec(s)) !== null) { urls.push(m[1]); }
        return urls;
    }

    function sanitizeHttpUrl(url) {
        var raw = String(url || '').trim();
        if (!raw) return '';
        if (!/^https?:\/\//i.test(raw)) return '';
        if (/^(javascript|data|vbscript|file):/i.test(raw)) return '';
        return raw;
    }

    function sanitizeLinkHref(url) {
        var raw = String(url || '').trim();
        if (!raw) return '#';
        // Ưu tiên link nội bộ dạng /path
        if (raw.charAt(0) === '/') return raw;
        // Cho phép tuyệt đối http/https nếu cần
        var safe = sanitizeHttpUrl(raw);
        return safe || '#';
    }

    function avatarHtml(url, name) {
        var safeUrl = sanitizeHttpUrl(url);
        if (safeUrl) {
            return '<img src="' + escHtml(safeUrl) + '" alt="' + escHtml(name) + '" class="rc-avatar-img" loading="lazy">';
        }
        return '<span class="rc-avatar-letter">' + escHtml((name || '?').charAt(0).toUpperCase()) + '</span>';
    }

    function renderComment(c, showVotes, rank) {
        var isReply = parseInt(c.parent_id, 10) > 0;
        var content = '';
        if (parseInt(c.is_spoiler, 10) === 1) {
            content = '<em class="rc-carousel-spoiler">[Spoiler]</em>';
        } else {
            var textPart = escHtml(truncate(c.content, MAX_CONTENT_LEN));
            // Mention marker `@[id:name]` → <span class="rc-mention">@name</span> (styled but
            // không phải <a> vì card đã là outer <a> wrap; nested anchor sẽ phá layout).
            textPart = textPart.replace(/@\[(\d+):([^\]]+)\]/g, '<span class="rc-mention">@$2</span>');
            var stickerUrls = extractStickerUrls(c.content);
            var stickerHtml = '';
            for (var si = 0; si < stickerUrls.length; si++) {
                var safeSticker = sanitizeHttpUrl(stickerUrls[si]);
                if (!safeSticker) continue;
                stickerHtml += '<br><img class="rc-carousel-sticker" src="' + escHtml(safeSticker) + '" alt="sticker" loading="lazy">';
            }
            content = textPart + stickerHtml;
        }

        var filmLabel = '';
        var labelText = c.film_name || c.page_label || '';
        if (labelText) {
            filmLabel = '<span class="rc-carousel-film" title="' + escHtml(labelText) + '">' + escHtml(labelText) + '</span>';
        }

        var replyIcon = isReply ? '<i class="fa fa-reply rc-carousel-reply-icon" title="Trả lời"></i>' : '';

        var votesHtml = '';
        if (showVotes && parseInt(c.votes_up, 10) > 0) {
            votesHtml = '<span class="rc-carousel-votes"><i class="fa fa-thumbs-up"></i>' + c.votes_up + '</span>';
        }

        var rankMedal = '';
        if (showVotes && rank) {
            var medals = {1: '🥇', 2: '🥈', 3: '🥉'};
            if (rank <= 3) rankMedal = '<span class="rc-carousel-rank">' + medals[rank] + '</span>';
        }

        var url = escHtml(sanitizeLinkHref(c.comment_url));
        var username = safeUsernameText(c.user_fullname || c.user_name || 'Ẩn danh');
        var timeStr = timeAgo(c.created_at);

        return '<a href="' + url + '" class="rc-carousel-item" data-cid="' + c.id + '">' +
            '<div class="rc-carousel-meta">' +
                '<div class="rc-carousel-avatar">' + avatarHtml(c.user_avatar, c.user_name) + '</div>' +
                '<div class="rc-carousel-user-info">' +
                    '<div class="rc-carousel-username">' + rankMedal + username + '</div>' +
                    '<div class="rc-carousel-time">' + replyIcon + timeStr + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="rc-carousel-content">' + content + '</div>' +
            '<div class="rc-carousel-footer">' +
                filmLabel +
                votesHtml +
            '</div>' +
        '</a>';
    }

    function createCarouselHTML(comments, showVotes) {
        if (!comments || comments.length === 0) {
            return '<div class="rc-empty">Chưa có bình luận nào</div>';
        }

        var slides = [];
        for (var i = 0; i < comments.length; i += ITEMS_PER_SLIDE) {
            var slideComments = comments.slice(i, i + ITEMS_PER_SLIDE);
            var slideHTML = '<div class="rc-carousel-slide">';
            slideComments.forEach(function(c, idx) {
                var rank = showVotes ? (i + idx + 1) : 0;
                slideHTML += renderComment(c, showVotes, rank);
            });
            slideHTML += '</div>';
            slides.push(slideHTML);
        }

        var html = '<div class="rc-carousel-container">';

        // Navigation buttons (positioned in container with padding)
        if (slides.length > 1) {
            html += '<div class="rc-carousel-nav rc-carousel-nav-prev" data-dir="prev"><i class="fa fa-chevron-left"></i></div>';
            html += '<div class="rc-carousel-nav rc-carousel-nav-next" data-dir="next"><i class="fa fa-chevron-right"></i></div>';
        }

        // Slides wrapper
        html += '<div class="rc-carousel-wrapper-outer">';
        html += '<div class="rc-carousel-wrapper">' + slides.join('') + '</div>';
        html += '</div>'; // Close wrapper-outer

        html += '</div>'; // Close container

        // Dots indicator
        if (slides.length > 1) {
            html += '<div class="rc-carousel-dots">';
            for (var i = 0; i < slides.length; i++) {
                html += '<div class="rc-carousel-dot" data-index="' + i + '"></div>';
            }
            html += '</div>';
        }

        return html;
    }

    function updateCarouselPosition(tab) {
        var state = carouselState[tab];
        var $widget = (tab === 'recent') ? $widgetRecent : $widgetTop;
        var $wrapper = $widget.find('.rc-carousel-wrapper');
        var $slides = $wrapper.find('.rc-carousel-slide');
        var totalSlides = $slides.length;

        if (totalSlides === 0) return;

        // Set transitioning flag
        state.isTransitioning = true;

        // Update transform
        var offset = -state.currentIndex * 100;
        $wrapper.css('transform', 'translateX(' + offset + '%)');

        // Update dots
        $widget.find('.rc-carousel-dot').removeClass('active');
        $widget.find('.rc-carousel-dot[data-index="' + state.currentIndex + '"]').addClass('active');

        // Update nav buttons
        $widget.find('.rc-carousel-nav-prev').toggleClass('disabled', state.currentIndex === 0);
        $widget.find('.rc-carousel-nav-next').toggleClass('disabled', state.currentIndex === totalSlides - 1);

        // Clear transitioning flag after animation completes
        setTimeout(function() {
            state.isTransitioning = false;
        }, 400); // Match CSS transition duration
    }

    function goToSlide(tab, index) {
        var state = carouselState[tab];

        // Prevent navigation during transition
        if (state.isTransitioning) return;

        var $widget = (tab === 'recent') ? $widgetRecent : $widgetTop;
        var totalSlides = $widget.find('.rc-carousel-slide').length;

        if (index < 0 || index >= totalSlides) return;

        state.currentIndex = index;
        updateCarouselPosition(tab);
        resetAutoSlide(tab);
    }

    function nextSlide(tab) {
        var state = carouselState[tab];

        // Prevent navigation during transition
        if (state.isTransitioning) return;

        var $widget = (tab === 'recent') ? $widgetRecent : $widgetTop;
        var totalSlides = $widget.find('.rc-carousel-slide').length;

        if (state.currentIndex < totalSlides - 1) {
            goToSlide(tab, state.currentIndex + 1);
        } else {
            // Loop back to first slide
            goToSlide(tab, 0);
        }
    }

    function prevSlide(tab) {
        var state = carouselState[tab];

        // Prevent navigation during transition
        if (state.isTransitioning) return;

        if (state.currentIndex > 0) {
            goToSlide(tab, state.currentIndex - 1);
        }
    }

    function startAutoSlide(tab) {
        var state = carouselState[tab];
        stopAutoSlide(tab);

        // Only start if CAROUSEL_AUTO_INTERVAL > 0 and not paused
        if (CAROUSEL_AUTO_INTERVAL > 0 && !state.isPaused) {
            state.autoTimer = setInterval(function() {
                nextSlide(tab);
            }, CAROUSEL_AUTO_INTERVAL);
        }
    }

    function stopAutoSlide(tab) {
        var state = carouselState[tab];
        if (state.autoTimer) {
            clearInterval(state.autoTimer);
            state.autoTimer = null;
        }
    }

    function resetAutoSlide(tab) {
        stopAutoSlide(tab);
        startAutoSlide(tab);
    }

    function bindCarouselEvents(tab) {
        var $widget = (tab === 'recent') ? $widgetRecent : $widgetTop;

        // Navigation buttons
        $widget.off('click', '.rc-carousel-nav').on('click', '.rc-carousel-nav', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var dir = $(this).data('dir');
            if (dir === 'next') nextSlide(tab);
            else if (dir === 'prev') prevSlide(tab);
        });

        // Dots
        $widget.off('click', '.rc-carousel-dot').on('click', '.rc-carousel-dot', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var index = parseInt($(this).data('index'), 10);
            goToSlide(tab, index);
        });

        // Pause on hover
        $widget.off('mouseenter mouseleave', '.rc-carousel-container')
            .on('mouseenter', '.rc-carousel-container', function() {
                carouselState[tab].isPaused = true;
                stopAutoSlide(tab);
            })
            .on('mouseleave', '.rc-carousel-container', function() {
                carouselState[tab].isPaused = false;
                startAutoSlide(tab);
            });
    }

    function renderAll($target, comments, animate, showVotes) {
        var tab = ($target.attr('id') === 'recentCommentsWidget') ? 'recent' : 'top';

        // Stop auto-slide before re-rendering
        stopAutoSlide(tab);

        // Reset carousel state
        carouselState[tab].currentIndex = 0;
        carouselState[tab].isPaused = false;
        carouselState[tab].isTransitioning = false;

        // Render carousel HTML
        var html = createCarouselHTML(comments, showVotes);
        $target.html(html);

        // Initialize carousel if there are slides
        if (comments && comments.length > 0) {
            // Set first dot as active
            $target.find('.rc-carousel-dot').first().addClass('active');

            // Bind events
            bindCarouselEvents(tab);

            // Start auto-slide (only if CAROUSEL_AUTO_INTERVAL > 0)
            if (CAROUSEL_AUTO_INTERVAL > 0) {
                startAutoSlide(tab);
            }

            // Update position (for nav button states)
            updateCarouselPosition(tab);
        }

        // Update prevIds for recent tab
        if (!showVotes && comments) {
            prevIds = comments.map(function (c) { return parseInt(c.id, 10); });
        }
    }

    var _visListenerAdded = false;
    function ensureVisibilityListener() {
        if (_visListenerAdded) return;
        _visListenerAdded = true;
        document.addEventListener('visibilitychange', onVisibilityChange);
    }

    function fetchRecent(isPolling, forceRefresh) {
        var url = AJAX_URL_RECENT + (!forceRefresh && lastMaxId > 0 ? '&last_id=' + lastMaxId : '') + '&_=' + Date.now();
        $.getJSON(url, function (res) {
            if (res.changed === false) {
                schedulePoll();
                return;
            }
            if (res.success && res.comments) {
                lastMaxId = parseInt(res.max_id, 10) || 0;
                renderAll($widgetRecent, res.comments, isPolling, false);
            }
            schedulePoll();
        }).fail(function () {
            schedulePoll();
        });
    }

    function fetchTop() {
        $.getJSON(AJAX_URL_TOP + '&_=' + Date.now(), function (res) {
            if (res.success && res.comments) {
                topLoaded = true;
                renderAll($widgetTop, res.comments, false, true);
            }
        });
    }

    function schedulePoll() {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = setTimeout(function () {
            if (document.hidden) return;
            fetchRecent(true);
        }, POLL_INTERVAL);
    }

    function onVisibilityChange() {
        if (!document.hidden) {
            fetchRecent(true);
            // Resume carousel if on recent tab
            if (activeTab === 'recent') {
                carouselState.recent.isPaused = false;
                startAutoSlide('recent');
            } else if (activeTab === 'top') {
                carouselState.top.isPaused = false;
                startAutoSlide('top');
            }
        } else {
            if (pollTimer) {
                clearTimeout(pollTimer);
                pollTimer = null;
            }
            // Pause all carousels when tab hidden
            stopAutoSlide('recent');
            stopAutoSlide('top');
        }
    }

    function init() {
        $widgetRecent = $('#recentCommentsWidget');
        $widgetTop = $('#topCommentsWidget');
        if (!$widgetRecent.length) return;

        // Tab switching
        $('#recentCommentsSection').on('click', '[data-rc-tab]', function (e) {
            e.preventDefault();
            var tab = $(this).data('rc-tab');
            if (tab === activeTab) return;

            // Stop carousel on previous tab
            stopAutoSlide(activeTab);

            activeTab = tab;

            // Update tab active state
            $(this).addClass('Current').siblings('[data-rc-tab]').removeClass('Current');

            // Toggle panels
            $('[data-rc-panel]').hide();
            $('[data-rc-panel="' + tab + '"]').show();

            // Lazy load top comments
            if (tab === 'top' && !topLoaded) {
                fetchTop();
            } else {
                // Resume carousel on new tab
                carouselState[tab].isPaused = false;
                startAutoSlide(tab);
            }
        });

        $widgetRecent.on('click', '.rc-item', function (e) {
            var href = $(this).attr('href');
            if (!href || href === '#') e.preventDefault();
        });
        $widgetTop.on('click', '.rc-item', function (e) {
            var href = $(this).attr('href');
            if (!href || href === '#') e.preventDefault();
        });

        fetchRecent(false);

        // Centrifugo realtime — render trực tiếp từ event data, không AJAX
        var centrifuge = window.AvsCentrifugo && window.AvsCentrifugo.getInstance();
        if (centrifuge) {
            try {

                // Prepend 1 comment vào đầu list recent, giữ tối đa 15 items
                function prependRecentComment(data) {
                    var id = parseInt(data.id, 10);
                    if (!id || prevIds.indexOf(id) !== -1) return;

                    prevIds.unshift(id);
                    if (prevIds.length > 15) prevIds.pop();

                    var $wrapper = $widgetRecent.find('.rc-carousel-wrapper');
                    var $firstSlide = $wrapper.find('.rc-carousel-slide').first();

                    if (!$firstSlide.length) return;

                    if (!data.comment_url && data.film_slug && data.film_id > 0) {
                        data.comment_url = '/phim/' + data.film_slug + '-a' + data.film_id + '/#cmt-' + data.id;
                    }

                    var $newItem = $(renderComment(data, false, 0));
                    $newItem.hide();
                    $firstSlide.prepend($newItem);
                    $newItem.fadeIn(300);

                    var $items = $firstSlide.find('.rc-carousel-item');
                    if ($items.length > ITEMS_PER_SLIDE) {
                        $items.last().remove();
                    }
                }

                function removeRecentComment(id) {
                    $widgetRecent.find('[data-cid="' + id + '"]').fadeOut(200, function () {
                        $(this).remove();
                    });
                    var idx = prevIds.indexOf(parseInt(id, 10));
                    if (idx !== -1) prevIds.splice(idx, 1);
                }

                function updateRecentComment(data) {
                    if (!data || !data.id) return;
                    var $item = $widgetRecent.find('[data-cid="' + data.id + '"]');
                    if (!$item.length) return;
                    var $content = $item.find('.rc-carousel-content');
                    if (!$content.length) return;
                    if (parseInt(data.is_spoiler, 10) === 1) {
                        $content.html('<em class="rc-carousel-spoiler">[Spoiler]</em>');
                    } else {
                        var _txt = escHtml(truncate(data.content, MAX_CONTENT_LEN));
                        _txt = _txt.replace(/@\[(\d+):([^\]]+)\]/g, '<span class="rc-mention">@$2</span>');
                        $content.html(_txt);
                    }
                }

                var voteDebounce = null;
                var eventHandlers = {
                    'new_comment': function (d) { prependRecentComment(d); },
                    'new_reply': function (d) { prependRecentComment(d); },
                    'edit_comment': function (d) { updateRecentComment(d); },
                    'delete_comment': function (d) { if (d && d.id) removeRecentComment(d.id); },
                    'hide_comment': function (d) { if (d && d.id) removeRecentComment(d.id); },
                    'vote_update': function () {
                        if (!topLoaded) return;
                        if (voteDebounce) clearTimeout(voteDebounce);
                        voteDebounce = setTimeout(function () { fetchTop(); }, 5000);
                    }
                };

                var recentSub = window.AvsCentrifugo.subscribe('recent');
                if (!recentSub) throw new Error('no sub');
                recentSub.on('publication', function (ctx) {
                    var d = ctx.data;
                    if (!d || !d.event) return;
                    var handler = eventHandlers[d.event];
                    if (handler) handler(d.data);
                });
                recentSub.on('unsubscribed', function (ctx) {
                    if (ctx.code === 3500) fetchRecent(true);
                });

                window.AvsCentrifugo.onConnect(function () {
                    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
                });

                window.AvsCentrifugo.onDisconnect(function () {
                    ensureVisibilityListener();
                    schedulePoll();
                });

            } catch (e) {
                ensureVisibilityListener();
                schedulePoll();
            }
        } else {
            ensureVisibilityListener();
            schedulePoll();
        }
    }

    $(document).ready(init);

})(jQuery);

