/**
 * Bezpečné sestavení cest k obrázkům otázek.
 *
 * Ze zdrojových dat přichází pouze název souboru (např. "12.png"). Cesta se
 * vždy skládá relativně vůči adresáři s obrázky a název se ověřuje, aby se
 * odkazem nedalo vystoupit z adresáře ani načíst cizí zdroj.
 */
window.NV194Images = (function () {
	'use strict';

	var DEFAULT_BASE = 'data/obrazky/';

	/**
	 * Povolený název souboru: jen slovní znaky a pomlčka následované příponou.
	 * Vylučuje lomítka, dvojtečku (protokol), nadřazené adresáře i dotazy.
	 */
	var SAFE_NAME = /^[\w-]+\.(png|jpe?g|gif|webp|svg)$/i;

	function isSafeName(name) {
		return typeof name === 'string' && SAFE_NAME.test(name);
	}

	function normalizeBase(base) {
		var value = (base === undefined || base === null) ? DEFAULT_BASE : String(base);
		if (value === '' || value.charAt(value.length - 1) === '/') {
			return value;
		}
		return value + '/';
	}

	/**
	 * Sestaví cestu k obrázku relativně k adresáři s obrázky.
	 *
	 * @param {string} name název souboru ze zdrojových dat
	 * @param {string} [base] adresář s obrázky
	 * @returns {string|null} cesta, nebo null pro nepřípustný název
	 */
	function resolve(name, base) {
		if (!isSafeName(name)) {
			return null;
		}
		return normalizeBase(base) + encodeURIComponent(name);
	}

	return {
		DEFAULT_BASE: DEFAULT_BASE,
		SAFE_NAME: SAFE_NAME,
		isSafeName: isSafeName,
		normalizeBase: normalizeBase,
		resolve: resolve
	};
})();
