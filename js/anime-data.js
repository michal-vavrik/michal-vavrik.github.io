/**
 * Načítání a přístup k datům anime listu.
 *
 * Zdroj pravdy je soubor data/anime.json, jehož struktura pochází z původní
 * Python aplikace (viz original-anime-list/AnimeList.pyw, funkce GetData
 * a WriteDataToTheFile). Formát je objekt klíčovaný stringem Number:
 *   { "1": { "Number": "1", "NameEn": "...", ... }, "2": { ... } }
 *
 * Modul vrací pole položek seřazené vzestupně podle číselné hodnoty pole
 * Number - stejně jako Python: `sorted(GetData(), key=lambda x: int(x["Number"]))`.
 *
 * Uložené úpravy z edit módu (Krok 12/13) se persistují do localStorage
 * (web nemá přístup k souborovému systému jako Python WriteDataToTheFile()) -
 * pokud jsou v localStorage nějaká data, load() je použije místo data/anime.json.
 *
 * toJsonString() (Krok 16, bez Python vzoru) vrací aktuální data ve stejném
 * textovém formátu, aby si je uživatel mohl stáhnout jako soubor.
 *
 * importFromObject() (Krok 17, bez Python vzoru) přijme obsah nahraného
 * souboru ve stejném formátu a nahradí jím aktuální data.
 */
window.AnimeData = (function () {
	'use strict';

	var DATA_URL = 'data/anime.json?v=anime-data-1';

	// Uložené úpravy z edit módu (mirror Python WriteDataToTheFile() /
	// GetData(), ř. 1518-1521 a 1284-1292 - tam se přepisuje/čte přímo
	// data/anime.json, web nemá přístup k souborovému systému, takže jako
	// "soubor" slouží localStorage).
	var STORAGE_KEY = 'anime-data-overrides';

	var state = {
		items: null,
		promise: null
	};

	function readStoredItems() {
		try {
			var raw = window.localStorage.getItem(STORAGE_KEY);
			if (!raw) {
				return null;
			}
			var parsed = JSON.parse(raw);
			return Object.keys(parsed).map(function (key) {
				return parsed[key];
			});
		} catch (error) {
			return null;
		}
	}

	// Sdílený tvar dat pro localStorage i export - objekt klíčovaný Number,
	// hodnoty seřazené podle Number vzestupně (mirror Python
	// WriteDataToTheFile(), ř. 1518-1521).
	function buildJsonPayload(items) {
		var sorted = items.slice().sort(function (a, b) {
			return parseNumber(a.Number) - parseNumber(b.Number);
		});
		var jsonData = {};
		sorted.forEach(function (item) {
			jsonData[item.Number] = item;
		});
		return jsonData;
	}

	/**
	 * Uloží aktuální data do localStorage stejným tvarem jako Python
	 * WriteDataToTheFile() (objekt klíčovaný Number, hodnoty seřazené
	 * podle Number vzestupně).
	 */
	function save(items) {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(buildJsonPayload(items)));
		} catch (error) {
			// Soukromý režim prohlížeče může zápis odmítnout - úpravy pak
			// platí jen do konce zobrazení stránky (v paměti zůstávají).
		}
	}

	/**
	 * Vrátí data ve stejném textovém formátu jako Python WriteDataToTheFile()
	 * (`json.dump(JsonData, File, indent = 4, ensure_ascii = False)`) - pro
	 * stažení do souboru (Krok 16, bez Python vzoru - web nemá přístup
	 * k souborovému systému jako Python `open(DATA_PATH, "w")`, uživatel si
	 * tak aktuální data stáhne přes prohlížeč).
	 */
	function toJsonString(items) {
		return JSON.stringify(buildJsonPayload(items), null, 4);
	}

	function parseNumber(value) {
		var n = parseInt(value, 10);
		return isNaN(n) ? 0 : n;
	}

	// Sdílený parser pro sloupce SortingType "int" (Number i rating sloupce),
	// mirror Python `int(x[Column].replace("%", "").replace("?", "0"))` (Sort(), ř. 358).
	function parseIntValue(value) {
		var cleaned = String(value === undefined || value === null ? '' : value)
			.replace(/%/g, '')
			.replace(/\?/g, '0');
		var n = parseInt(cleaned, 10);
		return isNaN(n) ? 0 : n;
	}

	// Prázdné Date se řadí jako "12.08.1995" (Python Sort(), ř. 362).
	var DEFAULT_DATE = new Date(1995, 7, 12);

	function parseDateValue(value) {
		var parts = String(value || '').split('.');
		if (parts.length !== 3) {
			return DEFAULT_DATE;
		}
		var day = parseInt(parts[0], 10);
		var month = parseInt(parts[1], 10);
		var year = parseInt(parts[2], 10);
		return new Date(year, month - 1, day);
	}

	/**
	 * Načte data - pokud v localStorage existují dříve uložené úpravy
	 * (mirror Python GetData(), ř. 1284-1292 - čte se to, co bylo naposledy
	 * zapsáno), použijí se ty; jinak se stáhnou výchozí data ze souboru.
	 * Výsledek se seřadí podle Number vzestupně a uloží do interního cache.
	 * Opakované volání vrací stejné pole.
	 */
	function load() {
		if (state.promise) {
			return state.promise;
		}
		var stored = readStoredItems();
		if (stored) {
			stored.sort(function (a, b) {
				return parseNumber(a.Number) - parseNumber(b.Number);
			});
			state.items = stored;
			state.promise = Promise.resolve(stored);
			return state.promise;
		}
		state.promise = fetch(DATA_URL, { cache: 'no-cache' })
			.then(function (response) {
				if (!response.ok) {
					throw new Error('HTTP ' + response.status);
				}
				return response.json();
			})
			.then(function (raw) {
				var items = Object.keys(raw).map(function (key) {
					return raw[key];
				});
				items.sort(function (a, b) {
					return parseNumber(a.Number) - parseNumber(b.Number);
				});
				state.items = items;
				return items;
			});
		return state.promise;
	}

	function getItems() {
		return state.items;
	}

	/**
	 * Smaže uložené úpravy z localStorage a znovu načte výchozí data ze
	 * souboru data/anime.json (Krok 15, bez Python vzoru - web-only reset
	 * úprav uložených přes save()).
	 * @returns {Promise<Array>}
	 */
	function reset() {
		try {
			window.localStorage.removeItem(STORAGE_KEY);
		} catch (error) {
			// Soukromý režim prohlížeče může odmítnout i mazání - v takovém
			// případě uložené úpravy stejně nebyly zapsané (viz save()).
		}
		state.items = null;
		state.promise = null;
		return load();
	}

	/**
	 * Zpracuje obsah nahraného souboru (stejný tvar jako export/data/anime.json)
	 * - ověří základní strukturu, nahradí jím aktuální data a persistuje je do
	 * localStorage (Krok 17, bez Python vzoru - Python žádný import ze souboru
	 * nemá, GetData() vždy čte jen pevně daný DATA_PATH).
	 * @param {*} raw - výsledek JSON.parse() nahraného souboru.
	 * @returns {Array} pole položek seřazené podle Number vzestupně.
	 * @throws {Error} pokud tvar dat neodpovídá očekávanému formátu.
	 */
	function importFromObject(raw) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new Error('Invalid anime data: expected an object keyed by Number.');
		}
		var keys = Object.keys(raw);
		if (keys.length === 0) {
			throw new Error('Invalid anime data: no items found.');
		}
		var items = keys.map(function (key) {
			return raw[key];
		});
		var isValidItem = items.every(function (item) {
			return item && typeof item === 'object' && typeof item.Number === 'string' && typeof item.NameEn === 'string';
		});
		if (!isValidItem) {
			throw new Error('Invalid anime data: items are missing required fields.');
		}
		items.sort(function (a, b) {
			return parseNumber(a.Number) - parseNumber(b.Number);
		});
		state.items = items;
		state.promise = Promise.resolve(items);
		save(items);
		return items;
	}

	/**
	 * Seřadí cachovaná data podle sloupce a uloží nové pořadí (mirror Python
	 * MainWindow.Sort(), ř. 346-362 - `AnimeData = sorted(AnimeData, ...)`).
	 * @param {string} column - klíč sloupce (AnimeColumns.COLUMNS[].key)
	 * @param {string} sortType - "int" | "str" | "date"
	 * @param {boolean} ascending
	 */
	function sortItems(column, sortType, ascending) {
		if (!state.items) {
			return state.items;
		}
		var direction = ascending ? 1 : -1;
		state.items.sort(function (a, b) {
			var av, bv;
			if (sortType === 'int') {
				av = parseIntValue(a[column]);
				bv = parseIntValue(b[column]);
			} else if (sortType === 'date') {
				av = parseDateValue(a[column]);
				bv = parseDateValue(b[column]);
			} else {
				av = a[column] === undefined || a[column] === null ? '' : String(a[column]);
				bv = b[column] === undefined || b[column] === null ? '' : String(b[column]);
			}
			if (av < bv) return -1 * direction;
			if (av > bv) return 1 * direction;
			return 0;
		});
		return state.items;
	}

	return {
		load: load,
		getItems: getItems,
		sortItems: sortItems,
		save: save,
		reset: reset,
		toJsonString: toJsonString,
		importFromObject: importFromObject
	};
})();
