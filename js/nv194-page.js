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
	var i18n = window.I18n;

	// Statická část stránky (nadpisy, tlačítka, resetovací dialog) je v HTML
	// až za skriptem js/i18n.js, takže při načtení stránky ještě nemusela
	// dostat překlad - jakmile existuje v DOM, doplní ho zde.
	i18n.applyStatic();

	var CONTEXT = { NONE: 'none', TEST: 'test', BROWSE: 'browse' };
	var DEMO_MODE = 'demo3';

	var statusEl = document.getElementById('quiz-status');
	var layoutEl = document.getElementById('quiz-layout');
	var navHost = document.getElementById('quiz-nav-host');
	var navToggle = document.getElementById('quiz-nav-toggle');
	var navExpandBtn = document.getElementById('quiz-nav-expand');
	var navCollapseBtn = document.getElementById('quiz-nav-collapse');

	var startPanel = document.getElementById('quiz-start');
	var runPanel = document.getElementById('quiz-run');
	var donePanel = document.getElementById('quiz-done');

	var questionHost = document.getElementById('quiz-question-host');
	var positionEl = document.getElementById('quiz-position');
	var scoreEl = document.getElementById('quiz-score');
	var contextNoteEl = document.getElementById('quiz-context-note');

	var questionActionBtn = document.getElementById('quiz-question-action');
	var resetTestBtn = document.getElementById('quiz-reset-test');
	var resetModal = document.getElementById('quiz-reset-modal');
	var resetConfirmBtn = document.getElementById('quiz-reset-confirm');
	var resetCancelBtns = document.querySelectorAll('[data-quiz-reset-cancel]');
	var backToTestBtn = document.getElementById('quiz-back-to-test');
	var modesBtn = document.getElementById('quiz-modes');

	var doneSummaryHost = document.getElementById('quiz-result-host');
	var newTestBtn = document.getElementById('quiz-new-test');
	var demoModeBtn = document.querySelector('[data-mode="' + DEMO_MODE + '"]');

	var answerState = window.NV194AnswerState;

	function canUseDemoMode() {
		return window.SiteAuth && window.SiteAuth.role() === window.SiteAuth.ROLES.FULL;
	}

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
			? i18n.t('nv194.progress.test', { position: test.position(), total: test.total, id: slot.question.id })
			: i18n.t('nv194.progress.browse', { id: slot.question.id });

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
			? i18n.t('nv194.contextNote.finished', { position: slot.testIndex + 1, total: test.total })
			: i18n.t('nv194.contextNote.inProgress', { position: slot.testIndex + 1, total: test.total });
	}

	function updateActions() {
		var slot = activeSlot();
		if (!slot) {
			return;
		}

		if (test) {
			var score = test.score();
			scoreEl.hidden = false;
			scoreEl.textContent = i18n.t('nv194.progress.score', {
				correct: score.correct,
				confirmed: score.confirmed,
				errors: score.errors
			});
		} else {
			scoreEl.hidden = true;
			scoreEl.textContent = '';
		}

		var inTest = context.kind === CONTEXT.TEST;
		var canMoveToNext = inTest && test.isConfirmed();
		questionActionBtn.disabled = canMoveToNext ? false : !slot.canConfirm();
		if (canMoveToNext) {
			questionActionBtn.textContent = test.isLast() ? i18n.t('nv194.action.finish') : i18n.t('nv194.action.next');
		} else {
			questionActionBtn.textContent = i18n.t('nv194.action.confirm');
		}

		backToTestBtn.hidden = inTest || !test;
		if (!backToTestBtn.hidden) {
			backToTestBtn.textContent = test.isFinished()
				? i18n.t('nv194.action.backToTestResult')
				: i18n.t('nv194.action.backToTestQuestion');
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

	function resetTest() {
		test = null;
		setStatus('');
		showModeSelection();
	}

	function closeResetModal() {
		resetModal.hidden = true;
		resetTestBtn.focus();
	}

	function openResetModal() {
		resetModal.hidden = false;
		resetConfirmBtn.focus();
	}

	var NARROW_SCREEN = '(max-width: 900px)';

	function isNarrowScreen() {
		return window.matchMedia(NARROW_SCREEN).matches;
	}

	/** Přepne postranní panel. Na úzké obrazovce se panel překrývá s obsahem. */
	function setNavOpen(open) {
		layoutEl.classList.toggle('is-nav-open', open);
		navToggle.setAttribute('aria-expanded', String(open));
	}

	function closeSidebarOnNarrowScreen() {
		if (isNarrowScreen()) {
			setNavOpen(false);
		}
	}

	questionActionBtn.addEventListener('click', function () {
		if (context.kind === CONTEXT.TEST && test.isConfirmed()) {
			if (test.next()) {
				renderActive();
			} else {
				finishTest();
			}
			return;
		}

		var slot = activeSlot();
		if (slot && slot.confirm()) {
			renderActive();
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
		resetTest();
	});

	resetTestBtn.addEventListener('click', function () {
		if (test && !test.isFinished()) {
			openResetModal();
			return;
		}
		resetTest();
	});

	resetConfirmBtn.addEventListener('click', function () {
		resetModal.hidden = true;
		resetTest();
	});

	resetCancelBtns.forEach(function (button) {
		button.addEventListener('click', closeResetModal);
	});

	document.addEventListener('keydown', function (event) {
		if (event.key === 'Escape' && !resetModal.hidden) {
			closeResetModal();
		}
	});

	startPanel.addEventListener('click', function (event) {
		var button = event.target.closest('[data-mode]');
		if (!button) {
			return;
		}
		var mode = button.getAttribute('data-mode');
		if (mode === DEMO_MODE && !canUseDemoMode()) {
			setStatus(i18n.t('nv194.mode.demo.restricted'), true);
			return;
		}
		try {
			test = window.NV194Quiz.createTest(questions, mode);
		} catch (error) {
			setStatus(error.message, true);
			return;
		}
		setStatus('');
		showTestQuestion();
	});

	navToggle.addEventListener('click', function () {
		setNavOpen(!layoutEl.classList.contains('is-nav-open'));
	});

	navExpandBtn.addEventListener('click', function () {
		navView.setAllChaptersOpen(true);
	});

	navCollapseBtn.addEventListener('click', function () {
		navView.setAllChaptersOpen(false);
	});

	/* --- Načtení dat --- */

	fetch(SOURCE_URL)
		.then(function (response) {
			if (!response.ok) {
				throw new Error(i18n.t('nv194.error.loadFailed', { status: response.status }));
			}
			return response.text();
		})
		.then(function (source) {
			var result = window.NV194Parser.parseNV194(source);
			questions = result.questions;

			if (questions.length === 0) {
				throw new Error(i18n.t('nv194.error.noQuestions'));
			}

			questions.forEach(function (question) {
				questionsById[question.id] = question;
			});

			navView.render(window.NV194NavTree.build(questions, result.chapters));
			demoModeBtn.hidden = !canUseDemoMode();
			layoutEl.hidden = false;
			setNavOpen(!isNarrowScreen());

			if (result.errors.length > 0) {
				// Data se načtou i s chybami, uživatel je ale musí vidět.
				setStatus(i18n.t('nv194.status.loadedWithErrors', {
					count: questions.length,
					errCount: result.errors.length
				}), true);
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

	document.addEventListener('site:langchange', function () {
		if (questions.length > 0) {
			navView.retranslate();
		}
		if (context.kind === CONTEXT.TEST || context.kind === CONTEXT.BROWSE) {
			renderActive();
		} else if (test && test.isFinished()) {
			resultView.render(test.result());
		}
	});
})();
