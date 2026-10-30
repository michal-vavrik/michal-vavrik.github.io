/**
 * Aktualizace anime listu ze sledujserialy.io (Aktualizovat -> Seznam).
 *
 * Mirror Python AnimeList.pyw: UpdateAnimeList() (ř. 520-537), GetFavorites()
 * (ř. 1295), GetNewFavorites() (ř. 1333), GetNewFavoriteData() (ř. 1347),
 * GetCsfdSerialID() (ř. 1390), GetCsfdData() (ř. 1410), GetCsfdNames()
 * (ř. 1453), GetCsfdRating() (ř. 1477), GetMalSerialID() (ř. 1485)
 * a GetMalRating() (ř. 1503). Regulární výrazy, pořadí kroků i podoba
 * nové položky jsou převzaté ze skriptu; stránky stahuje a obrázky ukládá
 * lokální pomocník (js/anime-proxy.js).
 *
 * Odchylky od Python skriptu (web nemá přístup k souborům ani k cizím webům):
 *  - Položka se přidá a uloží (js/anime-data.js addItem()) až když je celá
 *    hotová; Python zapisuje data jednou na konci. Chyba tak nikdy nezanechá
 *    rozpracovanou položku a už hotové položky zůstanou.
 *  - Obrázek se stahuje jako poslední krok položky, aby po chybě nezůstal
 *    soubor, který žádná položka nepoužívá.
 *  - Číslo nové položky je nejvyšší dosavadní Number/Image + 1 (Python
 *    počítá `len(AnimeData) + 1 + len(EXCEPTION_ANIME)`, což u dat bez děr
 *    vyjde stejně) a bere v úvahu i obrázky, které už na disku jsou.
 *  - Jakákoli chyba běh zastaví a zobrazí se; Python ji v pozadí spolkne.
 *  - Chybějící sekce oblíbených je chyba (Python by spadl na IndexError).
 *  - Když MyAnimeList při jednoznačném názvu rovnou přesměruje na stránku
 *    anime, ID a název se vezmou z adresy (Python by spadl na IndexError).
 *  - Hledání na MyAnimeList bez výsledků (kód 404 a stránka "No titles that
 *    matched") je chyba mal-not-found; Python by spadl na IndexError.
 */
window.AnimeSync = (function () {
	'use strict';

	var FAVORITES_URL = 'https://sledujserialy.io/ucet/';
	var IMAGE_ORIGIN = 'https://serialy.sx';
	var CSFD_SEARCH_URL = 'https://www.csfd.cz/hledat/?q=';
	var CSFD_FILM_URL = 'https://www.csfd.cz/film/';
	var MAL_SEARCH_URL = 'https://myanimelist.net/anime.php?cat=anime&q=';
	var MAL_ANIME_URL = 'https://myanimelist.net/anime/';

	// Python EXCEPTION_ANIME (ř. 63) - seriály, které se nikdy nepřidávají.
	var EXCEPTION_ANIME = ['Owari no Seraph: Nagoja kessen hen'];

	// Python GetCsfdSerialID() (ř. 1398, 1407) - jediný ručně zadaný seriál.
	var CSFD_ID_EXCEPTION_NAME = 'Ikenaikyo';
	var CSFD_ID_EXCEPTION_ID = '1415876';

	// MyAnimeList odpovídá na hledání bez výsledků kódem 404 a touto stránkou.
	var MAL_NO_RESULTS = /No titles that matched/;

	// Python GetNewFavoriteData() (ř. 1357) - prázdná položka, jejíž pořadí klíčů
	// určuje pořadí v exportovaných datech.
	var ITEM_KEYS = ['Number', 'FavoriteName', 'CsfdID', 'MalID', 'MalName', 'Image', 'NameEn', 'NameJa',
		'Genres', 'Description', 'Date', 'State', 'CsfdRating', 'MalRating', 'MyRating'];

	var running = false;

	function syncError(code, detail) {
		var error = new Error(detail ? code + ': ' + detail : code);
		error.name = 'AnimeSyncError';
		error.code = code;
		error.detail = detail || '';
		error.status = 0;
		return error;
	}

	// Python by na nenalezené části stránky spadl na IndexError - tady vznikne
	// srozumitelná chyba s označením kroku.
	function parseError(step) {
		return syncError('parse-error', step);
	}

	/** Všechny shody globálního výrazu včetně skupin (Python re.findall). */
	function findAll(regex, text) {
		var matches = [];
		var match;
		while ((match = regex.exec(text)) !== null) {
			matches.push(match);
			if (match[0] === '') {
				regex.lastIndex++;
			}
		}
		return matches;
	}

	/** Python `str.replace(";", ",")` - středník je v datech oddělovač. */
	function semicolonsToCommas(text) {
		return text.replace(/;/g, ',');
	}

	/**
	 * Python urllib.parse.quote(): beze změny zůstanou jen A-Z a-z 0-9 _ . - ~
	 * a "/", vše ostatní se zakóduje jako UTF-8 bajty %XX.
	 */
	function pythonQuote(text) {
		var bytes = new TextEncoder().encode(text);
		var result = '';
		for (var i = 0; i < bytes.length; i++) {
			var byte = bytes[i];
			if (byte < 128 && /[A-Za-z0-9_.\-~\/]/.test(String.fromCharCode(byte))) {
				result += String.fromCharCode(byte);
			} else {
				result += '%' + (byte < 16 ? '0' : '') + byte.toString(16).toUpperCase();
			}
		}
		return result;
	}

	/** Python round() - půlka se zaokrouhluje k sudému číslu ("bankéřské" zaokrouhlení). */
	function roundHalfEven(value) {
		var floor = Math.floor(value);
		var diff = value - floor;
		if (diff < 0.5) {
			return floor;
		}
		if (diff > 0.5) {
			return floor + 1;
		}
		return floor % 2 === 0 ? floor : floor + 1;
	}

	function pad2(value) {
		return (value < 10 ? '0' : '') + value;
	}

	/** Python `date.today().strftime('%d.%m.%Y')`. */
	function formatDate(date) {
		return pad2(date.getDate()) + '.' + pad2(date.getMonth() + 1) + '.' + date.getFullYear();
	}

	function parseNumber(value) {
		var parsed = parseInt(value, 10);
		return isNaN(parsed) ? 0 : parsed;
	}

	/* ------------------------- sledujserialy.io ------------------------- */

	/**
	 * Vybere ze stránky účtu oblíbené seriály (Python GetFavorites(), ř. 1295).
	 * @returns {Array<{Image: string, Name: string, Finished: boolean,
	 *   ActualSeason: string, ActualEpisode: string, AnimeUrlName: string}>}
	 */
	function parseFavorites(html) {
		// Python zkouší druhou variantu (apostrofy) jen v mrtvém kódu - tady
		// funguje tak, jak bylo zjevně zamýšleno.
		var section = /<div id="favorites"[\s\S]*?<div id="planned"/.exec(html)
			|| /<div id='favorites'[\s\S]*?<div id='planned'/.exec(html);
		if (!section) {
			throw syncError('no-favorites', '');
		}
		var raw = section[0];

		var rows = findAll(/<a href="\/episode\/([\s\S]+?)-[sS]([0-9]+)[eE]([0-9]+)[\s\S]+?"[\s\S]+?<img src="([\s\S]+?)"[\s\S]+?<h2 class="a-favorites__title">[\s]*([\s\S]+?)[\s]*<[\s\S]+?(Pokračuj|>[sS][0-9])/g, raw);
		if (rows.length === 0) {
			rows = findAll(/<a href='\/episode\/([\s\S]+?)-[sS]([0-9]+)[eE]([0-9]+)[\s\S]+?'[\s\S]+?<img src='([\s\S]+?)'[\s\S]+?<h2 class='a-favorites__title'>[\s]*([\s\S]+?)[\s]*<[\s\S]+?(Pokračuj|>[sS][0-9])/g, raw);
		}

		return rows.map(function (row) {
			return {
				Image: row[4],
				Name: semicolonsToCommas(row[5]),
				Finished: row[6] !== 'Pokračuj',
				ActualSeason: row[2],
				ActualEpisode: row[3],
				AnimeUrlName: row[1]
			};
		});
	}

	/**
	 * Ponechá jen oblíbené, které ještě nejsou v datech (Python
	 * GetNewFavorites(), ř. 1333) - porovnává se FavoriteName a seznam výjimek.
	 */
	function getNewFavorites(favorites, items) {
		var known = new Set();
		items.forEach(function (item) {
			known.add(item.FavoriteName);
		});
		return favorites.filter(function (favorite) {
			return !known.has(favorite.Name) && EXCEPTION_ANIME.indexOf(favorite.Name) === -1;
		});
	}

	/* ------------------------------- ČSFD ------------------------------- */

	/** Adresa hledání na ČSFD (Python GetCsfdSerialID(), ř. 1391-1396). */
	function csfdSearchUrl(name) {
		var encoded = pythonQuote(name).replace(/%20/g, '+');
		if (encoded.length > 50) {
			encoded = encoded.slice(0, 50);
		}
		return CSFD_SEARCH_URL + encoded;
	}

	/** ID prvního nalezeného seriálu na ČSFD (Python GetCsfdSerialID(), ř. 1403). */
	function parseCsfdSerialId(html) {
		var match = /<section class="main-box" data-search-results="series"[\s\S]*?<article class="article article-poster-[0-9]*">[\s\S]*?<figure class="article-img">[\s\S]*?href="\/film\/([0-9]+)[\s\S]*?<\/article>[\s\S]*?<\/section>/.exec(html);
		if (!match) {
			throw parseError('csfd-search');
		}
		return match[1];
	}

	/** Anglický a japonský název (Python GetCsfdNames(), ř. 1453). */
	function parseCsfdNames(raw) {
		if (!/<div class="film-header-name"[\s\S]*?<h1>[\s]*([\s\S]+?)[\s]*<\/h1>/.test(raw)) {
			throw parseError('csfd-name');
		}
		var list = /<ul class="film-names">([\s\S]*?)<\/ul>/.exec(raw);
		if (!list) {
			throw parseError('csfd-names');
		}
		var otherNames = list[1];

		// Ze všech japonských názvů se vybere ten s nejnižším kódem prvního
		// znaku (latinka před kanou/kandži); Python tak díky chybě v cyklu
		// porovnává jen první znak - zachováno beze změny.
		var nameJa = '';
		var lowest = 999999999999;
		findAll(/title="[Jj]aponsko"[\s\S]*?>[\s]*([\s\S]+?)[\s]*</g, otherNames).forEach(function (match) {
			var first = match[1].codePointAt(0);
			if (first < lowest) {
				lowest = first;
				nameJa = match[1];
			}
		});

		var english = /title="(angličtina|USA|Austrálie|Velká Británie)"[\s\S]*?>[\s]*([\s\S]+?)[\s]*</.exec(otherNames);
		return { NameEn: english ? english[2] : '', NameJa: nameJa };
	}

	/**
	 * Všechna data o seriálu ze stránky ČSFD (Python GetCsfdData() s
	 * SelectData == 0, ř. 1410-1450). Klíče mají pořadí jako ve skriptu.
	 */
	function parseCsfdData(html, csfdId) {
		var main = /class="main-movie"[\s\S]*id="bottom-banner"/.exec(html);
		if (!main) {
			throw parseError('csfd-page');
		}
		var raw = main[0];

		var names = parseCsfdNames(raw);

		var rating = /<div class="film-rating-average">[\s]*([\s\S]+?)[\s]*<\/div>/.exec(raw);
		if (!rating) {
			throw parseError('csfd-rating');
		}

		var genresRaw = /class="genres">[\s]*([\s\S]+?)[\s]*<\/div>/.exec(raw);
		if (!genresRaw) {
			throw parseError('csfd-genres');
		}
		var genres = findAll(/\/">([\s\S]*?)<\/a>/g, genresRaw[1]).map(function (match) {
			return match[1];
		});

		var description = /class="(plot-preview|plot-full)">[\s]*<p>[\s]*([\s\S]+?)[\s]*</.exec(raw);

		// Nezlomitelné mezery v popisu se nijak neupravují, stejně jako ve skriptu.
		var data = {
			CsfdID: csfdId,
			NameEn: names.NameEn,
			NameJa: names.NameJa,
			CsfdRating: rating[1].replace(/ /g, ''),
			Genres: genres.length > 0 ? genres.join('\n') : genresRaw[1],
			Description: description ? description[2] : 'None'
		};
		Object.keys(data).forEach(function (key) {
			data[key] = semicolonsToCommas(data[key]);
		});
		return data;
	}

	/* --------------------------- MyAnimeList ---------------------------- */

	/** Adresa hledání na MAL (Python GetMalSerialID(), ř. 1486-1490). */
	function malSearchUrl(name) {
		var length = Array.from(name).length;
		var padded = length < 3 ? new Array(3 - length + 1).join(' ') + name : name;
		return MAL_SEARCH_URL + pythonQuote(padded);
	}

	function decodeUrlPart(text) {
		try {
			return decodeURIComponent(text);
		} catch (error) {
			return text;
		}
	}

	/**
	 * ID a název prvního nalezeného anime na MAL (Python GetMalSerialID(),
	 * ř. 1496-1498). Když MAL při jednoznačném názvu přesměruje rovnou na
	 * stránku anime, vezmou se z její adresy.
	 * @param {string} html
	 * @param {string} finalUrl - adresa po případných přesměrováních
	 * @returns {{id: string, name: string}}
	 */
	function parseMalSerial(html, finalUrl) {
		var match = /^https:\/\/myanimelist\.net\/anime\/([0-9]+)\/([^\/?#]+)/.exec(finalUrl || '');
		var id;
		var name;
		if (match) {
			id = match[1];
			name = decodeUrlPart(match[2]);
		} else {
			match = />Title<\/td>[\s\S]*?<div class="picSurround">[\s\S]*?href="[\s\S]*?anime\/([0-9]+)\/([^"]+)/.exec(html);
			if (!match) {
				throw MAL_NO_RESULTS.test(html) ? syncError('mal-not-found', '') : parseError('mal-search');
			}
			id = match[1];
			name = match[2];
		}
		return { id: id, name: semicolonsToCommas(name).replace(/_/g, ' ') };
	}

	/** Hodnocení z MAL v procentech (Python GetMalRating(), ř. 1511-1512). */
	function parseMalRating(html) {
		var match = /<div class="score-label[\s\S]*?>([0-9.]+)</.exec(html);
		var score = match ? Number(match[1]) : NaN;
		if (isNaN(score)) {
			throw parseError('mal-rating');
		}
		return roundHalfEven(score * 10.0) + '%';
	}

	/* ------------------------- nová položka ----------------------------- */

	/** Číslo další položky (a jejího obrázku) - viz odchylky v záhlaví souboru. */
	function nextNumber(items, imageFloor) {
		var highest = imageFloor || 0;
		items.forEach(function (item) {
			highest = Math.max(highest, parseNumber(item.Number), parseNumber(item.Image));
		});
		return highest + 1;
	}

	/**
	 * Složí novou položku (Python GetNewFavoriteData(), ř. 1357-1386).
	 * @param {Object} favorite - výsledek parseFavorites()
	 * @param {Object} csfd - výsledek parseCsfdData()
	 * @param {{id: string, name: string}} mal
	 * @param {string} malRating
	 * @param {number} number
	 * @param {Date} today
	 */
	function buildNewItem(favorite, csfd, mal, malRating, number, today) {
		var values = {
			Number: String(number),
			FavoriteName: favorite.Name,
			CsfdID: csfd.CsfdID,
			MalID: mal.id,
			MalName: mal.name,
			Image: String(number),
			NameEn: csfd.NameEn,
			NameJa: csfd.NameJa,
			Genres: csfd.Genres,
			Description: csfd.Description,
			Date: formatDate(today),
			State: favorite.Finished ? 'DONE' : 'S' + favorite.ActualSeason + 'E' + favorite.ActualEpisode,
			CsfdRating: csfd.CsfdRating,
			MalRating: malRating,
			MyRating: '?%'
		};
		var item = {};
		ITEM_KEYS.forEach(function (key) {
			item[key] = values[key];
		});
		return item;
	}

	/* ------------------------- tok aktualizace -------------------------- */

	function getCsfdSerialId(proxy, name) {
		if (name === CSFD_ID_EXCEPTION_NAME) {
			return Promise.resolve(CSFD_ID_EXCEPTION_ID);
		}
		return proxy.fetchPage(csfdSearchUrl(name)).then(function (page) {
			return parseCsfdSerialId(page.text);
		});
	}

	function getCsfdData(proxy, csfdId) {
		return proxy.fetchPage(CSFD_FILM_URL + csfdId).then(function (page) {
			return parseCsfdData(page.text, csfdId);
		});
	}

	function getMalSerial(proxy, name) {
		return proxy.fetchPage(malSearchUrl(name), { acceptStatus: [404] }).then(function (page) {
			if (page.status >= 400 && !MAL_NO_RESULTS.test(page.text)) {
				var error = syncError('upstream-http', String(page.status));
				error.status = page.status;
				throw error;
			}
			return parseMalSerial(page.text, page.finalUrl);
		});
	}

	function getMalRating(proxy, malId) {
		if (String(malId) === '0') {
			return Promise.resolve('?%');
		}
		return proxy.fetchPage(MAL_ANIME_URL + malId).then(function (page) {
			return parseMalRating(page.text);
		});
	}

	function noop() {}

	/**
	 * Zjistí nové oblíbené seriály a doplní je do dat, jeden po druhém
	 * (Python UpdateAnimeList(), ř. 520-537).
	 *
	 * @param {Object} deps
	 * @param {Object} deps.proxy - AnimeProxy (health, fetchPage, saveImage)
	 * @param {Object} deps.data - AnimeData (getItems, addItem)
	 * @param {function(number)} [deps.onTotal] - počet nových seriálů
	 * @param {function(number)} [deps.onProgress] - průběh v procentech 0-100
	 * @param {function(Object, Array)} [deps.onItemAdded] - hotová položka a všechny položky
	 * @param {function(): Date} [deps.now] - aktuální datum (pro testy)
	 * @returns {Promise<{total: number, added: Array<Object>}>}
	 */
	function updateList(deps) {
		if (running) {
			return Promise.reject(syncError('already-running', ''));
		}
		running = true;
		return Promise.resolve().then(function () {
			return runUpdate(deps);
		}).then(function (result) {
			running = false;
			return result;
		}, function (error) {
			running = false;
			throw error;
		});
	}

	function runUpdate(deps) {
		var proxy = deps.proxy;
		var data = deps.data;
		var onTotal = deps.onTotal || noop;
		var onProgress = deps.onProgress || noop;
		var onItemAdded = deps.onItemAdded || noop;
		var now = deps.now || function () { return new Date(); };
		var imageFloor = 0;

		if (!data.getItems()) {
			return Promise.reject(syncError('data-not-loaded', ''));
		}

		function addFavorite(favorite, index, total) {
			// Průběh jako ve skriptu: 100 * (index / total + podíl / total).
			function report(share) {
				onProgress(100 * (index / total + share / total));
			}

			var csfd;
			var mal;
			var malRating;
			return getCsfdSerialId(proxy, favorite.Name).then(function (csfdId) {
				report(0.2);
				return getCsfdData(proxy, csfdId);
			}).then(function (csfdData) {
				csfd = csfdData;
				report(0.4);
				return getMalSerial(proxy, favorite.Name);
			}).then(function (malSerial) {
				mal = malSerial;
				report(0.6);
				return getMalRating(proxy, mal.id);
			}).then(function (rating) {
				malRating = rating;
				report(0.8);
				var number = nextNumber(data.getItems(), imageFloor);
				return proxy.saveImage(IMAGE_ORIGIN + favorite.Image, number).then(function () {
					return number;
				});
			}).then(function (number) {
				report(1.0);
				var item = buildNewItem(favorite, csfd, mal, malRating, number, now());
				data.addItem(item);
				onItemAdded(item, data.getItems());
				return item;
			}).catch(function (error) {
				error.favorite = favorite.Name;
				throw error;
			});
		}

		return proxy.health().then(function (health) {
			if (!health.cookieConfigured) {
				throw syncError('cookie-missing', '');
			}
			imageFloor = health.maxImageNumber;
			return proxy.fetchPage(FAVORITES_URL);
		}).then(function (page) {
			var fresh = getNewFavorites(parseFavorites(page.text), data.getItems());
			onTotal(fresh.length);

			var added = [];
			var chain = Promise.resolve();
			fresh.forEach(function (favorite, index) {
				chain = chain.then(function () {
					return addFavorite(favorite, index, fresh.length).then(function (item) {
						added.push(item);
					});
				});
			});
			return chain.then(function () {
				return { total: fresh.length, added: added };
			});
		});
	}

	return {
		FAVORITES_URL: FAVORITES_URL,
		EXCEPTION_ANIME: EXCEPTION_ANIME,
		pythonQuote: pythonQuote,
		roundHalfEven: roundHalfEven,
		formatDate: formatDate,
		parseFavorites: parseFavorites,
		getNewFavorites: getNewFavorites,
		csfdSearchUrl: csfdSearchUrl,
		parseCsfdSerialId: parseCsfdSerialId,
		parseCsfdData: parseCsfdData,
		malSearchUrl: malSearchUrl,
		parseMalSerial: parseMalSerial,
		parseMalRating: parseMalRating,
		nextNumber: nextNumber,
		buildNewItem: buildNewItem,
		updateList: updateList
	};
})();
