// Shared helper: render inline mention markers `@[id:name]` thành <a> link.
// Dùng chung cho mọi widget hiển thị bình luận (comment.js, home-user.php,
// recent-comments.js, ...). Pure JS (không cần jQuery).
//
// Server side đã hydrate name → current name qua hydrateMentionNamesInRows
// (xem ajax/comment.php). Client chỉ swap marker thành link HTML.
//
// Usage:
//   var html = window.AvsRenderMentions(contentHtml, 'avs-tag');
//
// Note: caller phải gọi escHtml/sanitize TRƯỚC vì helper xen <a> tag vào,
// nếu chưa escape thì XSS risk từ surrounding text. Helper tự escape phần
// name extract từ marker.
(function () {
    window.AvsRenderMentions = function (html, mentionClass) {
        if (!html || html.indexOf('@[') === -1) return html;
        mentionClass = mentionClass || 'avs-mention';
        return html.replace(/@\[(\d+):([^\]]+)\]/g, function (_, id, name) {
            var div = document.createElement('div');
            div.textContent = name;
            return '<a class="' + mentionClass + '" href="/thanh-vien/' + id + '/" data-user-id="' + id + '">@' + div.innerHTML + '</a>';
        });
    };
})();
