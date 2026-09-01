/**
 * Vyhodnocení odpovědí u jedné otázky NV194.
 *
 * Samostatná čistá funkce bez vazby na DOM, na parser i na stav testu.
 * Každá jednotlivá odchylka od správné množiny se počítá jako jedna chyba:
 *   - špatně zaškrtnutá odpověď      = 1 chyba,
 *   - správná odpověď bez zaškrtnutí = 1 chyba,
 *   - správně zaškrtnutá odpověď     = 0 chyb.
 */
window.NV194Evaluation = (function () {
	'use strict';

	var DEFAULT_LETTERS = ['a', 'b', 'c'];

	var STATUS = {
		/** Správná odpověď, kterou uživatel zaškrtl. */
		CORRECT_SELECTED: 'correct-selected',
		/** Správná odpověď, kterou uživatel nezaškrtl. */
		CORRECT_MISSED: 'correct-missed',
		/** Špatná odpověď, kterou uživatel zaškrtl. */
		WRONG_SELECTED: 'wrong-selected',
		/** Špatná odpověď, kterou uživatel nezaškrtl. */
		NEUTRAL: 'neutral'
	};

	/* Sjednotí zápis písmen a odstraní duplicity, aby vstup nešel obejít. */
	function normalize(letters) {
		var result = [];
		(letters || []).forEach(function (letter) {
			var value = String(letter).trim().toLowerCase();
			if (value !== '' && result.indexOf(value) === -1) {
				result.push(value);
			}
		});
		return result;
	}

	/* Seznam hodnocených odpovědí - žádné písmeno ze vstupu se nesmí ztratit. */
	function buildLetters(base, correct, selected) {
		var result = normalize(base);
		correct.concat(selected).forEach(function (letter) {
			if (result.indexOf(letter) === -1) {
				result.push(letter);
			}
		});
		return result;
	}

	function resolveStatus(isCorrect, isSelected) {
		if (isCorrect) {
			return isSelected ? STATUS.CORRECT_SELECTED : STATUS.CORRECT_MISSED;
		}
		return isSelected ? STATUS.WRONG_SELECTED : STATUS.NEUTRAL;
	}

	/**
	 * Porovná vybrané odpovědi se správnými.
	 *
	 * @param {string[]} correctAnswers správné odpovědi, např. ['a', 'c']
	 * @param {string[]} selectedAnswers odpovědi zvolené uživatelem
	 * @param {{letters?: string[]}} [options] seznam nabízených odpovědí (výchozí a/b/c)
	 * @returns {{
	 *   answers: Array<{letter: string, isCorrect: boolean, isSelected: boolean, status: string}>,
	 *   byLetter: Object,
	 *   errors: number,
	 *   correctSelected: string[],
	 *   missedCorrect: string[],
	 *   wrongSelected: string[],
	 *   isCorrect: boolean
	 * }}
	 */
	function evaluate(correctAnswers, selectedAnswers, options) {
		options = options || {};

		var correct = normalize(correctAnswers);
		var selected = normalize(selectedAnswers);
		var letters = buildLetters(options.letters || DEFAULT_LETTERS, correct, selected);

		var answers = letters.map(function (letter) {
			var isCorrect = correct.indexOf(letter) !== -1;
			var isSelected = selected.indexOf(letter) !== -1;
			return {
				letter: letter,
				isCorrect: isCorrect,
				isSelected: isSelected,
				status: resolveStatus(isCorrect, isSelected)
			};
		});

		var byLetter = {};
		var correctSelected = [];
		var missedCorrect = [];
		var wrongSelected = [];

		answers.forEach(function (answer) {
			byLetter[answer.letter] = answer;
			if (answer.status === STATUS.CORRECT_SELECTED) {
				correctSelected.push(answer.letter);
			} else if (answer.status === STATUS.CORRECT_MISSED) {
				missedCorrect.push(answer.letter);
			} else if (answer.status === STATUS.WRONG_SELECTED) {
				wrongSelected.push(answer.letter);
			}
		});

		var errors = wrongSelected.length + missedCorrect.length;

		return {
			answers: answers,
			byLetter: byLetter,
			errors: errors,
			correctSelected: correctSelected,
			missedCorrect: missedCorrect,
			wrongSelected: wrongSelected,
			isCorrect: errors === 0
		};
	}

	/** Skloňování počtu chyb - čeština má tři tvary, angličtina jen dva. */
	function formatErrorCount(count, lang) {
		if (lang === 'en') {
			return count + (count === 1 ? ' error' : ' errors');
		}
		if (count === 1) {
			return '1 chyba';
		}
		if (count >= 2 && count <= 4) {
			return count + ' chyby';
		}
		return count + ' chyb';
	}

	return {
		STATUS: STATUS,
		DEFAULT_LETTERS: DEFAULT_LETTERS,
		evaluate: evaluate,
		formatErrorCount: formatErrorCount
	};
})();
