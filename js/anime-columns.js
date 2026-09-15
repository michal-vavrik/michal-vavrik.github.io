/**
 * Definice sloupců anime listu - jediné místo, kde se popisuje uspořádání
 * a chování sloupců. Odpovídá slovníku PROPERTY v Python aplikaci
 * (viz original-anime-list/AnimeList.pyw, řádek 43).
 *
 * Pole:
 *   key       - shodný s klíčem v datech (např. "Number", "NameEn").
 *   width     - pevná šířka sloupce v pixelech (PROPERTY["Width"]).
 *   labelKey  - i18n klíč zobrazovaného textu hlavičky (PROPERTY["DisplayName"]).
 *   sortable  - zda se dá podle sloupce řadit (PROPERTY["Sortable"]).
 *   sortType  - "int" | "str" | "date" (PROPERTY["SortingType"]).
 *   editable  - zda sloupec přepínat do <textarea> v edit módu (PROPERTY["Editable"]).
 *   isRating  - sloupec s hodnocením (RATING_PROPERTY na řádku 58).
 *   iconFile  - ikona v hlavičce místo textu (pro rating sloupce).
 *
 * Uvedeny jsou pouze viditelné sloupce (PROPERTY["Visible"] == True).
 * Skryté sloupce (FavoriteName, CsfdID, MalID, MalName) se v UI nezobrazují;
 * v datech ale nadále existují a používají se v odkazech / klíčích.
 */
window.AnimeColumns = (function () {
	'use strict';

	var COLUMNS = [
		{ key: 'Number',      width: 45,  labelKey: 'anime.header.number',      sortable: true,  sortType: 'int',  editable: true,  isRating: false },
		{ key: 'Image',       width: 120, labelKey: 'anime.header.image',       sortable: false, sortType: null,   editable: false, isRating: false },
		{ key: 'NameEn',      width: 200, labelKey: 'anime.header.nameEn',      sortable: true,  sortType: 'str',  editable: true,  isRating: false },
		{ key: 'NameJa',      width: 200, labelKey: 'anime.header.nameJa',      sortable: true,  sortType: 'str',  editable: true,  isRating: false },
		{ key: 'Genres',      width: 90,  labelKey: 'anime.header.genres',      sortable: false, sortType: null,   editable: true,  isRating: false },
		{ key: 'Description', width: 760, labelKey: 'anime.header.description', sortable: false, sortType: null,   editable: true,  isRating: false },
		{ key: 'Date',        width: 90,  labelKey: 'anime.header.date',        sortable: true,  sortType: 'date', editable: true,  isRating: false },
		{ key: 'State',       width: 70,  labelKey: 'anime.header.state',       sortable: true,  sortType: 'str',  editable: true,  isRating: false },
		{ key: 'CsfdRating',  width: 90,  labelKey: 'anime.header.csfdRating',  sortable: true,  sortType: 'int',  editable: true,  isRating: true,  iconFile: 'CsfdRating.png' },
		{ key: 'MalRating',   width: 90,  labelKey: 'anime.header.malRating',   sortable: true,  sortType: 'int',  editable: true,  isRating: true,  iconFile: 'MalRating.png' },
		{ key: 'MyRating',    width: 70,  labelKey: 'anime.header.myRating',    sortable: true,  sortType: 'int',  editable: true,  isRating: true,  iconFile: 'MyRating.png' }
	];

	function gridTemplate() {
		return COLUMNS.map(function (c) { return c.width + 'px'; }).join(' ');
	}

	return {
		COLUMNS: COLUMNS,
		gridTemplate: gridTemplate
	};
})();
