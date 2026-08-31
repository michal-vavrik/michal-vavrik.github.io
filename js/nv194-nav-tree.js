/**
 * Sestavení stromu kapitola → otázky ze zdrojových dat.
 *
 * Názvy kapitol se přebírají výhradně z načtených dat, nikde nejsou napevno.
 * Modul je čistá logika bez vazby na DOM.
 */
window.NV194NavTree = (function () {
	'use strict';

	var WITHOUT_CHAPTER_TITLE = 'Bez kapitoly';

	/**
	 * @param {Array} questions otázky v datovém modelu parseru
	 * @param {Array} chapters kapitoly z parseru (kvůli zachování pořadí a názvů)
	 * @returns {Array<{index: number|null, title: string, line: number|null, questions: Array}>}
	 */
	function build(questions, chapters) {
		var nodes = [];
		var byIndex = {};

		(chapters || []).forEach(function (chapter) {
			var node = {
				index: chapter.index,
				title: chapter.title,
				line: chapter.line,
				questions: []
			};
			byIndex[chapter.index] = node;
			nodes.push(node);
		});

		var withoutChapter = null;

		(questions || []).forEach(function (question) {
			var node = byIndex[question.chapterIndex];

			if (!node) {
				// Otázka bez kapitoly se nesmí ze stromu ztratit.
				if (!withoutChapter) {
					withoutChapter = {
						index: null,
						title: WITHOUT_CHAPTER_TITLE,
						line: null,
						questions: []
					};
					nodes.push(withoutChapter);
				}
				node = withoutChapter;
			}

			node.questions.push(question);
		});

		return nodes.filter(function (node) {
			return node.questions.length > 0;
		});
	}

	return {
		WITHOUT_CHAPTER_TITLE: WITHOUT_CHAPTER_TITLE,
		build: build
	};
})();
