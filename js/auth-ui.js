/**
 * Ovládání přihlašovacího dialogu a stavu přihlášení v UI.
 *
 * Skript se načítá na konci stránky. Vlastní logika přístupu je v js/auth.js.
 */
(function () {
	'use strict';

	var auth = window.SiteAuth;
	if (!auth) {
		return;
	}

	var ROLE_LABELS = {};
	ROLE_LABELS[auth.ROLES.NV194] = 'Přístup ke stránce NV194';
	ROLE_LABELS[auth.ROLES.FULL] = 'Přístup ke všem stránkám';

	var PAGE_LABELS = {
		'index.html': 'Home',
		'personal.html': 'Personal',
		'cv.html': 'CV',
		'games.html': 'Games',
		'contact.html': 'Contact',
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

	function pageLabel(page) {
		return PAGE_LABELS[page] || page;
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
		revealBtn.textContent = revealed ? 'Skrýt' : 'Zobrazit';
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
			titleEl.textContent = signedIn ? 'Jste přihlášeni' : 'Přihlášení';
		}
		if (leadEl) {
			leadEl.textContent = signedIn
				? 'Přihlášení platí do zavření prohlížeče.'
				: 'Chráněné stránky jsou dostupné po zadání hesla.';
		}

		if (signedIn) {
			if (statusRoleEl) {
				statusRoleEl.textContent = ROLE_LABELS[role] || role;
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
			label.textContent = role === null ? 'Přihlásit' : 'Přihlášen';
		}
		openBtn.classList.toggle('is-signed-in', role !== null);
		openBtn.title = role === null
			? 'Přihlásit se'
			: (ROLE_LABELS[role] || 'Přihlášen');
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

	function refreshAll() {
		refreshButton();
		refreshMenu();
		refreshPanels();
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
			showError('Nesprávné heslo.');
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

	/* --- Start --- */

	refreshAll();

	// Pokud návštěvník přišel z chráněné stránky, rovnou nabídneme přihlášení.
	var denied = new URLSearchParams(window.location.search).get('denied');
	if (denied) {
		var deniedPage = denied.toLowerCase();
		if (auth.canAccess(deniedPage)) {
			window.location.replace(auth.BASE_PATH + deniedPage);
		} else {
			setNotice('Stránka ' + pageLabel(deniedPage) + ' vyžaduje přihlášení.');
			openModal(deniedPage);
			// Parametr v adrese už není potřeba.
			window.history.replaceState({}, '', window.location.pathname);
		}
	}
})();
