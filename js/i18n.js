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
			'auth.role.cv': 'Přístup ke stránce CV',
			'auth.role.full': 'Přístup ke všem stránkám',
			'auth.notice.pageRequiresLogin': 'Stránka {page} je dostupná až po přihlášení.',
			'auth.notice.pageRequiresLoginDirect': 'Stránka {page} vyžaduje přihlášení.',

			'contact.title': 'Kontakt',
			'contact.lead': 'Máte dotaz, nápad na spolupráci nebo jen chcete pozdravit? Neváhejte se ozvat – rád odpovím.',
			'contact.email.label': 'E-mail',
			'contact.location.label': 'Lokalita',
			'contact.availability.label': 'Dostupnost',
			'contact.availability.value': 'Po–Ne 0:00–23:59',

			'cv.hero.role': 'Technický specialista automatizace',
			'cv.hero.location': 'Brno, Česko',
			'cv.hero.summary': 'Technický specialista automatizace s více než 6 lety praxe ve firmě B&R Industrial Automation. Navrhuji a programuji automatizační systémy, integruji řídicí jednotky a pohony, uvádím stroje do provozu a řeším technické problémy přímo se zákazníky. Vystudoval jsem Automatizaci a informatiku na VUT v Brně a kombinuji inženýrský přístup s praktickými dovednostmi v PLC programování, skriptování a 3D vizualizaci.',
			'cv.actions.print': 'Vytisknout CV',
			'cv.actions.email': 'Napsat e-mail',
			'cv.actions.linkedin': 'LinkedIn profil',

			'cv.stats.years': 'let praxe',
			'cv.stats.skills': 'technologií a nástrojů',
			'cv.stats.languages': 'jazyky',

			'cv.section.experience': 'Zkušenosti',
			'cv.section.education': 'Vzdělání',
			'cv.section.skills': 'Dovednosti',
			'cv.section.languages': 'Jazyky',

			'cv.experience.period': 'Září 2020 – současnost',
			'cv.experience.bullet1': 'Návrh a programování automatizačních systémů',
			'cv.experience.bullet2': 'Konfigurace a integrace řídicích systémů, pohonů a dalších zařízení',
			'cv.experience.bullet3': 'Vývoj a ladění automatizačního softwaru',
			'cv.experience.bullet4': 'Uvádění strojů do provozu',
			'cv.experience.bullet5': 'Řešení technických problémů',
			'cv.experience.bullet6': 'Tvorba technické dokumentace',
			'cv.experience.bullet7': 'Spolupráce se zákazníky a dalšími členy vývojového týmu',

			'cv.duration.year.one': '{n} rok',
			'cv.duration.year.few': '{n} roky',
			'cv.duration.year.many': '{n} let',
			'cv.duration.month.one': '{n} měsíc',
			'cv.duration.month.few': '{n} měsíce',
			'cv.duration.month.many': '{n} měsíců',

			'cv.education.school': 'Vysoké učení technické v Brně',
			'cv.education.degree': 'Ing., Automatizace a informatika',
			'cv.education.period': '2015–2020',

			'cv.skills.group.programming': 'Programování a web',
			'cv.skills.group.automation': 'Automatizace a PLC',
			'cv.skills.group.engineering': 'Inženýrství a CAD',
			'cv.skills.group.methodology': 'Metodologie',

			'cv.skill.engineering': 'Inženýrství',
			'cv.skill.plcProgramming': 'Programování PLC',
			'cv.skill.agile': 'Agilní metodologie',
			'cv.skill.visualization3d': '3D vizualizace',
			'cv.skill.scripting': 'Skripty',
			'cv.skill.automation': 'Automatizace',

			'cv.language.cs.name': 'Čeština',
			'cv.language.cs.level': 'Rodilý mluvčí',
			'cv.language.en.name': 'Angličtina',
			'cv.language.en.level': 'Středně pokročilá (B1)',

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
			'nv194.mode.chapters.name': 'Test z vybraných kapitol',
			'nv194.mode.chapters.select': 'Vyberte kapitoly, ze kterých chcete být testováni:',
			'nv194.mode.chapters.start': 'Spustit test z kapitol',
			'nv194.mode.chapters.none': 'Vyberte alespoň jednu kapitolu.',
			'nv194.mode.chapters.count.one': '{count} otázka',
			'nv194.mode.chapters.count.few': '{count} otázky',
			'nv194.mode.chapters.count.many': '{count} otázek',

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
			'auth.role.cv': 'Access to the CV page',
			'auth.role.full': 'Access to all pages',
			'auth.notice.pageRequiresLogin': 'The {page} page is available only after logging in.',
			'auth.notice.pageRequiresLoginDirect': 'The {page} page requires logging in.',

			'contact.title': 'Contact',
			'contact.lead': 'Have a question, a collaboration idea, or just want to say hi? Feel free to reach out – I\u2019d be happy to reply.',
			'contact.email.label': 'E-mail',
			'contact.location.label': 'Location',
			'contact.availability.label': 'Availability',
			'contact.availability.value': 'Mon–Sun 0:00–23:59',

			'cv.hero.role': 'Automation Technical Specialist',
			'cv.hero.location': 'Brno, Czech Republic',
			'cv.hero.summary': 'Automation technical specialist with more than 6 years of experience at B&R Industrial Automation. I design and program automation systems, integrate control units and drives, commission machines, and solve technical issues directly with customers. I hold an engineering degree in Automation and Informatics from Brno University of Technology, combining an engineering mindset with hands-on skills in PLC programming, scripting, and 3D visualization.',
			'cv.actions.print': 'Print CV',
			'cv.actions.email': 'Send an email',
			'cv.actions.linkedin': 'LinkedIn profile',

			'cv.stats.years': 'years of experience',
			'cv.stats.skills': 'tools & technologies',
			'cv.stats.languages': 'languages',

			'cv.section.experience': 'Experience',
			'cv.section.education': 'Education',
			'cv.section.skills': 'Skills',
			'cv.section.languages': 'Languages',

			'cv.experience.period': 'September 2020 – present',
			'cv.experience.bullet1': 'Designing and programming automation systems',
			'cv.experience.bullet2': 'Configuring and integrating control systems, drives, and other equipment',
			'cv.experience.bullet3': 'Developing and debugging automation software',
			'cv.experience.bullet4': 'Commissioning machines',
			'cv.experience.bullet5': 'Troubleshooting technical issues',
			'cv.experience.bullet6': 'Creating technical documentation',
			'cv.experience.bullet7': 'Collaborating with customers and other members of the development team',

			'cv.duration.year.one': '{n} year',
			'cv.duration.year.few': '{n} years',
			'cv.duration.year.many': '{n} years',
			'cv.duration.month.one': '{n} month',
			'cv.duration.month.few': '{n} months',
			'cv.duration.month.many': '{n} months',

			'cv.education.school': 'Brno University of Technology',
			'cv.education.degree': 'M.Sc. (Ing.), Automation and Informatics',
			'cv.education.period': '2015–2020',

			'cv.skills.group.programming': 'Programming & Web',
			'cv.skills.group.automation': 'Automation & PLC',
			'cv.skills.group.engineering': 'Engineering & CAD',
			'cv.skills.group.methodology': 'Methodology',

			'cv.skill.engineering': 'Engineering',
			'cv.skill.plcProgramming': 'PLC programming',
			'cv.skill.agile': 'Agile methodologies',
			'cv.skill.visualization3d': '3D visualization',
			'cv.skill.scripting': 'Scripting',
			'cv.skill.automation': 'Automation',

			'cv.language.cs.name': 'Czech',
			'cv.language.cs.level': 'Native speaker',
			'cv.language.en.name': 'English',
			'cv.language.en.level': 'Intermediate (B1)',

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
			'nv194.mode.chapters.name': 'Test from selected chapters',
			'nv194.mode.chapters.select': 'Select the chapters you want to be tested on:',
			'nv194.mode.chapters.start': 'Start chapter test',
			'nv194.mode.chapters.none': 'Select at least one chapter.',
			'nv194.mode.chapters.count.one': '{count} question',
			'nv194.mode.chapters.count.few': '{count} questions',
			'nv194.mode.chapters.count.many': '{count} questions',

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
