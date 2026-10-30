/**
 * Aktualizace anime listu ze sledujserialy.io (Aktualizovat -> Seznam),
 * ČSFD a MAL hodnocení (Aktualizovat -> ČSFD hodnocení, MAL hodnocení)
 * a zhlédnutých epizod (Aktualizovat -> Zhlédnuté epizody).
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
 *  - Položka se přidá (js/anime-data.js addItem()) až když je celá hotová,
 *    takže chyba nikdy nezanechá rozpracovanou položku. Přidaná anime zapíše
 *    pomocník do data/anime.json na konci jako Python WriteDataToTheFile();
 *    při zastavení chybou zapíše ta, která už jsou hotová. Uložení do
 *    prohlížeče a chyba zápisu se řeší jako u ČSFD hodnocení (viz níže).
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
 *  - Anime bez skóre na MyAnimeList (stránka ukazuje "N/A") dostane MAL
 *    hodnocení "?%"; regulární výraz skriptu by místo skóre vzal první další
 *    číslo na stránce (např. počet členů).
 *
 * ČSFD hodnocení mirror Python UpdateCSFD() (ř. 442-450) a GetCsfdData()
 * s SelectData == 1. Po zjištění všech hodnocení je pomocník zapíše do
 * data/anime.json (Python WriteDataToTheFile(); mění jen CsfdRating).
 * Odchylky:
 *  - Anime, u kterého se hodnocení nepodaří zjistit (stránka zmizela nebo se
 *    změnila, ČSFD neodpovědělo), se přeskočí a vypíše se na konci; Python
 *    by při první chybě skončil a nic neuložil.
 *  - Chyby, které by postihly všechna anime (pomocník neběží, síť požadavky
 *    blokuje), běh zastaví; už zjištěná hodnocení se zapíšou.
 *  - Nečíselné CsfdID se přeskočí bez dotazu na ČSFD.
 *  - Jsou-li v prohlížeči uložené úpravy (přebíjí data/anime.json), uloží se
 *    hodnocení i tam. Když zápis do souboru selže, zůstanou jen v prohlížeči.
 *
 * MAL hodnocení mirror Python UpdateMAL() (ř. 481-489) a GetMalRating()
 * (ř. 1503) a probíhá stejně jako ČSFD (mění jen MalRating, stejné odchylky).
 * MalID "0" dá "?%" bez dotazu jako ve skriptu, jiné nečíselné MalID se
 * přeskočí; anime bez skóre ("N/A") dostane "?%" (viz výše).
 *
 * Zhlédnuté epizody mirror Python UpdateWatched() (ř. 393-411),
 * GetFavorites() a CheckIfReallyNotFinished() (ř. 1311). Mění jen State
 * anime, které je v oblíbených a není DROPPED; pomocník State zapíše do
 * data/anime.json. Stránka seriálu bez nalezených řad dá "DONE" jako skript.
 * Odchylky jako u ČSFD (přeskočení chyb jednoho anime, zápis hotového po
 * zastavení, uložení do prohlížeče). Navíc se přeskočí seriál, jehož název
 * v adrese pomocník nepovoluje nebo jehož stránka přesměruje jinam než na
 * stránku seriálu (Python by vzal cílovou stránku a nejspíš zapsal "DONE").
 */
window.AnimeSync = (function () {
	'use strict';

	var FAVORITES_URL = 'https://sledujserialy.io/ucet/';
	var SERIAL_URL = 'https://sledujserialy.io/serial/';
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

	// Tvar ČSFD i MAL hodnocení v data/anime.json; stejně ho kontroluje pomocník.
	var RATING_FORMAT = /^(?:[0-9]{1,3}|\?)%$/;

	// Stav zapsaný Python UpdateWatched() ("DONE", "S01E05", "S02E--"); stejně ho kontroluje pomocník.
	var WATCHED_STATE_FORMAT = /^(?:DONE|S[0-9]{1,6}E(?:[0-9]{1,6}|--))$/;

	// Název seriálu v adrese sledujserialy.io/serial/<název>; stejné pravidlo má pomocník (FETCH_RULES).
	var SERIAL_SLUG = /^[A-Za-z0-9_.%-]+$/;

	// Nejstarší verze pomocníka, která umí zapsat výsledek aktualizace do data/anime.json.
	var CSFD_MIN_HELPER_VERSION = 2;
	var MAL_MIN_HELPER_VERSION = 3;
	var WATCHED_MIN_HELPER_VERSION = 4;
	var LIST_MIN_HELPER_VERSION = 5;

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

	/**
	 * Vybere ze stránky seriálu řady a jejich stav (Python
	 * CheckIfReallyNotFinished(), ř. 1313-1315): "Videné" = celá řada
	 * zhlédnutá, "Označiť" = ještě ne. Druhá varianta (apostrofy) se zkouší,
	 * když první nic nenajde.
	 * @returns {Array<{season: string, state: string}>}
	 */
	function parseSerialSeasons(html) {
		var rows = findAll(/data-season="([0-9]+)"[\s\S]*?<i title="(Videné|Označiť)/g, html);
		if (rows.length === 0) {
			rows = findAll(/data-season='([0-9]+)'[\s\S]*?<i title='(Videné|Označiť)/g, html);
		}
		return rows.map(function (row) {
			return { season: row[1], state: row[2] };
		});
	}

	/**
	 * Python CheckIfReallyNotFinished() (ř. 1316-1330) nad řadami ze stránky
	 * seriálu: první nezhlédnutá řada znamená, že seriál není dokončený; je-li
	 * to jiná řada než v odkazu oblíbeného, epizoda je "--". Bez nezhlédnuté
	 * řady (i když se žádná nenašla) je seriál dokončený.
	 * @param {Array<{season: string, state: string}>} seasons
	 * @param {string} actualSeason - řada z odkazu oblíbeného ("01")
	 * @param {string} actualEpisode - epizoda z odkazu oblíbeného ("05")
	 * @returns {{finished: boolean, season: string, episode: string}}
	 */
	function checkIfReallyNotFinished(seasons, actualSeason, actualEpisode) {
		var finished = true;
		for (var i = 0; i < seasons.length; i++) {
			if (seasons[i].state !== 'Videné') {
				finished = false;
				var season = seasons[i].season;
				if (parseInt(actualSeason, 10) !== parseInt(season, 10)) {
					actualSeason = parseInt(season, 10) < 10 ? '0' + season : season;
					actualEpisode = '--';
				}
				break;
			}
		}
		return { finished: finished, season: actualSeason, episode: actualEpisode };
	}

	// Stejné pravidlo jako FETCH_RULES pomocníka (včetně zákazu "." a ".."), jiný název by odmítl.
	function isSerialSlug(slug) {
		if (typeof slug !== 'string' || !SERIAL_SLUG.test(slug)) {
			return false;
		}
		var decoded = slug;
		try {
			decoded = decodeURIComponent(slug);
		} catch (error) {
			decoded = slug;
		}
		return decoded !== '.' && decoded !== '..';
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

	/** Blok s údaji o seriálu (Python GetCsfdData(), ř. 1413). */
	function csfdMainBlock(html) {
		var main = /class="main-movie"[\s\S]*id="bottom-banner"/.exec(html);
		if (!main) {
			throw parseError('csfd-page');
		}
		return main[0];
	}

	/** Hodnocení z bloku stránky ČSFD (Python GetCsfdRating(), ř. 1477-1482), bez odstranění mezer. */
	function csfdRawRating(raw) {
		var rating = /<div class="film-rating-average">[\s]*([\s\S]+?)[\s]*<\/div>/.exec(raw);
		if (!rating) {
			throw parseError('csfd-rating');
		}
		return rating[1];
	}

	/**
	 * Jen hodnocení ze stránky ČSFD (Python GetCsfdData() s SelectData == 1,
	 * ř. 1442-1445), např. "85%" nebo "?%". Hodnota jiného tvaru je chyba
	 * (bez Python vzoru), aby se do data/anime.json nikdy nezapsal kus HTML.
	 */
	function parseCsfdRating(html) {
		var rating = csfdRawRating(csfdMainBlock(html)).replace(/ /g, '');
		if (!RATING_FORMAT.test(rating)) {
			throw parseError('csfd-rating');
		}
		return rating;
	}

	/**
	 * Všechna data o seriálu ze stránky ČSFD (Python GetCsfdData() s
	 * SelectData == 0, ř. 1410-1450). Klíče mají pořadí jako ve skriptu.
	 */
	function parseCsfdData(html, csfdId) {
		var raw = csfdMainBlock(html);

		var names = parseCsfdNames(raw);

		var rating = csfdRawRating(raw);

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
			CsfdRating: rating.replace(/ /g, ''),
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

	/**
	 * Hodnocení z MAL v procentech (Python GetMalRating(), ř. 1511-1512),
	 * např. "80%". Anime bez skóre ("N/A") dostane "?%" (bez Python vzoru, viz
	 * záhlaví); hodnota jiného tvaru je chyba, aby se nezapsal nesmysl.
	 */
	function parseMalRating(html) {
		var match = /<div class="score-label[^>]*>([^<]*)</.exec(html);
		var score = match ? match[1].trim() : '';
		if (score === 'N/A') {
			return '?%';
		}
		var rating = /^[0-9.]+$/.test(score) ? roundHalfEven(Number(score) * 10.0) + '%' : '';
		if (!RATING_FORMAT.test(rating)) {
			throw parseError('mal-rating');
		}
		return rating;
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

	// Chyby jednoho anime při aktualizaci hodnocení nebo zhlédnutých epizod, po
	// kterých má smysl pokračovat dalším (stránka anime zmizela, změnila se, web
	// jednou neodpověděl). Ostatní chyby (pomocník neběží, síť požadavky
	// blokuje, Cloudflare...) by selhaly u všech anime, proto běh zastaví.
	var ITEM_SKIPPABLE = ['parse-error', 'upstream-http', 'timeout', 'network-error', 'invalid-encoding',
		'bad-encoding', 'unsupported-encoding', 'too-large', 'too-many-redirects', 'bad-csfd-id', 'bad-mal-id',
		'bad-serial-name'];

	// Zdroje pro runItemsUpdate(): pole v datech, potřebná verze pomocníka,
	// zjištění hodnoty jednoho anime a zápis do data/anime.json. Nepovinně
	// prepare() (příprava před první položkou, výsledek dostane fetchValue()),
	// progress() (výchozí 100 * index / počet) a isSkippable() (další chyby,
	// po kterých se pokračuje).
	var CSFD_RATINGS = {
		field: 'CsfdRating',
		minHelperVersion: CSFD_MIN_HELPER_VERSION,
		fetchValue: function (proxy, item) {
			var csfdId = String(item.CsfdID);
			if (!/^[0-9]+$/.test(csfdId)) {
				throw syncError('bad-csfd-id', csfdId);
			}
			return proxy.fetchPage(CSFD_FILM_URL + csfdId).then(function (page) {
				return parseCsfdRating(page.text);
			});
		},
		save: function (proxy, ratings) {
			return proxy.saveCsfdRatings(ratings);
		}
	};

	var MAL_RATINGS = {
		field: 'MalRating',
		minHelperVersion: MAL_MIN_HELPER_VERSION,
		fetchValue: function (proxy, item) {
			var malId = String(item.MalID);
			if (malId !== '0' && !/^[0-9]+$/.test(malId)) {
				throw syncError('bad-mal-id', malId);
			}
			return getMalRating(proxy, malId);
		},
		save: function (proxy, ratings) {
			return proxy.saveMalRatings(ratings);
		}
	};

	/**
	 * Ověří na stránce seriálu, že oblíbený bez "Pokračuj" opravdu není
	 * dokončený, a výsledek zapíše do oblíbeného jako Python UpdateWatched()
	 * (ř. 404). Vyjde-li dokončený, další anime se stejným jménem už se
	 * neptá; jinak se ptá znovu (s řadou a epizodou z této kontroly).
	 */
	function checkWatchedFavorite(proxy, favorite) {
		if (!isSerialSlug(favorite.AnimeUrlName)) {
			return Promise.reject(syncError('bad-serial-name', favorite.AnimeUrlName));
		}
		return proxy.fetchPage(SERIAL_URL + favorite.AnimeUrlName).then(function (page) {
			var result = checkIfReallyNotFinished(parseSerialSeasons(page.text), favorite.ActualSeason, favorite.ActualEpisode);
			favorite.Finished = result.finished;
			favorite.ActualSeason = result.season;
			favorite.ActualEpisode = result.episode;
		});
	}

	var WATCHED_STATES = {
		field: 'State',
		minHelperVersion: WATCHED_MIN_HELPER_VERSION,
		// Python UpdateWatched() nejdřív stáhne oblíbené (GetFavorites()).
		prepare: function (proxy, health) {
			if (!health.cookieConfigured) {
				throw syncError('cookie-missing', '');
			}
			return proxy.fetchPage(FAVORITES_URL).then(function (page) {
				return parseFavorites(page.text);
			});
		},
		// Python hlásí průběh před zpracováním anime už včetně něj (ř. 400).
		progress: function (index, total) {
			return 100 * (index + 1) / total;
		},
		// Undefined = anime se nemění (není v oblíbených nebo je DROPPED), Python ř. 401-409.
		fetchValue: function (proxy, item, favorites) {
			if (typeof item.State === 'string' && item.State.indexOf('DROPPED') !== -1) {
				return undefined;
			}
			var favorite = null;
			for (var i = 0; i < favorites.length; i++) {
				if (favorites[i].Name === item.FavoriteName) {
					favorite = favorites[i];
					break;
				}
			}
			if (!favorite) {
				return undefined;
			}
			var checked = favorite.Finished ? Promise.resolve() : checkWatchedFavorite(proxy, favorite);
			return checked.then(function () {
				var state = favorite.Finished ? 'DONE' : 'S' + favorite.ActualSeason + 'E' + favorite.ActualEpisode;
				if (!WATCHED_STATE_FORMAT.test(state)) {
					throw parseError('state');
				}
				return state;
			});
		},
		// Přesměrování stránky seriálu na jinou stránku webu (pomocník ji nestáhne) se týká jen tohoto seriálu.
		isSkippable: function (error) {
			return error.code === 'redirect-blocked' && error.detail === 'path-not-allowed';
		},
		save: function (proxy, states) {
			return proxy.saveWatchedStates(states);
		}
	};

	/** Zamkne aktualizace, aby nikdy neběžely dvě najednou (sdílí všechny volby Aktualizovat). */
	function exclusive(run) {
		if (running) {
			return Promise.reject(syncError('already-running', ''));
		}
		running = true;
		return Promise.resolve().then(run).then(function (result) {
			running = false;
			return result;
		}, function (error) {
			running = false;
			throw error;
		});
	}

	/**
	 * Nechá pomocníka zapsat výsledek aktualizace do data/anime.json (`write`).
	 * Uložené úpravy v prohlížeči soubor přebíjí, proto se v takovém případě
	 * data uloží i tam; když zápis do souboru selže, zůstanou aspoň v prohlížeči.
	 * @returns {Promise<{savedTo: string, result: *, error: Object}>} savedTo
	 *     'file' s odpovědí pomocníka, nebo 'browser' s chybou zápisu
	 */
	function persistUpdate(data, write) {
		return Promise.resolve().then(write).then(function (result) {
			if (data.hasStoredItems()) {
				data.save(data.getItems());
			}
			return { savedTo: 'file', result: result };
		}, function (error) {
			data.save(data.getItems());
			return { savedTo: 'browser', error: error };
		});
	}

	// Chyba data-save-failed s kódem a detailem chyby zápisu do souboru.
	function saveFailedError(cause) {
		return syncError('data-save-failed', [cause.code, cause.detail].filter(Boolean).join(' '));
	}

	/**
	 * Zjistí nové oblíbené seriály a doplní je do dat, jeden po druhém
	 * (Python UpdateAnimeList(), ř. 520-537). Přidaná anime pak pomocník
	 * jednou zapíše do data/anime.json (Python WriteDataToTheFile()); při
	 * zastavení chybou zapíše ta, která už jsou hotová.
	 *
	 * @param {Object} deps
	 * @param {Object} deps.proxy - AnimeProxy (health, fetchPage, saveImage, saveAnimeItems)
	 * @param {Object} deps.data - AnimeData (getItems, addItem, save, hasStoredItems)
	 * @param {function(number)} [deps.onTotal] - počet nových seriálů
	 * @param {function(number)} [deps.onProgress] - průběh v procentech 0-100
	 * @param {function(Object, Array)} [deps.onItemAdded] - hotová položka a všechny položky
	 * @param {function(): Date} [deps.now] - aktuální datum (pro testy)
	 * @returns {Promise<{total: number, added: Array<Object>, savedTo: ?string}>}
	 *     `savedTo` je 'file', nebo null, když nepřibylo žádné anime. Při
	 *     zastavení chybou má chyba navíc `added` (počet přidaných anime)
	 *     a `savedTo` ('file', 'browser' nebo null). Selže-li jen zápis do
	 *     souboru, je to chyba `data-save-failed` se `savedTo` 'browser'.
	 */
	function updateList(deps) {
		return exclusive(function () {
			return runUpdate(deps);
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
		var added = [];

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

		// Python UpdateAnimeList() zapisuje data jen tehdy, když nějaké anime přibylo.
		function persist() {
			if (added.length === 0) {
				return Promise.resolve({ savedTo: null });
			}
			return persistUpdate(data, function () {
				return proxy.saveAnimeItems(added);
			});
		}

		function annotate(error, saved) {
			error.added = added.length;
			error.savedTo = saved.savedTo;
			return error;
		}

		return proxy.health().then(function (health) {
			if (!(health.version >= LIST_MIN_HELPER_VERSION)) {
				throw syncError('helper-outdated', '');
			}
			if (!health.dataFile) {
				throw syncError('data-file-missing', '');
			}
			if (!health.cookieConfigured) {
				throw syncError('cookie-missing', '');
			}
			imageFloor = health.maxImageNumber;
			return proxy.fetchPage(FAVORITES_URL);
		}).then(function (page) {
			var fresh = getNewFavorites(parseFavorites(page.text), data.getItems());
			onTotal(fresh.length);

			var chain = Promise.resolve();
			fresh.forEach(function (favorite, index) {
				chain = chain.then(function () {
					return addFavorite(favorite, index, fresh.length).then(function (item) {
						added.push(item);
					});
				});
			});
			return chain.then(function () {
				return fresh.length;
			});
		}).then(function (total) {
			return persist().then(function (saved) {
				if (saved.error) {
					throw annotate(saveFailedError(saved.error), saved);
				}
				return { total: total, added: added, savedTo: saved.savedTo };
			});
		}, function (error) {
			return persist().then(function (saved) {
				throw annotate(error, saved);
			});
		});
	}

	/**
	 * Znovu stáhne ČSFD hodnocení všech anime, jedno po druhém (Python
	 * UpdateCSFD(), ř. 442-450). Hodnoty se mění přímo v položkách a po
	 * zjištění všech je pomocník jednou zapíše do data/anime.json (Python
	 * WriteDataToTheFile()); při zastavení chybou se zapíše to, co už je hotové.
	 *
	 * @param {Object} deps
	 * @param {Object} deps.proxy - AnimeProxy (health, fetchPage, saveCsfdRatings)
	 * @param {Object} deps.data - AnimeData (getItems, save, hasStoredItems)
	 * @param {function(number)} [deps.onProgress] - průběh v procentech 0-100
	 * @returns {Promise<{total: number, updated: number, changed: number,
	 *     failures: Array<{name: string, number: string, code: string, detail: string}>,
	 *     savedTo: ?string, notInFile: Array<{name: string, number: string}>}>}
	 *     `savedTo` je 'file', nebo null, když se žádné hodnocení nezjistilo.
	 *     Při zastavení chybou má chyba navíc `updated`, `failures`, `notInFile`
	 *     a `savedTo` ('file', 'browser' nebo null). Selže-li jen zápis do
	 *     souboru, je to chyba `data-save-failed` se `savedTo` 'browser'.
	 */
	function updateCsfd(deps) {
		return exclusive(function () {
			return runItemsUpdate(deps, CSFD_RATINGS);
		});
	}

	/**
	 * Znovu stáhne MAL hodnocení všech anime, jedno po druhém (Python
	 * UpdateMAL(), ř. 481-489), a nechá je pomocníka zapsat do data/anime.json.
	 * Parametry, výsledek i chyby jako updateCsfd(); deps.proxy potřebuje
	 * saveMalRatings místo saveCsfdRatings a pomocníka verze 3.
	 */
	function updateMal(deps) {
		return exclusive(function () {
			return runItemsUpdate(deps, MAL_RATINGS);
		});
	}

	/**
	 * Podle oblíbených na sledujserialy.io přepíše zhlédnuté epizody (State)
	 * anime, která v oblíbených jsou a nejsou DROPPED (Python UpdateWatched(),
	 * ř. 393-411), a nechá je pomocníka zapsat do data/anime.json. Stav je
	 * "DONE", nebo "S<řada>E<epizoda>" z odkazu oblíbeného ("S02E--", když je
	 * nezhlédnutá jiná řada). Parametry, výsledek i chyby jako updateCsfd();
	 * deps.proxy potřebuje saveWatchedStates, pomocníka verze 4 s cookie.
	 * `updated` počítá jen anime, kterým se stav zjistil (ostatní se nemění).
	 */
	function updateWatched(deps) {
		return exclusive(function () {
			return runItemsUpdate(deps, WATCHED_STATES);
		});
	}

	function runItemsUpdate(deps, source) {
		var proxy = deps.proxy;
		var data = deps.data;
		var onProgress = deps.onProgress || noop;
		var progress = source.progress || function (index, total) {
			return 100 * index / total;
		};
		var items = data.getItems();
		if (!items) {
			return Promise.reject(syncError('data-not-loaded', ''));
		}
		// Během aktualizace se seznam nemění (ovládání je zamčené), přesto se prochází kopie pořadí.
		items = items.slice();

		var updated = 0;
		var changed = 0;
		var failures = [];
		// Number -> zjištěná hodnota a jméno anime (pro zápis do souboru a hlášení).
		var values = {};
		var names = {};

		function itemName(item) {
			return item.NameEn || item.FavoriteName || item.NameJa || String(item.Number);
		}

		function isSkippable(error) {
			return ITEM_SKIPPABLE.indexOf(error.code) !== -1 || Boolean(source.isSkippable && source.isSkippable(error));
		}

		function updateItem(item, context) {
			return Promise.resolve().then(function () {
				return source.fetchValue(proxy, item, context);
			}).then(function (value) {
				if (value === undefined) {
					return;
				}
				if (item[source.field] !== value) {
					changed += 1;
				}
				item[source.field] = value;
				values[String(item.Number)] = value;
				names[String(item.Number)] = itemName(item);
				updated += 1;
			}, function (error) {
				error.favorite = itemName(item);
				if (!isSkippable(error)) {
					throw error;
				}
				failures.push({ name: itemName(item), number: String(item.Number), code: error.code, detail: error.detail || '' });
			});
		}

		// Zapíše zjištěné hodnoty do data/anime.json (a případně do prohlížeče, viz persistUpdate()).
		function persist() {
			if (updated === 0) {
				return Promise.resolve({ savedTo: null, notInFile: [] });
			}
			return persistUpdate(data, function () {
				return source.save(proxy, values);
			}).then(function (saved) {
				if (saved.error) {
					return { savedTo: saved.savedTo, notInFile: [], error: saved.error };
				}
				var notInFile = saved.result.missing.map(function (number) {
					return { name: names[number] || number, number: number };
				});
				return { savedTo: saved.savedTo, notInFile: notInFile };
			});
		}

		function annotate(error, saved) {
			error.updated = updated;
			error.failures = failures;
			error.savedTo = saved.savedTo;
			error.notInFile = saved.notInFile;
			return error;
		}

		return proxy.health().then(function (health) {
			if (!(health.version >= source.minHelperVersion)) {
				throw syncError('helper-outdated', '');
			}
			if (!health.dataFile) {
				throw syncError('data-file-missing', '');
			}
			return source.prepare ? source.prepare(proxy, health) : null;
		}).then(function (context) {
			var chain = Promise.resolve();
			items.forEach(function (item, index) {
				chain = chain.then(function () {
					onProgress(progress(index, items.length));
					return updateItem(item, context);
				});
			});
			return chain;
		}).then(function () {
			return persist().then(function (saved) {
				if (saved.error) {
					throw annotate(saveFailedError(saved.error), saved);
				}
				return {
					total: items.length, updated: updated, changed: changed, failures: failures,
					savedTo: saved.savedTo, notInFile: saved.notInFile
				};
			});
		}, function (error) {
			return persist().then(function (saved) {
				throw annotate(error, saved);
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
		parseCsfdRating: parseCsfdRating,
		malSearchUrl: malSearchUrl,
		parseMalSerial: parseMalSerial,
		parseMalRating: parseMalRating,
		nextNumber: nextNumber,
		buildNewItem: buildNewItem,
		updateList: updateList,
		updateCsfd: updateCsfd,
		updateMal: updateMal,
		parseSerialSeasons: parseSerialSeasons,
		checkIfReallyNotFinished: checkIfReallyNotFinished,
		updateWatched: updateWatched
	};
})();
