/**
 * Lokalizace (čeština / angličtina) sdílená všemi stránkami webu.
 *
 * Modul pracuje se dvěma vrstvami textu:
 *   - statické texty v HTML jsou označené atributy `data-i18n*` a modul je
 *     sám dosadí při startu i při každé změně jazyka (viz applyStatic),
 *   - dynamické texty, které si stránky vykreslují vlastní logikou (např.
 *     stav testu NV194 nebo hlášky přihlašovacího dialogu), si o překlad
 *     žádají přímo voláním t(klíč, hodnoty) a stránka si je po změně jazyka
 *     sama znovu vykreslí (viz událost 'site:langchange').
 *
 * Výchozí jazyk je čeština; volba se ukládá do localStorage, takže zůstává
 * zachovaná i po zavření prohlížeče a je společná pro celý web.
 */
window.I18n = (function () {
	'use strict';

	var STORAGE_KEY = 'site-lang';
	var DEFAULT_LANG = 'cs';
	var SUPPORTED = ['cs', 'en'];

	var translations = {
		cs: {
			'lang.name.cs': 'Čeština',
			'lang.name.en': 'English',
			'lang.code.cs': 'CS',
			'lang.code.en': 'EN',
			'lang.switcher.label': 'Jazyk',

			'nav.home': 'Domů',
			'nav.personal': 'Osobní',
			'nav.cv': 'CV',
			'nav.games': 'Hry',
			'nav.contact': 'Kontakt',

			'auth.openButton.login': 'Přihlásit',
			'auth.openButton.loggedIn': 'Přihlášen',
			'auth.title.login': 'Přihlášení',
			'auth.title.loggedIn': 'Jste přihlášeni',
			'auth.lead.login': 'Chráněné stránky jsou dostupné po zadání hesla.',
			'auth.lead.loggedIn': 'Přihlášení platí do zavření prohlížeče.',
			'auth.close': 'Zavřít',
			'auth.form.label': 'Heslo',
			'auth.form.placeholder': 'Zadejte heslo',
			'auth.form.reveal.show': 'Zobrazit',
			'auth.form.reveal.hide': 'Skrýt',
			'auth.form.submit': 'Přihlásit se',
			'auth.form.error': 'Nesprávné heslo.',
			'auth.status.role': 'Oprávnění:',
			'auth.status.pages': 'Dostupné stránky:',
			'auth.status.logout': 'Odhlásit se',
			'auth.role.nv194': 'Přístup ke stránce NV194',
			'auth.role.full': 'Přístup ke všem stránkám',
			'auth.notice.pageRequiresLogin': 'Stránka {page} je dostupná až po přihlášení.',
			'auth.notice.pageRequiresLoginDirect': 'Stránka {page} vyžaduje přihlášení.',

			'contact.title': 'Kontakt',
			'contact.lead': 'Máte dotaz, nápad na spolupráci nebo jen chcete pozdravit? Neváhejte se ozvat – rád odpovím.',
			'contact.email.label': 'E-mail',
			'contact.location.label': 'Lokalita',
			'contact.availability.label': 'Dostupnost',
			'contact.availability.value': 'Po–Ne 0:00–23:59',

			'nv194.title': 'NV 194/2022 – Testové otázky',
			'nv194.subtitle': 'Procvičování otázek k odborné způsobilosti v elektrotechnice.',
			'nv194.status.loading': 'Načítám otázky…',
			'nv194.nav.toggle': 'Přehled otázek',
			'nv194.nav.expandAll': 'Rozbalit vše',
			'nv194.nav.collapseAll': 'Sbalit vše',
			'nv194.nav.ariaLabel': 'Navigace otázek',
			'nv194.nav.imageFallback': 'Otázka s obrázkem',
			'nv194.nav.goToQuestion': 'Otázka č. {id}',
			'nv194.nav.searchLabel': 'Hledat otázku',
			'nv194.nav.searchPlaceholder': 'Hledat v otázkách a odpovědích…',
			'nv194.nav.searchClear': 'Vymazat hledání',
			'nv194.nav.searchNoResults': 'Žádné otázky neodpovídají hledanému výrazu.',

			'nv194.start.heading': 'Zvolte režim testu',
			'nv194.start.lead': 'Nebo si otevřete libovolnou otázku z přehledu vlevo.',
			'nv194.mode.paragraph6.name': 'Test na §6',
			'nv194.mode.paragraph6.detail': '40 náhodných otázek',
			'nv194.mode.paragraph7.name': 'Test na §7',
			'nv194.mode.paragraph7.detail': '60 náhodných otázek',
			'nv194.mode.hint.random': 'Náhodný výběr napříč všemi kapitolami',
			'nv194.mode.all.name': 'Všechny otázky postupně',
			'nv194.mode.all.hint': 'Celá sada v pořadí podle kapitol',
			'nv194.mode.demo.name': 'Zkušební test (3 otázky)',
			'nv194.mode.demo.hint': 'Rychlé vyzkoušení celého průběhu',
			'nv194.mode.demo.restricted': 'Zkušební test je dostupný pouze s plným přístupem.',

			'nv194.action.confirm': 'Potvrdit',
			'nv194.action.next': 'Další',
			'nv194.action.finish': 'Dokončit',
			'nv194.action.newTest': 'Nový test',
			'nv194.action.startNewTest': 'Zahájit nový test',
			'nv194.action.backToTestQuestion': 'Zpět na otázku testu',
			'nv194.action.backToTestResult': 'Zpět na výsledek testu',
			'nv194.action.modeSelect': 'Výběr režimu',

			'nv194.resetModal.title': 'Zahájit nový test?',
			'nv194.resetModal.message': 'Aktuální postup a odpovědi budou ztraceny.',
			'nv194.resetModal.cancel': 'Zrušit',
			'nv194.resetModal.confirm': 'Zahájit nový test',

			'nv194.progress.test': 'Otázka {position} z {total} (č. {id})',
			'nv194.progress.browse': 'Prohlížení – otázka č. {id}',
			'nv194.progress.score': 'Správně {correct} z {confirmed} zodpovězených · chyb {errors}',

			'nv194.contextNote.finished': 'Tato otázka je součástí dokončeného testu ({position}. z {total}). Výsledek už nelze změnit.',
			'nv194.contextNote.inProgress': 'Tato otázka je součástí testu ({position}. z {total}). Odpovědi se ukládají do testu.',

			'nv194.error.loadFailed': 'Nepodařilo se načíst otázky (HTTP {status}).',
			'nv194.error.noQuestions': 'Zdrojový soubor neobsahuje žádné otázky.',
			'nv194.status.loadedWithErrors': 'Načteno {count} otázek, {errCount} záznamů obsahuje chybu ve zdrojových datech.',

			'nv194.question.imageAlt': 'Obrázek k otázce {id}',
			'nv194.answer.imageAlt': 'Obrázek odpovědi {letter}',
			'nv194.image.invalidLink': 'Neplatný odkaz na obrázek',
			'nv194.image.loadFailed': 'Obrázek se nepodařilo načíst',

			'nv194.answer.badge.correctSelected': '✓ Správně',
			'nv194.answer.badge.correctMissed': '✓ Správně (nezvoleno)',
			'nv194.answer.badge.wrongSelected': '✗ Chybná volba',

			'nv194.result.correct': 'Správně, bez chyby.',
			'nv194.result.wrong': 'Špatně – {errors}. Správně: {answers}.',

			'nv194.summary.title': 'Test dokončen',
			'nv194.summary.total': 'Otázek celkem',
			'nv194.summary.correctQuestions': 'Správně zodpovězeno',
			'nv194.summary.wrongQuestions': 'Chybných otázek',
			'nv194.summary.errors': 'Chyb celkem',
			'nv194.summary.unanswered': 'Nezodpovězeno',
			'nv194.summary.successRate': 'Úspěšnost',
			'nv194.summary.showDetails': 'Zobrazit výsledky jednotlivých otázek',
			'nv194.summary.hideDetails': 'Skrýt výsledky jednotlivých otázek',
			'nv194.summary.goToQuestion': 'Přejít na otázku č. {id}',
			'nv194.summary.questionNumber': 'č. {id}',
			'nv194.summary.statusCorrect': 'Správně'
		},
		en: {
			'lang.name.cs': 'Czech',
			'lang.name.en': 'English',
			'lang.code.cs': 'CS',
			'lang.code.en': 'EN',
			'lang.switcher.label': 'Language',

			'nav.home': 'Home',
			'nav.personal': 'Personal',
			'nav.cv': 'CV',
			'nav.games': 'Games',
			'nav.contact': 'Contact',

			'auth.openButton.login': 'Log in',
			'auth.openButton.loggedIn': 'Logged in',
			'auth.title.login': 'Log in',
			'auth.title.loggedIn': 'You are logged in',
			'auth.lead.login': 'Protected pages are available after entering a password.',
			'auth.lead.loggedIn': 'You stay logged in until you close the browser.',
			'auth.close': 'Close',
			'auth.form.label': 'Password',
			'auth.form.placeholder': 'Enter password',
			'auth.form.reveal.show': 'Show',
			'auth.form.reveal.hide': 'Hide',
			'auth.form.submit': 'Log in',
			'auth.form.error': 'Incorrect password.',
			'auth.status.role': 'Access level:',
			'auth.status.pages': 'Available pages:',
			'auth.status.logout': 'Log out',
			'auth.role.nv194': 'Access to the NV 194 page',
			'auth.role.full': 'Access to all pages',
			'auth.notice.pageRequiresLogin': 'The {page} page is available only after logging in.',
			'auth.notice.pageRequiresLoginDirect': 'The {page} page requires logging in.',

			'contact.title': 'Contact',
			'contact.lead': 'Have a question, a collaboration idea, or just want to say hi? Feel free to reach out – I\u2019d be happy to reply.',
			'contact.email.label': 'E-mail',
			'contact.location.label': 'Location',
			'contact.availability.label': 'Availability',
			'contact.availability.value': 'Mon–Sun 0:00–23:59',

			'nv194.title': 'NV 194/2022 – Test Questions',
			'nv194.subtitle': 'Practice questions for professional competence in electrical engineering.',
			'nv194.status.loading': 'Loading questions…',
			'nv194.nav.toggle': 'Question overview',
			'nv194.nav.expandAll': 'Expand all',
			'nv194.nav.collapseAll': 'Collapse all',
			'nv194.nav.ariaLabel': 'Question navigation',
			'nv194.nav.imageFallback': 'Question with image',
			'nv194.nav.goToQuestion': 'Question no. {id}',
			'nv194.nav.searchLabel': 'Search questions',
			'nv194.nav.searchPlaceholder': 'Search questions and answers…',
			'nv194.nav.searchClear': 'Clear search',
			'nv194.nav.searchNoResults': 'No questions match your search.',

			'nv194.start.heading': 'Choose a test mode',
			'nv194.start.lead': 'Or open any question from the overview on the left.',
			'nv194.mode.paragraph6.name': 'Test for §6',
			'nv194.mode.paragraph6.detail': '40 random questions',
			'nv194.mode.paragraph7.name': 'Test for §7',
			'nv194.mode.paragraph7.detail': '60 random questions',
			'nv194.mode.hint.random': 'Random selection across all chapters',
			'nv194.mode.all.name': 'All questions in sequence',
			'nv194.mode.all.hint': 'The complete set in chapter order',
			'nv194.mode.demo.name': 'Demo test (3 questions)',
			'nv194.mode.demo.hint': 'Quickly try out the whole flow',
			'nv194.mode.demo.restricted': 'The demo test is available only with full access.',

			'nv194.action.confirm': 'Confirm',
			'nv194.action.next': 'Next',
			'nv194.action.finish': 'Finish',
			'nv194.action.newTest': 'New test',
			'nv194.action.startNewTest': 'Start new test',
			'nv194.action.backToTestQuestion': 'Back to test question',
			'nv194.action.backToTestResult': 'Back to test result',
			'nv194.action.modeSelect': 'Choose mode',

			'nv194.resetModal.title': 'Start a new test?',
			'nv194.resetModal.message': 'Your current progress and answers will be lost.',
			'nv194.resetModal.cancel': 'Cancel',
			'nv194.resetModal.confirm': 'Start new test',

			'nv194.progress.test': 'Question {position} of {total} (no. {id})',
			'nv194.progress.browse': 'Browsing – question no. {id}',
			'nv194.progress.score': 'Correct {correct} of {confirmed} answered · errors {errors}',

			'nv194.contextNote.finished': 'This question is part of a finished test ({position} of {total}). The result can no longer be changed.',
			'nv194.contextNote.inProgress': 'This question is part of the test ({position} of {total}). Answers are saved to the test.',

			'nv194.error.loadFailed': 'Failed to load questions (HTTP {status}).',
			'nv194.error.noQuestions': 'The source file contains no questions.',
			'nv194.status.loadedWithErrors': 'Loaded {count} questions, {errCount} records contain an error in the source data.',

			'nv194.question.imageAlt': 'Image for question {id}',
			'nv194.answer.imageAlt': 'Image for answer {letter}',
			'nv194.image.invalidLink': 'Invalid image link',
			'nv194.image.loadFailed': 'Image failed to load',

			'nv194.answer.badge.correctSelected': '✓ Correct',
			'nv194.answer.badge.correctMissed': '✓ Correct (not selected)',
			'nv194.answer.badge.wrongSelected': '✗ Incorrect choice',

			'nv194.result.correct': 'Correct, no mistakes.',
			'nv194.result.wrong': 'Incorrect – {errors}. Correct answer: {answers}.',

			'nv194.summary.title': 'Test completed',
			'nv194.summary.total': 'Total questions',
			'nv194.summary.correctQuestions': 'Answered correctly',
			'nv194.summary.wrongQuestions': 'Incorrect questions',
			'nv194.summary.errors': 'Total errors',
			'nv194.summary.unanswered': 'Unanswered',
			'nv194.summary.successRate': 'Success rate',
			'nv194.summary.showDetails': 'Show individual question results',
			'nv194.summary.hideDetails': 'Hide individual question results',
			'nv194.summary.goToQuestion': 'Go to question no. {id}',
			'nv194.summary.questionNumber': 'no. {id}',
			'nv194.summary.statusCorrect': 'Correct'
		}
	};

	function readStoredLang() {
		try {
			return window.localStorage.getItem(STORAGE_KEY);
		} catch (error) {
			return null;
		}
	}

	function writeStoredLang(lang) {
		try {
			window.localStorage.setItem(STORAGE_KEY, lang);
		} catch (error) {
			// Soukromý režim prohlížeče může zápis odmítnout - jazyk pak
			// platí jen pro aktuální zobrazení stránky.
		}
	}

	var currentLang = (function () {
		var stored = readStoredLang();
		return SUPPORTED.indexOf(stored) !== -1 ? stored : DEFAULT_LANG;
	})();

	/** Dosadí {jméno} zástupné texty hodnotami z vars. */
	function interpolate(text, vars) {
		if (!vars) {
			return text;
		}
		return text.replace(/\{(\w+)\}/g, function (match, name) {
			return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match;
		});
	}

	/**
	 * Přeloží klíč do aktuálního jazyka. Chybějící klíč spadne zpět na
	 * češtinu a nakonec na samotný klíč, aby chybějící překlad nikdy
	 * nerozbil stránku.
	 */
	function t(key, vars) {
		var dict = translations[currentLang] || translations[DEFAULT_LANG];
		var text = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key]
			: (translations[DEFAULT_LANG][key] !== undefined ? translations[DEFAULT_LANG][key] : key);
		return interpolate(text, vars);
	}

	function getLang() {
		return currentLang;
	}

	/** Dosadí statické texty označené atributy data-i18n* v daném kořeni. */
	function applyStatic(root) {
		var scope = root || document;

		Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n]'), function (el) {
			el.textContent = t(el.getAttribute('data-i18n'));
		});
		Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-placeholder]'), function (el) {
			el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
		});
		Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-title]'), function (el) {
			el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
		});
		Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-aria-label]'), function (el) {
			el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
		});
	}

	function setLang(lang) {
		if (SUPPORTED.indexOf(lang) === -1 || lang === currentLang) {
			return;
		}
		currentLang = lang;
		writeStoredLang(lang);
		document.documentElement.lang = lang;
		applyStatic(document);
		document.dispatchEvent(new CustomEvent('site:langchange', { detail: { lang: lang } }));
	}

	document.documentElement.lang = currentLang;
	applyStatic(document);

	return {
		SUPPORTED: SUPPORTED,
		DEFAULT_LANG: DEFAULT_LANG,
		t: t,
		getLang: getLang,
		setLang: setLang,
		applyStatic: applyStatic
	};
})();
