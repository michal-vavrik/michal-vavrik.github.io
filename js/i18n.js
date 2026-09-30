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
			'nav.anime': 'Anime',

			'anime.title': 'Anime list',
			'anime.status.loading': 'Načítám anime data…',
			'anime.status.loaded.one': 'Načten {count} anime titul.',
			'anime.status.loaded.few': 'Načteny {count} anime tituly.',
			'anime.status.loaded.many': 'Načteno {count} anime titulů.',
			'anime.status.error': 'Nepodařilo se načíst anime data.',

			'anime.search.placeholder': 'Hledej anime...',
			'anime.search.ariaLabel': 'Hledat anime podle názvu',

			'anime.edit.start': 'Upravit',
			'anime.edit.save': 'Uložit',
			'anime.edit.error': 'Některé hodnoty nejsou platné. Opravte zvýrazněná pole.',

			'anime.reset.button': 'Obnovit původní data',
			'anime.resetModal.title': 'Obnovit původní data?',
			'anime.resetModal.message': 'Všechny provedené úpravy budou nenávratně smazány.',
			'anime.resetModal.cancel': 'Zrušit',
			'anime.resetModal.confirm': 'Obnovit',

			'anime.export.button': 'Exportovat data',

			'anime.import.button': 'Importovat data',
			'anime.import.error': 'Nepodařilo se načíst soubor. Zkontrolujte, že jde o platný export dat.',

			'anime.header.number': '#',
			'anime.header.image': 'Obrázek',
			'anime.header.nameEn': 'Název [EN]',
			'anime.header.nameJa': 'Název [JA]',
			'anime.header.genres': 'Kategorie',
			'anime.header.description': 'Popis',
			'anime.header.date': 'Datum',
			'anime.header.state': 'Stav',
			'anime.header.csfdRating': 'ČSFD hodnocení',
			'anime.header.malRating': 'MAL hodnocení',
			'anime.header.myRating': 'Moje hodnocení',

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

			'games.title': 'Hry',
			'games.lead': 'Malé hříčky naprogramované přímo pro tenhle web. Vyberte si dlaždici a pusťte se do hraní rovnou v prohlížeči.',
			'games.badge.soon': 'Připravujeme',
			'games.snake.name': 'Snake',
			'games.snake.desc': 'Klasický had – sbírejte jídlo, rosťte a nenarazte do sebe ani do stěny.',
			'games.tetris.name': 'Tetris',
			'games.tetris.desc': 'Skládání padajících kostek do plných řad.',
			'games.memory.name': 'Pexeso',
			'games.memory.desc': 'Hledání dvojic bez časového limitu – trénink paměti.',
			'games.g2048.name': '2048',
			'games.g2048.desc': 'Spojování čísel posouváním dlaždic po mřížce.',

			'snake.title': 'Snake',
			'snake.lead': 'Sbírejte jídlo, rosťte a nenarazte do sebe ani do stěny.',
			'snake.back': 'Zpět na hry',
			'snake.score': 'Skóre',
			'snake.best': 'Nejlepší',
			'snake.canvas.label': 'Herní plocha hry Snake',
			'snake.button.start': 'Start',
			'snake.button.pause': 'Pauza',
			'snake.button.resume': 'Pokračovat',
			'snake.button.again': 'Hrát znovu',
			'snake.button.restart': 'Restart',
			'snake.pad.up': 'Nahoru',
			'snake.pad.down': 'Dolů',
			'snake.pad.left': 'Doleva',
			'snake.pad.right': 'Doprava',
			'snake.overlay.ready.title': 'Připraveni?',
			'snake.overlay.ready.text': 'Stiskněte Start, Enter nebo šipku a had se rozjede.',
			'snake.overlay.paused.title': 'Pauza',
			'snake.overlay.paused.text': 'Mezerníkem nebo tlačítkem Pokračovat se vrátíte do hry.',
			'snake.overlay.over.title': 'Konec hry',
			'snake.overlay.over.text': 'Získali jste {score} bodů. Zkuste to znovu!',
			'snake.overlay.win.title': 'Výhra!',
			'snake.overlay.win.text': 'Zaplnili jste celou plochu se skóre {score}. Klobouk dolů!',
			'snake.hint': 'Ovládání: šipky nebo W A S D, mezerník pozastaví hru, Enter spustí novou. Na dotykovém displeji lze hada ovládat i tahem prstu.',

			'tetris.back': 'Zpět na hry',
			'tetris.title': 'Tetris',
			'tetris.lead': 'Skládejte padající dílky a vytvářejte celé řady.',
			'tetris.score': 'Skóre',
			'tetris.best': 'Nejlepší',
			'tetris.level': 'Úroveň',
			'tetris.canvas.label': 'Herní plocha Tetrisu',
			'tetris.status.ready': 'Připraveni?',
			'tetris.status.readyHint': 'Stiskněte Start nebo herní klávesu.',
			'tetris.status.paused': 'Pauza',
			'tetris.status.pausedHint': 'Pokračujte tlačítkem nebo klávesou P.',
			'tetris.status.autoPausedHint': 'Hra se pozastavila při přepnutí okna.',
			'tetris.status.over': 'Konec hry',
			'tetris.status.overHint': 'Plocha je plná. Zkuste to znovu!',
			'tetris.next': 'Další dílek',
			'tetris.next.label': 'Náhled dalšího dílku',
			'tetris.button.start': 'Start',
			'tetris.button.pause': 'Pauza',
			'tetris.button.resume': 'Pokračovat',
			'tetris.button.restart': 'Restart',
			'tetris.controls.left': 'Vlevo',
			'tetris.controls.rotate': 'Otočit',
			'tetris.controls.right': 'Vpravo',
			'tetris.controls.soft': 'Zrychlit pád',
			'tetris.controls.drop': 'Pustit',
			'tetris.controls.label': 'Ovládání Tetrisu',
			'tetris.hint': '← → Posun · ↑ Otočení · ↓ Rychlejší pád · Mezerník Okamžitý pád · P Pauza',

			'g2048.back': 'Zpět na hry',
			'g2048.title': '2048',
			'g2048.lead': 'Spojujte stejná čísla a zkuste dosáhnout dlaždice 2048.',
			'g2048.score': 'Skóre',
			'g2048.best': 'Nejlepší',
			'g2048.hint': 'Použijte šipky, W A S D, tah prstem nebo směrová tlačítka.',
			'g2048.button.restart': 'Restart',
			'g2048.board.label': 'Herní plocha 2048',
			'g2048.pad.label': 'Směrové ovládání 2048',
			'g2048.pad.up': 'Nahoru',
			'g2048.pad.left': 'Doleva',
			'g2048.pad.right': 'Doprava',
			'g2048.pad.down': 'Dolů',
			'g2048.tile.empty': 'Prázdné pole',
			'g2048.tile.value': 'Dlaždice {value}',
			'g2048.status.ready': 'Spojte stejná čísla a dostaňte se na 2048!',
			'g2048.status.playing': 'Spojujte čísla dál.',
			'g2048.status.win': 'Dosáhli jste 2048! Můžete pokračovat ve hře.',
			'g2048.status.over': 'Konec hry. Zkuste to znovu!',

			'memory.back': 'Zpět na hry',
			'memory.title': 'Pexeso',
			'memory.lead': 'Najděte všechny stejné dvojice.',
			'memory.time': 'Čas',
			'memory.moves': 'Tahy',
			'memory.pairs': 'Dvojice',
			'memory.difficulty.label': 'Velikost',
			'memory.difficulty.4': '4 × 4',
			'memory.difficulty.6': '6 × 6',
			'memory.difficulty.8': '8 × 8',
			'memory.difficulty.10': '10 × 10',
			'memory.difficulty.12': '12 × 12',
			'memory.board.label': 'Herní plocha pexesa',
			'memory.button.restart': 'Restart',
			'memory.hint': 'Otočte dvě kartičky a hledejte stejné symboly.',
			'memory.card.hidden': 'Zakrytá karta {number}',
			'memory.card.revealed': 'Karta {number}: {symbol}',
			'memory.status.oneCard': 'Otočte další kartičku.',
			'memory.status.match': 'Našli jste dvojici!',
			'memory.status.mismatch': 'Kartičky se neshodují.',
			'memory.status.win': 'Hotovo! Tahy: {moves}, čas: {time}.',

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
			'nv194.mode.all.startLabel': 'Začít od otázky číslo',
			'nv194.mode.all.start': 'Spustit postupné otázky',
			'nv194.mode.all.invalidStart': 'Zadejte celé číslo otázky.',
			'nv194.mode.all.questionNotFound': 'Otázka č. {id} neexistuje.',
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
			'nav.anime': 'Anime',

			'anime.title': 'Anime list',
			'anime.status.loading': 'Loading anime data…',
			'anime.status.loaded.one': 'Loaded {count} anime title.',
			'anime.status.loaded.few': 'Loaded {count} anime titles.',
			'anime.status.loaded.many': 'Loaded {count} anime titles.',
			'anime.status.error': 'Failed to load anime data.',

			'anime.search.placeholder': 'Search anime...',
			'anime.search.ariaLabel': 'Search anime by title',

			'anime.edit.start': 'Edit',
			'anime.edit.save': 'Save',
			'anime.edit.error': 'Some values are invalid. Fix the highlighted fields.',

			'anime.reset.button': 'Reset to original data',
			'anime.resetModal.title': 'Reset to original data?',
			'anime.resetModal.message': 'All your edits will be permanently deleted.',
			'anime.resetModal.cancel': 'Cancel',
			'anime.resetModal.confirm': 'Reset',

			'anime.export.button': 'Export data',

			'anime.import.button': 'Import data',
			'anime.import.error': "Failed to load the file. Make sure it's a valid data export.",

			'anime.header.number': '#',
			'anime.header.image': 'Image',
			'anime.header.nameEn': 'Title [EN]',
			'anime.header.nameJa': 'Title [JA]',
			'anime.header.genres': 'Genres',
			'anime.header.description': 'Description',
			'anime.header.date': 'Date',
			'anime.header.state': 'State',
			'anime.header.csfdRating': 'CSFD rating',
			'anime.header.malRating': 'MAL rating',
			'anime.header.myRating': 'My rating',

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

			'games.title': 'Games',
			'games.lead': 'Small games coded right here for this site. Pick a tile and start playing straight in your browser.',
			'games.badge.soon': 'Coming soon',
			'games.snake.name': 'Snake',
			'games.snake.desc': 'The classic snake – eat the food, grow longer and avoid the walls and your own tail.',
			'games.tetris.name': 'Tetris',
			'games.tetris.desc': 'Stacking falling blocks into complete rows.',
			'games.memory.name': 'Memory',
			'games.memory.desc': 'Find matching pairs at your own pace.',
			'games.g2048.name': '2048',
			'games.g2048.desc': 'Merge numbers by sliding tiles across the grid.',

			'snake.title': 'Snake',
			'snake.lead': 'Eat the food, grow longer and avoid the walls and your own tail.',
			'snake.back': 'Back to games',
			'snake.score': 'Score',
			'snake.best': 'Best',
			'snake.canvas.label': 'Snake game board',
			'snake.button.start': 'Start',
			'snake.button.pause': 'Pause',
			'snake.button.resume': 'Resume',
			'snake.button.again': 'Play again',
			'snake.button.restart': 'Restart',
			'snake.pad.up': 'Up',
			'snake.pad.down': 'Down',
			'snake.pad.left': 'Left',
			'snake.pad.right': 'Right',
			'snake.overlay.ready.title': 'Ready?',
			'snake.overlay.ready.text': 'Press Start, Enter or an arrow key to get the snake moving.',
			'snake.overlay.paused.title': 'Paused',
			'snake.overlay.paused.text': 'Press space or the Resume button to get back into the game.',
			'snake.overlay.over.title': 'Game over',
			'snake.overlay.over.text': 'You scored {score} points. Give it another go!',
			'snake.overlay.win.title': 'You win!',
			'snake.overlay.win.text': 'You filled the whole board with a score of {score}. Hats off!',
			'snake.hint': 'Controls: arrow keys or W A S D, space pauses the game, Enter starts a new one. On a touch screen you can also swipe to steer.',

			'tetris.back': 'Back to games',
			'tetris.title': 'Tetris',
			'tetris.lead': 'Stack falling pieces to complete rows.',
			'tetris.score': 'Score',
			'tetris.best': 'Best',
			'tetris.level': 'Level',
			'tetris.canvas.label': 'Tetris game board',
			'tetris.status.ready': 'Ready?',
			'tetris.status.readyHint': 'Press Start or a game key.',
			'tetris.status.paused': 'Paused',
			'tetris.status.pausedHint': 'Resume with the button or P.',
			'tetris.status.autoPausedHint': 'The game paused when you switched windows.',
			'tetris.status.over': 'Game over',
			'tetris.status.overHint': 'The board is full. Try again!',
			'tetris.next': 'Next piece',
			'tetris.next.label': 'Next piece preview',
			'tetris.button.start': 'Start',
			'tetris.button.pause': 'Pause',
			'tetris.button.resume': 'Resume',
			'tetris.button.restart': 'Restart',
			'tetris.controls.left': 'Left',
			'tetris.controls.rotate': 'Rotate',
			'tetris.controls.right': 'Right',
			'tetris.controls.soft': 'Soft drop',
			'tetris.controls.drop': 'Drop',
			'tetris.controls.label': 'Tetris controls',
			'tetris.hint': '← → Move · ↑ Rotate · ↓ Soft drop · Space Hard drop · P Pause',

			'g2048.back': 'Back to games',
			'g2048.title': '2048',
			'g2048.lead': 'Merge matching numbers and try to reach the 2048 tile.',
			'g2048.score': 'Score',
			'g2048.best': 'Best',
			'g2048.hint': 'Use arrow keys, W A S D, swipe, or tap the direction buttons.',
			'g2048.button.restart': 'Restart',
			'g2048.board.label': '2048 game board',
			'g2048.pad.label': '2048 direction controls',
			'g2048.pad.up': 'Up',
			'g2048.pad.left': 'Left',
			'g2048.pad.right': 'Right',
			'g2048.pad.down': 'Down',
			'g2048.tile.empty': 'Empty cell',
			'g2048.tile.value': 'Tile {value}',
			'g2048.status.ready': 'Merge matching numbers to reach 2048!',
			'g2048.status.playing': 'Keep merging numbers.',
			'g2048.status.win': 'You reached 2048! You can keep playing.',
			'g2048.status.over': 'Game over. Try again!',

			'memory.back': 'Back to games',
			'memory.title': 'Memory',
			'memory.lead': 'Find all the matching pairs.',
			'memory.time': 'Time',
			'memory.moves': 'Moves',
			'memory.pairs': 'Pairs',
			'memory.difficulty.label': 'Board size',
			'memory.difficulty.4': '4 × 4',
			'memory.difficulty.6': '6 × 6',
			'memory.difficulty.8': '8 × 8',
			'memory.difficulty.10': '10 × 10',
			'memory.difficulty.12': '12 × 12',
			'memory.board.label': 'Memory game board',
			'memory.button.restart': 'Restart',
			'memory.hint': 'Flip two cards and find matching symbols.',
			'memory.card.hidden': 'Face-down card {number}',
			'memory.card.revealed': 'Card {number}: {symbol}',
			'memory.status.oneCard': 'Flip another card.',
			'memory.status.match': 'You found a pair!',
			'memory.status.mismatch': 'The cards do not match.',
			'memory.status.win': 'Finished in {moves} moves and {time}!',

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
			'nv194.mode.all.startLabel': 'Start at question number',
			'nv194.mode.all.start': 'Start sequential questions',
			'nv194.mode.all.invalidStart': 'Enter a whole question number.',
			'nv194.mode.all.questionNotFound': 'Question no. {id} does not exist.',
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
