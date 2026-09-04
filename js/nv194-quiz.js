/**
 * Výběr otázek a stav testu NV194.
 *
 * Vrstva je záměrně bez jakékoli vazby na DOM i na parser - pracuje pouze
 * s polem otázek v datovém modelu, který vrací js/nv194-parser.js.
 */
window.NV194Quiz = (function () {
	'use strict';

	var MODES = {
		PARAGRAPH_6: 'paragraph6',
		PARAGRAPH_7: 'paragraph7',
		ALL: 'all',
		CHAPTERS: 'chapters',
		/* DOČASNÉ: zkušební režim pro rychlé ověření celého průchodu testem. */
		DEMO_3: 'demo3'
	};

	var PARAGRAPH_6_SIZE = 40;
	var PARAGRAPH_7_SIZE = 60;

	/* DOČASNÉ: velikost zkušebního režimu. */
	var DEMO_MODE_SIZE = 3;

	var MODE_LABELS = {
		paragraph6: 'Test na §6',
		paragraph7: 'Test na §7',
		all: 'Všechny otázky postupně',
		chapters: 'Test z vybraných kapitol',
		/* DOČASNÉ */
		demo3: 'Zkušební test (3 otázky)'
	};

	/* Fisher-Yates, pracuje nad kopií vstupu. */
	function shuffle(items, random) {
		var result = items.slice();
		var rnd = random || Math.random;
		for (var i = result.length - 1; i > 0; i--) {
			var j = Math.floor(rnd() * (i + 1));
			var swap = result[i];
			result[i] = result[j];
			result[j] = swap;
		}
		return result;
	}

	/**
	 * DOČASNÉ: výběr tří otázek pro rychlé vyzkoušení celého průchodu testem.
	 *
	 * Vybere jednu otázku s jednou správnou odpovědí, jednu s více správnými
	 * odpověďmi a jednu s obrázkem, aby byly pokryté všechny varianty zobrazení
	 * i vyhodnocení. Celá funkce půjde odstranit spolu s režimem DEMO_3.
	 */
	function selectDemoQuestions(questions, random) {
		var pool = shuffle(questions, random);
		var chosen = [];

		function take(predicate) {
			for (var i = 0; i < pool.length; i++) {
				if (chosen.indexOf(pool[i]) === -1 && predicate(pool[i])) {
					chosen.push(pool[i]);
					return;
				}
			}
		}

		take(function (question) { return question.correctCount === 1 && !question.hasImages; });
		take(function (question) { return question.correctCount > 1 && !question.hasImages; });
		take(function (question) { return question.hasImages; });

		// Doplnění, pokud by některá varianta ve zdrojových datech chyběla.
		for (var i = 0; i < pool.length && chosen.length < DEMO_MODE_SIZE; i++) {
			if (chosen.indexOf(pool[i]) === -1) {
				chosen.push(pool[i]);
			}
		}

		return chosen.slice(0, DEMO_MODE_SIZE);
	}

	/**
	 * Sestaví seznam otázek pro daný režim.
	 *
	 * @param {Array} questions všechny načtené otázky
	 * @param {string} mode hodnota z MODES
	 * @param {{size?: number, random?: function}} [options]
	 * @returns {Array}
	 */
	function selectQuestions(questions, mode, options) {
		options = options || {};

		if (mode === MODES.PARAGRAPH_6 || mode === MODES.PARAGRAPH_7) {
			var defaultSize = mode === MODES.PARAGRAPH_6 ? PARAGRAPH_6_SIZE : PARAGRAPH_7_SIZE;
			var size = options.size || defaultSize;
			return shuffle(questions, options.random).slice(0, size);
		}

		if (mode === MODES.ALL) {
			return questions.slice();
		}

		if (mode === MODES.CHAPTERS) {
			var chapterIndexes = options.chapterIndexes;
			if (!chapterIndexes || chapterIndexes.length === 0) {
				throw new Error('Nebyla vybrána žádná kapitola.');
			}
			var wanted = {};
			chapterIndexes.forEach(function (chapterIndex) {
				wanted[chapterIndex] = true;
			});
			/* Zachovává pořadí ze zdroje - otázky jsou už seřazené podle kapitol. */
			return questions.filter(function (question) {
				return wanted[question.chapterIndex] === true;
			});
		}

		/* DOČASNÉ */
		if (mode === MODES.DEMO_3) {
			return selectDemoQuestions(questions, options.random);
		}

		throw new Error('Neznámý režim testu: ' + mode);
	}

	/* Vyhodnocení a chování záznamu odpovědi jsou v samostatných modulech. */
	var answerState = window.NV194AnswerState;

	/** Zmrazí výsledek testu včetně vnořených objektů, aby se už nedal změnit. */
	function deepFreeze(value) {
		if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
			return value;
		}
		Object.getOwnPropertyNames(value).forEach(function (key) {
			deepFreeze(value[key]);
		});
		return Object.freeze(value);
	}

	/**
	 * Vytvoří nový stav testu nad vybranými otázkami.
	 *
	 * @param {Array} questions všechny načtené otázky
	 * @param {string} mode hodnota z MODES
	 * @param {{size?: number, random?: function}} [options]
	 */
	function createTest(questions, mode, options) {
		var selected = selectQuestions(questions, mode, options);
		if (selected.length === 0) {
			throw new Error('Test neobsahuje žádné otázky.');
		}

		var records = selected.map(function () {
			return answerState.createRecord();
		});

		/* Umožňuje najít otázku testu podle jejího čísla bez posunu ukazatele. */
		var indexById = {};
		selected.forEach(function (question, at) {
			if (indexById[question.id] === undefined) {
				indexById[question.id] = at;
			}
		});

		var index = 0;
		var finished = false;
		var result = null;

		function requireIndex(at) {
			if (typeof at !== 'number' || at < 0 || at >= selected.length) {
				throw new Error('Otázka testu s indexem ' + at + ' neexistuje.');
			}
			return at;
		}

		/**
		 * Sestaví neměnný souhrn dokončeného testu.
		 *
		 * Rozlišuje "chybné otázky" (otázka s alespoň jednou chybou) a "chyby"
		 * (součet jednotlivých chyb podle pravidel vyhodnocování).
		 */
		function buildResult() {
			var detail = selected.map(function (question, at) {
				var record = records[at];
				var evaluation = record.evaluation;
				return {
					position: at + 1,
					id: question.id,
					chapter: question.chapter,
					answered: record.confirmed,
					selected: record.selected.slice(),
					correctAnswers: question.correctAnswers.slice(),
					isCorrect: Boolean(evaluation && evaluation.isCorrect),
					errors: evaluation ? evaluation.errors : null
				};
			});

			var answered = detail.filter(function (item) { return item.answered; });
			var correctQuestions = answered.filter(function (item) { return item.isCorrect; }).length;
			var errors = answered.reduce(function (sum, item) { return sum + item.errors; }, 0);
			var successRate = selected.length === 0
				? 0
				: Math.round((correctQuestions / selected.length) * 1000) / 10;

			return deepFreeze({
				mode: mode,
				modeLabel: MODE_LABELS[mode] || mode,
				total: selected.length,
				answered: answered.length,
				unanswered: selected.length - answered.length,
				correctQuestions: correctQuestions,
				wrongQuestions: answered.length - correctQuestions,
				errors: errors,
				successRate: successRate,
				questions: detail
			});
		}

		return {
			mode: mode,
			modeLabel: MODE_LABELS[mode] || mode,
			total: selected.length,

			/** Pořadí aktuální otázky v testu (od 1). */
			position: function () {
				return index + 1;
			},

			/** Index aktuální otázky testu (od 0). */
			currentIndex: function () {
				return index;
			},

			current: function () {
				return selected[index];
			},

			/** Vrátí index otázky v testu, nebo -1 pokud v testu není. */
			indexOf: function (questionId) {
				var at = indexById[questionId];
				return at === undefined ? -1 : at;
			},

			questionAt: function (at) {
				return selected[requireIndex(at)];
			},

			/* --- Práce s konkrétní otázkou testu; nemění pořadí ani ukazatel. --- */

			stateAt: function (at) {
				return answerState.snapshot(records[requireIndex(at)]);
			},

			toggleAt: function (at, letter) {
				if (finished) {
					return false;
				}
				return answerState.toggle(records[requireIndex(at)], letter);
			},

			canConfirmAt: function (at) {
				return !finished && answerState.canConfirm(records[requireIndex(at)]);
			},

			confirmAt: function (at) {
				if (finished) {
					return false;
				}
				return answerState.confirm(records[requireIndex(at)], selected[at]);
			},

			isConfirmedAt: function (at) {
				return records[requireIndex(at)].confirmed;
			},

			/* --- Zkratky pro aktuální otázku testu. --- */

			state: function () {
				return this.stateAt(index);
			},

			toggle: function (letter) {
				return this.toggleAt(index, letter);
			},

			canConfirm: function () {
				return this.canConfirmAt(index);
			},

			confirm: function () {
				return this.confirmAt(index);
			},

			isConfirmed: function () {
				return this.isConfirmedAt(index);
			},

			isLast: function () {
				return index === selected.length - 1;
			},

			/** Posune test na další otázku. Vrací false na konci testu. */
			next: function () {
				if (finished || index >= selected.length - 1) {
					return false;
				}
				index++;
				return true;
			},

			/**
			 * Uzavře test a vytvoří neměnný souhrn výsledků.
			 * Opakované volání vrací stále tentýž souhrn.
			 */
			finish: function () {
				if (!finished) {
					result = buildResult();
					finished = true;
				}
				return result;
			},

			isFinished: function () {
				return finished;
			},

			/** Souhrn dokončeného testu, nebo null pokud test ještě běží. */
			result: function () {
				return result;
			},

			score: function () {
				var confirmed = 0;
				var correct = 0;
				var errors = 0;
				records.forEach(function (item) {
					if (item.confirmed) {
						confirmed++;
						errors += item.evaluation.errors;
						if (item.evaluation.isCorrect) {
							correct++;
						}
					}
				});
				return { correct: correct, confirmed: confirmed, errors: errors, total: selected.length };
			}
		};
	}

	return {
		MODES: MODES,
		MODE_LABELS: MODE_LABELS,
		PARAGRAPH_6_SIZE: PARAGRAPH_6_SIZE,
		PARAGRAPH_7_SIZE: PARAGRAPH_7_SIZE,
		DEMO_MODE_SIZE: DEMO_MODE_SIZE,
		selectQuestions: selectQuestions,
		createTest: createTest
	};
})();
