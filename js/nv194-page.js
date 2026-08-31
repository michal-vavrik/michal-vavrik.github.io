/**
 * Propojení stránky NV194.
 *
 * Rozlišuje dva režimy zobrazení:
 *   - 'test'   … aktuální otázka rozpracovaného testu,
 *   - 'browse' … libovolná otázka otevřená z postranní navigace.
 *
 * Otevření otázky ze stromu nikdy nemění pořadí ani obsah testu - posouvá se
 * pouze to, co je zobrazeno. Pokud prohlížená otázka do testu patří, pracuje se
 * přímo s jejím záznamem v testu, takže se odpovědi ani vyhodnocení nezdvojují.
 */
(function () {
	'use strict';

	var SOURCE_URL = 'data/otazky.txt';
	var IMAGE_BASE = window.NV194Images.DEFAULT_BASE;

	var CONTEXT = { NONE: 'none', TEST: 'test', BROWSE: 'browse' };

	var statusEl = document.getElementById('quiz-status');
	var layoutEl = document.getElementById('quiz-layout');
	var sidebarEl = document.getElementById('quiz-sidebar');
	var navHost = document.getElementById('quiz-nav-host');
	var navToggle = document.getElementById('quiz-nav-toggle');

	var startPanel = document.getElementById('quiz-start');
	var runPanel = document.getElementById('quiz-run');
	var donePanel = document.getElementById('quiz-done');

	var questionHost = document.getElementById('quiz-question-host');
	var positionEl = document.getElementById('quiz-position');
	var scoreEl = document.getElementById('quiz-score');
	var contextNoteEl = document.getElementById('quiz-context-note');

	var confirmBtn = document.getElementById('quiz-confirm');
	var nextBtn = document.getElementById('quiz-next');
	var backToTestBtn = document.getElementById('quiz-back-to-test');
	var modesBtn = document.getElementById('quiz-modes');

	var doneSummaryHost = document.getElementById('quiz-result-host');
	var newTestBtn = document.getElementById('quiz-new-test');

	var answerState = window.NV194AnswerState;

	var questions = [];
	var questionsById = {};
	var browseStore = answerState.createStore();

	var test = null;
	var context = { kind: CONTEXT.NONE, questionId: null };

	var questionView = window.NV194QuestionView.create({
		imageBase: IMAGE_BASE,
		onToggle: function (letter) {
			var slot = activeSlot();
			if (!slot) {
				return;
			}
			slot.toggle(letter);
			updateActions();
			refreshNav();
		}
	});
	questionHost.appendChild(questionView.element);

	var navView = window.NV194NavView.create({ onSelect: openQuestion });
	navHost.appendChild(navView.element);

	var resultView = window.NV194ResultView.create({ onSelectQuestion: openQuestion });
	doneSummaryHost.appendChild(resultView.element);

	/* --- Stav zobrazené otázky --- */

	function activeQuestion() {
		if (context.kind === CONTEXT.TEST && test) {
			return test.current();
		}
		if (context.kind === CONTEXT.BROWSE) {
			return questionsById[context.questionId] || null;
		}
		return null;
	}

	/**
	 * Vrátí obsluhu odpovědí pro právě zobrazenou otázku.
	 * Otázka patřící do testu se vždy obsluhuje přes záznam testu.
	 */
	function activeSlot() {
		var question = activeQuestion();
		if (!question) {
			return null;
		}

		if (test) {
			var at = test.indexOf(question.id);
			if (at !== -1) {
				return {
					question: question,
					testIndex: at,
					state: function () { return test.stateAt(at); },
					toggle: function (letter) { return test.toggleAt(at, letter); },
					canConfirm: function () { return test.canConfirmAt(at); },
					confirm: function () { return test.confirmAt(at); }
				};
			}
		}

		var record = browseStore.record(question.id);
		return {
			question: question,
			testIndex: -1,
			state: function () { return answerState.snapshot(record); },
			toggle: function (letter) { return answerState.toggle(record, letter); },
			canConfirm: function () { return answerState.canConfirm(record); },
			confirm: function () { return answerState.confirm(record, question); }
		};
	}

	/** Stav libovolné otázky pro zvýraznění ve stromu. */
	function stateOf(questionId) {
		if (test) {
			var at = test.indexOf(questionId);
			if (at !== -1) {
				return test.stateAt(at);
			}
		}
		var record = browseStore.peek(questionId);
		return record ? answerState.snapshot(record) : null;
	}

	function statusOf(questionId) {
		var state = stateOf(questionId);
		if (!state) {
			return null;
		}
		if (!state.confirmed) {
			return state.selected.length > 0 ? 'open' : null;
		}
		return state.evaluation && state.evaluation.isCorrect ? 'correct' : 'wrong';
	}

	/* --- Vykreslení --- */

	function showPanel(panel) {
		[startPanel, runPanel, donePanel].forEach(function (item) {
			item.hidden = item !== panel;
		});
	}

	function setStatus(message, isError) {
		statusEl.textContent = message || '';
		statusEl.hidden = !message;
		statusEl.classList.toggle('is-error', Boolean(isError));
	}

	function refreshNav() {
		var question = activeQuestion();
		navView.refresh(question ? question.id : null, statusOf);
	}

	function renderActive() {
		var slot = activeSlot();
		if (!slot) {
			return;
		}

		positionEl.textContent = context.kind === CONTEXT.TEST
			? 'Otázka ' + test.position() + ' z ' + test.total + ' (č. ' + slot.question.id + ')'
			: 'Prohlížení – otázka č. ' + slot.question.id;

		renderContextNote(slot);
		questionView.render(slot.question, slot.state());
		updateActions();
		refreshNav();
		navView.reveal(slot.question.id);
	}

	function renderContextNote(slot) {
		if (context.kind !== CONTEXT.BROWSE || !test || slot.testIndex === -1) {
			contextNoteEl.hidden = true;
			contextNoteEl.textContent = '';
			return;
		}
		contextNoteEl.hidden = false;
		contextNoteEl.textContent = test.isFinished()
			? 'Tato otázka je součástí dokončeného testu (' + (slot.testIndex + 1) + '. z ' +
				test.total + '). Výsledek už nelze změnit.'
			: 'Tato otázka je součástí testu (' + (slot.testIndex + 1) + '. z ' +
				test.total + '). Odpovědi se ukládají do testu.';
	}

	function updateActions() {
		var slot = activeSlot();
		if (!slot) {
			return;
		}

		if (test) {
			var score = test.score();
			scoreEl.hidden = false;
			scoreEl.textContent = 'Správně ' + score.correct + ' z ' + score.confirmed +
				' zodpovězených · chyb ' + score.errors;
		} else {
			scoreEl.hidden = true;
			scoreEl.textContent = '';
		}

		confirmBtn.disabled = !slot.canConfirm();

		var inTest = context.kind === CONTEXT.TEST;
		nextBtn.hidden = !inTest;
		if (inTest) {
			nextBtn.disabled = !test.isConfirmed();
			nextBtn.textContent = test.isLast() ? 'Dokončit' : 'Další';
		}

		backToTestBtn.hidden = inTest || !test;
		if (!backToTestBtn.hidden) {
			backToTestBtn.textContent = test.isFinished()
				? 'Zpět na výsledek testu'
				: 'Zpět na otázku testu';
		}

		modesBtn.hidden = inTest || Boolean(test);
	}

	/* --- Ovládání --- */

	function openQuestion(questionId) {
		if (!questionsById[questionId]) {
			return;
		}
		context = { kind: CONTEXT.BROWSE, questionId: questionId };
		showPanel(runPanel);
		renderActive();
		closeSidebarOnNarrowScreen();
	}

	function showTestQuestion() {
		context = { kind: CONTEXT.TEST, questionId: null };
		showPanel(runPanel);
		renderActive();
	}

	function finishTest() {
		resultView.render(test.finish());
		showDonePanel();
	}

	function showDonePanel() {
		context = { kind: CONTEXT.NONE, questionId: null };
		showPanel(donePanel);
		refreshNav();
	}

	function showModeSelection() {
		context = { kind: CONTEXT.NONE, questionId: null };
		showPanel(startPanel);
		refreshNav();
	}

	function closeSidebarOnNarrowScreen() {
		if (window.matchMedia('(max-width: 900px)').matches) {
			sidebarEl.classList.remove('is-open');
			navToggle.setAttribute('aria-expanded', 'false');
		}
	}

	confirmBtn.addEventListener('click', function () {
		var slot = activeSlot();
		if (slot && slot.confirm()) {
			renderActive();
		}
	});

	nextBtn.addEventListener('click', function () {
		if (context.kind !== CONTEXT.TEST) {
			return;
		}
		if (test.next()) {
			renderActive();
		} else {
			finishTest();
		}
	});

	backToTestBtn.addEventListener('click', function () {
		if (!test) {
			return;
		}
		if (test.isFinished()) {
			showDonePanel();
			return;
		}
		showTestQuestion();
	});

	modesBtn.addEventListener('click', showModeSelection);

	newTestBtn.addEventListener('click', function () {
		test = null;
		setStatus('');
		showModeSelection();
	});

	startPanel.addEventListener('click', function (event) {
		var button = event.target.closest('[data-mode]');
		if (!button) {
			return;
		}
		try {
			test = window.NV194Quiz.createTest(questions, button.getAttribute('data-mode'));
		} catch (error) {
			setStatus(error.message, true);
			return;
		}
		setStatus('');
		showTestQuestion();
	});

	navToggle.addEventListener('click', function () {
		var open = sidebarEl.classList.toggle('is-open');
		navToggle.setAttribute('aria-expanded', String(open));
	});

	/* --- Načtení dat --- */

	fetch(SOURCE_URL)
		.then(function (response) {
			if (!response.ok) {
				throw new Error('Nepodařilo se načíst otázky (HTTP ' + response.status + ').');
			}
			return response.text();
		})
		.then(function (source) {
			var result = window.NV194Parser.parseNV194(source);
			questions = result.questions;

			if (questions.length === 0) {
				throw new Error('Zdrojový soubor neobsahuje žádné otázky.');
			}

			questions.forEach(function (question) {
				questionsById[question.id] = question;
			});

			navView.render(window.NV194NavTree.build(questions, result.chapters));
			layoutEl.hidden = false;

			if (result.errors.length > 0) {
				// Data se načtou i s chybami, uživatel je ale musí vidět.
				setStatus('Načteno ' + questions.length + ' otázek, ' + result.errors.length +
					' záznamů obsahuje chybu ve zdrojových datech.', true);
				result.errors.forEach(function (error) {
					console.warn('[NV194] ' + error.code + ' (otázka ' + error.questionId +
						', řádek ' + error.line + '): ' + error.message);
				});
			} else {
				setStatus('');
			}

			showModeSelection();
		})
		.catch(function (error) {
			setStatus(error.message, true);
		});
})();
