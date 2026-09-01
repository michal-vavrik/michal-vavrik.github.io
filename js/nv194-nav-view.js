/**
 * Postranní navigace otázek - prezentační komponenta stromu.
 *
 * Komponenta nezná stav testu ani parser. Dostane hotový strom a funkci, která
 * pro dané číslo otázky vrátí její stav; o kliknutí informuje přes onSelect.
 */
window.NV194NavView = (function () {
	'use strict';

	function element(tag, className) {
		var node = document.createElement(tag);
		if (className) {
			node.className = className;
		}
		return node;
	}

	/** Textový popisek otázky - z obsahu se použijí jen textové uzly. */
	function questionLabel(question) {
		return question.content
			.filter(function (node) { return node.type === 'text'; })
			.map(function (node) { return node.value; })
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	/**
	 * @param {{onSelect?: function(number): void}} [options]
	 */
	function create(options) {
		options = options || {};
		var onSelect = options.onSelect || function () {};
		var i18n = window.I18n;

		var root = element('nav', 'quiz-nav');
		root.setAttribute('aria-label', i18n.t('nv194.nav.ariaLabel'));

		var buttonsById = {};
		var chapterByQuestionId = {};
		var questionsById = {};

		function labelAndTitle(button, question) {
			var text = questionLabel(question);
			var label = button.querySelector('.quiz-nav__label');
			label.textContent = text || i18n.t('nv194.nav.imageFallback');
			button.title = i18n.t('nv194.nav.goToQuestion', { id: question.id }) + (text ? ' – ' + text : '');
		}

		function buildQuestionItem(question) {
			var item = element('li', 'quiz-nav__item');

			var button = element('button', 'quiz-nav__question');
			button.type = 'button';
			button.dataset.questionId = String(question.id);

			var number = element('span', 'quiz-nav__number');
			number.textContent = question.id + '.';

			var label = element('span', 'quiz-nav__label');

			button.appendChild(number);
			button.appendChild(label);
			button.addEventListener('click', function () {
				onSelect(question.id);
			});

			labelAndTitle(button, question);

			item.appendChild(button);
			buttonsById[question.id] = button;
			questionsById[question.id] = question;
			return item;
		}

		function buildChapter(chapter) {
			var details = element('details', 'quiz-nav__chapter');

			var summary = element('summary', 'quiz-nav__chapter-title');
			var title = element('span', 'quiz-nav__chapter-name');
			title.textContent = chapter.title;
			var count = element('span', 'quiz-nav__count');
			count.textContent = chapter.questions.length;
			summary.appendChild(title);
			summary.appendChild(count);

			var list = element('ul', 'quiz-nav__questions');
			chapter.questions.forEach(function (question) {
				list.appendChild(buildQuestionItem(question));
				chapterByQuestionId[question.id] = details;
			});

			details.appendChild(summary);
			details.appendChild(list);
			return details;
		}

		return {
			element: root,

			/** Vykreslí strom. Volá se jednou po načtení dat. */
			render: function (tree) {
				root.textContent = '';
				buttonsById = {};
				chapterByQuestionId = {};
				questionsById = {};

				tree.forEach(function (chapter) {
					root.appendChild(buildChapter(chapter));
				});
			},

			/**
			 * Aktualizuje zvýraznění bez znovusestavení stromu.
			 *
			 * @param {number|null} activeId číslo právě zobrazené otázky
			 * @param {function(number): (string|null)} statusOf stav otázky:
			 *        'correct' | 'wrong' | 'open' | null
			 */
			refresh: function (activeId, statusOf) {
				Object.keys(buttonsById).forEach(function (key) {
					var id = Number(key);
					var button = buttonsById[key];
					var status = statusOf ? statusOf(id) : null;

					button.className = 'quiz-nav__question' +
						(status ? ' is-' + status : '') +
						(id === activeId ? ' is-active' : '');

					if (id === activeId) {
						button.setAttribute('aria-current', 'true');
					} else {
						button.removeAttribute('aria-current');
					}
				});

				var chapter = chapterByQuestionId[activeId];
				if (chapter) {
					chapter.open = true;
				}
			},

			/** Zajistí viditelnost otázky v seznamu. */
			reveal: function (questionId) {
				var button = buttonsById[questionId];
				if (button) {
					button.scrollIntoView({ block: 'nearest' });
				}
			},

			/** Hromadně rozbalí nebo sbalí všechny kapitoly. */
			setAllChaptersOpen: function (open) {
				var chapters = root.querySelectorAll('.quiz-nav__chapter');
				Array.prototype.forEach.call(chapters, function (details) {
					details.open = open;
				});
			},

			/** Přeloží texty závislé na jazyce beze ztráty stavu rozbaleného stromu. */
			retranslate: function () {
				root.setAttribute('aria-label', i18n.t('nv194.nav.ariaLabel'));
				Object.keys(buttonsById).forEach(function (key) {
					labelAndTitle(buttonsById[key], questionsById[key]);
				});
			}
		};
	}

	return { create: create };
})();
