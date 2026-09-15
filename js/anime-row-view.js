/**
 * Vykreslování jednoho řádku anime listu.
 *
 * Odpovídá třídě AnimeGB v Python aplikaci (AnimeList.pyw, řádky 665-843).
 * Krok 6 přidal odkazy NameEn -> ČSFD a NameJa -> MyAnimeList.
 * Krok 7 přidal barevné odstupňování hodnocení (Python FormatRating, ř. 777-790).
 * Krok 12 přidal edit mód - editovatelné sloupce (column.editable) se v edit
 * módu vykreslí jako <textarea> místo textu/odkazu (Python SwitchEditMode, ř. 793-808).
 *
 * Struktura:
 *   <article class="anime-row" data-number="1">
 *     <div class="anime-row__cell anime-row__cell--Number">1</div>
 *     <div class="anime-row__cell anime-row__cell--Image"><img …></div>
 *     …
 *   </article>
 */
window.AnimeRow = (function () {
	'use strict';

	var IMAGE_BASE = 'img/anime/';

	// Python nahrazuje " / " v hodnotách za "\n" (AnimeList.pyw ř. 743, 746, 749, 756).
	// CSS `white-space: pre-line` na buňce se pak postará o zalomení.
	function normalizeText(value) {
		if (value === undefined || value === null) {
			return '';
		}
		return String(value).replace(/ \/ /g, '\n');
	}

	function buildImageCell(item) {
		var cell = document.createElement('div');
		cell.className = 'anime-row__cell anime-row__cell--Image';

		var img = document.createElement('img');
		img.className = 'anime-row__image';
		img.src = IMAGE_BASE + String(item.Image) + '.jpg';
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		cell.appendChild(img);
		return cell;
	}

	// NameEn odkazuje na ČSFD, NameJa na MyAnimeList (AnimeList.pyw ř. 742-747).
	var LINK_BASE = {
		NameEn: 'https://www.csfd.cz/film/',
		NameJa: 'https://myanimelist.net/anime/'
	};
	var LINK_ID_KEY = {
		NameEn: 'CsfdID',
		NameJa: 'MalID'
	};

	// Hranice a barvy odpovídají Python FormatRating() (AnimeList.pyw ř. 777-790).
	// Hodnota je ve tvaru "77%" nebo "?%" u neznámého hodnocení ("?" -> 0).
	var RATING_TIERS = [
		{ max: 50, className: 'anime-row__rating--lt50' },
		{ max: 70, className: 'anime-row__rating--lt70' },
		{ max: 80, className: 'anime-row__rating--lt80' },
		{ max: 90, className: 'anime-row__rating--lt90' },
		{ max: 95, className: 'anime-row__rating--lt95' }
	];

	function parseRatingValue(raw) {
		var cleaned = String(raw === undefined || raw === null ? '' : raw)
			.replace(/%/g, '')
			.replace(/\?/g, '0');
		return parseInt(cleaned, 10);
	}

	function ratingClass(raw) {
		var rating = parseRatingValue(raw);
		for (var i = 0; i < RATING_TIERS.length; i++) {
			if (rating < RATING_TIERS[i].max) {
				return RATING_TIERS[i].className;
			}
		}
		return 'anime-row__rating--ge95';
	}

	function buildTextCell(column, item, editing) {
		var cell = document.createElement('div');
		cell.className = 'anime-row__cell anime-row__cell--' + column.key;
		if (column.isRating) {
			cell.classList.add('anime-row__cell--rating');
		}

		// Edit mód: editovatelné sloupce dostanou <textarea> místo textu/odkazu
		// (Python QStackedWidget přepne z Label na TextEdit, ř. 808).
		if (editing && column.editable) {
			var textarea = document.createElement('textarea');
			textarea.className = 'anime-row__edit-input';
			textarea.setAttribute('data-column', column.key);
			// Přístupný název pole (bez ekvivalentu v Python aplikaci) - stejný
			// vzor jako u ikon ratingu v hlavičce (js/anime-view.js).
			textarea.setAttribute('data-i18n-aria-label', column.labelKey);
			textarea.value = normalizeText(item[column.key]);
			cell.appendChild(textarea);
			return cell;
		}

		if (column.isRating) {
			cell.classList.add(ratingClass(item[column.key]));
		}
		var text = normalizeText(item[column.key]);
		var linkBase = LINK_BASE[column.key];
		if (linkBase) {
			var link = document.createElement('a');
			link.className = 'anime-row__link';
			link.href = linkBase + String(item[LINK_ID_KEY[column.key]]);
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
			link.textContent = text;
			cell.appendChild(link);
		} else {
			cell.textContent = text;
		}
		return cell;
	}

	/**
	 * Vytvoří DOM řádek pro jedno anime.
	 * @param {Object} item - záznam z data/anime.json
	 * @param {number} index - pozice v seznamu (pro zebra stripe, Python ř. 770-771)
	 * @param {boolean} [editing] - zda vykreslit editovatelné sloupce jako <textarea>
	 */
	function create(item, index, editing) {
		var el = document.createElement('article');
		el.className = 'anime-row';
		el.setAttribute('role', 'listitem');
		el.setAttribute('data-number', item.Number);
		if ((index % 2) === 0) {
			el.classList.add('anime-row--even');
		}

		var columns = window.AnimeColumns && window.AnimeColumns.COLUMNS;
		if (!columns) {
			return el;
		}

		columns.forEach(function (col) {
			if (col.key === 'Image') {
				el.appendChild(buildImageCell(item));
			} else {
				el.appendChild(buildTextCell(col, item, editing));
			}
		});

		return el;
	}

	return {
		create: create
	};
})();
