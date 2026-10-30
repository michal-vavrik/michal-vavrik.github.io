"""Prohlížečové testy Aktualizovat -> Seznam (anime.html, js/anime-*.js a tools/anime_proxy.py).

Stránku řídí Playwright, pomocník běží ve stejném procesu a weby, ze kterých
stahuje (sledujserialy.io, ČSFD, MyAnimeList, serialy.sx), nahrazuje atrapa -
testy nepoužívají síť ani přihlašovací cookie. Třída BrowserUnitTests navíc
spouští tools/anime-sync-tests.html (testy js/anime-sync.js a js/anime-proxy.js;
stránku lze otevřít i ručně v prohlížeči).

Spuštění:  python -m unittest discover -s tools -p "test_anime_update.py" -v
Vyžaduje:  pip install playwright a nainstalovaný Microsoft Edge nebo Google Chrome
           (jinak se testy přeskočí; jiný prohlížeč lze zadat proměnnou ANIME_TEST_BROWSER).
"""

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

COOKIE = "E2E-FAKE-COOKIE"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WINDOWS_EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

ITEM_KEYS = ["Number", "FavoriteName", "CsfdID", "MalID", "MalName", "Image", "NameEn", "NameJa",
             "Genres", "Description", "Date", "State", "CsfdRating", "MalRating", "MyRating"]

# Čísla jsou záměrně vysoká, aby k nim v repozitáři nebyly žádné obrázky.
SEED_NUMBERS = (9001, 9002, 9004)

FAVORITES_URL = "https://sledujserialy.io/ucet/"
IMAGE_ORIGIN = "https://serialy.sx"
CSFD_SEARCH_PREFIX = "https://www.csfd.cz/hledat/"

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


def favorites_page(entries):
    blocks = []
    for name, slug, image, finished in entries:
        state = "S01E24" if finished else "Pokračuj"
        blocks.append(
            f'<div class="a-favorites__item"><a href="/episode/{slug}-s01e05/"><img src="{image}">'
            f'<h2 class="a-favorites__title">{name}</h2><span>{state}</span></a></div>'
        )
    return f'<html><body><div id="favorites">{"".join(blocks)}</div><div id="planned"></div></body></html>'


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
        "Number": str(number), "FavoriteName": show["name"], "CsfdID": show["csfd_id"], "MalID": show["mal_id"],
        "MalName": show["mal_name"], "Image": str(number), "NameEn": show["name_en"], "NameJa": show["name_ja"],
        "Genres": "Animovaný\nAkční", "Description": show["plot"], "Date": today, "State": show["state"],
        "CsfdRating": show["csfd_rating"], "MalRating": show["mal_rating"], "MyRating": "?%",
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
        self.serve(IMAGE_ORIGIN + show["image"], JPEG)

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

    def start_helper(self, config=None):
        server = proxy.ProxyServer(0, proxy.DEFAULT_ORIGINS + (self.origin,), self.images_dir,
                                   config or proxy.Config(cookie=COOKIE), self.web)
        threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        # Přidáno až po zavření serveru, takže se spustí dřív - zastavené požadavky se uvolní.
        self.addCleanup(self.web.release.set)
        return "http://127.0.0.1:%d" % server.server_address[1]

    def open_page(self, helper_url, lang="cs", seed=None):
        context = self.browser.new_context(viewport={"width": 1400, "height": 900})
        self.addCleanup(context.close)
        # Data se vloží jen poprvé, aby po znovunačtení zůstala uložená aktualizace.
        context.add_init_script(
            "sessionStorage.setItem('site-auth-role', 'full');"
            "localStorage.setItem('site-lang', %s);"
            "localStorage.setItem('anime-proxy-url', %s);"
            "if (localStorage.getItem('anime-data-overrides') === null) {"
            "localStorage.setItem('anime-data-overrides', %s);}"
            % (json.dumps(lang), json.dumps(helper_url), json.dumps(json.dumps(SEED_DATA if seed is None else seed)))
        )
        page = context.new_page()
        page.on("console", lambda message: self.console.append((message.type, message.text)))
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        page.goto(self.origin + "/anime.html")
        expect(page.locator("#anime-list-wrap")).to_be_visible()
        return page

    def run_list_update(self, page):
        page.locator("#anime-update-toggle").click()
        page.locator("#anime-update-list-btn").click()

    def row_numbers(self, page):
        return page.locator("#anime-list .anime-row").evaluate_all("rows => rows.map(row => row.dataset.number)")

    def stored_items(self, page):
        raw = page.evaluate("() => localStorage.getItem('anime-data-overrides')")
        return json.loads(raw)

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
        # Zatím je zapojený jen Seznam.
        for name in ("watched", "csfd", "mal", "all"):
            button = page.locator("#anime-update-%s-btn" % name)
            expect(button).to_be_disabled()
            expect(button).to_have_attribute("title", "Připravujeme")
        expect(page.locator("#anime-update-list-btn")).to_be_enabled()

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
        expect(page.locator("#anime-update-list-btn")).to_be_focused()

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
        stored = self.stored_items(page)
        self.assertEqual(list(stored), ["9001", "9002", "9004", "9005", "9006"])
        for number, show in (("9005", SHOW_A), ("9006", SHOW_B)):
            item = stored[number]
            self.assertEqual(list(item), ITEM_KEYS)
            self.assertIn(item["Date"], {today_before, today_after})
            self.assertEqual(item, expected_item(show, int(number), item["Date"]))
        self.assertEqual(stored["9001"], SEED_DATA["9001"])

        # Obrázky uložil pomocník pod stejným číslem, jaké má anime.
        self.assertEqual(sorted(os.listdir(self.images_dir)), ["9005.jpg", "9006.jpg"])
        with open(os.path.join(self.images_dir, "9005.jpg"), "rb") as handle:
            self.assertEqual(handle.read(), JPEG)

        row = page.locator('.anime-row[data-number="9005"]')
        expect(row.locator(".anime-row__cell--NameEn")).to_have_text("New Show A EN")
        expect(row.locator(".anime-row__cell--NameJa")).to_have_text("Shin Show A")
        expect(row.locator(".anime-row__cell--State")).to_have_text("S01E05")
        expect(row.locator(".anime-row__cell--CsfdRating")).to_have_text("75%")
        expect(row.locator(".anime-row__cell--MalRating")).to_have_text("79%")
        expect(row.locator(".anime-row__cell--MyRating")).to_have_text("?%")
        expect(page.locator('.anime-row[data-number="9006"] .anime-row__cell--State')).to_have_text("DONE")
        # Obrázek je v repozitáři až po nahrání souboru, do té doby se ukáže popisek.
        row.scroll_into_view_if_needed()
        expect(row.locator(".anime-row__image-missing")).to_have_text("Obrázek chybí")

        # Pořadí kroků jako ve skriptu; cookie dostal jen sledujserialy.io.
        self.assertEqual(self.web.urls, [
            FAVORITES_URL,
            SHOW_A["csfd_search"], "https://www.csfd.cz/film/111111",
            SHOW_A["mal_search"], "https://myanimelist.net/anime/22222", IMAGE_ORIGIN + SHOW_A["image"],
            SHOW_B["csfd_search"], "https://www.csfd.cz/film/222222",
            SHOW_B["mal_search"], SHOW_B["mal_redirect"], "https://myanimelist.net/anime/33333",
            IMAGE_ORIGIN + SHOW_B["image"],
        ])
        self.assertEqual([url for url, headers in self.web.calls if "Cookie" in headers], [FAVORITES_URL])

        # Uložená data přežijí znovunačtení stránky.
        page.reload()
        expect(page.locator("#anime-list-wrap")).to_be_visible()
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9005", "9006"])
        self.assertEqual(self.page_errors, [])
        self.assertEqual(self.unexpected_console_errors(), [])

    def test_list_update_without_new_favorites(self):
        self.web.serve(FAVORITES_URL, favorites_page([KNOWN_FAVORITE, EXCEPTION_FAVORITE]))
        page = self.open_page(self.start_helper())
        page.evaluate(INFO_LOG_SCRIPT)

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
                                   "Anime přidaná před chybou zůstala uložená (1).")
        expect(page.locator("#anime-update-info")).to_have_text("")
        expect(page.locator("#anime-update-toggle")).to_be_enabled(timeout=1000)
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9005"])
        self.assertEqual(list(self.stored_items(page)), ["9001", "9002", "9004", "9005"])
        # Rozpracované anime po sobě nezanechá ani obrázek.
        self.assertEqual(os.listdir(self.images_dir), ["9005.jpg"])

        # Po opravě zdroje se doplní jen to, co chybí.
        self.web.serve_show(SHOW_B)
        self.run_list_update(page)
        expect(page.locator("#anime-update-info")).to_have_text("100.00% Hotovo. Celkem 1 nové anime.")
        expect(error).to_be_hidden()
        self.expect_unlocked(page)
        self.assertEqual(self.row_numbers(page), ["9001", "9002", "9004", "9005", "9006"])
        self.assertEqual(sorted(os.listdir(self.images_dir)), ["9005.jpg", "9006.jpg"])

    def test_controls_are_locked_while_running(self):
        self.web.hold_prefix = CSFD_SEARCH_PREFIX
        page = self.open_page(self.start_helper())
        self.run_list_update(page)
        self.assertTrue(self.web.reached.wait(10), "aktualizace se nedostala k hledání na ČSFD")

        info = page.locator("#anime-update-info")
        expect(info).to_have_text("0.00% Aktualizuji anime list. Celkem 2 nové anime.")
        expect(page.locator("#anime-update-menu")).to_be_hidden()
        for selector in ("#anime-update-toggle", "#anime-edit-toggle", "#anime-import-btn", "#anime-reset-btn"):
            expect(page.locator(selector)).to_be_disabled()
        expect(page.locator("#anime-export-btn")).to_be_enabled()
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
        for selector in ("#anime-edit-toggle", "#anime-import-btn", "#anime-reset-btn"):
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
        expect(page.locator("#anime-update-watched-btn")).to_have_attribute("title", "Coming soon")
        expect(page.locator("#anime-update-menu")).to_have_attribute("aria-label", "Update options")

        page.locator("#anime-update-list-btn").click()
        expect(page.locator("#anime-update-info")).to_have_text("100.00% No new anime.")
        self.expect_unlocked(page)


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
