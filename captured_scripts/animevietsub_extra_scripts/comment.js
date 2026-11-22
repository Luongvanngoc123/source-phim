/* global AvsComment */
(function ($) {
    'use strict';

    /* â”€â”€ Toast notification â”€â”€ */
    function avsToast(msg, type) {
        type = type || 'error';
        var icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
        var colors = { success: '#4caf50', error: '#e53935', info: '#42a5f5', warning: '#ff9800' };
        var $t = $('<div class="avs-toast avs-toast-' + type + '">'
            + '<i class="fa ' + (icons[type] || icons.error) + '" style="color:' + (colors[type] || colors.error) + ';font-size:18px;flex-shrink:0;"></i>'
            + '<span>' + msg + '</span>'
            + '<button class="avs-toast-close">&times;</button>'
            + '</div>');
        if (!$('#avs-toast-wrap').length) $('body').append('<div id="avs-toast-wrap"></div>');
        $('#avs-toast-wrap').append($t);
        setTimeout(function () { $t.addClass('show'); }, 10);
        var timer = setTimeout(function () { $t.removeClass('show'); setTimeout(function () { $t.remove(); }, 300); }, 4000);
        $t.find('.avs-toast-close').on('click', function () { clearTimeout(timer); $t.removeClass('show'); setTimeout(function () { $t.remove(); }, 300); });
    }

    /* â”€â”€ Confirm dialog â”€â”€ */
    function avsConfirm(msg, onYes) {
        var el = document.createElement('div');
        el.className = 'avs-confirm-overlay';
        // Inline style Ä‘á»ƒ trÃ¡nh bá»‹ override bá»Ÿi transform/filter cá»§a parent
        el.style.cssText = 'position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;z-index:99999!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,0.6);opacity:0;transition:opacity 0.25s;transform:none!important;margin:0!important;padding:0!important;';
        el.innerHTML = '<div class="avs-confirm-box">'
            + '<div class="avs-confirm-icon"><i class="fa fa-question-circle"></i></div>'
            + '<div class="avs-confirm-msg">' + msg + '</div>'
            + '<div class="avs-confirm-btns">'
            + '<button class="avs-confirm-no">Há»§y</button>'
            + '<button class="avs-confirm-yes">Äá»“ng Ã½</button>'
            + '</div></div>';
        document.body.appendChild(el);
        var $overlay = $(el);
        setTimeout(function () { el.style.opacity = '1'; $overlay.addClass('show'); }, 10);
        function close() {
            el.style.opacity = '0';
            $overlay.removeClass('show');
            setTimeout(function () { $overlay.remove(); }, 250);
        }
        $overlay.find('.avs-confirm-no').on('click', close);
        $overlay.find('.avs-confirm-yes').on('click', function () { close(); onYes(); });
        $overlay.on('click', function (e) { if (e.target === el) close(); });
    }

    var AvsCommentProto = {
        filmId: 0,
        episodeId: 0,
        episodeName: '',
        isLogin: false,
        userId: 0,
        userName: '',
        userFullName: '',
        userAvatar: '',
        sort: 'newest',
        offset: 0,
        ajaxUrl: '/ajax/comment',
        containerId: 'comments',
        mentionUsers: [], // Cache danh sÃ¡ch users Ä‘á»ƒ mention
        draftKey: '', // Key Ä‘á»ƒ lÆ°u draft vÃ o localStorage
        stickerWhitelist: null,
        stickersUrl: '',
        stickersReadyPromise: null,
        loginUrl: '',

        init: function (opts) {
            this.filmId = opts.filmId || 0;
            this.episodeId = opts.episodeId || 0;
            this.episodeName = opts.episodeName || '';
            this.pageUrl = opts.pageUrl || '';
            this.isLogin = opts.isLogin || false;
            this.userId = opts.userId || 0;
            this.userName = opts.userName || '';
            this.userAvatar = opts.userAvatar || '';
            this.stickersUrl = opts.stickersUrl || '/statics/default/js/stickers.js';
            this.loginUrl = opts.loginUrl || '/account/login/?_fxRef=' + encodeURIComponent(window.location.href);
            this.centrifugoChannels = opts.centrifugoChannels || [];
            this.ajaxUrl = '/ajax/comment';
            this.offset = 0;
            this.containerId = opts.containerId || 'comments';
            this.$c = $('#' + this.containerId);
            this.draftKey = 'avs_comment_draft_' + this.filmId + '_' + (this.episodeId || 0);
            this._centrifuge = null;
            this._pollTimer = null;
            this._pollLastId = 0;
            this.bindForm();
            this.bindDocClick();
            this.load();
            this.restoreDraft();
            this.connectCentrifugo();
        },

        timeAgo: function (ts) {
            var diff = Math.floor(Date.now() / 1000) - ts;
            if (diff < 60) return diff + ' giÃ¢y trÆ°á»›c';
            if (diff < 3600) return Math.floor(diff / 60) + ' phÃºt trÆ°á»›c';
            if (diff < 86400) return Math.floor(diff / 3600) + ' giá» trÆ°á»›c';
            if (diff < 2592000) return Math.floor(diff / 86400) + ' ngÃ y trÆ°á»›c';
            if (diff < 31536000) return Math.floor(diff / 2592000) + ' thÃ¡ng trÆ°á»›c';
            return Math.floor(diff / 31536000) + ' nÄƒm trÆ°á»›c';
        },

        avatarLetter: function (name) {
            return (name || '?').charAt(0).toUpperCase();
        },

        avatarHtml: function (avatarUrl, name) {
            var safeAvatar = this.sanitizeHttpUrl(avatarUrl);
            if (safeAvatar) {
                // PERFORMANCE: Lazy load avatars vá»›i loading="lazy"
                return '<img src="' + this.escHtml(safeAvatar) + '" alt="' + this.escHtml(name) + '" class="avs-avatar-img" loading="lazy">';
            }
            return this.avatarLetter(name);
        },

        // Build a /thanh-vien/{id}/ link for a user_id, or '' if id is invalid.
        // Used to wrap avatar/username clickable surfaces so they jump to the public profile.
        profileUrl: function (userId) {
            var uid = parseInt(userId, 10);
            return (uid > 0) ? '/thanh-vien/' + uid + '/' : '';
        },

        parseStickers: function (html) {
            var self = this;
            // PERFORMANCE: Lazy load sticker images
            return html.replace(/\[sticker:(https?:\/\/[^\]]+)\]/g, function (m, url) {
                var safeUrl = self.sanitizeStickerUrl(url);
                if (!safeUrl) {
                    return '';
                }
                return '<img class="avs-sticker-img" src="' + self.escHtml(safeUrl) + '" alt="sticker" loading="lazy">';
            });
        },

        // Láº¥y ná»™i dung tá»« contenteditable div, convert sticker img ngÆ°á»£c láº¡i thÃ nh [sticker:URL]
        getEditorContent: function (selector) {
            var $el = $(selector);
            var clone = $el.clone();
            // Convert sticker img thÃ nh text tag trÆ°á»›c
            clone.find('img.avs-sticker-img').each(function () {
                $(this).replaceWith('[sticker:' + $(this).attr('src') + ']');
            });
            // Láº¥y text thuáº§n tá»« innerHTML Ä‘Ã£ replace xong
            var tmp = clone.html() || '';
            // Thay <br>, </div>, </p> thÃ nh newline
            tmp = tmp.replace(/<br\s*\/?>/gi, '\n');
            tmp = tmp.replace(/<\/div>/gi, '\n');
            tmp = tmp.replace(/<\/p>/gi, '\n');
            // XÃ³a táº¥t cáº£ HTML tags cÃ²n láº¡i
            tmp = tmp.replace(/<[^>]+>/g, '');
            // Decode HTML entities
            tmp = $('<textarea>').html(tmp).text();
            return tmp.trim();
        },

        // ChÃ¨n sticker img vÃ o contenteditable div
        insertSticker: function (selector, url) {
            var $el = $(selector);
            var img = '<img class="avs-sticker-img" src="' + url + '" alt="sticker"> ';
            $el.focus();
            $el.append(img);
            // Äáº·t cursor á»Ÿ cuá»‘i
            var range = document.createRange();
            var sel = window.getSelection();
            range.selectNodeContents($el[0]);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        },

        ensureStickersLoaded: function () {
            var self = this;
            if (window.AVS_STICKERS && Array.isArray(window.AVS_STICKERS) && window.AVS_STICKERS.length) {
                return Promise.resolve(window.AVS_STICKERS);
            }
            if (self.stickersReadyPromise) return self.stickersReadyPromise;

            self.stickersReadyPromise = new Promise(function (resolve) {
                var script = document.createElement('script');
                script.src = self.stickersUrl;
                script.defer = true;
                script.onload = function () {
                    resolve(window.AVS_STICKERS || []);
                };
                script.onerror = function () {
                    resolve([]);
                };
                document.head.appendChild(script);
            });

            return self.stickersReadyPromise;
        },

        renderStickerPicker: function (targetEditorSelector, targetPickerSelector) {
            var self = this;
            var $picker = $(targetPickerSelector);

            if ($picker.children().length) {
                $picker.toggle();
                return;
            }

            $picker.html('<div class="avs-loading"><i class="fa fa-spinner fa-spin"></i> Äang táº£i sticker...</div>').show();

            self.ensureStickersLoaded().then(function (packs) {
                if (!packs || !packs.length) {
                    $picker.html('<div class="avs-empty">KhÃ´ng táº£i Ä‘Æ°á»£c sticker.</div>');
                    return;
                }

                self.stickerWhitelist = {};
                $.each(packs, function (_, pack) {
                    if (Array.isArray(pack.stickers)) {
                        $.each(pack.stickers, function (_, s) {
                            if (s && s.url) self.stickerWhitelist[s.url] = true;
                        });
                    }
                });

                var html = '<div class="avs-sticker-tabs">';
                $.each(packs, function (i, pack) {
                    html += '<button class="avs-sticker-tab' + (i === 0 ? ' active' : '') + '" data-pack="' + i + '"><img src="' + pack.icon + '" alt="' + self.escHtml(pack.name) + '" title="' + self.escHtml(pack.name) + '" loading="lazy"></button>';
                });
                html += '</div><div class="avs-sticker-grid">';
                $.each(packs[0].stickers, function (j, s) {
                    html += '<img class="avs-sticker-item" src="' + s.url + '" data-url="' + s.url + '" alt="sticker" loading="lazy">';
                });
                html += '</div>';
                $picker.html(html).show();

                // Tab switch
                $picker.off('click', '.avs-sticker-tab').on('click', '.avs-sticker-tab', function () {
                    var idx = $(this).data('pack');
                    $picker.find('.avs-sticker-tab').removeClass('active');
                    $(this).addClass('active');
                    var grid = '';
                    $.each(packs[idx].stickers, function (j, s) {
                        grid += '<img class="avs-sticker-item" src="' + s.url + '" data-url="' + s.url + '" alt="sticker" loading="lazy">';
                    });
                    $picker.find('.avs-sticker-grid').html(grid);
                });

                // Click sticker â†’ chÃ¨n áº£nh vÃ o editor
                $picker.off('click', '.avs-sticker-item').on('click', '.avs-sticker-item', function () {
                    var url = $(this).data('url');
                    self.insertSticker(targetEditorSelector, url);
                    $picker.hide();
                });
            });
        },

        renderComment: function (c, isReply) {
            // User bá»‹ ban â€” hiá»‡n thÃ´ng bÃ¡o thay vÃ¬ ná»™i dung
            if (c.user_ban == 1) {
                var repliesHtml = '';
                if (!isReply && c.replies_count > 0) {
                    repliesHtml = '<div class="avs-replies" id="replies-' + c.id + '" style="display:none;"></div>'
                        + '<button class="avs-toggle-replies" data-id="' + c.id + '" data-count="' + c.replies_count + '"><i class="fa fa-comments"></i> ' + c.replies_count + ' tráº£ lá»i</button>';
                }
                var pUrlB = this.profileUrl(c.user_id);
                var avBannedHtml = this.avatarHtml(c.user_avatar, c.user_name);
                var nameBannedHtml = this.safeUsernameText(c.user_fullname || c.user_name || 'áº¨n danh');
                var handleB = this.safeUsernameText(c.user_name || '');
                var avBannedWrap = pUrlB ? '<a class="avs-avatar-link" href="' + pUrlB + '" data-user-id="' + c.user_id + '">' + avBannedHtml + '</a>' : avBannedHtml;
                var nameBannedWrap = pUrlB
                    ? '<a class="avs-username" href="' + pUrlB + '" data-handle="' + handleB + '" data-user-id="' + c.user_id + '">' + nameBannedHtml + '</a>'
                    : '<span class="avs-username" data-handle="' + handleB + '">' + nameBannedHtml + '</span>';
                return '<li class="avs-comment-item avs-comment-banned" id="cmt-' + c.id + '" data-id="' + c.id + '" data-user-id="' + c.user_id + '">'
                    + '<div class="avs-avatar">' + avBannedWrap + '</div>'
                    + '<div class="avs-comment-body">'
                    + '<div class="avs-comment-meta">'
                    + nameBannedWrap
                    + '<span class="avs-time">' + this.timeAgo(c.created_at) + '</span>'
                    + '</div>'
                    + '<div class="avs-comment-content avs-banned-notice" style="color:#999;font-style:italic;"><i class="fa fa-ban" style="margin-right:4px;"></i>'
                    + (c.hide_reason && c.hide_reason !== 'ThÃ nh viÃªn bá»‹ ban'
                        ? 'BÃ¬nh luáº­n Ä‘Ã£ bá»‹ áº©n, do thÃ nh viÃªn vi pháº¡m: ' + this.escHtml(c.hide_reason)
                        : 'BÃ¬nh luáº­n Ä‘Ã£ bá»‹ áº©n, do thÃ nh viÃªn bá»‹ ban.')
                    + '</div>'
                    + '</div></li>'
                    + repliesHtml;
            }

            // Debug logging for XSS testing
            if (c.content && (c.content.indexOf('<') !== -1 || c.content.indexOf('>') !== -1)) {
                console.log('[Comment Debug] Raw content:', c.content);
            }

            var displayContent = this.stripEncodedTags(c.content);
            var rawContent = c.is_spoiler == 1
                ? '<span class="avs-spoiler-content" title="Click Ä‘á»ƒ xem ná»™i dung tiáº¿t lá»™">' + this.escHtml(displayContent) + '</span>'
                : this.escHtml(displayContent);
            var contentHtml = this.parseStickers(rawContent);

            // Debug logging
            if (c.content && (c.content.indexOf('<') !== -1 || c.content.indexOf('>') !== -1)) {
                console.log('[Comment Debug] Escaped content:', rawContent);
                console.log('[Comment Debug] Final HTML:', contentHtml);
            }

            // Chá»‰ hiá»ƒn thá»‹ tÃªn táº­p khi film_id > 0 vÃ  thread_key khÃ´ng pháº£i URL path
            var episodeTag = (c.thread_key && c.film_id != 0 && c.thread_key.charAt(0) !== '/')
                ? '<span class="avs-episode-tag">Táº­p ' + this.escHtml(c.thread_key) + '</span>'
                : '';

            // Edited badge â€” hiá»ƒn thá»‹ náº¿u comment Ä‘Ã£ chá»‰nh sá»­a
            var editedBadge = (c.edited_at && c.edited_at > 0)
                ? '<span class="avs-edited-badge" title="Chá»‰nh sá»­a láº§n cuá»‘i: ' + this.timeAgo(c.edited_at) + '">(Ä‘Ã£ chá»‰nh sá»­a)</span>'
                : '';

            // Badge ghim â€” chá»‰ hiá»‡n trÃªn comment gá»‘c
            var pinnedBadge = (!isReply && c.is_pinned == 1)
                ? 
                `<div class="relative" style="
    display: flex;
    align-content: space-around;
    justify-content: flex-start;
    color: #7f7f8c;
"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="tabler-icon tabler-icon-pin-filled size-3.5" style="
    width: 1rem;
    height: 1.2rem;
"><!----><path d="M15.113 3.21l.094 .083l5.5 5.5a1 1 0 0 1 -1.175 1.59l-3.172 3.171l-1.424 3.797a1 1 0 0 1 -.158 .277l-.07 .08l-1.5 1.5a1 1 0 0 1 -1.32 .082l-.095 -.083l-2.793 -2.792l-3.793 3.792a1 1 0 0 1 -1.497 -1.32l.083 -.094l3.792 -3.793l-2.792 -2.793a1 1 0 0 1 -.083 -1.32l.083 -.094l1.5 -1.5a1 1 0 0 1 .258 -.187l.098 -.042l3.796 -1.425l3.171 -3.17a1 1 0 0 1 1.497 -1.26z"></path><!----><!----><!----></svg><!----> <span>ÄÃ£ ghim bá»Ÿi Admin</span></div>`
                
                : '';

            // Tin quan trá»ng badge
            var globalPinnedBadge = (!isReply && c.is_global_pinned == 1)
                ? '<span class="avs-badge-global-pinned"><i class="fa fa-bullhorn"></i> Tin quan trá»ng</span>'
                : '';

            // User badges (Admin, Káº» báº¯t chuyá»‡n, v.v.)
            var userBadgesHtml = '';
            if (c.badges && c.badges.length > 0) {
                for (var bi = 0; bi < c.badges.length; bi++) {
                    var b = c.badges[bi];
                    var safeBadgeColor = this.sanitizeBadgeColor(b.color);
                    userBadgesHtml += '<span class="avs-user-badge" style="background:' + this.escHtml(safeBadgeColor) + ';">'
                        + '<i class="fa ' + this.escHtml(b.icon) + '"></i> ' + this.escHtml(b.name) + '</span>';
                }
            }

            // Náº¿u bá»‹ áº©n (admin hide hoáº·c ban) â€” hiá»‡n thÃ´ng bÃ¡o giá»‘ng style ban
            if (c.is_hidden == 1) {
                var rawReason = String(c.hide_reason || '');
                var isBanHide = c.hidden_by_ban == 1;
                var hiddenText;
                if (isBanHide) {
                    hiddenText = rawReason && rawReason !== 'ThÃ nh viÃªn bá»‹ ban'
                        ? 'BÃ¬nh luáº­n Ä‘Ã£ bá»‹ áº©n, do thÃ nh viÃªn vi pháº¡m: ' + this.escHtml(rawReason)
                        : 'BÃ¬nh luáº­n Ä‘Ã£ bá»‹ áº©n, do thÃ nh viÃªn bá»‹ ban.';
                } else {
                    hiddenText = rawReason ? 'BÃ¬nh luáº­n Ä‘Ã£ bá»‹ áº©n â€” ' + this.escHtml(rawReason) : 'BÃ¬nh luáº­n Ä‘Ã£ bá»‹ áº©n';
                }
                var hiddenRepliesHtml = '';
                if (!isReply && c.replies_count > 0) {
                    hiddenRepliesHtml = '<div class="avs-replies" id="replies-' + c.id + '" style="display:none;"></div>'
                        + '<button class="avs-toggle-replies" data-id="' + c.id + '" data-count="' + c.replies_count + '"><i class="fa fa-comments"></i> ' + c.replies_count + ' tráº£ lá»i</button>';
                }
                var pUrlH = this.profileUrl(c.user_id);
                var avHiddenHtml = this.avatarHtml(c.user_avatar, c.user_name);
                var nameHiddenHtml = this.safeUsernameText(c.user_fullname || c.user_name || 'áº¨n danh');
                var handleH = this.safeUsernameText(c.user_name || '');
                var avHiddenWrap = pUrlH ? '<a class="avs-avatar-link" href="' + pUrlH + '" data-user-id="' + c.user_id + '">' + avHiddenHtml + '</a>' : avHiddenHtml;
                var nameHiddenWrap = pUrlH
                    ? '<a class="avs-username" href="' + pUrlH + '" data-handle="' + handleH + '" data-user-id="' + c.user_id + '">' + nameHiddenHtml + '</a>'
                    : '<span class="avs-username" data-handle="' + handleH + '">' + nameHiddenHtml + '</span>';
                return '<li class="avs-comment-item avs-comment-banned" id="cmt-' + c.id + '" data-id="' + c.id + '" data-user-id="' + c.user_id + '">'
                    + '<div class="avs-avatar">' + avHiddenWrap + '</div>'
                    + '<div class="avs-comment-body">'
                    + '<div class="avs-comment-meta">'
                    + nameHiddenWrap
                    + '<span class="avs-time">' + this.timeAgo(c.created_at) + '</span>'
                    + '</div>'
                    + '<div class="avs-comment-content avs-banned-notice" style="color:#999;font-style:italic;"><i class="fa fa-eye-slash" style="margin-right:4px;"></i>' + hiddenText + '</div>'
                    + '</div></li>'
                    + hiddenRepliesHtml;
            }

            // Náº¿u Ä‘ang chá» duyá»‡t â€” hiá»‡n thÃ´ng bÃ¡o vÃ  áº©n ná»™i dung
            if (c.is_pending == 1) {
                var pUrlP = this.profileUrl(c.user_id);
                var avPendingHtml = this.avatarHtml(c.user_avatar, c.user_name);
                var namePendingHtml = this.safeUsernameText(c.user_fullname || c.user_name || 'áº¨n danh');
                var handleP = this.safeUsernameText(c.user_name || '');
                var avPendingWrap = pUrlP ? '<a class="avs-avatar-link" href="' + pUrlP + '" data-user-id="' + c.user_id + '">' + avPendingHtml + '</a>' : avPendingHtml;
                var namePendingWrap = pUrlP
                    ? '<a class="avs-author" href="' + pUrlP + '" data-handle="' + handleP + '" data-user-id="' + c.user_id + '">' + namePendingHtml + '</a>'
                    : '<span class="avs-author" data-handle="' + handleP + '">' + namePendingHtml + '</span>';
                return '<li class="avs-comment-item avs-comment-pending" data-id="' + c.id + '">'
                    + '<div class="avs-comment-header">'
                    + '<div class="avs-avatar">' + avPendingWrap + '</div>'
                    + '<div class="avs-meta">'
                    + namePendingWrap
                    + '<span class="avs-time">' + this.timeAgo(c.created_at) + '</span>'
                    + episodeTag
                    + '</div></div>'
                    + '<div class="avs-pending-notice"><i class="fa fa-clock-o"></i> BÃ¬nh luáº­n Ä‘ang chá» kiá»ƒm duyá»‡t</div>'
                    + '</li>';
            }

            // PERFORMANCE OPTIMIZATION: Replies luÃ´n áº©n, chá»‰ load khi user click
            var repliesHtml = '';
            if (!isReply) {
                var replyCount = c.replies_count || 0;
                // Hiá»ƒn thá»‹ nÃºt "X tráº£ lá»i" náº¿u cÃ³ replies, nhÆ°ng khÃ´ng render replies ngay
                repliesHtml = (replyCount > 0
                    ? '<button class="avs-toggle-replies" data-id="' + c.id + '" data-count="' + replyCount + '" data-loaded="0">'
                      + '<i class="fa fa-comments"></i> ' + replyCount + ' tráº£ lá»i</button>'
                    : '')
                    + '<div class="avs-replies" id="replies-' + c.id + '" style="display:none"></div>';
            }

            var replyFormHtml = !isReply && this.isLogin
                ? '<div class="avs-reply-form-wrap" id="reply-form-' + c.id + '">'
                + '<div class="avs-editor avs-reply-editor" contenteditable="true" data-placeholder="Viáº¿t tráº£ lá»i..."></div>'
                + '<div class="avs-editor-actions">'
  +'<div class="avs-group-input">'
                + '<button type="button" class="avs-sticker-btn avs-reply-sticker-btn" data-parent="' + c.id + '" title="Sticker"><i class="fa fa-smile-o"></i></button>'
              
                + '<label class="avs-group-checkbox">'
                
                + '<input type="checkbox" class="avs-reply-spoiler"> <span>Tiáº¿t lá»™ ná»™i dung</span>'
                + '</label>'
                + '</div>'
                
                + '<button class="avs-reply-submit" data-parent="' + c.id + '">Gá»­i</button>'
                + '</div>'
                + '<div class="avs-sticker-picker avs-reply-sticker-picker" id="reply-sticker-' + c.id + '" style="display:none;"></div>'
                + '</div>'
                : '';

            var upClass = c.user_vote == 1 ? ' voted-up' : '';
            var downClass = c.user_vote == -1 ? ' voted-down' : '';
            var actionsHtml = '<div class="avs-comment-actions">'
                + '<button class="avs-vote-btn avs-up' + upClass + '" data-id="' + c.id + '"><i class="fa fa-thumbs-up"></i> <span class="up-count">' + (c.votes_up || 0) + '</span></button>'
                + '<button class="avs-vote-btn avs-down' + downClass + '" data-id="' + c.id + '"><i class="fa fa-thumbs-down"></i> <span class="down-count">' + (c.votes_down || 0) + '</span></button>'
                + (this.isLogin && !isReply ? '<button class="avs-reply-btn" data-id="' + c.id + '" data-username="' + this.safeUsernameText(c.user_name) + '"><i class="fa fa-reply"></i> Tráº£ lá»i</button>' : '')
                + (this.isLogin && isReply ? '<button class="avs-reply-to-reply-btn" data-username="' + this.safeUsernameText(c.user_name) + '" data-parent="' + c.parent_id + '"><i class="fa fa-reply"></i> Tráº£ lá»i</button>' : '')
                + '<div style="position:relative;margin-left:auto;">'
                + '<button class="avs-more-btn" data-id="' + c.id + '">â€¢â€¢â€¢</button>'
                + '<div class="avs-dropdown" id="drop-' + c.id + '">'
                + (c.is_spoiler == 1 ? '<button class="avs-reveal-spoiler" data-id="' + c.id + '"><i class="fa fa-eye"></i> Tiáº¿t lá»™ ná»™i dung</button>' : '')
                + '<button class="avs-voters-btn" data-id="' + c.id + '"><i class="fa fa-users"></i> Xem ngÆ°á»i tÆ°Æ¡ng tÃ¡c</button>'
                + (this.isLogin && this.userId == c.user_id ? '<button class="avs-edit-btn" data-id="' + c.id + '" data-spoiler="' + c.is_spoiler + '"><i class="fa fa-pencil"></i> Chá»‰nh sá»­a</button>' : '')
                + (this.isLogin && this.userId == c.user_id ? '<button class="avs-delete-btn" data-id="' + c.id + '"><i class="fa fa-trash"></i> XÃ³a</button>' : '')
                + (this.isLogin && this.userId != c.user_id ? '<button class="avs-report-btn" data-id="' + c.id + '"><i class="fa fa-flag"></i> BÃ¡o xáº¥u</button>' : '')
                + '</div></div>'
                + '</div>';

            var mentionClass = isReply ? 'avs-tag avs-tag-reply' : 'avs-tag';
            var self = this;

            // Mention rendering: gá»i shared helper AvsRenderMentions (mention-render.js).
            // Detect marker TRÆ¯á»šC Ä‘á»ƒ biáº¿t cÃ³ nÃªn cháº¡y fallback span cho comment cÅ© â€” trÃ¡nh
            // fallback Äƒn nháº§m `@gmail` trong link text `@john.doe@gmail.com` vá»«a render tá»« marker.
            var hadMarker = /@\[\d+:[^\]]+\]/.test(contentHtml);
            if (window.AvsRenderMentions) {
                contentHtml = window.AvsRenderMentions(contentHtml, mentionClass);
            }
            if (!hadMarker) {
                contentHtml = contentHtml.replace(/@\[([^\]]+)\]/g, function(m, name) { return '<span class="' + mentionClass + '">@' + self.escHtml(name) + '</span>'; });
                contentHtml = contentHtml.replace(/@([a-z_0-9]+)/gi, function(m, name) { return '<span class="' + mentionClass + '">@' + self.escHtml(name) + '</span>'; });
            }

            var pUrl = this.profileUrl(c.user_id);
            var avHtml = this.avatarHtml(c.user_avatar, c.user_name);
            var nameHtml = this.safeUsernameText(c.user_fullname || c.user_name || 'áº¨n danh');
            var handleN = this.safeUsernameText(c.user_name || '');
            var avWrap = pUrl ? '<a class="avs-avatar-link" href="' + pUrl + '" data-user-id="' + c.user_id + '">' + avHtml + '</a>' : avHtml;
            var nameWrap = pUrl
                ? '<a class="avs-username" href="' + pUrl + '" data-handle="' + handleN + '" data-user-id="' + c.user_id + '">' + nameHtml + '</a>'
                : '<span class="avs-username" data-handle="' + handleN + '">' + nameHtml + '</span>';

            return '<li class="avs-comment-item' + (c.is_global_pinned == 1 ? ' avs-comment-global-pinned' : (c.is_pinned == 1 ? ' avs-comment-pinned' : '')) + '" id="cmt-' + c.id + '" data-id="' + c.id + '" data-user-id="' + c.user_id + '">'
                + '<div class="avs-avatar">' + avWrap + '</div>'
                + '<div class="avs-comment-body">'
                + globalPinnedBadge
                + pinnedBadge

                + '<div class="avs-comment-meta">'
                + nameWrap
                + userBadgesHtml
                + episodeTag
                + '<span class="avs-time">' + this.timeAgo(c.created_at) + '</span>'
                + '</div>'
                + '<div class="avs-comment-content">' + contentHtml + '</div>'
                + editedBadge
                + actionsHtml
                + replyFormHtml
                + '</div></li>'
                + repliesHtml;
        },

        escHtml: function (str) {
            return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },

        // Decode entity má»™t láº§n Ä‘á»ƒ hiá»ƒn thá»‹ text Ä‘Ãºng (trÃ¡nh double-escape)
        decodeEntitiesOnce: function (str) {
            var s = String(str || '');
            return $('<textarea>').html(s).text();
        },

        // Hiá»ƒn thá»‹ ná»™i dung Ä‘Ã£ encode á»Ÿ backend dÆ°á»›i dáº¡ng text an toÃ n
        // Má»¥c tiÃªu: váº«n an toÃ n (khÃ´ng render HTML), nhÆ°ng hiá»ƒn thá»‹ Ä‘Ãºng <script>...</script>
        stripEncodedTags: function (str) {
            return this.decodeEntitiesOnce(str);
        },

        // Username hiá»ƒn thá»‹ Ä‘áº§y Ä‘á»§ dáº¡ng text (vd: <style>...</style>) nhÆ°ng khÃ´ng thá»±c thi
        safeUsernameText: function (str) {
            return this.escHtml(this.decodeEntitiesOnce(str));
        },

        // Chá»‰ cho phÃ©p URL http/https an toÃ n
        sanitizeHttpUrl: function (url) {
            var raw = String(url || '').trim();
            if (!raw) return '';
            // Chá»‰ cho phÃ©p http/https
            if (!/^https?:\/\//i.test(raw)) return '';
            // Cháº·n protocol nguy hiá»ƒm dáº¡ng obfuscated
            if (/^(javascript|data|vbscript|file):/i.test(raw)) return '';
            return raw;
        },

        // Whitelist URL sticker Ä‘á»ƒ trÃ¡nh XSS qua src/data URL
        sanitizeStickerUrl: function (url) {
            var raw = this.sanitizeHttpUrl(url);
            if (!raw) return '';

            if (this.stickerWhitelist && !this.stickerWhitelist[raw]) {
                return '';
            }
            return raw;
        },

        // Whitelist color cho inline badge style
        sanitizeBadgeColor: function (color) {
            var c = String(color || '').trim();
            if (!c) return '#64748b';
            // #rgb / #rrggbb / #rrggbbaa
            if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c;
            // rgb()/rgba()
            if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*(0|0?\.\d+|1))?\s*\)$/i.test(c)) return c;
            // Named safe colors
            var safeNames = {
                red:1, blue:1, green:1, orange:1, purple:1, pink:1, teal:1, cyan:1, indigo:1,
                gray:1, grey:1, black:1, white:1, brown:1, lime:1, navy:1, maroon:1, olive:1,
                silver:1, gold:1
            };
            if (safeNames[c.toLowerCase()]) return c.toLowerCase();
            return '#64748b';
        },

        load: function (append) {
            var self = this;
            var $list = self.$c.find('.avs-comment-list-wrap');
            if (!append) {
                this.offset = 0;
                $list.html('<div class="avs-loading"><i class="fa fa-spinner fa-spin"></i> Äang táº£i bÃ¬nh luáº­n...</div>');
            }
            var url = this.ajaxUrl + '?action=get&film_id=' + this.filmId + '&sort=' + this.sort + '&offset=' + this.offset + (this.pageUrl ? '&page_url=' + encodeURIComponent(this.pageUrl) : '') + '&_=' + Date.now();
            $.getJSON(url, function (res) {
                if (res.success) {
                    // Update comment count - chá»‰ hiá»ƒn thá»‹ tá»•ng sá»‘
                    self.$c.find('.avs-comment-count').text(res.total);

                    if (!append) {
                        if (res.comments.length === 0) {
                            $list.html('<div class="avs-empty">ChÆ°a cÃ³ bÃ¬nh luáº­n nÃ o. HÃ£y lÃ  ngÆ°á»i Ä‘áº§u tiÃªn!</div>');
                            return;
                        }
                        // PERFORMANCE: Batch render táº¥t cáº£ comments cÃ¹ng lÃºc
                        var html = '<ul class="avs-comment-list">';
                        for (var i = 0; i < res.comments.length; i++) {
                            html += self.renderComment(res.comments[i], false);
                        }
                        html += '</ul>';
                        $list.html(html);
                    } else {
                        // PERFORMANCE: Batch append cho "Load more"
                        $list.find('.avs-load-more-btn').remove();
                        var html = '';
                        for (var i = 0; i < res.comments.length; i++) {
                            html += self.renderComment(res.comments[i], false);
                        }
                        $list.find('ul.avs-comment-list').append(html);
                    }
                    self.offset = res.offset;
                    if (res.has_more) {
                        // TÃ­nh sá»‘ bÃ¬nh luáº­n Ä‘ang hiá»ƒn thá»‹
                        var displayedCount = self.$c.find('.avs-comment-list .avs-comment-item').length;

                        // Kiá»ƒm tra xem Ä‘Ã£ cÃ³ status vÃ  button chÆ°a
                        var $existingStatus = $list.find('.avs-comment-status');
                        var $existingBtn = $list.find('.avs-load-more-btn');

                        if ($existingStatus.length) {
                            // Cáº­p nháº­t status hiá»‡n cÃ³
                            $existingStatus.text('Hiá»ƒn thá»‹ ' + displayedCount + '/' + res.total + ' bÃ¬nh luáº­n');
                        } else {
                            // Táº¡o má»›i status
                            $list.append('<div class="avs-comment-status">Hiá»ƒn thá»‹ ' + displayedCount + '/' + res.total + ' bÃ¬nh luáº­n</div>');
                        }

                        if (!$existingBtn.length) {
                            // Táº¡o má»›i button náº¿u chÆ°a cÃ³
                            $list.append('<button class="avs-load-more-btn"><i class="fa fa-angle-double-down"></i> Táº£i thÃªm bÃ¬nh luáº­n</button>');
                        }
                    } else {
                        // KhÃ´ng cÃ²n bÃ¬nh luáº­n nÃ o, xÃ³a status vÃ  button
                        $list.find('.avs-comment-status').remove();
                        $list.find('.avs-load-more-btn').remove();
                    }
                    self.bindCommentEvents();
                    self.buildMentionList(); // Build mention list sau khi load comments
                    // Apply mute status náº¿u user Ä‘ang bá»‹ mute
                    if (res.is_muted) {
                        self.onMuteUser({ muted: true, minutes: 0 });
                    }
                    // Scroll Ä‘áº¿n comment Ä‘Æ°á»£c anchor sau khi render xong
                    if (!append && location.hash && location.hash.indexOf('#cmt-') === 0) {
                        var hash = location.hash;
                        var $target = $(hash);
                        if ($target.length) {
                            // Delay 1500ms Ä‘á»ƒ chá» player JS (fx.scrollTo #watch-block 1000ms) cháº¡y xong
                            setTimeout(function () {
                                $('html, body').stop(true, true);
                                $target[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                                $target.css({ outline: '2px solid #e53935', borderRadius: '6px' });
                                setTimeout(function () { $target.css({ outline: '', borderRadius: '' }); }, 2500);
                            }, 1500);
                        }
                    }
                } else {
                    if (!append) $list.html('<div class="avs-empty">KhÃ´ng thá»ƒ táº£i bÃ¬nh luáº­n.</div>');
                }
            }).fail(function () {
                if (!append) $list.html('<div class="avs-empty">Lá»—i káº¿t ná»‘i.</div>');
            });
        },

        bindForm: function () {
            var self = this;

            // Add composer avatar layout for main comment box
            var $mainEditor = self.$c.find('.avs-main-editor');
            if ($mainEditor.length && !$mainEditor.closest('.avs-composer-main').length) {
                var avatarHtml = '<div class="avs-avatar avs-composer-avatar">' + self.avatarHtml(self.userAvatar, self.userName || 'U') + '</div>';
                $mainEditor.wrap('<div class="avs-composer-input-wrap"></div>');
                $mainEditor.closest('.avs-composer-input-wrap').wrap('<div class="avs-composer-main"></div>');
                $mainEditor.closest('.avs-composer-main').prepend(avatarHtml);
            }

            // Setup mention autocomplete cho main editor
            if ($mainEditor.length && self.isLogin) {
                self.setupMentionAutocomplete($mainEditor);
                // Auto-save draft khi gÃµ
                $mainEditor.on('input', function () {
                    var content = self.getEditorContent($mainEditor);
                    self.saveDraft(content);
                });
            }

            // Sticker picker cho form chÃ­nh
            self.$c.find('.avs-sticker-btn[data-main]').on('click', function (e) {
                e.stopPropagation();
                self.renderStickerPicker(self.$c.find('.avs-main-editor')[0], self.$c.find('.avs-main-sticker-picker')[0]);
            });

            self.$c.find('.avs-comment-submit').on('click', function () {
                var content = self.getEditorContent(self.$c.find('.avs-main-editor'));
                var isSpoiler = self.$c.find('.avs-spoiler-check').is(':checked') ? 1 : 0;
                if (!content) return;
                var $submitBtn = $(this);
                $submitBtn.prop('disabled', true).text('Äang gá»­i...');

                // Optimistic render
                var tempId = 'tmp_' + Date.now();
                var now = Math.floor(Date.now() / 1000);
                var optimisticComment = {
                    id: '', user_id: self.userId, user_name: self.userName, user_fullname: self.userFullName, user_avatar: self.userAvatar,
                    content: content, is_spoiler: isSpoiler, is_pending: 0,
                    created_at: now, votes_up: 0, votes_down: 0, replies_count: 0,
                    badges: [], thread_key: self.episodeName || self.pageUrl || ''
                };
                var $list = self.$c.find('.avs-comment-list-wrap ul.avs-comment-list');
                if ($list.length === 0) {
                    self.$c.find('.avs-comment-list-wrap').html('<ul class="avs-comment-list"></ul>');
                    $list = self.$c.find('.avs-comment-list-wrap ul');
                }
                var $optimistic = $(self.renderComment(optimisticComment, false));
                $optimistic.first().attr('data-temp-id', tempId).attr('data-id', '').addClass('avs-comment-optimistic');
                self.prependAfterPinned($list, $optimistic);

                // Clear editor
                self.$c.find('.avs-main-editor').html('');
                self.$c.find('.avs-spoiler-check').prop('checked', false);
                self.clearDraft();

                $.post(self.ajaxUrl, {
                    action: 'post', film_id: self.filmId,
                    episode_id: self.episodeId,
                    content: content, is_spoiler: isSpoiler,
                    thread_key: self.pageUrl || self.episodeName, parent_id: 0
                }, function (res) {
                    var $el = self.$c.find('[data-temp-id="' + tempId + '"]');
                    if (res.success) {
                        // Confirm: swap temp-id â†’ real id
                        $el.attr('data-id', res.comment.id).attr('id', 'cmt-' + res.comment.id)
                           .removeAttr('data-temp-id').removeClass('avs-comment-optimistic');
                        if (res.pending) {
                            $el.replaceWith($(self.renderComment(res.comment, false)));
                        }
                        self.$c.find('.avs-comment-count').text(res.total);
                        var $loadMoreBtn = self.$c.find('.avs-load-more-btn');
                        if ($loadMoreBtn.length) {
                            var displayedCount = self.$c.find('.avs-comment-list .avs-comment-item').length;
                            $loadMoreBtn.html('<div>Hiá»ƒn thá»‹ ' + displayedCount + '/' + res.total + ' bÃ¬nh luáº­n</div><div><i class="fa fa-angle-double-down"></i> Táº£i thÃªm bÃ¬nh luáº­n</div>');
                        }
                        self.buildMentionList();
                        self.bindCommentEvents();
                    } else {
                        // Rollback
                        $el.remove();
                        self.$c.find('.avs-main-editor').text(content);
                        avsToast(res.error || 'Lá»—i khi gá»­i bÃ¬nh luáº­n', 'error');
                    }
                    $submitBtn.prop('disabled', false).text('BÃ¬nh luáº­n');
                }, 'json').fail(function () {
                    var $el = self.$c.find('[data-temp-id="' + tempId + '"]');
                    $el.remove();
                    self.$c.find('.avs-main-editor').text(content);
                    avsToast('Lá»—i káº¿t ná»‘i, vui lÃ²ng thá»­ láº¡i', 'error');
                    $submitBtn.prop('disabled', false).text('BÃ¬nh luáº­n');
                });
            });
        },

        bindCommentEvents: function () {
            var self = this;
            var $wrap = self.$c.find('.avs-comment-list-wrap');

            // Sticker picker cho reply form
            $wrap.off('click', '.avs-reply-sticker-btn').on('click', '.avs-reply-sticker-btn', function (e) {
                e.stopPropagation();
                var parentId = $(this).data('parent');
                self.renderStickerPicker($wrap.find('#reply-form-' + parentId + ' .avs-editor')[0], $wrap.find('#reply-sticker-' + parentId)[0]);
            });

            // Vote
            $wrap.off('click', '.avs-up, .avs-down').on('click', '.avs-up, .avs-down', function () {
                if (!self.isLogin) { avsToast('Vui lÃ²ng Ä‘Äƒng nháº­p Ä‘á»ƒ vote', 'warning'); return; }
                var $btn = $(this);
                var id = $btn.data('id');
                var voteType = $btn.hasClass('avs-up') ? 1 : -1;
                var $item = $wrap.find('[data-id="' + id + '"]').first();
                var $upBtn = $item.find('.avs-up');
                var $downBtn = $item.find('.avs-down');
                var prevUp = $upBtn.hasClass('voted-up');
                var prevDown = $downBtn.hasClass('voted-down');
                $.post(self.ajaxUrl, { action: 'vote', comment_id: id, vote_type: voteType }, function (res) {
                    if (res.success) {
                        $item.find('.up-count').text(res.votes_up);
                        $item.find('.down-count').text(res.votes_down);
                        // Determine new active state from server response
                        // The PHP returns updated vote counts; we infer active state from the button that was just clicked
                        // Toggle the clicked button; remove opposite active
                        if (voteType === 1) {
                            if (prevUp) {
                                $upBtn.removeClass('voted-up'); // un-vote
                            } else {
                                $upBtn.addClass('voted-up');
                                $downBtn.removeClass('voted-down');
                            }
                        } else {
                            if (prevDown) {
                                $downBtn.removeClass('voted-down'); // un-vote
                            } else {
                                $downBtn.addClass('voted-down');
                                $upBtn.removeClass('voted-up');
                            }
                        }
                    }
                }, 'json');
            });

            // Helper: format mention â€” bracket form khi name chá»©a char ngoÃ i [a-zA-Z0-9_]
            // (space, dot, @, -, â€¦) vÃ¬ server bare-parse chá»‰ Äƒn `[\p{L}\p{N}_]+` â†’ máº¥t pháº§n Ä‘uÃ´i.
            function formatMention(username) {
                return /[^a-zA-Z0-9_]/.test(username) ? '@[' + username + ']' : '@' + username;
            }

            // Reply toggle
            $wrap.off('click', '.avs-reply-btn').on('click', '.avs-reply-btn', function (e) {
                e.preventDefault();
                var id = $(this).data('id');
                var username = $(this).data('username');
                var $form = $wrap.find('#reply-form-' + id);
                var $editor = $form.find('.avs-editor');
                var mention = formatMention(username);
                if (!$form.hasClass('open')) {
                    $form.addClass('open');
                    var currentText = $editor.text();
                    if (!currentText || currentText.indexOf(mention) === -1) { $editor.text(mention + ' '); }
                    // Delay focus Ä‘á»ƒ DOM settle sau display:none â†’ block
                    setTimeout(function () {
                        $editor.focus();
                        var range = document.createRange(); var sel = window.getSelection();
                        range.selectNodeContents($editor[0]); range.collapse(false);
                        sel.removeAllRanges(); sel.addRange(range);
                        // Scroll tá»›i form
                        $('html, body').animate({ scrollTop: $form.offset().top - 100 }, 300);
                    }, 50);
                    // Setup mention autocomplete cho reply editor
                    if (self.isLogin && !$editor.data('mention-setup')) {
                        self.setupMentionAutocomplete($editor);
                        $editor.data('mention-setup', true);
                    }
                } else { $form.removeClass('open'); }
            });

            // Reply to reply
            $wrap.off('click', '.avs-reply-to-reply-btn').on('click', '.avs-reply-to-reply-btn', function (e) {
                e.preventDefault();
                var username = $(this).data('username');
                var parentId = $(this).data('parent');
                var $form = $wrap.find('#reply-form-' + parentId);
                var $editor = $form.find('.avs-editor');
                var mention = formatMention(username);

                // Di chuyá»ƒn form tá»›i ngay sau reply Ä‘Æ°á»£c click
                var $thisReply = $(this).closest('.avs-comment-item');
                if ($thisReply.length) {
                    $form.detach();
                    $thisReply.after($form);
                }

                $form.addClass('open');
                var currentText = $editor.text();
                if (currentText.indexOf(mention) === -1) { $editor[0].textContent = currentText + (currentText ? ' ' : '') + mention + ' '; }
                setTimeout(function () {
                    $editor.focus();
                    var range = document.createRange(); var sel = window.getSelection();
                    range.selectNodeContents($editor[0]); range.collapse(false);
                    sel.removeAllRanges(); sel.addRange(range);
                    $('html, body').animate({ scrollTop: $form.offset().top - 100 }, 300);
                }, 50);
            });

            // Reply submit (with optimistic update)
            $wrap.off('click', '.avs-reply-submit').on('click', '.avs-reply-submit', function () {
                var $btn = $(this);
                var parentId = $btn.data('parent');
                var $form = $wrap.find('#reply-form-' + parentId);
                var content = self.getEditorContent($form.find('.avs-editor'));
                var isSpoiler = $form.find('.avs-reply-spoiler').is(':checked') ? 1 : 0;
                if (!content) return;
                $btn.prop('disabled', true);

                // Optimistic reply render
                var tempId = 'tmp_' + Date.now();
                var now = Math.floor(Date.now() / 1000);
                var optimisticReply = {
                    id: '', parent_id: parentId,
                    user_id: self.userId, user_name: self.userName, user_fullname: self.userFullName, user_avatar: self.userAvatar,
                    content: content, is_spoiler: isSpoiler, is_pending: 0,
                    created_at: now, votes_up: 0, votes_down: 0, badges: [], thread_key: self.episodeName || ''
                };
                var $repliesDiv = $wrap.find('#replies-' + parentId);
                $repliesDiv.show();
                var $optimistic = $(self.renderComment(optimisticReply, true));
                $optimistic.first().attr('data-temp-id', tempId).attr('data-id', '').addClass('avs-comment-optimistic');
                // Náº¿u form Ä‘Ã£ di chuyá»ƒn vÃ o trong replies (reply-to-reply) â†’ insert sau form
                // NgÆ°á»£c láº¡i (reply top-level) â†’ append vÃ o cuá»‘i replies div
                if ($form.closest('#replies-' + parentId).length) {
                    $form.after($optimistic);
                } else {
                    $repliesDiv.prepend($optimistic);
                }
                $form.find('.avs-editor').html('');
                $form.removeClass('open');

                $.post(self.ajaxUrl, {
                    action: 'post', film_id: self.filmId, episode_id: self.episodeId,
                    content: content, is_spoiler: isSpoiler, thread_key: self.episodeName, parent_id: parentId
                }, function (res) {
                    var $el = $wrap.find('[data-temp-id="' + tempId + '"]');
                    if (res.success) {
                        $el.attr('data-id', res.comment.id).attr('id', 'cmt-' + res.comment.id)
                           .removeAttr('data-temp-id').removeClass('avs-comment-optimistic');
                        if (res.pending) {
                            $el.replaceWith($(self.renderComment(res.comment, true)));
                        }
                        // Update total count (bao gá»“m replies)
                        if (typeof res.total === 'number') {
                            self.$c.find('.avs-comment-count').text(res.total);
                        } else {
                            var total = parseInt(self.$c.find('.avs-comment-count').text(), 10) || 0;
                            self.$c.find('.avs-comment-count').text(total + 1);
                        }
                        self.buildMentionList();
                        self.bindCommentEvents();
                    } else {
                        $el.remove();
                        $form.find('.avs-editor').text(content);
                        $form.addClass('open');
                        avsToast(res.error || 'Lá»—i khi gá»­i tráº£ lá»i', 'error');
                    }
                    $btn.prop('disabled', false);
                }, 'json').fail(function () {
                    var $el = $wrap.find('[data-temp-id="' + tempId + '"]');
                    $el.remove();
                    $form.find('.avs-editor').text(content);
                    $form.addClass('open');
                    avsToast('Lá»—i káº¿t ná»‘i', 'error');
                    $btn.prop('disabled', false);
                });
            });

            // Toggle replies - LAZY LOADING: Load replies khi user click láº§n Ä‘áº§u
            $wrap.off('click', '.avs-toggle-replies').on('click', '.avs-toggle-replies', function () {
                var $btn = $(this);
                var commentId = $btn.data('id');
                var isLoaded = $btn.data('loaded');
                var $repliesDiv = $wrap.find('#replies-' + commentId);

                // Náº¿u Ä‘ang hiá»ƒn thá»‹ thÃ¬ áº©n Ä‘i
                if ($repliesDiv.is(':visible')) {
                    $repliesDiv.hide();
                    return;
                }

                // Náº¿u chÆ°a load thÃ¬ fetch tá»« server
                if (!isLoaded) {
                    $btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Äang táº£i...');
                    $.getJSON(self.ajaxUrl + '?action=get_replies&comment_id=' + commentId + '&sort=' + self.sort + '&offset=0&_=' + Date.now(), function (res) {
                        if (res.success) {
                            $btn.data('loaded', 1).prop('disabled', false);
                            var replyCount = $btn.data('count');
                            $btn.html('<i class="fa fa-comments"></i> ' + replyCount + ' tráº£ lá»i');

                            // Render replies - PERFORMANCE: Batch render
                            var html = '';
                            for (var j = 0; j < res.replies.length; j++) {
                                html += self.renderComment(res.replies[j], true);
                            }

                            // NÃºt "Xem thÃªm" náº¿u cÃ²n replies
                            if (res.has_more) {
                                html += '<button class="avs-load-more-replies" data-id="' + commentId + '" data-offset="' + res.offset + '"><i class="fa fa-chevron-down"></i> Xem thÃªm tráº£ lá»i</button>';
                            }

                            $repliesDiv.html(html).show();
                            self.bindCommentEvents();
                            self.buildMentionList(); // Update mention list sau khi load replies
                        } else {
                            $btn.prop('disabled', false);
                            var replyCount = $btn.data('count');
                            $btn.html('<i class="fa fa-comments"></i> ' + replyCount + ' tráº£ lá»i');
                            avsToast('KhÃ´ng thá»ƒ táº£i tráº£ lá»i');
                        }
                    }).fail(function() {
                        $btn.prop('disabled', false);
                        var replyCount = $btn.data('count');
                        $btn.html('<i class="fa fa-comments"></i> ' + replyCount + ' tráº£ lá»i');
                        avsToast('Lá»—i káº¿t ná»‘i');
                    });
                } else {
                    // ÄÃ£ load rá»“i, chá»‰ cáº§n show
                    $repliesDiv.show();
                }
            });

            // Xem thÃªm replies - PERFORMANCE: Batch append
            $wrap.off('click', '.avs-load-more-replies').on('click', '.avs-load-more-replies', function () {
                var $btn = $(this);
                var commentId = $btn.data('id');
                var offset = $btn.data('offset');
                $btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Äang táº£i...');
                $.getJSON(self.ajaxUrl + '?action=get_replies&comment_id=' + commentId + '&sort=' + self.sort + '&offset=' + offset + '&_=' + Date.now(), function (res) {
                    if (res.success) {
                        $btn.remove();
                        var $replies = $wrap.find('#replies-' + commentId);
                        // Batch render replies
                        var html = '';
                        for (var j = 0; j < res.replies.length; j++) {
                            html += self.renderComment(res.replies[j], true);
                        }
                        $replies.append(html);
                        if (res.has_more) {
                            $replies.append('<button class="avs-load-more-replies" data-id="' + commentId + '" data-offset="' + res.offset + '"><i class="fa fa-chevron-down"></i> Xem thÃªm tráº£ lá»i</button>');
                        }
                        self.bindCommentEvents();
                        self.buildMentionList(); // Update mention list sau khi load replies
                    }
                });
            });

            // More dropdown
            $wrap.off('click', '.avs-more-btn').on('click', '.avs-more-btn', function (e) {
                e.stopPropagation();

                // Guest: modal xÃ¡c nháº­n Ä‘Äƒng nháº­p (phÆ°Æ¡ng Ã¡n C)
                if (!self.isLogin) {
                    avsConfirm('Báº¡n cáº§n Ä‘Äƒng nháº­p Ä‘á»ƒ sá»­ dá»¥ng chá»©c nÄƒng nÃ y. Chuyá»ƒn Ä‘áº¿n trang Ä‘Äƒng nháº­p?', function () {
                        var loginUrl = self.loginUrl || '/account/login/?_fxRef=' + encodeURIComponent(window.location.href);
                        window.location.href = loginUrl;
                    });
                    return;
                }

                var id = $(this).data('id');
                $wrap.find('.avs-dropdown').not('#drop-' + id).removeClass('open');
                $wrap.find('#drop-' + id).toggleClass('open');
            });

            // Reveal spoiler
            $wrap.off('click', '.avs-reveal-spoiler').on('click', '.avs-reveal-spoiler', function () {
                var id = $(this).data('id');
                $wrap.find('[data-id="' + id + '"]').find('.avs-spoiler-content').addClass('revealed');
                $wrap.find('#drop-' + id).removeClass('open');
            });
            $wrap.off('click', '.avs-spoiler-content').on('click', '.avs-spoiler-content', function () {
                $(this).toggleClass('revealed');
            });

            // Voters modal â€” "Xem ngÆ°á»i tÆ°Æ¡ng tÃ¡c"
            $wrap.off('click', '.avs-voters-btn').on('click', '.avs-voters-btn', function () {
                var id = $(this).data('id');
                $wrap.find('#drop-' + id).removeClass('open');
                self.showVotersModal(id, 1); // tab 1 = like
            });

            // Report
            $wrap.off('click', '.avs-report-btn').on('click', '.avs-report-btn', function () {
                var id = $(this).data('id');
                $wrap.find('#drop-' + id).removeClass('open');
                avsConfirm('BÃ¡o cÃ¡o bÃ¬nh luáº­n nÃ y?', function () {
                    $.post(self.ajaxUrl, { action: 'report', comment_id: id }, function (res) {
                        avsToast(res.success ? res.message : (res.error || 'Lá»—i'), res.success ? 'success' : 'error');
                    }, 'json');
                });
            });

            // Edit â€” má»Ÿ inline form
            $wrap.off('click', '.avs-edit-btn').on('click', '.avs-edit-btn', function () {
                var id = $(this).data('id');
                var isSpoiler = $(this).data('spoiler');
                var $item = $wrap.find('[data-id="' + id + '"]').first();
                var editContent = self.getEditorContent($item.find('.avs-comment-content'));
                var editHtmlContent = self.parseStickers(self.escHtml(editContent));
                $wrap.find('#drop-' + id).removeClass('open');
                if ($item.find('.avs-edit-form').length) { $item.find('.avs-edit-form').remove(); return; }
                var editHtml = '<div class="avs-reply-form-wrap open avs-edit-form">'
                    + '<div class="avs-edit-textarea avs-reply-editor avs-editor" contenteditable="true">' + editHtmlContent + '</div>'

                    
                     + '<div class="avs-editor-actions">'
  +'<div class="avs-group-input">'
                + '<button type="button" class="avs-sticker-btn avs-edit-sticker-btn" data-id="' + id + '" title="Sticker"><i class="fa fa-smile-o"></i></button>'
              
                + '<label class="avs-group-checkbox">'
                
                + '<input type="checkbox" class="avs-edit-spoiler' + (isSpoiler == 1 ? ' checked' : '') + '"> <span>Tiáº¿t lá»™ ná»™i dung</span>'
                + '</label>'
                + '</div>'

                    +'<div class="avs-group-input">'
                    
                    + '<button class="avs-edit-cancel" data-id="' + id + '">Há»§y</button>'
                  
                    + '<button class="avs-edit-save" data-id="' + id + '">LÆ°u</button>'
                    + '</div></div></div>'
                    + '<div class="avs-sticker-picker avs-edit-sticker-picker" id="edit-sticker-' + id + '" style="display:none;"></div>'
                    + '</div>';
                $item.find('.avs-comment-content').after(editHtml);
            });

            // Edit sticker picker
            $wrap.off('click', '.avs-edit-sticker-btn').on('click', '.avs-edit-sticker-btn', function (e) {
                e.stopPropagation();
                var id = $(this).data('id');
                var $item = $wrap.find('[data-id="' + id + '"]').first();
                self.renderStickerPicker($item.find('.avs-edit-textarea')[0], $item.find('#edit-sticker-' + id)[0]);
            });

            // Edit â€” há»§y
            $wrap.off('click', '.avs-edit-cancel').on('click', '.avs-edit-cancel', function () {
                $wrap.find('[data-id="' + $(this).data('id') + '"]').first().find('.avs-edit-form').remove();
            });

            // Edit â€” lÆ°u
            $wrap.off('click', '.avs-edit-save').on('click', '.avs-edit-save', function () {
                var $btn = $(this);
                var id = $btn.data('id');
                var $item = $wrap.find('[data-id="' + id + '"]').first();
                var content = self.getEditorContent($item.find('.avs-edit-textarea'));
                var isSpoiler = $item.find('.avs-edit-spoiler').is(':checked') ? 1 : 0;
                if (!content) return;
                $btn.prop('disabled', true).text('Äang lÆ°u...');
                $.post(self.ajaxUrl, { action: 'edit', comment_id: id, content: content, is_spoiler: isSpoiler }, function (res) {
                    if (res.success) {
                        // Náº¿u sau khi sá»­a bá»‹ Ä‘Æ°a vÃ o pending (do chá»©a tá»« khoÃ¡/url)
                        if (res.pending) {
                            avsToast('BÃ¬nh luáº­n Ä‘Ã£ Ä‘Æ°á»£c cáº­p nháº­t vÃ  chuyá»ƒn sang chá» kiá»ƒm duyá»‡t.', 'info');
                            self.load();
                            return;
                        }

                        var editedDisplayContent = self.stripEncodedTags(res.content);
                        var newHtml = self.parseStickers(res.is_spoiler == 1
                            ? '<span class="avs-spoiler-content" title="Click Ä‘á»ƒ xem ná»™i dung tiáº¿t lá»™">' + self.escHtml(editedDisplayContent) + '</span>'
                            : self.escHtml(editedDisplayContent));
                        $item.find('.avs-comment-content').html(newHtml);
                        $item.find('.avs-edit-form').remove();
                        $item.find('.avs-edit-btn').data('spoiler', res.is_spoiler);

                        // ThÃªm/cáº­p nháº­t edited badge
                        var editedBadge = '<span class="avs-edited-badge" title="Chá»‰nh sá»­a láº§n cuá»‘i: ' + self.timeAgo(res.edited_at) + '">(Ä‘Ã£ chá»‰nh sá»­a)</span>';
                        var $existingBadge = $item.find('.avs-edited-badge');
                        if ($existingBadge.length) {
                            $existingBadge.replaceWith(editedBadge);
                        } else {
                            $item.find('.avs-comment-content').after(editedBadge);
                        }
                    } else { avsToast(res.error || 'Lá»—i khi lÆ°u'); $btn.prop('disabled', false).text('LÆ°u'); }
                }, 'json');
            });

            // Delete
            $wrap.off('click', '.avs-delete-btn').on('click', '.avs-delete-btn', function () {
                var id = $(this).data('id');
                $wrap.find('#drop-' + id).removeClass('open');
                avsConfirm('XÃ³a bÃ¬nh luáº­n nÃ y?', function () {
                    $.post(self.ajaxUrl, { action: 'delete', comment_id: id }, function (res) {
                        if (res.success) {
                            $wrap.find('[data-id="' + id + '"]').first().fadeOut(300, function () {
                                $(this).remove();
                                // Update count sau khi xÃ³a
                                self.$c.find('.avs-comment-count').text(res.total);
                                // Update "Load more" button náº¿u cÃ³
                                var $loadMoreBtn = self.$c.find('.avs-load-more-btn');
                                if ($loadMoreBtn.length) {
                                    var displayedCount = self.$c.find('.avs-comment-list .avs-comment-item').length;
                                    $loadMoreBtn.html('Hiá»ƒn thá»‹ ' + displayedCount + '/' + res.total + ' bÃ¬nh luáº­n <i class="fa fa-angle-double-down"></i> Táº£i thÃªm bÃ¬nh luáº­n');
                                }
                            });
                        } else { avsToast(res.error || 'Lá»—i khi xÃ³a'); }
                    }, 'json');
                });
            });
        },

        bindDocClick: function () {
            var self = this;
            var ns = '.avsDoc_' + this.containerId;
            $(document).off(ns).on('click' + ns, function (e) {
                self.$c.find('.avs-dropdown').removeClass('open');
                if (!$(e.target).closest('.avs-sticker-picker, .avs-sticker-btn, .avs-reply-sticker-btn').length) {
                    self.$c.find('.avs-sticker-picker').hide();
                }
            });
            // Xem thÃªm bÃ¬nh luáº­n
            self.$c.find('.avs-comment-list-wrap').off('click', '.avs-load-more-btn').on('click', '.avs-load-more-btn', function () {
                $(this).prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Äang táº£i...');
                self.load(true);
            });
        },

        // â”€â”€ COMMENT DRAFTS â”€â”€
        saveDraft: function (content) {
            if (!window.localStorage) return;
            try {
                if (content && content.trim()) {
                    localStorage.setItem(this.draftKey, content);
                } else {
                    localStorage.removeItem(this.draftKey);
                }
            } catch (e) {
                console.warn('Cannot save draft:', e);
            }
        },

        restoreDraft: function () {
            if (!window.localStorage || !this.isLogin) return;
            try {
                var draft = localStorage.getItem(this.draftKey);
                if (draft && draft.trim()) {
                    var $editor = this.$c.find('.avs-main-editor');
                    if ($editor.length && !$editor.text().trim()) {
                        $editor.text(draft);
                        // Hiá»ƒn thá»‹ thÃ´ng bÃ¡o nháº¹
                        var $notice = $('<div class="avs-draft-notice" style="font-size:12px;color:#f9a825;margin-top:4px;"><i class="fa fa-info-circle"></i> ÄÃ£ khÃ´i phá»¥c ná»™i dung chÆ°a gá»­i</div>');
                        $editor.parent().append($notice);
                        setTimeout(function () { $notice.fadeOut(300, function () { $(this).remove(); }); }, 3000);
                    }
                }
            } catch (e) {
                console.warn('Cannot restore draft:', e);
            }
        },

        clearDraft: function () {
            if (!window.localStorage) return;
            try {
                localStorage.removeItem(this.draftKey);
            } catch (e) {
                console.warn('Cannot clear draft:', e);
            }
        },

        // â”€â”€ MENTION AUTOCOMPLETE â”€â”€
        buildMentionList: function () {
            var self = this;
            var users = [];
            var seen = {};
            // Láº¥y táº¥t cáº£ users tá»« comments Ä‘Ã£ load
            self.$c.find('.avs-comment-item').each(function () {
                var $item = $(this);
                var userId = parseInt($item.attr('data-user-id')) || 0;
                // Read handle from data-handle attribute (stable, machine-readable).
                // Visible text now shows display name which may contain spaces + Vietnamese
                // diacritics â€” using it would produce malformed @mention markers.
                var $u = $item.find('.avs-username').first();
                var userName = ($u.attr('data-handle') || '').trim();
                if (userId > 0 && userName && !seen[userId]) {
                    seen[userId] = true;
                    users.push({ id: userId, name: userName });
                }
            });
            self.mentionUsers = users;
        },

        setupMentionAutocomplete: function ($editor) {
            var self = this;
            var $dropdown = null;
            var selectedIndex = -1;

            function showDropdown(matches, caretPos) {
                hideDropdown();
                if (matches.length === 0) return;

                $dropdown = $('<div class="avs-mention-dropdown"></div>');
                $.each(matches, function (i, user) {
                    var $item = $('<div class="avs-mention-item" data-index="' + i + '">' + self.escHtml(user.name) + '</div>');
                    $dropdown.append($item);
                });

                // Position dropdown
                var editorOffset = $editor.offset();
                $dropdown.css({
                    position: 'absolute',
                    top: editorOffset.top + $editor.outerHeight(),
                    left: editorOffset.left,
                    zIndex: 9999
                });
                $('body').append($dropdown);
                selectedIndex = 0;
                updateSelection();

                // Click to select
                $dropdown.on('click', '.avs-mention-item', function () {
                    var idx = parseInt($(this).data('index'));
                    insertMention(matches[idx]);
                });
            }

            function hideDropdown() {
                if ($dropdown) {
                    $dropdown.remove();
                    $dropdown = null;
                }
                selectedIndex = -1;
            }

            function updateSelection() {
                if (!$dropdown) return;
                $dropdown.find('.avs-mention-item').removeClass('selected');
                $dropdown.find('.avs-mention-item').eq(selectedIndex).addClass('selected');
            }

            function insertMention(user) {
                var text = $editor.text();
                var caretPos = getCaretPosition($editor[0]);
                // TÃ¬m vá»‹ trÃ­ @ gáº§n nháº¥t trÆ°á»›c caret
                var atPos = text.lastIndexOf('@', caretPos - 1);
                if (atPos === -1) return;

                var before = text.substring(0, atPos);
                var after = text.substring(caretPos);
                var mention = /[^a-zA-Z0-9_]/.test(user.name) ? '@[' + user.name + ']' : '@' + user.name;
                var newText = before + mention + ' ' + after;

                $editor.text(newText);
                // Set caret sau mention
                var newCaretPos = before.length + mention.length + 1;
                setCaretPosition($editor[0], newCaretPos);
                hideDropdown();
            }

            function getCaretPosition(element) {
                var caretOffset = 0;
                var sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    var range = sel.getRangeAt(0);
                    var preCaretRange = range.cloneRange();
                    preCaretRange.selectNodeContents(element);
                    preCaretRange.setEnd(range.endContainer, range.endOffset);
                    caretOffset = preCaretRange.toString().length;
                }
                return caretOffset;
            }

            function setCaretPosition(element, offset) {
                var range = document.createRange();
                var sel = window.getSelection();
                var currentOffset = 0;
                var found = false;

                function traverse(node) {
                    if (found) return;
                    if (node.nodeType === 3) { // Text node
                        var nextOffset = currentOffset + node.length;
                        if (offset >= currentOffset && offset <= nextOffset) {
                            range.setStart(node, offset - currentOffset);
                            range.collapse(true);
                            found = true;
                        }
                        currentOffset = nextOffset;
                    } else {
                        for (var i = 0; i < node.childNodes.length; i++) {
                            traverse(node.childNodes[i]);
                            if (found) return;
                        }
                    }
                }
                traverse(element);
                if (found) {
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }

            // Bind events
            $editor.on('input', function () {
                var text = $editor.text();
                var caretPos = getCaretPosition($editor[0]);
                // TÃ¬m @ gáº§n nháº¥t trÆ°á»›c caret
                var atPos = text.lastIndexOf('@', caretPos - 1);
                if (atPos === -1 || caretPos - atPos > 30) {
                    hideDropdown();
                    return;
                }
                var query = text.substring(atPos + 1, caretPos).toLowerCase();
                console.log('[Mention] Query:', query, 'Users:', self.mentionUsers.length); // Debug log
                // Filter users
                if (self.mentionUsers.length === 0) self.buildMentionList();
                var matches = self.mentionUsers.filter(function (u) {
                    return u.name.toLowerCase().indexOf(query) !== -1;
                }).slice(0, 5);
                console.log('[Mention] Matches:', matches.length); // Debug log
                showDropdown(matches, caretPos);
            });

            $editor.on('keydown', function (e) {
                if (!$dropdown) return;
                var items = $dropdown.find('.avs-mention-item');
                if (e.keyCode === 38) { // Up
                    e.preventDefault();
                    selectedIndex = Math.max(0, selectedIndex - 1);
                    updateSelection();
                } else if (e.keyCode === 40) { // Down
                    e.preventDefault();
                    selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
                    updateSelection();
                } else if (e.keyCode === 13 || e.keyCode === 9) { // Enter or Tab
                    e.preventDefault();
                    var user = self.mentionUsers.filter(function (u) {
                        return u.name.toLowerCase().indexOf($editor.text().substring($editor.text().lastIndexOf('@', getCaretPosition($editor[0]) - 1) + 1, getCaretPosition($editor[0])).toLowerCase()) !== -1;
                    })[selectedIndex];
                    if (user) insertMention(user);
                } else if (e.keyCode === 27) { // Esc
                    hideDropdown();
                }
            });

            $(document).on('click', function (e) {
                if ($dropdown && !$(e.target).closest('.avs-mention-dropdown').length && !$(e.target).is($editor)) {
                    hideDropdown();
                }
            });
        },

        // â”€â”€ Voters Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        showVotersModal: function (commentId, initialTab) {
            var self = this;
            var $modal = $('#avs-voters-modal');

            // Táº¡o modal náº¿u chÆ°a cÃ³
            if (!$modal.length) {
                var modalHtml = '<div id="avs-voters-modal" class="avs-voters-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;z-index:10000;align-items:center;justify-content:center;">'
                    + '<div class="avs-voters-backdrop"></div>'
                    + '<div class="avs-voters-dialog">'
                    + '<div class="avs-voters-header">'
                    + '<span class="avs-voters-title">NgÆ°á»i tÆ°Æ¡ng tÃ¡c</span>'
                    + '<button class="avs-voters-close">&times;</button>'
                    + '</div>'
                    + '<div class="avs-voters-tabs">'
                    + '<button class="avs-voters-tab active" data-type="1"><i class="fa fa-thumbs-up"></i> Like <span class="avs-voters-tab-count">â€“</span></button>'
                    + '<button class="avs-voters-tab" data-type="-1"><i class="fa fa-thumbs-down"></i> Dislike <span class="avs-voters-tab-count">â€“</span></button>'
                    + '</div>'
                    + '<div class="avs-voters-body">'
                    + '<div class="avs-voters-list"></div>'
                    + '<div class="avs-voters-loading" style="display:none;text-align:center;padding:20px;color:#888;"><i class="fa fa-spinner fa-spin"></i> Äang táº£i...</div>'
                    + '<button class="avs-voters-more" style="display:none;width:100%;padding:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#aaa;cursor:pointer;border-radius:8px;margin-top:8px;">Xem thÃªm</button>'
                    + '</div>'
                    + '</div>'
                    + '</div></div>';
                $('body').append(modalHtml);
                $modal = $('#avs-voters-modal');

                // Close
                $modal.find('.avs-voters-close, .avs-voters-backdrop').on('click', function () {
                    $modal.hide();
                });

                // Tab switch â€” event delegation, commentId always current
                $modal.on('click', '.avs-voters-tab', function () {
                    var type = parseInt($(this).data('type'), 10);
                    $modal.find('.avs-voters-tab').removeClass('active');
                    $(this).addClass('active');
                    self._votersPage = 1;
                    self._votersTab = type;
                    self._loadVoters(self._votersCommentId, type, 1);
                });

                // Load more
                $modal.on('click', '.avs-voters-more', function () {
                    var nextPage = (self._votersPage || 1) + 1;
                    self._loadVoters(self._votersCommentId, self._votersTab || 1, nextPage);
                });
            }

            // Reset hoÃ n toÃ n khi má»Ÿ modal má»›i
            $modal.find('.avs-voters-tab-count').text('â€“');
            $modal.find('.avs-voters-tab').removeClass('active');
            $modal.find('.avs-voters-list').html('');
            $modal.find('.avs-voters-loading').hide();
            $modal.find('.avs-voters-more').hide();

            // Always update commentId so tab/load-more handlers use the right one
            self._votersCommentId = commentId;
            self._votersPage = 1;

            // Open
            $modal.show();

            var tab = initialTab || 1;
            self._votersTab = tab;

            // Load both tabs in parallel via Promise.all.
            // Each resolves â†’ its own badge updated.
            // Active tab's data is rendered by whichever response
            // for voteType===_votersTab arrives first.
            // NO redundant 3rd fetch: the .then() callback only
            // triggers a load when the USER switches tabs (via event handler),
            // not when promises resolve.
            var self2 = this;
            Promise.all([
                new Promise(function (resolve) { self2._loadVoters(commentId, 1, 1, resolve); }),
                new Promise(function (resolve) { self2._loadVoters(commentId, -1, 1, resolve); })
            ]);
        },

                // doneCb: callback khi xong (dÃ¹ng cho Promise.all)
        _loadVoters: function (commentId, voteType, page, doneCb) {
            var self = this;
            var $modal = $('#avs-voters-modal');
            var isActiveTab = (voteType === self._votersTab);

            if (isActiveTab) {
                $modal.find('.avs-voters-loading').show();
                $modal.find('.avs-voters-list').html('');
            }

            var url = this.ajaxUrl + '?action=get_voters&comment_id=' + commentId + '&vote_type=' + voteType + '&page=' + page + '&_=' + Date.now();
            console.log('[Voters] GET voteType=' + voteType + ' isActiveTab=' + isActiveTab + ':', url);

            $.getJSON(url, function (res) {
                console.log('[Voters] Response voteType=' + voteType + ':', res);

                // LuÃ´n cáº­p nháº­t count badge
                var total = res.total || 0;
                $modal.find('.avs-voters-tab[data-type="' + voteType + '"] .avs-voters-tab-count')
                    .text(total > 0 ? total : 'â€“');

                if (!res.success) {
                    console.warn('[Voters] Backend error:', res.error);
                    if (isActiveTab) {
                        $modal.find('.avs-voters-loading').hide();
                        $modal.find('.avs-voters-list').html(
                            '<div style="padding:20px;text-align:center;color:#e53935;font-size:13px;"><i class="fa fa-exclamation-triangle"></i> ' + (res.error || 'Lá»—i táº£i dá»¯ liá»‡u') + '</div>'
                        );
                    }
                    if (doneCb) doneCb();
                    return;
                }

                if (!res.voters || res.voters.length === 0) {
                    if (isActiveTab) {
                        $modal.find('.avs-voters-loading').hide();
                        $modal.find('.avs-voters-list').html(
                            '<div style="padding:30px 0;text-align:center;color:#666;font-size:14px;">ChÆ°a cÃ³ ai tÆ°Æ¡ng tÃ¡c</div>'
                        );
                    }
                    if (doneCb) doneCb();
                    return;
                }

                var html = '';
                for (var i = 0; i < res.voters.length; i++) {
                    var v = res.voters[i];
                    var youTag = v.is_current ? ' <span class="avs-voters-you">Báº¡n</span>' : '';
                    var vUrl = self.profileUrl(v.user_id);
                    var rowOpen = vUrl ? '<a class="avs-voter-row" href="' + vUrl + '">' : '<div class="avs-voter-row">';
                    var rowClose = vUrl ? '</a>' : '</div>';
                    html += rowOpen
                        + '<div class="avs-voter-avatar">' + self.avatarHtml(v.user_avatar, v.user_name) + '</div>'
                        + '<div class="avs-voter-info">'
                        + '<span class="avs-voter-name">' + self.escHtml(v.user_fullname || v.user_name || 'áº¨n danh') + youTag + '</span>'
                        + '</div>'
                        + rowClose;
                }

                if (isActiveTab) {
                    $modal.find('.avs-voters-loading').hide();
                    if (page === 1) {
                        $modal.find('.avs-voters-list').html(html);
                    } else {
                        $modal.find('.avs-voters-list').append(html);
                    }
                    self._votersPage = page;
                    $modal.find('.avs-voters-more').toggle(res.has_more);
                }

                if (doneCb) doneCb();
            }).fail(function (_xhr, status, err) {
                console.error('[Voters] AJAX fail voteType=' + voteType + ':', status, err);
                if (isActiveTab) {
                    $modal.find('.avs-voters-loading').hide();
                    $modal.find('.avs-voters-list').html(
                        '<div style="padding:20px;text-align:center;color:#e53935;font-size:13px;"><i class="fa fa-wifi"></i> Lá»—i káº¿t ná»‘i: ' + status + ' â€” ' + err + '</div>'
                    );
                }
                if (doneCb) doneCb();
            });
        },

        // â”€â”€ CENTRIFUGO REALTIME + SMART POLLING FALLBACK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        connectCentrifugo: function () {
            var self = this;
            var centrifuge = window.AvsCentrifugo && window.AvsCentrifugo.getInstance();
            if (!centrifuge || !self.centrifugoChannels || !self.centrifugoChannels.length) {
                self.startPolling();
                return;
            }
            try {
                self._centrifuge = centrifuge;

                var eventMap = {
                    'new_comment': 'onNewComment', 'new_reply': 'onNewReply',
                    'edit_comment': 'onEditComment', 'delete_comment': 'onDeleteComment',
                    'vote_update': 'onVoteUpdate', 'new_notification': 'onNewNotification',
                    'pin_comment': 'onPinComment', 'global_pin_comment': 'onGlobalPinComment',
                    'hide_comment': 'onHideComment', 'badge_update': 'onBadgeUpdate',
                    'mute_user': 'onMuteUser', 'bulk_hide_user': 'onBulkHideUser'
                };

                function onPublication(ctx) {
                    var d = ctx.data;
                    if (!d || !d.event) return;
                    var handler = eventMap[d.event];
                    if (handler && typeof self[handler] === 'function') {
                        self[handler](d.data);
                    }
                }

                // Subscribe to page/film channels + user channel
                for (var i = 0; i < self.centrifugoChannels.length; i++) {
                    var sub = window.AvsCentrifugo.subscribe(self.centrifugoChannels[i]);
                    if (!sub) continue;
                    sub.on('publication', onPublication);
                    sub.on('unsubscribed', function (ctx) {
                        if (ctx.code === 3500) { // recovery failed
                            self.load(); // reload from server
                        }
                    });
                }

                var _wasConnected = false;
                window.AvsCentrifugo.onConnect(function () {
                    _wasConnected = true;
                    self.stopPolling();
                    self.$c.find('.avs-rt-status').remove();
                });

                window.AvsCentrifugo.onDisconnect(function () {
                    self.startPolling();
                    if (_wasConnected && !self.$c.find('.avs-rt-status').length) {
                        self.$c.prepend('<div class="avs-rt-status" style="background:#fff3cd;color:#856404;border:1px solid #ffeeba;padding:8px 10px;border-radius:6px;margin-bottom:8px;font-size:12px;"><i class="fa fa-warning"></i> Realtime Ä‘ang giÃ¡n Ä‘oáº¡n, há»‡ thá»‘ng tá»± káº¿t ná»‘i láº¡i...</div>');
                    }
                });

                // If already connected, stop polling immediately
                if (self._centrifuge.state === 'connected') {
                    self.stopPolling();
                }
            } catch (e) {
                self.startPolling();
            }
        },

        startPolling: function () {
            var self = this;
            if (self._pollTimer) return;
            // Set lastId tá»« comments Ä‘Ã£ load Ä‘á»ƒ láº§n poll Ä‘áº§u khÃ´ng trigger thá»«a
            if (self._pollLastId === 0) {
                var $lastCmt = self.$c.find('.avs-comment-item[data-id]').first();
                if ($lastCmt.length) {
                    self._pollLastId = parseInt($lastCmt.attr('data-id'), 10) || 0;
                }
            }
            self._pollTimer = setInterval(function () {
                // KhÃ´ng poll khi tab áº©n
                if (document.hidden) return;
                self.pollComments();
            }, 3000);
        },

        stopPolling: function () {
            if (this._pollTimer) {
                clearInterval(this._pollTimer);
                this._pollTimer = null;
            }
        },

        pollComments: function () {
            var self = this;
            var url = self.ajaxUrl + '?action=poll&film_id=' + self.filmId
                + (self.pageUrl ? '&page_url=' + encodeURIComponent(self.pageUrl) : '')
                + '&last_id=' + self._pollLastId + '&_=' + Date.now();
            $.getJSON(url, function (res) {
                if (res.changed === false) return;
                if (res.success && res.max_id) {
                    self._pollLastId = parseInt(res.max_id, 10) || 0;
                    self.load(); // reload comments from server
                }
            });
        },

        // Helper: insert element after pinned comments
        prependAfterPinned: function ($list, $el) {
            var $lastPinned = $list.children('.avs-comment-global-pinned, .avs-comment-pinned').last();
            if ($lastPinned.length) {
                // Skip qua toggle button + replies div thuá»™c pinned comment
                var $after = $lastPinned;
                while ($after.next().length && ($after.next().is('.avs-toggle-replies') || $after.next().is('.avs-replies') || $after.next().is('.avs-reply-form-wrap'))) {
                    $after = $after.next();
                }
                $after.after($el);
            } else { $list.prepend($el); }
        },

        onNewComment: function (data) {
            var self = this;
            if (!data || !data.id) return;
            // Skip duplicate
            if (self.$c.find('[data-id="' + data.id + '"]').length) return;
            // Skip if optimistic element exists (user's own post being confirmed)
            if (self.$c.find('.avs-comment-optimistic').length) return;
            var $list = self.$c.find('.avs-comment-list-wrap ul.avs-comment-list');
            if (!$list.length) return;
            var $el = $(self.renderComment(data, false));
            $el.addClass('avs-comment-new');
            self.prependAfterPinned($list, $el);
            setTimeout(function () { $el.removeClass('avs-comment-new'); }, 2000);
            self.bindCommentEvents();
            // Update count
            var total = parseInt(self.$c.find('.avs-comment-count').text(), 10) || 0;
            self.$c.find('.avs-comment-count').text(total + 1);
        },

        onNewReply: function (data) {
            var self = this;
            if (!data || !data.id || !data.parent_id) return;
            if (self.$c.find('[data-id="' + data.id + '"]').length) return;
            // Skip if optimistic reply exists (user's own reply being confirmed via socket)
            var $repliesDiv = self.$c.find('#replies-' + data.parent_id);
            if ($repliesDiv.find('.avs-comment-optimistic').length) return;
            // Update total count
            var total = parseInt(self.$c.find('.avs-comment-count').text(), 10) || 0;
            self.$c.find('.avs-comment-count').text(total + 1);
            if ($repliesDiv.is(':visible')) {
                var $el = $(self.renderComment(data, true));
                $el.addClass('avs-comment-new');
                $repliesDiv.append($el);
                setTimeout(function () { $el.removeClass('avs-comment-new'); }, 2000);
                self.bindCommentEvents();
            } else {
                // Increment reply count on toggle button
                var $btn = self.$c.find('.avs-toggle-replies[data-id="' + data.parent_id + '"]');
                if ($btn.length) {
                    var count = parseInt($btn.data('count') || 0, 10) + 1;
                    $btn.data('count', count).html('<i class="fa fa-comments"></i> ' + count + ' tráº£ lá»i');
                }
            }
        },

        onEditComment: function (data) {
            var self = this;
            if (!data || !data.id) return;
            var $item = self.$c.find('[data-id="' + data.id + '"]').first();
            if (!$item.length) return;
            var content = self.parseStickers(self.escHtml(data.content || ''));
            $item.find('.avs-comment-content').first().html(content);
            // Show edited badge if not already present
            if (!$item.find('.avs-edited-badge').length) {
                $item.find('.avs-comment-content').first().after('<span class="avs-edited-badge"><i class="fa fa-pencil"></i> Ä‘Ã£ chá»‰nh sá»­a</span>');
            }
        },

        onDeleteComment: function (data) {
            var self = this;
            if (!data || !data.id) return;
            var $el = self.$c.find('[data-id="' + data.id + '"]').first();
            if (!$el.length) return;
            if (!data.parent_id || data.parent_id == 0) {
                // Top-level comment
                $el.fadeOut(300, function () { $(this).remove(); });
                if (typeof data.total === 'number') {
                    self.$c.find('.avs-comment-count').text(data.total);
                }
            } else {
                // Reply
                $el.fadeOut(300, function () { $(this).remove(); });
                var $btn = self.$c.find('.avs-toggle-replies[data-id="' + data.parent_id + '"]');
                if ($btn.length) {
                    var count = Math.max(0, parseInt($btn.data('count') || 0, 10) - 1);
                    $btn.data('count', count).html('<i class="fa fa-comments"></i> ' + count + ' tráº£ lá»i');
                }
            }
        },

        onVoteUpdate: function (data) {
            var self = this;
            if (!data || !data.id) return;
            var $item = self.$c.find('[data-id="' + data.id + '"]').first();
            if (!$item.length) return;
            $item.find('.up-count').text(data.votes_up);
            $item.find('.down-count').text(data.votes_down);
        },

        onNewNotification: function (data) {
            if (!data || typeof data.unread_count !== 'number') return;
            // Update notification badge in header (common pattern: .notif-count or #notifBadge)
            var $badge = $('.avs-notif-count, #notifBadge, .notif-count');
            if ($badge.length) {
                $badge.text(data.unread_count).toggle(data.unread_count > 0);
            }
        },

        // â”€â”€ ADMIN ACTION REALTIME HANDLERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        onPinComment: function (data) {
            var self = this;
            if (!data || !data.id) return;
            var $item = self.$c.find('[data-id="' + data.id + '"]').first();
            if (!$item.length) return;
            var $list = self.$c.find('.avs-comment-list-wrap ul.avs-comment-list');

            if (data.is_pinned == 1) {
                $item.addClass('avs-comment-pinned');
                // Add pin badge if not present
                if (!$item.find('.avs-badge-pinned, .relative').length) {
                    $item.find('.avs-comment-body').prepend(
                        '<div class="relative" style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
                        '<i class="fa fa-thumb-tack" style="color:#f59e0b;font-size:13px;"></i>' +
                        '<span style="font-size:12px;color:#f59e0b;font-weight:600;">ÄÃ£ ghim</span></div>'
                    );
                }
                // Move to pinned section (after global pinned, before normal)
                var $lastGlobalPinned = $list.children('.avs-comment-global-pinned').last();
                if ($lastGlobalPinned.length) { $lastGlobalPinned.after($item); } else { $list.prepend($item); }
            } else {
                $item.removeClass('avs-comment-pinned');
                // Remove pin badge
                $item.find('.avs-comment-body > .relative').first().remove();
                // Move back after all pinned
                self.prependAfterPinned($list, $item.detach());
            }
        },

        onGlobalPinComment: function (data) {
            var self = this;
            if (!data || !data.id) return;
            var $item = self.$c.find('[data-id="' + data.id + '"]').first();
            if (!$item.length) {
                // Comment not in DOM â€” reload to get it
                if (data.is_global_pinned == 1) self.load();
                return;
            }
            var $list = self.$c.find('.avs-comment-list-wrap ul.avs-comment-list');

            if (data.is_global_pinned == 1) {
                $item.removeClass('avs-comment-pinned').addClass('avs-comment-global-pinned');
                // Replace any pin badge with global pin badge
                $item.find('.avs-comment-body > .relative').first().remove();
                $item.find('.avs-badge-global-pinned').remove();
                $item.find('.avs-comment-body').prepend(
                    '<span class="avs-badge-global-pinned"><i class="fa fa-bullhorn"></i> Tin quan trá»ng</span>'
                );
                // Move to very top
                $list.prepend($item);
            } else {
                $item.removeClass('avs-comment-global-pinned');
                $item.find('.avs-badge-global-pinned').remove();
                // Reload to restore correct position
                self.load();
            }
        },

        onHideComment: function (data) {
            var self = this;
            if (!data || !data.id) return;

            if (data.hide == 1) {
                var $el = self.$c.find('[data-id="' + data.id + '"]').first();
                if (!$el.length) return;
                if (!data.parent_id || data.parent_id == 0) {
                    // Top-level: fadeOut + remove + update count
                    $el.fadeOut(300, function () { $(this).remove(); });
                    var total = parseInt(self.$c.find('.avs-comment-count').text(), 10) || 0;
                    if (total > 0) self.$c.find('.avs-comment-count').text(total - 1);
                } else {
                    // Reply: remove + decrement reply count
                    $el.fadeOut(300, function () { $(this).remove(); });
                    var $btn = self.$c.find('.avs-toggle-replies[data-id="' + data.parent_id + '"]');
                    if ($btn.length) {
                        var count = Math.max(0, parseInt($btn.data('count') || 0, 10) - 1);
                        $btn.data('count', count).html('<i class="fa fa-comments"></i> ' + count + ' tráº£ lá»i');
                    }
                }
            } else {
                // Unhide â€” reload list
                self.load();
            }
        },

        onBadgeUpdate: function (data) {
            var self = this;
            if (!data || !data.user_id) return;
            // Reload list to get updated badges
            self.load();
        },

        onMuteUser: function (data) {
            var self = this;
            if (!data) return;

            if (data.muted) {
                // Disable all editors
                self.$c.find('.avs-main-editor, .avs-editor').attr('contenteditable', 'false').css('opacity', '0.5');
                self.$c.find('.avs-comment-submit, .avs-reply-submit').prop('disabled', true);
                // Show mute notice
                if (!self.$c.find('.avs-mute-notice').length) {
                    var msg = data.minutes > 0
                        ? 'Báº¡n Ä‘Ã£ bá»‹ táº¯t bÃ¬nh luáº­n trong ' + data.minutes + ' phÃºt.'
                        : 'Báº¡n Ä‘Ã£ bá»‹ táº¯t bÃ¬nh luáº­n.';
                    self.$c.find('.avs-comment-form').prepend(
                        '<div class="avs-mute-notice" style="background:#fef2f2;border:1px solid #fecaca;color:#dc2626;padding:10px 14px;border-radius:8px;margin-bottom:10px;font-size:13px;">' +
                        '<i class="fa fa-ban" style="margin-right:6px;"></i>' + msg + '</div>'
                    );
                }
            } else {
                // Re-enable editors
                self.$c.find('.avs-main-editor, .avs-editor').attr('contenteditable', 'true').css('opacity', '');
                self.$c.find('.avs-comment-submit, .avs-reply-submit').prop('disabled', false);
                self.$c.find('.avs-mute-notice').remove();
            }
        },

        onBulkHideUser: function (data) {
            var self = this;
            if (!data || !data.user_id) return;
            if (data.hide) {
                // áº¨n táº¥t cáº£ comments cá»§a user bá»‹ ban trÃªn trang hiá»‡n táº¡i
                self.$c.find('[data-user-id="' + data.user_id + '"]').each(function () {
                    var $el = $(this);
                    $el.fadeOut(300, function () { $(this).remove(); });
                });
                // Cáº­p nháº­t count
                self.load();
            } else {
                // Unban: reload Ä‘á»ƒ hiá»‡n láº¡i
                self.load();
            }
        },
    };

    window.AvsComment = {
        init: function (opts) {
            var inst = Object.create(AvsCommentProto);
            inst.init(opts);
            return inst;
        }
    };

})(jQuery);

