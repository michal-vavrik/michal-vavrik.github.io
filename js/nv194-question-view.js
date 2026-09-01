/**
 * Komponenta pro zobrazení jedné otázky NV194.
 *
 * Komponenta nezná parser ani logiku výběru otázek. Dostane otázku v datovém
 * modelu a stav odpovědí, o změnách informuje zpět přes callback onToggle.
 */
window.NV194QuestionView = (function () {
	'use strict';

	var LETTER_LABELS = { a: 'A', b: 'B', c: 'C' };

	function element(tag, className) {
		var node = document.createElement(tag);
		if (className) {
			node.className = className;
		}
		return node;
	}

	/** Náhrada za obrázek, který nelze zobrazit. Otázka zůstane čitelná. */
	function imageError(node, reason) {
		var box = element('span', 'quiz-question__image-error');
		box.textContent = '⚠ ' + reason + ': ' + (node.raw || node.src);
		box.title = reason;
		return box;
	}

	function renderImage(node, imageBase, imageAlt) {
		var i18n = window.I18n;
		var source = window.NV194Images.resolve(node.src, imageBase);

		if (source === null) {
			return imageError(node, i18n.t('nv194.image.invalidLink'));
		}

		var image = element('img', 'quiz-question__image');
		image.src = source;
		image.alt = imageAlt;
		image.loading = 'lazy';
		image.addEventListener('error', function () {
			// Chybějící soubor nesmí rozbít zbytek otázky - nahradí se hláškou.
			if (image.parentNode) {
				image.parentNode.replaceChild(imageError(node, i18n.t('nv194.image.loadFailed')), image);
			}
		});
		return image;
	}

	/**
	 * Vykreslí strukturovaný obsah (uzly text/image) do cílového elementu.
	 * Pořadí uzlů se zachovává, takže se text a obrázky mohou libovolně střídat.
	 */
	function renderContent(nodes, target, imageBase, imageAlt) {
		target.textContent = '';
		nodes.forEach(function (node) {
			if (node.type === 'image') {
				target.appendChild(renderImage(node, imageBase, imageAlt));
				return;
			}
			target.appendChild(document.createTextNode(node.value));
		});
	}

	/**
	 * @param {{imageBase?: string, onToggle?: function(string): void}} [options]
	 */
	function create(options) {
		options = options || {};
		var imageBase = options.imageBase || window.NV194Images.DEFAULT_BASE;
		var onToggle = options.onToggle || function () {};
		var i18n = window.I18n;

		var root = element('article', 'quiz-question');

		var chapter = element('p', 'quiz-question__chapter');
		var text = element('div', 'quiz-question__text');
		var answerList = element('ul', 'quiz-question__answers');
		var result = element('p', 'quiz-question__result');

		root.appendChild(chapter);
		root.appendChild(text);
		root.appendChild(answerList);
		root.appendChild(result);

		function buildAnswer(answer, state) {
			var item = element('li', 'quiz-answer');
			var label = element('label', 'quiz-answer__label');

			var checkbox = element('input', 'quiz-answer__checkbox');
			checkbox.type = 'checkbox';
			checkbox.value = answer.letter;
			checkbox.checked = state.selected.indexOf(answer.letter) !== -1;
			checkbox.disabled = state.confirmed;
			checkbox.addEventListener('change', function () {
				onToggle(answer.letter);
			});

			var letter = element('span', 'quiz-answer__letter');
			letter.textContent = LETTER_LABELS[answer.letter] || answer.letter;

			var body = element('span', 'quiz-answer__body');
			var content = element('span', 'quiz-answer__content');
			var badge = element('span', 'quiz-answer__badge quiz-answer__badge--placeholder');
			renderContent(answer.content, content, imageBase, i18n.t('nv194.answer.imageAlt', {
				letter: LETTER_LABELS[answer.letter] || answer.letter
			}));
			body.appendChild(content);
			body.appendChild(badge);

			label.appendChild(checkbox);
			label.appendChild(letter);
			label.appendChild(body);
			item.appendChild(label);

			applyEvaluation(item, badge, answer.letter, state);

			return item;
		}

		/**
		 * Po potvrzení se každá odpověď obarví podle vyhodnocení:
		 * správná zeleně (ať už byla zvolena, nebo ne), špatně zvolená červeně.
		 * Slovní označení doplňuje barvu, aby výsledek nezáležel jen na barvě.
		 */
		function applyEvaluation(item, badge, letter, state) {
			if (!state.confirmed || !state.evaluation) {
				return;
			}

			item.classList.add('is-locked');

			var result = state.evaluation.byLetter[letter];
			if (!result) {
				return;
			}

			if (result.isCorrect) {
				item.classList.add('is-correct');
				badge.textContent = result.isSelected
					? i18n.t('nv194.answer.badge.correctSelected')
					: i18n.t('nv194.answer.badge.correctMissed');
			} else if (result.isSelected) {
				item.classList.add('is-wrong');
				badge.textContent = i18n.t('nv194.answer.badge.wrongSelected');
			} else {
				return;
			}

			badge.classList.remove('quiz-answer__badge--placeholder');
		}

		function errorsLabel(count) {
			return window.NV194Evaluation.formatErrorCount(count, i18n.getLang());
		}

		function renderResult(question, state) {
			result.className = 'quiz-question__result';

			if (!state.confirmed || !state.evaluation) {
				result.textContent = '';
				result.hidden = true;
				return;
			}

			var evaluation = state.evaluation;
			result.hidden = false;

			var icon = element('span', 'quiz-question__result-icon');
			var message = element('span', 'quiz-question__result-text');

			if (evaluation.isCorrect) {
				result.classList.add('is-correct');
				icon.textContent = '✓';
				message.textContent = i18n.t('nv194.result.correct');
			} else {
				result.classList.add('is-wrong');
				icon.textContent = '✗';
				message.textContent = i18n.t('nv194.result.wrong', {
					errors: errorsLabel(evaluation.errors),
					answers: question.correctAnswers.map(function (letter) {
						return LETTER_LABELS[letter] || letter;
					}).join(', ')
				});
			}

			result.textContent = '';
			result.appendChild(icon);
			result.appendChild(message);
		}

		return {
			element: root,

			/**
			 * @param {Object} question otázka v datovém modelu parseru
			 * @param {{selected: string[], confirmed: boolean, evaluation: Object|null}} state
			 */
			render: function (question, state) {
				chapter.textContent = question.chapter || '';
				chapter.hidden = !question.chapter;

				renderContent(question.content, text, imageBase, i18n.t('nv194.question.imageAlt', { id: question.id }));

				answerList.textContent = '';
				question.answers.forEach(function (answer) {
					answerList.appendChild(buildAnswer(answer, state));
				});

				renderResult(question, state);
			}
		};
	}

	return { create: create };
})();
