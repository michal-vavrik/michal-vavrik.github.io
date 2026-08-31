/**
 * Automatické testy sestavování cest k obrázkům (js/nv194-images.js)
 * a struktury obsahu s obrázky vracené parserem.
 */
window.NV194ImagesTests = (function () {
	'use strict';

	var images = window.NV194Images;
	var parser = window.NV194Parser;

	/** Bezpečnost názvu souboru. */
	function nameSafety(runner) {
		var platne = ['1.png', '46.png', 'obrazek-2.PNG', 'schema_3.jpg', 'a.jpeg', 'b.gif', 'c.webp', 'd.svg'];
		platne.forEach(function (name) {
			runner.check('přijme platný název "' + name + '"', images.isSafeName(name),
				'název byl odmítnut');
		});

		var neplatne = [
			'../tajne.png',
			'..\\tajne.png',
			'/etc/passwd.png',
			'obrazky/1.png',
			'http://cizi.example/1.png',
			'https://cizi.example/1.png',
			'//cizi.example/1.png',
			'data:image/png;base64,AAAA',
			'javascript:alert(1)',
			'1.png?x=1',
			'1.png#kotva',
			'1.exe',
			'1',
			'.png',
			'..',
			'',
			' 1.png',
			'1.png ',
			'obr 1.png'
		];
		neplatne.forEach(function (name) {
			runner.check('odmítne nebezpečný název "' + name + '"', !images.isSafeName(name),
				'název byl chybně přijat');
		});

		runner.check('odmítne jiný typ než řetězec', !images.isSafeName(null) &&
			!images.isSafeName(undefined) && !images.isSafeName(12), 'byl přijat neřetězcový vstup');
	}

	/** Sestavení cesty relativně k adresáři s obrázky. */
	function pathBuilding(runner) {
		runner.equal('výchozí adresář', images.resolve('12.png'), 'data/obrazky/12.png');
		runner.equal('vlastní adresář s lomítkem', images.resolve('12.png', 'obrazky/'), 'obrazky/12.png');
		runner.equal('vlastní adresář bez lomítka', images.resolve('12.png', '../data/obrazky'),
			'../data/obrazky/12.png');
		runner.equal('prázdný adresář', images.resolve('12.png', ''), '12.png');

		runner.equal('nebezpečný název nevrátí cestu', images.resolve('../secret.png'), null);
		runner.equal('absolutní URL nevrátí cestu', images.resolve('http://cizi.example/1.png'), null);
		runner.check('nebezpečný název nelze obejít ani vlastním adresářem',
			images.resolve('../../x.png', 'data/obrazky/') === null,
			'byla sestavena cesta mimo adresář s obrázky');
	}

	/** Parser musí zachovat pořadí textu a obrázků. */
	function contentStructure(runner) {
		function nodesOf(source) {
			var result = parser.parseNV194(source);
			return { result: result, question: result.questions[0] };
		}

		var mezi = nodesOf('# K\n\n1. před [obr. 1.png] mezi [obr. 2.png] za\na) A\nb) B\nc) C\nsprávně: [a]\n');
		runner.equal('text a obrázky se střídají ve správném pořadí',
			mezi.question.content.map(function (n) { return n.type === 'image' ? 'img:' + n.src : 'text'; }),
			['text', 'img:1.png', 'text', 'img:2.png', 'text']);
		runner.equal('obrázky v textu otázky', mezi.question.images, ['1.png', '2.png']);
		runner.equal('bez chyb parseru', mezi.result.errors.length, 0);

		var vOdpovedich = nodesOf('# K\n\n2. Otázka\na) [obr. 3.png]\nb) text [obr. 4.png]\nc) jen text\nsprávně: [a]\n');
		var odpovedi = vOdpovedich.question.answers;
		runner.equal('obrázek jako celý obsah odpovědi A',
			odpovedi[0].content.map(function (n) { return n.type; }), ['image']);
		runner.equal('odpověď A odkazuje na správný soubor', odpovedi[0].images, ['3.png']);
		runner.equal('text a obrázek v odpovědi B',
			odpovedi[1].content.map(function (n) { return n.type; }), ['text', 'image']);
		runner.equal('odpověď C je bez obrázku', odpovedi[2].images, []);
		runner.equal('otázka sbírá obrázky i z odpovědí', vOdpovedich.question.images, ['3.png', '4.png']);

		var samostatny = nodesOf('# K\n\n3. První část\n[obr. 5.png]\ndruhá část\na) A\nb) B\nc) C\nsprávně: [a]\n');
		runner.equal('obrázek na samostatném řádku mezi částmi textu',
			samostatny.question.content.map(function (n) { return n.type; }), ['text', 'image', 'text']);

		var bezObrazku = nodesOf('# K\n\n4. Otázka\na) A\nb) B\nc) C\nsprávně: [a]\n');
		runner.equal('otázka bez obrázku', bezObrazku.question.images, []);
		runner.equal('otázka bez obrázku nemá příznak', bezObrazku.question.hasImages, false);

		var vadny = nodesOf('# K\n\n5. Otázka [obr 6.png]\na) A\nb) B\nc) C\nsprávně: [a]\n');
		runner.check('vadný zápis odkazu je ohlášen',
			vadny.result.errors.some(function (e) { return e.code === 'INVALID_IMAGE_REF'; }),
			'chyba nebyla ohlášena');
		runner.equal('otázka s vadným odkazem se přesto načte', vadny.result.questions.length, 1);

		runner.check('všechny názvy z parseru projdou kontrolou bezpečnosti',
			['1.png', '46.png'].every(images.isSafeName), 'název z dat byl odmítnut');
	}

	function run() {
		var runner = window.NV194TestRunner.create();
		nameSafety(runner);
		pathBuilding(runner);
		contentStructure(runner);
		return window.NV194TestRunner.summarize(runner.results);
	}

	return { run: run };
})();
