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
a Všechno. Hotové jsou volby **Zhlédnuté epizody**, **ČSFD hodnocení**, **MAL
hodnocení** a **Seznam**, Všechno je označené „Připravujeme“. Všechny potřebují
pomocný program (viz níže), který výsledky zapisuje přímo do `data/anime.json`.
Tlačítko **Push** pak změny na váš pokyn commitne a pushne na GitHub (viz Push).

### Aktualizovat → Seznam

Načte oblíbené seriály ze sledujserialy.io (funkce `UpdateAnimeList` ze skriptu).
Ke každému seriálu, který v seznamu ještě není (kromě výjimek jako ve skriptu),
dohledá data na ČSFD a MyAnimeList, stáhne obrázek a přidá ho na konec seznamu.
Průběh a výsledek se ukazují pod tlačítky.

Nová anime pomocný program na konci najednou zapíše do `data/anime.json` (jako
`WriteDataToTheFile` ve skriptu: seřazená podle čísla, ve stejném formátu, takže
`git diff` ukáže jen přidaná anime) a jejich obrázky uloží jako `img/anime/N.jpg`.
Když běh zastaví chyba, zapíšou se anime přidaná do té doby. Uložené úpravy
v prohlížeči a chyba zápisu se řeší stejně jako u ČSFD hodnocení (viz níže).
Nová anime i s obrázky se ukazují hned, i když stránku otevíráte z GitHub Pages,
kde ještě nejsou (viz Uložení a publikace dat).
Potřebuje pomocný program verze 7; se starší verzí stránka požádá o jeho restart.

Stránka na GitHub Pages si tyto weby sama stáhnout nemůže (CORS, přihlašovací
cookie) ani zapisovat soubory, proto potřebuje **pomocný program**, který běží na
vašem počítači. Stačí Python 3 (vyzkoušeno na 3.12) bez dalších balíčků:

```
python tools/anime_proxy.py
```

Poslouchá jen na `127.0.0.1:8787`. Parametry: `--port`, `--allow-origin ORIGIN`
(další adresa stránky; výchozí jsou GitHub Pages a `http://127.0.0.1:8765`,
`http://localhost:8765`), `--images-dir` (výchozí `img/anime`), `--data-file`
(soubor, do kterého se zapisují výsledky aktualizací; výchozí
`data/anime.json` vedle složky `tools`), `--check` a `--diag` (viz Diagnostika). Při
jiném portu nastavte v konzoli prohlížeče
`localStorage.setItem('anime-proxy-url', 'http://127.0.0.1:PORT')`.

**Přihlašovací cookie.** Seznam a Zhlédnuté epizody potřebují hodnotu cookie
`user_logged_in` z přihlášeného sledujserialy.io (stejnou jako v `AnimeList.pyw`).
Předejte ji proměnnou prostředí `SLEDUJ_SERIALY_LOGIN_COOKIE` nebo souborem
`tools/anime_proxy.local.json`, který je v `.gitignore` a nesmí se commitovat:

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
   a v anime stránce spusťte aktualizaci znovu.

Povolení platí jen pro stejnou IP adresu a stejný User-Agent a po omezenou dobu
(výchozí nastavení Cloudflare je 30 minut), potom postup zopakujte. Pokud výzva trvá
i s vyplněnými hodnotami, povolení vypršelo nebo pomocný program běží v jiné síti
než prohlížeč.

**Diagnostika.** `python tools/anime_proxy.py --check` zkusí sledujserialy.io (včetně
platnosti cookie), ČSFD a MyAnimeList a vypíše stav každého z nich. Ve firemní síti
(např. Zscaler) mohou být weby blokované nebo přesměrované (`redirect-blocked`,
chyba TLS), použijte jinou síť.

Podrobnější výpis dá `python tools/anime_proxy.py --diag ["název anime" ...]`.
U stejných stránek ukáže každý krok přesměrování (adresa, HTTP stav, server,
`content-type`, výzva Cloudflare) a odhadne, kde a s jakou chybou by pomocný
program skončil. Potom načte oblíbené ze sledujserialy.io. U zadaných anime
(část názvu, bez rozlišení velikosti písmen), nebo jinak u oblíbených, která
ještě nejsou v datovém souboru, sleduje stažení obrázku stejně jako tlačítko
Seznam. Nic neukládá a nevypisuje cookie ani obsah stránky účtu. U adres mimo
povolené weby skrývá parametry dotazu. Výpis tedy můžete celý poslat k rozboru.

### Aktualizovat → ČSFD hodnocení

Projde všechna anime v seznamu (i DROPPED a DONE, funkce `UpdateCSFD` ze skriptu),
načte jejich stránku na ČSFD podle `CsfdID` a přepíše `CsfdRating`. Anime se
zpracovávají jedno po druhém (u ~300 anime to trvá i několik minut), průběh se ukazuje
pod tlačítky a pořadí řádků se nemění. Nové hodnocení se v řádku anime ukáže hned po
zjištění (skript řádky překreslí až na konci). ČSFD nepotřebuje cookie ani řešení Cloudflare,
stačí spuštěný pomocný program.

Po zjištění všech hodnocení je pomocný program najednou zapíše přímo do
`data/anime.json` (jako `WriteDataToTheFile` ve skriptu): změní jen `CsfdRating`,
formát souboru zůstane stejný, takže `git diff` ukáže jen změněná hodnocení. Na
GitHub Pages se nové hodnoty objeví až po commitu a pushi (tlačítko Push). Pomocný program starší
než tato změna zápis neumí; stránka pak požádá o jeho restart.

- Pokud má prohlížeč uložené úpravy z localStorage (např. z edit módu, importu nebo
  ze starší verze Seznamu), stránka čte je místo `data/anime.json`, proto se
  hodnocení uloží i tam. Anime, která v `data/anime.json` nejsou, se vypíšou pod
  tlačítky a jejich hodnocení zůstane jen v prohlížeči.
- Když se hodnocení jednoho anime nepodaří zjistit (např. HTTP 404, změněná
  stránka, vypršený čas, nečekaný tvar hodnocení), anime si nechá původní hodnotu,
  běh pokračuje a na konci se pod tlačítky vypíše, kterých anime se to týkalo.
  Souhrn zůstane vidět do další aktualizace.
- Běh zastaví jen chyba, která by se opakovala u všech anime (pomocný program
  neběží, blokované přesměrování). Hodnocení zjištěná do té doby se do souboru
  zapíšou.
- Když zápis do souboru selže (soubor chybí, je poškozený nebo zamčený), hodnocení
  zůstanou uložená v prohlížeči a do souboru se dostanou přes Exportovat data.

### Aktualizovat → MAL hodnocení

Funguje stejně jako ČSFD hodnocení (funkce `UpdateMAL` ze skriptu): projde všechna
anime, načte jejich stránku na MyAnimeList podle `MalID`, převede skóre na procenta
(`7.65` → `76%`, zaokrouhlení jako `round` v Pythonu) a po zjištění všech je pomocný
program najednou zapíše do `data/anime.json`, kde změní jen `MalRating`. Zobrazení
hodnocení v řádku hned po zjištění, přeskočení anime při chybě, výpis anime mimo
soubor i chování při chybě zápisu jsou stejné jako u ČSFD. MyAnimeList nepotřebuje
cookie.

- Anime s `MalID` `0` (na MyAnimeList není) dostane `?%` bez stahování, jako ve
  skriptu.
- Anime, které na MyAnimeList zatím skóre nemá („N/A“), dostane `?%`.
- Potřebuje pomocný program verze 3; se starší verzí stránka požádá o jeho restart.

### Aktualizovat → Zhlédnuté epizody

Podle oblíbených seriálů na sledujserialy.io přepíše stav zhlédnutí (`State`), jako
funkce `UpdateWatched` ze skriptu. Stejně jako Seznam potřebuje přihlašovací cookie
(a případně vyřešení Cloudflare, viz výše).

- Anime, které v oblíbených není (porovnává se `FavoriteName`) nebo má ve stavu
  `DROPPED`, se nemění.
- Oblíbený bez „Pokračuj“ je dokončený seriál, stav je `DONE`.
- U oblíbeného s „Pokračuj“ se načte stránka seriálu a podle ikon řad se ověří,
  jestli opravdu není dokončený. Je-li nezhlédnutá řada z odkazu „Pokračuj“, stav
  je řada a epizoda z odkazu (`S02E07`); je-li nezhlédnutá jiná řada, je to tato
  řada bez epizody (`S03E--`). Když jsou všechny řady zhlédnuté nebo stránka žádné
  řady nemá, stav je `DONE` (jako ve skriptu).
- Zjištěný stav se v řádku anime ukáže hned (stejně jako hodnocení), ne až po
  zpracování všech anime. Průběh u zhlédnutých epizod počítá jako skript už
  zahájené anime, takže „100.00% Aktualizuji…“ znamená, že se ještě zpracovává
  poslední anime a zapisuje soubor; hotovo je až při „100.00% Hotovo“.
- Po zpracování všech anime pomocný program zapíše zjištěné stavy najednou do
  `data/anime.json` (změní jen `State`). Uložené úpravy v prohlížeči, anime mimo
  soubor a chyba zápisu se řeší stejně jako u ČSFD hodnocení.
- Když se stav jednoho anime nepodaří zjistit (např. HTTP 404, vypršený čas, web
  stránku seriálu přesměroval jinam), anime si nechá původní stav, běh pokračuje
  a na konci se vypíše, kterých anime se to týkalo. Běh zastaví chyba, která by se
  opakovala u všech anime (výzva Cloudflare, pomocný program neběží, chybí cookie
  nebo sekce oblíbených); stavy zjištěné do té doby se do souboru zapíšou.
- Potřebuje pomocný program verze 4; se starší verzí stránka požádá o jeho restart.

### Uložení a publikace dat

Všechny volby Aktualizovat zapisují výsledky přes pomocný program rovnou do
`data/anime.json` (Seznam navíc ukládá obrázky jako `img/anime/N.jpg`). Na GitHub
Pages se změny objeví až po commitu a pushi `data/anime.json` spolu s novými
`img/anime/*.jpg` – tlačítkem **Push** (viz níže) nebo ručně.

Aby nová anime ze Seznamu do té doby nezmizela, drží si je stránka i s obrázky
v prohlížeči (localStorage `anime-pending-additions`) a při načtení je doplní
k `data/anime.json`. Jakmile načtený `data/anime.json` dané anime obsahuje, z
prohlížeče se smaže a obrázek se bere z `img/anime`. Platí to jen pro prohlížeč,
ve kterém aktualizace proběhla; změněná hodnocení a epizody se na GitHub Pages
ukážou až po pushi.

Úpravy z edit módu a importu a výsledky, které se do souboru zapsat nepodařilo, se
ukládají do localStorage prohlížeče a mají přednost před `data/anime.json`. Do
repozitáře se dostanou takto:

1. **Exportovat data** stáhne `AnimeData.json` (stejný tvar jako `data/anime.json`).
2. Soubor uložte jako `data/anime.json`.
3. Commitněte ho spolu s novými `img/anime/*.jpg`.

**Obnovit původní data** smaže úpravy uložené v prohlížeči a vrátí stránku
k obsahu `data/anime.json`; co v souboru není, předtím exportujte. Nová anime,
která pomocný program do souboru zapsal a web je ještě nemá, zůstanou. V soukromém
režimu prohlížeče se localStorage nemusí zachovat, před zavřením stránky proto
data exportujte. Během aktualizace jsou zamčené Upravit, Importovat data, Obnovit
původní data a Push (Exportovat data zůstává) a prohlížeč při zavírání stránky varuje.

### Push

Tlačítko **Push** (vedle Aktualizovat) nechá pomocný program publikovat výsledky
aktualizací. Nic z toho se neděje automaticky, jen po stisku tlačítka:

1. Do commitu se zahrne jen `data/anime.json` a obrázky `img/anime/N.jpg` (nové
   i změněné). Ostatní změny v repozitáři, i ty připravené přes `git add`, zůstanou
   mimo commit tak, jak jsou.
2. Commit má zprávu `feat: anime list update`.
3. Větev `main` se pushne na `origin`, s ní i dřívější commity, které na GitHubu
   ještě nejsou.

Výsledek (zkrácený hash commitu a počet souborů) se ukáže pod tlačítky; GitHub
Pages web obvykle aktualizuje do několika minut. Když se nic nezměnilo a vše už
na GitHubu je, stránka napíše „Není co publikovat“. Úpravy uložené jen
v prohlížeči (edit mód, import, nezapsané výsledky) se nepublikují – stránka na
ně upozorní; do souboru je dostanete přes Exportovat data.

- Repozitář musí být na větvi `main` bez rozpracovaného merge, rebase nebo
  cherry-picku a mít remote `origin`; jinak se nic nestane a stránka řekne proč.
- Push používá jen uložené přihlášení gitu (Git Credential Manager, SSH klíč);
  nikdy neotevře přihlašovací okno ani se nezeptá na heslo. Když přihlášení chybí,
  skončí chybou přihlášení – pushněte jednou ručně (`git push`).
- Když push selže (GitHub má novější commity, přihlášení, síť), commit zůstane
  jen u vás a stačí problém vyřešit a stisknout Push znovu. Když selže už commit
  (např. hook), repozitář zůstane jako před stiskem Push.
- Git, který neodpoví včas (commit 60 s, push 120 s), pomocný program ukončí
  i se vším, co spustil; Push pak lze stisknout znovu.
- Potřebuje pomocný program verze 8; se starší verzí stránka požádá o jeho restart.

### Rozdíly oproti AnimeList.pyw

- Anime se přidá až celé hotové, obrázek se stahuje jako poslední krok. Chyba běh
  zastaví a zobrazí se (včetně názvu anime); anime přidaná do té doby se zapíšou do
  `data/anime.json` (skript by při chybě nezapsal nic).
- Obrázky se stahují rovnou ze sledujserialy.io (jen ze složky `/upload/`). Skript
  je bral ze serialy.sx, který teď na sledujserialy.io jen přesměrovává. Obrázek
  dostane `cf_clearance` a User-Agent z nastavení, přihlašovací cookie ne. Ukládá se
  beze změny jako `N.jpg` i ve formátu WEBP, stejně jako ve skriptu. Prohlížeč ho
  zobrazí podle obsahu. Pomocný program ho navíc vrátí stránce, aby ho ukázala
  i před nahráním na web.
- Pomocný program nikdy nepřepíše anime, jehož číslo už v `data/anime.json` je;
  zápis pak odmítne (`item-exists`) a nová anime zůstanou v prohlížeči.
- Nová anime přijdou na konec aktuálního pořadí. Číslo je největší dosud použité
  číslo (v datech i v `img/anime`) zvýšené o 1.
- Odpověď HTTP 400 a vyšší je chyba. Hledání na MyAnimeList bez výsledků (MAL ho
  vrací jako HTTP 404) hlásí „Anime se na MyAnimeList nepodařilo najít“ a pokud
  MAL rovnou přesměruje na stránku anime, použije se tato stránka.
- Bez nových anime se zobrazí „Žádné nové anime.“. Chybějící sekce oblíbených na
  sledujserialy.io (typicky chybná cookie) je chyba.
- ČSFD a MAL hodnocení a zhlédnuté epizody: skript při chybě jednoho anime spadne
  celý a nic neuloží, stránka ho přeskočí (viz výše). Text hodnocení se stejně jako
  ve skriptu ukládá bez mezer (`85%`, `?%`); hodnocení jiného tvaru se nezapíše.
  Stejně tak stav zhlédnutí jiného tvaru než `DONE` nebo `S<řada>E<epizoda>`
  (epizoda může být `--`).
- MAL hodnocení anime bez skóre („N/A“) je `?%` (při aktualizaci hodnocení i při
  přidání Seznamem). Skript v tomto případě omylem vezme číslo z dalšího prvku
  stránky (počet členů) a zapíše nesmysl jako `1690%`.

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
- **Požadavek byl přesměrován na adresu, kterou pomocný program nepovoluje:** firemní
  filtr (např. Zscaler) přesměrovává blokované weby na svou stránku. Pomocný program
  pak spusťte na zařízení mimo firemní síť a VPN. Pokud se chyba objevuje i mimo
  firemní síť, web nejspíš změnil adresy (tak se ze serialy.sx stal
  sledujserialy.io). `python tools/anime_proxy.py --diag "název anime"` ukáže, kam
  přesměrování vede.
- **Anime se na MyAnimeList nepodařilo najít:** MAL nenajde názvy s českou
  diakritikou (např. „Naruto: šippúden“). Protože běh u chyby končí, přidejte takové
  anime ručně (Exportovat data, doplnit položku v JSONu, Importovat data) a spusťte
  Seznam znovu.
- **Výsledek se nepodařilo zapsat, podrobnosti `item-exists`:** `data/anime.json`
  už obsahuje anime se stejným číslem (soubor se změnil mimo stránku). Nová anime
  zůstala v prohlížeči; data exportujte a se souborem je sloučte ručně.
- **Push: GitHub obsahuje novější změny:** v repozitáři spusťte `git pull --rebase`
  a stiskněte Push znovu (váš commit se přenese na nejnovější stav).
- **Push: přihlášení ke GitHubu se nezdařilo:** pushněte jednou ručně (`git push`),
  aby si git přihlášení uložil, a stiskněte Push znovu.
- **Push: repozitář není na větvi main / rozpracovaný merge nebo rebase:** přepněte
  se na `main`, případně merge nebo rebase dokončete (nebo zrušte) a stiskněte Push
  znovu. Průběh Push a kód chyby s podrobnostmi vypisuje i okno pomocného programu.

### Testy

```
python -m unittest discover -s tools -p "test_anime_*.py"
```

- `tools/test_anime_proxy.py` testuje pomocný program (bez sítě; Push s gitem
  v dočasných repozitářích, bez git se tyto testy přeskočí).
- `tools/test_anime_update.py` testuje stránku v prohlížeči proti atrapě webů.
  Vyžaduje `pip install playwright` a nainstalovaný Edge nebo Chrome (jinak se
  přeskočí; cestu k prohlížeči lze zadat v `ANIME_TEST_BROWSER`). Spouští i
  jednotkové testy logiky v `tools/anime-sync-tests.html`, které lze po přihlášení
  otevřít také ručně.
