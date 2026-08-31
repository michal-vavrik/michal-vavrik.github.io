/**
 * Minimální běhové prostředí pro automatické testy NV194.
 * Sdílí ho všechny testovací sady, aby se výsledky hlásily jednotně.
 */
window.NV194TestRunner = (function () {
	'use strict';

	function create() {
		var results = [];

		function check(name, condition, detail) {
			results.push({
				name: name,
				passed: Boolean(condition),
				detail: condition ? '' : (detail || '')
			});
		}

		function equal(name, actual, expected) {
			var actualText = JSON.stringify(actual);
			var expectedText = JSON.stringify(expected);
			check(name, actualText === expectedText,
				'očekáváno ' + expectedText + ', vráceno ' + actualText);
		}

		return { results: results, check: check, equal: equal };
	}

	/** Sloučí výsledky jedné sady do souhrnu. */
	function summarize(results) {
		var failed = results.filter(function (item) { return !item.passed; });
		return {
			total: results.length,
			passed: results.length - failed.length,
			failed: failed.length,
			failures: failed,
			results: results
		};
	}

	return { create: create, summarize: summarize };
})();
