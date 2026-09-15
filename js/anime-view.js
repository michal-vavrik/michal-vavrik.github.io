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

	function sortIconFile(state, columnKey) {
		if (!state || state.column !== columnKey) {
			return 'Sort.png';
		}
		return state.ascending ? 'SortAsc.png' : 'SortDesc.png';
	}

	function buildHeaderCell(column, sortState) {
		var cell = document.createElement('div');
		cell.className = 'anime__header-cell';
		cell.setAttribute('role', 'columnheader');
		cell.setAttribute('data-column', column.key);
		if (column.sortable) {
			cell.classList.add('anime__header-cell--sortable');
			var iconFile = sortIconFile(sortState, column.key);
			var isActiveSort = sortState && sortState.column === column.key;
			cell.setAttribute('data-sort', isActiveSort ? (sortState.ascending ? 'asc' : 'desc') : 'none');
			// aria-sort - standardní ARIA atribut pro řaditelné sloupce (bez
			// existujícího vzoru jinde na webu, Python aplikace ani jiná stránka
			// řaditelnou tabulku nemá).
			cell.setAttribute('aria-sort', isActiveSort ? (sortState.ascending ? 'ascending' : 'descending') : 'none');
			var sortIcon = document.createElement('span');
			sortIcon.className = 'anime__header-sort';
			sortIcon.style.backgroundImage = 'url("' + ICON_BASE + iconFile + '")';
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

	function showList() {
		var wrap = document.getElementById('anime-list-wrap');
		if (wrap) {
			wrap.hidden = false;
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

	return {
		renderHeader: renderHeader,
		renderList: renderList,
		showList: showList
	};
})();
