/**
 * Doplňkové efekty stránky CV: dopočítání délky praxe, animované statistiky,
 * postupné zobrazování obsahu při scrollování, interaktivní náklon fotky,
 * ukazatel postupu čtení a tisk.
 *
 * Všechny animace respektují nastavení `prefers-reduced-motion`.
 */
(function () {
	'use strict';

	var i18n = window.I18n;
	if (!i18n) {
		return;
	}

	var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	/** Datum nástupu do aktuální pozice v B&R Industrial Automation. */
	var START_DATE = new Date(2020, 8, 1);

	/* --- Délka praxe --- */

	/** Český plurál potřebuje tři tvary (1 / 2-4 / 5+), angličtina vystačí se dvěma. */
	function pluralForm(count) {
		if (count === 1) {
			return 'one';
		}
		if (count >= 2 && count <= 4) {
			return 'few';
		}
		return 'many';
	}

	function monthsSinceStart() {
		var now = new Date();
		var months = (now.getFullYear() - START_DATE.getFullYear()) * 12 + (now.getMonth() - START_DATE.getMonth());
		if (now.getDate() < START_DATE.getDate()) {
			months -= 1;
		}
		return Math.max(0, months);
	}

	function renderDuration() {
		var durationEl = document.getElementById('cv-experience-duration');
		if (!durationEl) {
			return;
		}

		var months = monthsSinceStart();
		var years = Math.floor(months / 12);
		var remMonths = months % 12;

		var parts = [];
		if (years > 0) {
			parts.push(i18n.t('cv.duration.year.' + pluralForm(years), { n: years }));
		}
		if (remMonths > 0 || years === 0) {
			parts.push(i18n.t('cv.duration.month.' + pluralForm(remMonths), { n: remMonths }));
		}

		durationEl.textContent = '(' + parts.join(' ') + ')';
	}

	/* --- Animovaná počítadla ve statistikách --- */

	function animateCount(el, target) {
		if (target <= 0) {
			el.textContent = '0';
			return;
		}
		if (prefersReducedMotion) {
			el.textContent = String(target);
			return;
		}

		var duration = 1300;
		var start = null;

		function step(timestamp) {
			if (start === null) {
				start = timestamp;
			}
			var progress = Math.min((timestamp - start) / duration, 1);
			var eased = 1 - Math.pow(1 - progress, 3);
			el.textContent = String(Math.round(eased * target));
			if (progress < 1) {
				window.requestAnimationFrame(step);
			} else {
				el.textContent = String(target);
			}
		}

		window.requestAnimationFrame(step);
	}

	/**
	 * Počty ve statistikách se odvozují přímo z obsahu stránky (délka praxe,
	 * počet uvedených dovedností a jazyků), takže zůstanou vždy pravdivé i po
	 * budoucích úpravách obsahu.
	 */
	function setupStats() {
		var yearsEl = document.getElementById('cv-stat-years');
		var skillsEl = document.getElementById('cv-stat-skills');
		var languagesEl = document.getElementById('cv-stat-languages');

		if (yearsEl) {
			var years = Math.max(1, Math.floor(monthsSinceStart() / 12));
			yearsEl.setAttribute('data-count-to', String(years));
		}
		if (skillsEl) {
			var skillCount = document.querySelectorAll('.cv-skills__tags li').length;
			skillsEl.setAttribute('data-count-to', String(skillCount));
		}
		if (languagesEl) {
			var languageCount = document.querySelectorAll('.cv-language').length;
			languagesEl.setAttribute('data-count-to', String(languageCount));
		}

		Array.prototype.forEach.call(document.querySelectorAll('.cv-stat__value[data-count-to]'), function (el) {
			var target = parseInt(el.getAttribute('data-count-to'), 10) || 0;
			animateCount(el, target);
		});
	}

	/* --- Postupné zobrazování obsahu při scrollování --- */

	/** Prvky ve stejném rodiči se zobrazí postupně za sebou (kaskáda). */
	function revealDelay(el) {
		var parent = el.parentElement;
		if (!parent) {
			return 0;
		}
		var siblings = Array.prototype.filter.call(parent.children, function (child) {
			return child.classList.contains('reveal');
		});
		var index = siblings.indexOf(el);
		return Math.min(Math.max(index, 0), 6) * 90;
	}

	function initReveal() {
		var items = document.querySelectorAll('.reveal');
		if (!items.length) {
			return;
		}

		if (prefersReducedMotion || !('IntersectionObserver' in window)) {
			Array.prototype.forEach.call(items, function (el) {
				el.classList.add('reveal--visible');
			});
			return;
		}

		var observer = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (!entry.isIntersecting) {
					return;
				}
				var el = entry.target;
				el.style.transitionDelay = revealDelay(el) + 'ms';
				el.classList.add('reveal--visible');
				observer.unobserve(el);
			});
		}, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

		Array.prototype.forEach.call(items, function (el) {
			observer.observe(el);
		});
	}

	/* --- Interaktivní náklon fotky a zář sledující kurzor --- */

	function initHeroInteraction() {
		var hero = document.querySelector('.cv-hero');
		var photo = document.querySelector('.cv-hero__photo-img');
		if (!hero || !photo || prefersReducedMotion) {
			return;
		}
		if (!window.matchMedia('(pointer: fine)').matches) {
			return;
		}

		hero.addEventListener('mousemove', function (event) {
			var rect = hero.getBoundingClientRect();
			var x = (event.clientX - rect.left) / rect.width;
			var y = (event.clientY - rect.top) / rect.height;

			hero.style.setProperty('--spot-x', (x * 100) + '%');
			hero.style.setProperty('--spot-y', (y * 100) + '%');

			var rotateY = (x - 0.5) * 10;
			var rotateX = (0.5 - y) * 10;
			photo.style.transform = 'perspective(600px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg)';
		});

		hero.addEventListener('mouseleave', function () {
			photo.style.transform = '';
		});
	}

	/* --- Ukazatel postupu čtení stránky --- */

	function initScrollProgress() {
		var bar = document.getElementById('scroll-progress');
		if (!bar) {
			return;
		}

		function update() {
			var scrollable = document.documentElement.scrollHeight - document.documentElement.clientHeight;
			var progress = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
			bar.style.width = Math.min(100, Math.max(0, progress)) + '%';
		}

		window.addEventListener('scroll', update, { passive: true });
		window.addEventListener('resize', update);
		update();
	}

	/* --- Tisk --- */

	function initPrintButton() {
		var printBtn = document.getElementById('cv-print');
		if (!printBtn) {
			return;
		}
		printBtn.addEventListener('click', function () {
			window.print();
		});
	}

	renderDuration();
	setupStats();
	initReveal();
	initHeroInteraction();
	initScrollProgress();
	initPrintButton();

	document.addEventListener('site:langchange', renderDuration);
})();
