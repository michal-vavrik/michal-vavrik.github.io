/**
 * Stav odpovědí u jedné otázky.
 *
 * Jednotná definice chování záznamu odpovědi, kterou sdílí rozpracovaný test
 * i režim prohlížení. Modul nezná DOM ani parser, vyhodnocení deleguje na
 * js/nv194-evaluation.js.
 */
window.NV194AnswerState = (function () {
	'use strict';

	var evaluation = window.NV194Evaluation;

	function createRecord() {
		return { selected: [], confirmed: false, evaluation: null };
	}

	/** Kopie stavu pro vykreslení - volající nemůže záznam omylem změnit. */
	function snapshot(record) {
		return {
			selected: record.selected.slice(),
			confirmed: record.confirmed,
			evaluation: record.evaluation
		};
	}

	/** Přepne označení odpovědi. Po potvrzení už výběr nelze měnit. */
	function toggle(record, letter) {
		if (record.confirmed) {
			return false;
		}
		var at = record.selected.indexOf(letter);
		if (at === -1) {
			record.selected.push(letter);
		} else {
			record.selected.splice(at, 1);
		}
		return true;
	}

	function canConfirm(record) {
		return !record.confirmed && record.selected.length > 0;
	}

	function confirm(record, question) {
		if (!canConfirm(record)) {
			return false;
		}
		record.confirmed = true;
		record.evaluation = evaluation.evaluate(question.correctAnswers, record.selected, {
			letters: question.answers.map(function (answer) {
				return answer.letter;
			})
		});
		return true;
	}

	/**
	 * Úložiště odpovědí podle čísla otázky.
	 * Používá se pro prohlížení otázek, které nejsou součástí testu.
	 */
	function createStore() {
		var records = {};

		return {
			/** Vrátí záznam, případně ho založí. */
			record: function (questionId) {
				if (!records[questionId]) {
					records[questionId] = createRecord();
				}
				return records[questionId];
			},

			/** Vrátí záznam jen pokud už existuje, jinak null. */
			peek: function (questionId) {
				return records[questionId] || null;
			}
		};
	}

	return {
		createRecord: createRecord,
		snapshot: snapshot,
		toggle: toggle,
		canConfirm: canConfirm,
		confirm: confirm,
		createStore: createStore
	};
})();
