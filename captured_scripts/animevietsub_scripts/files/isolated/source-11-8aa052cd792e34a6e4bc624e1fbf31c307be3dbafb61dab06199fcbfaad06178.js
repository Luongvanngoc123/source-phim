/**
 * AvsCentrifugo — Shared singleton Centrifuge connection.
 *
 * Tất cả components (comment, recent-comments, home stats) dùng chung
 * 1 WebSocket connection thay vì mỗi cái tạo riêng.
 *
 * Requires: window.AVS_CENTRIFUGO_CFG = { url, token }
 *           (set by PHP in func_template.php)
 */
window.AvsCentrifugo = (function () {
    var _instance = null;
    var _connected = false;
    var _connectListeners = [];
    var _disconnectListeners = [];
    var _subscriptions = {};

    function getInstance() {
        if (_instance) return _instance;

        var cfg = window.AVS_CENTRIFUGO_CFG || {};
        if (typeof Centrifuge === 'undefined' || !cfg.url || !cfg.token) return null;

        _instance = new Centrifuge(cfg.url, {
            token: cfg.token,
            maxReconnectDelay: 5000,
            getToken: function () {
                return fetch('/ajax/comment?action=token&_=' + Date.now())
                    .then(function (r) { return r.json(); })
                    .then(function (d) { return d.token || ''; });
            }
        });

        _instance.on('connected', function () {
            _connected = true;
            for (var i = 0; i < _connectListeners.length; i++) {
                try { _connectListeners[i](); } catch (e) {}
            }
        });

        _instance.on('disconnected', function () {
            _connected = false;
            for (var i = 0; i < _disconnectListeners.length; i++) {
                try { _disconnectListeners[i](); } catch (e) {}
            }
        });

        _instance.connect();

        window.addEventListener('beforeunload', function () {
            if (_instance) _instance.disconnect();
        });

        return _instance;
    }

    /**
     * Subscribe to a channel — safe to call multiple times for the same channel.
     * Returns the existing subscription if already subscribed.
     */
    function subscribe(channel) {
        var c = getInstance();
        if (!c) return null;

        if (_subscriptions[channel]) return _subscriptions[channel];

        var sub = c.newSubscription(channel);
        _subscriptions[channel] = sub;
        sub.subscribe();
        return sub;
    }

    function onConnect(fn) {
        _connectListeners.push(fn);
        // Fire immediately if already connected
        if (_connected) { try { fn(); } catch (e) {} }
    }

    function onDisconnect(fn) {
        _disconnectListeners.push(fn);
    }

    return {
        getInstance: getInstance,
        subscribe: subscribe,
        onConnect: onConnect,
        onDisconnect: onDisconnect
    };
})();
