/**
 * Anime list - vstupní skript stránky.
 *
 * Načte data ze souboru data/anime.json, vykreslí hlavičku a seznam,
 * zajišťuje interaktivní řazení (klik na hlavičku) a hledání podle
 * NameEn/NameJa (mirror Python MainWindow.Sort() a SearchForAnime()).
 * Klávesová zkratka Escape v poli hledání vyprázdní filtr (web-only,
 * Python aplikace žádné klávesové zkratky nemá). Když se data načíst
 * nepodaří, ukáže se místo seznamu hláška #anime-load-error.
 *
 * Action-bar (Aktualizovat, Push, Upravit) vidí a používá jen role FULL
 * (js/auth.js). Role Anime má stránku jen ke čtení a na pomocníka se vůbec
 * neobrací. Role se na stránce za běhu nezmění: přihlásit se dá jen
 * z odhlášeného stavu a odhlášení vede pryč ze stránky (js/auth-ui.js).
 *
 * Tlačítko UPRAVIT/ULOŽIT přepíná edit mód (mirror Python aSwitchEdit(),
 * ř. 576-608). Uložení zapíše změněné hodnoty přes pomocníka do
 * data/anime.json (js/anime-sync.js saveEdits(), mirror Python
 * WriteDataToTheFile()). Změněné hodnoty se před zápisem ověří (web-only,
 * Python žádnou validaci vstupu nedělá): neplatná hodnota nebo stejné
 * Number u více anime uložení zablokuje. Když se zápis nepovede, edit mód
 * zůstane i s rozepsanými hodnotami. Opuštění stránky v edit módu zobrazí
 * potvrzovací dialog prohlížeče.
 *
 * Tlačítko AKTUALIZOVAT s podtlačítky a Push řídí js/anime-update.js
 * (mirror Python aUpdate*PBClicked()) - každé nově přidané anime, nové
 * hodnocení i zhlédnutá epizoda se hned vykreslí a během aktualizace je
 * zamčené řazení hlavičky.
 *
 * Přístupnost: role="alert" na chybových hláškách, aria-pressed na tlačítku
 * UPRAVIT/ULOŽIT, aria-sort na řaditelných sloupcích hlavičky
 * (js/anime-view.js), aria-label na editovatelných polích
 * (js/anime-row-view.js) a aria-invalid na neplatných hodnotách.
 */
(function () {
	'use strict';

	var i18n = window.I18n;
	var data = window.AnimeData;
	var view = window.AnimeView;
	var update = window.AnimeUpdate;

	// Výchozí řazení - stejné jako Python (MainWindow.__init__, řádek 79):
	// ActualSorting = {"Column": "Number", "Ascending": True}.
	var sortState = { column: 'Number', ascending: true };

	// Aktuální hledaný text (mirror Python Self.BottomBar.SearchLE, prázdné = vše viditelné).
	var searchText = '';

	// Edit mód (mirror Python globální gEditMode, ř. 67).
	var editMode = false;

	// Úpravy se právě zapisují přes pomocníka.
	var saving = false;

	// Zobrazená chyba edit módu, aby ji šlo přeložit po změně jazyka:
	// { key } = text z i18n, { error } = chyba zápisu, null = žádná.
	var editError = null;

	var NUMBER_PATTERN = /^[1-9]\d{0,5}$/;
	var DATE_PATTERN = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
	// Stejný limit jako MAX_EDIT_VALUE v tools/anime_proxy.py.
	var MAX_TEXT_LENGTH = 20000;

	function canManage() {
		var auth = window.SiteAuth;
		return Boolean(auth) && typeof auth.role === 'function' && auth.role() === auth.ROLES.FULL;
	}

	function columnByKey(key) {
		var columns = (window.AnimeColumns && window.AnimeColumns.COLUMNS) || [];
		return columns.filter(function (c) { return c.key === key; })[0];
	}

	/**
	 * Skryje řádky, jejichž NameEn ani NameJa neobsahují hledaný text
	 * (case-insensitive). Mirror Python SearchForAnime(), ř. 376-383.
	 */
	function applySearch() {
		var host = document.getElementById('anime-list');
		var items = data && data.getItems && data.getItems();
		if (!host || !items) {
			return;
		}
		var needle = searchText.toLowerCase();
		var rows = host.children;
		for (var i = 0; i < rows.length && i < items.length; i++) {
			var item = items[i];
			var nameEn = (item.NameEn || '').toLowerCase();
			var nameJa = (item.NameJa || '').toLowerCase();
			var match = nameEn.indexOf(needle) !== -1 || nameJa.indexOf(needle) !== -1;
			rows[i].hidden = !match;
		}
	}

	function renderItems() {
		var items = data.getItems();
		view.renderList(items, editMode);
		if (searchText !== '') {
			applySearch();
		}
	}

	function setEditButtonText() {
		// Aktualizace je v edit módu nedostupná (vykreslení nových řádků by
		// přepsalo rozepsané úpravy), proto o změně módu vždy dáme vědět.
		if (update) {
			update.setEditMode(editMode);
		}
		var btn = document.getElementById('anime-edit-toggle');
		if (!btn || !i18n) {
			return;
		}
		var key = saving ? 'anime.edit.saving' : (editMode ? 'anime.edit.save' : 'anime.edit.start');
		btn.setAttribute('data-i18n', key);
		btn.textContent = i18n.t(key);
		btn.setAttribute('aria-pressed', String(editMode));
	}

	// Text chyby zápisu: anime.edit.saveError.<kód>, jinak texty aktualizace
	// (pomocník neběží, ...), jinak obecná hláška s kódem v podrobnostech.
	function saveErrorText(error) {
		var code = typeof error.code === 'string' ? error.code : '';
		var keys = code ? ['anime.edit.saveError.' + code, 'anime.update.error.' + code] : [];
		var text = null;
		for (var i = 0; i < keys.length && text === null; i++) {
			var translated = i18n.t(keys[i]);
			if (translated !== keys[i]) {
				text = translated;
			}
		}
		var known = text !== null;
		var parts = [known ? text : i18n.t('anime.edit.saveError.generic')];
		var detail = known ? error.detail : [code, error.detail || error.message].filter(Boolean).join(' ');
		if (detail) {
			parts.push(i18n.t('anime.update.error.detail', { detail: detail }));
		}
		return parts.join(' ');
	}

	function renderEditError() {
		var el = document.getElementById('anime-edit-error');
		if (!el || !i18n) {
			return;
		}
		var text = '';
		if (editError && editError.key) {
			text = i18n.t(editError.key);
		} else if (editError && editError.error) {
			text = saveErrorText(editError.error);
		}
		el.textContent = text;
		el.hidden = text === '';
	}

	function setEditError(next) {
		editError = next;
		renderEditError();
	}

	function valueOf(item, key) {
		var value = item[key];
		return value === undefined || value === null ? '' : String(value);
	}

	// Text, který <textarea> pro hodnotu ukáže (js/anime-row-view.js nahrazuje " / " novým řádkem).
	function displayedValue(value) {
		return value.replace(/ \/ /g, '\n').replace(/\r\n?/g, '\n');
	}

	/**
	 * Převede text z <textarea> na hodnotu do dat, nebo vrátí null, když není
	 * platná (web-only, Python žádnou validaci vstupu nedělá):
	 * - Number: celé kladné číslo bez úvodních nul (klíč v data/anime.json).
	 * - Rating sloupce: číslo 0-100 (volitelně s "%"), nebo "?" - placeholder
	 *   pro "zatím nehodnoceno"; "%" se doplní (mirror Python aSwitchEdit(), ř. 586-589).
	 * - Date: prázdné, nebo formát DD.MM.RRRR (mirror formátu v datech).
	 * - Ostatní text beze změny (Python ukládá toPlainText()), jen s limitem délky.
	 */
	function parseEditValue(colDef, raw) {
		var value = raw.trim();
		if (colDef.key === 'Number') {
			return NUMBER_PATTERN.test(value) ? value : null;
		}
		if (colDef.isRating) {
			var cleaned = value.replace(/%$/, '');
			if (cleaned === '?') {
				return '?%';
			}
			if (!/^\d{1,3}$/.test(cleaned)) {
				return null;
			}
			var rating = parseInt(cleaned, 10);
			return rating <= 100 ? String(rating) + '%' : null;
		}
		if (colDef.sortType === 'date') {
			if (value === '') {
				return '';
			}
			var match = DATE_PATTERN.exec(value);
			if (!match) {
				return null;
			}
			var day = parseInt(match[1], 10);
			var month = parseInt(match[2], 10);
			return day >= 1 && day <= 31 && month >= 1 && month <= 12 ? value : null;
		}
		return raw.length <= MAX_TEXT_LENGTH ? raw : null;
	}

	function markInvalid(input, invalid) {
		input.classList.toggle('anime-row__edit-input--invalid', invalid);
		input.setAttribute('aria-invalid', String(invalid));
	}

	/**
	 * Projde <textarea> všech řádků (i skrytých hledáním; řádky odpovídají
	 * položkám v pořadí) a zjistí, co se změnilo. Pole, která uživatel nezměnil,
	 * se neověřují ani neposílají. Neplatná pole a Number použité u více anime
	 * se zvýrazní.
	 * @returns {{edits: Array, invalid: boolean, duplicate: boolean}} edits ve
	 *     tvaru pro AnimeSync.saveEdits(): {number, changes: {pole: {from, to}}}
	 */
	function collectEdits(items) {
		var result = { edits: [], invalid: false, duplicate: false };
		var host = document.getElementById('anime-list');
		if (!host) {
			return result;
		}
		var rows = host.children;
		var finalNumbers = items.map(function (item) { return valueOf(item, 'Number'); });
		var numberInputs = [];

		for (var i = 0; i < rows.length && i < items.length; i++) {
			var item = items[i];
			var changes = {};
			var changed = false;
			var inputs = rows[i].querySelectorAll('textarea[data-column]');
			for (var j = 0; j < inputs.length; j++) {
				var input = inputs[j];
				var key = input.getAttribute('data-column');
				var colDef = columnByKey(key);
				var from = valueOf(item, key);
				var to = from;
				if (colDef && input.value !== displayedValue(from)) {
					to = parseEditValue(colDef, input.value);
				}
				markInvalid(input, to === null);
				if (to === null) {
					result.invalid = true;
					continue;
				}
				if (to !== from) {
					changes[key] = { from: from, to: to };
					changed = true;
				}
				if (key === 'Number') {
					finalNumbers[i] = to;
					numberInputs.push({ input: input, index: i });
				}
			}
			if (changed) {
				result.edits.push({ number: valueOf(item, 'Number'), changes: changes });
			}
		}

		var counts = {};
		finalNumbers.forEach(function (number) {
			counts[number] = (counts[number] || 0) + 1;
		});
		numberInputs.forEach(function (entry) {
			if (counts[finalNumbers[entry.index]] > 1) {
				markInvalid(entry.input, true);
				result.duplicate = true;
			}
		});
		return result;
	}

	// Zapsané úpravy promítne do dat v paměti (klíčem je původní Number).
	function applyEdits(items, edits) {
		var byNumber = {};
		items.forEach(function (item) {
			byNumber[valueOf(item, 'Number')] = item;
		});
		edits.forEach(function (edit) {
			var item = byNumber[edit.number];
			if (item) {
				Object.keys(edit.changes).forEach(function (field) {
					item[field] = edit.changes[field].to;
				});
			}
		});
	}

	function setInputsReadOnly(readOnly) {
		var inputs = document.querySelectorAll('#anime-list textarea[data-column]');
		Array.prototype.forEach.call(inputs, function (input) {
			input.readOnly = readOnly;
		});
	}

	function setSaving(value) {
		saving = value;
		setInputsReadOnly(value);
		if (update) {
			update.setSaving(value);
		}
		setEditButtonText();
	}

	function finishEditing() {
		editMode = false;
		renderItems();
		setEditButtonText();
	}

	/**
	 * ULOŽIT: ověří změněné hodnoty a zapíše je přes pomocníka do
	 * data/anime.json (mirror Python aSwitchEdit() + WriteDataToTheFile()).
	 * Beze změn jen ukončí edit mód. Po chybě zůstane edit mód s rozepsanými
	 * hodnotami a ukáže se důvod.
	 */
	function saveEdits(items) {
		var result = collectEdits(items);
		if (result.invalid || result.duplicate) {
			setEditError({ key: result.invalid ? 'anime.edit.error' : 'anime.edit.duplicateNumber' });
			return;
		}
		setEditError(null);
		if (result.edits.length === 0) {
			finishEditing();
			return;
		}
		setSaving(true);
		Promise.resolve().then(function () {
			return window.AnimeSync.saveEdits({ proxy: window.AnimeProxy, edits: result.edits });
		}).then(function () {
			applyEdits(items, result.edits);
			if (typeof data.keepEdited === 'function') {
				data.keepEdited(result.edits);
			}
			saving = false;
			if (update) {
				update.setSaving(false);
			}
			finishEditing();
		}, function (error) {
			setSaving(false);
			setEditError({ error: error || {} });
		});
	}

	function onEditClick() {
		var items = data && data.getItems && data.getItems();
		if (!items || !view || saving) {
			return;
		}
		if (editMode) {
			saveEdits(items);
			return;
		}
		editMode = true;
		setEditError(null);
		renderItems();
		setEditButtonText();
	}

	/**
	 * Zpřístupní action-bar roli FULL: Aktualizovat, Push a edit mód.
	 * @returns {boolean} true, pokud je action-bar aktivní
	 */
	function initActionBar() {
		var actionBar = document.getElementById('anime-action-bar');
		if (!actionBar || !canManage()) {
			return false;
		}
		actionBar.hidden = false;

		if (update) {
			update.init({
				data: data,
				// Nově přidané anime se vykreslí hned, ne až po skončení celé aktualizace.
				onItemsChanged: function () {
					if (view) {
						renderItems();
					}
				},
				// Nové hodnocení nebo zhlédnutá epizoda se ukáže v řádku hned po zjištění.
				onItemUpdated: function (item, field) {
					if (view && typeof view.updateCell === 'function') {
						view.updateCell(data.getItems().indexOf(item), item, field, editMode);
					}
				}
			});
		}

		var editBtn = document.getElementById('anime-edit-toggle');
		if (editBtn) {
			editBtn.addEventListener('click', onEditClick);
		}
		document.addEventListener('site:langchange', setEditButtonText);
		document.addEventListener('site:langchange', renderEditError);

		window.addEventListener('beforeunload', function (event) {
			// Varování před opuštěním stránky s neuloženou editací (web-only,
			// Python aplikace žádné potvrzení při zavření nemá).
			if (editMode) {
				event.preventDefault();
				event.returnValue = '';
			}
		});
		return true;
	}

	function showLoadError(error) {
		if (error && window.console && typeof window.console.error === 'function') {
			window.console.error('Anime data load failed:', error);
		}
		var el = document.getElementById('anime-load-error');
		if (el) {
			el.hidden = false;
		}
	}

	document.addEventListener('DOMContentLoaded', function () {
		// Statická část stránky je v HTML až za skriptem js/i18n.js, takže při
		// načtení ještě nemusela dostat překlad - jakmile existuje v DOM,
		// doplní se zde (stejně jako v js/nv194-page.js).
		if (i18n) {
			i18n.applyStatic();
		}

		var manage = initActionBar();

		var header = document.getElementById('anime-header');
		if (header) {
			// Klik na hlavičku řadí seznam (mirror Python MainWindow.Sort(), ř. 346-373).
			header.addEventListener('click', function (event) {
				var cell = event.target.closest('.anime__header-cell--sortable');
				if (!cell || !data || !view || saving) {
					return;
				}
				// Python během aktualizace hlavičku zablokuje (EnableButtonsWhileUpdate(), ř. 610-628).
				if (update && update.isBusy()) {
					return;
				}
				var column = cell.getAttribute('data-column');
				var colDef = columnByKey(column);
				if (!colDef) {
					return;
				}
				if (sortState.column === column) {
					sortState.ascending = !sortState.ascending;
				} else {
					// Rating sloupce se defaultně řadí sestupně (Python Sort(), ř. 351).
					sortState.ascending = !colDef.isRating;
					sortState.column = column;
				}
				data.sortItems(column, colDef.sortType, sortState.ascending, colDef.isRating);
				view.renderHeader(sortState);
				// Po přeřazení znovu skryjeme neodpovídající řádky (Python Sort(), ř. 372-373).
				renderItems();
			});
		}

		var searchInput = document.getElementById('anime-search');
		if (searchInput) {
			searchInput.addEventListener('input', function () {
				searchText = searchInput.value;
				applySearch();
			});
			// Klávesová zkratka: Escape vyprázdní hledání (bez ekvivalentu
			// v Python aplikaci, doplněno jen pro web verzi).
			searchInput.addEventListener('keydown', function (event) {
				if (event.key === 'Escape' && searchInput.value !== '') {
					searchInput.value = '';
					searchText = '';
					applySearch();
				}
			});
		}

		if (!data || typeof data.load !== 'function' || !view) {
			showLoadError(new Error('Anime scripts are missing.'));
			return;
		}

		data.load().then(function (items) {
			view.renderHeader(sortState);
			view.renderList(items, editMode);
			view.showList();
			if (manage && update) {
				update.setReady(true);
			}
		}).catch(showLoadError);
	});
})();
