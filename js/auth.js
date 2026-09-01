/**
 * Přihlašování a řízení přístupu ke stránkám webu.
 *
 * Soubor se načítá jako blokující skript v <head>, aby se chráněná stránka
 * vůbec nezačala vykreslovat, pokud na ni návštěvník nemá přístup.
 *
 * DŮLEŽITÉ – jde o statický web bez serveru. Kontrola tedy probíhá výhradně
 * v prohlížeči a je pouze zábranou proti náhodnému návštěvníkovi, nikoli
 * skutečným zabezpečením. Kdokoli si může zobrazit zdrojové soubory přímo.
 * Do chráněných stránek proto nepatří nic citlivého.
 *
 * Hesla nejsou uložena v otevřené podobě, ale jako otisky SHA-256.
 */
window.SiteAuth = (function () {
	'use strict';

	var STORAGE_KEY = 'site-auth-role';
	var HOME_PAGE = 'index.html';

	/**
	 * Kořen webu odvozený z umístění tohoto skriptu (.../js/auth.js).
	 * Díky tomu funguje ochrana i pro stránky v podadresářích a web může
	 * být umístěn i jinde než v kořeni domény.
	 */
	var BASE_PATH = (function () {
		var script = document.currentScript;
		var source = script ? script.src : '';
		var marker = '/js/auth.js';
		var at = source.indexOf(marker);

		if (at === -1) {
			return '/';
		}
		// Z absolutní adresy skriptu vezmeme jen cestu ke kořeni webu.
		return new URL(source.substring(0, at + 1)).pathname;
	})();

	var ROLES = {
		/** Přístup pouze ke stránce NV194. */
		NV194: 'nv194',
		/** Přístup ke všem stránkám webu. */
		FULL: 'full'
	};

	/** Otisky hesel (SHA-256). */
	var PASSWORD_HASHES = {
		'2b8e3bafa8a7584d01461cd401925f854c570d2a671be1489fc906c90de3f369': ROLES.NV194,
		'311ae06d6f82988a5bc4a38d0d922e95bb67479429ebd2b5e51ab4a56857d8b3': ROLES.FULL
	};

	/**
	 * Role, které mají přístup k jednotlivým stránkám.
	 * Prázdné pole znamená veřejnou stránku.
	 */
	var PAGE_ACCESS = {
		'index.html': [],
		'nv194.html': [ROLES.NV194, ROLES.FULL],
		'personal.html': [ROLES.FULL],
		'cv.html': [ROLES.FULL],
		'games.html': [ROLES.FULL],
		'contact.html': [ROLES.FULL]
	};

	/* --- SHA-256 ---
	 * Vlastní implementace, aby ověření fungovalo i mimo zabezpečený kontext
	 * (crypto.subtle není dostupné například při otevření přes file://).
	 */

	var K = [
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
		0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
		0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
		0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
		0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
		0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
		0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
		0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
	];

	function utf8Bytes(text) {
		var bytes = [];
		for (var i = 0; i < text.length; i++) {
			var code = text.charCodeAt(i);

			if (code < 0x80) {
				bytes.push(code);
			} else if (code < 0x800) {
				bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
			} else if (code < 0xd800 || code >= 0xe000) {
				bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
			} else {
				i++;
				var point = 0x10000 + (((code & 0x3ff) << 10) | (text.charCodeAt(i) & 0x3ff));
				bytes.push(
					0xf0 | (point >> 18),
					0x80 | ((point >> 12) & 0x3f),
					0x80 | ((point >> 6) & 0x3f),
					0x80 | (point & 0x3f)
				);
			}
		}
		return bytes;
	}

	function rotateRight(value, amount) {
		return (value >>> amount) | (value << (32 - amount));
	}

	function toHex(value) {
		var hex = '';
		for (var shift = 28; shift >= 0; shift -= 4) {
			hex += ((value >>> shift) & 0x0f).toString(16);
		}
		return hex;
	}

	function sha256(text) {
		var hash = [
			0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
			0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
		];

		var bytes = utf8Bytes(text);
		var bitLength = bytes.length * 8;

		bytes.push(0x80);
		while (bytes.length % 64 !== 56) {
			bytes.push(0);
		}
		// Délka zprávy v bitech jako 64bitové číslo (horní slovo je zde vždy nula).
		bytes.push(0, 0, 0, 0);
		bytes.push((bitLength >>> 24) & 0xff, (bitLength >>> 16) & 0xff, (bitLength >>> 8) & 0xff, bitLength & 0xff);

		var words = new Array(64);

		for (var offset = 0; offset < bytes.length; offset += 64) {
			var i;
			for (i = 0; i < 16; i++) {
				var at = offset + i * 4;
				words[i] = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
			}
			for (i = 16; i < 64; i++) {
				var w15 = words[i - 15];
				var w2 = words[i - 2];
				var s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
				var s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
				words[i] = (words[i - 16] + s0 + words[i - 7] + s1) | 0;
			}

			var a = hash[0], b = hash[1], c = hash[2], d = hash[3];
			var e = hash[4], f = hash[5], g = hash[6], h = hash[7];

			for (i = 0; i < 64; i++) {
				var S1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
				var ch = (e & f) ^ (~e & g);
				var temp1 = (h + S1 + ch + K[i] + words[i]) | 0;
				var S0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
				var maj = (a & b) ^ (a & c) ^ (b & c);
				var temp2 = (S0 + maj) | 0;

				h = g;
				g = f;
				f = e;
				e = (d + temp1) | 0;
				d = c;
				c = b;
				b = a;
				a = (temp1 + temp2) | 0;
			}

			hash[0] = (hash[0] + a) | 0;
			hash[1] = (hash[1] + b) | 0;
			hash[2] = (hash[2] + c) | 0;
			hash[3] = (hash[3] + d) | 0;
			hash[4] = (hash[4] + e) | 0;
			hash[5] = (hash[5] + f) | 0;
			hash[6] = (hash[6] + g) | 0;
			hash[7] = (hash[7] + h) | 0;
		}

		return hash.map(toHex).join('');
	}

	/* --- Stav přihlášení --- */

	function storage() {
		try {
			return window.sessionStorage;
		} catch (error) {
			// Přístup k úložišti může být zakázán nastavením prohlížeče.
			return null;
		}
	}

	function role() {
		var store = storage();
		if (!store) {
			return null;
		}
		var value = store.getItem(STORAGE_KEY);
		return (value === ROLES.NV194 || value === ROLES.FULL) ? value : null;
	}

	function setRole(value) {
		var store = storage();
		if (!store) {
			return;
		}
		if (value === null) {
			store.removeItem(STORAGE_KEY);
		} else {
			store.setItem(STORAGE_KEY, value);
		}
	}

	/* --- Stránky a přístup --- */

	/**
	 * Název aktuální stránky vůči kořeni webu.
	 * Stránky v podadresářích tak nesplynou se stránkami v kořeni.
	 */
	function currentPage() {
		var path = window.location.pathname;
		var relative = path.indexOf(BASE_PATH) === 0 ? path.substring(BASE_PATH.length) : path;

		if (relative === '' || relative.charAt(relative.length - 1) === '/') {
			relative += HOME_PAGE;
		}
		return relative.toLowerCase();
	}

	/** Absolutní cesta k úvodní stránce. */
	function homeUrl() {
		return BASE_PATH + HOME_PAGE;
	}

	/** Neznámá stránka se pro jistotu považuje za plně chráněnou. */
	function requiredRoles(page) {
		var key = String(page).toLowerCase();
		return Object.prototype.hasOwnProperty.call(PAGE_ACCESS, key)
			? PAGE_ACCESS[key]
			: [ROLES.FULL];
	}

	function isPublic(page) {
		return requiredRoles(page).length === 0;
	}

	function canAccess(page, forRole) {
		var needed = requiredRoles(page);
		if (needed.length === 0) {
			return true;
		}
		var actual = forRole === undefined ? role() : forRole;
		return actual !== null && needed.indexOf(actual) !== -1;
	}

	/**
	 * Ověří heslo a při shodě přihlásí.
	 * @returns {string|null} přidělená role, nebo null při neplatném heslu
	 */
	function login(password) {
		var hash = sha256(String(password === undefined || password === null ? '' : password));
		var granted = PASSWORD_HASHES[hash] || null;
		if (granted !== null) {
			setRole(granted);
		}
		return granted;
	}

	function logout() {
		setRole(null);
	}

	/** Stránky dostupné aktuálně přihlášené roli. */
	function accessiblePages() {
		return Object.keys(PAGE_ACCESS).filter(function (page) {
			return canAccess(page);
		});
	}

	/**
	 * Odmítne přístup k chráněné stránce přesměrováním na úvodní stránku.
	 * Volá se ihned při načtení, ještě před vykreslením obsahu.
	 */
	function guard() {
		var page = currentPage();
		if (canAccess(page) || page === HOME_PAGE) {
			return true;
		}
		// replace() zabrání tomu, aby se šlo tlačítkem zpět vrátit na chráněnou stránku.
		window.location.replace(homeUrl() + '?denied=' + encodeURIComponent(page));
		return false;
	}

	var api = {
		ROLES: ROLES,
		HOME_PAGE: HOME_PAGE,
		BASE_PATH: BASE_PATH,
		PAGE_ACCESS: PAGE_ACCESS,
		sha256: sha256,
		role: role,
		login: login,
		logout: logout,
		currentPage: currentPage,
		homeUrl: homeUrl,
		requiredRoles: requiredRoles,
		isPublic: isPublic,
		canAccess: canAccess,
		accessiblePages: accessiblePages,
		guard: guard
	};

	guard();

	return api;
})();
