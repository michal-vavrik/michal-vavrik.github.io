/**
 * Automatické testy aktualizace anime listu (Aktualizovat -> Seznam, ČSFD
 * hodnocení, MAL hodnocení a Zhlédnuté epizody):
 * js/anime-sync.js, js/anime-proxy.js a addItem() v js/anime-data.js.
 *
 * Vzorové stránky sledujserialy.io, ČSFD a MyAnimeList jsou zjednodušené, ale
 * mají stejnou strukturu, jakou čtou regulární výrazy převzaté z AnimeList.pyw.
 * Aktualizace se spouští s atrapou pomocníka a atrapou dat, takže testy
 * nepotřebují síť ani soubory. Jediné, na co sahají v localStorage, je
 * nastavení adresy pomocníka (po testu se vrátí původní hodnota).
 */
window.AnimeSyncTests = (function () {
	'use strict';

	var Sync = window.AnimeSync;
	var Client = window.AnimeProxy;
	var Data = window.AnimeData;

	/* ----------------------------- vzorové stránky ----------------------------- */

	function favoritesPage(entries) {
		var blocks = entries.map(function (entry) {
			var state = entry.finished ? 'S01E24' : 'Pokračuj';
			return '<div class="a-favorites__item"><a href="/episode/' + entry.slug + '-s' + entry.season + 'e' + entry.episode
				+ '/"><img src="' + entry.image + '"><h2 class="a-favorites__title">' + entry.name
				+ '</h2><span>' + state + '</span></a></div>';
		});
		return '<html><body><div id="favorites">' + blocks.join('') + '</div><div id="planned"></div></body></html>';
	}

	/**
	 * Stránka seriálu na sledujserialy.io s řadami a ikonou jejich stavu.
	 * @param {Array<Array<string>>} seasons - [[číslo řady, 'Videné' | 'Označiť'], ...]
	 * @param {boolean} [apostrophes] - atributy v apostrofech místo uvozovek
	 */
	function serialPage(seasons, apostrophes) {
		var q = apostrophes ? "'" : '"';
		var blocks = seasons.map(function (entry) {
			return '<div class=' + q + 'season' + q + ' data-season=' + q + entry[0] + q + '><h3>Séria ' + entry[0] + '</h3>'
				+ '<a href=' + q + '#' + q + '><i title=' + q + entry[1] + q + ' class=' + q + 'fa fa-eye' + q + '></i></a></div>';
		});
		return '<html><body><div class="seasons">' + blocks.join('') + '</div></body></html>';
	}

	function csfdSearchPage(filmId) {
		return '<html><body><section class="main-box" data-search-results="series">'
			+ '<article class="article article-poster-60"><figure class="article-img">'
			+ '<a href="/film/' + filmId + '-test/prehled/"><img src="x.jpg"></a></figure></article></section></body></html>';
	}

	/**
	 * @param {Object} options - names: [[vlajka, název], ...], rating, plot; null vynechá danou část
	 */
	function csfdFilmPage(options) {
		var names = (options.names || []).map(function (entry) {
			return '<li><img src="f.svg" class="flag" title="' + entry[0] + '" alt="' + entry[0] + '"/>\t\t' + entry[1] + '\n</li>';
		}).join('');
		var rating = options.rating === null ? '' : '<div class="film-rating-average">\n\t' + options.rating + '\n</div>';
		var genres = options.genres === null ? ''
			: '<div class="genres"><a href="/zanry/3-animovany/">Animovaný</a> <span class="bullet"></span> <a href="/zanry/1-akcni/">Akční</a></div>';
		var plot = options.plot === null ? '' : '<div class="plot-full">\n<p>\n\t' + options.plot + '\n<em>(zdroj)</em>\n</p></div>';
		var main = '<div class="film-header-name"><h1>\n\tNázev\n</h1><ul class="film-names">' + names + '</ul></div>'
			+ rating + genres + plot;
		if (options.main === false) {
			return '<html><body>' + main + '</body></html>';
		}
		return '<html><body><div class="main-movie">' + main + '</div><div id="bottom-banner"></div></body></html>';
	}

	function malSearchPage(malId, slug) {
		return '<html><body><table><tr><td>Title</td></tr><tr><td><div class="picSurround">'
			+ '<a href="https://myanimelist.net/anime/' + malId + '/' + slug + '" class="hoverinfo_trigger"><img src="x.jpg"></a>'
			+ '</div></td></tr></table></body></html>';
	}

	function malAnimePage(score) {
		return '<html><body><div class="score-label score-8">' + score + '</div></body></html>';
	}

	var MAL_NOT_FOUND = '<html><body>No titles that matched your query were found.</body></html>';

	/* -------------------------------- pomocné -------------------------------- */

	function thrown(action) {
		try {
			action();
		} catch (error) {
			return error;
		}
		return null;
	}

	function errorSummary(error) {
		return error ? { code: error.code, detail: error.detail } : null;
	}

	function makeError(code, detail, status) {
		var error = new Error(code);
		error.code = code;
		error.detail = detail || '';
		error.status = status || 0;
		return error;
	}

	function sequence(tasks) {
		return tasks.reduce(function (previous, task) {
			return previous.then(task);
		}, Promise.resolve());
	}

	/** Spustí skupinu testů; výjimka se zapíše jako neúspěšná kontrola, ostatní skupiny běží dál. */
	function guarded(runner, name, group) {
		return Promise.resolve().then(function () {
			return group(runner);
		}).catch(function (error) {
			runner.check('skupina "' + name + '" skončila výjimkou', false, String(error && error.stack || error));
		});
	}

	/* ----------------------------- čisté funkce ----------------------------- */

	function pureFunctions(runner) {
		runner.equal('pythonQuote: mezera', Sync.pythonQuote('Naruto Shippuden'), 'Naruto%20Shippuden');
		runner.equal('pythonQuote: bezpečné znaky zůstanou', Sync.pythonQuote('a/b-c_d.e~f'), 'a/b-c_d.e~f');
		runner.equal('pythonQuote: diakritika', Sync.pythonQuote('Šúmacu'), '%C5%A0%C3%BAmacu');
		runner.equal('pythonQuote: japonština', Sync.pythonQuote('終末'), '%E7%B5%82%E6%9C%AB');
		runner.equal('pythonQuote: speciální znaky', Sync.pythonQuote("Don't Stop: 100% & more+"),
			'Don%27t%20Stop%3A%20100%25%20%26%20more%2B');
		runner.equal('pythonQuote: znak mimo základní rovinu', Sync.pythonQuote('\uD83D\uDE00'), '%F0%9F%98%80');

		runner.equal('roundHalfEven: půlka k sudému (80.5)', Sync.roundHalfEven(80.5), 80);
		runner.equal('roundHalfEven: půlka k sudému (81.5)', Sync.roundHalfEven(81.5), 82);
		runner.equal('roundHalfEven: půlka k sudému (0.5, 1.5, 2.5)',
			[Sync.roundHalfEven(0.5), Sync.roundHalfEven(1.5), Sync.roundHalfEven(2.5)], [0, 2, 2]);
		runner.equal('roundHalfEven: ostatní hodnoty', [Sync.roundHalfEven(79.4), Sync.roundHalfEven(79.6), Sync.roundHalfEven(100)],
			[79, 80, 100]);

		runner.equal('formatDate doplní nuly', Sync.formatDate(new Date(2024, 0, 5)), '05.01.2024');
		runner.equal('formatDate: konec roku', Sync.formatDate(new Date(2024, 11, 25)), '25.12.2024');

		runner.equal('hledání na ČSFD: mezera jako plus', Sync.csfdSearchUrl('Naruto Shippuden'),
			'https://www.csfd.cz/hledat/?q=Naruto+Shippuden');
		runner.equal('hledání na ČSFD: diakritika', Sync.csfdSearchUrl('Šúmacu no Valkyrie'),
			'https://www.csfd.cz/hledat/?q=%C5%A0%C3%BAmacu+no+Valkyrie');
		runner.equal('hledání na ČSFD: zakódovaný název se ořízne na 50 znaků',
			Sync.csfdSearchUrl(new Array(61).join('A')), 'https://www.csfd.cz/hledat/?q=' + new Array(51).join('A'));
		runner.equal('hledání na ČSFD: ořez uprostřed zakódovaného znaku jako Python',
			Sync.csfdSearchUrl(new Array(21).join('Š')), 'https://www.csfd.cz/hledat/?q=' + new Array(9).join('%C5%A0') + '%C');

		var malBase = 'https://myanimelist.net/anime.php?cat=anime&q=';
		runner.equal('hledání na MAL: běžný název', Sync.malSearchUrl('Naruto'), malBase + 'Naruto');
		runner.equal('hledání na MAL: krátký název se zleva doplní mezerami na 3 znaky',
			[Sync.malSearchUrl('K'), Sync.malSearchUrl('AB')], [malBase + '%20%20K', malBase + '%20AB']);
		runner.equal('hledání na MAL: délka se počítá ve znacích, ne v UTF-16',
			[Sync.malSearchUrl('\u65E5\u672C'), Sync.malSearchUrl('\uD83D\uDE00')],
			[malBase + '%20%E6%97%A5%E6%9C%AC', malBase + '%20%20%F0%9F%98%80']);

		runner.equal('nextNumber: nejvyšší Number nebo Image + 1',
			Sync.nextNumber([{ Number: '5', Image: '5' }, { Number: '12', Image: '20' }], 0), 21);
		runner.equal('nextNumber: prázdná data', Sync.nextNumber([], 0), 1);
		runner.equal('nextNumber: obrázky na disku mají přednost', Sync.nextNumber([{ Number: '3', Image: '3' }], 30), 31);
		runner.equal('nextNumber: neplatná čísla se přeskočí', Sync.nextNumber([{ Number: 'x', Image: '' }], 7), 8);

		runner.equal('výjimka Owari no Seraph je v seznamu', Sync.EXCEPTION_ANIME.indexOf('Owari no Seraph: Nagoja kessen hen') !== -1, true);
		runner.equal('adresa oblíbených', Sync.FAVORITES_URL, 'https://sledujserialy.io/ucet/');
	}

	/* ----------------------------- sledujserialy.io ----------------------------- */

	function favorites(runner) {
		var parsed = Sync.parseFavorites(favoritesPage([
			{ name: 'New A', slug: 'new-a', season: '02', episode: '07', image: '/u/a.jpg', finished: false },
			{ name: 'Re;Zero', slug: 're-zero', season: '01', episode: '24', image: '/u/r.jpg', finished: true }
		]));
		runner.equal('parseFavorites: počet', parsed.length, 2);
		runner.equal('parseFavorites: rozpracované anime', parsed[0], {
			Image: '/u/a.jpg', Name: 'New A', Finished: false, ActualSeason: '02', ActualEpisode: '07', AnimeUrlName: 'new-a'
		});
		runner.equal('parseFavorites: dokončené anime, středník v názvu se nahradí čárkou', parsed[1], {
			Image: '/u/r.jpg', Name: 'Re,Zero', Finished: true, ActualSeason: '01', ActualEpisode: '24', AnimeUrlName: 're-zero'
		});

		var single = "<div id='favorites'><div><a href='/episode/solo-s03e04/'><img src='/u/s.jpg'>"
			+ "<h2 class='a-favorites__title'>Solo</h2><span>Pokračuj</span></a></div></div><div id='planned'></div>";
		runner.equal('parseFavorites: varianta s apostrofy', Sync.parseFavorites(single).map(function (item) {
			return [item.Name, item.ActualSeason, item.ActualEpisode, item.Finished];
		}), [['Solo', '03', '04', false]]);

		runner.equal('parseFavorites: prázdná sekce', Sync.parseFavorites(favoritesPage([])), []);
		runner.equal('parseFavorites: chybějící sekce je chyba',
			errorSummary(thrown(function () { Sync.parseFavorites('<html><body>Přihlaste se</body></html>'); })),
			{ code: 'no-favorites', detail: '' });

		var fresh = Sync.getNewFavorites([{ Name: 'A' }, { Name: 'B' }, { Name: 'Owari no Seraph: Nagoja kessen hen' }, { Name: 'C' }],
			[{ FavoriteName: 'A' }, { FavoriteName: 'C' }]);
		runner.equal('getNewFavorites: vynechá známá anime a výjimky', fresh.map(function (item) { return item.Name; }), ['B']);

		runner.equal('parseSerialSeasons: řady a jejich stav', Sync.parseSerialSeasons(serialPage([['1', 'Videné'], ['2', 'Označiť']])),
			[{ season: '1', state: 'Videné' }, { season: '2', state: 'Označiť' }]);
		runner.equal('parseSerialSeasons: varianta s apostrofy', Sync.parseSerialSeasons(serialPage([['3', 'Označiť']], true)),
			[{ season: '3', state: 'Označiť' }]);
		runner.equal('parseSerialSeasons: stránka bez řad', Sync.parseSerialSeasons('<html><body>Nic</body></html>'), []);

		function check(seasons, season, episode) {
			return Sync.checkIfReallyNotFinished(seasons.map(function (entry) {
				return { season: entry[0], state: entry[1] };
			}), season, episode);
		}
		runner.equal('checkIfReallyNotFinished: všechny řady zhlédnuté = dokončeno', check([['1', 'Videné'], ['2', 'Videné']], '02', '07'),
			{ finished: true, season: '02', episode: '07' });
		runner.equal('checkIfReallyNotFinished: bez řad = dokončeno (jako Python)', check([], '01', '03'),
			{ finished: true, season: '01', episode: '03' });
		runner.equal('checkIfReallyNotFinished: nezhlédnutá řada z odkazu, epizoda zůstane', check([['1', 'Videné'], ['2', 'Označiť']], '02', '07'),
			{ finished: false, season: '02', episode: '07' });
		runner.equal('checkIfReallyNotFinished: jiná řada -> nula na začátku a epizoda --',
			check([['1', 'Videné'], ['2', 'Označiť'], ['3', 'Označiť']], '01', '12'), { finished: false, season: '02', episode: '--' });
		runner.equal('checkIfReallyNotFinished: řada 10 a víc bez nuly', check([['12', 'Označiť']], '03', '05'),
			{ finished: false, season: '12', episode: '--' });
		runner.equal('checkIfReallyNotFinished: rozhoduje první nezhlédnutá řada', check([['1', 'Označiť'], ['2', 'Označiť']], '02', '01'),
			{ finished: false, season: '01', episode: '--' });
		runner.equal('checkIfReallyNotFinished: nula se přidá i k řadě s nulou (jako Python)', check([['05', 'Označiť']], '01', '01'),
			{ finished: false, season: '005', episode: '--' });
	}

	/* ---------------------------------- ČSFD ---------------------------------- */

	function csfd(runner) {
		runner.equal('parseCsfdSerialId', Sync.parseCsfdSerialId(csfdSearchPage('1032664')), '1032664');
		runner.equal('parseCsfdSerialId: změněná stránka je chyba',
			errorSummary(thrown(function () { Sync.parseCsfdSerialId('<html></html>'); })),
			{ code: 'parse-error', detail: 'csfd-search' });

		var data = Sync.parseCsfdData(csfdFilmPage({
			names: [['Japonsko', 'Šúmacu no Valkyrie: dlouhý název'], ['Japonsko', 'Shuumatsu'], ['Japonsko', '終末のワルキューレ'],
				['USA', 'Record of Ragnarok'], ['Velká Británie', 'Record']],
			rating: '62 %',
			plot: 'První; druhý'
		}), '1032664');
		runner.equal('parseCsfdData: všechna pole ve stejném pořadí klíčů', Object.keys(data),
			['CsfdID', 'NameEn', 'NameJa', 'CsfdRating', 'Genres', 'Description']);
		runner.equal('parseCsfdData: ID', data.CsfdID, '1032664');
		runner.equal('parseCsfdData: japonský název s nejnižším kódem prvního znaku', data.NameJa, 'Shuumatsu');
		runner.equal('parseCsfdData: první nalezený anglický název', data.NameEn, 'Record of Ragnarok');
		runner.equal('parseCsfdData: hodnocení bez mezer', data.CsfdRating, '62%');
		runner.equal('parseCsfdData: žánry oddělené novým řádkem', data.Genres, 'Animovaný\nAkční');
		runner.equal('parseCsfdData: středník v popisu se nahradí čárkou', data.Description, 'První, druhý');

		var minimal = Sync.parseCsfdData(csfdFilmPage({ names: [], rating: '70%', plot: null }), '1');
		runner.equal('parseCsfdData: chybějící názvy a popis', [minimal.NameEn, minimal.NameJa, minimal.Description], ['', '', 'None']);

		var englishCodes = ['angličtina', 'USA', 'Austrálie', 'Velká Británie'].map(function (flag) {
			return Sync.parseCsfdData(csfdFilmPage({ names: [[flag, 'English ' + flag]], rating: '1%', plot: null }), '1').NameEn;
		});
		runner.equal('parseCsfdData: všechny vlajky anglického názvu', englishCodes,
			['English angličtina', 'English USA', 'English Austrálie', 'English Velká Británie']);

		runner.equal('parseCsfdData: chybí hlavní část stránky',
			errorSummary(thrown(function () { Sync.parseCsfdData(csfdFilmPage({ names: [], rating: '1%', main: false }), '1'); })),
			{ code: 'parse-error', detail: 'csfd-page' });
		runner.equal('parseCsfdData: chybí hodnocení',
			errorSummary(thrown(function () { Sync.parseCsfdData(csfdFilmPage({ names: [], rating: null }), '1'); })),
			{ code: 'parse-error', detail: 'csfd-rating' });
		runner.equal('parseCsfdData: chybí žánry',
			errorSummary(thrown(function () { Sync.parseCsfdData(csfdFilmPage({ names: [], rating: '1%', genres: null }), '1'); })),
			{ code: 'parse-error', detail: 'csfd-genres' });

		runner.equal('parseCsfdRating: hodnocení bez mezer', Sync.parseCsfdRating(csfdFilmPage({ names: [], rating: '85 %', genres: null, plot: null })), '85%');
		runner.equal('parseCsfdRating: nehodnocený seriál', Sync.parseCsfdRating(csfdFilmPage({ names: [], rating: '? %' })), '?%');
		runner.equal('parseCsfdRating: chybí hlavní část stránky',
			errorSummary(thrown(function () { Sync.parseCsfdRating(csfdFilmPage({ names: [], rating: '1%', main: false })); })),
			{ code: 'parse-error', detail: 'csfd-page' });
		runner.equal('parseCsfdRating: chybí hodnocení',
			errorSummary(thrown(function () { Sync.parseCsfdRating(csfdFilmPage({ names: [], rating: null })); })),
			{ code: 'parse-error', detail: 'csfd-rating' });
		['<span>85%</span>', '85', '1000%', '8 5 %x'].forEach(function (rating) {
			runner.equal('parseCsfdRating: nečekaný tvar hodnocení ' + rating,
				errorSummary(thrown(function () { Sync.parseCsfdRating(csfdFilmPage({ names: [], rating: rating })); })),
				{ code: 'parse-error', detail: 'csfd-rating' });
		});
		runner.equal('parseCsfdRating: 100 %', Sync.parseCsfdRating(csfdFilmPage({ names: [], rating: '100 %' })), '100%');
	}

	/* ------------------------------- MyAnimeList ------------------------------- */

	function mal(runner) {
		var searchUrl = 'https://myanimelist.net/anime.php?cat=anime&q=Naruto';
		runner.equal('parseMalSerial: z výsledků hledání', Sync.parseMalSerial(malSearchPage('20', 'Naruto'), searchUrl),
			{ id: '20', name: 'Naruto' });
		runner.equal('parseMalSerial: podtržítka a středníky v názvu',
			Sync.parseMalSerial(malSearchPage('7', 'Re;Zero_kara'), searchUrl), { id: '7', name: 'Re,Zero kara' });
		runner.equal('parseMalSerial: přesměrování rovnou na stránku anime',
			Sync.parseMalSerial('<html>stránka anime</html>', 'https://myanimelist.net/anime/51837/Some_Name%C5%A0'),
			{ id: '51837', name: 'Some NameŠ' });
		runner.equal('parseMalSerial: nenalezeno',
			errorSummary(thrown(function () { Sync.parseMalSerial(MAL_NOT_FOUND, searchUrl); })),
			{ code: 'mal-not-found', detail: '' });
		runner.equal('parseMalSerial: změněná stránka',
			errorSummary(thrown(function () { Sync.parseMalSerial('<html></html>', searchUrl); })),
			{ code: 'parse-error', detail: 'mal-search' });

		runner.equal('parseMalRating: procenta', [Sync.parseMalRating(malAnimePage('8.01')), Sync.parseMalRating(malAnimePage('7.5'))],
			['80%', '75%']);
		runner.equal('parseMalRating: zaokrouhlení jako Python round() a maximum',
			[Sync.parseMalRating(malAnimePage('7.65')), Sync.parseMalRating(malAnimePage('7.75')), Sync.parseMalRating(malAnimePage('10.00'))],
			['76%', '78%', '100%']);
		runner.equal('parseMalRating: skóre ve <span> před <div> se přeskočí',
			Sync.parseMalRating('<span itemprop="ratingValue" class="score-label score-9">9.10</span>' + malAnimePage('8.49')), '85%');
		runner.equal('parseMalRating: anime bez skóre (N/A) má ?%, ne číslo z dalšího prvku',
			Sync.parseMalRating('<div class="score-label score-na">N/A</div><div>Members <strong>169</strong></div>'), '?%');
		['abc', '1.2.3', '', '<b>8.0</b>'].forEach(function (score) {
			runner.equal('parseMalRating: nečekaný tvar ' + JSON.stringify(score) + ' je chyba',
				errorSummary(thrown(function () { Sync.parseMalRating(malAnimePage(score)); })),
				{ code: 'parse-error', detail: 'mal-rating' });
		});
		runner.equal('parseMalRating: bez skóre na stránce je chyba',
			errorSummary(thrown(function () { Sync.parseMalRating('<html><body>Members <strong>169</strong></body></html>'); })),
			{ code: 'parse-error', detail: 'mal-rating' });
	}

	/* ------------------------------- nová položka ------------------------------- */

	function newItem(runner) {
		var csfdData = { CsfdID: '111', NameEn: 'En', NameJa: 'Ja', Genres: 'G', Description: 'D', CsfdRating: '75%' };
		var unfinished = Sync.buildNewItem({ Name: 'New A', Finished: false, ActualSeason: '02', ActualEpisode: '07' },
			csfdData, { id: '222', name: 'Mal Name' }, '80%', 13, new Date(2024, 4, 17));
		runner.equal('buildNewItem: klíče ve stejném pořadí jako v Python skriptu', Object.keys(unfinished),
			['Number', 'FavoriteName', 'CsfdID', 'MalID', 'MalName', 'Image', 'NameEn', 'NameJa', 'Genres', 'Description',
				'Date', 'State', 'CsfdRating', 'MalRating', 'MyRating']);
		runner.equal('buildNewItem: rozpracované anime', unfinished, {
			Number: '13', FavoriteName: 'New A', CsfdID: '111', MalID: '222', MalName: 'Mal Name', Image: '13', NameEn: 'En',
			NameJa: 'Ja', Genres: 'G', Description: 'D', Date: '17.05.2024', State: 'S02E07', CsfdRating: '75%',
			MalRating: '80%', MyRating: '?%'
		});
		var finished = Sync.buildNewItem({ Name: 'New B', Finished: true, ActualSeason: '01', ActualEpisode: '12' },
			csfdData, { id: '1', name: 'M' }, '?%', 14, new Date(2024, 4, 17));
		runner.equal('buildNewItem: dokončené anime', [finished.State, finished.MalRating], ['DONE', '?%']);
	}

	function dataLayer(runner) {
		runner.equal('addItem před načtením dat vyhodí chybu', Boolean(thrown(function () { Data.addItem({ Number: '1' }); })), true);
	}

	/* ------------------------------ klient pomocníka ------------------------------ */

	function stubFetch(handler) {
		var original = window.fetch;
		var stub = { calls: [] };
		window.fetch = function (url, init) {
			stub.calls.push({ url: url, init: init });
			return handler(url, init);
		};
		stub.restore = function () {
			window.fetch = original;
		};
		return stub;
	}

	function reply(body, status, headers) {
		return Promise.resolve(new Response(body, { status: status, headers: headers || {} }));
	}

	function withFetch(handler, test) {
		var stub = stubFetch(handler);
		return Promise.resolve().then(function () {
			return test(stub);
		}).then(function (value) {
			stub.restore();
			return value;
		}, function (error) {
			stub.restore();
			throw error;
		});
	}

	function summarizeError(promise) {
		return promise.then(function () {
			return null;
		}, function (error) {
			return { code: error.code, detail: error.detail, status: error.status };
		});
	}

	function proxyClient(runner) {
		var base = Client.baseUrl();
		var healthBody = JSON.stringify({ ok: true, version: 2, cookieConfigured: true, maxImageNumber: '7', dataFile: true });

		return sequence([
			function () {
				return withFetch(function () { return reply(healthBody, 200); }, function (stub) {
					return Client.health().then(function (health) {
						runner.equal('health: výsledek', health, { version: 2, cookieConfigured: true, maxImageNumber: 7, dataFile: true });
						runner.equal('health: adresa a nastavení požadavku', [
							stub.calls[0].url, stub.calls[0].init.method, stub.calls[0].init.headers['X-Anime-Proxy'],
							stub.calls[0].init.credentials, stub.calls[0].init.cache
						], [base + '/health', 'GET', '1', 'omit', 'no-store']);
					});
				});
			},
			function () {
				return withFetch(function () { return reply(JSON.stringify({ ok: true, version: 1, cookieConfigured: false, maxImageNumber: 0 }), 200); }, function () {
					return Client.health().then(function (health) {
						runner.equal('health: starší pomocník bez dataFile', health, { version: 1, cookieConfigured: false, maxImageNumber: 0, dataFile: false });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('<html>jiná služba</html>', 200); }, function () {
					return summarizeError(Client.health()).then(function (error) {
						runner.equal('health: odpověď jiné služby', error, { code: 'unexpected-response', detail: 'health', status: 0 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('{}', 403, { 'X-Proxy-Error': 'origin-not-allowed', 'X-Proxy-Detail': 'x' }); }, function () {
					return summarizeError(Client.health()).then(function (error) {
						runner.equal('health: chyba pomocníka', error, { code: 'origin-not-allowed', detail: 'x', status: 403 });
					});
				});
			},
			function () {
				return withFetch(function () { return Promise.reject(new TypeError('Failed to fetch')); }, function () {
					return summarizeError(Client.health()).then(function (error) {
						runner.equal('health: neběžící pomocník', error, { code: 'unreachable', detail: base, status: 0 });
					});
				});
			},
			function () {
				var url = 'https://www.csfd.cz/hledat/?q=Naruto+Shippuden';
				return withFetch(function () {
					return reply('<html>ok</html>', 200, { 'X-Upstream-Status': '200', 'X-Final-Url': 'https://www.csfd.cz/film/1' });
				}, function (stub) {
					return Client.fetchPage(url).then(function (page) {
						runner.equal('fetchPage: výsledek', page, { text: '<html>ok</html>', status: 200, finalUrl: 'https://www.csfd.cz/film/1' });
						runner.equal('fetchPage: adresa je zakódovaná v parametru', stub.calls[0].url, base + '/fetch?url=' + encodeURIComponent(url));
					});
				});
			},
			function () {
				return withFetch(function () { return reply('x', 200, { 'X-Upstream-Status': '200' }); }, function () {
					return Client.fetchPage('https://www.csfd.cz/film/1').then(function (page) {
						runner.equal('fetchPage: bez X-Final-Url platí původní adresa', page.finalUrl, 'https://www.csfd.cz/film/1');
					});
				});
			},
			function () {
				return withFetch(function () { return reply('Not found', 200, { 'X-Upstream-Status': '404' }); }, function () {
					return summarizeError(Client.fetchPage('https://www.csfd.cz/film/1')).then(function (error) {
						runner.equal('fetchPage: chybový stav webu', error, { code: 'upstream-http', detail: '404', status: 404 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('No titles', 200, { 'X-Upstream-Status': '404' }); }, function () {
					return Client.fetchPage('https://myanimelist.net/anime.php?q=x', { acceptStatus: [404] }).then(function (page) {
						runner.equal('fetchPage: povolený chybový stav vrátí stránku', page,
							{ text: 'No titles', status: 404, finalUrl: 'https://myanimelist.net/anime.php?q=x' });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('Error', 200, { 'X-Upstream-Status': '500' }); }, function () {
					return summarizeError(Client.fetchPage('https://myanimelist.net/anime.php?q=x', { acceptStatus: [404] })).then(function (error) {
						runner.equal('fetchPage: nepovolený chybový stav je pořád chyba', error, { code: 'upstream-http', detail: '500', status: 500 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('x', 200); }, function () {
					return summarizeError(Client.fetchPage('https://www.csfd.cz/film/1')).then(function (error) {
						runner.equal('fetchPage: chybí stav webu', error, { code: 'unexpected-response', detail: 'upstream status', status: 0 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('{}', 502, { 'X-Proxy-Error': 'cloudflare-challenge' }); }, function () {
					return summarizeError(Client.fetchPage('https://sledujserialy.io/ucet/')).then(function (error) {
						runner.equal('fetchPage: chyba pomocníka', error, { code: 'cloudflare-challenge', detail: '', status: 502 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('Server error', 500); }, function () {
					return summarizeError(Client.fetchPage('https://sledujserialy.io/ucet/')).then(function (error) {
						runner.equal('fetchPage: odpověď bez hlavičky pomocníka', error, { code: 'unexpected-response', detail: 'HTTP 500', status: 500 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply(JSON.stringify({ ok: true, number: 12, bytes: 99 }), 201); }, function (stub) {
					return Client.saveImage('https://sledujserialy.io/upload/a.jpg', 12).then(function (saved) {
						runner.equal('saveImage: výsledek', saved, { number: 12, bytes: 99 });
						runner.equal('saveImage: požadavek', [
							stub.calls[0].url, stub.calls[0].init.method, stub.calls[0].init.headers['Content-Type'],
							JSON.parse(stub.calls[0].init.body)
						], [base + '/images', 'POST', 'application/json', { url: 'https://sledujserialy.io/upload/a.jpg', number: 12 }]);
					});
				});
			},
			function () {
				return withFetch(function () { return reply('{}', 409, { 'X-Proxy-Error': 'image-exists' }); }, function () {
					return summarizeError(Client.saveImage('https://sledujserialy.io/upload/a.jpg', 12)).then(function (error) {
						runner.equal('saveImage: obrázek už existuje', error, { code: 'image-exists', detail: '12', status: 409 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('nic', 201); }, function () {
					return summarizeError(Client.saveImage('https://sledujserialy.io/upload/a.jpg', 12)).then(function (error) {
						runner.equal('saveImage: neplatná odpověď', error, { code: 'unexpected-response', detail: 'images', status: 0 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply(JSON.stringify({ ok: true, changed: 1, missing: ['9'] }), 200); }, function (stub) {
					return Client.saveCsfdRatings({ 1: '85%', 9: '?%' }).then(function (saved) {
						runner.equal('saveCsfdRatings: výsledek', saved, { changed: 1, missing: ['9'] });
						runner.equal('saveCsfdRatings: požadavek', [
							stub.calls[0].url, stub.calls[0].init.method, stub.calls[0].init.headers['Content-Type'],
							stub.calls[0].init.headers['X-Anime-Proxy'], JSON.parse(stub.calls[0].init.body)
						], [base + '/csfd-ratings', 'POST', 'application/json', '1', { ratings: { 1: '85%', 9: '?%' } }]);
					});
				});
			},
			function () {
				return withFetch(function () { return reply('{}', 500, { 'X-Proxy-Error': 'data-write-failed', 'X-Proxy-Detail': 'PermissionError' }); }, function () {
					return summarizeError(Client.saveCsfdRatings({ 1: '85%' })).then(function (error) {
						runner.equal('saveCsfdRatings: chyba zápisu', error, { code: 'data-write-failed', detail: 'PermissionError', status: 500 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('{"ok": true}', 200); }, function () {
					return summarizeError(Client.saveCsfdRatings({ 1: '85%' })).then(function (error) {
						runner.equal('saveCsfdRatings: neplatná odpověď', error, { code: 'unexpected-response', detail: 'csfd-ratings', status: 0 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply(JSON.stringify({ ok: true, changed: 2, missing: [] }), 200); }, function (stub) {
					return Client.saveMalRatings({ 1: '76%', 2: '?%' }).then(function (saved) {
						runner.equal('saveMalRatings: výsledek', saved, { changed: 2, missing: [] });
						runner.equal('saveMalRatings: požadavek', [
							stub.calls[0].url, stub.calls[0].init.method, stub.calls[0].init.headers['Content-Type'],
							stub.calls[0].init.headers['X-Anime-Proxy'], JSON.parse(stub.calls[0].init.body)
						], [base + '/mal-ratings', 'POST', 'application/json', '1', { ratings: { 1: '76%', 2: '?%' } }]);
					});
				});
			},
			function () {
				return withFetch(function () { return reply('nic', 200); }, function () {
					return summarizeError(Client.saveMalRatings({ 1: '76%' })).then(function (error) {
						runner.equal('saveMalRatings: neplatná odpověď', error, { code: 'unexpected-response', detail: 'mal-ratings', status: 0 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply(JSON.stringify({ ok: true, changed: 1, missing: ['7'] }), 200); }, function (stub) {
					return Client.saveWatchedStates({ 1: 'DONE', 7: 'S02E--' }).then(function (saved) {
						runner.equal('saveWatchedStates: výsledek', saved, { changed: 1, missing: ['7'] });
						runner.equal('saveWatchedStates: požadavek', [
							stub.calls[0].url, stub.calls[0].init.method, stub.calls[0].init.headers['Content-Type'],
							stub.calls[0].init.headers['X-Anime-Proxy'], JSON.parse(stub.calls[0].init.body)
						], [base + '/watched-states', 'POST', 'application/json', '1', { states: { 1: 'DONE', 7: 'S02E--' } }]);
					});
				});
			},
			function () {
				return withFetch(function () { return reply('{"ok": true}', 200); }, function () {
					return summarizeError(Client.saveWatchedStates({ 1: 'DONE' })).then(function (error) {
						runner.equal('saveWatchedStates: neplatná odpověď', error, { code: 'unexpected-response', detail: 'watched-states', status: 0 });
					});
				});
			},
			function () {
				var items = [{ Number: '13', FavoriteName: 'New A' }, { Number: '14', FavoriteName: 'New B' }];
				return withFetch(function () { return reply(JSON.stringify({ ok: true, added: 2 }), 200); }, function (stub) {
					return Client.saveAnimeItems(items).then(function (saved) {
						runner.equal('saveAnimeItems: výsledek', saved, { added: 2 });
						runner.equal('saveAnimeItems: požadavek', [
							stub.calls[0].url, stub.calls[0].init.method, stub.calls[0].init.headers['Content-Type'],
							stub.calls[0].init.headers['X-Anime-Proxy'], JSON.parse(stub.calls[0].init.body)
						], [base + '/anime-items', 'POST', 'application/json', '1', { items: items }]);
					});
				});
			},
			function () {
				return withFetch(function () { return reply(JSON.stringify({ ok: true, changed: 1, missing: [] }), 200); }, function () {
					return summarizeError(Client.saveAnimeItems([{ Number: '13' }])).then(function (error) {
						runner.equal('saveAnimeItems: neplatná odpověď', error, { code: 'unexpected-response', detail: 'anime-items', status: 0 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('{}', 409, { 'X-Proxy-Error': 'item-exists', 'X-Proxy-Detail': '13' }); }, function () {
					return summarizeError(Client.saveAnimeItems([{ Number: '13' }])).then(function (error) {
						runner.equal('saveAnimeItems: číslo už v souboru je', error, { code: 'item-exists', detail: '13', status: 409 });
					});
				});
			},
			function () {
				// Časovač se spustí hned a pozastavené spojení se přeruší, jako by uplynul limit.
				var originalSetTimeout = window.setTimeout;
				var delays = [];
				window.setTimeout = function (callback, delay) {
					delays.push(delay);
					return originalSetTimeout.call(window, callback, 0);
				};
				return withFetch(function (url, init) {
					return new Promise(function (resolve, reject) {
						init.signal.addEventListener('abort', function () {
							reject(new DOMException('Aborted', 'AbortError'));
						});
					});
				}, function () {
					return summarizeError(Client.fetchPage('https://www.csfd.cz/film/1'));
				}).then(function (error) {
					window.setTimeout = originalSetTimeout;
					runner.equal('fetchPage: vypršel časový limit', error, { code: 'timeout', detail: base, status: 0 });
					runner.equal('fetchPage: časový limit je jedna minuta', delays, [60000]);
				}, function (failure) {
					window.setTimeout = originalSetTimeout;
					throw failure;
				});
			},
			function () {
				var key = Client.URL_STORAGE_KEY;
				var previous = window.localStorage.getItem(key);
				try {
					window.localStorage.setItem(key, 'http://localhost:9000');
					var allowed = Client.baseUrl();
					window.localStorage.setItem(key, 'http://example.com:9000');
					var foreign = Client.baseUrl();
					window.localStorage.setItem(key, 'https://127.0.0.1:9000');
					var insecure = Client.baseUrl();
					runner.equal('baseUrl: jen adresy smyčky', [allowed, foreign, insecure],
						['http://localhost:9000', Client.DEFAULT_URL, Client.DEFAULT_URL]);
				} finally {
					if (previous === null) {
						window.localStorage.removeItem(key);
					} else {
						window.localStorage.setItem(key, previous);
					}
				}
			}
		]);
	}

	/* -------------------------------- tok aktualizace -------------------------------- */

	function csfdFilmFor(show) {
		return csfdFilmPage({
			names: [['Japonsko', show.nameJa], [show.flag || 'angličtina', show.nameEn]],
			rating: show.csfdRating,
			plot: show.plot
		});
	}

	function addShowRoutes(routes, show) {
		routes[Sync.csfdSearchUrl(show.name)] = csfdSearchPage(show.csfdId);
		routes['https://www.csfd.cz/film/' + show.csfdId] = csfdFilmFor(show);
		routes[Sync.malSearchUrl(show.name)] = malSearchPage(show.malId, show.malSlug);
		routes['https://myanimelist.net/anime/' + show.malId] = malAnimePage(show.malScore);
	}

	var SHOW_A = {
		name: 'New A', slug: 'new-a', season: '02', episode: '07', image: '/u/a.jpg', finished: false,
		csfdId: '111', nameEn: 'New A EN', nameJa: 'Atarashii A', csfdRating: '75%', plot: 'Popis A',
		malId: '222', malSlug: 'New_A', malScore: '8.2'
	};
	var SHOW_B = {
		name: 'New B', slug: 'new-b', season: '01', episode: '12', image: '/u/b.jpg', finished: true,
		csfdId: '333', nameEn: 'New B EN', nameJa: 'Atarashii B', csfdRating: '64%', plot: 'Popis B; s čárkou', flag: 'USA',
		malId: '444', malSlug: 'New_B', malScore: '7.5'
	};
	var KNOWN_FAVORITE = { name: 'Known', slug: 'known', season: '01', episode: '12', image: '/u/known.jpg', finished: true };
	var EXCEPTION_FAVORITE = {
		name: 'Owari no Seraph: Nagoja kessen hen', slug: 'owari', season: '01', episode: '01', image: '/u/o.jpg', finished: false
	};

	function knownItems() {
		return [
			{ Number: '3', FavoriteName: 'Known', Image: '3' },
			{ Number: '10', FavoriteName: 'Known Ten', Image: '10' }
		];
	}

	function expectedItemA(number) {
		return {
			Number: String(number), FavoriteName: 'New A', CsfdID: '111', MalID: '222', MalName: 'New A', Image: String(number),
			NameEn: 'New A EN', NameJa: 'Atarashii A', Genres: 'Animovaný\nAkční', Description: 'Popis A', Date: '17.05.2024',
			State: 'S02E07', CsfdRating: '75%', MalRating: '82%', MyRating: '?%'
		};
	}

	function expectedItemB(number) {
		return {
			Number: String(number), FavoriteName: 'New B', CsfdID: '333', MalID: '444', MalName: 'New B', Image: String(number),
			NameEn: 'New B EN', NameJa: 'Atarashii B', Genres: 'Animovaný\nAkční', Description: 'Popis B, s čárkou', Date: '17.05.2024',
			State: 'DONE', CsfdRating: '64%', MalRating: '75%', MyRating: '?%'
		};
	}

	/**
	 * Spustí aktualizaci s atrapou pomocníka a dat.
	 * @param {Object} setup - routes (adresa -> text | {text, finalUrl} | Error), items (null = data nejsou načtená),
	 *   health, imageError (number -> Error | null), writeError (chyba zápisu do souboru),
	 *   storedItems (jsou uložené úpravy v prohlížeči)
	 * @returns {Promise<{result, error, events, calls, images, items, writes, saves}>}
	 */
	function runUpdate(setup) {
		var events = [];
		var calls = [];
		var images = [];
		var writes = [];
		var saves = [];
		var items = setup.items === null ? null : (setup.items || knownItems());
		var proxy = {
			health: function () {
				events.push('health');
				if (setup.healthGate) {
					return setup.healthGate.then(function () {
						return setup.health;
					});
				}
				return Promise.resolve(setup.health || listHealth());
			},
			fetchPage: function (url, options) {
				calls.push(url);
				var route = setup.routes[url];
				if (route instanceof Error) {
					return Promise.reject(route);
				}
				if (route === undefined) {
					return Promise.reject(makeError('test-missing-route', url));
				}
				var page = typeof route === 'string' ? { text: route } : route;
				var status = page.status || 200;
				var accepted = (options && options.acceptStatus) || [];
				if (status >= 400 && accepted.indexOf(status) === -1) {
					return Promise.reject(makeError('upstream-http', String(status), status));
				}
				return Promise.resolve({ text: page.text, status: status, finalUrl: page.finalUrl || url });
			},
			saveImage: function (url, number) {
				images.push({ url: url, number: number });
				var failure = setup.imageError ? setup.imageError(number) : null;
				events.push('image:' + number);
				return failure ? Promise.reject(failure) : Promise.resolve({ number: number, bytes: 10 });
			},
			saveAnimeItems: function (added) {
				writes.push(JSON.parse(JSON.stringify(added)));
				events.push('write');
				if (setup.writeError) {
					return Promise.reject(setup.writeError);
				}
				return Promise.resolve({ added: added.length });
			}
		};
		var data = {
			getItems: function () {
				return items;
			},
			addItem: function (item) {
				items.push(item);
				return items;
			},
			save: function (all) {
				saves.push(all.map(function (item) { return item.Number; }));
				events.push('save');
			},
			hasStoredItems: function () {
				return Boolean(setup.storedItems);
			}
		};
		return Sync.updateList({
			proxy: proxy,
			data: data,
			now: function () { return new Date(2024, 4, 17); },
			onTotal: function (total) { events.push('total:' + total); },
			onProgress: function (percent) { events.push('progress:' + percent.toFixed(2)); },
			onItemAdded: function (item, all) {
				events.push('added:' + item.Number + '/' + all.length);
			}
		}).then(function (result) {
			return { result: result, error: null, events: events, calls: calls, images: images, items: items, writes: writes, saves: saves };
		}, function (error) {
			return { result: null, error: error, events: events, calls: calls, images: images, items: items, writes: writes, saves: saves };
		});
	}

	// Odpověď /health pomocníka, který umí Seznam (obrázky ze sledujserialy.io, zápis do data/anime.json).
	function listHealth(overrides) {
		var health = { version: 6, cookieConfigured: true, maxImageNumber: 12, dataFile: true };
		Object.keys(overrides || {}).forEach(function (key) {
			health[key] = overrides[key];
		});
		return health;
	}

	function numbersOf(items) {
		return items.map(function (item) { return item.Number; });
	}

	function twoNewFavorites() {
		var routes = {};
		routes[Sync.FAVORITES_URL] = favoritesPage([KNOWN_FAVORITE, SHOW_A, EXCEPTION_FAVORITE, SHOW_B]);
		addShowRoutes(routes, SHOW_A);
		addShowRoutes(routes, SHOW_B);
		return routes;
	}

	function flows(runner) {
		return sequence([
			function () {
				return runUpdate({ routes: twoNewFavorites() }).then(function (run) {
					runner.equal('tok: bez chyby', run.error && run.error.message, null);
					runner.equal('tok: výsledek', run.result && [run.result.total, run.result.added.length], [2, 2]);
					runner.equal('tok: pořadí kroků, průběh, obrázek jako poslední krok položky a jeden zápis do souboru na konci', run.events, [
						'health', 'total:2',
						'progress:10.00', 'progress:20.00', 'progress:30.00', 'progress:40.00', 'image:13', 'progress:50.00', 'added:13/3',
						'progress:60.00', 'progress:70.00', 'progress:80.00', 'progress:90.00', 'image:14', 'progress:100.00', 'added:14/4',
						'write'
					]);
					runner.equal('tok: stahované stránky', run.calls, [
						Sync.FAVORITES_URL,
						Sync.csfdSearchUrl('New A'), 'https://www.csfd.cz/film/111', Sync.malSearchUrl('New A'), 'https://myanimelist.net/anime/222',
						Sync.csfdSearchUrl('New B'), 'https://www.csfd.cz/film/333', Sync.malSearchUrl('New B'), 'https://myanimelist.net/anime/444'
					]);
					runner.equal('tok: obrázky ze sledujserialy.io pod číslem anime', run.images, [
						{ url: 'https://sledujserialy.io/u/a.jpg', number: 13 }, { url: 'https://sledujserialy.io/u/b.jpg', number: 14 }
					]);
					runner.equal('tok: přidané položky', run.items.slice(2), [expectedItemA(13), expectedItemB(14)]);
					runner.equal('tok: původní položky zůstanou', run.items.slice(0, 2), knownItems());
					runner.equal('tok: vrácené položky', run.result && run.result.added, [expectedItemA(13), expectedItemB(14)]);
					runner.equal('tok: do souboru jdou jen přidaná anime', run.writes, [[expectedItemA(13), expectedItemB(14)]]);
					runner.equal('tok: bez uložených úprav se do prohlížeče neukládá', run.saves, []);
					runner.equal('tok: zapsáno do souboru', run.result && [run.result.total, run.result.savedTo], [2, 'file']);
				});
			},
			function () {
				return runUpdate({ routes: twoNewFavorites(), storedItems: true }).then(function (run) {
					runner.equal('s uloženými úpravami: zapíše soubor i prohlížeč', [run.events.slice(-2), run.saves, run.result && run.result.savedTo],
						[['write', 'save'], [['3', '10', '13', '14']], 'file']);
				});
			},
			function () {
				return runUpdate({ routes: twoNewFavorites(), writeError: makeError('item-exists', '13', 409) }).then(function (run) {
					runner.equal('zápis do souboru selže: chyba data-save-failed s příčinou', errorSummary(run.error),
						{ code: 'data-save-failed', detail: 'item-exists 13' });
					runner.equal('zápis do souboru selže: anime zůstanou v prohlížeči',
						[run.error && run.error.savedTo, run.error && run.error.added, run.saves, numbersOf(run.items)],
						['browser', 2, [['3', '10', '13', '14']], ['3', '10', '13', '14']]);
					runner.equal('zápis do souboru selže: chyba nemá anime', Boolean(run.error && run.error.favorite), false);
				});
			},
			function () {
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([KNOWN_FAVORITE, EXCEPTION_FAVORITE]);
				return runUpdate({ routes: routes }).then(function (run) {
					runner.equal('bez nových anime: výsledek', run.result, { total: 0, added: [], savedTo: null });
					runner.equal('bez nových anime: jen seznam oblíbených, žádný průběh ani zápis', [run.calls, run.events], [[Sync.FAVORITES_URL], ['health', 'total:0']]);
				});
			},
			function () {
				var ikenaikyo = { name: 'Ikenaikyo', slug: 'ikenaikyo', season: '01', episode: '03', image: '/u/i.jpg', finished: false,
					csfdId: '1415876', nameEn: 'Ikenaikyo EN', nameJa: 'Ikenaikyo JA', csfdRating: '50%', plot: 'Popis I',
					malId: '555', malSlug: 'Ikenaikyo', malScore: '6.1' };
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([ikenaikyo]);
				addShowRoutes(routes, ikenaikyo);
				return runUpdate({ routes: routes }).then(function (run) {
					runner.equal('Ikenaikyo: ČSFD ID je zadané ručně, hledání na ČSFD se přeskočí', run.calls, [
						Sync.FAVORITES_URL, 'https://www.csfd.cz/film/1415876', Sync.malSearchUrl('Ikenaikyo'), 'https://myanimelist.net/anime/555'
					]);
					runner.equal('Ikenaikyo: položka', run.items[2] && [run.items[2].CsfdID, run.items[2].MalRating], ['1415876', '61%']);
				});
			},
			function () {
				var zero = { name: 'Zero', slug: 'zero', season: '01', episode: '01', image: '/u/z.jpg', finished: false,
					csfdId: '666', nameEn: 'Zero EN', nameJa: 'Zero JA', csfdRating: '10%', plot: 'Popis Z', malId: '0', malSlug: 'Zero', malScore: '1.0' };
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([zero]);
				addShowRoutes(routes, zero);
				return runUpdate({ routes: routes }).then(function (run) {
					runner.equal('MAL ID 0: hodnocení se nestahuje a zůstane ?%',
						[run.calls.indexOf('https://myanimelist.net/anime/0'), run.items[2] && run.items[2].MalRating, run.items[2] && run.items[2].MalID],
						[-1, '?%', '0']);
				});
			},
			function () {
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([SHOW_A]);
				addShowRoutes(routes, SHOW_A);
				// MAL při jednoznačném názvu přesměruje rovnou na stránku anime.
				routes[Sync.malSearchUrl('New A')] = { text: '<html>stránka anime</html>', finalUrl: 'https://myanimelist.net/anime/51837/Redirect_Name' };
				routes['https://myanimelist.net/anime/51837'] = malAnimePage('9.0');
				return runUpdate({ routes: routes }).then(function (run) {
					var item = run.items[2];
					runner.equal('MAL přesměrování: ID, název a hodnocení', item && [item.MalID, item.MalName, item.MalRating],
						['51837', 'Redirect Name', '90%']);
				});
			},
			function () {
				return runUpdate({ routes: {}, health: listHealth({ cookieConfigured: false, maxImageNumber: 0 }) }).then(function (run) {
					runner.equal('chybí cookie: chyba a žádné stahování', [errorSummary(run.error), run.calls], [{ code: 'cookie-missing', detail: '' }, []]);
				});
			},
			function () {
				// Starší pomocník by obrázky ze sledujserialy.io nestáhl; kontroly jdou ve stejném pořadí jako u ostatních voleb.
				var outdated = listHealth({ version: 5, cookieConfigured: false, dataFile: false });
				return runUpdate({ routes: twoNewFavorites(), health: outdated }).then(function (run) {
					runner.equal('pomocník verze 5: zastaralý, nic se nestahuje', [errorSummary(run.error), run.calls, run.events],
						[{ code: 'helper-outdated', detail: '' }, [], ['health']]);
				});
			},
			function () {
				return runUpdate({ routes: twoNewFavorites(), health: listHealth({ dataFile: false, cookieConfigured: false }) }).then(function (run) {
					runner.equal('pomocník bez datového souboru: chyba před kontrolou cookie a nic se nestahuje', [errorSummary(run.error), run.calls],
						[{ code: 'data-file-missing', detail: '' }, []]);
				});
			},
			function () {
				return runUpdate({ routes: {}, items: null }).then(function (run) {
					runner.equal('data nejsou načtená: chyba ještě před dotazem na pomocníka', [errorSummary(run.error), run.events],
						[{ code: 'data-not-loaded', detail: '' }, []]);
				});
			},
			function () {
				// MyAnimeList odpovídá na hledání bez výsledků kódem 404 a stránkou "No titles that matched".
				var routes = twoNewFavorites();
				routes[Sync.malSearchUrl('New B')] = { text: MAL_NOT_FOUND, status: 404 };
				return runUpdate({ routes: routes }).then(function (run) {
					runner.equal('chyba uprostřed: kód a anime, u kterého nastala', [run.error && run.error.code, run.error && run.error.favorite],
						['mal-not-found', 'New B']);
					runner.equal('chyba uprostřed: první anime zůstane, druhé se nepřidá a nemá obrázek',
						[run.items.map(function (item) { return item.Number; }), run.images.length], [['3', '10', '13'], 1]);
					runner.equal('chyba uprostřed: hotové anime se zapíše do souboru',
						[run.writes, run.error && run.error.added, run.error && run.error.savedTo, run.saves], [[[expectedItemA(13)]], 1, 'file', []]);
				});
			},
			function () {
				var routes = twoNewFavorites();
				routes[Sync.malSearchUrl('New B')] = { text: MAL_NOT_FOUND, status: 404 };
				return runUpdate({ routes: routes, writeError: makeError('helper-unreachable', '') }).then(function (run) {
					runner.equal('chyba uprostřed a selhaný zápis: zůstane původní chyba, anime jen v prohlížeči',
						[run.error && run.error.code, run.error && run.error.added, run.error && run.error.savedTo, run.saves],
						['mal-not-found', 1, 'browser', [['3', '10', '13']]]);
				});
			},
			function () {
				var routes = twoNewFavorites();
				routes[Sync.malSearchUrl('New A')] = { text: MAL_NOT_FOUND, status: 404 };
				return runUpdate({ routes: routes }).then(function (run) {
					runner.equal('chyba u prvního anime: nic se nezapisuje',
						[run.error && run.error.code, run.writes, run.saves, run.error && run.error.added, run.error && run.error.savedTo],
						['mal-not-found', [], [], 0, null]);
				});
			},
			function () {
				var routes = twoNewFavorites();
				routes[Sync.malSearchUrl('New A')] = { text: '<html>Not found</html>', status: 404 };
				return runUpdate({ routes: routes }).then(function (run) {
					runner.equal('hledání na MAL: HTTP 404 bez vysvětlující stránky je chyba webu',
						[run.error && run.error.code, run.error && run.error.detail, run.error && run.error.status, run.error && run.error.favorite],
						['upstream-http', '404', 404, 'New A']);
				});
			},
			function () {
				var routes = twoNewFavorites();
				routes[Sync.malSearchUrl('New A')] = { text: '<html>Server error</html>', status: 503 };
				return runUpdate({ routes: routes }).then(function (run) {
					runner.equal('hledání na MAL: jiný chybový stav je chyba webu', [run.error && run.error.code, run.error && run.error.status],
						['upstream-http', 503]);
				});
			},
			function () {
				return runUpdate({
					routes: twoNewFavorites(),
					imageError: function (number) { return number === 13 ? makeError('image-exists', '13', 409) : null; }
				}).then(function (run) {
					runner.equal('obrázek už existuje: položka se nepřidá', [run.error && run.error.code, run.error && run.error.favorite, run.items.length],
						['image-exists', 'New A', 2]);
				});
			},
			function () {
				var routes = twoNewFavorites();
				routes['https://www.csfd.cz/film/111'] = makeError('upstream-http', '404', 404);
				return runUpdate({ routes: routes }).then(function (run) {
					runner.equal('chyba webu při stahování: kód se zachová', [run.error && run.error.code, run.error && run.error.status, run.error && run.error.favorite],
						['upstream-http', 404, 'New A']);
				});
			},
			function () {
				var routes = twoNewFavorites();
				routes[Sync.csfdSearchUrl('New A')] = '<html>změněný vzhled</html>';
				return runUpdate({ routes: routes }).then(function (run) {
					runner.equal('změněná stránka ČSFD: parse-error s označením kroku', [errorSummary(run.error), run.error && run.error.favorite],
						[{ code: 'parse-error', detail: 'csfd-search' }, 'New A']);
				});
			},
			function () {
				var third = { name: 'New C', slug: 'new-c', season: '01', episode: '01', image: '/u/c.jpg', finished: false,
					csfdId: '777', nameEn: 'C EN', nameJa: 'C JA', csfdRating: '55%', plot: 'Popis C', malId: '888', malSlug: 'New_C', malScore: '5.5' };
				var routes = twoNewFavorites();
				routes[Sync.FAVORITES_URL] = favoritesPage([SHOW_A, SHOW_B, third]);
				addShowRoutes(routes, third);
				return runUpdate({ routes: routes }).then(function (run) {
					var percents = run.events.filter(function (event) {
						return event.indexOf('progress:') === 0;
					}).map(function (event) {
						return parseFloat(event.slice(9));
					});
					var ascending = percents.every(function (value, index) {
						return index === 0 || value >= percents[index - 1];
					});
					runner.equal('průběh tří anime: 15 kroků, první 6.67 %, poslední 100 %', [percents.length, percents[0], percents[14], ascending],
						[15, 6.67, 100, true]);
				});
			},
			function () {
				// Souběžný běh se odmítne, po dokončení i po chybě jde aktualizaci spustit znovu.
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([KNOWN_FAVORITE]);
				var release;
				var gate = new Promise(function (resolve) { release = resolve; });
				var first = runUpdate({ routes: routes, healthGate: gate, health: listHealth({ maxImageNumber: 0 }) });
				return Promise.resolve().then(function () {
					return runUpdate({ routes: routes });
				}).then(function (second) {
					runner.equal('souběžná aktualizace se odmítne', errorSummary(second.error), { code: 'already-running', detail: '' });
					release();
					return first;
				}).then(function (firstRun) {
					runner.equal('původní aktualizace doběhne', firstRun.result, { total: 0, added: [], savedTo: null });
					return runUpdate({ routes: routes });
				}).then(function (afterSuccess) {
					runner.equal('po dokončení jde aktualizaci spustit znovu', afterSuccess.result, { total: 0, added: [], savedTo: null });
					return runUpdate({ routes: {}, health: listHealth({ cookieConfigured: false, maxImageNumber: 0 }) });
				}).then(function (failed) {
					runner.equal('aktualizace skončí chybou', errorSummary(failed.error), { code: 'cookie-missing', detail: '' });
					return runUpdate({ routes: routes });
				}).then(function (afterError) {
					runner.equal('po chybě jde aktualizaci spustit znovu', afterError.result, { total: 0, added: [], savedTo: null });
				});
			}
		]);
	}

	/* ------------------------- tok ČSFD hodnocení ------------------------- */

	function ratingItems(count) {
		var items = [];
		for (var index = 1; index <= count; index += 1) {
			items.push({ Number: String(index), FavoriteName: 'Fav ' + index, CsfdID: String(100 + index), MalID: String(200 + index),
				NameEn: 'Anime ' + index, State: index === 2 ? 'DROPPED' : 'DONE', CsfdRating: '50%', MalRating: '60%' });
		}
		return items;
	}

	function filmUrl(id) {
		return 'https://www.csfd.cz/film/' + id;
	}

	function ratingPage(rating) {
		return csfdFilmPage({ names: [], rating: rating });
	}

	function malUrl(id) {
		return 'https://myanimelist.net/anime/' + id;
	}

	/**
	 * Spustí aktualizaci ČSFD hodnocení s atrapou pomocníka a dat.
	 * @param {Object} setup - routes (adresa -> text | Error), items, health, healthError, healthGate,
	 *     missing (čísla, která v souboru nejsou), writeError, storedItems (jsou uložené úpravy v prohlížeči)
	 */
	function runCsfdUpdate(setup) {
		return runFieldUpdate(setup, { update: Sync.updateCsfd, save: 'saveCsfdRatings', field: 'CsfdRating', version: 2 });
	}

	/** Totéž pro MAL hodnocení (pomocník verze 3, zápis přes saveMalRatings). */
	function runMalUpdate(setup) {
		return runFieldUpdate(setup, { update: Sync.updateMal, save: 'saveMalRatings', field: 'MalRating', version: 3 });
	}

	/** Totéž pro zhlédnuté epizody (pomocník verze 4 s cookie, zápis přes saveWatchedStates). */
	function runWatchedUpdate(setup) {
		return runFieldUpdate(setup, { update: Sync.updateWatched, save: 'saveWatchedStates', field: 'State', version: 4, cookie: true });
	}

	function runFieldUpdate(setup, kind) {
		var events = [];
		var calls = [];
		var saves = [];
		var writes = [];
		var items = setup.items === null ? null : (setup.items || ratingItems(3));
		var proxy = {
			health: function () {
				events.push('health');
				if (setup.healthError) {
					return Promise.reject(setup.healthError);
				}
				var ready = setup.health || { version: kind.version, cookieConfigured: Boolean(kind.cookie), maxImageNumber: 0, dataFile: true };
				return setup.healthGate ? setup.healthGate.then(function () { return ready; }) : Promise.resolve(ready);
			},
			fetchPage: function (url) {
				calls.push(url);
				var route = setup.routes[url];
				if (route instanceof Error) {
					return Promise.reject(route);
				}
				if (route === undefined) {
					return Promise.reject(makeError('test-missing-route', url));
				}
				return Promise.resolve({ text: route, status: 200, finalUrl: url });
			},
			saveCsfdRatings: function () {
				return Promise.reject(makeError('test-wrong-save', 'saveCsfdRatings'));
			},
			saveMalRatings: function () {
				return Promise.reject(makeError('test-wrong-save', 'saveMalRatings'));
			},
			saveWatchedStates: function () {
				return Promise.reject(makeError('test-wrong-save', 'saveWatchedStates'));
			}
		};
		proxy[kind.save] = function (values) {
			writes.push(JSON.parse(JSON.stringify(values)));
			events.push('write');
			if (setup.writeError) {
				return Promise.reject(setup.writeError);
			}
			return Promise.resolve({ changed: 0, missing: setup.missing || [] });
		};
		var data = {
			getItems: function () {
				return items;
			},
			save: function (all) {
				saves.push(all.map(function (item) { return item[kind.field]; }));
				events.push('save');
			},
			hasStoredItems: function () {
				return Boolean(setup.storedItems);
			}
		};
		return kind.update({
			proxy: proxy,
			data: data,
			onProgress: function (percent) { events.push('progress:' + percent.toFixed(2)); }
		}).then(function (result) {
			return { result: result, error: null, events: events, calls: calls, saves: saves, writes: writes, items: items };
		}, function (error) {
			return { result: null, error: error, events: events, calls: calls, saves: saves, writes: writes, items: items };
		});
	}

	function ratingsOf(items, field) {
		return items.map(function (item) { return item[field || 'CsfdRating']; });
	}

	function savedState(error) {
		return error && [error.savedTo, error.updated, error.notInFile];
	}

	function csfdFlows(runner) {
		return sequence([
			function () {
				var routes = {};
				routes[filmUrl(101)] = ratingPage('81 %');
				routes[filmUrl(102)] = ratingPage('50%');
				routes[filmUrl(103)] = ratingPage('? %');
				return runCsfdUpdate({ routes: routes }).then(function (run) {
					runner.equal('ČSFD: bez chyby', run.error && run.error.message, null);
					runner.equal('ČSFD: všechna anime včetně DROPPED, v pořadí dat', run.calls, [filmUrl(101), filmUrl(102), filmUrl(103)]);
					runner.equal('ČSFD: průběh jako Python (100 * index / počet) a jeden zápis do souboru na konci', run.events,
						['health', 'progress:0.00', 'progress:33.33', 'progress:66.67', 'write']);
					runner.equal('ČSFD: nové hodnoty', ratingsOf(run.items), ['81%', '50%', '?%']);
					runner.equal('ČSFD: do souboru jdou všechna zjištěná hodnocení', run.writes, [{ 1: '81%', 2: '50%', 3: '?%' }]);
					runner.equal('ČSFD: bez uložených úprav se do prohlížeče neukládá', run.saves, []);
					runner.equal('ČSFD: výsledek', run.result,
						{ total: 3, updated: 3, changed: 2, failures: [], savedTo: 'file', notInFile: [] });
				});
			},
			function () {
				var routes = {};
				routes[filmUrl(101)] = ratingPage('81%');
				return runCsfdUpdate({ routes: routes, items: ratingItems(1), storedItems: true }).then(function (run) {
					runner.equal('ČSFD s uloženými úpravami: zapíše soubor i prohlížeč', [run.events.slice(-2), run.writes, run.saves],
						[['write', 'save'], [{ 1: '81%' }], [['81%']]]);
					runner.equal('ČSFD s uloženými úpravami: výsledek', run.result && run.result.savedTo, 'file');
				});
			},
			function () {
				var routes = {};
				routes[filmUrl(101)] = ratingPage('81%');
				routes[filmUrl(102)] = ratingPage('82%');
				routes[filmUrl(103)] = ratingPage('83%');
				return runCsfdUpdate({ routes: routes, missing: ['2', '3'], storedItems: true }).then(function (run) {
					runner.equal('ČSFD anime mimo soubor: vypíšou se', run.result && run.result.notInFile,
						[{ name: 'Anime 2', number: '2' }, { name: 'Anime 3', number: '3' }]);
					runner.equal('ČSFD anime mimo soubor: hodnocení zůstanou v prohlížeči', run.saves, [['81%', '82%', '83%']]);
				});
			},
			function () {
				var items = ratingItems(4);
				items[0].NameEn = '';
				items[2].CsfdID = 'abc';
				var routes = {};
				routes[filmUrl(101)] = makeError('upstream-http', '404', 404);
				routes[filmUrl(102)] = '<html>jiná stránka</html>';
				routes[filmUrl(104)] = ratingPage('70%');
				return runCsfdUpdate({ routes: routes, items: items }).then(function (run) {
					runner.equal('ČSFD přeskočení: bez chyby', run.error && run.error.message, null);
					runner.equal('ČSFD přeskočení: nečíselné ID bez dotazu', run.calls, [filmUrl(101), filmUrl(102), filmUrl(104)]);
					runner.equal('ČSFD přeskočení: selhaná anime si nechají původní hodnotu', ratingsOf(run.items), ['50%', '50%', '50%', '70%']);
					runner.equal('ČSFD přeskočení: seznam selhaných', run.result && run.result.failures, [
						{ name: 'Fav 1', number: '1', code: 'upstream-http', detail: '404' },
						{ name: 'Anime 2', number: '2', code: 'parse-error', detail: 'csfd-page' },
						{ name: 'Anime 3', number: '3', code: 'bad-csfd-id', detail: 'abc' }
					]);
					runner.equal('ČSFD přeskočení: počty', run.result && [run.result.updated, run.result.changed], [1, 1]);
					runner.equal('ČSFD přeskočení: do souboru jen zjištěná hodnocení', run.writes, [{ 4: '70%' }]);
				});
			},
			function () {
				var routes = {};
				routes[filmUrl(101)] = ratingPage('<b>81%</b>');
				routes[filmUrl(102)] = ratingPage('82%');
				return runCsfdUpdate({ routes: routes, items: ratingItems(2) }).then(function (run) {
					runner.equal('ČSFD hodnocení nečekaného tvaru: přeskočí se a nezapíše',
						[run.result && run.result.failures.map(function (f) { return [f.number, f.code, f.detail]; }), run.writes],
						[[['1', 'parse-error', 'csfd-rating']], [{ 2: '82%' }]]);
				});
			},
			function () {
				var routes = {};
				routes[filmUrl(101)] = makeError('timeout', '');
				routes[filmUrl(102)] = makeError('timeout', '');
				return runCsfdUpdate({ routes: routes, items: ratingItems(2) }).then(function (run) {
					runner.equal('ČSFD nic nezjištěno: soubor se nezapisuje',
						[run.writes, run.saves, run.result && run.result.savedTo, run.result && run.result.failures.length], [[], [], null, 2]);
				});
			},
			function () {
				var items = ratingItems(8);
				var routes = {};
				routes[filmUrl(101)] = ratingPage('90%');
				routes[filmUrl(102)] = ratingPage('40%');
				[103, 104, 105, 106, 107, 108].forEach(function (id) {
					routes[filmUrl(id)] = makeError('timeout', '');
				});
				return runCsfdUpdate({ routes: routes, items: items }).then(function (run) {
					// Přeskočitelné chyby běh nikdy nezastaví, ani když jich je hodně za sebou.
					runner.equal('ČSFD mnoho chyb za sebou: doběhne', run.error && run.error.message, null);
					runner.equal('ČSFD mnoho chyb za sebou: zkusí všechna anime', run.calls.length, 8);
					runner.equal('ČSFD mnoho chyb za sebou: zapíše zjištěná', run.writes, [{ 1: '90%', 2: '40%' }]);
					runner.equal('ČSFD mnoho chyb za sebou: všechna selhaná v souhrnu',
						run.result && [run.result.updated, run.result.failures.map(function (f) { return f.number; })],
						[2, ['3', '4', '5', '6', '7', '8']]);
				});
			},
			function () {
				var routes = {};
				routes[filmUrl(101)] = ratingPage('77%');
				routes[filmUrl(102)] = makeError('redirect-blocked', 'zscaler');
				return runCsfdUpdate({ routes: routes }).then(function (run) {
					runner.equal('ČSFD neopravitelná chyba: zastaví hned', [errorSummary(run.error), run.error && run.error.favorite, run.calls.length],
						[{ code: 'redirect-blocked', detail: 'zscaler' }, 'Anime 2', 2]);
					runner.equal('ČSFD neopravitelná chyba: hotové se zapíše do souboru', [run.writes, run.saves, savedState(run.error)],
						[[{ 1: '77%' }], [], ['file', 1, []]]);
				});
			},
			function () {
				var routes = {};
				routes[filmUrl(101)] = ratingPage('77%');
				routes[filmUrl(102)] = makeError('unreachable', 'http://127.0.0.1:8787');
				return runCsfdUpdate({ routes: routes, writeError: makeError('unreachable', 'http://127.0.0.1:8787') }).then(function (run) {
					runner.equal('ČSFD pomocník přestal odpovídat: hotové zůstane v prohlížeči',
						[errorSummary(run.error), run.writes.length, run.saves, savedState(run.error)],
						[{ code: 'unreachable', detail: 'http://127.0.0.1:8787' }, 1, [['77%', '50%', '50%']], ['browser', 1, []]]);
				});
			},
			function () {
				var routes = {};
				routes[filmUrl(101)] = ratingPage('81%');
				routes[filmUrl(102)] = makeError('timeout', '');
				routes[filmUrl(103)] = ratingPage('83%');
				return runCsfdUpdate({ routes: routes, writeError: makeError('data-write-failed', 'PermissionError', 500) }).then(function (run) {
					runner.equal('ČSFD zápis do souboru selže: chyba s příčinou', errorSummary(run.error),
						{ code: 'data-save-failed', detail: 'data-write-failed PermissionError' });
					runner.equal('ČSFD zápis do souboru selže: hodnocení zůstanou v prohlížeči', [run.saves, savedState(run.error)],
						[[['81%', '50%', '83%']], ['browser', 2, []]]);
					runner.equal('ČSFD zápis do souboru selže: přeskočená anime zůstanou v hlášení',
						run.error && run.error.failures.map(function (f) { return f.number; }), ['2']);
				});
			},
			function () {
				var routes = {};
				routes[filmUrl(101)] = makeError('unreachable', 'http://127.0.0.1:8787');
				return runCsfdUpdate({ routes: routes }).then(function (run) {
					runner.equal('ČSFD pomocník přestal odpovídat hned: bez uložení',
						[errorSummary(run.error), run.writes, run.saves, savedState(run.error)],
						[{ code: 'unreachable', detail: 'http://127.0.0.1:8787' }, [], [], [null, 0, []]]);
				});
			},
			function () {
				return runCsfdUpdate({ routes: {}, healthError: makeError('unreachable', 'x') }).then(function (run) {
					runner.equal('ČSFD pomocník neběží: nic se nestahuje', [errorSummary(run.error), run.calls, run.saves, run.writes],
						[{ code: 'unreachable', detail: 'x' }, [], [], []]);
				});
			},
			function () {
				var health = { version: 1, cookieConfigured: true, maxImageNumber: 0, dataFile: false };
				return runCsfdUpdate({ routes: {}, health: health }).then(function (run) {
					runner.equal('ČSFD starý pomocník: odmítne se dřív, než se cokoli stáhne', [errorSummary(run.error), run.calls, run.writes],
						[{ code: 'helper-outdated', detail: '' }, [], []]);
				});
			},
			function () {
				var health = { version: 2, cookieConfigured: true, maxImageNumber: 0, dataFile: false };
				return runCsfdUpdate({ routes: {}, health: health }).then(function (run) {
					runner.equal('ČSFD pomocník bez souboru s daty: odmítne se', [errorSummary(run.error), run.calls, run.writes],
						[{ code: 'data-file-missing', detail: '' }, [], []]);
				});
			},
			function () {
				return runCsfdUpdate({ routes: {}, items: null }).then(function (run) {
					runner.equal('ČSFD data nejsou načtená', [errorSummary(run.error), run.events], [{ code: 'data-not-loaded', detail: '' }, []]);
				});
			},
			function () {
				// ČSFD i Seznam sdílejí zámek - nikdy neběží dvě aktualizace najednou.
				var release;
				var gate = new Promise(function (resolve) { release = resolve; });
				var routes = {};
				routes[filmUrl(101)] = ratingPage('1%');
				var first = runCsfdUpdate({ routes: routes, items: ratingItems(1), healthGate: gate });
				return Promise.resolve().then(function () {
					var listRoutes = {};
					listRoutes[Sync.FAVORITES_URL] = favoritesPage([KNOWN_FAVORITE]);
					return Promise.all([runUpdate({ routes: listRoutes }), runCsfdUpdate({ routes: routes, items: ratingItems(1) })]);
				}).then(function (others) {
					runner.equal('ČSFD běží: Seznam i druhé ČSFD se odmítnou', others.map(function (other) { return errorSummary(other.error); }),
						[{ code: 'already-running', detail: '' }, { code: 'already-running', detail: '' }]);
					release();
					return first;
				}).then(function (firstRun) {
					runner.equal('ČSFD běží: původní doběhne', firstRun.result && firstRun.result.updated, 1);
					return runCsfdUpdate({ routes: routes, items: ratingItems(1) });
				}).then(function (again) {
					runner.equal('ČSFD: po dokončení jde spustit znovu', again.result && again.result.updated, 1);
				});
			}
		]);
	}

	/* ------------------------- tok MAL hodnocení ------------------------- */

	function malFlows(runner) {
		return sequence([
			function () {
				var items = ratingItems(4);
				items[1].MalID = '0';
				items[1].MalRating = '?%';
				var routes = {};
				routes[malUrl(201)] = malAnimePage('7.65');
				routes[malUrl(203)] = '<div class="score-label score-na">N/A</div><div>Members <strong>169</strong></div>';
				routes[malUrl(204)] = malAnimePage('6.0');
				return runMalUpdate({ routes: routes, items: items }).then(function (run) {
					runner.equal('MAL: bez chyby', run.error && run.error.message, null);
					runner.equal('MAL: MalID 0 se nestahuje, ostatní v pořadí dat', run.calls, [malUrl(201), malUrl(203), malUrl(204)]);
					runner.equal('MAL: průběh jako Python a jeden zápis do souboru na konci', run.events,
						['health', 'progress:0.00', 'progress:25.00', 'progress:50.00', 'progress:75.00', 'write']);
					runner.equal('MAL: nové hodnoty (MalID 0 i N/A mají ?%)', ratingsOf(run.items, 'MalRating'), ['76%', '?%', '?%', '60%']);
					runner.equal('MAL: ČSFD hodnocení zůstane', ratingsOf(run.items), ['50%', '50%', '50%', '50%']);
					runner.equal('MAL: do souboru jdou všechna zjištěná hodnocení', run.writes, [{ 1: '76%', 2: '?%', 3: '?%', 4: '60%' }]);
					runner.equal('MAL: bez uložených úprav se do prohlížeče neukládá', run.saves, []);
					runner.equal('MAL: výsledek', run.result,
						{ total: 4, updated: 4, changed: 2, failures: [], savedTo: 'file', notInFile: [] });
				});
			},
			function () {
				var items = ratingItems(4);
				items[0].NameEn = '';
				items[2].MalID = 'abc';
				var routes = {};
				routes[malUrl(201)] = makeError('upstream-http', '404', 404);
				routes[malUrl(202)] = '<html>jiná stránka</html>';
				routes[malUrl(204)] = malAnimePage('8.01');
				return runMalUpdate({ routes: routes, items: items, storedItems: true }).then(function (run) {
					runner.equal('MAL přeskočení: bez chyby', run.error && run.error.message, null);
					runner.equal('MAL přeskočení: nečíselné ID bez dotazu', run.calls, [malUrl(201), malUrl(202), malUrl(204)]);
					runner.equal('MAL přeskočení: seznam selhaných', run.result && run.result.failures, [
						{ name: 'Fav 1', number: '1', code: 'upstream-http', detail: '404' },
						{ name: 'Anime 2', number: '2', code: 'parse-error', detail: 'mal-rating' },
						{ name: 'Anime 3', number: '3', code: 'bad-mal-id', detail: 'abc' }
					]);
					runner.equal('MAL přeskočení: do souboru jen zjištěná, s uloženými úpravami i do prohlížeče',
						[run.writes, run.saves], [[{ 4: '80%' }], [['60%', '60%', '60%', '80%']]]);
				});
			},
			function () {
				var routes = {};
				routes[malUrl(201)] = malAnimePage('9.0');
				routes[malUrl(202)] = malAnimePage('8.0');
				return runMalUpdate({ routes: routes, items: ratingItems(2), missing: ['2'] }).then(function (run) {
					runner.equal('MAL anime mimo soubor: vypíšou se', run.result && run.result.notInFile, [{ name: 'Anime 2', number: '2' }]);
				});
			},
			function () {
				var routes = {};
				routes[malUrl(201)] = malAnimePage('9.0');
				routes[malUrl(202)] = makeError('redirect-blocked', 'zscaler');
				return runMalUpdate({ routes: routes }).then(function (run) {
					runner.equal('MAL neopravitelná chyba: zastaví a hotové zapíše',
						[errorSummary(run.error), run.error && run.error.favorite, run.writes, savedState(run.error)],
						[{ code: 'redirect-blocked', detail: 'zscaler' }, 'Anime 2', [{ 1: '90%' }], ['file', 1, []]]);
				});
			},
			function () {
				var routes = {};
				routes[malUrl(201)] = malAnimePage('9.0');
				return runMalUpdate({ routes: routes, items: ratingItems(1), writeError: makeError('data-write-failed', 'PermissionError', 500) })
					.then(function (run) {
						runner.equal('MAL zápis do souboru selže: hodnocení zůstanou v prohlížeči',
							[errorSummary(run.error), run.saves, savedState(run.error)],
							[{ code: 'data-save-failed', detail: 'data-write-failed PermissionError' }, [['90%']], ['browser', 1, []]]);
					});
			},
			function () {
				// Pomocník verze 2 umí jen ČSFD hodnocení, MAL by zápis odmítl s 404.
				var health = { version: 2, cookieConfigured: true, maxImageNumber: 0, dataFile: true };
				return runMalUpdate({ routes: {}, health: health }).then(function (run) {
					runner.equal('MAL pomocník verze 2: odmítne se dřív, než se cokoli stáhne', [errorSummary(run.error), run.calls, run.writes],
						[{ code: 'helper-outdated', detail: '' }, [], []]);
				});
			},
			function () {
				var health = { version: 3, cookieConfigured: true, maxImageNumber: 0, dataFile: false };
				return runMalUpdate({ routes: {}, health: health }).then(function (run) {
					runner.equal('MAL pomocník bez souboru s daty: odmítne se', [errorSummary(run.error), run.calls],
						[{ code: 'data-file-missing', detail: '' }, []]);
				});
			},
			function () {
				// MAL, ČSFD i Seznam sdílejí zámek.
				var release;
				var gate = new Promise(function (resolve) { release = resolve; });
				var routes = {};
				routes[malUrl(201)] = malAnimePage('5.0');
				var first = runMalUpdate({ routes: routes, items: ratingItems(1), healthGate: gate });
				return Promise.resolve().then(function () {
					return Promise.all([runCsfdUpdate({ routes: {}, items: ratingItems(1) }), runMalUpdate({ routes: routes, items: ratingItems(1) })]);
				}).then(function (others) {
					runner.equal('MAL běží: ČSFD i druhé MAL se odmítnou', others.map(function (other) { return errorSummary(other.error); }),
						[{ code: 'already-running', detail: '' }, { code: 'already-running', detail: '' }]);
					release();
					return first;
				}).then(function (firstRun) {
					runner.equal('MAL běží: původní doběhne a zapíše', [firstRun.result && firstRun.result.updated, firstRun.writes], [1, [{ 1: '50%' }]]);
				});
			}
		]);
	}

	/* ------------------------- tok zhlédnutých epizod ------------------------- */

	function watchedItem(number, favoriteName, state) {
		return { Number: String(number), FavoriteName: favoriteName, NameEn: 'Anime ' + number, State: state,
			CsfdRating: '50%', MalRating: '60%' };
	}

	function watchedFavorite(name, slug, season, episode, finished) {
		return { name: name, slug: slug, season: season, episode: episode, image: '/u/' + slug + '.jpg', finished: finished };
	}

	function serialUrl(slug) {
		return 'https://sledujserialy.io/serial/' + slug;
	}

	function statesOf(items) {
		return items.map(function (item) { return item.State; });
	}

	function watchedFlows(runner) {
		return sequence([
			function () {
				var items = [
					watchedItem(1, 'Fin', 'S01E03'),
					watchedItem(2, 'Cont', 'DONE'),
					watchedItem(3, 'Gone', 'S02E01'),
					watchedItem(4, 'Fin', 'DROPPED'),
					watchedItem(5, 'Next', 'S01E12'),
					watchedItem(6, 'Next', 'DONE'),
					watchedItem(7, 'AllSeen', 'DONE'),
					watchedItem(8, 'NoSeasons', 'S01E01'),
					watchedItem(9, 'AllSeen', 'S01E01')
				];
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([
					watchedFavorite('Fin', 'fin', '01', '24', true),
					watchedFavorite('Cont', 'cont', '02', '05', false),
					watchedFavorite('Cont', 'cont-copy', '01', '01', true),
					watchedFavorite('Next', 'next', '01', '12', false),
					watchedFavorite('AllSeen', 'all-seen', '03', '02', false),
					watchedFavorite('NoSeasons', 'no-seasons', '01', '01', false),
					watchedFavorite('Unused', 'unused', '01', '01', false)
				]);
				routes[serialUrl('cont')] = serialPage([['1', 'Videné'], ['2', 'Označiť']]);
				routes[serialUrl('next')] = serialPage([['1', 'Videné'], ['2', 'Označiť'], ['3', 'Označiť']]);
				routes[serialUrl('all-seen')] = serialPage([['1', 'Videné'], ['2', 'Videné'], ['3', 'Videné']], true);
				routes[serialUrl('no-seasons')] = '<html><body>Seriál bez řad</body></html>';
				return runWatchedUpdate({ routes: routes, items: items }).then(function (run) {
					runner.equal('Zhlédnuté: bez chyby', run.error && run.error.message, null);
					// Python přepíše oblíbený výsledkem kontroly: "Cont" bere první shodu, druhé "Next" se ptá znovu
					// (zůstal nedokončený, teď s řadou 02 a epizodou --), druhé "AllSeen" už ne (je dokončený).
					runner.equal('Zhlédnuté: oblíbené, pak stránky nedokončených seriálů jako Python', run.calls,
						[Sync.FAVORITES_URL, serialUrl('cont'), serialUrl('next'), serialUrl('next'), serialUrl('all-seen'), serialUrl('no-seasons')]);
					runner.equal('Zhlédnuté: průběh jako Python (100 * (index + 1) / počet) a jeden zápis na konci', run.events,
						['health', 'progress:11.11', 'progress:22.22', 'progress:33.33', 'progress:44.44', 'progress:55.56',
							'progress:66.67', 'progress:77.78', 'progress:88.89', 'progress:100.00', 'write']);
					runner.equal('Zhlédnuté: nové stavy (mimo oblíbené a DROPPED beze změny)', statesOf(run.items),
						['DONE', 'S02E05', 'S02E01', 'DROPPED', 'S02E--', 'S02E--', 'DONE', 'DONE', 'DONE']);
					runner.equal('Zhlédnuté: hodnocení zůstanou', run.items.map(function (item) { return item.CsfdRating + item.MalRating; }),
						['50%60%', '50%60%', '50%60%', '50%60%', '50%60%', '50%60%', '50%60%', '50%60%', '50%60%']);
					runner.equal('Zhlédnuté: do souboru jdou jen zjištěné stavy', run.writes,
						[{ 1: 'DONE', 2: 'S02E05', 5: 'S02E--', 6: 'S02E--', 7: 'DONE', 8: 'DONE', 9: 'DONE' }]);
					runner.equal('Zhlédnuté: bez uložených úprav se do prohlížeče neukládá', run.saves, []);
					runner.equal('Zhlédnuté: výsledek', run.result,
						{ total: 9, updated: 7, changed: 6, failures: [], savedTo: 'file', notInFile: [] });
				});
			},
			function () {
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([watchedFavorite('A', 'a', '01', '24', true), watchedFavorite('B', 'b', '01', '24', true)]);
				return runWatchedUpdate({ routes: routes, items: [watchedItem(1, 'A', 'S01E01'), watchedItem(2, 'B', 'S01E01')],
					missing: ['2'], storedItems: true }).then(function (run) {
					runner.equal('Zhlédnuté s uloženými úpravami: zapíše soubor i prohlížeč', [run.events.slice(-2), run.writes, run.saves],
						[['write', 'save'], [{ 1: 'DONE', 2: 'DONE' }], [['DONE', 'DONE']]]);
					runner.equal('Zhlédnuté anime mimo soubor: vypíšou se', run.result && run.result.notInFile, [{ name: 'Anime 2', number: '2' }]);
				});
			},
			function () {
				var items = [1, 2, 3, 4, 5, 6, 7].map(function (number) {
					return watchedItem(number, 'F' + number, 'S01E01');
				});
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([
					watchedFavorite('F1', 'f1', '01', '02', false),
					watchedFavorite('F2', 'f2', '01', '02', false),
					watchedFavorite('F3', 'bad slug', '01', '02', false),
					watchedFavorite('F4', '%2E%2E', '01', '02', false),
					watchedFavorite('F5', 'f5', '01', '1234567', false),
					watchedFavorite('F6', 'f6', '01', '02', false),
					watchedFavorite('F7', 'f7', '01', '02', false)
				]);
				routes[serialUrl('f1')] = makeError('upstream-http', '404', 404);
				// Pomocník nestáhne stránku, na kterou web přesměroval (jiná cesta než /serial/...).
				routes[serialUrl('f2')] = makeError('redirect-blocked', 'path-not-allowed');
				routes[serialUrl('f5')] = serialPage([['1', 'Označiť']]);
				routes[serialUrl('f6')] = makeError('timeout', '');
				routes[serialUrl('f7')] = serialPage([['1', 'Označiť']]);
				return runWatchedUpdate({ routes: routes, items: items }).then(function (run) {
					runner.equal('Zhlédnuté přeskočení: bez chyby', run.error && run.error.message, null);
					runner.equal('Zhlédnuté přeskočení: nepovolený název seriálu bez dotazu', run.calls,
						[Sync.FAVORITES_URL, serialUrl('f1'), serialUrl('f2'), serialUrl('f5'), serialUrl('f6'), serialUrl('f7')]);
					runner.equal('Zhlédnuté přeskočení: seznam selhaných', run.result && run.result.failures, [
						{ name: 'Anime 1', number: '1', code: 'upstream-http', detail: '404' },
						{ name: 'Anime 2', number: '2', code: 'redirect-blocked', detail: 'path-not-allowed' },
						{ name: 'Anime 3', number: '3', code: 'bad-serial-name', detail: 'bad slug' },
						{ name: 'Anime 4', number: '4', code: 'bad-serial-name', detail: '%2E%2E' },
						{ name: 'Anime 5', number: '5', code: 'parse-error', detail: 'state' },
						{ name: 'Anime 6', number: '6', code: 'timeout', detail: '' }
					]);
					runner.equal('Zhlédnuté přeskočení: selhaná anime si nechají původní stav', statesOf(run.items),
						['S01E01', 'S01E01', 'S01E01', 'S01E01', 'S01E01', 'S01E01', 'S01E02']);
					runner.equal('Zhlédnuté přeskočení: do souboru jen zjištěné', [run.writes, run.result && run.result.updated], [[{ 7: 'S01E02' }], 1]);
				});
			},
			function () {
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([
					watchedFavorite('A', 'a', '01', '24', true),
					watchedFavorite('B', 'b', '02', '03', false),
					watchedFavorite('C', 'c', '01', '24', true)
				]);
				routes[serialUrl('b')] = makeError('cloudflare-challenge', '');
				var items = [watchedItem(1, 'A', 'S01E01'), watchedItem(2, 'B', 'S01E01'), watchedItem(3, 'C', 'S01E01')];
				return runWatchedUpdate({ routes: routes, items: items }).then(function (run) {
					runner.equal('Zhlédnuté Cloudflare: zastaví hned', [errorSummary(run.error), run.error && run.error.favorite, run.calls],
						[{ code: 'cloudflare-challenge', detail: '' }, 'Anime 2', [Sync.FAVORITES_URL, serialUrl('b')]]);
					runner.equal('Zhlédnuté Cloudflare: hotové se zapíše do souboru', [statesOf(run.items), run.writes, savedState(run.error)],
						[['DONE', 'S01E01', 'S01E01'], [{ 1: 'DONE' }], ['file', 1, []]]);
				});
			},
			function () {
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([watchedFavorite('A', 'a', '01', '02', false)]);
				// Přesměrování mimo web (filtr firemní sítě) by se týkalo všech seriálů.
				routes[serialUrl('a')] = makeError('redirect-blocked', 'gateway.zscaler.net');
				return runWatchedUpdate({ routes: routes, items: [watchedItem(1, 'A', 'S01E01')] }).then(function (run) {
					runner.equal('Zhlédnuté přesměrování mimo web: zastaví', [errorSummary(run.error), run.writes, savedState(run.error)],
						[{ code: 'redirect-blocked', detail: 'gateway.zscaler.net' }, [], [null, 0, []]]);
				});
			},
			function () {
				var routes = {};
				routes[Sync.FAVORITES_URL] = makeError('cloudflare-challenge', '');
				return runWatchedUpdate({ routes: routes, items: [watchedItem(1, 'A', 'S01E01')] }).then(function (run) {
					runner.equal('Zhlédnuté oblíbené za výzvou Cloudflare: nic se nemění',
						[errorSummary(run.error), run.error && run.error.favorite, run.calls, run.events, run.writes, statesOf(run.items)],
						[{ code: 'cloudflare-challenge', detail: '' }, undefined, [Sync.FAVORITES_URL], ['health'], [], ['S01E01']]);
				});
			},
			function () {
				var routes = {};
				routes[Sync.FAVORITES_URL] = '<html><body>Přihlaste se</body></html>';
				return runWatchedUpdate({ routes: routes, items: [watchedItem(1, 'A', 'S01E01')] }).then(function (run) {
					runner.equal('Zhlédnuté bez sekce oblíbených (odhlášeno): chyba', [errorSummary(run.error), run.writes],
						[{ code: 'no-favorites', detail: '' }, []]);
				});
			},
			function () {
				var health = { version: 4, cookieConfigured: false, maxImageNumber: 0, dataFile: true };
				return runWatchedUpdate({ routes: {}, items: [watchedItem(1, 'A', 'S01E01')], health: health }).then(function (run) {
					runner.equal('Zhlédnuté pomocník bez cookie: nic se nestahuje', [errorSummary(run.error), run.calls],
						[{ code: 'cookie-missing', detail: '' }, []]);
				});
			},
			function () {
				// Pomocník verze 3 umí jen hodnocení, zápis zhlédnutých epizod by odmítl s 404.
				var health = { version: 3, cookieConfigured: true, maxImageNumber: 0, dataFile: true };
				return runWatchedUpdate({ routes: {}, items: [watchedItem(1, 'A', 'S01E01')], health: health }).then(function (run) {
					runner.equal('Zhlédnuté pomocník verze 3: odmítne se dřív, než se cokoli stáhne', [errorSummary(run.error), run.calls],
						[{ code: 'helper-outdated', detail: '' }, []]);
				});
			},
			function () {
				var health = { version: 4, cookieConfigured: true, maxImageNumber: 0, dataFile: false };
				return runWatchedUpdate({ routes: {}, items: [watchedItem(1, 'A', 'S01E01')], health: health }).then(function (run) {
					runner.equal('Zhlédnuté pomocník bez souboru s daty: odmítne se', [errorSummary(run.error), run.calls],
						[{ code: 'data-file-missing', detail: '' }, []]);
				});
			},
			function () {
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([watchedFavorite('A', 'a', '01', '24', true)]);
				return runWatchedUpdate({ routes: routes, items: [watchedItem(1, 'A', 'S01E01'), watchedItem(2, 'Z', 'S01E01')],
					writeError: makeError('data-write-failed', 'PermissionError', 500) }).then(function (run) {
					runner.equal('Zhlédnuté zápis do souboru selže: stavy zůstanou v prohlížeči',
						[errorSummary(run.error), run.saves, savedState(run.error)],
						[{ code: 'data-save-failed', detail: 'data-write-failed PermissionError' }, [['DONE', 'S01E01']], ['browser', 1, []]]);
				});
			},
			function () {
				// Zhlédnuté epizody sdílejí zámek s ostatními aktualizacemi.
				var release;
				var gate = new Promise(function (resolve) { release = resolve; });
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([watchedFavorite('A', 'a', '01', '24', true)]);
				var first = runWatchedUpdate({ routes: routes, items: [watchedItem(1, 'A', 'S01E01')], healthGate: gate });
				return Promise.resolve().then(function () {
					return Promise.all([runMalUpdate({ routes: {}, items: ratingItems(1) }),
						runWatchedUpdate({ routes: routes, items: [watchedItem(1, 'A', 'S01E01')] })]);
				}).then(function (others) {
					runner.equal('Zhlédnuté běží: MAL i druhé zhlédnuté se odmítnou', others.map(function (other) { return errorSummary(other.error); }),
						[{ code: 'already-running', detail: '' }, { code: 'already-running', detail: '' }]);
					release();
					return first;
				}).then(function (firstRun) {
					runner.equal('Zhlédnuté běží: původní doběhne a zapíše', [firstRun.result && firstRun.result.updated, firstRun.writes], [1, [{ 1: 'DONE' }]]);
				});
			}
		]);
	}

	/* ---------------------------------- spuštění ---------------------------------- */

	/** @returns {Promise<Object>} souhrn ve tvaru NV194TestRunner.summarize() */
	function run() {
		var runner = window.NV194TestRunner.create();
		var groups = [
			['čisté funkce', pureFunctions],
			['sledujserialy.io', favorites],
			['ČSFD', csfd],
			['MyAnimeList', mal],
			['nová položka', newItem],
			['datová vrstva', dataLayer],
			['klient pomocníka', proxyClient],
			['tok aktualizace', flows],
			['tok ČSFD hodnocení', csfdFlows],
			['tok MAL hodnocení', malFlows],
			['tok zhlédnutých epizod', watchedFlows]
		];
		return sequence(groups.map(function (group) {
			return function () {
				return guarded(runner, group[0], group[1]);
			};
		})).then(function () {
			return window.NV194TestRunner.summarize(runner.results);
		});
	}

	return { run: run };
})();
