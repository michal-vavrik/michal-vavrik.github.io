/**
 * Anime list - vstupní skript stránky.
 *
 * Načte data ze souboru data/anime.json, vykreslí hlavičku a seznam,
 * zajišťuje interaktivní řazení (klik na hlavičku) a hledání podle
 * NameEn/NameJa (mirror Python MainWindow.Sort() a SearchForAnime()).
 * Klávesová zkratka Escape v poli hledání vyprázdní filtr (web-only,
 * Python aplikace žádné klávesové zkratky nemá).
 * Tlačítko UPRAVIT/ULOŽIT přepíná edit mód (mirror Python aSwitchEdit(),
 * ř. 576-608) - platné úpravy se uloží trvale do localStorage
 * (js/anime-data.js save()), mirror Python WriteDataToTheFile().
 * Uložení validuje Number/rating/Date sloupce (web-only, Python žádnou
 * validaci vstupu nedělá) - neplatné hodnoty uložení zablokují.
 * Tlačítko "Obnovit původní data" smaže uložené úpravy a znovu načte
 * výchozí data (Krok 15, bez Python vzoru), po potvrzení v modalu
 * mirroring .quiz-reset-modal z nv194.html/js.
 * Tlačítko "Exportovat data" stáhne aktuální data jako soubor AnimeData.json
 * (Krok 16, bez Python vzoru - web nemá přístup k souborovému systému).
 * Tlačítko "Importovat data" nahraje soubor stejného formátu a nahradí jím
 * aktuální data (Krok 17, bez Python vzoru) - při neplatném souboru se
 * zobrazí chybová hláška a data zůstanou beze změny.
 * Opuštění stránky v edit módu s neuloženou editací zobrazí potvrzovací
 * dialog prohlížeče (Krok 18, bez Python vzoru).
 * Krok 19 (bez Python vzoru): přístupnostní polish - role="alert" na
 * chybové hlášky, aria-pressed na tlačítku UPRAVIT/ULOŽIT, aria-sort na
 * řaditelných sloupcích hlavičky (js/anime-view.js), aria-label na
 * editovatelných polích (js/anime-row-view.js) a aria-invalid na neplatných
 * hodnotách po kliknutí na ULOŽIT.
 */
(function () {
	'use strict';

	var i18n = window.I18n;
	var data = window.AnimeData;
	var view = window.AnimeView;

	// Výchozí řazení - stejné jako Python (MainWindow.__init__, řádek 79):
	// ActualSorting = {"Column": "Number", "Ascending": True}.
	var sortState = { column: 'Number', ascending: true };

	// Aktuální stav zobrazení statusu, aby ho šlo znovu přeložit po změně jazyka.
	var statusState = { kind: 'loading', count: 0 };

	// Aktuální hledaný text (mirror Python Self.BottomBar.SearchLE, prázdné = vše viditelné).
	var searchText = '';

	// Edit mód (mirror Python globální gEditMode, ř. 67).
	var editMode = false;

	function pickLoadedKey(count) {
		if (count === 1) return 'anime.status.loaded.one';
		if (count >= 2 && count <= 4) return 'anime.status.loaded.few';
		return 'anime.status.loaded.many';
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

	function renderStatus() {
		var el = document.getElementById('anime-status');
		if (!el || !i18n) {
			return;
		}
		if (statusState.kind === 'loading') {
			el.textContent = i18n.t('anime.status.loading');
			return;
		}
		if (statusState.kind === 'error') {
			el.textContent = i18n.t('anime.status.error');
			return;
		}
		if (statusState.kind === 'loaded') {
			el.textContent = i18n.t(pickLoadedKey(statusState.count), { count: statusState.count });
		}
	}

	function setStatus(kind, count) {
		statusState = { kind: kind, count: count || 0 };
		renderStatus();
	}

	function setEditButtonText() {
		var btn = document.getElementById('anime-edit-toggle');
		if (!btn || !i18n) {
			return;
		}
		btn.textContent = i18n.t(editMode ? 'anime.edit.save' : 'anime.edit.start');
		btn.setAttribute('aria-pressed', String(editMode));
	}

	function setEditError(show) {
		var el = document.getElementById('anime-edit-error');
		if (el) {
			el.hidden = !show;
		}
	}

	function setImportError(show) {
		var el = document.getElementById('anime-import-error');
		if (el) {
			el.hidden = !show;
		}
	}

	/**
	 * Ověří, zda hodnota z <textarea> odpovídá typu sloupce. Bez ekvivalentu
	 * v Python aplikaci (ta žádnou validaci vstupu nedělá) - doplněno jen pro
	 * web verzi, aby nebylo možné uložit zjevně nesmyslná data.
	 * - Number: musí být celé nezáporné číslo.
	 * - Rating sloupce: číslo 0-100 (volitelně s "%"), nebo "?" - placeholder
	 *   pro "zatím nehodnoceno" (mirror Python `int(x.replace("?", "0"))`
	 *   v js/anime-data.js parseIntValue()).
	 * - Date: prázdné, nebo formát DD.MM.RRRR (mirror formátu v datech).
	 */
	function isValidValue(colDef, rawValue) {
		var value = rawValue.trim();
		if (colDef.key === 'Number') {
			return /^\d+$/.test(value);
		}
		if (colDef.isRating) {
			var cleaned = value.replace(/%$/, '');
			if (cleaned === '?') {
				return true;
			}
			if (!/^\d{1,3}$/.test(cleaned)) {
				return false;
			}
			var n = parseInt(cleaned, 10);
			return n >= 0 && n <= 100;
		}
		if (colDef.sortType === 'date') {
			if (value === '') {
				return true;
			}
			var match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
			if (!match) {
				return false;
			}
			var day = parseInt(match[1], 10);
			var month = parseInt(match[2], 10);
			return day >= 1 && day <= 31 && month >= 1 && month <= 12;
		}
		return true;
	}

	/**
	 * Přečte hodnoty z <textarea> aktuálně vykreslených řádků a uloží je
	 * zpět do dat v paměti. Rating sloupcům bez "%" ho doplní (mirror Python
	 * aSwitchEdit(), ř. 580-599). Pokud je některá hodnota neplatná, uložení
	 * se zablokuje a neplatná pole se zvýrazní (Krok 13, bez Python vzoru).
	 * @returns {boolean} true, pokud byly hodnoty uloženy.
	 */
	function commitEdits(items) {
		var host = document.getElementById('anime-list');
		var columns = window.AnimeColumns && window.AnimeColumns.COLUMNS;
		if (!host || !columns) {
			return true;
		}
		var rows = host.children;
		var hasError = false;
		var i, j, inputs, input, key, colDef;

		for (i = 0; i < rows.length && i < items.length; i++) {
			inputs = rows[i].querySelectorAll('textarea[data-column]');
			for (j = 0; j < inputs.length; j++) {
				input = inputs[j];
				key = input.getAttribute('data-column');
				colDef = columns.filter(function (c) { return c.key === key; })[0];
				var valid = !colDef || isValidValue(colDef, input.value);
				input.classList.toggle('anime-row__edit-input--invalid', !valid);
				input.setAttribute('aria-invalid', String(!valid));
				if (!valid) {
					hasError = true;
				}
			}
		}
		if (hasError) {
			return false;
		}

		for (i = 0; i < rows.length && i < items.length; i++) {
			inputs = rows[i].querySelectorAll('textarea[data-column]');
			for (j = 0; j < inputs.length; j++) {
				input = inputs[j];
				key = input.getAttribute('data-column');
				colDef = columns.filter(function (c) { return c.key === key; })[0];
				var value = input.value;
				if (colDef && colDef.isRating && value.indexOf('%') === -1) {
					value = value + '%';
				}
				items[i][key] = value;
			}
		}
		return true;
	}

	document.addEventListener('DOMContentLoaded', function () {
		// Data se počítá už během `applyStatic` (initial i18n), ale text „Načítám…"
		// necháme dosadit i po změně jazyka během načítání.
		document.addEventListener('site:langchange', renderStatus);
		document.addEventListener('site:langchange', setEditButtonText);

		var header = document.getElementById('anime-header');
		if (header) {
			// Klik na hlavičku řadí seznam (mirror Python MainWindow.Sort(), ř. 346-373).
			header.addEventListener('click', function (event) {
				var cell = event.target.closest('.anime__header-cell--sortable');
				if (!cell || !data) {
					return;
				}
				var column = cell.getAttribute('data-column');
				var columns = window.AnimeColumns && window.AnimeColumns.COLUMNS;
				var colDef = columns && columns.filter(function (c) { return c.key === column; })[0];
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
				var items = data.sortItems(column, colDef.sortType, sortState.ascending);
				if (view) {
					view.renderHeader(sortState);
					view.renderList(items, editMode);
				}
				// Po přeřazení znovu skryjeme neodpovídající řádky (Python Sort(), ř. 372-373).
				if (searchText !== '') {
					applySearch();
				}
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

		var editBtn = document.getElementById('anime-edit-toggle');
		if (editBtn) {
			// UPRAVIT/ULOŽIT přepíná edit mód (mirror Python aSwitchEdit(), ř. 576-608).
			editBtn.addEventListener('click', function () {
				var items = data && data.getItems && data.getItems();
				if (!items || !view) {
					return;
				}
				if (editMode) {
					if (!commitEdits(items)) {
						setEditError(true);
						return;
					}
					setEditError(false);
					// Trvalé uložení do localStorage (mirror Python WriteDataToTheFile(),
					// ř. 1518-1521 - tam se přímo přepíše data/anime.json).
					if (data.save) {
						data.save(items);
					}
				}
				editMode = !editMode;
				view.renderList(items, editMode);
				if (searchText !== '') {
					applySearch();
				}
				setEditButtonText();
			});
		}

		window.addEventListener('beforeunload', function (event) {
			// Varování před opuštěním stránky s neuloženou editací (web-only,
			// Python aplikace žádné potvrzení při zavření nemá).
			if (editMode) {
				event.preventDefault();
				event.returnValue = '';
			}
		});

		var importBtn = document.getElementById('anime-import-btn');
		var importInput = document.getElementById('anime-import-input');
		if (importBtn && importInput) {
			// Import ze souboru (Krok 17, bez Python vzoru) - nahradí aktuální
			// data obsahem nahraného souboru a persistuje je do localStorage
			// (js/anime-data.js importFromObject()).
			importBtn.addEventListener('click', function () {
				importInput.click();
			});
			importInput.addEventListener('change', function () {
				var file = importInput.files && importInput.files[0];
				importInput.value = '';
				if (!file) {
					return;
				}
				var reader = new FileReader();
				reader.onload = function () {
					try {
						var raw = JSON.parse(String(reader.result));
						var items = data.importFromObject(raw);
						setImportError(false);
						editMode = false;
						setEditError(false);
						if (view) {
							view.renderHeader(sortState);
							view.renderList(items, editMode);
						}
						if (searchText !== '') {
							applySearch();
						}
						setEditButtonText();
						setStatus('loaded', items.length);
					} catch (error) {
						setImportError(true);
					}
				};
				reader.onerror = function () {
					setImportError(true);
				};
				reader.readAsText(file);
			});
		}

		var exportBtn = document.getElementById('anime-export-btn');
		if (exportBtn) {
			// Stažení aktuálních dat jako soubor (Krok 16, bez Python vzoru -
			// web nemá přístup k souborovému systému jako Python
			// WriteDataToTheFile(), uživatel si tak data stáhne přes prohlížeč).
			exportBtn.addEventListener('click', function () {
				var items = data && data.getItems && data.getItems();
				if (!items || !data.toJsonString) {
					return;
				}
				var json = data.toJsonString(items);
				var blob = new Blob([json], { type: 'application/json' });
				var url = URL.createObjectURL(blob);
				var link = document.createElement('a');
				link.href = url;
				link.download = 'AnimeData.json';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(url);
			});
		}

		var resetBtn = document.getElementById('anime-reset-btn');
		var resetModal = document.getElementById('anime-reset-modal');
		var resetConfirmBtn = document.getElementById('anime-reset-confirm');
		var resetCancelEls = document.querySelectorAll('[data-anime-reset-cancel]');

		function openResetModal() {
			if (!resetModal) {
				return;
			}
			resetModal.hidden = false;
			if (resetConfirmBtn) {
				resetConfirmBtn.focus();
			}
		}

		function closeResetModal() {
			if (!resetModal) {
				return;
			}
			resetModal.hidden = true;
			if (resetBtn) {
				resetBtn.focus();
			}
		}

		if (resetBtn) {
			resetBtn.addEventListener('click', openResetModal);
		}

		resetCancelEls.forEach(function (el) {
			el.addEventListener('click', closeResetModal);
		});

		document.addEventListener('keydown', function (event) {
			if (event.key === 'Escape' && resetModal && !resetModal.hidden) {
				closeResetModal();
			}
		});

		if (resetConfirmBtn) {
			// Potvrzení smaže uložené úpravy a znovu načte výchozí data
			// (mirror Python GetData() bez existujícího souboru úprav).
			resetConfirmBtn.addEventListener('click', function () {
				if (!data || typeof data.reset !== 'function') {
					return;
				}
				closeResetModal();
				editMode = false;
				setEditError(false);
				data.reset().then(function (items) {
					if (view) {
						view.renderHeader(sortState);
						view.renderList(items, editMode);
					}
					if (searchText !== '') {
						applySearch();
					}
					setEditButtonText();
					setStatus('loaded', items.length);
				});
			});
		}

		if (!data || typeof data.load !== 'function') {
			setStatus('error');
			return;
		}

		data.load().then(function (items) {
			if (view && typeof view.renderHeader === 'function') {
				view.renderHeader(sortState);
				view.renderList(items, editMode);
				view.showList();
			}
			setStatus('loaded', items.length);
		}).catch(function (error) {
			if (window.console && typeof window.console.error === 'function') {
				window.console.error('Anime data load failed:', error);
			}
			setStatus('error');
		});
	});
})();
