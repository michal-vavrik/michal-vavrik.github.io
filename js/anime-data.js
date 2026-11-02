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
 * Všechny změny (aktualizace i úpravy z edit módu) zapisuje do
 * data/anime.json pomocný program (tools/anime_proxy.py, volá ho
 * js/anime-sync.js); v prohlížeči se žádné úpravy dat neukládají.
 *
 * addItem() (Krok 20) přidá nově zjištěné anime z tlačítka Aktualizovat ->
 * Seznam (js/anime-sync.js) do dat v paměti; zapsání do data/anime.json
 * zajistí js/anime-sync.js.
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

	// Dřívější úpravy uložené jen v prohlížeči (před zápisem úprav do
	// data/anime.json). Už se nečtou, load() je jen smaže, aby nepřekážely.
	var LEGACY_STORAGE_KEY = 'anime-data-overrides';

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

	function removeLegacyOverrides() {
		try {
			window.localStorage.removeItem(LEGACY_STORAGE_KEY);
		} catch (error) {
			// Soukromý režim prohlížeče může odmítnout i mazání - nevadí, klíč se nečte.
		}
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
	 * Uloží do prohlížeče přidaná anime i s obrázky, aby je stránka
	 * ukazovala, dokud web nemá novou verzi data/anime.json a img/anime
	 * (js/anime-sync.js po zápisu pomocníkem do souboru).
	 * @param {Array} items - přidaná anime
	 */
	function keepAdded(items) {
		var pending = readPending();
		items.forEach(function (item) {
			var key = String(item.Image);
			if (pendingImages[key] && pendingImages[key].name === item.FavoriteName) {
				pending.images[key] = pendingImages[key];
			}
			pending.items[item.Number] = item;
		});
		writePending(pending);
	}

	/**
	 * Promítne úpravy z edit módu, které pomocník zapsal do data/anime.json,
	 * i do nepublikovaných anime v prohlížeči - jinak by je stránka po
	 * obnovení ukázala v původní podobě. Změna Number anime překlíčuje.
	 * @param {Array<{number: string, changes: Object<string, {from: string, to: string}>}>} edits
	 */
	function keepEdited(edits) {
		var pending = readPending();
		var byNumber = {};
		edits.forEach(function (edit) {
			byNumber[edit.number] = edit.changes;
		});
		var changed = false;
		var items = {};
		Object.keys(pending.items).forEach(function (key) {
			var item = pending.items[key];
			var changes = byNumber[key];
			if (changes) {
				item = Object.assign({}, item);
				Object.keys(changes).forEach(function (field) {
					item[field] = changes[field].to;
				});
				changed = true;
			}
			items[item.Number] = item;
		});
		if (changed) {
			pending.items = items;
			writePending(pending);
		}
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
	 * Načte data ze souboru data/anime.json (mirror Python GetData(),
	 * ř. 1284-1292) a doplní k nim nepublikovaná anime (mergePending()).
	 * Výsledek se seřadí podle Number vzestupně a uloží do interního cache.
	 * Opakované volání vrací stejné pole.
	 */
	function load() {
		if (state.promise) {
			return state.promise;
		}
		removeLegacyOverrides();
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
		setImage: setImage,
		imageSource: imageSource,
		keepAdded: keepAdded,
		keepEdited: keepEdited,
		mergePending: mergePending
	};
})();
