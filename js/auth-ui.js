/**
 * Ovládání přihlašovacího dialogu a stavu přihlášení v UI.
 *
 * Skript se načítá na konci stránky. Vlastní logika přístupu je v js/auth.js.
 * Texty se překládají přes window.I18n - viz js/i18n.js.
 */
(function () {
	'use strict';

	var auth = window.SiteAuth;
	var i18n = window.I18n;
	if (!auth || !i18n) {
		return;
	}

	var t = i18n.t;

	var ROLE_LABEL_KEYS = {};
	ROLE_LABEL_KEYS[auth.ROLES.NV194] = 'auth.role.nv194';
	ROLE_LABEL_KEYS[auth.ROLES.FULL] = 'auth.role.full';

	/* Jméno stránky NV 194 je jednotné v obou jazycích, ostatní se překládají stejně jako v nabídce. */
	var PAGE_LABEL_KEYS = {
		'index.html': 'nav.home',
		'personal.html': 'nav.personal',
		'cv.html': 'nav.cv',
		'games.html': 'nav.games',
		'contact.html': 'nav.contact',
		'nv194.html': null
	};
	var PAGE_LABEL_FALLBACK = {
		'nv194.html': 'NV 194'
	};

	var openBtn = document.getElementById('auth-btn');
	var modal = document.getElementById('auth-modal');
	var form = document.getElementById('auth-form');
	var input = document.getElementById('auth-password');
	var errorEl = document.getElementById('auth-error');
	var noticeEl = document.getElementById('auth-notice');
	var loginPanel = document.getElementById('auth-login-panel');
	var statusPanel = document.getElementById('auth-status-panel');
	var statusRoleEl = document.getElementById('auth-status-role');
	var statusPagesEl = document.getElementById('auth-status-pages');
	var logoutBtn = document.getElementById('auth-logout');
	var revealBtn = document.getElementById('auth-reveal');

	if (!openBtn || !modal || !form || !input) {
		return;
	}

	/** Stránka, na kterou se má po úspěšném přihlášení přejít. */
	var pendingTarget = null;
	var lastFocused = null;
	/** Stránka, kvůli které je zobrazená hláška "vyžaduje přihlášení" - drží se kvůli přepočtu při změně jazyka. */
	var deniedNoticePage = null;

	function pageLabel(page) {
		var key = PAGE_LABEL_KEYS[page];
		if (key) {
			return t(key);
		}
		return PAGE_LABEL_FALLBACK[page] || page;
	}

	/* --- Otevírání a zavírání --- */

	function isOpen() {
		return !modal.hidden;
	}

	function openModal(target) {
		pendingTarget = target || null;
		lastFocused = document.activeElement;

		refreshPanels();
		modal.hidden = false;
		document.body.classList.add('auth-modal-open');

		if (auth.role() === null) {
			input.value = '';
			input.focus();
		} else if (logoutBtn) {
			logoutBtn.focus();
		}
	}

	function closeModal() {
		modal.hidden = true;
		document.body.classList.remove('auth-modal-open');
		pendingTarget = null;
		hideError();
		input.value = '';
		setRevealed(false);

		if (lastFocused && typeof lastFocused.focus === 'function') {
			lastFocused.focus();
		}
	}

	function showError(message) {
		if (!errorEl) {
			return;
		}
		errorEl.textContent = message;
		errorEl.hidden = false;
		input.setAttribute('aria-invalid', 'true');
	}

	function hideError() {
		if (!errorEl) {
			return;
		}
		errorEl.hidden = true;
		errorEl.textContent = '';
		input.removeAttribute('aria-invalid');
	}

	function setNotice(message) {
		if (!noticeEl) {
			return;
		}
		if (!message) {
			deniedNoticePage = null;
			noticeEl.hidden = true;
			noticeEl.textContent = '';
			return;
		}
		noticeEl.hidden = false;
		noticeEl.textContent = message;
	}

	function setRevealed(revealed) {
		if (!revealBtn) {
			return;
		}
		input.type = revealed ? 'text' : 'password';
		revealBtn.textContent = revealed ? t('auth.form.reveal.hide') : t('auth.form.reveal.show');
		revealBtn.setAttribute('aria-pressed', String(revealed));
	}

	/* --- Vykreslení stavu --- */

	var titleEl = document.getElementById('auth-title');
	var leadEl = modal.querySelector('.auth-modal__lead');

	function refreshPanels() {
		var role = auth.role();
		var signedIn = role !== null;

		if (loginPanel) {
			loginPanel.hidden = signedIn;
		}
		if (statusPanel) {
			statusPanel.hidden = !signedIn;
		}

		if (titleEl) {
			titleEl.textContent = signedIn ? t('auth.title.loggedIn') : t('auth.title.login');
		}
		if (leadEl) {
			leadEl.textContent = signedIn ? t('auth.lead.loggedIn') : t('auth.lead.login');
		}

		if (signedIn) {
			if (statusRoleEl) {
				statusRoleEl.textContent = ROLE_LABEL_KEYS[role] ? t(ROLE_LABEL_KEYS[role]) : role;
			}
			if (statusPagesEl) {
				statusPagesEl.textContent = auth.accessiblePages().map(pageLabel).join(', ');
			}
		}
	}

	function refreshButton() {
		var role = auth.role();
		var label = openBtn.querySelector('.auth-btn__label');

		if (label) {
			label.textContent = role === null ? t('auth.openButton.login') : t('auth.openButton.loggedIn');
		}
		openBtn.classList.toggle('is-signed-in', role !== null);
		openBtn.title = role === null
			? t('auth.form.submit')
			: (ROLE_LABEL_KEYS[role] ? t(ROLE_LABEL_KEYS[role]) : t('auth.openButton.loggedIn'));
	}

	/**
	 * Odkazy na nedostupné stránky se v nabídce vůbec nezobrazují - bez
	 * oprávnění pro ně není důvod nabídku zaplňovat.
	 */
	function refreshMenu() {
		var links = document.querySelectorAll('.menu__link');

		Array.prototype.forEach.call(links, function (link) {
			var href = link.getAttribute('href') || '';
			var page = href.split('/').pop().split('?')[0].toLowerCase();
			if (page === '') {
				return;
			}

			link.hidden = !auth.canAccess(page);
		});
	}

	/** Znovu přeloží texty, které jsou zobrazené v danou chvíli (chyba/hláška), pokud jsou vidět. */
	function refreshTransientTexts() {
		if (errorEl && !errorEl.hidden) {
			errorEl.textContent = t('auth.form.error');
		}
		if (noticeEl && !noticeEl.hidden && deniedNoticePage) {
			noticeEl.textContent = t('auth.notice.pageRequiresLoginDirect', { page: pageLabel(deniedNoticePage) });
		}
		setRevealed(input.type === 'text');
	}

	function refreshAll() {
		refreshButton();
		refreshMenu();
		refreshPanels();
		refreshTransientTexts();
	}

	/* --- Události --- */

	openBtn.addEventListener('click', function () {
		if (isOpen()) {
			closeModal();
		} else {
			setNotice('');
			openModal(null);
		}
	});

	modal.addEventListener('click', function (event) {
		if (event.target.hasAttribute('data-auth-close')) {
			closeModal();
		}
	});

	document.addEventListener('keydown', function (event) {
		if (event.key === 'Escape' && isOpen()) {
			closeModal();
		}
	});

	if (revealBtn) {
		revealBtn.addEventListener('click', function () {
			setRevealed(input.type === 'password');
			input.focus();
		});
	}

	input.addEventListener('input', hideError);

	form.addEventListener('submit', function (event) {
		event.preventDefault();

		var granted = auth.login(input.value);

		if (granted === null) {
			showError(t('auth.form.error'));
			input.select();
			return;
		}

		var target = pendingTarget;
		refreshAll();
		closeModal();

		if (target && auth.canAccess(target)) {
			window.location.href = auth.BASE_PATH + target;
			return;
		}

		// Bez konkrétního cíle zůstáváme na místě, jen se aktualizuje nabídka.
		setNotice('');
	});

	if (logoutBtn) {
		logoutBtn.addEventListener('click', function () {
			auth.logout();
			closeModal();

			// Z chráněné stránky je nutné odejít, jinak by zůstala zobrazená.
			if (!auth.canAccess(auth.currentPage())) {
				window.location.replace(auth.homeUrl());
				return;
			}
			refreshAll();
		});
	}

	document.addEventListener('site:langchange', refreshAll);

	/* --- Start --- */

	refreshAll();

	// Pokud návštěvník přišel z chráněné stránky, rovnou nabídneme přihlášení.
	var denied = new URLSearchParams(window.location.search).get('denied');
	if (denied) {
		var deniedPage = denied.toLowerCase();
		if (auth.canAccess(deniedPage)) {
			window.location.replace(auth.BASE_PATH + deniedPage);
		} else {
			deniedNoticePage = deniedPage;
			setNotice(t('auth.notice.pageRequiresLoginDirect', { page: pageLabel(deniedPage) }));
			openModal(deniedPage);
			// Parametr v adrese už není potřeba.
			window.history.replaceState({}, '', window.location.pathname);
		}
	}
})();
