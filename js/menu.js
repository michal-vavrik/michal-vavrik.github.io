/**
 * Navigace v horní liště, sdílená všemi stránkami.
 *
 * Na úzkých obrazovkách (viz css/main.css) je navigace schovaná v panelu,
 * který otevírá tlačítko .menu__toggler. Panel se zavře klávesou Escape,
 * kliknutím mimo lištu, výběrem odkazu nebo rozšířením okna na šířku, při
 * které jsou odkazy vidět přímo v liště.
 */
(function () {
	'use strict';

	var toggler = document.querySelector('.menu__toggler');
	var menu = document.querySelector('.menu');
	if (!toggler || !menu) {
		return;
	}

	var header = toggler.closest('.site-header') || toggler.parentNode;
	var wideScreen = window.matchMedia('(min-width: 64em)');

	function isOpen() {
		return menu.classList.contains('active');
	}

	function setOpen(open) {
		toggler.classList.toggle('active', open);
		menu.classList.toggle('active', open);
		toggler.setAttribute('aria-expanded', String(open));
	}

	toggler.addEventListener('click', function () {
		setOpen(!isOpen());
	});

	menu.addEventListener('click', function (event) {
		if (event.target.closest('.menu__link')) {
			setOpen(false);
		}
	});

	document.addEventListener('click', function (event) {
		if (isOpen() && !header.contains(event.target)) {
			setOpen(false);
		}
	});

	document.addEventListener('keydown', function (event) {
		if (event.key === 'Escape' && isOpen()) {
			setOpen(false);
			toggler.focus();
		}
	});

	function onWidthChange() {
		if (wideScreen.matches) {
			setOpen(false);
		}
	}

	if (wideScreen.addEventListener) {
		wideScreen.addEventListener('change', onWidthChange);
	} else {
		wideScreen.addListener(onWidthChange);
	}
})();