/**
 * Automatické testy vyhodnocovací funkce NV194 (js/nv194-evaluation.js).
 *
 * Testy pokrývají pojmenované scénáře ze zadání a navíc vyčerpávající kombinace
 * všech neprázdných množin správných odpovědí (7) proti všem množinám vybraných
 * odpovědí (8), tedy 56 kombinací. Očekávaný počet chyb se počítá nezávisle
 * na implementaci jako velikost symetrického rozdílu obou množin.
 */
window.NV194EvaluationTests = (function () {
	'use strict';

	var STATUS = window.NV194Evaluation.STATUS;
	var evaluate = window.NV194Evaluation.evaluate;

	var LETTERS = ['a', 'b', 'c'];

	function subsets(items) {
		var result = [[]];
		items.forEach(function (item) {
			result = result.concat(result.map(function (subset) {
				return subset.concat([item]);
			}));
		});
		return result.sort(function (a, b) {
			return a.length - b.length || a.join('').localeCompare(b.join(''));
		});
	}

	function symmetricDifference(a, b) {
		var only = function (from, other) {
			return from.filter(function (item) { return other.indexOf(item) === -1; });
		};
		return only(a, b).concat(only(b, a));
	}

	function statusesOf(result) {
		var map = {};
		result.answers.forEach(function (answer) {
			map[answer.letter] = answer.status;
		});
		return map;
	}

	function createRunner() {
		return window.NV194TestRunner.create();
	}

	/** Pojmenované scénáře vyžadované zadáním. */
	function namedScenarios(runner) {
		var cases = [
			{
				name: 'jedna správná odpověď – zvolena správně',
				correct: ['a'], selected: ['a'], errors: 0,
				statuses: { a: STATUS.CORRECT_SELECTED, b: STATUS.NEUTRAL, c: STATUS.NEUTRAL }
			},
			{
				name: 'jedna správná odpověď – zvolena jiná (pouze špatně vybraná)',
				correct: ['a'], selected: ['b'], errors: 2,
				statuses: { a: STATUS.CORRECT_MISSED, b: STATUS.WRONG_SELECTED, c: STATUS.NEUTRAL }
			},
			{
				name: 'dvě správné odpovědi – obě zvoleny',
				correct: ['a', 'c'], selected: ['a', 'c'], errors: 0,
				statuses: { a: STATUS.CORRECT_SELECTED, b: STATUS.NEUTRAL, c: STATUS.CORRECT_SELECTED }
			},
			{
				name: 'dvě správné odpovědi – příklad ze zadání (správně A,C / voleno A,B)',
				correct: ['a', 'c'], selected: ['a', 'b'], errors: 2,
				statuses: { a: STATUS.CORRECT_SELECTED, b: STATUS.WRONG_SELECTED, c: STATUS.CORRECT_MISSED }
			},
			{
				name: 'tři správné odpovědi – všechny zvoleny',
				correct: ['a', 'b', 'c'], selected: ['a', 'b', 'c'], errors: 0,
				statuses: { a: STATUS.CORRECT_SELECTED, b: STATUS.CORRECT_SELECTED, c: STATUS.CORRECT_SELECTED }
			},
			{
				name: 'tři správné odpovědi – částečně správná volba',
				correct: ['a', 'b', 'c'], selected: ['b'], errors: 2,
				statuses: { a: STATUS.CORRECT_MISSED, b: STATUS.CORRECT_SELECTED, c: STATUS.CORRECT_MISSED }
			},
			{
				name: 'částečně správná volba u dvou správných odpovědí',
				correct: ['a', 'b'], selected: ['a'], errors: 1,
				statuses: { a: STATUS.CORRECT_SELECTED, b: STATUS.CORRECT_MISSED, c: STATUS.NEUTRAL }
			},
			{
				name: 'žádná vybraná odpověď – jedna správná',
				correct: ['b'], selected: [], errors: 1,
				statuses: { a: STATUS.NEUTRAL, b: STATUS.CORRECT_MISSED, c: STATUS.NEUTRAL }
			},
			{
				name: 'žádná vybraná odpověď – tři správné',
				correct: ['a', 'b', 'c'], selected: [], errors: 3,
				statuses: { a: STATUS.CORRECT_MISSED, b: STATUS.CORRECT_MISSED, c: STATUS.CORRECT_MISSED }
			},
			{
				name: 'všechny vybrané odpovědi – jedna správná',
				correct: ['b'], selected: ['a', 'b', 'c'], errors: 2,
				statuses: { a: STATUS.WRONG_SELECTED, b: STATUS.CORRECT_SELECTED, c: STATUS.WRONG_SELECTED }
			},
			{
				name: 'všechny vybrané odpovědi – dvě správné',
				correct: ['a', 'c'], selected: ['a', 'b', 'c'], errors: 1,
				statuses: { a: STATUS.CORRECT_SELECTED, b: STATUS.WRONG_SELECTED, c: STATUS.CORRECT_SELECTED }
			},
			{
				name: 'pouze špatně vybraná odpověď – dvě správné nezvolené',
				correct: ['a', 'b'], selected: ['c'], errors: 3,
				statuses: { a: STATUS.CORRECT_MISSED, b: STATUS.CORRECT_MISSED, c: STATUS.WRONG_SELECTED }
			}
		];

		cases.forEach(function (testCase) {
			var result = evaluate(testCase.correct, testCase.selected);
			runner.equal(testCase.name + ' – počet chyb', result.errors, testCase.errors);
			runner.equal(testCase.name + ' – stavy odpovědí', statusesOf(result), testCase.statuses);
			runner.equal(testCase.name + ' – bezchybnost', result.isCorrect, testCase.errors === 0);
		});
	}

	/** Všechny kombinace správných a vybraných odpovědí nad a/b/c. */
	function exhaustiveCombinations(runner) {
		var allSubsets = subsets(LETTERS);
		var correctSets = allSubsets.filter(function (subset) { return subset.length > 0; });
		var combinations = 0;

		correctSets.forEach(function (correct) {
			allSubsets.forEach(function (selected) {
				combinations++;
				var label = 'kombinace správně [' + correct.join(',') + '] / voleno [' + selected.join(',') + ']';
				var result = evaluate(correct, selected);

				runner.equal(label + ' – počet chyb',
					result.errors, symmetricDifference(correct, selected).length);

				var expectedStatuses = {};
				LETTERS.forEach(function (letter) {
					var isCorrect = correct.indexOf(letter) !== -1;
					var isSelected = selected.indexOf(letter) !== -1;
					expectedStatuses[letter] = isCorrect
						? (isSelected ? STATUS.CORRECT_SELECTED : STATUS.CORRECT_MISSED)
						: (isSelected ? STATUS.WRONG_SELECTED : STATUS.NEUTRAL);
				});
				runner.equal(label + ' – stavy odpovědí', statusesOf(result), expectedStatuses);

				runner.equal(label + ' – součet dílčích chyb',
					result.wrongSelected.length + result.missedCorrect.length, result.errors);
			});
		});

		runner.equal('počet ověřených kombinací', combinations, 56);
	}

	/** Ošetření okrajových vstupů. */
	function edgeCases(runner) {
		var mixedCase = evaluate(['A', 'C'], ['a', 'B']);
		runner.equal('nezáleží na velikosti písmen – počet chyb', mixedCase.errors, 2);
		runner.equal('nezáleží na velikosti písmen – stavy', statusesOf(mixedCase), {
			a: STATUS.CORRECT_SELECTED, b: STATUS.WRONG_SELECTED, c: STATUS.CORRECT_MISSED
		});

		var duplicates = evaluate(['a', 'a'], ['b', 'b', 'b']);
		runner.equal('duplicity se nezapočítávají vícekrát', duplicates.errors, 2);

		var input = ['a', 'c'];
		var selectedInput = ['b'];
		evaluate(input, selectedInput);
		runner.equal('vstupní pole zůstane nezměněno (správné)', input, ['a', 'c']);
		runner.equal('vstupní pole zůstane nezměněno (vybrané)', selectedInput, ['b']);

		var customLetters = evaluate(['a'], ['d'], { letters: ['a', 'b', 'c'] });
		runner.equal('neznámé písmeno se nezahodí – počet chyb', customLetters.errors, 2);
		runner.equal('neznámé písmeno se nezahodí – je vyhodnoceno',
			customLetters.byLetter.d.status, STATUS.WRONG_SELECTED);

		var twoAnswers = evaluate(['a'], ['a'], { letters: ['a', 'b'] });
		runner.equal('respektuje vlastní seznam nabízených odpovědí',
			twoAnswers.answers.map(function (answer) { return answer.letter; }), ['a', 'b']);
	}

	function run() {
		var runner = createRunner();
		namedScenarios(runner);
		exhaustiveCombinations(runner);
		edgeCases(runner);
		return window.NV194TestRunner.summarize(runner.results);
	}

	return { run: run };
})();
