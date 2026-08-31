/**
 * Automatické testy závěrečného shrnutí testu (js/nv194-quiz.js).
 *
 * Testy si sestaví zdrojová data v podobě, kterou čte parser, takže pracují se
 * stejným datovým modelem jako aplikace. Ověřují především rozdíl mezi
 * "chybnými otázkami" a "chybami" a neměnnost dokončeného výsledku.
 */
window.NV194ResultTests = (function () {
	'use strict';

	var parser = window.NV194Parser;
	var Quiz = window.NV194Quiz;

	/** Vytvoří zdrojový text s daným počtem otázek, kde je vždy správně a). */
	function buildSource(count) {
		var lines = ['# Kapitola', ''];
		for (var i = 1; i <= count; i++) {
			lines.push(i + '. Otázka ' + i);
			lines.push('a) první');
			lines.push('b) druhá');
			lines.push('c) třetí');
			lines.push('správně: [a]');
			lines.push('');
		}
		return lines.join('\n');
	}

	function questionsOf(count) {
		var result = parser.parseNV194(buildSource(count));
		if (result.errors.length > 0) {
			throw new Error('Testovací data nejsou platná: ' + result.errors[0].message);
		}
		return result.questions;
	}

	/** Projde test a u každé otázky zvolí odpovědi podle předané funkce. */
	function playThrough(test, choose) {
		for (var at = 0; at < test.total; at++) {
			choose(at).forEach(function (letter) {
				test.toggleAt(at, letter);
			});
			test.confirmAt(at);
		}
		return test.finish();
	}

	/** Příklad ze zadání: 40 otázek, 5 chybných otázek, 8 chyb. */
	function exampleScenario(runner) {
		var test = Quiz.createTest(questionsOf(40), Quiz.MODES.ALL);

		// 2 otázky s jednou chybou (navíc zvolené b), 3 otázky se dvěma chybami (jen b).
		var jednaChyba = [0, 1];
		var dveChyby = [2, 3, 4];

		var result = playThrough(test, function (at) {
			if (jednaChyba.indexOf(at) !== -1) {
				return ['a', 'b'];
			}
			if (dveChyby.indexOf(at) !== -1) {
				return ['b'];
			}
			return ['a'];
		});

		runner.equal('příklad – počet otázek', result.total, 40);
		runner.equal('příklad – správně zodpovězených otázek', result.correctQuestions, 35);
		runner.equal('příklad – chybných otázek', result.wrongQuestions, 5);
		runner.equal('příklad – celkový počet chyb', result.errors, 8);
		runner.equal('příklad – úspěšnost', result.successRate, 87.5);
		runner.check('chyby a chybné otázky se liší', result.errors !== result.wrongQuestions,
			'obě hodnoty vyšly stejně, rozlišení nefunguje');
	}

	/** Jedna otázka může přispět více chybami. */
	function errorsVersusQuestions(runner) {
		var test = Quiz.createTest(questionsOf(3), Quiz.MODES.ALL);
		// Jediná chybná otázka: zvoleno b i c, správně je a -> 3 chyby.
		var result = playThrough(test, function (at) {
			return at === 0 ? ['b', 'c'] : ['a'];
		});

		runner.equal('jedna chybná otázka', result.wrongQuestions, 1);
		runner.equal('tři chyby v jediné otázce', result.errors, 3);
		runner.equal('správně zodpovězené otázky', result.correctQuestions, 2);
		runner.equal('detail otázky nese počet chyb', result.questions[0].errors, 3);
		runner.equal('detail otázky nese příznak správnosti', result.questions[0].isCorrect, false);
	}

	function edgeCases(runner) {
		var vse = playThrough(Quiz.createTest(questionsOf(5), Quiz.MODES.ALL), function () { return ['a']; });
		runner.equal('vše správně – chybné otázky', vse.wrongQuestions, 0);
		runner.equal('vše správně – chyby', vse.errors, 0);
		runner.equal('vše správně – úspěšnost', vse.successRate, 100);

		var nic = playThrough(Quiz.createTest(questionsOf(4), Quiz.MODES.ALL), function () { return ['b']; });
		runner.equal('vše špatně – chybné otázky', nic.wrongQuestions, 4);
		runner.equal('vše špatně – chyby', nic.errors, 8);
		runner.equal('vše špatně – úspěšnost', nic.successRate, 0);

		var nedokoncene = Quiz.createTest(questionsOf(4), Quiz.MODES.ALL);
		nedokoncene.toggleAt(0, 'a');
		nedokoncene.confirmAt(0);
		var castecne = nedokoncene.finish();
		runner.equal('nezodpovězené otázky se počítají zvlášť', castecne.unanswered, 3);
		runner.equal('nezodpovězené se nezapočítají mezi chybné', castecne.wrongQuestions, 0);
		runner.equal('úspěšnost počítá ze všech otázek', castecne.successRate, 25);
		runner.equal('detail nezodpovězené otázky', castecne.questions[1].answered, false);

		runner.equal('výsledek před dokončením neexistuje',
			Quiz.createTest(questionsOf(2), Quiz.MODES.ALL).result(), null);
	}

	/** Dokončený test se už nesmí změnit. */
	function immutability(runner) {
		var test = Quiz.createTest(questionsOf(4), Quiz.MODES.ALL);
		var result = playThrough(test, function (at) { return at === 0 ? ['b'] : ['a']; });

		runner.equal('test je označen jako dokončený', test.isFinished(), true);
		runner.equal('opakované dokončení vrací stejný souhrn', test.finish() === result, true);
		runner.equal('result() vrací tentýž souhrn', test.result() === result, true);

		runner.equal('po dokončení nelze měnit výběr', test.toggleAt(1, 'b'), false);
		runner.equal('po dokončení nelze znovu potvrdit', test.confirmAt(1), false);
		runner.equal('po dokončení nelze potvrzovat', test.canConfirmAt(1), false);
		runner.equal('po dokončení nelze posunout test', test.next(), false);

		runner.equal('souhrn je zmrazen', Object.isFrozen(result), true);
		runner.equal('seznam otázek je zmrazen', Object.isFrozen(result.questions), true);
		runner.equal('detail otázky je zmrazen', Object.isFrozen(result.questions[0]), true);

		var predPokusem = JSON.stringify(result);
		try { result.errors = 999; } catch (ignored) { /* ve strict módu vyhodí výjimku */ }
		try { result.questions.push({}); } catch (ignored) { /* zmrazené pole */ }
		try { result.questions[0].isCorrect = true; } catch (ignored) { /* zmrazený objekt */ }
		runner.equal('pokus o změnu souhrn neovlivní', JSON.stringify(result), predPokusem);

		// ani pokus o odpověď po dokončení nesmí souhrn změnit
		test.toggleAt(2, 'c');
		test.confirmAt(2);
		runner.equal('odpovědi po dokončení souhrn nemění', JSON.stringify(test.result()), predPokusem);
	}

	function run() {
		var runner = window.NV194TestRunner.create();
		exampleScenario(runner);
		errorsVersusQuestions(runner);
		edgeCases(runner);
		immutability(runner);
		return window.NV194TestRunner.summarize(runner.results);
	}

	return { run: run };
})();
