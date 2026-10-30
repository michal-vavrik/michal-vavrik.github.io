/**
 * Klient lokálního pomocníka (tools/anime_proxy.py) - Krok 20, bez Python vzoru.
 *
 * Prohlížeč nesmí číst cizí weby (CORS) ani zapisovat soubory na disk, jako to
 * dělá Python aplikace přes `requests` a `open()`. Proto stránky stahuje
 * a obrázky ukládá malý program běžící na počítači uživatele. Tento modul je
 * jen tenká vrstva nad jeho HTTP rozhraním; veškerá logika aktualizace je
 * v js/anime-sync.js.
 *
 * Každá chyba má `code` (kódy z hlavičky X-Proxy-Error pomocníka a navíc
 * `unreachable`, `timeout`, `upstream-http`, `unexpected-response`), `detail`
 * a `status`, aby je stránka mohla přeložit.
 */
window.AnimeProxy = (function () {
	'use strict';

	var DEFAULT_URL = 'http://127.0.0.1:8787';
	var URL_STORAGE_KEY = 'anime-proxy-url';
	var REQUEST_HEADER = 'X-Anime-Proxy';
	var TIMEOUT_MS = 60000;

	// Jiný port pomocníka (--port) lze nastavit jen na smyčku, aby stránka
	// nikdy neposílala požadavky na cizí adresu.
	var LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/;

	function createError(code, detail, status) {
		var error = new Error(detail ? code + ': ' + detail : code);
		error.name = 'AnimeProxyError';
		error.code = code;
		error.detail = detail || '';
		error.status = status || 0;
		return error;
	}

	function baseUrl() {
		try {
			var stored = window.localStorage.getItem(URL_STORAGE_KEY);
			if (stored && LOOPBACK_URL.test(stored)) {
				return stored;
			}
		} catch (error) {
			// Soukromý režim prohlížeče může čtení odmítnout - platí výchozí adresa.
		}
		return DEFAULT_URL;
	}

	/**
	 * Odešle požadavek pomocníkovi a přečte celé tělo odpovědi. Časový limit
	 * platí i pro čtení těla. Selhání spojení (pomocník neběží, prohlížeč
	 * zablokoval přístup k místní síti) skončí kódem `unreachable`.
	 */
	function call(path, options) {
		var controller = new AbortController();
		var timedOut = false;
		var timer = setTimeout(function () {
			timedOut = true;
			controller.abort();
		}, TIMEOUT_MS);

		var headers = {};
		headers[REQUEST_HEADER] = '1';
		Object.keys(options.headers || {}).forEach(function (name) {
			headers[name] = options.headers[name];
		});

		var base = baseUrl();
		return fetch(base + path, {
			method: options.method,
			headers: headers,
			body: options.body,
			cache: 'no-store',
			credentials: 'omit',
			signal: controller.signal
		}).then(function (response) {
			return response.text().then(function (text) {
				return { response: response, text: text };
			});
		}).then(function (result) {
			clearTimeout(timer);
			return result;
		}, function (error) {
			clearTimeout(timer);
			if (timedOut) {
				throw createError('timeout', base);
			}
			throw createError('unreachable', base);
		});
	}

	function errorFromResponse(response) {
		var code = response.headers.get('X-Proxy-Error');
		if (code) {
			return createError(code, response.headers.get('X-Proxy-Detail') || '', response.status);
		}
		return createError('unexpected-response', 'HTTP ' + response.status, response.status);
	}

	/**
	 * Ověří, že pomocník běží, a vrátí jeho stav.
	 * @returns {Promise<{version: number, cookieConfigured: boolean, maxImageNumber: number, dataFile: boolean}>}
	 */
	function health() {
		return call('/health', { method: 'GET' }).then(function (result) {
			if (!result.response.ok) {
				throw errorFromResponse(result.response);
			}
			var payload = null;
			try {
				payload = JSON.parse(result.text);
			} catch (error) {
				payload = null;
			}
			if (!payload || payload.ok !== true) {
				throw createError('unexpected-response', 'health');
			}
			return {
				version: payload.version,
				cookieConfigured: Boolean(payload.cookieConfigured),
				maxImageNumber: Number(payload.maxImageNumber) || 0,
				dataFile: payload.dataFile === true
			};
		});
	}

	/**
	 * Stáhne stránku (mirror Python `requests.get(...).content.decode("utf-8")`).
	 * Odpověď serveru s kódem 400 a vyšším je chyba `upstream-http` - Python
	 * by v takovém případě pokračoval s chybovou stránkou a spadl až později.
	 * Kódy uvedené v `options.acceptStatus` se přijmou i s tělem stránky
	 * (MyAnimeList odpovídá na hledání bez výsledků kódem 404 a vysvětlující
	 * stránkou); volající pak musí stav zkontrolovat sám.
	 * @param {string} url
	 * @param {{acceptStatus: Array<number>}} [options]
	 * @returns {Promise<{text: string, status: number, finalUrl: string}>}
	 */
	function fetchPage(url, options) {
		var accepted = (options && options.acceptStatus) || [];
		return call('/fetch?url=' + encodeURIComponent(url), { method: 'GET' }).then(function (result) {
			var headers = result.response.headers;
			if (headers.get('X-Proxy-Error') || !result.response.ok) {
				throw errorFromResponse(result.response);
			}
			var status = parseInt(headers.get('X-Upstream-Status'), 10);
			if (isNaN(status)) {
				throw createError('unexpected-response', 'upstream status');
			}
			if (status >= 400 && accepted.indexOf(status) === -1) {
				throw createError('upstream-http', String(status), status);
			}
			return { text: result.text, status: status, finalUrl: headers.get('X-Final-Url') || url };
		});
	}

	/**
	 * Nechá pomocníka stáhnout obrázek a uložit ho jako img/anime/<number>.jpg.
	 * Existující soubor se nikdy nepřepíše (chyba `image-exists`).
	 * @returns {Promise<{number: number, bytes: number}>}
	 */
	function saveImage(url, number) {
		return call('/images', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: url, number: number })
		}).then(function (result) {
			if (result.response.status !== 201) {
				var error = errorFromResponse(result.response);
				if (error.code === 'image-exists') {
					error.detail = String(number);
				}
				throw error;
			}
			var payload = null;
			try {
				payload = JSON.parse(result.text);
			} catch (parseError) {
				payload = null;
			}
			if (!payload || payload.ok !== true) {
				throw createError('unexpected-response', 'images');
			}
			return { number: payload.number, bytes: payload.bytes };
		});
	}

	/**
	 * Nechá pomocníka zapsat jedno pole anime do data/anime.json (mirror Python
	 * `UpdateCSFD()`/`UpdateMAL()`/`UpdateWatched()` + `WriteDataToTheFile()`).
	 * Mění se jen anime, která v souboru jsou; čísla ostatních vrátí v `missing`.
	 * @param {string} path - '/csfd-ratings' (CsfdRating), '/mal-ratings' (MalRating)
	 *     nebo '/watched-states' (State)
	 * @param {string} key - klíč v těle požadavku ('ratings' nebo 'states')
	 * @param {Object<string, string>} values Number -> nová hodnota ("85%", "?%", "DONE", "S01E05"...)
	 * @returns {Promise<{changed: number, missing: Array<string>}>}
	 */
	function saveValues(path, key, values) {
		var body = {};
		body[key] = values;
		return call(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}).then(function (result) {
			if (result.response.status !== 200) {
				throw errorFromResponse(result.response);
			}
			var payload = null;
			try {
				payload = JSON.parse(result.text);
			} catch (parseError) {
				payload = null;
			}
			if (!payload || payload.ok !== true || !Array.isArray(payload.missing)) {
				throw createError('unexpected-response', path.slice(1));
			}
			return { changed: Number(payload.changed) || 0, missing: payload.missing.map(String) };
		});
	}

	/** ČSFD hodnocení do data/anime.json (pole CsfdRating), viz saveValues(). */
	function saveCsfdRatings(ratings) {
		return saveValues('/csfd-ratings', 'ratings', ratings);
	}

	/** MAL hodnocení do data/anime.json (pole MalRating, pomocník od verze 3), viz saveValues(). */
	function saveMalRatings(ratings) {
		return saveValues('/mal-ratings', 'ratings', ratings);
	}

	/** Zhlédnuté epizody do data/anime.json (pole State, pomocník od verze 4), viz saveValues(). */
	function saveWatchedStates(states) {
		return saveValues('/watched-states', 'states', states);
	}

	return {
		DEFAULT_URL: DEFAULT_URL,
		URL_STORAGE_KEY: URL_STORAGE_KEY,
		baseUrl: baseUrl,
		health: health,
		fetchPage: fetchPage,
		saveImage: saveImage,
		saveCsfdRatings: saveCsfdRatings,
		saveMalRatings: saveMalRatings,
		saveWatchedStates: saveWatchedStates
	};
})();
