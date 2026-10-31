/**
 * Tlačítko AKTUALIZOVAT a jeho podtlačítka (Zhlédnuté epizody, ČSFD hodnocení,
 * MAL hodnocení, Seznam, Všechno) - Krok 20.
 *
 * Odpovídá aUpdate*PBClicked() a EnableButtonsWhileUpdate() v Python aplikaci
 * (AnimeList.pyw, ř. 337-343, 386-628): AKTUALIZOVAT rozbalí a sbalí
 * podtlačítka, po spuštění aktualizace se podtlačítka sbalí, informační řádek
 * ukazuje průběh a řazení hlavičky je zamčené. Po dokončení zůstane výsledek
 * 2 s vidět (Python Timer(2, ...), ř. 567) a teprve potom se vše odemkne.
 *
 * Zapojené jsou "Zhlédnuté epizody" (Python UpdateWatched), "ČSFD
 * hodnocení" (Python UpdateCSFD), "MAL hodnocení" (Python UpdateMAL) a
 * "Seznam" (js/anime-sync.js, Python UpdateAnimeList); "Všechno" je vidět,
 * ale neaktivní. Nové anime (Seznam) i nová hodnocení a zhlédnuté epizody se
 * na stránce ukážou hned u každého anime, ne až po skončení celé aktualizace
 * (Python překreslí řádky až v Update*Done()); po dokončení se seznam ještě
 * jednou celý překreslí. Anime přeskočená při aktualizaci hodnocení nebo
 * zhlédnutých epizod (bez Python vzoru) a anime, jejichž hodnota se nezapsala do
 * data/anime.json, se vypíšou v liště a souhrn zůstane vidět až do další
 * aktualizace.
 *
 * Bez Python vzoru: chyba (neběžící pomocný program, změněná stránka zdroje,
 * ...) se zobrazí v liště a ovládání se hned odemkne. Výsledky zjištěné před
 * chybou (přidaná anime, hodnocení, zhlédnuté epizody) se zapíšou do
 * data/anime.json, případně zůstanou v prohlížeči. Během aktualizace jsou
 * navíc zamčené Upravit, Importovat, Obnovit a Push, protože by měnily stejná
 * data; Aktualizovat je neaktivní v edit módu.
 *
 * Tlačítko Push (bez Python vzoru) nechá pomocný program commitnout
 * data/anime.json s novými obrázky a pushnout je na GitHub. Spouští se jen
 * kliknutím, zamyká ovládání jako aktualizace a výsledek zůstane
 * v informačním řádku až do další akce.
 */
window.AnimeUpdate = (function () {
	'use strict';

	var DEFAULT_DONE_DELAY_MS = 2000;

	// Tlačítka, která se během aktualizace a Push zamykají. Řazení hlavičky zamyká
	// třída is-locked a kontrola isBusy() v js/anime-page.js.
	var LOCKED_IDS = ['anime-edit-toggle', 'anime-import-btn', 'anime-reset-btn', 'anime-push-btn'];

	var i18n = window.I18n;

	var options = null;
	var els = null;
	var actionButtons = [];
	var actions = {};
	var doneDelayMs = DEFAULT_DONE_DELAY_MS;

	var ready = false;
	var editMode = false;
	var busy = false;
	var menuOpen = false;
	var unlockTimer = null;

	// Právě spuštěná akce: 'list', 'csfd', 'mal', 'watched' nebo 'push'.
	var currentAction = null;
	// {action, kind: 'start' | 'progress' | 'done', percent, count} - text v informačním řádku.
	var progress = null;
	// Výsledek posledního Push ({committed, pushed, commit, files, browserOnly}); zůstane vidět do další akce.
	var pushResult = null;
	// {action, error, kept, keptKey, skipped, notInFile} - poslední chyba, počet
	// anime uložených před ní a anime přeskočená nebo nezapsaná do souboru.
	var failure = null;
	// {action, skipped, notInFile} po jinak dokončené aktualizaci hodnocení nebo
	// zhlédnutých epizod; souhrn zůstane vidět do další aktualizace.
	var skippedNotice = null;

	function byId(id) {
		return document.getElementById(id);
	}

	// Python rozlišuje 1-4 ("nové anime") a ostatní ("nových anime"), ř. 541-544.
	function pluralKey(base, count) {
		return base + (count >= 1 && count <= 4 ? '.few' : '.many');
	}

	function pushMessage(result) {
		var key = result.committed ? 'anime.push.done' : (result.pushed ? 'anime.push.donePushed' : 'anime.push.nothing');
		var text = i18n.t(key, { commit: result.commit, count: result.files });
		return result.browserOnly ? text + ' ' + i18n.t('anime.push.browserOnly') : text;
	}

	function renderInfo() {
		if (!els || !els.info) {
			return;
		}
		if (!progress) {
			els.info.textContent = pushResult ? pushMessage(pushResult) : '';
			return;
		}
		var key;
		if (progress.action === 'push') {
			key = 'anime.push.running';
		} else if (progress.action !== 'list') {
			key = 'anime.update.' + progress.action + '.' + progress.kind;
		} else if (progress.kind === 'start') {
			key = 'anime.update.list.start';
		} else if (progress.kind === 'progress') {
			key = pluralKey('anime.update.list.progress', progress.count);
		} else {
			key = progress.count === 0 ? 'anime.update.list.done.none' : pluralKey('anime.update.list.done', progress.count);
		}
		els.info.textContent = i18n.t(key, { percent: progress.percent.toFixed(2), count: progress.count });
	}

	function namesOf(entries) {
		return entries.map(function (entry) {
			return entry.name;
		}).join(', ');
	}

	// Souhrn anime, u kterých se hodnota (ČSFD/MAL hodnocení nebo zhlédnuté epizody podle notice.action)
	// nezjistila nebo nezapsala do souboru.
	function skippedMessage(notice) {
		var parts = [];
		var base = 'anime.update.' + notice.action;
		if (notice.skipped && notice.skipped.length > 0) {
			parts.push(i18n.t(base + '.failed', { count: notice.skipped.length, names: namesOf(notice.skipped) }));
		}
		if (notice.notInFile && notice.notInFile.length > 0) {
			parts.push(i18n.t(base + '.notInFile', { count: notice.notInFile.length, names: namesOf(notice.notInFile) }));
		}
		return parts.join(' ');
	}

	// Text chyby: u Push má přednost klíč anime.push.error.<kód>, jinak platí texty aktualizace.
	function errorText(action, code) {
		var keys = ['anime.update.error.' + code];
		if (action === 'push') {
			keys.unshift('anime.push.error.' + code);
		}
		for (var index = 0; code && index < keys.length; index += 1) {
			var translated = i18n.t(keys[index]);
			if (translated !== keys[index]) {
				return translated;
			}
		}
		return null;
	}

	function errorMessage(current) {
		var error = current.error || {};
		var code = typeof error.code === 'string' ? error.code : '';
		var translated = errorText(current.action, code);
		var known = translated !== null;
		var generic = current.action === 'push' ? 'anime.push.error.generic' : 'anime.update.error.generic';
		var parts = [known ? translated : i18n.t(generic)];
		if (error.favorite) {
			parts.push(i18n.t('anime.update.error.favorite', { name: error.favorite }));
		}
		var detail = known ? error.detail : [code, error.detail || error.message].filter(Boolean).join(' ');
		if (detail) {
			parts.push(i18n.t('anime.update.error.detail', { detail: detail }));
		}
		if (current.kept > 0) {
			parts.push(i18n.t(current.keptKey, { count: current.kept }));
		}
		var notice = skippedMessage(current);
		if (notice) {
			parts.push(notice);
		}
		return parts.join(' ');
	}

	function renderError() {
		if (!els || !els.error) {
			return;
		}
		var text = '';
		if (failure) {
			text = errorMessage(failure);
		} else if (skippedNotice) {
			text = skippedMessage(skippedNotice);
		}
		els.error.textContent = text;
		els.error.hidden = text === '';
	}

	function setMenuOpen(open) {
		menuOpen = open;
		els.menu.hidden = !open;
		els.toggle.setAttribute('aria-expanded', String(open));
	}

	function refreshControls() {
		if (!els) {
			return;
		}
		var blocked = !ready || busy || editMode;
		els.toggle.disabled = blocked;
		if (editMode) {
			els.toggle.setAttribute('data-i18n-title', 'anime.update.disabledEdit');
			els.toggle.setAttribute('title', i18n.t('anime.update.disabledEdit'));
		} else {
			els.toggle.removeAttribute('data-i18n-title');
			els.toggle.removeAttribute('title');
		}
		actionButtons.forEach(function (button) {
			button.disabled = blocked || !actions[button.getAttribute('data-update-action')];
		});
		LOCKED_IDS.forEach(function (id) {
			var el = byId(id);
			if (el) {
				el.disabled = busy;
			}
		});
		if (els.header) {
			els.header.classList.toggle('is-locked', busy);
		}
		if (blocked && menuOpen) {
			setMenuOpen(false);
		}
	}

	// Po sbalení nabídky ztratí fokus tlačítko, které akci spustilo (u Push zamčené tlačítko Push).
	function restoreFocus() {
		var target = currentAction === 'push' && els.push ? els.push : els.toggle;
		var active = document.activeElement;
		if ((!active || active === document.body) && !target.disabled) {
			target.focus({ preventScroll: true });
		}
	}

	function begin(action) {
		window.clearTimeout(unlockTimer);
		unlockTimer = null;
		busy = true;
		currentAction = action;
		failure = null;
		skippedNotice = null;
		pushResult = null;
		progress = { action: action, kind: 'start', percent: 0, count: 0 };
		renderError();
		renderInfo();
		refreshControls();
	}

	function finish(total) {
		progress = { action: progress ? progress.action : 'list', kind: 'done', percent: 100, count: total };
		renderInfo();
		unlockTimer = window.setTimeout(function () {
			unlockTimer = null;
			progress = null;
			renderInfo();
			busy = false;
			refreshControls();
			restoreFocus();
		}, doneDelayMs);
	}

	function fail(error, kept, keptKey) {
		if (window.console && typeof window.console.error === 'function') {
			window.console.error('Anime update failed:', error);
		}
		progress = null;
		renderInfo();
		failure = {
			action: currentAction, error: error, kept: kept, keptKey: keptKey,
			skipped: error && error.failures, notInFile: error && error.notInFile
		};
		renderError();
		busy = false;
		refreshControls();
		restoreFocus();
	}

	/** Aktualizovat -> Seznam (Python aUpdateListPBClicked(), ř. 512-517). */
	function runList() {
		if (busy || !ready || editMode) {
			return;
		}
		var added = 0;
		begin('list');
		window.AnimeSync.updateList({
			proxy: window.AnimeProxy,
			data: options.data,
			onTotal: function (total) {
				// Bez nových anime Python průběh nehlásí, zůstane "0.00% Aktualizuji anime list".
				if (total > 0) {
					progress = { action: 'list', kind: 'progress', percent: 0, count: total };
					renderInfo();
				}
			},
			onProgress: function (percent) {
				if (progress && progress.kind === 'progress') {
					progress.percent = percent;
					renderInfo();
				}
			},
			onItemAdded: function (item, items) {
				added += 1;
				options.onItemsChanged(items);
			}
		}).then(function (result) {
			finish(result.total);
		}, function (error) {
			var keptKey = 'anime.update.list.kept' + (error && error.savedTo === 'file' ? 'File' : 'Browser');
			fail(error, added, keptKey);
		});
	}

	/**
	 * Aktualizace jednoho pole všech anime: ČSFD hodnocení (Python
	 * aUpdateCsfdPBClicked(), ř. 435-439, a UpdateCSFDDone(), ř. 457-472),
	 * MAL hodnocení (aUpdateMalPBClicked(), ř. 474-478, a UpdateMALDone(),
	 * ř. 496-510) a zhlédnuté epizody (aUpdateWatchedPBClicked(), ř. 386-390,
	 * a UpdateWatchedDone(), ř. 418-433).
	 * @param {string} action - 'csfd', 'mal' nebo 'watched'
	 * @param {function(Object): Promise} update - AnimeSync.updateCsfd, updateMal nebo updateWatched
	 * @param {string} label - co se aktualizuje, v hlášení do konzole
	 * @param {string} keptBase - začátek klíčů textu o hodnotách uložených před chybou (+ 'File' / 'Browser')
	 */
	function runItems(action, update, label, keptBase) {
		if (busy || !ready || editMode) {
			return;
		}
		begin(action);
		update({
			proxy: window.AnimeProxy,
			data: options.data,
			onProgress: function (percent) {
				progress = { action: action, kind: 'progress', percent: percent, count: 0 };
				renderInfo();
			},
			// Řádek anime se překreslí hned po zjištění jeho hodnoty, ne až po zápisu do souboru.
			onItemUpdated: function (item, field) {
				if (typeof options.onItemUpdated === 'function') {
					options.onItemUpdated(item, field);
				}
			}
		}).then(function (result) {
			// Python po dokončení jen přepíše hodnoty v řádcích, pořadí se nemění.
			renderAllItems();
			if (result.failures.length > 0 || result.notInFile.length > 0) {
				if (window.console && typeof window.console.warn === 'function') {
					window.console.warn(label + ' not updated for:', result.failures, 'not in data file:', result.notInFile);
				}
				skippedNotice = { action: action, skipped: result.failures, notInFile: result.notInFile };
				renderError();
			}
			finish(result.total);
		}, function (error) {
			if (error && error.updated > 0) {
				renderAllItems();
			}
			var keptKey = keptBase + (error && error.savedTo === 'file' ? 'File' : 'Browser');
			fail(error, (error && error.updated) || 0, keptKey);
		});
	}

	// Překreslí celý seznam; chyba vykreslení nesmí nechat ovládání zamčené.
	function renderAllItems() {
		try {
			options.onItemsChanged(options.data.getItems());
		} catch (error) {
			if (window.console && typeof window.console.error === 'function') {
				window.console.error('Anime list render failed:', error);
			}
		}
	}

	/** Aktualizovat -> Zhlédnuté epizody. */
	function runWatched() {
		runItems('watched', window.AnimeSync.updateWatched, 'Watched episodes', 'anime.update.watched.kept');
	}

	/** Aktualizovat -> ČSFD hodnocení. */
	function runCsfd() {
		runItems('csfd', window.AnimeSync.updateCsfd, 'CSFD rating', 'anime.update.error.keptRatings');
	}

	/** Aktualizovat -> MAL hodnocení. */
	function runMal() {
		runItems('mal', window.AnimeSync.updateMal, 'MAL rating', 'anime.update.error.keptRatings');
	}

	/**
	 * Push (bez Python vzoru): commit a push data/anime.json a nových obrázků
	 * přes pomocný program. Data stránky se nemění, proto nevadí edit mód
	 * ani nenačtená data; výsledek zůstane vidět do další akce.
	 */
	function runPush() {
		if (busy) {
			return;
		}
		begin('push');
		window.AnimeSync.publish({ proxy: window.AnimeProxy }).then(function (result) {
			pushResult = {
				committed: result.committed, pushed: result.pushed, commit: result.commit, files: result.files,
				// Úpravy jen v prohlížeči (edit mód, import, nezapsané výsledky) se do repozitáře nedostanou.
				browserOnly: Boolean(options.data && options.data.hasStoredItems && options.data.hasStoredItems())
			};
			progress = null;
			renderInfo();
			busy = false;
			refreshControls();
			restoreFocus();
		}, function (error) {
			fail(error, 0, '');
		});
	}

	/**
	 * @param {Object} opts
	 * @param {Object} opts.data - AnimeData
	 * @param {function(Array)} opts.onItemsChanged - překreslí seznam: po každém
	 *     přidaném anime (Seznam) a po dokončení ostatních aktualizací
	 * @param {function(Object, string)} [opts.onItemUpdated] - překreslí jednu
	 *     hodnotu (položka, název pole) hned po jejím zjištění (hodnocení, zhlédnuté epizody)
	 * @param {number} [opts.doneDelayMs] - jak dlouho zůstane vidět výsledek (výchozí 2000)
	 * @returns {boolean} false, pokud stránka nemá potřebné prvky
	 */
	function init(opts) {
		options = opts;
		doneDelayMs = typeof opts.doneDelayMs === 'number' ? opts.doneDelayMs : DEFAULT_DONE_DELAY_MS;
		els = {
			toggle: byId('anime-update-toggle'),
			menu: byId('anime-update-menu'),
			info: byId('anime-update-info'),
			error: byId('anime-update-error'),
			header: byId('anime-header'),
			push: byId('anime-push-btn')
		};
		if (!els.toggle || !els.menu) {
			els = null;
			return false;
		}
		if (els.push) {
			els.push.addEventListener('click', runPush);
		}

		// "Všechno" zatím zapojené není; jeho tlačítko je neaktivní.
		actions = { watched: runWatched, csfd: runCsfd, mal: runMal, list: runList };
		actionButtons = Array.prototype.slice.call(els.menu.querySelectorAll('[data-update-action]'));
		actionButtons.forEach(function (button) {
			var name = button.getAttribute('data-update-action');
			if (actions[name]) {
				button.addEventListener('click', actions[name]);
			} else {
				button.setAttribute('data-i18n-title', 'anime.update.soon');
			}
		});
		i18n.applyStatic(els.menu);

		els.toggle.addEventListener('click', function (event) {
			setMenuOpen(!menuOpen);
			if (!menuOpen) {
				return;
			}
			// Panel je v DOM až za tlačítky lišty, takže ho po otevření dostaneme do dohledu.
			els.menu.scrollIntoView({ block: 'nearest' });
			if (event.detail === 0) {
				// Z klávesnice (Enter/mezerník) se jinak k podtlačítkům nedá dojít bez průchodu přes Upravit.
				var first = actionButtons.filter(function (button) {
					return !button.disabled;
				})[0];
				if (first) {
					first.focus({ preventScroll: true });
				}
			}
		});
		document.addEventListener('keydown', function (event) {
			if (event.key === 'Escape' && menuOpen) {
				setMenuOpen(false);
				els.toggle.focus({ preventScroll: true });
			}
		});
		document.addEventListener('site:langchange', function () {
			renderInfo();
			renderError();
		});
		window.addEventListener('beforeunload', function (event) {
			// Zavřená stránka uprostřed aktualizace by přišla o rozpracované anime.
			if (busy) {
				event.preventDefault();
				event.returnValue = '';
			}
		});

		refreshControls();
		return true;
	}

	function setReady(value) {
		ready = Boolean(value);
		refreshControls();
	}

	function setEditMode(value) {
		editMode = Boolean(value);
		refreshControls();
	}

	function isBusy() {
		return busy;
	}

	return {
		init: init,
		setReady: setReady,
		setEditMode: setEditMode,
		isBusy: isBusy
	};
})();
