if (!pautonext) {
    var pautonext = true
}
// Helper: tìm link tập kế tiếp từ DOM thay vì AJAX
function _getNextEpisodeUrl(episodeId) {
    var $current = $("ul.list-episode li a[data-id='" + episodeId + "']").closest("li");
    if (!$current.length) return '';
    // Tìm trong cùng server (ul.list-episode)
    var $next = $current.next("li.episode").find("a.episode-link");
    return $next.length ? $next.attr("href") : '';
}
if (!resizePlayer) {
    var resizePlayer = false
}
if (!light) {
    var light = true
}
if (!miniPlayer) {
    var miniPlayer = false
}
var PlayerLoad = MAIN_URL + "/ajax/player";
var EPISODE_LINK_ID = '.list-server';
var EPISODE_CLASS_ACTIVE = 'active';
var EPISODE_CLASS_NOACTIVE = '';


var orgPlayerSize = {
    "width": 0,
    "height": 0
};
var docHeight = 17;
var Player = {};

// ═══════════════════════════════════════════════════════════════
// BROWSER COMPATIBILITY: Check for required features
// Warn users if their browser doesn't support HLS, Crypto API, etc.
// ═══════════════════════════════════════════════════════════════
(function checkBrowserCompatibility() {
    var warnings = [];
    var isOldBrowser = false;

    // Check for ES6 features
    try {
        eval('const test = () => {};');
    } catch (e) {
        warnings.push('Trình duyệt của bạn không hỗ trợ JavaScript hiện đại (ES6)');
        isOldBrowser = true;
    }

    // Check for Crypto API (needed for token decryption)
    if (!window.crypto || !window.crypto.subtle) {
        warnings.push('Trình duyệt của bạn không hỗ trợ Web Crypto API');
        isOldBrowser = true;
    }

    // Check for atob/btoa (base64 decode/encode)
    if (typeof atob === 'undefined' || typeof btoa === 'undefined') {
        warnings.push('Trình duyệt của bạn không hỗ trợ Base64 encoding');
        isOldBrowser = true;
    }

    // Check for localStorage
    try {
        localStorage.setItem('test', 'test');
        localStorage.removeItem('test');
    } catch (e) {
        warnings.push('Trình duyệt của bạn không hỗ trợ Local Storage');
    }

    // Check for HLS support (via Media Source Extensions)
    var video = document.createElement('video');
    var hasHLS = video.canPlayType('application/vnd.apple.mpegurl') ||
                 video.canPlayType('application/x-mpegURL') ||
                 (window.MediaSource && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'));

    if (!hasHLS) {
        warnings.push('Trình duyệt của bạn có thể không hỗ trợ HLS video streaming');
    }

    // Detect specific old browsers
    var ua = navigator.userAgent;
    if (ua.indexOf('MSIE') !== -1 || ua.indexOf('Trident/') !== -1) {
        warnings.push('Internet Explorer không được hỗ trợ. Vui lòng dùng Chrome, Firefox, hoặc Edge');
        isOldBrowser = true;
    }

    // Show warning if issues detected
    if (warnings.length > 0) {
        console.warn('[BROWSER COMPAT] Issues detected:', warnings);

        if (isOldBrowser) {
            var message = '⚠️ CẢNH BÁO: Trình duyệt của bạn quá cũ!\n\n' +
                         warnings.join('\n') +
                         '\n\nVideo có thể không phát được. Vui lòng cập nhật trình duyệt hoặc dùng:\n' +
                         '• Google Chrome (khuyến nghị)\n' +
                         '• Mozilla Firefox\n' +
                         '• Microsoft Edge\n' +
                         '• Safari (iOS/Mac)';

            // Show alert after page loads
            setTimeout(function() {
                alert(message);
            }, 1000);
        }
    } else {
        console.log('[BROWSER COMPAT] All checks passed ✓');
    }
})();

$(document).ready(function() {
    jQuery.cachedScript = function(url, options) {
        options = $.extend(options || {}, {
            dataType: "script",
            cache: true,
            url: url
        });
        return jQuery.ajax(options);
    };
    $("body").on("click", "#links-backup a", function(event) {
        event.preventDefault();
        var deepDataAndEvents = filmInfo.filmID;
        var $this = $(this);
        var backupId = $(this).data("id");
        var backupPlay = $(this).data("play");
        var backupLink = $(this).data("href");

        // Save preferred backup server to localStorage
        try {
            localStorage.setItem('preferred_backup_server', backupId);
            console.log('[SERVER PREF] Saved preferred backup server:', backupId);
        } catch(e) {
            console.warn('[SERVER PREF] Failed to save preference:', e);
        }

        fx.scrollTo("#watch-block", 1E3);
        $("#links-backup a").removeClass("active");
        $this.addClass("active");
        $.ajax({
            type: "POST",
            url: PlayerLoad,
            dataType: "json",
            data: {
                "link": backupLink,
                "play": backupPlay,
                "id": backupId,
                "backuplinks": 1
            },
            success: function(f) {
                if (f.success == 1) {
                    if (f.playTech == "api" || f.playTech == "all") {
                        if ("string" == typeof f.link) {
                            jQuery("#media-player").empty().html('<span style="vertical-align: middle;text-align: center;display: table-cell;font-style: normal;font-variant: normal;font-weight: normal;font-stretch: normal;font-size: 23px;line-height: 20px;">' + f.link + "</span>").css({
                                "display": "table",
                                "background": "#000"
                            });
                        } else {
                            var sources = [];
                            jQuery.each(f.link, function(dataAndEvents, file) {
                                file.file = file.file.replace("&http", "http");
                                sources.push(file);
                            });
                            PLTV.PlayerBackup(f.playTech, sources);
                        }
                    } else if (f.playTech == "iframe") {
                        jQuery("#media-player").empty().html('<iframe src="' + f.link + '" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen"></iframe>');
                    } else {
                        var sources = [];
                        var value = [];
                        value.type = "mp4";
                        value.mimeType = "video/mp4";
                        value.file = f.link;
                        value.default = true;
                        value.label = "720";
                        sources.push(value);
                        PLTV.PlayerBackup(f.playTech, sources);
                    }
                }
            },
            error: function(textStatus) {
                console.log("Ajax error!");
            }
        });
    });
});
var LoadLinksBackup = function(episodeId) {
    $.ajax({
        type: "POST",
        url: PlayerLoad,
        dataType: "json",
        data: {
            "episodeId": episodeId,
            "backup": 1
        },
        success: function(f) {
            if (f.success == 1) {
                $("#links-backup").html(f.html);

                // Auto-load preferred backup server if exists
                try {
                    var preferredBackupId = localStorage.getItem('preferred_backup_server');
                    if (preferredBackupId !== null && preferredBackupId !== '') {
                        // Skip auto-load if preferred server is data-id="0" (DU - main server)
                        // because main player already loaded it
                        if (preferredBackupId === '0') {
                            console.log('[SERVER PREF] Preferred server is DU (main), skipping auto-load');
                            return;
                        }

                        console.log('[SERVER PREF] Checking for preferred backup server:', preferredBackupId);

                        // Find button with preferred backup ID
                        var $preferredBtn = $("#links-backup a[data-id='" + preferredBackupId + "']");
                        if ($preferredBtn.length > 0) {
                            console.log('[SERVER PREF] Auto-loading preferred backup server:', preferredBackupId);
                            // Auto-click after a short delay to ensure DOM is ready
                            setTimeout(function() {
                                $preferredBtn.click();
                            }, 100);
                        } else {
                            console.log('[SERVER PREF] Preferred backup server not available, using default');
                        }
                    }
                } catch(e) {
                    console.warn('[SERVER PREF] Failed to load preference:', e);
                }
            }
        },
        error: function(textStatus) {
            console.log("Ajax error!");
        }
    });
    return false;
}
var AnimeVsub = function(level, deepDataAndEvents) {
    fx.scrollTo("#watch-block", 1E3);
    var episodeId = parseInt($(".list-episode a[data-hash='" + level + "']").data("id"));
    var href = $(".list-episode a[data-hash='" + level + "']").attr("href");
    $(".list-episode a").attr("data-movie", "");
    $(".list-episode a[data-id='" + episodeId + "']").attr("data-movie", "playing");
    if (href != window.location) window.history.pushState({
        path: href
    }, "", href);
    $(EPISODE_LINK_ID + " a").removeClass(EPISODE_CLASS_ACTIVE).addClass(EPISODE_CLASS_NOACTIVE);
    $(EPISODE_LINK_ID).find("a[data-id='" + episodeId + "']").removeClass(EPISODE_CLASS_NOACTIVE).addClass(EPISODE_CLASS_ACTIVE);
    $.ajax({
        type: "POST",
        url: PlayerLoad,
        dataType: "json",
        data: {
            "link": level,
            "id": deepDataAndEvents
        },
        success: function(f) {
            jQuery("#player-loading").css({
                "display": "none"
            });
            if (f.playTech == "api" || f.playTech == "all") {
                if (void 0 !== f.success) {
                    if ("string" == typeof f.link) {
                        jQuery("#media-player").empty().html('<span style="vertical-align: middle;text-align: center;display: table-cell;font-style: normal;font-variant: normal;font-weight: normal;font-stretch: normal;font-size: 23px;line-height: 20px;">' + f.link + "</span>").css({
                            "display": "table",
                            "background": "#000"
                        });
                    } else {
                        sources = [];
                        jQuery.each(f.link, function(dataAndEvents, file) {
                            file.file = file.file.replace("&http", "http");
                            sources.push(file);
                        });
                        PLTV.Player(f.playTech, sources, href);
                    }
                }
            } else if (f.playTech == "embed") {
                sources = [];
                var value = [];
                value.type = "mp4";
                value.mimeType = "video/mp4";
                value.file = f.link;
                value.default = true;
                value.label = "720";
                sources.push(value);
                PLTV.Player(f.playTech, sources);
            } else if (f.playTech == "iframe") {
                jQuery("#media-player").empty().html('<iframe src="' + f.link + '" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen"></iframe>');
            }
        },
        error: function(textStatus) {
            console.log("Ajax error!");
        }
    });
};

function reloadPlayer(a, b, c) {
    var el = document.getElementById("media-player");
    a = jwplayer().getPosition();
    b = el.offsetWidth;
    c = el.offsetHeight;
    PLTV();
}

function adSkip(t) {
    t.parentNode.removeChild(t);
    if (document.getElementById("media-player").querySelector("iframe") !== null) {
        jwplayer().skipAd();
        var x = document.getElementById("media-player").querySelector("iframe");
        x.remove(0);
    } else {
        jwplayer().skipAd();
    }
}




function setupJWPlayer(source, level, XMLFile) {
    jwplayer.key = 'W7zSm81+mmIsg7F+fyHRKhF3ggLkTqtGMhvI92kbqf/ysE99';
    var PlayerME = jwplayer("media-player");
    PlayerME.setup({
        height: "100%",
        sources: source,
        mute: false,
        allowfullscreen: true,
        playbackRateControls: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2],
        preload: "auto",
        primary: "html5",
        image: "https://lh6.googleusercontent.com/DKOFK047OChE35TAROUux9747riGULvvKG4In3skBqZkMoa3VI4FJ81wEQkOLVPkp7GgbDykG6tlSw45h46awqVeWJ1WG1laAb-Bo0k2Ht1f6szHKoyK3btYYnk=s0",
        width: "100%",
        aboutlink: "https://linktr.ee/animevietsub",
        abouttext: "Thông tin về AnimeVietsub",
        cast: {},
        captions: {
            color: "#ffffff",
            fontSize: 20,
            backgroundOpacity: 0,
            fontfamily: "Arial",
            edgeStyle: "raised"
        },
        skin: {
            name: "animevsub",
            url: "./statics/player/skin/skinavs.css?v=1.1.1"
        }
    });

    // Event Handlers
    PlayerME.on('time', function(e) {
        $cookie.setItem('resumevideodata' + level, Math.floor(e.position) + ':' + PlayerME.getDuration());
    });

    PlayerME.addButton("./statics/player/skin/svg/skip-forward.svg?v=1.0", "Skip OP/ED", function() {
        let skip_time = parseInt(PlayerME.getPosition()) + 90;
        PlayerME.seek(skip_time);
    }, "skipButton");

    PlayerME.addButton("./statics/player/skin/svg/forward_5s.svg", "Tua tiếp 5s", function() {
        PlayerME.seek(parseInt(PlayerME.getPosition()) + 5);
    }, "Tua tiếp 5s");

    PlayerME.addButton("./statics/player/skin/svg/replay_5s.svg", "Tua lại 5s", function() {
        PlayerME.seek(parseInt(PlayerME.getPosition()) - 5);
    }, "Tua lại 5s");

    PlayerME.on('play', () => {
        let pgLoad = document.querySelector('#progress-load');
        if (pgLoad != null) {
            pgLoad.innerHTML = '';
        }
    });

    let adSkipButton;
    PlayerME.on('adImpression', function() {
        let mediaPlayer = document.getElementById("media-player");
        mediaPlayer.querySelector(".jw-aspect").insertAdjacentHTML("afterend", "<div class='av-skip' style='padding: 0.9em;pointer-events: all;z-index:99999999;border: 1px solid #333;background-color: #000 !important;font-size: 15px!important;text-shadow: 1px 1px 2px #000;position: absolute;float: right;display: none;right: 10px;top: 12px;color: #fff;' onClick='adSkip(this)'>Bỏ Qua Quảng Cáo</div>");
        setTimeout(function() {
            adSkipButton = mediaPlayer.querySelector(".av-skip");
            adSkipButton.style.display = 'inline-block';
        }, 13000);
    });

    PlayerME.on('adComplete', function() {
        if (adSkipButton) {
            adSkipButton.parentNode.removeChild(adSkipButton);
        }
    });

    PlayerME.on('adSkipped', function() {
        if (adSkipButton) {
            adSkipButton.parentNode.removeChild(adSkipButton);
        }
    });

    $("#media-player").focus();

    PlayerME.on('ready', function(event) {
        let cookieData = $cookie.getItem('resumevideodata' + level);
        if (cookieData) {
            let [resumeAt, videoDur] = cookieData.split(':');
            let seconds = parseInt(resumeAt);
            if (seconds < parseInt(videoDur)) {
                let hours = Math.floor(seconds / 3600);
                let minutes = Math.floor((seconds % 3600) / 60);
                seconds = seconds % 60;
                let formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                Lobibox.confirm({
                    msg: "AnimeVsub ghi nhận bạn đang xem đã từng anime này trước đó!<br /> Bạn có muốn xem tiếp đoạn: <b>" + formattedTime + "</b> ?",
                    callback: function($this, type) {
                        if (type === 'yes') {
                            PlayerME.seek(parseInt(resumeAt));
                            console.log('Resuming at ' + resumeAt);
                        }
                    }
                });
            }
        } else {
            console.log('No video resume cookie detected. Refresh page.');
        }
    });

    PlayerME.on('complete', function(e) {
        var nextEpisodeURL = XMLFile || window.currentXMLFile;
        if (pautonext && nextEpisodeURL) {
            window.location.href = nextEpisodeURL;
        }
    });

    PlayerME.on("pause", function() {
        jQuery("#invideo_wrapper").css({
            "display": "block"
        });
        jQuery("#close-and-play").on("click", function() {
            PlayerME.play(true);
            jQuery("#invideo_wrapper").css({
                "display": "none"
            });
        });
    });

    PlayerME.on("play", function() {
        jQuery("#invideo_wrapper").css({
            "display": "none"
        });
    });

    PlayerME.on("error", function(e) {
        console.error("Player Error:", e.message);
        PlayerME.play(true);
        jQuery("#media-player").empty().html('<img src="./statics/images/error.png" alt="AnimeVsub Sorry">');
    });

    PlayerME.on("setupError", function(e) {
        console.error("Setup Error:", e.message);
        PlayerME.play(true);
        jQuery("#media-player").empty().html('<img src="./statics/images/error.png" alt="AnimeVsub Sorry">');
    });

}

var PLTV = {
    readXml: function(xmlFile, json) {
        var xmlDoc;
        var fileXML = '';

        if (typeof window.DOMParser != "undefined") {
            var xmlhttp = new XMLHttpRequest();
            xmlhttp.open("GET", xmlFile, false);
            if (xmlhttp.overrideMimeType) {
                xmlhttp.overrideMimeType('text/xml');
            }
            xmlhttp.send();

            // Kiểm tra xem có lỗi khi tải XML không
            if (xmlhttp.status != 200) {
                fx.alertMessage("Rất tiếc", "Trình duyệt của bạn không load được danh sách tập, hãy thử trình duyệt khác hoặc dùng ẩn danh", 'info');
                console.error("Failed to load XML. Status: " + xmlhttp.status);
                return fileXML;
            }

            xmlDoc = xmlhttp.responseXML;
        } else {
            xmlDoc = new ActiveXObject("Microsoft.XMLDOM");
            xmlDoc.async = "false";
            xmlDoc.load(xmlFile);
        }

        // Kiểm tra xem xmlDoc có tồn tại và không phải là null
        if (xmlDoc && xmlDoc.getElementsByTagName) {
            var tagObj = xmlDoc.getElementsByTagName("item");

            if (tagObj && tagObj.length > 0) {
                var fileXMLs = tagObj[0].getElementsByTagName(json)[0];

                if (fileXMLs && fileXMLs.childNodes && fileXMLs.childNodes.length > 0) {
                    fileXML = fileXMLs.childNodes[0].nodeValue;
                }
            }
        } else {
            console.error("xmlDoc is null or undefined.");
        }

        return fileXML;
    },
    showDialog: function(_title, _arrButton) {
        $("#media-player_download").remove();
        $("#media-player_related").empty();
        var elem = document.createElement("div");
        elem.setAttribute("id", "media-player_download");
        elem.setAttribute("class", "jw-plugin jw-reset jw-plugin-download jw-plugin-download-open");
        var elemNode = document.createElement("div");
        elemNode.setAttribute("class", "jw-download jw-overlay jw-overlay-open");
        var elemButtonClose = document.createElement("button");
        elemButtonClose.setAttribute("class", "jw-download-close");
        elemButtonClose.setAttribute("aria-label", "Đóng");
        $(elemNode).append(elemButtonClose);
        var elemContainer = document.createElement("div");
        elemContainer.setAttribute("class", "jw-download-container");
        if (0 == _arrButton.length) {
            var elemItem = document.createElement("div");
            elemItem.setAttribute("class", "jw-download-item-1");
            elemItem.setAttribute("id", "jw-download-item");
            $(elemItem).text("Tập phim này chưa hỗ trợ download hoặc Link Video Die");
            $(elemContainer).append(elemItem);
        } else {
            var n = 0;
            for (; n < _arrButton.length; n++) {
                var lineSeparator = PLTV.addButton(_arrButton[n], _arrButton.length);
                $(elemContainer).append(lineSeparator);
            }
        }
        $(elemNode).append(elemContainer);
        $(elem).append(elemNode);
        $(".jw-overlays").append(elem);
        $(elem).on("click", ".jw-download-close", function() {
            $(elem).removeClass("jw-plugin-download-open").empty();
        });
    },
    addButton: function(item, length) {
        var elem = document.createElement("a");
        elem.setAttribute("id", "jw-download-item");
        return $(elem).addClass("jw-download-item-" + length), $(elem).html(item.label), $(elem).click(function() {
            if ("function" == typeof item.callback) {
                var actionFound = $(this).text();
                item.callback(actionFound);
            }
        }), elem;
    },
    output: function(h) {
        var output = "";
        h = h.split("&");
        var i = 0;
        for (; i < h.length; i++) {
            if (-1 != h[i].indexOf("%2Cexpire") || -1 != h[i].indexOf(",expire")) {
                output += (i ? "&" : "") + h[i];
            } else if (-1 != h[i].indexOf("expire")) {
                var prevTuple = h[i].split("=");
                output = output + ("&" + prevTuple[0] + "=");
                output = output + PLTV.decode(prevTuple[1]);
            } else {
                output += (i ? "&" : "") + h[i];
            }
        }
        return output;
    },
    decode: function(key) {
        key = key.replace(".", "");
        var a = b = "";
        var z = 0;
        for (; z <= key.length - 1; z++) {
            var i = 0;
            for (; i <= key.length - 1; i++) {
                if (1 == i % 2) {
                    b += key.split("")[i];
                } else {
                    if (0 == i % 2) {
                        a += key.split("")[i];
                    }
                }
            }
            key = a + b;
            a = b = "";
        }
        return key;
    },
    Remember: function(i) {
        var _0x8fcexf = jwplayer().getState();
        if (_0x8fcexf == "complete") {
            setCookie("filmPosition" + i, 0, 7);
        } else {
            setCookie("filmPosition" + i, Math.round(jwplayer().getPosition()), 7);
            setTimeout("PLTV.Remember()", 5E3);
        }
    },
    Remember2: function(i) {
        var _0x8fcexf = jwplayer().getState();
        if (_0x8fcexf == "IDLE") {
            setCookie("filmPosition" + i, 0, 7);
        } else {
            setCookie("filmPosition" + i, Math.round(jwplayer().getPosition()), 7);
            setTimeout("PLTV.Remember2()", 5E3);
        }
    },
    Player: function(deepDataAndEvents, sources, href) {
        var message = parseInt(fx.getCookie("watchedEpisodeId"));
        var level = parseInt($(EPISODE_LINK_ID + " a[data-movie='playing']").data("id"));
        var XMLFile = _getNextEpisodeUrl(level);

        if (!XMLFile) {
            pautonext = false;
            jQuery("#autonext-status").html("T\u1eaft");
        } else {
            jQuery("#autonext-status").html("B\u1eadt");
        }

        if (!XMLFile) {
            pautonext = false;
        }

        var name = deepDataAndEvents;
        var source = $("li.episode a[data-movie='playing']").data("source");


        if (name == "api" || name == "all") {
            if (sources && sources.length > 0) {
                var file = sources[0].file;
                if (file.includes(".mp4")) {
                    setupJWPlayer(sources, level, XMLFile);
                }else{
                    setupJWPlayer(sources, level, XMLFile);
                }
            } else {
                setupJWPlayer(sources);
                console.error("No sources available");
            }
        } else if (name == "embed") {
            var $File = sources[0].file;
            let $html;
            if ($File.includes("drive.google.com") || $File.includes("docs.google.com")) {
                let Drive = $File.replace("/view", "/preview").replace("drive.google.com", "docs.google.com");
                $html = '<iframe src="' + Drive + '" width="100%" height="100%" style="border:none;height: 100%;" allowfullscreen></iframe>';
            } else if ($File.includes("youtube.com")) {
                let Youtube = $File.replace("watch?v=", "embed/");
                $html = '<iframe src="' + Youtube + '?wmode=transparent&iv_load_policy=3&modestbranding=1&rel=0&autohide=1&autoplay=1" sandbox="allow-same-origin allow-scripts" width="100%" height="100%" style="border:none;height: 100%;" allowfullscreen></iframe>';
            } else {
                $html = '<iframe src="' + $File + '" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen></iframe>';
            }
            jQuery("#media-player").empty().html($html);
        } else if (name == "iframe") {
            jQuery("#media-player").empty().html('<iframe src="' + sources + '" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen"></iframe>');
        }

        jQuery.post(AjaxURL, {
            EpisodeMess: 1,
            EpisodeID: level
        }, function(deepDataAndEvents) {
            if (deepDataAndEvents == 0) {
                jQuery("#movie-notice-box").css({
                    "display": "none"
                });
            } else {
                jQuery("#movie-notice-box").html(deepDataAndEvents).css({
                    "display": "block"
                });
            }
        });

        return false;
    },
    //backup
    PlayerBackup: function(deepDataAndEvents, sources, href) {
        var message = parseInt(fx.getCookie("watchedEpisodeId"));
        var level = parseInt($(EPISODE_LINK_ID + " a[data-movie='playing']").data("id"));
        var XMLFile = _getNextEpisodeUrl(level);
        if (!XMLFile) {
            pautonext = false;
            jQuery("#autonext-status").html("T\u1eaft");
        } else {
            jQuery("#autonext-status").html("B\u1eadt");
        }
        if (!XMLFile) {
            pautonext = false;
        }
        var name = deepDataAndEvents;
        var source = $("li.episode a[data-movie='playing']").data("source");
        if (name == "api" || name == "all") {
            if (sources && sources.length > 0) {
                var file = sources[0].file;
                if (file.includes(".mp4")) {
                    setupJWPlayer(sources, level, XMLFile);
                }else{
                    setupJWPlayer(sources, level, XMLFile);
                }
            } else {
                setupJWPlayer(sources);
                console.error("No sources available");
            }
        } else if (name == "embed") {
            jwplayer.key = 'dWwDdbLI0ul1clbtlw+4/UHPxlYmLoE9Ii9QEw==';
            jwplayer("media-player").remove();
            var $File = sources[0].file;
            if (-1 !== $File.indexOf("drive.google.com") || -1 !== sources[0].file.indexOf("docs.google.com")) {
                var Drive = $File.replace("/view", "/preview");
                Drive = Drive.replace("drive.google.com", "docs.google.com");
                var $html = '<iframe src="' + Drive + '" width="100%" height="100%" style="border:none;height: 100%;" allowfullscreen></iframe>';
            } else if (-1 !== $File.indexOf("youtube.com")) {
                var Youtube = $File.replace("watch?v=", "embed/");
                var $html = '<iframe src="' + Youtube + '?wmode=transparent&iv_load_policy=3&modestbranding=1&rel=0&autohide=1&autoplay=1" sandbox="allow-same-origin allow-scripts" width="100%" height="100%" style="border:none;height: 100%;" allowfullscreen></iframe>';
            } else {
                var $html = '<iframe src="' + $File + '" width="100%" height="100%" style="border:none;height: 100%;" allowfullscreen></iframe>';
            }
            jQuery("#media-player").empty().html($html);
        } else if (name == "iframe") {
            jQuery("#media-player").empty().html('<iframe src="' + sources + '" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen"></iframe>');
        }
        jQuery.post(AjaxURL, {
            EpisodeMess: 1,
            EpisodeID: level
        }, function(deepDataAndEvents) {
            if (deepDataAndEvents == 0) {
                jQuery("#movie-notice-box").css({
                    "display": "none"
                });
            } else {
                jQuery("#movie-notice-box").html(deepDataAndEvents).css({
                    "display": "block"
                });
            }
        });
        return false;
    }
};
var $cookie = {
    getItem: function(sKey) {
        return decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + encodeURIComponent(sKey).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1")) || null;
    },
    setItem: function(sKey, sValue, sPath, vEnd, sDomain, bSecure) {
        if (!sKey || /^(?:expires|max\-age|path|domain|secure)$/i.test(sKey)) {
            return false;
        }
        var sExpires = "";
        if (vEnd) {
            switch (vEnd.constructor) {
                case Number:
                    sExpires = vEnd === Infinity ? "; expires=Fri, 31 Dec 9999 23:59:59 GMT" : "; max-age=" + vEnd;
                    break;
                case String:
                    sExpires = "; expires=" + vEnd;
                    break;
                case Date:
                    sExpires = "; expires=" + vEnd.toUTCString();
                    break;
            }
        }
        document.cookie = encodeURIComponent(sKey) + "=" + encodeURIComponent(sValue) + sExpires + (sDomain ? "; domain=" + sDomain : "") + (sPath ? "; path=" + sPath : "") + (bSecure ? "; secure" : "");
        return true;
    },
    removeItem: function(sKey, sPath, sDomain) {
        if (!sKey || !this.hasItem(sKey)) {
            return false;
        }
        document.cookie = encodeURIComponent(sKey) + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT" + (sDomain ? "; domain=" + sDomain : "") + (sPath ? "; path=" + sPath : "");
        return true;
    },
    hasItem: function(sKey) {
        return (new RegExp("(?:^|;\\s*)" + encodeURIComponent(sKey).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=")).test(document.cookie);
    },
    keys: function() {
        var aKeys = document.cookie.replace(/((?:^|\s*;)[^\=]+)(?=;|$)|^\s*|\s*(?:\=[^;]*)?(?:\1|$)/g, "").split(/\s*(?:\=[^;]*)?;\s*/);
        for (var nIdx = 0; nIdx < aKeys.length; nIdx++) {
            aKeys[nIdx] = decodeURIComponent(aKeys[nIdx]);
        }
        return aKeys;
    }
};
jQuery(document).ready(function(dataAndEvents) {
    jQuery("#btn-autonext").on("click", function() {
        if (pautonext) {
            jQuery("#autonext-status").html("T\u1eaft");
            pautonext = false;
        } else {
            jQuery("#autonext-status").html("B\u1eadt");
            pautonext = true;
        }
        return false;
    });
    jQuery("#btn-light").on("click", function() {
        if (light == true) {
            jQuery("body").append('<div id="light-overlay" style="position: fixed; z-index: 999; background-color: rgb(0, 0, 0); opacity: 1; top: 0px; left: 0px; width: 100%; height: 100%;"></div>');
            jQuery("#watch-block").css({
                "z-index": "1000",
                "position": "relative"
            });
            jQuery(this).html("B\u1eadt \u0111\u00e8n");
            light = false;
        } else {
            jQuery("div#light-overlay").remove();
            jQuery("#watch-block").css({
                "z-index": "1000",
                "position": "relative"
            });
            jQuery(this).html("T\u1eaft \u0111\u00e8n");
            light = true;
        }
        fx.scrollTo("#watch-block", 1E3);
        return false;
    });
    jQuery("#btn-add-favorite").on("click", function() {
        jQuery.post("/ajax/like", {
            filmLike: 1,
            filmID: filmInfo.filmID
        }, function(dataAndEvents) {
            if (dataAndEvents == 1) {
                fx.alertMessage("Xin chào!", "Bạn cần đăng nhập để sử dụng chức năng này!", 'error');
            } else {
                if (dataAndEvents == 2) {
                    fx.alertMessage("Rất tiếc", "Phim đã bị bỏ theo dõi", 'error');
                    jQuery("#btn-add-favorite").text("Theo dõi phim");
                } else {
                    if (dataAndEvents == 3) {
                        $(this).html("Bỏ theo dõi phim");
                        fx.alertMessage("Chúc mừng", "Phim đã được bạn theo dõi và thêm vào tủ phim", 'success');
                        jQuery("#btn-add-favorite").text("Bỏ theo dõi");
                    }
                }
            }
        });
        return false;
    });
    jQuery("#btn-expand").on("click", function() {
        if (resizePlayer == false) {
            orgPlayerSize.width = jQuery("#media-player-box").width();
            orgPlayerSize.height = jQuery("#media-player-box").height();
            var newWidth = 1106;
            var size = {
                "width": newWidth,
                "height": Math.ceil(newWidth / 16 * 9 - docHeight)
            };
            jQuery("#media-player-box").animate({
                width: size.width,
                height: size.height
            });
            jQuery(".MovieTabNav.ControlPlayer").css({
                "display": "none"
            });
            jQuery("#watch-block").animate({
                width: newWidth
            }).addClass("expand");
            jQuery("body").append('<div id="light-overlay" style="position: fixed; z-index: 999; background-color: rgb(0, 0, 0); opacity: 0.8; top: 0px; left: 0px; width: 100%; height: 100%;"></div>');
            fx.scrollTo("#watch-block", 1E3);
            jQuery("#expand-status").html("Thu nh\u1ecf");
            resizePlayer = true;
        } else {}
        return false;
    });
    jQuery("#btn-re-expand").on("click", function() {
        if (resizePlayer == true) {
            jQuery("#media-player-box").animate({
                "width": "100%",
                "height": "435px"
            });
            jQuery("#watch-block").animate({
                width: "100%"
            }).removeClass("expand");
            jQuery(".MovieTabNav.ControlPlayer").css({
                "display": "block"
            });
            jQuery("#watch-block").removeClass("expand");
            jQuery("div#light-overlay").remove();
            fx.scrollTo("#watch-block", 1E3);
            jQuery("#expand-status").html("Ph\u00f3ng to");
            resizePlayer = false;
        }
        return false;
    });
    jQuery("#reload-list-server").on("click", function() {
        jQuery.ajax({
            'url': PlayerLoad,
            'type': 'POST',
            'dataType': 'JSON',
            'data': 'filmLoadserver=1&filmId=' + filmInfo.filmID
        }).done(function(data) {
            if (typeof data._fxStatus != "undefined" && data._fxStatus) {
                location.reload();
            }
            console.log(data);
        });
    });
    jQuery("#btn-remove-ad").on("click", function() {
        jQuery("div.ad-container").remove();
        jQuery(this).remove();
        fx.scrollTo("#watch-block", 1E3);
        return false;
    });
    jQuery("#btn-toggle-capture").on("click", function() {
        if (jQuery("#media-player iframe").length > 0) {
            // Embed/iframe: không thể chụp do cross-origin — hiện popup hướng dẫn
            var old = document.getElementById("popupSave");
            if (old) old.remove();
            var G = document.createElement("div");
            G.setAttribute("id", "popupSave");
            G.setAttribute("style", "position:fixed;z-index:9999999999999;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;padding:30px;border-radius:10px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:420px;width:90%;");
            G.innerHTML = '<div style="font-size:40px;margin-bottom:10px;">📸</div>'
                + '<div style="font-weight:bold;font-size:16px;margin-bottom:12px;color:#333;">Không hỗ trợ chụp ảnh trực tiếp</div>'
                + '<div style="color:#555;font-size:14px;line-height:1.6;margin-bottom:18px;">Server embed không cho phép chụp ảnh.<br>Hãy dùng phím tắt hệ thống:<br>'
                + '<b style="color:#337ab7;">Win + Shift + S</b> (Windows)<br>'
                + '<b style="color:#337ab7;">Cmd + Shift + 4</b> (Mac)</div>';
            var I = document.createElement("a");
            I.innerHTML = "Đóng";
            I.setAttribute("style", "display:inline-block;background:#337ab7;color:#fff;padding:8px 24px;border-radius:5px;cursor:pointer;border:none;font-size:14px;");
            I.onclick = function() { document.getElementById("popupSave").remove(); };
            G.appendChild(I);
            document.body.appendChild(G);
        } else {
            saveScreenShot("media-player");
        }
        return false;
    });
    jQuery("#btn-toggle-download").on("click", function() {

        if (jwplayer("media-player").getPlaylistItem() == undefined) {
            fx.alertMessage("Rất tiếc", "Server của tập phim này chưa hỗ trợ download! Bạn hãy dùng Cốc Cốc, IDM hoặc chuyển server khác để download", 'info');
        } else {
            var file = jwplayer("media-player").getPlaylistItem()['file'];
            if (file.includes(".mp4")) {
                window.open(file, '_blank').blur();
            } else {
                fx.alertMessage("Rất tiếc", "Server của tập phim này chưa hỗ trợ download! Bạn hãy dùng Cốc Cốc, IDM hoặc chuyển server khác để download", 'info');
            }

        }
        return false;
    });
    jQuery("#btn-nextepisode").on("click", function() {
        var episodeId = parseInt($("ul.list-episode li a[data-movie='playing']").data("id"));
        var XMLFile = _getNextEpisodeUrl(episodeId);
        if (XMLFile != '') window.location.href = XMLFile;
        else fx.alertMessage("Thông báo", "Phim này đã hết tập để play!", 'info');
        return false;
    });
});


(function() {
    var a = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function() {
        this.addEventListener("progress", function(a) {
            var b = "100%";
            a.lengthComputable && (b = Math.floor(a.loaded / a.total * 100) + "%");
            a = "brk4";
            var d = document.querySelector("#media-player");
            null != d && void 0 != d && -1 < d.className.indexOf("jw-breakpoint-1") && (a = "brk1");
            d = document.querySelector("#progress-load");
            if (null != d) {
                icon = d.parentElement.querySelector("div");
                var e = document.querySelector(".jwplayer.jw-state-buffering .jw-display-icon-display .jw-icon .jw-svg-icon-buffer");
                d.innerHTML = null != icon && void 0 != icon && null != e ? b : "";
                d.className = a
            } else d = document.createElement("SPAN"), d.id = "progress-load", d.className = a, d.innerHTML = b, b = document.querySelector(".jw-display-icon-container.jw-display-icon-display.jw-reset"), null != b && void 0 != b && (a = b.querySelector("div"), e = document.querySelector(".jwplayer.jw-state-buffering .jw-display-icon-display .jw-icon .jw-svg-icon-buffer"), null != a && void 0 != a && null != e && b.appendChild(d))
        });
        a.apply(this, arguments)
    }
})();

function saveScreenShot(Z) {
    var H = document.getElementById(jwplayer(Z).id);
    var B = (H) ? H.querySelector("video") : undefined;
    if (B) {
        jwplayer().pause(!0);
        var F = 1;
        var D = document.createElement("canvas");
        D.width = B.videoWidth * F;
        D.height = B.videoHeight * F;
        Dwidth = window.innerWidth * 0.5;
        Dwidth100 = Dwidth / (D.width / 100);
        Dheight = (D.height / 100) * Dwidth100;
        if (Dheight > 600) {
            Dheight = 600;
            Dheight100 = Dheight / (D.height / 100);
            Dwidth = D.width / 100 * Dheight100
        }
        D.setAttribute("style", "height:" + Dheight + "px");
        D.getContext("2d").drawImage(B, 0, 0, D.width, D.height);
        var G = document.createElement("div");
        var K = (window.innerHeight - Dheight - 50) / 2 + "px";
        var L = (window.innerWidth - Dwidth) / 2 + "px";
        if (window.innerWidth < 450) {
            L = "0px";
            Dwidth = window.innerWidth
        }
        var C = document.createElement("div");
        var E = "position: fixed;z-index: 9999999999999;width:" + Dwidth + "px; left: " + L + ";top:0";
        E += ";padding-bottom:10px; background: #fff;";
        E += "text-align: center;border: 1px solid rgba(0, 0, 0, 0.23);";
        C.setAttribute("style", "display: block;");
        C.appendChild(D);
        G.setAttribute("id", "popupSave");
        G.setAttribute("style", E);
        var J = document.createElement("span");
        J.innerHTML = 'Nhấp chuột phải vào màn hình chọn ( Lưu hình ảnh thành ) hoặc (Save image as)';
        J.setAttribute("style", "margin: 10px;display: block;font-weight: bold;");
        var I = document.createElement("a");
        I.innerHTML = "Đóng";
        E = "display: inline-block; margin: 0px auto;background-color: #337ab7;";
        E += "margin-top: 10px; padding: 5px 10px;";
        E += "color: #fff; border-radius: 5px; border: 1px solid #ccc; cursor: pointer;";
        I.setAttribute("style", E);
        I.onclick = function() {
            document.getElementById("popupSave").remove();
        };
        G.appendChild(J);
        G.appendChild(C);
        G.appendChild(I);
        document.body.appendChild(G)
    }
};

/* ============================================================================
 * Watch page bootstrap + episode-search filter
 * (was inline in home-watch.php; moved here by consolidate-inline-assets, D7).
 *
 * Reads globals set by inline bootstrap BEFORE this file loads:
 *   window._epHash  — Encryption->encode($EpisodeURL)
 *   window._epID    — (int) $episode_id
 *   window.PLAYER_DATA  (set elsewhere when $playerDataJSON is non-empty)
 *   filmInfo.*      (set in another inline block earlier in <head>)
 * ============================================================================ */

// Tắt browser scroll restoration để tránh xung đột khi navigate back/forward
if ('scrollRestoration' in history) { history.scrollRestoration = 'manual'; }

jQuery(document).ready(function($) {
    var _epHash = window._epHash || '';
    var _epID   = window._epID   || 0;

    // Inline player data optimization — use inline data if available
    if (window.PLAYER_DATA && window.PLAYER_DATA.playTech) {
        try {
            console.log('[PERF] Using inline player data');
            var f = window.PLAYER_DATA;
            var episodeId = filmInfo.episodeID;

            // Active class + scroll handled below after player init

            if (f.playTech == "api" || f.playTech == "all") {
                if (typeof f.link === "string") {
                    jQuery("#media-player").empty().html('<span style="vertical-align: middle;text-align: center;display: table-cell;font-style: normal;font-variant: normal;font-weight: normal;font-stretch: normal;font-size: 23px;line-height: 20px;">' + f.link + "</span>").css({
                        "display": "table",
                        "background": "#000"
                    });
                } else {
                    var sources = [];
                    jQuery.each(f.link, function(dataAndEvents, file) {
                        file.file = file.file.replace("&http", "http");
                        sources.push(file);
                    });

                    // Get next episode URL from DOM (no AJAX needed)
                    var nextEpUrl = _getNextEpisodeUrl(episodeId);
                    setupJWPlayer(sources, episodeId, null);
                    if (nextEpUrl) {
                        window.currentXMLFile = nextEpUrl;
                        pautonext = true;
                        jQuery("#autonext-status").html("Bật");
                    } else {
                        pautonext = false;
                        jQuery("#autonext-status").html("Tắt");
                    }
                }
            } else if (f.playTech == "embed") {
                // For embed, wrap URL in sources array format expected by PLTV.Player
                var embedSources = [{
                    file: f.link,
                    type: "mp4",
                    mimeType: "video/mp4",
                    default: true,
                    label: "720"
                }];
                var href = $(".list-episode a[data-hash='" + _epHash + "']").attr("href");
                PLTV.Player(f.playTech, embedSources, href);
            } else if (f.playTech == "iframe") {
                jQuery("#media-player").empty().html('<iframe src="' + f.link + '" width="100%" height="100%" frameborder="0" scrolling="no" allowfullscreen allow="autoplay; fullscreen"></iframe>');
            }
        } catch (e) {
            console.error('[PERF] Inline player data error, falling back to AJAX:', e);
            AnimeVsub(_epHash, filmInfo.filmID);
        }
    } else {
        console.log('[PERF] Falling back to AJAX');
        AnimeVsub(_epHash, filmInfo.filmID);
    }

    // Highlight tập đang xem bằng JS — dựa vào filmInfo.episodeID
    var curEpID = filmInfo.episodeID;
    if (curEpID) {
        var $activeEp = $('.episode-link[data-id="' + curEpID + '"]');
        $(".list-episode a").attr("data-movie", "");
        $activeEp.attr("data-movie", "playing");
        $(EPISODE_LINK_ID + " a").removeClass(EPISODE_CLASS_ACTIVE).addClass(EPISODE_CLASS_NOACTIVE);
        $activeEp.removeClass(EPISODE_CLASS_NOACTIVE).addClass(EPISODE_CLASS_ACTIVE)
            .closest('li.episode').addClass('playing');
        // Scroll list episode đến tập đang active
        if ($activeEp.length) {
            var el = $activeEp[0];
            var container = $activeEp.closest('ul.list-episode')[0];
            if (container) {
                container.scrollTop = el.offsetTop - container.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2;
            }
        }
    }
    // Scroll đến player sau 300ms
    setTimeout(function() { fx.scrollTo("#watch-block", 1000); }, 300);

    // Deferred backup links loading
    var backupLinksLoaded = false;
    var _epID_forBackup = _epID;

    // Load backup links on-demand when #links-backup area is clicked or becomes visible
    $(document).on('click focus mouseenter', '#links-backup', function() {
        if (!backupLinksLoaded && _epID_forBackup) {
            console.log('[PERF] Loading backup links on-demand');
            backupLinksLoaded = true;
            LoadLinksBackup(_epID_forBackup);
        }
    });

    // Also load if user scrolls near the backup links area
    var backupObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting && !backupLinksLoaded && _epID_forBackup) {
                console.log('[PERF] Loading backup links (scroll trigger)');
                backupLinksLoaded = true;
                LoadLinksBackup(_epID_forBackup);
                backupObserver.disconnect();
            }
        });
    }, { rootMargin: '100px' });

    var backupEl = document.getElementById('links-backup');
    if (backupEl) {
        backupObserver.observe(backupEl);
    }

    // ===== Episode filter-in-place (was a separate inline block in home-watch.php) =====
    // Match logic: substring case-insensitive — query "1" hiện mọi tập chứa "1"
    // (1, 01, 11, 100, 1.5, 01_Part1...). Đơn giản, predictable.
    var $input = $('#episode-search');
    var $meta  = $('#episode-search-meta');
    if ($input.length) {
        (function setupEpisodeSearch(){
            function buildMatcher(q){
                var s = q.trim();
                if (s === '') return null;
                var lower = s.toLowerCase();
                return function(name){ return name.toLowerCase().indexOf(lower) !== -1; };
            }

            function clearFilter(){
                document.body.classList.remove('episode-searching');
                $('.list-episode li.episode').css('display', '');
                $('.server-group, .backup-server').css('display', '');
                $meta.text('');
            }

            function applyFilter(q){
                var matcher = buildMatcher(q);
                if (!matcher) { clearFilter(); return; }

                // Override tab-pane display (mỗi server type có .tab-pane bị ẩn khi không active)
                document.body.classList.add('episode-searching');

                var totalMatch = 0;
                $('.list-episode').each(function(){
                    var $ul = $(this);
                    var groupMatch = 0;
                    $ul.find('li.episode').each(function(){
                        var name = $(this).find('a.episode-link').text().trim();
                        if (matcher(name)) {
                            $(this).css('display', '');
                            groupMatch++;
                            totalMatch++;
                        } else {
                            $(this).css('display', 'none');
                        }
                    });
                    var $parent = $ul.closest('.server-group, .backup-server');
                    if ($parent.length) $parent.css('display', groupMatch === 0 ? 'none' : '');
                });

                if (totalMatch > 0) {
                    $meta.html('Tìm thấy <strong>' + totalMatch + '</strong> tập khớp "' + $('<div>').text(q).html() + '"');
                } else {
                    $meta.html('<span style="color:#c62828;">Không tìm thấy tập nào khớp "' + $('<div>').text(q).html() + '"</span>');
                }
            }

            var debounce = null;
            $input.on('input', function(){
                var v = this.value.trim();
                clearTimeout(debounce);
                if (v === '') { clearFilter(); return; }
                debounce = setTimeout(function(){ applyFilter(v); }, 150);
            });
            $input.on('keydown', function(e){
                if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounce); applyFilter(this.value.trim()); }
            });
        })();
    }
});