/**
 * Film detail page widgets — loaded on home-info.php, home-watch.php, home-infobk.php:
 *   1. Star rating widget (#star, raty.js) + AJAX submit to /ajax/rate
 *   2. Fan-cứng "Xem tất cả" modal (#fc-modal) — see bottom of file
 *
 * Scope expanded from "rating only" in consolidate-inline-assets change.
 */
jQuery(document).ready(function(t){
// rating
	var score_current = jQuery("#score_current").val();
	var hint_current = jQuery("#hint_current").val();
	jQuery("#hint").html(hint_current);
	jQuery("#score").html(score_current+" ĐIỂM");
	function scorehint(score){
		var text = "";
		if (score == "1") {
			text = "Dở tệ"
		}
		if (score == "2") {
			text = "Dở"
		}
		if (score == "3") {
			text = "Không hay"
		}
		if (score == "4") {
			text = "Ko hay lắm"
		}
		if (score == "5") {
			text = "Bình thường"
		}
		if (score == "6") {
			text = "Xem được"
		}
		if (score == "7") {
			text = "Có vẻ hay"
		}
		if (score == "8") {
			text = "Hay"
		}
		if (score == "9") {
			text = "Rất hay"
		}
		if (score == "10") {
			text = "Hay tuyệt"
		}
		return text;
	}
	jQuery('#star').raty({
		half: false,
		score: function() {
			return jQuery(this).attr('data-score');
		},

		mouseover: function(score, evt){
			jQuery("#score").html(score +" ĐIỂM");
			jQuery("#hint").html(scorehint(score));
		},
		mouseout: function(score, evt){
			var score_current = jQuery("#score_current").val();
			var hint_current = jQuery("#hint_current").val();
			jQuery("#hint").html(hint_current);
			jQuery("#score").html(score_current+" ĐIỂM");
		},
		click: function(score, evt){
			jQuery.ajax({
				'url': "/ajax/rate",
				'type': 'GET',
				'dataType': 'JSON',
				'data': {'_fxAjax':1,'_fxResponseType':'json','score':score,'film':filmInfo.filmID}
			}).done(function(data){
				if(data._fxStatus && data._fxStatus == 1)
				{
					if(typeof data._fxMessage=='string')
						fx.alertMessage("Chúc mừng",data._fxMessage,"success");
					if(typeof data.rateCount!='undefined')
					{
						jQuery('.post-ratings .num-rating').text(data.rateCount);
					}
					if(typeof data.ratePoint!='undefined')
					{
						jQuery('.post-ratings #score_current').val(data.ratePoint);
						jQuery('.post-ratings #average_score').html(data.ratePoint);
						jQuery('#TPVotes').attr("data-percent",data.ratePoint*10);
					}
				} else if(data._fxStatus && data._fxStatus == 2){
				    fx.alertMessage("Xin chào",data._fxMessage,"info");
				} else {
				    fx.alertMessage("Có lỗi",data._fxMessage,"error");
				}
				//auto if _fxStatus==0
			});
		}
	});
	jQuery('#star').css('width','170px');
	jQuery('.post-ratings #hint').css('font-size','12px');
});

/* ============================================================================
 * Fan-cứng "Xem tất cả" modal (was duplicated inline in home-info.php +
 * home-watch.php; moved here by consolidate-inline-assets).
 *
 * Trigger: #fc-see-all-btn (only present when hardFanCount > 5)
 * Modal:   #fc-modal with .fc-modal-overlay + .fc-modal-close + #fc-modal-body
 * API:     GET /ajax/film-fans?film_id=...&page=...&size=20
 * Scope:   film detail pages (home-info.php + home-watch.php + home-infobk.php)
 * ============================================================================ */
(function(){
    var btn=document.getElementById('fc-see-all-btn');
    if(!btn) return;
    var modal=document.getElementById('fc-modal');
    if(!modal) return;
    var overlay=modal.querySelector('.fc-modal-overlay');
    var closeBtn=modal.querySelector('.fc-modal-close');
    var body=document.getElementById('fc-modal-body');
    var loadMore=document.getElementById('fc-load-more');
    var filmId=parseInt(btn.getAttribute('data-film-id'),10);
    var page=0, loading=false, allLoaded=false;

    function escHtml(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
    function avatarHtml(fan){
        if(fan.user_avatar){
            return '<span class="fc-avatar-img"><img src="'+escHtml(fan.user_avatar)+'" alt="'+escHtml(fan.user_name)+'" loading="lazy"></span>';
        }
        var letter=fan.user_name?(fan.user_name.charAt(0).toUpperCase()):'?';
        return '<span class="fc-avatar-img fc-avatar-fallback">'+escHtml(letter)+'</span>';
    }
    function renderFans(fans){
        var h='';
        for(var i=0;i<fans.length;i++){
            var f=fans[i];
            h+='<a class="fc-modal-row" href="'+escHtml(f.profile_url)+'">'
              +avatarHtml(f)
              +'<div class="fc-modal-row-info">'
              +'<div class="fc-modal-row-name">'+escHtml(f.user_fullname || f.user_name)+'</div>'
              +'<div class="fc-modal-row-stats">'+f.valid_count+' bình luận</div>'
              +'</div></a>';
        }
        return h;
    }
    function loadPage(){
        if(loading||allLoaded) return;
        loading=true;
        page++;
        var url='/ajax/film-fans?film_id='+filmId+'&page='+page+'&size=20';
        var xhr=new XMLHttpRequest();
        xhr.open('GET',url);
        xhr.onload=function(){
            loading=false;
            try{
                var r=JSON.parse(xhr.responseText);
                if(!r.success){body.innerHTML='<div class="fc-modal-loading">Lỗi tải dữ liệu</div>';return;}
                if(page===1) body.innerHTML='';
                body.insertAdjacentHTML('beforeend',renderFans(r.fans));
                if(r.has_more){loadMore.style.display='block';}else{loadMore.style.display='none';allLoaded=true;}
            }catch(e){body.innerHTML='<div class="fc-modal-loading">Lỗi tải dữ liệu</div>';}
        };
        xhr.onerror=function(){loading=false;body.innerHTML='<div class="fc-modal-loading">Lỗi kết nối</div>';};
        xhr.send();
    }
    function openModal(){modal.style.display='flex';document.body.style.overflow='hidden';if(page===0)loadPage();}
    function closeModal(){modal.style.display='none';document.body.style.overflow='';page=0;loading=false;allLoaded=false;body.innerHTML='<div class="fc-modal-loading"><i class="fa fa-spinner fa-spin"></i> Đang tải...</div>';loadMore.style.display='none';}

    btn.addEventListener('click',openModal);
    overlay.addEventListener('click',closeModal);
    closeBtn.addEventListener('click',closeModal);
    loadMore.addEventListener('click',loadPage);
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal.style.display==='flex')closeModal();});
})();