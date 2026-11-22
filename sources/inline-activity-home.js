(function($){
    var loaded = {};
    var medals = {1:'🥇',2:'🥈',3:'🥉'};

    function escHtml(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
    function decodeEntities(s){return s?$('<textarea>').html(String(s)).text():''}
    function safeUsernameText(s){return escHtml(decodeEntities(s||''))}
    function truncate(s,n){if(!s)return'';s=decodeEntities(s).replace(/\[sticker:[^\]]+\]/g,'').trim();return s.length>n?s.substring(0,n)+'…':s}

    function renderFilmCards(films, panel){
        if(!films||!films.length){panel.html('<div class="activity-empty">Chưa có dữ liệu</div>');return}
        var h='<div class="activity-list">';
        for(var i=0;i<films.length;i++){
            var f=films[i], rank=i+1;
            var medal=medals[rank]||'';
            h+='<div class="activity-card"><a href="'+escHtml(f.film_url)+'" title="'+escHtml(f.film_name)+'">'
              +'<div class="ac-img" style="background-image:url(\''+escHtml(f.film_img)+'\')">'
              +(medal?'<span class="ac-rank">'+medal+'</span>':'')
              +'<span class="ac-badge"><i class="fa fa-comment"></i> '+f.comment_count+'</span>'
              +'<div class="ac-overlay">'+escHtml(f.film_trangthai||'')+'</div>'
              +'</div>'
              +'<div class="ac-name" title="'+escHtml(f.film_name)+'">'+escHtml(f.film_name)+'</div>'
              +'</a></div>';
        }
        h+='</div>';
        panel.html(h);
    }

    function profileUrl(uid){ var n=parseInt(uid,10); return (n>0)?('/thanh-vien/'+n+'/'):''; }

    function renderMostLikedMembers(members, panel){
        if(!members||!members.length){panel.html('<div class="activity-empty">Chưa có dữ liệu</div>');return}
        var h='';
        for(var i=0;i<members.length;i++){
            var m=members[i], rank=i+1;
            var medal=medals[rank]||'<span>#'+rank+'</span>';
            var safeName = safeUsernameText(m.user_name || '');
            var avatar=m.user_avatar
                ?'<img src="'+escHtml(m.user_avatar)+'" alt="'+safeName+'" loading="lazy">'
                :'<span style="font-weight:600">'+safeUsernameText((m.user_name||'?').charAt(0).toUpperCase())+'</span>';
            var pUrl = profileUrl(m.user_id);
            var cardOpen = pUrl ? '<a class="am-card" href="'+pUrl+'">' : '<div class="am-card">';
            var cardClose = pUrl ? '</a>' : '</div>';
            h+=cardOpen
              +'<div class="acc-rank">'+medal+'</div>'
              +'<div class="am-avatar">'+avatar+'</div>'
              +'<div class="am-body">'
              +'<div class="am-name">'+safeUsernameText(m.user_fullname || m.user_name)+'</div>'
              +'<div class="am-count"><i class="fa fa-thumbs-up"></i>'+m.total_likes+' lượt thích</div>'
              +'</div>'+cardClose;
        }
        panel.html(h);
    }

    function renderActiveMembers(members, panel){
        if(!members||!members.length){panel.html('<div class="activity-empty">Chưa có dữ liệu</div>');return}
        var h='';
        for(var i=0;i<members.length;i++){
            var m=members[i], rank=i+1;
            var medal=medals[rank]||'<span>#'+rank+'</span>';
            var safeName = safeUsernameText(m.user_name || '');
            var avatar=m.user_avatar
                ?'<img src="'+escHtml(m.user_avatar)+'" alt="'+safeName+'" loading="lazy">'
                :'<span style="font-weight:600">'+safeUsernameText((m.user_name||'?').charAt(0).toUpperCase())+'</span>';
            var pUrl = profileUrl(m.user_id);
            var cardOpen = pUrl ? '<a class="am-card" href="'+pUrl+'">' : '<div class="am-card">';
            var cardClose = pUrl ? '</a>' : '</div>';
            h+=cardOpen
              +'<div class="acc-rank">'+medal+'</div>'
              +'<div class="am-avatar">'+avatar+'</div>'
              +'<div class="am-body">'
              +'<div class="am-name">'+safeUsernameText(m.user_fullname || m.user_name)+'</div>'
              +'<div class="am-count"><i class="fa fa-comment"></i>'+m.comment_count+' bình luận</div>'
              +'</div>'+cardClose;
        }
        panel.html(h);
    }

    function renderTopComments(comments, panel){
        if(!comments||!comments.length){panel.html('<div class="activity-empty">Chưa có bình luận nào</div>');return}
        var h='';
        for(var i=0;i<comments.length;i++){
            var c=comments[i], rank=i+1;
            var medal=medals[rank]||'<span>#'+rank+'</span>';
            var safeName = safeUsernameText(c.user_name || '');
            var avatar=c.user_avatar
                ?'<img src="'+escHtml(c.user_avatar)+'" alt="'+safeName+'" loading="lazy">'
                :'<span style="font-weight:600">'+safeUsernameText((c.user_name||'?').charAt(0).toUpperCase())+'</span>';
            var content=parseInt(c.is_spoiler,10)===1?'<em style="color:#ff9800;font-style:italic">[Spoiler]</em>':escHtml(truncate(c.content,100));
            var filmLabel=c.film_name?'<span class="acc-film">'+escHtml(c.film_name)+'</span>':'';
            h+='<div class="activity-comment-card"><a href="'+escHtml(c.comment_url||'#')+'">'
              +'<div class="acc-rank">'+medal+'</div>'
              +'<div class="acc-avatar">'+avatar+'</div>'
              +'<div class="acc-body">'
              +'<div class="acc-meta"><span class="acc-user">'+safeUsernameText(c.user_fullname || c.user_name)+'</span>'
              +'<span class="acc-votes"><i class="fa fa-thumbs-up"></i>'+c.votes_up+'</span></div>'
              +'<div class="acc-content">'+content+'</div>'
              +filmLabel
              +'</div></a></div>';
        }
        panel.html(h);
    }

    function loadTab(tab){
        if(loaded[tab])return;
        var panel=$('#activity-panel-'+tab);
        if(tab==='top-comments'){
            $.getJSON('/ajax/comment?action=get_top_comments&_='+Date.now(),function(res){
                loaded[tab]=true;
                if(res.success)renderTopComments(res.comments,panel);
                else panel.html('<div class="activity-empty">Lỗi tải dữ liệu</div>');
            }).fail(function(){panel.html('<div class="activity-empty">Lỗi kết nối</div>')});
        }else if(tab==='hot-films'){
            $.getJSON('/ajax/comment?action=get_hot_films&_='+Date.now(),function(res){
                loaded[tab]=true;
                if(res.success)renderFilmCards(res.films,panel);
                else panel.html('<div class="activity-empty">Lỗi tải dữ liệu</div>');
            }).fail(function(){panel.html('<div class="activity-empty">Lỗi kết nối</div>')});
        }else if(tab==='most-commented'){
            $.getJSON('/ajax/comment?action=get_most_commented_films&_='+Date.now(),function(res){
                loaded[tab]=true;
                if(res.success)renderFilmCards(res.films,panel);
                else panel.html('<div class="activity-empty">Lỗi tải dữ liệu</div>');
            }).fail(function(){panel.html('<div class="activity-empty">Lỗi kết nối</div>')});
        }else if(tab==='active-members'){
            $.getJSON('/ajax/comment?action=get_active_members&_='+Date.now(),function(res){
                loaded[tab]=true;
                if(res.success)renderActiveMembers(res.members,panel);
                else panel.html('<div class="activity-empty">Lỗi tải dữ liệu</div>');
            }).fail(function(){panel.html('<div class="activity-empty">Lỗi kết nối</div>')});
        }else if(tab==='most-liked-members'){
            $.getJSON('/ajax/comment?action=get_most_liked_members&_='+Date.now(),function(res){
                loaded[tab]=true;
                if(res.success)renderMostLikedMembers(res.members,panel);
                else panel.html('<div class="activity-empty">Lỗi tải dữ liệu</div>');
            }).fail(function(){panel.html('<div class="activity-empty">Lỗi kết nối</div>')});
        }
    }

    $(function(){
        // Tab switching — scoped to #activity-home only
        var activeTab = 'hot-films';
        $('#activity-home').on('click','[data-activity-tab]',function(e){
            e.preventDefault();e.stopPropagation();
            var tab=$(this).data('activity-tab');
            activeTab = tab;
            $('#activity-home .STPb').removeClass('Current');
            $(this).addClass('Current');
            $('.activity-panel').hide();
            $('#activity-panel-'+tab).show();
            loadTab(tab);
        });
        // Auto-load first tab
        loadTab('hot-films');

        // Centrifugo realtime — reload active tab khi có thay đổi
        if (window.AvsCentrifugo) {
            try {
                var reloadDebounce = null;
                function reloadActiveTab() {
                    if (reloadDebounce) clearTimeout(reloadDebounce);
                    var jitter = 5000 + Math.floor(Math.random() * 5000);
                    reloadDebounce = setTimeout(function () {
                        for (var k in loaded) loaded[k] = false;
                        loadTab(activeTab);
                    }, jitter);
                }
                var homeSub = window.AvsCentrifugo.subscribe('recent');
                if (!homeSub) throw new Error('no sub');
                homeSub.on('publication', function (ctx) {
                    var d = ctx.data;
                    if (!d || !d.event) return;
                    if (['new_comment', 'delete_comment', 'vote_update', 'edit_comment'].indexOf(d.event) !== -1) {
                        reloadActiveTab();
                    }
                });
            } catch (e) { /* graceful degradation */ }
        }
    });
})(jQuery);
