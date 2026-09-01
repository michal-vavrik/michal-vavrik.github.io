/**
 * Rozbalovací přepínač jazyka vedle přihlašovacího tlačítka.
 *
 * Komponenta pouze ovládá otevírání/zavírání nabídky a volá
 * window.I18n.setLang(); samotný překlad textů obstarává js/i18n.js.
 */
(function () {
	'use strict';

	var i18n = window.I18n;
	if (!i18n) {
		return;
	}

	var root = document.getElementById('lang-switcher');
	var toggleBtn = document.getElementById('lang-switcher-toggle');
	var codeEl = document.getElementById('lang-switcher-code');
	var menu = document.getElementById('lang-switcher-menu');

	if (!root || !toggleBtn || !menu) {
		return;
	}

	var options = menu.querySelectorAll('[data-lang]');

	function isOpen() {
		return !menu.hidden;
	}

	function closeMenu() {
		menu.hidden = true;
		toggleBtn.setAttribute('aria-expanded', 'false');
	}

	function openMenu() {
		menu.hidden = false;
		toggleBtn.setAttribute('aria-expanded', 'true');
	}

	function refresh() {
		var lang = i18n.getLang();

		if (codeEl) {
			codeEl.textContent = i18n.t('lang.code.' + lang);
		}

		Array.prototype.forEach.call(options, function (option) {
			var isActive = option.getAttribute('data-lang') === lang;
			option.classList.toggle('is-active', isActive);
			option.setAttribute('aria-checked', String(isActive));
		});
	}

	toggleBtn.addEventListener('click', function () {
		if (isOpen()) {
			closeMenu();
		} else {
			openMenu();
		}
	});

	Array.prototype.forEach.call(options, function (option) {
		option.addEventListener('click', function () {
			i18n.setLang(option.getAttribute('data-lang'));
			closeMenu();
			toggleBtn.focus();
		});
	});

	document.addEventListener('click', function (event) {
		if (isOpen() && !root.contains(event.target)) {
			closeMenu();
		}
	});

	document.addEventListener('keydown', function (event) {
		if (event.key === 'Escape' && isOpen()) {
			closeMenu();
			toggleBtn.focus();
		}
	});

	document.addEventListener('site:langchange', refresh);

	refresh();
})();
