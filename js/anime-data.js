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
 *
 * addItem() (Krok 20) přidá nově zjištěné anime z tlačítka Aktualizovat ->
 * Seznam (js/anime-sync.js) do dat v paměti; zapsání do data/anime.json
 * (případně uložení do prohlížeče) zajistí js/anime-sync.js.
 *
 * Nepublikovaná anime (bez Python vzoru): pomocník zapisuje do data/anime.json
 * a img/anime v počítači, web (GitHub Pages) je ale ukáže až po nahrání do
 * repozitáře. Do té doby si je stránka drží v prohlížeči (PENDING_KEY)
 * i s obrázky a při načtení je doplní k datům ze souboru; jakmile je soubor
 * obsahuje, z prohlížeče se smažou.
 */
window.AnimeData = (function () {
	'use strict';

	var DATA_URL = 'data/anime.json?v=anime-data-1';

	// Uložené úpravy z edit módu (mirror Python WriteDataToTheFile() /
	// GetData(), ř. 1518-1521 a 1284-1292 - tam se přepisuje/čte přímo
	// data/anime.json, web nemá přístup k souborovému systému, takže jako
	// "soubor" slouží localStorage).
	var STORAGE_KEY = 'anime-data-overrides';

	// Anime zapsaná pomocníkem do data/anime.json, která web ještě nemá:
	// { items: { Number: položka }, images: { Image: { name: FavoriteName, src: data URL } } }.
	var PENDING_KEY = 'anime-pending-additions';
	var DATA_IMAGE = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+\/]+={0,2}$/;

	var state = {
		items: null,
		promise: null
	};

	// Obrázky nových anime pro zobrazení (Image -> { name, src }), viz imageSource().
	var pendingImages = {};

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
	 * Zjistí, jestli jsou v prohlížeči uložené úpravy, které při načtení
	 * přebíjí data/anime.json (Krok 20 - ČSFD hodnocení zapsaná pomocníkem
	 * do souboru je pak nutné uložit i sem, jinak by je stránka neukázala).
	 * @returns {boolean}
	 */
	function hasStoredItems() {
		return readStoredItems() !== null;
	}

	function isPendingItem(item, key) {
		return Boolean(item) && typeof item === 'object' && typeof item.Number === 'string'
			&& item.Number === key && typeof item.NameEn === 'string';
	}

	function isPendingImage(entry) {
		return Boolean(entry) && typeof entry === 'object' && typeof entry.name === 'string'
			&& typeof entry.src === 'string' && DATA_IMAGE.test(entry.src);
	}

	// Nepublikovaná anime z prohlížeče; poškozené nebo cizí záznamy se vynechají.
	function readPending() {
		var pending = { items: {}, images: {} };
		try {
			var parsed = JSON.parse(window.localStorage.getItem(PENDING_KEY) || 'null');
			var items = (parsed && parsed.items) || {};
			var images = (parsed && parsed.images) || {};
			Object.keys(items).forEach(function (key) {
				if (isPendingItem(items[key], key)) {
					pending.items[key] = items[key];
				}
			});
			Object.keys(images).forEach(function (key) {
				if (isPendingImage(images[key])) {
					pending.images[key] = { name: images[key].name, src: images[key].src };
				}
			});
		} catch (error) {
			// Nečitelný záznam se bere jako prázdný.
		}
		return pending;
	}

	function writePending(pending) {
		var empty = Object.keys(pending.items).length === 0 && Object.keys(pending.images).length === 0;
		try {
			if (empty) {
				window.localStorage.removeItem(PENDING_KEY);
			} else {
				window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
			}
		} catch (error) {
			// Plné úložiště: anime se uloží aspoň bez obrázků (místo nich bude popisek).
			try {
				window.localStorage.setItem(PENDING_KEY, JSON.stringify({ items: pending.items, images: {} }));
			} catch (ignored) {
				// Ani to nejde (soukromý režim) - anime web ukáže až po nahrání souboru.
			}
		}
	}

	/**
	 * Doplní k datům ze souboru nepublikovaná anime, která soubor ještě nemá
	 * (seřazená podle Number). Co už soubor obsahuje, ze záznamu vypadne
	 * (soubor má přednost): anime podle Number, obrázek podle Image.
	 * @param {Array} items - položky ze souboru
	 * @param {{items: Object, images: Object}} pending - viz PENDING_KEY
	 * @returns {{items: Array, pending: {items: Object, images: Object}}}
	 */
	function mergePending(items, pending) {
		var numbers = {};
		var imageNumbers = {};
		items.forEach(function (item) {
			numbers[item.Number] = true;
			imageNumbers[item.Image] = true;
		});
		var rest = { items: {}, images: {} };
		var merged = items.slice();
		Object.keys(pending.items).forEach(function (key) {
			if (!numbers[key]) {
				rest.items[key] = pending.items[key];
				merged.push(pending.items[key]);
			}
		});
		Object.keys(pending.images).forEach(function (key) {
			if (!imageNumbers[key]) {
				rest.images[key] = pending.images[key];
			}
		});
		merged.sort(function (a, b) {
			return parseNumber(a.Number) - parseNumber(b.Number);
		});
		return { items: merged, pending: rest };
	}

	/**
	 * Zapamatuje si obrázek nového anime, aby ho řádek ukázal hned, i když ho
	 * web ještě nemá (js/anime-sync.js po uložení obrázku pomocníkem).
	 * Do prohlížeče se uloží až s keepAdded().
	 * @param {string} image - pole Image anime
	 * @param {string} name - pole FavoriteName anime
	 * @param {string} src - obrázek jako data: URL
	 */
	function setImage(image, name, src) {
		if (isPendingImage({ name: name, src: src })) {
			pendingImages[String(image)] = { name: name, src: src };
		}
	}

	/**
	 * Obrázek anime, který web ještě nemá (data: URL), nebo null - pak se
	 * použije img/anime/<Image>.jpg (js/anime-row-view.js).
	 * @param {Object} item
	 * @returns {?string}
	 */
	function imageSource(item) {
		var entry = pendingImages[String(item.Image)];
		return entry && entry.name === item.FavoriteName ? entry.src : null;
	}

	/**
	 * Uloží do prohlížeče obrázky přidaných anime a s `inFile` i samotná
	 * anime, aby je stránka ukazovala, dokud web nemá novou verzi
	 * data/anime.json a img/anime (js/anime-sync.js po zápisu pomocníkem).
	 * Anime, která se do souboru nezapsala, drží uložené úpravy (save()).
	 * @param {Array} items - přidaná anime
	 * @param {boolean} inFile - pomocník je zapsal do data/anime.json
	 */
	function keepAdded(items, inFile) {
		var pending = readPending();
		items.forEach(function (item) {
			var key = String(item.Image);
			if (pendingImages[key] && pendingImages[key].name === item.FavoriteName) {
				pending.images[key] = pendingImages[key];
			}
			if (inFile) {
				pending.items[item.Number] = item;
			}
		});
		writePending(pending);
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
	 * zapsáno), použijí se ty; jinak se stáhnou výchozí data ze souboru
	 * a doplní se k nim nepublikovaná anime (mergePending()).
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
			// Uložené úpravy už nová anime obsahují, z nepublikovaných se berou jen obrázky.
			rememberImages(readPending().images);
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
				var pending = readPending();
				var merged = mergePending(items, pending);
				if (Object.keys(merged.pending.items).length !== Object.keys(pending.items).length
					|| Object.keys(merged.pending.images).length !== Object.keys(pending.images).length) {
					writePending(merged.pending);
				}
				rememberImages(merged.pending.images);
				state.items = merged.items;
				return merged.items;
			});
		return state.promise;
	}

	function rememberImages(images) {
		Object.keys(images).forEach(function (key) {
			pendingImages[key] = images[key];
		});
	}

	function getItems() {
		return state.items;
	}

	/**
	 * Přidá novou položku na konec seznamu v paměti (bez přeřazení - nové
	 * anime se ve Python aplikaci také zobrazí dole, ř. 547-551). Neukládá:
	 * přidaná anime zapíše pomocník do data/anime.json až na konci
	 * aktualizace jako Python WriteDataToTheFile() (js/anime-sync.js).
	 * @param {Object} item - položka ve tvaru jako v data/anime.json
	 * @returns {Array} aktuální pole položek
	 */
	function addItem(item) {
		if (!state.items) {
			throw new Error('Anime data are not loaded yet.');
		}
		state.items.push(item);
		return state.items;
	}

	/**
	 * Smaže uložené úpravy z localStorage a znovu načte výchozí data ze
	 * souboru data/anime.json (Krok 15, bez Python vzoru - web-only reset
	 * úprav uložených přes save()). Nepublikovaná anime zůstanou - nejsou
	 * to úpravy, pomocník je do souboru v počítači zapsal.
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
		addItem: addItem,
		sortItems: sortItems,
		save: save,
		hasStoredItems: hasStoredItems,
		reset: reset,
		toJsonString: toJsonString,
		importFromObject: importFromObject,
		setImage: setImage,
		imageSource: imageSource,
		keepAdded: keepAdded,
		mergePending: mergePending
	};
})();
