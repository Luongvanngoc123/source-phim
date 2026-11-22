// Dark/Light mode toggle - Extracted for performance optimization
(function() {
	var STORAGE_KEY = 'avs_theme';
	var btn = null;

	function applyTheme(theme) {
		if (theme === 'light') {
			document.body.classList.add('light-mode');
			if (btn) {
				btn.textContent = '☀️';
				btn.title = 'Chuyển sang chế độ tối';
			}
		} else {
			document.body.classList.remove('light-mode');
			if (btn) {
				btn.textContent = '🌙';
				btn.title = 'Chuyển sang chế độ sáng';
			}
		}
		// Remove temporary class to avoid flash
		document.documentElement.classList.remove('light-mode-pre');
	}

	document.addEventListener('DOMContentLoaded', function() {
		btn = document.getElementById('theme-toggle');
		var saved = localStorage.getItem(STORAGE_KEY) || 'dark';
		applyTheme(saved);

		if (btn) {
			btn.addEventListener('click', function() {
				var current = localStorage.getItem(STORAGE_KEY) || 'dark';
				var next = current === 'dark' ? 'light' : 'dark';
				localStorage.setItem(STORAGE_KEY, next);
				applyTheme(next);
			});
		}

		// Mobile/Tablet: move #theme-toggle near bell icon, restore on desktop
		var rght = btn ? btn.closest('.Rght') : null;
		var notice = document.querySelector('.navbar-notice');
		var searchDesktop = document.getElementById('SearchDesktop');
		var searchMobile = document.getElementById('SearchMobile');
		var searchClone = null;
		var container = document.querySelector('.Header .Container');

		function repositionToggle() {
			if (!btn) return;
			var isMobile = window.innerWidth <= 992;
			if (isMobile) {
				if (notice && btn.parentNode !== notice) {
					notice.insertBefore(btn, notice.firstChild);
				}
				btn.style.display = 'inline-block';
				// Fallback: no #SearchMobile in DOM, clone #SearchDesktop to header bar
				if (!searchMobile && searchDesktop && container) {
					if (!searchClone) {
						searchClone = searchDesktop.cloneNode(true);
						searchClone.id = 'SearchMobile';
						searchClone.style.display = '';
						var cloneInput = searchClone.querySelector('input[name="keyword"]');
						if (cloneInput) {
							cloneInput.setAttribute('onkeyup', "onSearch(this.value,'SearchMobile')");
						}
						var cloneSuggest = searchClone.querySelector('.search-suggest');
						if (cloneSuggest) cloneSuggest.id = '';
					}
					if (!container.contains(searchClone)) {
						var menuBtn = container.querySelector('.MenuBtnClose');
						if (menuBtn && menuBtn.nextSibling) {
							container.insertBefore(searchClone, menuBtn.nextSibling);
						} else {
							container.appendChild(searchClone);
						}
					}
				}
			} else {
				if (rght && searchDesktop && btn.parentNode !== rght) {
					rght.insertBefore(btn, searchDesktop);
				}
				btn.style.display = '';
				// Remove cloned search on desktop
				if (searchClone && container.contains(searchClone)) {
					container.removeChild(searchClone);
				}
			}
		}
		repositionToggle();
		window.addEventListener('resize', repositionToggle);
		window.addEventListener('orientationchange', function(){ setTimeout(repositionToggle, 150); });
	});
})();

