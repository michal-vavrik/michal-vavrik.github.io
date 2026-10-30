# michal-vavrik.github.io

## Hry

Po přihlášení s plným přístupem otevřete [Hry](./games.html). Všechny hry běží přímo
v prohlížeči a nevyžadují další instalaci:

- [Snake](./snake.html): šipky nebo WASD pro směr, mezerník pro pauzu;
  na telefonu tah prstem či směrová tlačítka.
- [Tetris](./tetris.html): šipky pro posun a otočení, mezerník pro okamžitý
  pád, P pro pauzu; na telefonu herní tlačítka.
- [Pexeso](./memory.html): vyberte velikost 4×4 až 12×12, odkrývejte dvojice
  stejných emoji; počítají se tahy a čas bez časového limitu.
- [2048](./2048.html): šipkami, WASD, tahem prstem nebo tlačítky spojujte
  stejná čísla. Po dosažení 2048 lze pokračovat.

Nejlepší skóre v Tetrisu, Snake a 2048 se ukládá v localStorage tohoto
prohlížeče. Hry jsou dostupné v češtině a angličtině.

## Anime

[Anime](./anime.html) (po přihlášení s plným přístupem) zobrazuje seznam z
`data/anime.json`. Tlačítko **Aktualizovat** otevře stejné volby jako desktopový
skript `AnimeList.pyw`: Zhlédnuté epizody, ČSFD hodnocení, MAL hodnocení, Seznam
a Všechno. Zatím jsou hotové volby **Seznam** a **ČSFD hodnocení**, ostatní jsou
označené „Připravujeme“. Obě volby potřebují pomocný program (viz níže).

### Aktualizovat → Seznam

Načte oblíbené seriály ze sledujserialy.io (funkce `UpdateAnimeList` ze skriptu).
Ke každému seriálu, který v seznamu ještě není (kromě výjimek jako ve skriptu),
dohledá data na ČSFD a MyAnimeList, stáhne obrázek a přidá ho na konec seznamu.
Průběh a výsledek se ukazují pod tlačítky.

Stránka na GitHub Pages si tyto weby sama stáhnout nemůže (CORS, přihlašovací
cookie) ani zapisovat soubory, proto potřebuje **pomocný program**, který běží na
vašem počítači. Stačí Python 3 (vyzkoušeno na 3.12) bez dalších balíčků:

```
python tools/anime_proxy.py
```

Poslouchá jen na `127.0.0.1:8787`. Parametry: `--port`, `--allow-origin ORIGIN`
(další adresa stránky; výchozí jsou GitHub Pages a `http://127.0.0.1:8765`,
`http://localhost:8765`), `--images-dir` (výchozí `img/anime`), `--data-file`
(výchozí `data/anime.json` vedle složky `tools`) a `--check`. Při
jiném portu nastavte v konzoli prohlížeče
`localStorage.setItem('anime-proxy-url', 'http://127.0.0.1:PORT')`.

**Přihlašovací cookie.** Hodnotu cookie `user_logged_in` z přihlášeného
sledujserialy.io (stejnou jako v `AnimeList.pyw`) předejte proměnnou prostředí
`SLEDUJ_SERIALY_LOGIN_COOKIE` nebo souborem `tools/anime_proxy.local.json`, který je
v `.gitignore` a nesmí se commitovat:

```json
{"sledujSerialyLoginCookie": "...", "cfClearance": "", "userAgent": ""}
```

Pomocný program cookie nikde nevypisuje a posílá ji jen na sledujserialy.io. Změny
v `tools/anime_proxy.local.json` se projeví hned při dalším požadavku, restart není
potřeba (proměnná prostředí se čte jen při startu).

**Cloudflare.** Pokud sledujserialy.io místo obsahu vrací ověřovací výzvu
Cloudflare (HTTP 403, „Just a moment“), ohlásí to stránka i `--check` a pomocný
program ji neobchází. Výzva se často objevuje u firemních sítí a sdílených adres,
nejjednodušší je proto spustit pomocný program z domácí sítě. Jinak výzvu projděte
sami v prohlížeči:

1. Otevřete sledujserialy.io a počkejte, až se ověření dokončí.
2. Ve vývojářských nástrojích (F12) opište z Application → Cookies →
   `https://sledujserialy.io` hodnotu cookie `cf_clearance` a z Console výsledek
   příkazu `navigator.userAgent`.
3. Obojí vložte do `cfClearance` a `userAgent` v `tools/anime_proxy.local.json`
   a v anime stránce spusťte Seznam znovu.

Povolení platí jen pro stejnou IP adresu a stejný User-Agent a po omezenou dobu
(výchozí nastavení Cloudflare je 30 minut), potom postup zopakujte. Pokud výzva trvá
i s vyplněnými hodnotami, povolení vypršelo nebo pomocný program běží v jiné síti
než prohlížeč.

**Diagnostika.** `python tools/anime_proxy.py --check` zkusí sledujserialy.io (včetně
platnosti cookie), ČSFD, MyAnimeList a serialy.sx (obrázky) a vypíše stav každého
z nich. Ve firemní síti (např. Zscaler) mohou být weby blokované nebo přesměrované
(`redirect-blocked`, chyba TLS), použijte jinou síť.

### Aktualizovat → ČSFD hodnocení

Projde všechna anime v seznamu (i DROPPED a DONE, funkce `UpdateCSFD` ze skriptu),
načte jejich stránku na ČSFD podle `CsfdID` a přepíše `CsfdRating`. Anime se
zpracovávají jedno po druhém (u ~300 anime to trvá i několik minut), průběh se ukazuje
pod tlačítky a pořadí řádků se nemění. ČSFD nepotřebuje cookie ani řešení Cloudflare,
stačí spuštěný pomocný program.

Po zjištění všech hodnocení je pomocný program najednou zapíše přímo do
`data/anime.json` (jako `WriteDataToTheFile` ve skriptu): změní jen `CsfdRating`,
formát souboru zůstane stejný, takže `git diff` ukáže jen změněná hodnocení. Na
GitHub Pages se nové hodnoty objeví až po commitu a pushi. Pomocný program starší
než tato změna zápis neumí; stránka pak požádá o jeho restart.

- Pokud má prohlížeč uložené úpravy z localStorage (např. anime přidaná Seznamem),
  stránka čte je místo `data/anime.json`, proto se hodnocení uloží i tam. Anime,
  která v `data/anime.json` nejsou, se vypíšou pod tlačítky a jejich hodnocení
  zůstane jen v prohlížeči.
- Když se hodnocení jednoho anime nepodaří zjistit (např. HTTP 404, změněná
  stránka, vypršený čas, nečekaný tvar hodnocení), anime si nechá původní hodnotu,
  běh pokračuje a na konci se pod tlačítky vypíše, kterých anime se to týkalo.
  Souhrn zůstane vidět do další aktualizace.
- Běh zastaví jen chyba, která by se opakovala u všech anime (pomocný program
  neběží, blokované přesměrování). Hodnocení zjištěná do té doby se do souboru
  zapíšou.
- Když zápis do souboru selže (soubor chybí, je poškozený nebo zamčený), hodnocení
  zůstanou uložená v prohlížeči a do souboru se dostanou přes Exportovat data.

### Uložení a publikace dat

Anime přidaná Seznamem se hned uloží do localStorage prohlížeče a jejich obrázky jako
`img/anime/N.jpg` (ČSFD hodnocení zapisuje pomocný program rovnou do souboru, viz
výše). Do repozitáře se data dostanou takto:

1. **Exportovat data** stáhne `AnimeData.json` (stejný tvar jako `data/anime.json`).
2. Soubor uložte jako `data/anime.json`.
3. Commitněte ho spolu s novými `img/anime/*.jpg`.

**Obnovit původní data** vrátí stránku k obsahu `data/anime.json`. V soukromém
režimu prohlížeče se localStorage nemusí zachovat, před zavřením stránky proto
data exportujte. Během aktualizace jsou zamčené Upravit, Importovat data a Obnovit
původní data (Exportovat data zůstává) a prohlížeč při zavírání stránky varuje.

### Rozdíly oproti AnimeList.pyw

- Anime se přidá a uloží až celé hotové, obrázek se stahuje jako poslední krok.
  Chyba běh zastaví a zobrazí se (včetně názvu anime); už přidaná anime zůstanou.
- Seznam ukládá data do prohlížeče, ne do souboru na disku (viz výše). ČSFD
  hodnocení zapisuje do `data/anime.json` pomocný program.
- Nová anime přijdou na konec aktuálního pořadí. Číslo je největší dosud použité
  číslo (v datech i v `img/anime`) zvýšené o 1.
- Odpověď HTTP 400 a vyšší je chyba. Hledání na MyAnimeList bez výsledků (MAL ho
  vrací jako HTTP 404) hlásí „Anime se na MyAnimeList nepodařilo najít“ a pokud
  MAL rovnou přesměruje na stránku anime, použije se tato stránka.
- Bez nových anime se zobrazí „Žádné nové anime.“. Chybějící sekce oblíbených na
  sledujserialy.io (typicky chybná cookie) je chyba.
- ČSFD hodnocení: skript při chybě jednoho anime spadne celý a nic neuloží, stránka
  ho přeskočí (viz výše). Text hodnocení se stejně jako ve skriptu ukládá bez mezer
  (`85%`, `?%`); hodnocení jiného tvaru se nezapíše.

### Řešení potíží

- **Pomocný program neodpovídá:** spusťte ho. Chrome a Edge mohou při prvním použití
  zobrazit dotaz na přístup k místní síti, ten povolte. Safari požadavky
  z HTTPS stránky na `http://127.0.0.1` obvykle blokuje, použijte jiný prohlížeč
  nebo stránku spusťte lokálně (`python -m http.server 8765` v kořeni repozitáře
  a `http://127.0.0.1:8765`).
- **Pomocný program stránku nepovoluje:** spusťte ho s `--allow-origin` a adresou
  stránky.
- **Pomocný program je zastaralý:** ukončete ho (Ctrl+C) a spusťte znovu, aby se
  načetla jeho nová verze.
- **Web vyžaduje ověření Cloudflare:** viz část o Cloudflare výše.
- **Požadavek byl přesměrován na nepovolenou adresu:** firemní filtr (např. Zscaler)
  blokuje obrázkový server serialy.sx. Nové anime se v takové síti nedokončí ani
  po vyřešení Cloudflare, protože se nepodaří stáhnout jeho obrázek. Pomocný program
  spusťte na zařízení mimo firemní síť a VPN.
- **Anime se na MyAnimeList nepodařilo najít:** MAL nenajde názvy s českou
  diakritikou (např. „Naruto: šippúden“). Protože běh u chyby končí, přidejte takové
  anime ručně (Exportovat data, doplnit položku v JSONu, Importovat data) a spusťte
  Seznam znovu.

### Testy

```
python -m unittest discover -s tools -p "test_anime_*.py"
```

- `tools/test_anime_proxy.py` testuje pomocný program (bez sítě).
- `tools/test_anime_update.py` testuje stránku v prohlížeči proti atrapě webů.
  Vyžaduje `pip install playwright` a nainstalovaný Edge nebo Chrome (jinak se
  přeskočí; cestu k prohlížeči lze zadat v `ANIME_TEST_BROWSER`). Spouští i
  jednotkové testy logiky v `tools/anime-sync-tests.html`, které lze po přihlášení
  otevřít také ručně.
