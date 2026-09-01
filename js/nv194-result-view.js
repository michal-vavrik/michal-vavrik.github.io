/**
 * Závěrečné shrnutí dokončeného testu.
 *
 * Komponenta pouze vykresluje neměnný souhrn, který jí předá stav testu.
 * Nezná parser ani logiku výběru otázek; o kliknutí na otázku informuje
 * přes callback onSelectQuestion.
 */
window.NV194ResultView = (function () {
	'use strict';

	function formatErrorCount(count, lang) {
		return window.NV194Evaluation.formatErrorCount(count, lang);
	}

	function element(tag, className) {
		var node = document.createElement(tag);
		if (className) {
			node.className = className;
		}
		return node;
	}

	/** Procenta v českém zápisu s desetinnou čárkou, jinde s tečkou. */
	function formatPercent(value, lang) {
		var text = lang === 'en' ? String(value) : String(value).replace('.', ',');
		return text + ' %';
	}

	function statRow(label, value, modifier) {
		var row = element('div', 'quiz-result__stat' + (modifier ? ' ' + modifier : ''));
		var name = element('dt', 'quiz-result__stat-label');
		name.textContent = label;
		var number = element('dd', 'quiz-result__stat-value');
		number.textContent = value;
		row.appendChild(name);
		row.appendChild(number);
		return row;
	}

	/**
	 * @param {{onSelectQuestion?: function(number): void}} [options]
	 */
	function create(options) {
		options = options || {};
		var onSelectQuestion = options.onSelectQuestion || function () {};
		var i18n = window.I18n;
		var lastResult = null;

		var root = element('div', 'quiz-result');

		var title = element('h2', 'quiz-result__title');
		title.textContent = i18n.t('nv194.summary.title');

		var stats = element('dl', 'quiz-result__stats');

		var detailsToggle = element('button', 'quiz-result__toggle');
		detailsToggle.type = 'button';
		detailsToggle.setAttribute('aria-expanded', 'false');

		var list = element('ol', 'quiz-result__questions');
		list.hidden = true;

		root.appendChild(title);
		root.appendChild(stats);
		root.appendChild(detailsToggle);
		root.appendChild(list);

		function updateToggle() {
			detailsToggle.textContent = list.hidden
				? i18n.t('nv194.summary.showDetails')
				: i18n.t('nv194.summary.hideDetails');
			detailsToggle.setAttribute('aria-expanded', String(!list.hidden));
		}

		detailsToggle.addEventListener('click', function () {
			list.hidden = !list.hidden;
			updateToggle();
		});

		function buildQuestionRow(item) {
			var row = element('li', 'quiz-result__question');

			var button = element('button', 'quiz-result__question-btn');
			button.type = 'button';
			button.dataset.questionId = String(item.id);
			button.title = i18n.t('nv194.summary.goToQuestion', { id: item.id });

			var position = element('span', 'quiz-result__position');
			position.textContent = item.position + '.';

			var number = element('span', 'quiz-result__number');
			number.textContent = i18n.t('nv194.summary.questionNumber', { id: item.id });

			var chapter = element('span', 'quiz-result__chapter');
			chapter.textContent = item.chapter || '';

			var status = element('span', 'quiz-result__status');
			if (!item.answered) {
				status.textContent = i18n.t('nv194.summary.unanswered');
				row.classList.add('is-unanswered');
			} else if (item.isCorrect) {
				status.textContent = i18n.t('nv194.summary.statusCorrect');
				row.classList.add('is-correct');
			} else {
				status.textContent = formatErrorCount(item.errors, i18n.getLang());
				row.classList.add('is-wrong');
			}

			button.appendChild(position);
			button.appendChild(number);
			button.appendChild(chapter);
			button.appendChild(status);
			button.addEventListener('click', function () {
				onSelectQuestion(item.id);
			});

			row.appendChild(button);
			return row;
		}

		return {
			element: root,

			/**
			 * @param {Object} result neměnný souhrn z stavu testu
			 */
			render: function (result) {
				var lang = i18n.getLang();
				var isSameResult = result === lastResult;
				var wasHidden = list.hidden;
				lastResult = result;

				title.textContent = i18n.t('nv194.summary.title');

				stats.textContent = '';
				stats.appendChild(statRow(i18n.t('nv194.summary.total'), result.total));
				stats.appendChild(statRow(i18n.t('nv194.summary.correctQuestions'), result.correctQuestions, 'is-correct'));
				stats.appendChild(statRow(i18n.t('nv194.summary.wrongQuestions'), result.wrongQuestions, 'is-wrong'));
				stats.appendChild(statRow(i18n.t('nv194.summary.errors'), result.errors, 'is-wrong'));
				if (result.unanswered > 0) {
					stats.appendChild(statRow(i18n.t('nv194.summary.unanswered'), result.unanswered));
				}
				stats.appendChild(statRow(i18n.t('nv194.summary.successRate'), formatPercent(result.successRate, lang), 'is-rate'));

				list.textContent = '';
				result.questions.forEach(function (item) {
					list.appendChild(buildQuestionRow(item));
				});

				// Při pouhé změně jazyka zůstane rozbalený seznam zachovaný.
				list.hidden = isSameResult ? wasHidden : true;
				updateToggle();
			}
		};
	}

	return { create: create };
})();
