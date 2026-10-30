/**
 * Automatické testy aktualizace anime listu (Aktualizovat -> Seznam):
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
		runner.equal('parseMalRating: bez čísla je chyba',
			errorSummary(thrown(function () { Sync.parseMalRating('<div class="score-label score-na">N/A</div>'); })),
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
		var healthBody = JSON.stringify({ ok: true, version: 1, cookieConfigured: true, maxImageNumber: '7' });

		return sequence([
			function () {
				return withFetch(function () { return reply(healthBody, 200); }, function (stub) {
					return Client.health().then(function (health) {
						runner.equal('health: výsledek', health, { version: 1, cookieConfigured: true, maxImageNumber: 7 });
						runner.equal('health: adresa a nastavení požadavku', [
							stub.calls[0].url, stub.calls[0].init.method, stub.calls[0].init.headers['X-Anime-Proxy'],
							stub.calls[0].init.credentials, stub.calls[0].init.cache
						], [base + '/health', 'GET', '1', 'omit', 'no-store']);
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
					return Client.saveImage('https://serialy.sx/a.jpg', 12).then(function (saved) {
						runner.equal('saveImage: výsledek', saved, { number: 12, bytes: 99 });
						runner.equal('saveImage: požadavek', [
							stub.calls[0].url, stub.calls[0].init.method, stub.calls[0].init.headers['Content-Type'],
							JSON.parse(stub.calls[0].init.body)
						], [base + '/images', 'POST', 'application/json', { url: 'https://serialy.sx/a.jpg', number: 12 }]);
					});
				});
			},
			function () {
				return withFetch(function () { return reply('{}', 409, { 'X-Proxy-Error': 'image-exists' }); }, function () {
					return summarizeError(Client.saveImage('https://serialy.sx/a.jpg', 12)).then(function (error) {
						runner.equal('saveImage: obrázek už existuje', error, { code: 'image-exists', detail: '12', status: 409 });
					});
				});
			},
			function () {
				return withFetch(function () { return reply('nic', 201); }, function () {
					return summarizeError(Client.saveImage('https://serialy.sx/a.jpg', 12)).then(function (error) {
						runner.equal('saveImage: neplatná odpověď', error, { code: 'unexpected-response', detail: 'images', status: 0 });
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
	 *   health, imageError (number -> Error | null)
	 * @returns {Promise<{result, error, events, calls, images, items}>}
	 */
	function runUpdate(setup) {
		var events = [];
		var calls = [];
		var images = [];
		var items = setup.items === null ? null : (setup.items || knownItems());
		var proxy = {
			health: function () {
				events.push('health');
				if (setup.healthGate) {
					return setup.healthGate.then(function () {
						return setup.health;
					});
				}
				return Promise.resolve(setup.health || { version: 1, cookieConfigured: true, maxImageNumber: 12 });
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
			}
		};
		var data = {
			getItems: function () {
				return items;
			},
			addItem: function (item) {
				items.push(item);
				return items;
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
			return { result: result, error: null, events: events, calls: calls, images: images, items: items };
		}, function (error) {
			return { result: null, error: error, events: events, calls: calls, images: images, items: items };
		});
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
					runner.equal('tok: pořadí kroků, průběh a obrázek jako poslední krok položky', run.events, [
						'health', 'total:2',
						'progress:10.00', 'progress:20.00', 'progress:30.00', 'progress:40.00', 'image:13', 'progress:50.00', 'added:13/3',
						'progress:60.00', 'progress:70.00', 'progress:80.00', 'progress:90.00', 'image:14', 'progress:100.00', 'added:14/4'
					]);
					runner.equal('tok: stahované stránky', run.calls, [
						Sync.FAVORITES_URL,
						Sync.csfdSearchUrl('New A'), 'https://www.csfd.cz/film/111', Sync.malSearchUrl('New A'), 'https://myanimelist.net/anime/222',
						Sync.csfdSearchUrl('New B'), 'https://www.csfd.cz/film/333', Sync.malSearchUrl('New B'), 'https://myanimelist.net/anime/444'
					]);
					runner.equal('tok: obrázky z serialy.sx pod číslem anime', run.images, [
						{ url: 'https://serialy.sx/u/a.jpg', number: 13 }, { url: 'https://serialy.sx/u/b.jpg', number: 14 }
					]);
					runner.equal('tok: přidané položky', run.items.slice(2), [expectedItemA(13), expectedItemB(14)]);
					runner.equal('tok: původní položky zůstanou', run.items.slice(0, 2), knownItems());
					runner.equal('tok: vrácené položky', run.result && run.result.added, [expectedItemA(13), expectedItemB(14)]);
				});
			},
			function () {
				var routes = {};
				routes[Sync.FAVORITES_URL] = favoritesPage([KNOWN_FAVORITE, EXCEPTION_FAVORITE]);
				return runUpdate({ routes: routes }).then(function (run) {
					runner.equal('bez nových anime: výsledek', run.result, { total: 0, added: [] });
					runner.equal('bez nových anime: jen seznam oblíbených, žádný průběh', [run.calls, run.events], [[Sync.FAVORITES_URL], ['health', 'total:0']]);
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
				return runUpdate({ routes: {}, health: { version: 1, cookieConfigured: false, maxImageNumber: 0 } }).then(function (run) {
					runner.equal('chybí cookie: chyba a žádné stahování', [errorSummary(run.error), run.calls], [{ code: 'cookie-missing', detail: '' }, []]);
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
				var first = runUpdate({ routes: routes, healthGate: gate, health: { version: 1, cookieConfigured: true, maxImageNumber: 0 } });
				return Promise.resolve().then(function () {
					return runUpdate({ routes: routes });
				}).then(function (second) {
					runner.equal('souběžná aktualizace se odmítne', errorSummary(second.error), { code: 'already-running', detail: '' });
					release();
					return first;
				}).then(function (firstRun) {
					runner.equal('původní aktualizace doběhne', firstRun.result, { total: 0, added: [] });
					return runUpdate({ routes: routes });
				}).then(function (afterSuccess) {
					runner.equal('po dokončení jde aktualizaci spustit znovu', afterSuccess.result, { total: 0, added: [] });
					return runUpdate({ routes: {}, health: { version: 1, cookieConfigured: false, maxImageNumber: 0 } });
				}).then(function (failed) {
					runner.equal('aktualizace skončí chybou', errorSummary(failed.error), { code: 'cookie-missing', detail: '' });
					return runUpdate({ routes: routes });
				}).then(function (afterError) {
					runner.equal('po chybě jde aktualizaci spustit znovu', afterError.result, { total: 0, added: [] });
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
			['tok aktualizace', flows]
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
