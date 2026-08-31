/**
 * Závěrečné shrnutí dokončeného testu.
 *
 * Komponenta pouze vykresluje neměnný souhrn, který jí předá stav testu.
 * Nezná parser ani logiku výběru otázek; o kliknutí na otázku informuje
 * přes callback onSelectQuestion.
 */
window.NV194ResultView = (function () {
	'use strict';

	var formatErrorCount = window.NV194Evaluation.formatErrorCount;

	function element(tag, className) {
		var node = document.createElement(tag);
		if (className) {
			node.className = className;
		}
		return node;
	}

	/** Procenta v českém zápisu s desetinnou čárkou. */
	function formatPercent(value) {
		return String(value).replace('.', ',') + ' %';
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

		var root = element('div', 'quiz-result');

		var title = element('h2', 'quiz-result__title');
		title.textContent = 'Test dokončen';

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
				? 'Zobrazit výsledky jednotlivých otázek'
				: 'Skrýt výsledky jednotlivých otázek';
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
			button.title = 'Přejít na otázku č. ' + item.id;

			var position = element('span', 'quiz-result__position');
			position.textContent = item.position + '.';

			var number = element('span', 'quiz-result__number');
			number.textContent = 'č. ' + item.id;

			var chapter = element('span', 'quiz-result__chapter');
			chapter.textContent = item.chapter || '';

			var status = element('span', 'quiz-result__status');
			if (!item.answered) {
				status.textContent = 'Nezodpovězeno';
				row.classList.add('is-unanswered');
			} else if (item.isCorrect) {
				status.textContent = 'Správně';
				row.classList.add('is-correct');
			} else {
				status.textContent = formatErrorCount(item.errors);
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
				stats.textContent = '';
				stats.appendChild(statRow('Otázek celkem', result.total));
				stats.appendChild(statRow('Správně zodpovězeno', result.correctQuestions, 'is-correct'));
				stats.appendChild(statRow('Chybných otázek', result.wrongQuestions, 'is-wrong'));
				stats.appendChild(statRow('Chyb celkem', result.errors, 'is-wrong'));
				if (result.unanswered > 0) {
					stats.appendChild(statRow('Nezodpovězeno', result.unanswered));
				}
				stats.appendChild(statRow('Úspěšnost', formatPercent(result.successRate), 'is-rate'));

				list.textContent = '';
				result.questions.forEach(function (item) {
					list.appendChild(buildQuestionRow(item));
				});

				list.hidden = true;
				updateToggle();
			}
		};
	}

	return { create: create };
})();
