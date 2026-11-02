"""Prohlížečové testy Aktualizovat -> Seznam, ČSFD hodnocení, MAL hodnocení a Zhlédnuté epizody
(anime.html, js/anime-*.js a tools/anime_proxy.py).

Stránku řídí Playwright, pomocník běží ve stejném procesu a weby, ze kterých
stahuje (sledujserialy.io, ČSFD, MyAnimeList), nahrazuje atrapa -
testy nepoužívají síť ani přihlašovací cookie. Pomocník zapisuje do dočasné
kopie data/anime.json, kterou stránka načítá místo souboru v repozitáři.
Třída BrowserUnitTests navíc spouští tools/anime-sync-tests.html (testy
js/anime-sync.js a js/anime-proxy.js; stránku lze otevřít i ručně v prohlížeči).

Spuštění:  python -m unittest discover -s tools -p "test_anime_update.py" -v
Vyžaduje:  pip install playwright a nainstalovaný Microsoft Edge nebo Google Chrome
           (jinak se testy přeskočí; jiný prohlížeč lze zadat proměnnou ANIME_TEST_BROWSER).
"""

import base64
import functools
import http.server
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import threading
import unittest
from datetime import date
from unittest import mock

try:
    from playwright.sync_api import expect, sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, TOOLS_DIR)
import anime_proxy as proxy  # noqa: E402
from test_anime_proxy import GIT_INSTALLED, git, isolate_git, remove_tree  # noqa: E402

COOKIE = "E2E-FAKE-COOKIE"
# Skutečný obrázek 1x1 (WEBP jako na sledujserialy.io), aby ho prohlížeč dokázal zobrazit.
WEBP = base64.b64decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")
WINDOWS_EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

ITEM_KEYS = ["Number", "FavoriteName", "FavoriteUrlName", "CsfdID", "MalID", "MalName", "Image", "NameEn",
             "NameJa", "Genres", "Description", "Date", "State", "CsfdRating", "MalRating", "MyRating"]

# Čísla jsou záměrně vysoká, aby k nim v repozitáři nebyly žádné obrázky.
SEED_NUMBERS = (9001, 9002, 9004)

FAVORITES_URL = "https://sledujserialy.io/ucet/"
SERIAL_PREFIX = "https://sledujserialy.io/serial/"
IMAGE_ORIGIN = "https://sledujserialy.io"
CSFD_SEARCH_PREFIX = "https://www.csfd.cz/hledat/"
CSFD_FILM_PREFIX = "https://www.csfd.cz/film/"
MAL_ANIME_PREFIX = "https://myanimelist.net/anime/"

SHOW_A = {
    "name": "New Show A", "slug": "new-show-a", "image": "/upload/serial/new-show-a.jpg",
    "csfd_id": "111111", "mal_id": "22222", "mal_slug": "New_Show_A", "mal_name": "New Show A",
    "name_en": "New Show A EN", "name_ja": "Shin Show A", "csfd_rating": "75%", "mal_score": "7.89",
    "mal_rating": "79%", "plot": "Popis A", "state": "S01E05",
    "csfd_search": "https://www.csfd.cz/hledat/?q=New+Show+A",
    "mal_search": "https://myanimelist.net/anime.php?cat=anime&q=New%20Show%20A",
}
SHOW_B = {
    "name": "New Show B", "slug": "new-show-b", "image": "/upload/serial/new-show-b.jpg",
    "csfd_id": "222222", "mal_id": "33333", "mal_slug": "New_Show_B", "mal_name": "New Show B",
    "name_en": "New Show B EN", "name_ja": "Shin Show B", "csfd_rating": "64%", "mal_score": "7.5",
    "mal_rating": "75%", "plot": "Popis B", "state": "DONE",
    "csfd_search": "https://www.csfd.cz/hledat/?q=New+Show+B",
    "mal_search": "https://myanimelist.net/anime.php?cat=anime&q=New%20Show%20B",
}
# Při jednoznačném názvu MyAnimeList přesměruje rovnou na stránku anime.
SHOW_B["mal_redirect"] = "https://myanimelist.net/anime/33333/New_Show_B"

MAL_NOT_FOUND = "<html><body>No titles that matched your query were found.</body></html>"

PUSH_TITLE_EN = ('Commits data/anime.json and new images from img/anime with the message "feat: anime list update" '
                 'and pushes them to GitHub (branch main).')
PUSH_NOTHING = "Není co publikovat: data/anime.json ani obrázky se nezměnily a vše už je na GitHubu."

# Úpravy uložené v prohlížeči dřívější verzí stránky (klíč js/anime-data.js LEGACY_STORAGE_KEY);
# vloží se jen při prvním načtení, aby šlo ověřit, že je stránka smazala.
LEGACY_OVERRIDES_SCRIPT = (
    "if (sessionStorage.getItem('test-legacy-seeded') === null) {"
    "sessionStorage.setItem('test-legacy-seeded', '1');"
    "localStorage.setItem('anime-data-overrides', %s);}"
)

# Zaznamená adresy všech fetch() požadavků stránky do window.__fetches.
FETCH_LOG_SCRIPT = """
window.__fetches = [];
(function () {
    const original = window.fetch;
    window.fetch = function (input) {
        window.__fetches.push(String(input && input.url ? input.url : input));
        return original.apply(this, arguments);
    };
})();
"""


def favorites_page(entries):
    """entries: (název, slug, obrázek, dokončeno[, epizoda v odkazu, výchozí "s01e05"])"""
    blocks = []
    for entry in entries:
        name, slug, image, finished = entry[:4]
        episode = entry[4] if len(entry) > 4 else "s01e05"
        state = "S01E24" if finished else "Pokračuj"
        blocks.append(
            f'<div class="a-favorites__item"><a href="/episode/{slug}-{episode}/"><img src="{image}">'
            f'<h2 class="a-favorites__title">{name}</h2><span>{state}</span></a></div>'
        )
    return f'<html><body><div id="favorites">{"".join(blocks)}</div><div id="planned"></div></body></html>'


def watched_favorite(number, finished, episode="s01e05"):
    """Oblíbený seriál k anime ze SEED_DATA (FavoriteName "Known <číslo>")."""
    return ("Known %d" % number, "known-%d" % number, "/upload/serial/known-%d.jpg" % number, finished, episode)


def serial_page(seasons):
    """Stránka seriálu na sledujserialy.io; seasons: [(číslo řady, "Videné" | "Označiť"), ...]"""
    blocks = "".join(
        f'<div class="season" data-season="{number}"><h3>Séria {number}</h3>'
        f'<a href="#"><i title="{state}" class="fa fa-eye"></i></a></div>'
        for number, state in seasons
    )
    return f'<html><body><div class="seasons">{blocks}</div></body></html>'


def csfd_search_page(film_id):
    return (
        '<html><body><section class="main-box" data-search-results="series">'
        '<article class="article article-poster-60"><figure class="article-img">'
        f'<a href="/film/{film_id}-test/prehled/"><img src="x.jpg"></a></figure></article>'
        "</section></body></html>"
    )


def csfd_film_page(name_en, name_ja, rating, plot):
    return f"""<html><body><div class="main-movie">
<div class="film-header-name"><h1>
    {name_en}
</h1>
<ul class="film-names">
<li><img src="f.svg" class="flag" title="Japonsko" alt="Japonsko"/>		{name_ja}
<span class="normal more-name-link"></span></li>
<li><img src="f.svg" class="flag" title="angličtina" alt="angličtina"/>		{name_en}
</li>
</ul></div>
<div class="film-rating-average">
    {rating}
</div>
<div class="genres"><a href="/zanry/3-animovany/">Animovaný</a> <span class="bullet"></span> <a href="/zanry/1-akcni/">Akční</a></div>
<div class="plot-full">
<p>
    {plot}
<em class="span-more-small">(<a href="https://example.test/">Zdroj</a>)</em>
</p></div>
</div><div id="bottom-banner"></div></body></html>"""


def mal_search_page(mal_id, slug):
    return (
        "<html><body><table><tr><td>Title</td></tr><tr><td><div class=\"picSurround\">"
        f'<a href="https://myanimelist.net/anime/{mal_id}/{slug}" class="hoverinfo_trigger"><img src="x.jpg"></a>'
        "</div></td></tr></table></body></html>"
    )


def mal_anime_page(score):
    return f'<html><body><div class="score-label score-8">{score}</div></body></html>'


def seed_item(number):
    name = "Known %d" % number
    return {
        "Number": str(number), "FavoriteName": name, "CsfdID": str(number), "MalID": str(number),
        "MalName": name, "Image": str(number), "NameEn": name + " EN", "NameJa": name + " JA",
        "Genres": "Akční", "Description": "Popis " + name, "Date": "01.01.2024", "State": "DONE",
        "CsfdRating": "70%", "MalRating": "71%", "MyRating": "72%",
    }


SEED_DATA = {str(number): seed_item(number) for number in SEED_NUMBERS}
KNOWN_FAVORITE = ("Known 9001", "known-9001", "/upload/serial/known.jpg", True)
EXCEPTION_FAVORITE = ("Owari no Seraph: Nagoja kessen hen", "owari", "/upload/serial/owari.jpg", False)


def expected_item(show, number, today):
    return {
        "Number": str(number), "FavoriteName": show["name"], "FavoriteUrlName": show["slug"], "CsfdID": show["csfd_id"],
        "MalID": show["mal_id"], "MalName": show["mal_name"], "Image": str(number), "NameEn": show["name_en"],
        "NameJa": show["name_ja"], "Genres": "Animovaný\nAkční", "Description": show["plot"], "Date": today,
        "State": show["state"], "CsfdRating": show["csfd_rating"], "MalRating": show["mal_rating"], "MyRating": "?%",
    }


class FakeWeb:
    """Nahrazuje síťové spojení pomocníka (http_get_once) připravenými stránkami."""

    def __init__(self):
        self._lock = threading.Lock()
        self._calls = []
        self.pages = {}
        self.unknown = []
        # Požadavek na adresu začínající tímto řetězcem se zastaví, dokud se nespustí `release`.
        self.hold_prefix = None
        self.reached = threading.Event()
        self.release = threading.Event()

    def serve(self, url, body, status=200, headers=None):
        self.pages[url] = (status, dict(headers or {}), body.encode("utf-8") if isinstance(body, str) else body)

    def redirect(self, url, location):
        self.pages[url] = (301, {"location": location}, b"")

    def serve_show(self, show):
        self.serve(show["csfd_search"], csfd_search_page(show["csfd_id"]))
        self.serve("https://www.csfd.cz/film/" + show["csfd_id"],
                   csfd_film_page(show["name_en"], show["name_ja"], show["csfd_rating"], show["plot"]))
        if "mal_redirect" in show:
            self.redirect(show["mal_search"], show["mal_redirect"])
            self.serve(show["mal_redirect"], mal_anime_page(show["mal_score"]))
        else:
            self.serve(show["mal_search"], mal_search_page(show["mal_id"], show["mal_slug"]))
        self.serve("https://myanimelist.net/anime/" + show["mal_id"], mal_anime_page(show["mal_score"]))
        self.serve(IMAGE_ORIGIN + show["image"], WEBP)

    def __call__(self, url, headers, timeout, max_bytes):
        with self._lock:
            self._calls.append((url, dict(headers)))
        if self.hold_prefix and url.startswith(self.hold_prefix):
            self.reached.set()
            self.release.wait(30)
        if url not in self.pages:
            with self._lock:
                self.unknown.append(url)
            raise proxy.ProxyError("network-error", 502)
        return self.pages[url]

    @property
    def calls(self):
        with self._lock:
            return list(self._calls)

    @property
    def urls(self):
        return [url for url, _headers in self.calls]


class QuietStaticHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def launch_browser(playwright):
    custom = os.environ.get("ANIME_TEST_BROWSER")
    attempts = [{"executable_path": custom}] if custom else [{"channel": "msedge"}, {"channel": "chrome"}]
    if not custom and os.path.exists(WINDOWS_EDGE):
        attempts.append({"executable_path": WINDOWS_EDGE})
    attempts.append({})
    last_error = None
    for options in attempts:
        try:
            return playwright.chromium.launch(headless=True, args=["--no-sandbox"], **options)
        except Exception as error:  # noqa: BLE001 - Playwright má vlastní typy výjimek
            last_error = error
    raise unittest.SkipTest("Playwright nenašel prohlížeč (%s)." % type(last_error).__name__)


INFO_LOG_SCRIPT = """() => {
    window.__infoLog = [];
    const info = document.getElementById('anime-update-info');
    new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                window.__infoLog.push(node.textContent);
            }
            if (record.addedNodes.length === 0 && record.removedNodes.length > 0) {
                window.__infoLog.push('');
            }
        }
    }).observe(info, { childList: true, characterData: true, subtree: true });
}"""


@unittest.skipIf(sync_playwright is None, "Není nainstalovaný Playwright (pip install playwright).")
class SiteBrowserCase(unittest.TestCase):
    """Statický server s kořenem repozitáře a prohlížeč sdílený všemi testy třídy."""

    @classmethod
    def setUpClass(cls):
        static = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietStaticHandler, directory=ROOT))
        threading.Thread(target=static.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        cls.addClassCleanup(static.server_close)
        cls.addClassCleanup(static.shutdown)
        cls.origin = "http://127.0.0.1:%d" % static.server_address[1]

        playwright = sync_playwright().start()
        cls.addClassCleanup(playwright.stop)
        cls.browser = launch_browser(playwright)
        cls.addClassCleanup(cls.browser.close)


@unittest.skipIf(sync_playwright is None, "Není nainstalovaný Playwright (pip install playwright).")
class UpdateListTests(SiteBrowserCase):
    @classmethod
    def setUpClass(cls):
        patcher = mock.patch.object(proxy.Handler, "log_request", lambda *args, **kwargs: None)
        patcher.start()
        cls.addClassCleanup(patcher.stop)
        super().setUpClass()

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.images_dir = os.path.join(self.tmp, "img")
        os.makedirs(self.images_dir)
        # Pomocník zapisuje do kopie dat a stránka ji načítá místo data/anime.json repozitáře.
        self.data_file = os.path.join(self.tmp, "anime.json")
        self.write_data_file(SEED_DATA)
        # S hodnotou stránka dostane tato data místo souboru pomocníka (web bez nahraných změn).
        self.served_data = None
        # Pravda = web místo dat vrátí chybu serveru.
        self.data_error = False
        self.web = FakeWeb()
        self.web.serve(FAVORITES_URL, favorites_page([
            KNOWN_FAVORITE,
            (SHOW_A["name"], SHOW_A["slug"], SHOW_A["image"], False),
            EXCEPTION_FAVORITE,
            (SHOW_B["name"], SHOW_B["slug"], SHOW_B["image"], True),
        ]))
        self.web.serve_show(SHOW_A)
        self.web.serve_show(SHOW_B)
        self.console = []
        self.page_errors = []

    def tearDown(self):
        self.assertEqual(self.web.unknown, [], "pomocník stahoval adresu, kterou test nepřipravil")

    def start_helper(self, config=None, data_path=True):
        server = proxy.ProxyServer(0, proxy.DEFAULT_ORIGINS + (self.origin,), self.images_dir,
                                   config or proxy.Config(cookie=COOKIE), self.web,
                                   data_path=self.data_file if data_path is True else data_path)
        threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        # Přidáno až po zavření serveru, takže se spustí dřív - zastavené požadavky se uvolní.
        self.addCleanup(self.web.release.set)
        return "http://127.0.0.1:%d" % server.server_address[1]

    @staticmethod
    def python_json(data):
        """Stejný text jako Python WriteDataToTheFile() a data/anime.json."""
        return json.dumps(data, indent=4, ensure_ascii=False).encode("utf-8")

    def write_data_file(self, data):
        with open(self.data_file, "wb") as handle:
            handle.write(data if isinstance(data, bytes) else self.python_json(data))

    def read_data_file(self):
        with open(self.data_file, "rb") as handle:
            return handle.read()

    def serve_data_file(self, route):
        if self.data_error:
            route.fulfill(status=500, content_type="text/plain", body="Server error")
            return
        body = self.read_data_file() if self.served_data is None else self.python_json(self.served_data)
        route.fulfill(status=200, content_type="application/json; charset=utf-8", body=body)

    def open_page(self, helper_url, lang="cs", role="full", init_script="", viewport=None, wait_list=True):
        """Otevře stránku přihlášenou rolí `role`; data čte ze souboru pomocníka (nebo `served_data`)."""
        context = self.browser.new_context(viewport=viewport or {"width": 1400, "height": 900})
        self.addCleanup(context.close)
        context.route(re.compile(r"/data/anime\.json(\?|$)"), self.serve_data_file)
        role_script = "sessionStorage.setItem('site-auth-role', %s);" % json.dumps(role) if role else ""
        context.add_init_script(
            role_script
            + "localStorage.setItem('site-lang', %s);"
            "localStorage.setItem('anime-proxy-url', %s);"
            % (json.dumps(lang), json.dumps(helper_url)) + init_script
        )
        page = context.new_page()
        page.on("console", lambda message: self.console.append((message.type, message.text)))
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        page.goto(self.origin + "/anime.html")
        if wait_list:
            expect(page.locator("#anime-list-wrap")).to_be_visible()
        return page

    def run_list_update(self, page):
        page.locator("#anime-update-toggle").click()
        page.locator("#anime-update-list-btn").click()

    def row_numbers(self, page):
        return page.locator("#anime-list .anime-row").evaluate_all("rows => rows.map(row => row.dataset.number)")

    def pending(self, page):
        """Nepublikovaná anime v prohlížeči (js/anime-data.js PENDING_KEY), nebo None."""
        raw = page.evaluate("() => localStorage.getItem('anime-pending-additions')")
        return None if raw is None else json.loads(raw)

    def expect_shown_image(self, page, number):
        """Řádek ukazuje obrázek uložený v prohlížeči a prohlížeč ho dokázal zobrazit."""
        row = page.locator('.anime-row[data-number="%s"]' % number)
        row.scroll_into_view_if_needed()
        image = row.locator("img.anime-row__image")
        expect(image).to_have_attribute("src", "data:image/webp;base64," + base64.b64encode(WEBP).decode("ascii"))
        page.wait_for_function("image => image.complete && image.naturalWidth === 1", arg=image.element_handle())
        expect(row.locator(".anime-row__image-missing")).to_have_count(0)

    def expect_serial_link(self, page, number, slug):
        """Obrázek (nebo popisek chybějícího obrázku) řádku je odkaz na seriál v nové kartě."""
        link = page.locator('.anime-row[data-number="%s"] a.anime-row__image-link' % number)
        expect(link).to_have_count(1)
        expect(link).to_have_attribute("href", SERIAL_PREFIX + slug)
        expect(link).to_have_attribute("target", "_blank")
        expect(link).to_have_attribute("rel", "noopener noreferrer")

    def expect_no_serial_link(self, page, number):
        cell = page.locator('.anime-row[data-number="%s"] .anime-row__cell--Image' % number)
        expect(cell).to_have_count(1)
        expect(cell.locator("a")).to_have_count(0)

    def unexpected_console_errors(self):
        # 404 na obrázky chybějící v repozitáři je v těchto testech očekávané.
        return [text for kind, text in self.console
                if kind == "error" and not text.startswith("Failed to load resource")]

    def expect_unlocked(self, page):
        expect(page.locator("#anime-update-toggle")).to_be_enabled(timeout=8000)
        expect(page.locator("#anime-update-info")).to_have_text("")

    def test_menu_shows_all_update_buttons(self):
        page = self.open_page(self.start_helper())
        toggle = page.locator("#anime-update-toggle")
        menu = page.locator("#anime-update-menu")
        expect(toggle).to_be_enabled()
        expect(menu).to_be_hidden()

        toggle.click()
        expect(menu).to_be_visible()
        expect(toggle).to_have_attribute("aria-expanded", "true")
        expect(menu.locator("button")).to_have_text(
            ["Zhlédnuté epizody", "ČSFD hodnocení", "MAL hodnocení", "Seznam", "Všechno"])
        # Zapojené jsou všechny volby kromě Všechno.
        button = page.locator("#anime-update-all-btn")
        expect(button).to_be_disabled()
        expect(button).to_have_attribute("title", "Připravujeme")
        for name in ("watched", "csfd", "mal", "list"):
            button = page.locator("#anime-update-%s-btn" % name)
            expect(button).to_be_enabled()
            expect(button).not_to_have_attribute("title", "Připravujeme")

        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(toggle).to_be_focused()

        toggle.click()
        toggle.click()
        expect(menu).to_be_hidden()

    def test_keyboard_opens_menu_and_focuses_first_available_button(self):
        page = self.open_page(self.start_helper())
        page.locator("#anime-update-toggle").focus()
        page.keyboard.press("Enter")
        expect(page.locator("#anime-update-menu")).to_be_visible()
        expect(page.locator("#anime-update-watched-btn")).to_be_focused()

    def test_list_update_adds_new_favorites(self):
        helper = self.start_helper()
        page = self.open_page(helper)
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004"])
        page.evaluate(INFO_LOG_SCRIPT)

        today_before = date.today().strftime("%d.%m.%Y")
        self.run_list_update(page)
        expect(page.locator("#anime-update-menu")).to_be_hidden()
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo. Celkem 2 nové anime.")
        self.expect_unlocked(page)
        today_after = date.today().strftime("%d.%m.%Y")

        # Texty průběhu jako ve skriptu AnimeList.pyw (UpdateAnimeList); 1-4 anime jsou "nové", víc "nových".
        expected_log = (
            ["0.00% Aktualizuji anime list", "0.00% Aktualizuji anime list. Celkem 2 nové anime."]
            + ["%d.00%% Aktualizuji anime list. Celkem 2 nové anime." % percent for percent in range(10, 101, 10)]
            + ["100.00% Hotovo. Celkem 2 nové anime.", ""]
        )
        info_log = []
        for text in page.evaluate("() => window.__infoLog"):
            if not info_log or info_log[-1] != text:
                info_log.append(text)
        self.assertEqual(info_log, expected_log)

        # Nové anime dostanou číslo o jedna vyšší než dosavadní maximum.
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9005", "9006"])
        # Pomocník je zapsal do souboru s daty jako Python WriteDataToTheFile().
        saved = json.loads(self.read_data_file())
        self.assertEqual(list(saved), ["9001", "9002", "9004", "9005", "9006"])
        for number, show in (("9005", SHOW_A), ("9006", SHOW_B)):
            item = saved[number]
            self.assertEqual(list(item), ITEM_KEYS)
            self.assertIn(item["Date"], {today_before, today_after})
            self.assertEqual(item, expected_item(show, int(number), item["Date"]))
        self.assertEqual(self.read_data_file(), self.python_json(saved))
        # Anime 9001 je v oblíbených, takže dostalo adresu seriálu (hned za FavoriteName); 9002 a 9004 v nich nejsou.
        self.assertEqual({number: saved[number] for number in SEED_DATA},
                         dict(SEED_DATA, **{"9001": dict(SEED_DATA["9001"], FavoriteUrlName="known-9001")}))
        self.assertEqual(list(saved["9001"]), ITEM_KEYS)

        # Obrázky uložil pomocník pod stejným číslem, jaké má anime.
        self.assertEqual(sorted(os.listdir(self.images_dir)), ["9005.jpg", "9006.jpg"])
        with open(os.path.join(self.images_dir, "9005.jpg"), "rb") as handle:
            self.assertEqual(handle.read(), WEBP)

        row = page.locator('.anime-row[data-number="9005"]')
        expect(row.locator(".anime-row__cell--NameEn")).to_have_text("New Show A EN")
        expect(row.locator(".anime-row__cell--NameJa")).to_have_text("Shin Show A")
        expect(row.locator(".anime-row__cell--State")).to_have_text("S01E05")
        expect(row.locator(".anime-row__cell--CsfdRating")).to_have_text("75%")
        expect(row.locator(".anime-row__cell--MalRating")).to_have_text("79%")
        expect(row.locator(".anime-row__cell--MyRating")).to_have_text("?%")
        expect(page.locator('.anime-row[data-number="9006"] .anime-row__cell--State')).to_have_text("DONE")
        # Obrázek je na webu až po nahrání souboru, řádek ukáže ten, který pomocník vrátil.
        self.expect_shown_image(page, "9005")
        self.expect_shown_image(page, "9006")
        # Kliknutí na obrázek otevře seriál na sledujserialy.io (i u doplněné adresy bez obrázku).
        self.expect_serial_link(page, "9005", "new-show-a")
        self.expect_serial_link(page, "9006", "new-show-b")
        self.expect_serial_link(page, "9001", "known-9001")
        self.expect_no_serial_link(page, "9002")
        # Do nahrání souborů si stránka nová anime drží v prohlížeči i s obrázky.
        pending = self.pending(page)
        self.assertEqual(pending["items"], {"9005": saved["9005"], "9006": saved["9006"]})
        self.assertEqual(sorted(pending["images"]), ["9005", "9006"])
        self.assertEqual(pending["images"]["9005"]["name"], SHOW_A["name"])

        # Pořadí kroků jako ve skriptu; přihlašovací cookie dostala jen stránka účtu (obrázek ne).
        self.assertEqual(self.web.urls, [
            FAVORITES_URL,
            SHOW_A["csfd_search"], "https://www.csfd.cz/film/111111",
            SHOW_A["mal_search"], "https://myanimelist.net/anime/22222", IMAGE_ORIGIN + SHOW_A["image"],
            SHOW_B["csfd_search"], "https://www.csfd.cz/film/222222",
            SHOW_B["mal_search"], SHOW_B["mal_redirect"], "https://myanimelist.net/anime/33333",
            IMAGE_ORIGIN + SHOW_B["image"],
        ])
        self.assertEqual([url for url, headers in self.web.calls if "Cookie" in headers], [FAVORITES_URL])

        # Data zapsaná do souboru přežijí znovunačtení stránky. Soubor nová anime už má, takže je
        # stránka z prohlížeče smaže a obrázky čeká v img/anime (tady chybí, proto popisek).
        page.reload()
        expect(page.locator("#anime-list-wrap")).to_be_visible()
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9005", "9006"])
        self.assertIsNone(self.pending(page))
        row = page.locator('.anime-row[data-number="9005"]')
        row.scroll_into_view_if_needed()
        expect(row.locator(".anime-row__image-missing")).to_have_text("Obrázek chybí")
        # Adresa seriálu je v souboru, odkaz zůstane i kolem popisku chybějícího obrázku.
        self.expect_serial_link(page, "9005", "new-show-a")
        expect(row.locator(".anime-row__image-link .anime-row__image-missing")).to_have_count(1)
        self.expect_serial_link(page, "9001", "known-9001")
        self.assertEqual(self.page_errors, [])
        self.assertEqual(self.unexpected_console_errors(), [])

    def test_new_anime_stay_visible_until_the_web_has_them(self):
        # Web (GitHub Pages) má starou verzi data/anime.json a img/anime, dokud se změny nenahrají.
        self.served_data = SEED_DATA
        page = self.open_page(self.start_helper())
        self.run_list_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo. Celkem 2 nové anime.")
        self.expect_unlocked(page)
        saved = json.loads(self.read_data_file())

        for _attempt in range(2):
            page.reload()
            expect(page.locator("#anime-list-wrap")).to_be_visible()
            self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9005", "9006"])
            expect(page.locator('.anime-row[data-number="9005"] .anime-row__cell--NameEn')).to_have_text("New Show A EN")
            self.expect_shown_image(page, "9005")
            self.expect_shown_image(page, "9006")
            self.assertEqual(self.pending(page)["items"], {"9005": saved["9005"], "9006": saved["9006"]})

        # Nová anime jsou v datech, takže je další Seznam nepřidá znovu.
        self.run_list_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Žádné nové anime.")
        self.expect_unlocked(page)
        self.assertEqual(json.loads(self.read_data_file()), saved)

        # Po nahrání na web je soubor má a prohlížeč je zapomene.
        self.served_data = None
        page.reload()
        expect(page.locator("#anime-list-wrap")).to_be_visible()
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9005", "9006"])
        self.assertIsNone(self.pending(page))
        self.assertEqual(self.page_errors, [])
        self.assertEqual(self.unexpected_console_errors(), [])

    def test_list_update_reports_anime_not_written_to_data_file(self):
        # Bez anime, které už v datech je, se před přidáváním nic nezapisuje (adresy seriálů).
        self.web.serve(FAVORITES_URL, favorites_page([
            (SHOW_A["name"], SHOW_A["slug"], SHOW_A["image"], False),
            (SHOW_B["name"], SHOW_B["slug"], SHOW_B["image"], True),
        ]))
        page = self.open_page(self.start_helper())
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        self.write_data_file(b"{")

        self.run_list_update(page)
        expect(page.locator("#anime-update-error")).to_have_text(
            "Výsledek aktualizace se nepodařilo zapsat do data/anime.json. Podrobnosti: data-file-invalid. "
            "Přidaná anime (2) se nepodařilo zapsat do data/anime.json, po obnovení stránky zmizí. "
            "Spusťte aktualizaci znovu.")
        self.expect_unlocked(page)
        self.assertEqual(self.read_data_file(), b"{")
        # Do obnovení stránky jsou anime vidět i s obrázky, které pomocník uložil.
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9005", "9006"])
        self.expect_shown_image(page, "9005")
        self.assertEqual(sorted(os.listdir(self.images_dir)), ["9005.jpg", "9006.jpg"])
        # Prohlížeč si drží jen anime zapsaná do souboru.
        self.assertIsNone(self.pending(page))
        self.assertIsNone(page.evaluate("() => localStorage.getItem('anime-data-overrides')"))

    def test_list_update_stops_when_serial_addresses_cannot_be_written(self):
        page = self.open_page(self.start_helper())
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        self.write_data_file(b"{")

        self.run_list_update(page)
        # Adresa seriálu pro anime 9001 se zapisuje před přidáváním, takže se nic dalšího nestahuje.
        expect(page.locator("#anime-update-error")).to_have_text(
            "Výsledek aktualizace se nepodařilo zapsat do data/anime.json. Podrobnosti: data-file-invalid.")
        self.expect_unlocked(page)
        self.assertEqual(self.web.urls, [FAVORITES_URL])
        self.assertEqual(self.read_data_file(), b"{")
        self.assertEqual(os.listdir(self.images_dir), [])
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004"])
        self.expect_no_serial_link(page, "9001")

    def test_list_update_requires_helper_that_can_write_data_file(self):
        # Pomocník verze 9 neumí uložit adresy seriálů (verze 6 navíc nevracel uložený obrázek).
        with mock.patch.object(proxy, "VERSION", 9):
            page = self.open_page(self.start_helper())
            self.run_list_update(page)
            expect(page.locator("#anime-update-error")).to_have_text(
                "Pomocný program je zastaralý a tuto aktualizaci neumí provést. "
                "Ukončete ho a spusťte znovu příkazem „python tools/anime_proxy.py“.")
        self.expect_unlocked(page)

        page = self.open_page(self.start_helper(data_path=os.path.join(self.tmp, "missing.json")))
        self.run_list_update(page)
        expect(page.locator("#anime-update-error")).to_contain_text("Pomocný program nenašel soubor s daty")
        self.expect_unlocked(page)
        self.assertEqual(self.web.urls, [])
        self.assertEqual(os.listdir(self.images_dir), [])
        self.assertEqual(self.read_data_file(), self.python_json(SEED_DATA))

    def test_list_update_without_new_favorites(self):
        self.web.serve(FAVORITES_URL, favorites_page([KNOWN_FAVORITE, EXCEPTION_FAVORITE]))
        page = self.open_page(self.start_helper())
        page.evaluate(INFO_LOG_SCRIPT)
        self.expect_no_serial_link(page, "9001")

        self.run_list_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Žádné nové anime.")
        self.expect_unlocked(page)

        info_log = []
        for text in page.evaluate("() => window.__infoLog"):
            if not info_log or info_log[-1] != text:
                info_log.append(text)
        self.assertEqual(info_log, ["0.00% Aktualizuji anime list", "100.00% Žádné nové anime.", ""])
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004"])
        self.assertEqual(self.web.urls, [FAVORITES_URL])
        self.assertEqual(os.listdir(self.images_dir), [])
        self.assertEqual(self.unexpected_console_errors(), [])

        # Anime z oblíbených dostalo adresu seriálu do souboru i na stránce hned, bez znovunačtení.
        saved = json.loads(self.read_data_file())
        self.assertEqual(saved, dict(SEED_DATA, **{"9001": dict(SEED_DATA["9001"], FavoriteUrlName="known-9001")}))
        self.assertEqual(list(saved["9001"]), ITEM_KEYS)
        self.expect_serial_link(page, "9001", "known-9001")
        self.expect_no_serial_link(page, "9002")
        self.assertIsNone(self.pending(page))

        # Další Seznam už adresu má, takže soubor nemění.
        before = self.read_data_file()
        self.run_list_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Žádné nové anime.")
        self.expect_unlocked(page)
        self.assertEqual(self.read_data_file(), before)

    def test_numbers_skip_images_that_already_exist(self):
        existing = os.path.join(self.images_dir, "9007.jpg")
        with open(existing, "wb") as handle:
            handle.write(b"existing")
        page = self.open_page(self.start_helper())

        self.run_list_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo. Celkem 2 nové anime.")
        self.expect_unlocked(page)

        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9008", "9009"])
        self.assertEqual(sorted(os.listdir(self.images_dir)), ["9007.jpg", "9008.jpg", "9009.jpg"])
        with open(existing, "rb") as handle:
            self.assertEqual(handle.read(), b"existing")

    def test_error_when_helper_is_not_running(self):
        page = self.open_page("http://127.0.0.1:%d" % free_port())
        self.run_list_update(page)

        error = page.locator("#anime-update-error")
        expect(error).to_be_visible()
        expect(error).to_contain_text("Pomocný program pro aktualizaci neodpovídá.")
        expect(page.locator("#anime-update-info")).to_have_text("")
        # Chyba ovládání hned odemkne, nečeká se 2 s jako po úspěchu.
        expect(page.locator("#anime-update-toggle")).to_be_enabled(timeout=1000)
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004"])
        self.assertTrue(any("Anime update failed" in text for _kind, text in self.console))

    def test_error_when_helper_has_no_cookie(self):
        page = self.open_page(self.start_helper(proxy.Config()))
        self.run_list_update(page)

        expect(page.locator("#anime-update-error")).to_have_text(
            "Pomocný program nemá nastavenou přihlašovací cookie pro sledujserialy.io (viz README).")
        self.assertEqual(self.web.urls, [])
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004"])

    def test_error_when_cloudflare_asks_for_verification(self):
        self.web.serve(FAVORITES_URL, "<title>Just a moment...</title>", status=403,
                       headers={"cf-mitigated": "challenge", "server": "cloudflare"})
        page = self.open_page(self.start_helper())
        self.run_list_update(page)

        error = page.locator("#anime-update-error")
        expect(error).to_be_visible()
        expect(error).to_contain_text("vyžaduje ověření Cloudflare")
        # Zpráva musí říct, co dělat, ne jen odkázat do README.
        expect(error).to_contain_text("cf_clearance")
        expect(error).to_contain_text("tools/anime_proxy.local.json")
        expect(page.locator("#anime-update-toggle")).to_be_enabled(timeout=1000)
        self.assertEqual(self.web.urls, [FAVORITES_URL])
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004"])

    def test_error_in_the_middle_keeps_added_anime_and_update_can_be_repeated(self):
        self.web.serve(SHOW_B["mal_search"], MAL_NOT_FOUND, status=404)
        page = self.open_page(self.start_helper())

        self.run_list_update(page)
        error = page.locator("#anime-update-error")
        expect(error).to_have_text("Anime se na MyAnimeList nepodařilo najít. Anime: New Show B. "
                                   "Anime přidaná před chybou se zapsala do data/anime.json (1).")
        expect(page.locator("#anime-update-info")).to_have_text("")
        expect(page.locator("#anime-update-toggle")).to_be_enabled(timeout=1000)
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9005"])
        # Hotové anime zapsal pomocník do souboru, rozpracované po sobě nezanechá ani obrázek.
        self.assertEqual(list(json.loads(self.read_data_file())), ["9001", "9002", "9004", "9005"])
        self.assertEqual(os.listdir(self.images_dir), ["9005.jpg"])

        # Po opravě zdroje se doplní jen to, co chybí.
        self.web.serve_show(SHOW_B)
        self.run_list_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo. Celkem 1 nové anime.")
        expect(error).to_be_hidden()
        self.expect_unlocked(page)
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9005", "9006"])
        self.assertEqual(list(json.loads(self.read_data_file())), ["9001", "9002", "9004", "9005", "9006"])
        self.assertEqual(sorted(os.listdir(self.images_dir)), ["9005.jpg", "9006.jpg"])

    def test_controls_are_locked_while_running(self):
        self.web.hold_prefix = CSFD_SEARCH_PREFIX
        page = self.open_page(self.start_helper())
        self.run_list_update(page)
        self.assertTrue(self.web.reached.wait(10), "aktualizace se nedostala k hledání na ČSFD")

        info = page.locator("#anime-update-info")
        expect(info).to_have_text("0.00% Aktualizuji anime list. Celkem 2 nové anime.")
        expect(page.locator("#anime-update-menu")).to_be_hidden()
        for selector in ("#anime-update-toggle", "#anime-edit-toggle", "#anime-push-btn"):
            expect(page.locator(selector)).to_be_disabled()
        # Hledání aktualizace nezamyká.
        expect(page.locator("#anime-search")).to_be_enabled()
        expect(page.locator("#anime-header")).to_have_class(re.compile(r"\bis-locked\b"))

        # Řazení hlavičky je zamčené, i když se kliknutí k prvku nějak dostane.
        header = page.locator('.anime__header-cell[data-column="NameEn"]')
        header.dispatch_event("click")
        expect(header).to_have_attribute("data-sort", "none")

        # Přepnutí jazyka překreslí informační řádek.
        page.evaluate("() => I18n.setLang('en')")
        expect(info).to_have_text("0.00% Updating the anime list. 2 new anime in total.")

        self.web.release.set()
        expect(info).to_have_text("100.00% Done. 2 new anime in total.")
        self.expect_unlocked(page)
        for selector in ("#anime-edit-toggle", "#anime-push-btn"):
            expect(page.locator(selector)).to_be_enabled()
        expect(page.locator("#anime-header")).not_to_have_class(re.compile(r"\bis-locked\b"))
        header.click()
        expect(header).not_to_have_attribute("data-sort", "none")

    def test_update_is_unavailable_in_edit_mode(self):
        page = self.open_page(self.start_helper())
        toggle = page.locator("#anime-update-toggle")
        edit = page.locator("#anime-edit-toggle")
        toggle.click()
        expect(page.locator("#anime-update-menu")).to_be_visible()

        edit.click()
        expect(edit).to_have_attribute("aria-pressed", "true")
        expect(toggle).to_be_disabled()
        expect(toggle).to_have_attribute("title", "Během úprav není aktualizace dostupná.")
        expect(page.locator("#anime-update-menu")).to_be_hidden()
        # Push publikuje jen soubor, edit mód mu nevadí.
        expect(page.locator("#anime-push-btn")).to_be_enabled()

        edit.click()
        expect(edit).to_have_attribute("aria-pressed", "false")
        expect(toggle).to_be_enabled()
        expect(toggle).not_to_have_attribute("title", "Během úprav není aktualizace dostupná.")

    def test_english_interface(self):
        self.web.serve(FAVORITES_URL, favorites_page([KNOWN_FAVORITE]))
        page = self.open_page(self.start_helper(), lang="en")
        toggle = page.locator("#anime-update-toggle")
        expect(toggle).to_have_text("Update")

        toggle.click()
        expect(page.locator("#anime-update-menu button")).to_have_text(
            ["Watched episodes", "CSFD rating", "MAL rating", "List", "All"])
        expect(page.locator("#anime-update-all-btn")).to_have_attribute("title", "Coming soon")
        expect(page.locator("#anime-update-menu")).to_have_attribute("aria-label", "Update options")
        expect(page.locator("#anime-push-btn")).to_have_text("Push")
        expect(page.locator("#anime-push-btn")).to_have_attribute("title", PUSH_TITLE_EN)

        page.locator("#anime-update-list-btn").click()
        expect(page.locator("#anime-update-info")).to_have_text("100.00% No new anime.")
        self.expect_unlocked(page)

    # ----------------------------- Lišta, role a načtení -----------------------------

    def box(self, page, selector):
        return page.locator(selector).bounding_box()

    def write_many_anime(self, count=40):
        self.write_data_file({str(number): seed_item(number) for number in range(9001, 9001 + count)})

    def test_toolbar_has_search_and_action_bar_on_one_row(self):
        page = self.open_page(self.start_helper())
        for selector in ("#anime-import-btn", "#anime-import-input", "#anime-import-error", "#anime-export-btn",
                         "#anime-reset-btn", "#anime-reset-modal", "#anime-status"):
            expect(page.locator(selector)).to_have_count(0)
        expect(page.locator("#anime-toolbar #anime-action-bar")).to_be_visible()
        expect(page.locator("#anime-action-bar button:visible")).to_have_text(["Aktualizovat", "Push", "Upravit"])

        # Vlevo hledání, vpravo vedle něj tlačítka action-baru na stejném řádku.
        row = self.box(page, ".anime__toolbar-row")
        search = self.box(page, ".anime__search")
        first = self.box(page, "#anime-update-toggle")
        last = self.box(page, "#anime-edit-toggle")
        self.assertAlmostEqual(search["x"], row["x"], delta=1)
        self.assertGreater(first["x"], search["x"] + search["width"])
        self.assertAlmostEqual(last["x"] + last["width"], row["x"] + row["width"], delta=1)
        self.assertLess(abs(first["y"] - search["y"]), 5)
        # Hlavička sloupců je v liště pod nimi.
        header = self.box(page, "#anime-header-wrap")
        self.assertGreaterEqual(header["y"], search["y"] + search["height"])

        # Podtlačítka aktualizace se ukážou v action-baru a hledání neposunou.
        page.locator("#anime-update-toggle").click()
        expect(page.locator("#anime-update-menu")).to_be_visible()
        menu = self.box(page, "#anime-update-menu")
        self.assertGreater(menu["x"], search["x"] + search["width"])
        self.assertGreaterEqual(menu["y"], first["y"] + first["height"])
        self.assertEqual(self.box(page, ".anime__search"), search)
        self.assertEqual(self.page_errors, [])

    def test_toolbar_and_header_stay_visible_while_scrolling(self):
        self.write_many_anime()
        page = self.open_page(self.start_helper())
        expect(page.locator("#anime-list .anime-row")).to_have_count(40)
        toolbar = page.locator("#anime-toolbar")
        self.assertGreater(toolbar.bounding_box()["y"], 50)

        page.evaluate("() => window.scrollTo(0, 3000)")
        page.wait_for_function("() => window.scrollY >= 3000")
        box = toolbar.bounding_box()
        self.assertAlmostEqual(box["y"], 0, delta=1)
        header = self.box(page, "#anime-header-wrap")
        self.assertGreater(header["y"], box["y"])
        self.assertLessEqual(header["y"] + header["height"], box["y"] + box["height"] + 1)
        for selector in ("#anime-search", "#anime-update-toggle", "#anime-push-btn", "#anime-edit-toggle"):
            expect(page.locator(selector)).to_be_in_viewport()
        # Lišta je nad řádky seznamu, které pod ní odjíždějí.
        covered = page.evaluate(
            "([x, y]) => Boolean(document.elementFromPoint(x, y).closest('#anime-toolbar'))",
            [box["x"] + box["width"] / 2, box["y"] + box["height"] - 2])
        self.assertTrue(covered)

        # Lišta jde používat i po odscrollování.
        page.locator("#anime-search").fill("Known 9040")
        expect(page.locator("#anime-list .anime-row:visible")).to_have_count(1)
        self.assertEqual(self.page_errors, [])

    def test_narrow_screen_puts_action_bar_below_search(self):
        page = self.open_page(self.start_helper(), viewport={"width": 600, "height": 800})
        row = self.box(page, ".anime__toolbar-row")
        search = self.box(page, ".anime__search")
        self.assertAlmostEqual(search["width"], row["width"], delta=1)
        for selector in ("#anime-update-toggle", "#anime-push-btn", "#anime-edit-toggle"):
            button = self.box(page, selector)
            self.assertGreaterEqual(button["y"], search["y"] + search["height"])
            self.assertLessEqual(button["x"] + button["width"], 600)

        # Hlavička je mimo kontejner seznamu, vodorovně se ale posouvají spolu.
        list_wrap = page.locator("#anime-list-wrap")
        header_wrap = page.locator("#anime-header-wrap")
        self.assertGreater(list_wrap.evaluate("el => el.scrollWidth - el.clientWidth"), 200)
        list_wrap.evaluate("el => { el.scrollLeft = 150; }")
        page.wait_for_function("() => document.getElementById('anime-header-wrap').scrollLeft === 150")
        # Zámek proti ozvěně drží 100 ms.
        page.wait_for_timeout(300)
        header_wrap.evaluate("el => { el.scrollLeft = 40; }")
        page.wait_for_function("() => document.getElementById('anime-list-wrap').scrollLeft === 40")
        self.assertEqual(self.page_errors, [])

    def test_anime_role_sees_read_only_list(self):
        helper = self.start_helper()
        page = self.open_page(helper, role="anime", init_script=FETCH_LOG_SCRIPT)
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        expect(page.locator("#anime-action-bar")).to_be_hidden()
        for selector in ("#anime-update-toggle", "#anime-push-btn", "#anime-edit-toggle"):
            expect(page.locator(selector)).to_be_hidden()

        # Hledání a řazení fungují i jen pro čtení.
        page.locator("#anime-search").fill("Known 9002")
        expect(page.locator("#anime-list .anime-row:visible")).to_have_count(1)
        page.locator('.anime__header-cell[data-column="Number"]').click()
        expect(page.locator('.anime__header-cell[data-column="Number"]')).to_have_attribute("data-sort", "desc")

        # Na pomocníka se stránka vůbec neobrací.
        fetches = page.evaluate("() => window.__fetches")
        self.assertTrue(any(url.startswith("data/anime.json") for url in fetches), fetches)
        self.assertEqual([url for url in fetches if url.startswith(helper)], [])
        self.assertEqual(self.unexpected_console_errors(), [])
        self.assertEqual(self.page_errors, [])

    def test_anime_password_gives_access_to_anime_page_only(self):
        context = self.browser.new_context(viewport={"width": 1400, "height": 900})
        self.addCleanup(context.close)
        context.route(re.compile(r"/data/anime\.json(\?|$)"), self.serve_data_file)
        context.add_init_script("localStorage.setItem('site-lang', 'cs');")
        page = context.new_page()
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))

        def login(password):
            page.locator("#auth-btn").click()
            page.locator("#auth-password").fill(password)
            page.locator("#auth-password").press("Enter")
            expect(page.locator("#auth-modal")).to_be_hidden()

        page.goto(self.origin + "/index.html")
        login("my-anime-list")
        expect(page.locator("#auth-btn")).to_have_attribute("title", "Přístup ke stránce Anime")
        expect(page.locator('.menu__link[href="anime.html"]')).not_to_have_attribute("hidden", "")
        for link in ("nv194.html", "personal.html", "cv.html", "games.html", "contact.html"):
            expect(page.locator('.menu__link[href="%s"]' % link)).to_have_attribute("hidden", "")

        page.goto(self.origin + "/anime.html")
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        expect(page.locator("#anime-action-bar")).to_be_hidden()

        for protected in ("nv194.html", "personal.html", "cv.html"):
            page.goto(self.origin + "/" + protected)
            expect(page).to_have_url(re.compile(r"/index\.html$"))
            expect(page.locator("#auth-modal")).to_be_visible()
            page.keyboard.press("Escape")
            expect(page.locator("#auth-modal")).to_be_hidden()

        # Heslo s přístupem všude odemkne i action-bar.
        page.goto(self.origin + "/index.html")
        page.evaluate("() => SiteAuth.logout()")
        login("IWANTTOBUILDAGAIN")
        expect(page.locator("#auth-btn")).to_have_attribute("title", "Přístup ke všem stránkám")
        page.goto(self.origin + "/anime.html")
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        expect(page.locator("#anime-action-bar")).to_be_visible()
        self.assertEqual(self.page_errors, [])

    def test_load_error_is_shown_instead_of_list(self):
        self.data_error = True
        page = self.open_page(self.start_helper(), wait_list=False)
        error = page.locator("#anime-load-error")
        expect(error).to_have_text("Nepodařilo se načíst anime data. Zkuste stránku obnovit.")
        expect(error).to_be_visible()
        expect(page.locator("#anime-list-wrap")).to_be_hidden()
        expect(page.locator("#anime-header-wrap")).to_be_hidden()
        # Bez dat nejde spustit aktualizace.
        expect(page.locator("#anime-update-toggle")).to_be_disabled()
        page.evaluate("() => I18n.setLang('en')")
        expect(error).to_have_text("Failed to load anime data. Try reloading the page.")
        self.assertTrue(any(kind == "error" and text.startswith("Anime data load failed:")
                            for kind, text in self.console))
        self.assertEqual(self.page_errors, [])

    def test_legacy_browser_overrides_are_removed_on_load(self):
        legacy = {"9001": dict(SEED_DATA["9001"], NameEn="Stará úprava")}
        page = self.open_page(self.start_helper(), init_script=LEGACY_OVERRIDES_SCRIPT % json.dumps(json.dumps(legacy)))
        # Seznam je ze souboru, uložené úpravy z dřívější verze stránky se smazaly.
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004"])
        expect(page.locator('.anime-row[data-number="9001"] .anime-row__cell--NameEn')).to_have_text("Known 9001 EN")
        self.assertIsNone(page.evaluate("() => localStorage.getItem('anime-data-overrides')"))
        page.reload()
        expect(page.locator("#anime-list-wrap")).to_be_visible()
        self.assertIsNone(page.evaluate("() => localStorage.getItem('anime-data-overrides')"))
        self.assertEqual(self.page_errors, [])

    # ----------------------------- Edit mód -----------------------------

    def edit_input(self, page, number, column):
        return page.locator('.anime-row[data-number="%s"] textarea[data-column="%s"]' % (number, column))

    def edit_requests(self, page):
        return [url for url in page.evaluate("() => window.__fetches") if url.endswith("/anime-edits")]

    def test_edit_mode_saves_changes_to_data_file(self):
        page = self.open_page(self.start_helper(), init_script=FETCH_LOG_SCRIPT)
        edit = page.locator("#anime-edit-toggle")
        expect(edit).to_have_text("Upravit")
        edit.click()
        expect(edit).to_have_text("Uložit")
        expect(edit).to_have_attribute("aria-pressed", "true")
        expect(self.edit_input(page, "9001", "MyRating")).to_have_value("72%")

        self.edit_input(page, "9001", "MyRating").fill("95")
        self.edit_input(page, "9004", "NameEn").fill("Přejmenované anime")
        self.edit_input(page, "9002", "Number").fill("9010")
        edit.click()
        expect(edit).to_have_text("Upravit")
        expect(edit).to_have_attribute("aria-pressed", "false")
        expect(page.locator("#anime-edit-error")).to_be_hidden()
        expect(page.locator("#anime-list textarea")).to_have_count(0)
        expect(page.locator('.anime-row[data-number="9001"] .anime-row__cell--MyRating')).to_have_text("95%")
        expect(page.locator('.anime-row[data-number="9004"] .anime-row__cell--NameEn')).to_have_text(
            "Přejmenované anime")
        self.assertEqual(self.row_numbers(page), ["9001", "9010", "9004"])
        self.assertEqual(len(self.edit_requests(page)), 1)

        # Pomocník zapsal jen změněné hodnoty ve formátu Python skriptu a seřadil anime podle čísla.
        expected = json.loads(json.dumps(SEED_DATA))
        expected["9001"]["MyRating"] = "95%"
        expected["9004"]["NameEn"] = "Přejmenované anime"
        renumbered = expected.pop("9002")
        renumbered["Number"] = "9010"
        expected["9010"] = renumbered
        self.assertEqual(self.read_data_file(), self.python_json(expected))

        # Úpravy přežijí znovunačtení stránky a další úpravy navazují na uložené hodnoty.
        page.reload()
        expect(page.locator("#anime-list-wrap")).to_be_visible()
        self.assertEqual(self.row_numbers(page), ["9001", "9004", "9010"])
        expect(page.locator('.anime-row[data-number="9001"] .anime-row__cell--MyRating')).to_have_text("95%")
        edit.click()
        self.edit_input(page, "9010", "MyRating").fill("?")
        edit.click()
        expect(edit).to_have_text("Upravit")
        expected["9010"]["MyRating"] = "?%"
        self.assertEqual(self.read_data_file(), self.python_json(expected))
        self.assertIsNone(page.evaluate("() => localStorage.getItem('anime-data-overrides')"))
        self.assertEqual(self.unexpected_console_errors(), [])
        self.assertEqual(self.page_errors, [])

    def test_edit_mode_without_changes_makes_no_request(self):
        page = self.open_page(self.start_helper(), init_script=FETCH_LOG_SCRIPT)
        before = self.read_data_file()
        edit = page.locator("#anime-edit-toggle")
        edit.click()
        # Změna vrácená na původní hodnotu není změna.
        self.edit_input(page, "9001", "NameEn").fill("Jiný název")
        self.edit_input(page, "9001", "NameEn").fill("Known 9001 EN")
        edit.click()
        expect(edit).to_have_text("Upravit")
        expect(page.locator("#anime-list textarea")).to_have_count(0)
        self.assertEqual(self.edit_requests(page), [])
        self.assertEqual(self.read_data_file(), before)

    def test_edit_mode_rejects_invalid_values_and_duplicate_numbers(self):
        page = self.open_page(self.start_helper(), init_script=FETCH_LOG_SCRIPT)
        before = self.read_data_file()
        edit = page.locator("#anime-edit-toggle")
        error = page.locator("#anime-edit-error")
        invalid = re.compile(r"\banime-row__edit-input--invalid\b")
        edit.click()
        rating = self.edit_input(page, "9001", "MyRating")
        date_input = self.edit_input(page, "9002", "Date")
        rating.fill("150")
        date_input.fill("31.13.2024")
        edit.click()
        expect(error).to_have_text("Některé hodnoty nejsou platné. Opravte zvýrazněná pole.")
        expect(edit).to_have_text("Uložit")
        expect(rating).to_have_class(invalid)
        expect(rating).to_have_attribute("aria-invalid", "true")
        expect(date_input).to_have_class(invalid)
        expect(self.edit_input(page, "9004", "MyRating")).not_to_have_class(invalid)

        # Stejné číslo u dvou anime zvýrazní obě pole Number.
        rating.fill("95")
        date_input.fill("1.2.2024")
        self.edit_input(page, "9002", "Number").fill("9001")
        edit.click()
        expect(error).to_have_text("Stejné číslo (Number) má více anime. Opravte zvýrazněná pole.")
        expect(rating).not_to_have_class(invalid)
        expect(rating).to_have_attribute("aria-invalid", "false")
        expect(self.edit_input(page, "9001", "Number")).to_have_class(invalid)
        expect(self.edit_input(page, "9002", "Number")).to_have_class(invalid)
        expect(self.edit_input(page, "9004", "Number")).not_to_have_class(invalid)
        self.assertEqual(self.edit_requests(page), [])
        self.assertEqual(self.read_data_file(), before)

        # Po opravě se úpravy uloží a chyba zmizí.
        self.edit_input(page, "9002", "Number").fill("9003")
        edit.click()
        expect(edit).to_have_text("Upravit")
        expect(error).to_be_hidden()
        saved = json.loads(self.read_data_file())
        self.assertEqual(list(saved), ["9001", "9003", "9004"])
        self.assertEqual((saved["9001"]["MyRating"], saved["9003"]["Date"], saved["9003"]["Number"]),
                         ("95%", "1.2.2024", "9003"))

    def test_edit_mode_keeps_changes_when_data_file_changed_meanwhile(self):
        # Web ukazuje starší data, než má soubor pomocníka.
        self.served_data = SEED_DATA
        self.write_data_file(dict(SEED_DATA, **{"9001": dict(SEED_DATA["9001"], MyRating="80%")}))
        before = self.read_data_file()
        page = self.open_page(self.start_helper())
        edit = page.locator("#anime-edit-toggle")
        edit.click()
        self.edit_input(page, "9001", "MyRating").fill("95")
        self.edit_input(page, "9002", "NameEn").fill("Nový název")
        edit.click()
        expect(page.locator("#anime-edit-error")).to_have_text(
            "Úpravy se neuložily: data/anime.json se mezitím změnil (např. aktualizací nebo v jiném okně). "
            "Obnovte stránku a úpravy zopakujte. Podrobnosti: 9001 MyRating.")
        # Edit mód zůstal i s rozepsanými hodnotami, které jdou dál upravovat.
        expect(edit).to_have_text("Uložit")
        expect(edit).to_be_enabled()
        expect(self.edit_input(page, "9001", "MyRating")).to_have_value("95")
        expect(self.edit_input(page, "9002", "NameEn")).to_have_value("Nový název")
        expect(self.edit_input(page, "9001", "MyRating")).to_be_editable()
        expect(page.locator("#anime-update-toggle")).to_be_disabled()
        self.assertEqual(self.read_data_file(), before)

        # Chyba se přeloží s jazykem stránky.
        page.evaluate("() => I18n.setLang('en')")
        expect(page.locator("#anime-edit-error")).to_have_text(
            "The changes were not saved: data/anime.json has changed in the meantime (for example by an update "
            "or in another window). Reload the page and make the changes again. Details: 9001 MyRating.")
        expect(edit).to_have_text("Save")

    def test_edit_mode_reports_unavailable_or_outdated_helper(self):
        page = self.open_page("http://127.0.0.1:%d" % free_port())
        edit = page.locator("#anime-edit-toggle")
        edit.click()
        self.edit_input(page, "9001", "MyRating").fill("95")
        edit.click()
        expect(page.locator("#anime-edit-error")).to_contain_text("Pomocný program pro aktualizaci neodpovídá.")
        expect(edit).to_have_text("Uložit")
        expect(self.edit_input(page, "9001", "MyRating")).to_have_value("95")

        # Pomocník verze 8 úpravy zapisovat neumí - stránka to pozná dřív, než ho zavolá.
        before = self.read_data_file()
        with mock.patch.object(proxy, "VERSION", 8):
            page = self.open_page(self.start_helper())
            edit = page.locator("#anime-edit-toggle")
            edit.click()
            self.edit_input(page, "9001", "MyRating").fill("95")
            edit.click()
            expect(page.locator("#anime-edit-error")).to_have_text(
                "Pomocný program je zastaralý a úpravy uložit neumí. "
                "Ukončete ho a spusťte znovu příkazem „python tools/anime_proxy.py“.")
        expect(edit).to_have_text("Uložit")
        self.assertEqual(self.read_data_file(), before)

        # Úspěšné uložení chybu smaže.
        page = self.open_page(self.start_helper())
        edit = page.locator("#anime-edit-toggle")
        edit.click()
        self.edit_input(page, "9001", "MyRating").fill("abc")
        edit.click()
        expect(page.locator("#anime-edit-error")).to_be_visible()
        self.edit_input(page, "9001", "MyRating").fill("95")
        edit.click()
        expect(edit).to_have_text("Upravit")
        expect(page.locator("#anime-edit-error")).to_be_hidden()
        self.assertEqual(json.loads(self.read_data_file())["9001"]["MyRating"], "95%")

    # ----------------------------- ČSFD hodnocení -----------------------------

    def run_csfd_update(self, page):
        page.locator("#anime-update-toggle").click()
        page.locator("#anime-update-csfd-btn").click()

    def serve_rating(self, film_id, rating):
        self.web.serve(CSFD_FILM_PREFIX + film_id, csfd_film_page("Known", "Known JA", rating, "Popis"))

    def csfd_cells(self, page):
        return page.locator("#anime-list .anime-row .anime-row__cell--CsfdRating").all_inner_texts()

    def expected_data(self, ratings, base=None):
        data = json.loads(json.dumps(SEED_DATA if base is None else base))
        for number, rating in ratings.items():
            data[number]["CsfdRating"] = rating
        return data

    def test_csfd_update_writes_ratings_to_data_file(self):
        self.serve_rating("9001", "81 %")
        self.serve_rating("9002", "70%")
        self.serve_rating("9004", "? %")
        # ČSFD přihlášení nepotřebuje, pomocník bez cookie stačí.
        page = self.open_page(self.start_helper(proxy.Config()))
        page.evaluate(INFO_LOG_SCRIPT)

        self.run_csfd_update(page)
        expect(page.locator("#anime-update-menu")).to_be_hidden()
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo")
        self.expect_unlocked(page)

        # Texty průběhu jako ve skriptu AnimeList.pyw (UpdateCSFD a UpdateCSFDDone).
        info_log = []
        for text in page.evaluate("() => window.__infoLog"):
            if not info_log or info_log[-1] != text:
                info_log.append(text)
        self.assertEqual(info_log, ["0.00% Aktualizuji ČSFD hodnocení", "33.33% Aktualizuji ČSFD hodnocení",
                                    "66.67% Aktualizuji ČSFD hodnocení", "100.00% Hotovo", ""])
        self.assertEqual(self.web.urls, [CSFD_FILM_PREFIX + number for number in ("9001", "9002", "9004")])

        # Pořadí řádků zůstane, změní se jen hodnocení.
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004"])
        self.assertEqual(self.csfd_cells(page), ["81%", "70%", "?%"])
        expect(page.locator("#anime-update-error")).to_be_hidden()

        # Hodnocení zapsal pomocník do souboru ve formátu Python skriptu.
        self.assertEqual(self.read_data_file(), self.python_json(self.expected_data({"9001": "81%", "9004": "?%"})))

        # Po znovunačtení stránka ukáže hodnocení ze souboru.
        page.reload()
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        self.assertEqual(self.csfd_cells(page), ["81%", "70%", "?%"])
        self.assertEqual(self.unexpected_console_errors(), [])

    def test_csfd_update_shows_each_rating_in_row_immediately_and_keeps_search(self):
        self.serve_rating("9001", "96 %")
        self.serve_rating("9002", "45%")
        self.serve_rating("9004", "81%")
        self.web.hold_prefix = CSFD_FILM_PREFIX + "9004"
        page = self.open_page(self.start_helper(proxy.Config()))
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        page.locator("#anime-search").fill("9001")
        rows = page.locator("#anime-list .anime-row")
        expect(rows.nth(1)).to_be_hidden()
        cells = page.locator("#anime-list .anime-row__cell--CsfdRating")

        self.run_csfd_update(page)
        self.assertTrue(self.web.reached.wait(10), "aktualizace se nedostala k poslednímu anime")
        # Hodnocení i jeho barva se změní hned, hledání dál skrývá ostatní řádky.
        expect(cells).to_have_text(["96%", "45%", "70%"])
        expect(cells.nth(0)).to_have_class(re.compile(r"\banime-row__rating--ge95\b"))
        expect(cells.nth(1)).to_have_class(re.compile(r"\banime-row__rating--lt50\b"))
        expect(rows.nth(0)).to_be_visible()
        expect(rows.nth(1)).to_be_hidden()
        expect(rows.nth(2)).to_be_hidden()
        expect(page.locator("#anime-update-toggle")).to_be_disabled()

        self.web.release.set()
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo")
        self.expect_unlocked(page)
        expect(cells).to_have_text(["96%", "45%", "81%"])
        expect(rows.nth(0)).to_be_visible()
        expect(rows.nth(1)).to_be_hidden()
        expect(rows.nth(2)).to_be_hidden()
        self.assertEqual(self.read_data_file(),
                         self.python_json(self.expected_data({"9001": "96%", "9002": "45%", "9004": "81%"})))
        self.assertEqual(self.unexpected_console_errors(), [])

    def test_csfd_update_reports_anime_missing_from_data_file(self):
        # Web ukazuje anime 9004, které v souboru pomocníka chybí (např. ho mezitím někdo smazal).
        self.served_data = SEED_DATA
        self.write_data_file({number: SEED_DATA[number] for number in ("9001", "9002")})
        self.serve_rating("9001", "81%")
        self.serve_rating("9002", "70%")
        self.serve_rating("9004", "66%")
        page = self.open_page(self.start_helper())

        self.run_csfd_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo")
        self.expect_unlocked(page)
        expect(page.locator("#anime-update-error")).to_have_text(
            "V souboru data/anime.json chybí 1 anime, jejich hodnocení se do něj nezapsalo: Known 9004 EN.")
        self.assertEqual(json.loads(self.read_data_file()),
                         {number: dict(SEED_DATA[number], CsfdRating=rating) for number, rating in (("9001", "81%"), ("9002", "70%"))})
        self.assertEqual(self.csfd_cells(page), ["81%", "70%", "66%"])

    def test_csfd_update_reports_ratings_not_written_to_data_file(self):
        self.serve_rating("9001", "81%")
        self.serve_rating("9002", "70%")
        self.serve_rating("9004", "66%")
        page = self.open_page(self.start_helper())
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        self.write_data_file(b"{")

        self.run_csfd_update(page)
        expect(page.locator("#anime-update-error")).to_have_text(
            "Výsledek aktualizace se nepodařilo zapsat do data/anime.json. Podrobnosti: data-file-invalid. "
            "Zjištěná hodnocení (3) se nepodařilo zapsat do data/anime.json, po obnovení stránky zmizí. "
            "Spusťte aktualizaci znovu.")
        self.expect_unlocked(page)
        self.assertEqual(self.read_data_file(), b"{")
        self.assertEqual(self.csfd_cells(page), ["81%", "70%", "66%"])
        self.assertIsNone(page.evaluate("() => localStorage.getItem('anime-data-overrides')"))

    def test_csfd_update_requires_helper_that_can_write_data_file(self):
        with mock.patch.object(proxy, "VERSION", 1):
            page = self.open_page(self.start_helper())
            self.run_csfd_update(page)
            expect(page.locator("#anime-update-error")).to_have_text(
                "Pomocný program je zastaralý a tuto aktualizaci neumí provést. "
                "Ukončete ho a spusťte znovu příkazem „python tools/anime_proxy.py“.")
        self.expect_unlocked(page)

        page = self.open_page(self.start_helper(data_path=os.path.join(self.tmp, "missing.json")))
        self.run_csfd_update(page)
        expect(page.locator("#anime-update-error")).to_contain_text("Pomocný program nenašel soubor s daty")
        self.expect_unlocked(page)
        self.assertEqual(self.web.urls, [])
        self.assertEqual(self.read_data_file(), self.python_json(SEED_DATA))

    def test_csfd_update_skips_failing_anime_and_lists_them(self):
        self.serve_rating("9001", "81%")
        self.web.serve(CSFD_FILM_PREFIX + "9002", "<html>Nenalezeno</html>", status=404)
        self.serve_rating("9004", "66%")
        page = self.open_page(self.start_helper())

        self.run_csfd_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo")
        self.expect_unlocked(page)
        # Souhrn přeskočených zůstane vidět i po odemčení.
        expect(page.locator("#anime-update-error")).to_have_text(
            "ČSFD hodnocení se nepodařilo zjistit u 1 anime, zůstalo původní: Known 9002 EN.")
        self.assertEqual(self.csfd_cells(page), ["81%", "70%", "66%"])
        self.assertEqual(self.read_data_file(), self.python_json(self.expected_data({"9001": "81%", "9004": "66%"})))
        self.assertTrue(any("CSFD rating not updated" in text for kind, text in self.console if kind == "warning"))

        # Další aktualizace souhrn smaže.
        self.serve_rating("9002", "55%")
        self.run_csfd_update(page)
        expect(page.locator("#anime-update-error")).to_be_hidden()
        self.expect_unlocked(page)
        self.assertEqual(self.csfd_cells(page), ["81%", "55%", "66%"])

    def test_csfd_update_never_gives_up_on_skippable_errors(self):
        for number in ("9001", "9002", "9004"):
            self.web.serve(CSFD_FILM_PREFIX + number, "<html>Nenalezeno</html>", status=404)
        page = self.open_page(self.start_helper())

        self.run_csfd_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo")
        self.expect_unlocked(page)
        expect(page.locator("#anime-update-error")).to_have_text(
            "ČSFD hodnocení se nepodařilo zjistit u 3 anime, zůstalo původní: "
            "Known 9001 EN, Known 9002 EN, Known 9004 EN.")
        self.assertEqual(self.web.urls, [CSFD_FILM_PREFIX + number for number in ("9001", "9002", "9004")])
        self.assertEqual(self.csfd_cells(page), ["70%", "70%", "70%"])
        self.assertEqual(self.read_data_file(), self.python_json(SEED_DATA))

    def test_csfd_update_stops_on_blocked_redirect_and_keeps_finished_ratings(self):
        self.serve_rating("9001", "81%")
        self.web.redirect(CSFD_FILM_PREFIX + "9002", "https://blocked.example/notification")
        page = self.open_page(self.start_helper())

        self.run_csfd_update(page)
        error = page.locator("#anime-update-error")
        expect(error).to_be_visible()
        expect(error).to_contain_text("Anime: Known 9002 EN.")
        expect(error).to_contain_text("Hodnocení zjištěná před chybou se zapsala do data/anime.json (1).")
        expect(page.locator("#anime-update-toggle")).to_be_enabled(timeout=1000)
        expect(page.locator("#anime-update-info")).to_have_text("")
        self.assertEqual(self.web.urls, [CSFD_FILM_PREFIX + "9001", CSFD_FILM_PREFIX + "9002"])
        self.assertEqual(self.csfd_cells(page), ["81%", "70%", "70%"])
        self.assertEqual(self.read_data_file(), self.python_json(self.expected_data({"9001": "81%"})))

    def test_csfd_update_in_english(self):
        self.serve_rating("9001", "81%")
        self.web.serve(CSFD_FILM_PREFIX + "9002", "<html>Nenalezeno</html>", status=404)
        self.serve_rating("9004", "66%")
        page = self.open_page(self.start_helper(), lang="en")
        page.evaluate(INFO_LOG_SCRIPT)

        self.run_csfd_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Done")
        self.expect_unlocked(page)
        self.assertIn("0.00% Updating CSFD ratings", page.evaluate("() => window.__infoLog"))
        expect(page.locator("#anime-update-error")).to_have_text(
            "The CSFD rating could not be retrieved for 1 anime; the previous value was kept: Known 9002 EN.")

    # ----------------------------- MAL hodnocení -----------------------------

    def run_mal_update(self, page):
        page.locator("#anime-update-toggle").click()
        page.locator("#anime-update-mal-btn").click()

    def serve_mal(self, mal_id, score):
        self.web.serve(MAL_ANIME_PREFIX + mal_id, mal_anime_page(score))

    def mal_cells(self, page):
        return page.locator("#anime-list .anime-row .anime-row__cell--MalRating").all_inner_texts()

    def test_mal_update_writes_ratings_to_data_file(self):
        seed = json.loads(json.dumps(SEED_DATA))
        seed["9002"]["MalID"] = "0"
        seed["9002"]["MalRating"] = "?%"
        self.write_data_file(seed)
        self.serve_mal("9001", "7.65")
        # Anime bez skóre na MAL (Python by tu vzal číslo z dalšího prvku stránky).
        self.web.serve(MAL_ANIME_PREFIX + "9004",
                       '<div class="score-label score-na">N/A</div><div>Members <strong>169</strong></div>')
        # MAL přihlášení nepotřebuje, pomocník bez cookie stačí.
        page = self.open_page(self.start_helper(proxy.Config()))
        page.evaluate(INFO_LOG_SCRIPT)

        self.run_mal_update(page)
        expect(page.locator("#anime-update-menu")).to_be_hidden()
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo")
        self.expect_unlocked(page)

        # Texty průběhu jako ve skriptu AnimeList.pyw (UpdateMAL a UpdateMALDone).
        info_log = []
        for text in page.evaluate("() => window.__infoLog"):
            if not info_log or info_log[-1] != text:
                info_log.append(text)
        self.assertEqual(info_log, ["0.00% Aktualizuji MAL hodnocení", "33.33% Aktualizuji MAL hodnocení",
                                    "66.67% Aktualizuji MAL hodnocení", "100.00% Hotovo", ""])
        # MalID "0" (anime na MAL není) se nestahuje, jako GetMalRating().
        self.assertEqual(self.web.urls, [MAL_ANIME_PREFIX + "9001", MAL_ANIME_PREFIX + "9004"])

        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004"])
        self.assertEqual(self.mal_cells(page), ["76%", "?%", "?%"])
        self.assertEqual(self.csfd_cells(page), ["70%", "70%", "70%"])
        expect(page.locator("#anime-update-error")).to_be_hidden()

        # Pomocník zapsal jen MalRating, ve formátu Python skriptu.
        expected = json.loads(json.dumps(seed))
        expected["9001"]["MalRating"] = "76%"
        expected["9004"]["MalRating"] = "?%"
        self.assertEqual(self.read_data_file(), self.python_json(expected))

        page.reload()
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        self.assertEqual(self.mal_cells(page), ["76%", "?%", "?%"])
        self.assertEqual(self.unexpected_console_errors(), [])

    def test_mal_update_skips_failing_anime_and_lists_them(self):
        self.serve_mal("9001", "8.49")
        self.web.serve(MAL_ANIME_PREFIX + "9002", "<html>404 Not Found</html>", status=404)
        self.serve_mal("9004", "6.0")
        page = self.open_page(self.start_helper())

        self.run_mal_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo")
        self.expect_unlocked(page)
        expect(page.locator("#anime-update-error")).to_have_text(
            "MAL hodnocení se nepodařilo zjistit u 1 anime, zůstalo původní: Known 9002 EN.")
        self.assertEqual(self.mal_cells(page), ["85%", "71%", "60%"])
        expected = json.loads(json.dumps(SEED_DATA))
        expected["9001"]["MalRating"] = "85%"
        expected["9004"]["MalRating"] = "60%"
        self.assertEqual(self.read_data_file(), self.python_json(expected))
        self.assertTrue(any("MAL rating not updated" in text for kind, text in self.console if kind == "warning"))

        # Další aktualizace souhrn smaže.
        self.serve_mal("9002", "5.55")
        self.run_mal_update(page)
        expect(page.locator("#anime-update-error")).to_be_hidden()
        self.expect_unlocked(page)
        self.assertEqual(self.mal_cells(page), ["85%", "56%", "60%"])

    def test_mal_update_requires_helper_version_3(self):
        # Pomocník verze 2 umí zapsat jen ČSFD hodnocení.
        with mock.patch.object(proxy, "VERSION", 2):
            page = self.open_page(self.start_helper())
            self.run_mal_update(page)
            expect(page.locator("#anime-update-error")).to_have_text(
                "Pomocný program je zastaralý a tuto aktualizaci neumí provést. "
                "Ukončete ho a spusťte znovu příkazem „python tools/anime_proxy.py“.")
        self.expect_unlocked(page)
        self.assertEqual(self.web.urls, [])
        self.assertEqual(self.read_data_file(), self.python_json(SEED_DATA))

    def test_mal_update_stops_on_blocked_redirect_and_keeps_finished_ratings(self):
        self.serve_mal("9001", "9.0")
        self.web.redirect(MAL_ANIME_PREFIX + "9002", "https://blocked.example/notification")
        page = self.open_page(self.start_helper())

        self.run_mal_update(page)
        error = page.locator("#anime-update-error")
        expect(error).to_contain_text("Anime: Known 9002 EN.")
        expect(error).to_contain_text("Hodnocení zjištěná před chybou se zapsala do data/anime.json (1).")
        self.expect_unlocked(page)
        self.assertEqual(self.mal_cells(page), ["90%", "71%", "71%"])
        expected = json.loads(json.dumps(SEED_DATA))
        expected["9001"]["MalRating"] = "90%"
        self.assertEqual(self.read_data_file(), self.python_json(expected))

    def test_mal_update_in_english(self):
        self.serve_mal("9001", "8.0")
        self.web.serve(MAL_ANIME_PREFIX + "9002", "<html>404 Not Found</html>", status=404)
        self.serve_mal("9004", "6.6")
        page = self.open_page(self.start_helper(), lang="en")
        page.evaluate(INFO_LOG_SCRIPT)

        self.run_mal_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Done")
        self.expect_unlocked(page)
        self.assertIn("0.00% Updating MAL ratings", page.evaluate("() => window.__infoLog"))
        expect(page.locator("#anime-update-error")).to_have_text(
            "The MAL rating could not be retrieved for 1 anime; the previous value was kept: Known 9002 EN.")

    # ----------------------------- Zhlédnuté epizody -----------------------------

    def run_watched_update(self, page):
        page.locator("#anime-update-toggle").click()
        page.locator("#anime-update-watched-btn").click()

    def serve_favorites(self, *entries):
        self.web.serve(FAVORITES_URL, favorites_page(entries))

    def state_cells(self, page):
        return page.locator("#anime-list .anime-row .anime-row__cell--State").all_inner_texts()

    @staticmethod
    def with_states(states, base=None):
        data = json.loads(json.dumps(SEED_DATA if base is None else base))
        for number, state in states.items():
            data[number]["State"] = state
        return data

    def test_watched_update_writes_states_to_data_file(self):
        seed = self.with_states({"9001": "S01E03", "9004": "DROPPED"})
        self.write_data_file(seed)
        self.serve_favorites(
            watched_favorite(9001, True),
            (SHOW_A["name"], SHOW_A["slug"], SHOW_A["image"], False),
            watched_favorite(9002, False, "s01e12"),
            watched_favorite(9004, False),
        )
        self.web.serve(SERIAL_PREFIX + "known-9002", serial_page([("1", "Videné"), ("2", "Označiť")]))
        page = self.open_page(self.start_helper())
        page.evaluate(INFO_LOG_SCRIPT)

        self.run_watched_update(page)
        expect(page.locator("#anime-update-menu")).to_be_hidden()
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo")
        self.expect_unlocked(page)

        # Texty průběhu jako ve skriptu AnimeList.pyw (UpdateWatched a UpdateWatchedDone).
        info_log = []
        for text in page.evaluate("() => window.__infoLog"):
            if not info_log or info_log[-1] != text:
                info_log.append(text)
        self.assertEqual(info_log, ["0.00% Aktualizuji zhlédnuté epizody", "33.33% Aktualizuji zhlédnuté epizody",
                                    "66.67% Aktualizuji zhlédnuté epizody", "100.00% Aktualizuji zhlédnuté epizody",
                                    "100.00% Hotovo", ""])
        # Stránka seriálu se stahuje jen u nedokončeného oblíbeného, který není DROPPED; cookie jde jen na sledujserialy.io.
        self.assertEqual(self.web.urls, [FAVORITES_URL, SERIAL_PREFIX + "known-9002"])
        self.assertEqual([url for url, headers in self.web.calls if "Cookie" in headers], self.web.urls)

        # Pořadí řádků zůstane; nezhlédnutá je řada 2, takže epizoda je "--".
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004"])
        self.assertEqual(self.state_cells(page), ["DONE", "S02E--", "DROPPED"])
        expect(page.locator("#anime-update-error")).to_be_hidden()

        # Stav zapsal pomocník do souboru ve formátu Python skriptu.
        self.assertEqual(self.read_data_file(), self.python_json(self.with_states({"9001": "DONE", "9002": "S02E--"}, seed)))

        page.reload()
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        self.assertEqual(self.state_cells(page), ["DONE", "S02E--", "DROPPED"])
        self.assertEqual(self.unexpected_console_errors(), [])

    def test_watched_update_shows_each_state_in_row_immediately(self):
        seed = self.with_states({"9001": "S01E03", "9002": "S01E01", "9004": "S01E01"})
        self.write_data_file(seed)
        before = self.read_data_file()
        self.serve_favorites(watched_favorite(9001, True), watched_favorite(9002, False, "s01e12"),
                             watched_favorite(9004, False, "s02e07"))
        self.web.serve(SERIAL_PREFIX + "known-9002", serial_page([("1", "Videné"), ("2", "Označiť")]))
        self.web.serve(SERIAL_PREFIX + "known-9004", serial_page([("1", "Videné"), ("2", "Označiť")]))
        self.web.hold_prefix = SERIAL_PREFIX + "known-9004"
        page = self.open_page(self.start_helper())
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        page.evaluate("() => document.querySelectorAll('#anime-list .anime-row').forEach(row => { row.__live = true; })")

        self.run_watched_update(page)
        self.assertTrue(self.web.reached.wait(10), "aktualizace se nedostala k poslednímu seriálu")
        # Zjištěné stavy jsou v řádcích ještě před koncem aktualizace a zápisem do souboru.
        expect(page.locator("#anime-list .anime-row__cell--State")).to_have_text(["DONE", "S02E--", "S01E01"])
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Aktualizuji zhlédnuté epizody")
        expect(page.locator("#anime-update-toggle")).to_be_disabled()
        self.assertEqual(self.read_data_file(), before)
        # Mění se jen buňka stavu, řádky (a jejich obrázky) zůstanou.
        self.assertTrue(page.evaluate(
            "() => [...document.querySelectorAll('#anime-list .anime-row')].every(row => row.__live === true)"))

        self.web.release.set()
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo")
        self.expect_unlocked(page)
        self.assertEqual(self.state_cells(page), ["DONE", "S02E--", "S02E07"])
        self.assertEqual(self.read_data_file(),
                         self.python_json(self.with_states({"9001": "DONE", "9002": "S02E--", "9004": "S02E07"}, seed)))
        self.assertEqual(self.unexpected_console_errors(), [])

    def test_watched_update_skips_failing_anime_and_lists_them(self):
        self.serve_favorites(watched_favorite(9001, False), watched_favorite(9002, False), watched_favorite(9004, False, "s02e07"))
        self.web.serve(SERIAL_PREFIX + "known-9001", "<html>Nenalezeno</html>", status=404)
        # Web přesměroval na stránku, kterou pomocník nestahuje - týká se jen tohoto seriálu.
        self.web.redirect(SERIAL_PREFIX + "known-9002", "https://sledujserialy.io/")
        self.web.serve(SERIAL_PREFIX + "known-9004", serial_page([("1", "Videné"), ("2", "Označiť")]))
        page = self.open_page(self.start_helper())

        self.run_watched_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo")
        self.expect_unlocked(page)
        expect(page.locator("#anime-update-error")).to_have_text(
            "Zhlédnuté epizody se nepodařilo zjistit u 2 anime, zůstal původní stav: Known 9001 EN, Known 9002 EN.")
        self.assertEqual(self.web.urls, [FAVORITES_URL] + [SERIAL_PREFIX + "known-" + number for number in ("9001", "9002", "9004")])
        self.assertEqual(self.state_cells(page), ["DONE", "DONE", "S02E07"])
        expected = self.with_states({"9004": "S02E07"})
        self.assertEqual(self.read_data_file(), self.python_json(expected))
        self.assertTrue(any("Watched episodes not updated" in text for kind, text in self.console if kind == "warning"))

    def test_watched_update_stops_on_cloudflare_and_keeps_finished_states(self):
        seed = self.with_states({"9001": "S01E03", "9004": "S01E01"})
        self.write_data_file(seed)
        self.serve_favorites(watched_favorite(9001, True), watched_favorite(9002, False), watched_favorite(9004, True))
        self.web.serve(SERIAL_PREFIX + "known-9002", "<title>Just a moment...</title>", status=403,
                       headers={"cf-mitigated": "challenge", "server": "cloudflare"})
        page = self.open_page(self.start_helper())

        self.run_watched_update(page)
        error = page.locator("#anime-update-error")
        expect(error).to_contain_text("vyžaduje ověření Cloudflare")
        expect(error).to_contain_text("Anime: Known 9002 EN.")
        expect(error).to_contain_text("Zhlédnuté epizody zjištěné před chybou se zapsaly do data/anime.json (1).")
        expect(page.locator("#anime-update-toggle")).to_be_enabled(timeout=1000)
        expect(page.locator("#anime-update-info")).to_have_text("")
        self.assertEqual(self.web.urls, [FAVORITES_URL, SERIAL_PREFIX + "known-9002"])
        self.assertEqual(self.state_cells(page), ["DONE", "DONE", "S01E01"])
        self.assertEqual(self.read_data_file(), self.python_json(self.with_states({"9001": "DONE"}, seed)))

    def test_watched_update_reports_states_not_written_to_data_file(self):
        self.serve_favorites(watched_favorite(9001, True), watched_favorite(9002, True), watched_favorite(9004, False, "s03e02"))
        self.web.serve(SERIAL_PREFIX + "known-9004", serial_page([("1", "Videné"), ("2", "Videné"), ("3", "Označiť")]))
        page = self.open_page(self.start_helper())
        expect(page.locator("#anime-list .anime-row")).to_have_count(3)
        self.write_data_file(b"{")

        self.run_watched_update(page)
        expect(page.locator("#anime-update-error")).to_have_text(
            "Výsledek aktualizace se nepodařilo zapsat do data/anime.json. Podrobnosti: data-file-invalid. "
            "Zjištěné zhlédnuté epizody (3) se nepodařilo zapsat do data/anime.json, po obnovení stránky zmizí. "
            "Spusťte aktualizaci znovu.")
        self.expect_unlocked(page)
        self.assertEqual(self.read_data_file(), b"{")
        self.assertEqual(self.state_cells(page), ["DONE", "DONE", "S03E02"])
        self.assertIsNone(page.evaluate("() => localStorage.getItem('anime-data-overrides')"))

    def test_watched_update_requires_cookie_and_helper_version_4(self):
        page = self.open_page(self.start_helper(proxy.Config()))
        self.run_watched_update(page)
        expect(page.locator("#anime-update-error")).to_have_text(
            "Pomocný program nemá nastavenou přihlašovací cookie pro sledujserialy.io (viz README).")
        self.expect_unlocked(page)

        # Pomocník verze 3 umí zapsat jen hodnocení.
        with mock.patch.object(proxy, "VERSION", 3):
            page = self.open_page(self.start_helper())
            self.run_watched_update(page)
            expect(page.locator("#anime-update-error")).to_have_text(
                "Pomocný program je zastaralý a tuto aktualizaci neumí provést. "
                "Ukončete ho a spusťte znovu příkazem „python tools/anime_proxy.py“.")
        self.expect_unlocked(page)
        self.assertEqual(self.web.urls, [])
        self.assertEqual(self.read_data_file(), self.python_json(SEED_DATA))

    def test_watched_update_in_english(self):
        self.serve_favorites(watched_favorite(9001, True), watched_favorite(9002, False), watched_favorite(9004, True))
        self.web.serve(SERIAL_PREFIX + "known-9002", "<html>Not found</html>", status=404)
        page = self.open_page(self.start_helper(), lang="en")
        page.evaluate(INFO_LOG_SCRIPT)

        self.run_watched_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Done")
        self.expect_unlocked(page)
        self.assertIn("0.00% Updating watched episodes", page.evaluate("() => window.__infoLog"))
        expect(page.locator("#anime-update-error")).to_have_text(
            "The watched episodes could not be retrieved for 1 anime; the previous state was kept: Known 9002 EN.")

    # ---------------------------------- Push ----------------------------------

    def make_repo(self):
        """Data a obrázky přesune do git repozitáře s holým remote origin (oba v dočasné složce)."""
        base = tempfile.mkdtemp()
        self.addCleanup(remove_tree, base)
        isolate_git(self, base)
        work = os.path.join(base, "work")
        self.remote = os.path.join(base, "remote.git")
        self.data_file = os.path.join(work, "data", "anime.json")
        self.images_dir = os.path.join(work, "img", "anime")
        os.makedirs(os.path.dirname(self.data_file))
        os.makedirs(self.images_dir)
        self.write_data_file(SEED_DATA)
        git(None, "init", "-q", "--bare", self.remote)
        git(None, "init", "-q", work)
        git(work, "add", ".")
        git(work, "commit", "-q", "-m", "init")
        git(work, "remote", "add", "origin", self.remote)
        git(work, "push", "-q", "-u", "origin", "main")
        return work

    def remote_log(self):
        return git(None, "--git-dir", self.remote, "log", "--format=%s", "main").split("\n")[:-1]

    def remote_files(self):
        return sorted(git(None, "--git-dir", self.remote, "show", "--name-only", "--format=", "main").split())

    def run_push(self, page):
        page.locator("#anime-push-btn").click()

    @unittest.skipUnless(GIT_INSTALLED, "git není nainstalovaný")
    def test_push_publishes_list_update(self):
        work = self.make_repo()
        page = self.open_page(self.start_helper())
        push = page.locator("#anime-push-btn")
        expect(push).to_have_text("Push")
        expect(push).to_have_attribute("title", re.compile("^Commitne data/anime.json"))
        expect(push).to_be_enabled()

        self.run_list_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo. Celkem 2 nové anime.")
        self.expect_unlocked(page)
        self.assertEqual(self.remote_log(), ["init"])

        self.run_push(page)
        info = page.locator("#anime-update-info")
        expect(info).to_have_text(re.compile(r"^Publikováno na GitHub"))
        head = git(work, "rev-parse", "--short", "HEAD").strip()
        expect(info).to_have_text("Publikováno na GitHub (commit %s, změněné soubory: 3). "
                                  "Web se aktualizuje během několika minut." % head)
        expect(page.locator("#anime-update-error")).to_be_hidden()
        expect(push).to_be_enabled()
        expect(page.locator("#anime-update-toggle")).to_be_enabled()
        self.assertEqual(self.remote_log(), [proxy.PUBLISH_MESSAGE, "init"])
        self.assertEqual(self.remote_files(), ["data/anime.json", "img/anime/9005.jpg", "img/anime/9006.jpg"])
        self.assertEqual(git(work, "status", "--porcelain", "--untracked-files=all"), "")

        # Druhý Push už nemá co publikovat; výsledek předchozího přepíše.
        self.run_push(page)
        expect(info).to_have_text(PUSH_NOTHING)
        self.assertEqual(self.remote_log(), [proxy.PUBLISH_MESSAGE, "init"])

        # Další aktualizace zprávu o publikování smaže.
        self.web.serve(FAVORITES_URL, favorites_page([KNOWN_FAVORITE, EXCEPTION_FAVORITE]))
        self.run_list_update(page)
        expect(info).to_have_text("100.00% Žádné nové anime.")
        self.expect_unlocked(page)
        self.assertEqual(self.unexpected_console_errors(), [])
        self.assertEqual(self.page_errors, [])

    @unittest.skipUnless(GIT_INSTALLED, "git není nainstalovaný")
    def test_push_ignores_legacy_browser_overrides(self):
        # Dřívější verze stránky ukládala úpravy do prohlížeče; stránka je smaže a nepoužije.
        self.make_repo()
        legacy = dict(SEED_DATA, **{"9001": dict(SEED_DATA["9001"], MyRating="95%")})
        page = self.open_page(self.start_helper(), lang="en", init_script=LEGACY_OVERRIDES_SCRIPT % json.dumps(
            json.dumps(legacy)))
        expect(page.locator('.anime-row[data-number="9001"] .anime-row__cell--MyRating')).to_have_text("72%")
        self.assertIsNone(page.evaluate("() => localStorage.getItem('anime-data-overrides')"))

        self.run_push(page)
        expect(page.locator("#anime-update-info")).to_have_text(
            "Nothing to publish: neither data/anime.json nor the images have changed and everything is already "
            "on GitHub.")
        self.assertEqual(self.remote_log(), ["init"])

    @unittest.skipUnless(GIT_INSTALLED, "git není nainstalovaný")
    def test_push_rejected_keeps_local_commit(self):
        work = self.make_repo()
        # Někdo mezitím pushnul jiný commit (např. z jiného počítače).
        other = os.path.join(os.path.dirname(work), "other")
        git(None, "clone", "-q", self.remote, other)
        with open(os.path.join(other, "README.md"), "w", encoding="utf-8") as handle:
            handle.write("x\n")
        git(other, "add", "README.md")
        git(other, "commit", "-q", "-m", "elsewhere")
        git(other, "push", "-q", "origin", "main")
        self.write_data_file(dict(SEED_DATA, **{"9005": seed_item(9005)}))
        page = self.open_page(self.start_helper())

        self.run_push(page)
        expect(page.locator("#anime-update-error")).to_have_text(
            "GitHub push odmítl, protože obsahuje novější změny. Commit zůstal jen u vás: v repozitáři spusťte "
            "„git pull --rebase“ a stiskněte Push znovu. Podrobnosti: fetch first.")
        expect(page.locator("#anime-update-info")).to_have_text("")
        expect(page.locator("#anime-push-btn")).to_be_enabled(timeout=1000)
        self.assertEqual(git(work, "log", "--format=%s", "main").split("\n")[:-1], [proxy.PUBLISH_MESSAGE, "init"])
        self.assertEqual(self.remote_log(), ["elsewhere", "init"])

        # Úspěšná aktualizace chybu Push smaže.
        self.web.serve(FAVORITES_URL, favorites_page([KNOWN_FAVORITE, EXCEPTION_FAVORITE]))
        self.run_list_update(page)
        expect(page.locator("#anime-update-error")).to_be_hidden()

    def test_push_errors_from_helper(self):
        page = self.open_page("http://127.0.0.1:%d" % free_port())
        self.run_push(page)
        expect(page.locator("#anime-update-error")).to_contain_text("Pomocný program pro aktualizaci neodpovídá.")
        expect(page.locator("#anime-push-btn")).to_be_enabled(timeout=1000)
        expect(page.locator("#anime-update-toggle")).to_be_enabled()

        # Pomocník verze 7 Push nezná - stránka to pozná dřív, než ho zavolá.
        with mock.patch.object(proxy, "VERSION", 7):
            page = self.open_page(self.start_helper())
            self.run_push(page)
            expect(page.locator("#anime-update-error")).to_have_text(
                "Pomocný program je zastaralý a publikovat neumí. "
                "Ukončete ho a spusťte znovu příkazem „python tools/anime_proxy.py“.")
        expect(page.locator("#anime-push-btn")).to_be_enabled()
        self.assertEqual(self.web.urls, [])

    @unittest.skipUnless(GIT_INSTALLED, "git není nainstalovaný")
    def test_push_refuses_data_outside_git_repository(self):
        base = tempfile.mkdtemp()
        self.addCleanup(remove_tree, base)
        # Strop zastaví hledání repozitáře, takže složka nad dočasnou složkou nevadí.
        isolate_git(self, base)
        self.data_file = os.path.join(base, "plain", "anime.json")
        self.images_dir = os.path.join(base, "plain", "img")
        os.makedirs(self.images_dir)
        self.write_data_file(SEED_DATA)
        page = self.open_page(self.start_helper())

        self.run_push(page)
        expect(page.locator("#anime-update-error")).to_have_text(
            "Soubor s daty nebo složka obrázků není v git repozitáři, pomocný program je nemůže publikovat.")
        expect(page.locator("#anime-push-btn")).to_be_enabled(timeout=1000)
        self.assertEqual(os.listdir(os.path.join(base, "plain")), ["anime.json", "img"])


class RepositoryImageLinkTests(SiteBrowserCase):
    """Odkazy musí fungovat i se skutečným anime.json, bez pomocníka a aktualizace."""

    def open_page(self, role="anime", width=1440):
        context = self.browser.new_context(viewport={"width": width, "height": 900},
                                           is_mobile=width < 500, has_touch=width < 500)
        self.addCleanup(context.close)
        context.add_init_script("sessionStorage.setItem('site-auth-role', %s);" % json.dumps(role))
        page = context.new_page()
        errors = []
        requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url))
        page.goto(self.origin + "/anime.html")
        expect(page.locator("#anime-list-wrap")).to_be_visible()
        return page, errors, requests

    def test_repository_anime_have_links_without_update(self):
        with open(os.path.join(ROOT, "data", "anime.json"), encoding="utf-8") as handle:
            data = json.load(handle)
        unavailable = {"181": "Harem Camp!", "185": "Futoku no Guild"}
        missing = {number: item["FavoriteName"] for number, item in data.items() if not item.get("FavoriteUrlName")}
        self.assertEqual(missing, unavailable, "Dostupná anime musí mít odkazy už při prvním načtení.")
        expected = {}
        for number, item in data.items():
            if number in unavailable:
                self.assertEqual(item["FavoriteUrlName"], "")
                expected[number] = None
                continue
            self.assertRegex(item["FavoriteUrlName"], r"^[A-Za-z0-9_.~%!$&'()*+,;=:@\[\]-]{1,200}$")
            expected[number] = SERIAL_PREFIX + item["FavoriteUrlName"]

        for role, width in (("full", 1440), ("anime", 390)):
            with self.subTest(role=role, width=width):
                page, errors, requests = self.open_page(role, width)
                for reload in (False, True):
                    if reload:
                        page.reload()
                        expect(page.locator("#anime-list-wrap")).to_be_visible()
                    links = page.locator(".anime-row").evaluate_all("""rows => Object.fromEntries(rows.map(row => [
                        row.dataset.number, row.querySelector('.anime-row__image-link')?.href || null
                    ]))""")
                    self.assertEqual(links, expected)
                self.assertEqual(errors, [])
                self.assertFalse(any(":8787/" in url for url in requests), requests)

    def test_existing_image_opens_serial_by_mouse_keyboard_and_touch(self):
        for width, action in ((1440, "click"), (1440, "keyboard"), (390, "tap")):
            with self.subTest(width=width, action=action):
                page, errors, _requests = self.open_page(width=width)
                page.context.route(re.compile(r"^https://sledujserialy\.io/serial/"),
                                   lambda route: route.fulfill(content_type="text/html", body="<title>Serial</title>"))
                link = page.locator('.anime-row[data-number="1"] .anime-row__image-link')
                expect(link).to_have_attribute("href", SERIAL_PREFIX + "naruto")
                expect(link).to_have_attribute("rel", "noopener noreferrer")
                expect(link).to_have_attribute("aria-label", "Naruto")
                with page.expect_popup() as popup_info:
                    if action == "keyboard":
                        link.focus()
                        page.keyboard.press("Enter")
                    elif action == "tap":
                        link.locator("img").tap()
                    else:
                        link.locator("img").click()
                popup = popup_info.value
                popup.wait_for_load_state()
                self.assertEqual(popup.url, SERIAL_PREFIX + "naruto")
                self.assertEqual(page.url, self.origin + "/anime.html")
                self.assertIsNone(popup.evaluate("window.opener"))
                popup.close()
                self.assertEqual(errors, [])
                page.context.close()


class BrowserUnitTests(SiteBrowserCase):
    """Spustí tools/anime-sync-tests.html - testy js/anime-sync.js a js/anime-proxy.js bez sítě."""

    def test_unit_test_page_passes(self):
        context = self.browser.new_context()
        self.addCleanup(context.close)
        context.add_init_script("sessionStorage.setItem('site-auth-role', 'full');")
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(self.origin + "/tools/anime-sync-tests.html")

        summary = page.locator("#summary")
        expect(summary).not_to_have_text("Spouštím…", timeout=15000)
        details = page.locator("#details").inner_text()
        self.assertRegex(summary.inner_text(), r"^OK – prošlo všech [1-9]\d* kontrol\.$", details)
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
