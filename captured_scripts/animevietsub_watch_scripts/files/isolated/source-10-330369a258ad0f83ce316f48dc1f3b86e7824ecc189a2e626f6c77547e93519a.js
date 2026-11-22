
!(function(){

var show_adx = 1
var check_bots = 1
var check_smarttv = 1
var delay_link = 1

if(!show_adx) return;

var otherpop = [
	"https://bom88.adqc.net/cpd/animevietsubpopunder",
]
var otherpopmax = 1 //1 link => 1 popunder / 20 phut

var _times = [0,1,2]

var timeCookie = 1200000; //20 phut - bang tan suat cua script cu

function setVCookie(key, value, date) {
    if (!date) {
        date = 31536000000;
    };
    var expires = new Date();
    expires.setTime(expires.getTime() + date);
    document.cookie = key + '=' + value + '; path=/; expires=' + expires.toUTCString();
};

function getVCookie(key) {
    var keyValue = document.cookie.match('(^|;)(?: )?' + key + '=([^;]*)(;|$)');
    return keyValue ? keyValue[2] : null;
};

var popunderClickCount = getVCookie('adxPop'),timeclick=0
window.oc = function(){timeclick=Date.now()}
popunderClickCount = popunderClickCount?popunderClickCount-0:0;

var lastC;

/* ---- cac phan tu chinh la quang cao: click vao day thi khong bat popunder ---- */

function isAdElement(target){
	var selectors = [
		'#invideo_wrapper',			//1  player_on_pause + 21 mobile_player_on_pause
		'#close-and-play',			//1  player_on_pause
		'.header-ads-pc a',			//3  header_allpage
		'#kwybox12',				//4  float2div
		'#kwybpkrw',				//4  float2div
		'center a',				//5  right_1 + 15 right_1_mobile + 18 player_below2_mobile
		'#__clb-1832980',			//6  right_2 + 16 right_2_mobile
		'.below-player a',			//8  player_below1
		'#kwvim5do',				//9  player_below2
		'.__clb-1988212',			//11 home_above_decu
		'#__clb-1832983',			//12 home_above_animemoi
		'.header-ads-mobile a',			//13 header_allpage_mobile
		'.below-playerm a',			//17 player_below1_mobile
		'.ballon-ck',				//22 ballon_banner
		'#float_content_left',			//22 ballon_banner
		'#float_content_right',			//22 ballon_banner
		'#hide_ballon_left',			//22 ballon_banner (nut dong)
		'#hide_ballon_right',			//22 ballon_banner (nut dong)
		'#mobile-catfixx a',			//23 catfish_banner
		'#mobile-catfixx',			//23 catfish_banner
		'.ads-banner',				//24 preload_pc (banner - KHONG bat popunder)
		'#mobile-catfish-top a',		//25 preload_mobile
		'#mobile-catfish-top',			//25 preload_mobile
		'#hide_catfish',			//25 preload_mobile (nut dong)
		'.ads-textlink',			//29 ads_textlink
		'#pc-catfixx a',			//30 catfish_banner_pc
		'#pc-catfixx',				//30 catfish_banner_pc
		'#hide_catfix'				//23 + 30 catfish (nut dong)
	];
	var $target = $(target);
	return selectors.some(function(selector){ return $target.closest(selector).length })
}

// Ban popunder neu con quota. Tra ve true khi da ban.
var pop = function(){

	if(popunderClickCount == 0){
		setVCookie('adxPop', ++popunderClickCount, timeCookie)
	}

	//check pop 1 or 2 or 3
	var cp = (popunderClickCount-1) % otherpop.length;

	var cond = true
	var k = (popunderClickCount-1)? (popunderClickCount-1) % _times.length : 0
	if(Date.now()-timeclick<_times[k]*1000){
		cond = false
	}

	if(cond && (popunderClickCount-1)>=otherpop.length*otherpopmax){
		cond = false
	}

	if(!cond) return false;

	var clickEvent = new MouseEvent( 'click', {bubbles: true, cancellable: true} );
	document.getElementById('bb'+cp) && document.getElementById('bb'+cp).dispatchEvent( clickEvent );
	setVCookie('adxPop', ++popunderClickCount, timeCookie)
	return true
}

var ol = function(){

	for(var i in otherpop){
		$(document.body).append('<a onclick="oc()" id="bb'+i+'" href="'+otherpop[i]+'" style="opacity:0; width:1px; height: 1px;" target="_blank" rel="nofollow" data-wpel-link="external">X</a>')
	}

	oc()
	let f = function(e){

		if(!e.clientX && !e.clientY) return;

		if(lastC && Math.abs(Date.now()-lastC)<300) return;

		lastC = Date.now()

		if(isAdElement(e.target)) return;

		pop()

	}
	$(document).click(f)

	// Nut dong popup quang cao (.popup-icon-close): van bat popunder.
	// Lan bam X dau tien chan handler cua PopupManager -> popup khong dong,
	// url-close chua mo. Lan bam thu hai da het quota popunder nen khong chan
	// nua: PopupManager dong popup va mo url-close bang mot user gesture moi.
	// Phai la capture phase, vi listener cua nut X nam sau trong cay DOM.
	document.addEventListener('click', function(e){

		if(!$(e.target).closest('.popup-icon-close').length) return;

		if(!e.clientX && !e.clientY) return;

		if(lastC && Math.abs(Date.now()-lastC)<300) return;

		lastC = Date.now()

		if(pop()) e.stopPropagation();

	}, true)

	if(!delay_link) return;

	$(document).on('click', 'a', function (event) {

		if(event.clientX || event.clientY) {

			const url = $(this).attr('href');
			const target = $(this).attr('target') || '_self';

			// Anchors wired through data-* attributes carry href="#" as a
			// placeholder — the server picker, Tat den, Phong to, Theo doi and
			// the rest of the watch-page controls all do. Their real behaviour
			// lives in a handler this one must not pre-empt.
			//
			// Taking over anyway is what sends people to the home page: the
			// document has <base href="WEB_URL">, so assigning "#" to
			// location.href resolves against the base rather than the current
			// page. Clicking a server button dropped the viewer out of the
			// episode entirely.
			if (!url || url.charAt(0) === '#') return;

			event.preventDefault();

			if (url) {
				setTimeout(function (target,url) {
					if (target === '_blank') {
						window.open(url, '_blank');
					} else if (target === '_parent') {
						window.parent.location.href = url;
					} else if (target === '_top') {
						window.top.location.href = url;
					} else {
						window.location.href = url;
					}
				}, 500,target,url);
			}

		}
	});
}

/* ---- loc bot / smart TV / quoc gia ---- */

const smartTVKeywords = [
    'airties', 'aldinord', 'aldisued', 'altech uec', 'altus', 'amazon', 'aoc',
    'arris', 'atlantic', 'atvio', 'awox', 'aya', 'bangolufsen', 'beko',
    'blaupunkt_umc', 'botech', 'bush', 'cecotec', 'celcus', 'changhong',
    'clayton', 'continental_edi', 'crenova', 'crown', 'daewoo', 'digihome',
    'dikom', 'diora', 'dmm', 'elektroland', 'electronia', 'essentielb',
    'expressluck', 'finlux', 'fu', 'fuego', 'gogen', 'grundig', 'haier',
    'hanseatic', 'hi-level', 'hisense', 'hitachi', 'hofer', 'horizon', 'hotel',
    'humax', 'hyundai', 'ikea', 'intek', 'inverto', 'jvc', 'kalley', 'kendo',
    'kubo', 'laurus', 'lg', 'lifemaxx', 'linsar', 'loewe', 'logik', 'luxor',
    'manhattan', 'maxbell', 'medion', 'micromax', 'mori', 'nad', 'namkoo',
    'nevir', 'novatech', 'oki', 'oktos', 'orava', 'otto', 'panasonic',
    'philips', 'pioneer', 'pulse', 'radiola', 'rca', 'realcable', 'reflexion',
    'roadstar', 'roku', 'saba', 'samsung', 'sanyo', 'seg', 'seg_micromax',
    'seg_vivax', 'selectron', 'sharp', 'shengchuang', 'skyworth', 'smarttech',
    'soniq', 'sony', 'stiebel', 'sunstech', 'supersonic', 'sven', 'teac',
    'technicolor', 'technika', 'technisat', 'techwood', 'telefunken',
    'telesystem', 'terris', 'thomson', 'tivo', 'tornado', 'toucan', 'toyomi',
    'trimax', 'trium', 'tvstar', 'unika', 'upstar', 'vaxa', 'vestel',
    'videocon', 'viewsonic', 'vitek', 'vivax', 'vox', 'wahl', 'walker', 'wallis',
    'watson', 'welson', 'wemax', 'westwood', 'winia', 'xiaomi', 'xtreme',
    'yamaha', 'zeevee', 'zephir', 'zgemma', 'appletv', 'crkey', 'aftmm',
    'aftss', 'aftka', 'aftb', 'aftt', 'smarttv', 'tv', 'smart-tv', 'tizen',
    'webostv', 'webos', 'bravia', 'dtv'
];

function isSmartTV(){
	var ua = navigator.userAgent.toLowerCase();
	return smartTVKeywords.some(function(keyword){ return ua.includes(keyword) })
}

var googleUA = ['googlebot','adsbot-google','feedfetcher-google','google favicon',
	'google-read-aloud','google-site-verification','appengine-google',
	'google-structured-data-testing-tool','googlebot-image','googlebot-video',
	'googlebot-news','adsbot-google-mobile']

function isBot(){
	var ua = navigator.userAgent.toLowerCase();
	return ua.indexOf('yandex') > -1
		|| ua.indexOf('bing')   > -1
		|| ua.indexOf('coccoc') > -1
		|| ua.indexOf('yahoo')  > -1
		|| googleUA.some(function(agent){ return ua.includes(agent) })
}

if(check_bots && isBot()) return;
if(check_smarttv && isSmartTV()) return;

$(ol);

})();
