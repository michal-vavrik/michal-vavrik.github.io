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

	/** Text otázky i všech odpovědí spojený do jednoho řetězce pro hledání. */
	function questionSearchText(question) {
		var parts = [String(question.id), questionLabel(question)];
		(question.answers || []).forEach(function (answer) {
			parts.push(questionLabel({ content: answer.content }));
		});
		return parts.join(' ');
	}

	/**
	 * Normalizuje text pro porovnání při hledání - malá písmena a bez diakritiky,
	 * aby uživatel nemusel psát přesně (např. "medove" najde i "medové").
	 */
	function normalizeForSearch(text) {
		return String(text || '')
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase();
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
		var itemsById = {};
		var searchTextById = {};
		var chapterByQuestionId = {};
		var questionsById = {};
		/** Kapitoly v pořadí vykreslení - kvůli filtrování a obnově rozbalení. */
		var chapterEntries = [];

		/** Stav rozbalení kapitol před zahájením hledání, pro obnovu po smazání dotazu. */
		var openBeforeSearch = null;

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
			itemsById[question.id] = item;
			questionsById[question.id] = question;
			searchTextById[question.id] = normalizeForSearch(questionSearchText(question));
			return item;
		}

		function buildChapter(chapter) {
			var details = element('details', 'quiz-nav__chapter');
			var entry = { details: details, questionIds: [] };

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
				entry.questionIds.push(question.id);
			});

			details.appendChild(summary);
			details.appendChild(list);
			chapterEntries.push(entry);
			return details;
		}

		return {
			element: root,

			/** Vykreslí strom. Volá se jednou po načtení dat. */
			render: function (tree) {
				root.textContent = '';
				buttonsById = {};
				itemsById = {};
				searchTextById = {};
				chapterByQuestionId = {};
				questionsById = {};
				chapterEntries = [];
				openBeforeSearch = null;

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

			/**
			 * Fulltextově prohledá text otázek i odpovědí (bez ohledu na
			 * velikost písmen a diakritiku) a zobrazí jen vyhovující otázky.
			 * Kapitoly bez shody se skryjí, kapitoly se shodou se rozbalí.
			 * Prázdný dotaz obnoví stav rozbalení kapitol z doby před hledáním.
			 *
			 * @param {string} rawQuery hledaný text
			 * @returns {number|null} počet nalezených otázek, nebo null pokud je dotaz prázdný
			 */
			search: function (rawQuery) {
				var query = normalizeForSearch(rawQuery).trim();

				if (query === '') {
					if (openBeforeSearch) {
						chapterEntries.forEach(function (entry, index) {
							entry.details.hidden = false;
							entry.details.open = openBeforeSearch[index];
							entry.questionIds.forEach(function (id) {
								itemsById[id].hidden = false;
							});
						});
						openBeforeSearch = null;
					}
					return null;
				}

				if (!openBeforeSearch) {
					openBeforeSearch = chapterEntries.map(function (entry) {
						return entry.details.open;
					});
				}

				var totalMatches = 0;
				chapterEntries.forEach(function (entry) {
					var chapterMatches = 0;
					entry.questionIds.forEach(function (id) {
						var isMatch = searchTextById[id].indexOf(query) !== -1;
						itemsById[id].hidden = !isMatch;
						if (isMatch) {
							chapterMatches++;
						}
					});
					entry.details.hidden = chapterMatches === 0;
					if (chapterMatches > 0) {
						entry.details.open = true;
					}
					totalMatches += chapterMatches;
				});

				return totalMatches;
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
