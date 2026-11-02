/**
 * Vykreslování anime listu - hlavička, seznam řádků, filtr.
 *
 * renderHeader() vygeneruje řádek hlavičky podle window.AnimeColumns,
 * odpovídá části MainWindow.CreateWidgets() v Python aplikaci (řádky 281-319),
 * která vytváří sortovací tlačítka a labely s obrázky pro rating sloupce.
 * Samotné zpracování kliknutí (řazení) je v js/anime-page.js.
 */
window.AnimeView = (function () {
	'use strict';

	var ICON_BASE = 'img/anime/icons/';

	function buildHeaderCell(column, sortState) {
		var cell = document.createElement('div');
		cell.className = 'anime__header-cell';
		cell.setAttribute('role', 'columnheader');
		cell.setAttribute('data-column', column.key);
		if (column.sortable) {
			cell.classList.add('anime__header-cell--sortable');
			var isActiveSort = sortState && sortState.column === column.key;
			cell.setAttribute('data-sort', isActiveSort ? (sortState.ascending ? 'asc' : 'desc') : 'none');
			// aria-sort - standardní ARIA atribut pro řaditelné sloupce (bez
			// existujícího vzoru jinde na webu, Python aplikace ani jiná stránka
			// řaditelnou tabulku nemá).
			cell.setAttribute('aria-sort', isActiveSort ? (sortState.ascending ? 'ascending' : 'descending') : 'none');
			// Tvar ikony (Sort/SortAsc/SortDesc.png) volí css/anime.css podle data-sort.
			var sortIcon = document.createElement('span');
			sortIcon.className = 'anime__header-sort';
			cell.appendChild(sortIcon);
		}
		if (column.isRating) {
			cell.classList.add('anime__header-cell--rating');
			cell.classList.add('anime__header-cell--rating-' + column.key);
			var img = document.createElement('img');
			img.className = 'anime__header-rating-icon';
			img.src = ICON_BASE + column.iconFile;
			img.alt = '';
			img.setAttribute('data-i18n-aria-label', column.labelKey);
			img.setAttribute('aria-label', '');
			cell.appendChild(img);
		} else {
			var label = document.createElement('span');
			label.className = 'anime__header-label';
			label.setAttribute('data-i18n', column.labelKey);
			cell.appendChild(label);
		}
		return cell;
	}

	function renderHeader(sortState) {
		var host = document.getElementById('anime-header');
		var columns = window.AnimeColumns && window.AnimeColumns.COLUMNS;
		if (!host || !columns) {
			return;
		}
		host.style.gridTemplateColumns = window.AnimeColumns.gridTemplate();
		document.documentElement.style.setProperty('--anime-grid-columns', window.AnimeColumns.gridTemplate());

		var frag = document.createDocumentFragment();
		columns.forEach(function (col) {
			frag.appendChild(buildHeaderCell(col, sortState));
		});
		host.innerHTML = '';
		host.appendChild(frag);

		if (window.I18n && typeof window.I18n.applyStatic === 'function') {
			window.I18n.applyStatic(host);
		}
	}

	var scrollSynced = false;

	/**
	 * Hlavička je v lepivé liště mimo kontejner seznamu, takže vodorovný
	 * scroll obou obalů se drží v souladu ručně. Zámek na zdrojový prvek
	 * brání ozvěně (nastavení scrollLeft vyvolá scroll i na druhé straně).
	 */
	function syncHorizontalScroll(listWrap, headerWrap) {
		var lockedBy = null;
		var unlockTimer = null;

		function follow(source, target) {
			source.addEventListener('scroll', function () {
				if (lockedBy && lockedBy !== source) {
					return;
				}
				lockedBy = source;
				clearTimeout(unlockTimer);
				unlockTimer = setTimeout(function () {
					lockedBy = null;
				}, 100);
				if (target.scrollLeft !== source.scrollLeft) {
					target.scrollLeft = source.scrollLeft;
				}
			}, { passive: true });
		}

		follow(listWrap, headerWrap);
		follow(headerWrap, listWrap);
	}

	function showList() {
		var wrap = document.getElementById('anime-list-wrap');
		var headerWrap = document.getElementById('anime-header-wrap');
		if (wrap) {
			wrap.hidden = false;
		}
		if (headerWrap) {
			headerWrap.hidden = false;
		}
		if (wrap && headerWrap && !scrollSynced) {
			scrollSynced = true;
			syncHorizontalScroll(wrap, headerWrap);
			headerWrap.scrollLeft = wrap.scrollLeft;
		}
	}

	/**
	 * Vygeneruje všechny řádky seznamu. Odpovídá smyčce v Python
	 * MainWindow.CreateWidgets (řádky 322-325), která vytvoří jeden
	 * AnimeGB pro každou položku v AnimeData.
	 * @param {Array} items
	 * @param {boolean} [editing] - Krok 12: vykreslit editovatelné sloupce jako <textarea>.
	 */
	function renderList(items, editing) {
		var host = document.getElementById('anime-list');
		if (!host || !window.AnimeRow || !items) {
			return;
		}
		// Šířky sloupců jsou identické pro hlavičku i řádky - držíme je
		// v jedné CSS proměnné, aby stačilo měnit AnimeColumns.gridTemplate().
		if (window.AnimeColumns) {
			document.documentElement.style.setProperty('--anime-grid-columns', window.AnimeColumns.gridTemplate());
		}

		var frag = document.createDocumentFragment();
		items.forEach(function (item, index) {
			frag.appendChild(window.AnimeRow.create(item, index, editing));
		});
		host.innerHTML = '';
		host.appendChild(frag);

		// Editovatelné sloupce mají v edit módu data-i18n-aria-label (viz
		// js/anime-row-view.js) - musí se dosadit i po vykreslení, stejně
		// jako v renderHeader() výše.
		if (window.I18n && typeof window.I18n.applyStatic === 'function') {
			window.I18n.applyStatic(host);
		}
	}

	/**
	 * Překreslí jednu buňku už vykresleného řádku, aniž by se měnily ostatní
	 * (obrázky se znovu nenačítají, skrytí hledáním zůstane). Bez Python
	 * vzoru - Python řádky překreslí až po skončení aktualizace.
	 * @param {number} index - pozice položky v seznamu (rychlé hledání řádku)
	 * @param {Object} item - záznam z data/anime.json
	 * @param {string} key - klíč sloupce (např. 'State', 'CsfdRating')
	 * @param {boolean} [editing] - edit mód
	 * @returns {boolean} false, když řádek nebo sloupec na stránce není
	 */
	function updateCell(index, item, key, editing) {
		var host = document.getElementById('anime-list');
		var columns = window.AnimeColumns && window.AnimeColumns.COLUMNS;
		if (!host || !item || !columns || !window.AnimeRow || typeof window.AnimeRow.createCell !== 'function') {
			return false;
		}
		var column = null;
		columns.forEach(function (col) {
			if (col.key === key) {
				column = col;
			}
		});
		if (!column) {
			return false;
		}
		var number = String(item.Number);
		var row = index >= 0 ? host.children[index] : null;
		if (!row || row.getAttribute('data-number') !== number) {
			row = null;
			for (var i = 0; i < host.children.length; i++) {
				if (host.children[i].getAttribute('data-number') === number) {
					row = host.children[i];
					break;
				}
			}
		}
		if (!row) {
			return false;
		}
		var className = 'anime-row__cell--' + key;
		var old = null;
		for (var j = 0; j < row.children.length; j++) {
			if (row.children[j].classList.contains(className)) {
				old = row.children[j];
				break;
			}
		}
		if (!old) {
			return false;
		}
		var cell = window.AnimeRow.createCell(column, item, editing);
		row.replaceChild(cell, old);
		if (window.I18n && typeof window.I18n.applyStatic === 'function') {
			window.I18n.applyStatic(cell);
		}
		return true;
	}

	return {
		renderHeader: renderHeader,
		renderList: renderList,
		updateCell: updateCell,
		showList: showList
	};
})();
