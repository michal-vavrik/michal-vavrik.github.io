"""Browser tests for the home constellation map.

Run: python -m unittest discover -s tools -p "test_home.py" -v
Requires Playwright and Edge (or HOME_TEST_BROWSER pointing to a Chromium browser).
"""

import functools
import http.server
import math
import os
import threading
import unittest
from pathlib import Path

try:
    from playwright.sync_api import expect, sync_playwright
except ImportError:
    sync_playwright = None

ROOT = Path(__file__).resolve().parent.parent
BROWSER = os.environ.get(
    "HOME_TEST_BROWSER", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)


@unittest.skipUnless(sync_playwright and Path(BROWSER).is_file(), "Playwright or browser unavailable")
class HomeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/index.html"
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=BROWSER)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join()

    def setUp(self):
        self.context = self.browser.new_context()
        self.context.route("https://**/*", lambda route: route.abort())
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def open_as(self, role=None, wait_until="load"):
        if role:
            self.page.add_init_script(
                f"sessionStorage.setItem('site-auth-role', {role!r});"
            )
        self.page.goto(self.url, wait_until=wait_until)

    def trace_starfield(self):
        self.page.add_init_script("""(() => {
            const prototype = CanvasRenderingContext2D.prototype;
            const clear = prototype.clearRect;
            const begin = prototype.beginPath;
            const move = prototype.moveTo;
            const line = prototype.lineTo;
            const arc = prototype.arc;
            const stroke = prototype.stroke;
            const isSky = context => context.canvas.matches('body.home > canvas');
            prototype.clearRect = function (...args) {
                if (isSky(this)) window.__skyFrame = { stars: [], segments: [] };
                return clear.apply(this, args);
            };
            prototype.beginPath = function (...args) {
                if (isSky(this)) this.__skyPath = [];
                return begin.apply(this, args);
            };
            prototype.moveTo = function (x, y) {
                if (isSky(this)) this.__skyPath.push([x, y]);
                return move.call(this, x, y);
            };
            prototype.lineTo = function (x, y) {
                if (isSky(this)) this.__skyPath.push([x, y]);
                return line.call(this, x, y);
            };
            prototype.arc = function (x, y, radius, ...args) {
                if (isSky(this)) window.__skyFrame.stars.push({ x, y, radius });
                return arc.call(this, x, y, radius, ...args);
            };
            prototype.stroke = function (...args) {
                if (isSky(this) && this.__skyPath.length === 2) {
                    window.__skyFrame.segments.push(this.__skyPath);
                }
                return stroke.apply(this, args);
            };
        })();""")

    def count_formed_stars(self, selector):
        return self.page.evaluate("""selector => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            const scale = window.devicePixelRatio;
            return window.__skyFrame.stars.filter(star =>
                star.radius / scale > 2.2 &&
                star.x / scale >= rect.left && star.x / scale <= rect.right &&
                star.y / scale >= rect.top && star.y / scale <= rect.bottom
            ).length;
        }""", selector)

    def test_constellation_uses_nearby_available_stars(self):
        self.page.emulate_media(reduced_motion="reduce")
        self.page.add_init_script("""(() => {
            let seed = 123456;
            Math.random = () => {
                seed = (1664525 * seed + 1013904223) >>> 0;
                return seed / 4294967296;
            };
        })();""")
        self.trace_starfield()
        self.open_as("full")
        frames = self.page.evaluate("""() => {
            const before = window.__skyFrame.stars;
            document.querySelector('[data-constellation="games"] .constellation__sky')
                .dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
            return { before, after: window.__skyFrame.stars };
        }""")
        before, after = frames["before"], frames["after"]
        selected = [index for index, star in enumerate(after) if star["radius"] > 2.2]
        unselected = [star for index, star in enumerate(before) if index not in selected]
        self.assertEqual(len(selected), 10)
        for index in selected:
            target = after[index]
            distance = lambda star: math.hypot(star["x"] - target["x"], star["y"] - target["y"])
            self.assertLessEqual(distance(before[index]), min(map(distance, unselected)) + 0.01)

    def test_fast_pointer_movement_does_not_send_arriving_stars_across_screen(self):
        self.page.emulate_media(reduced_motion="no-preference")
        self.page.add_init_script("""(() => {
            let seed = 123456;
            Math.random = () => {
                seed = (1664525 * seed + 1013904223) >>> 0;
                return seed / 4294967296;
            };
        })();""")
        self.trace_starfield()
        self.open_as("full")
        self.page.mouse.move(2, 2)
        self.page.wait_for_timeout(100)
        self.page.evaluate("""() => {
            window.__skyFrames = [];
            const clear = CanvasRenderingContext2D.prototype.clearRect;
            CanvasRenderingContext2D.prototype.clearRect = function (...args) {
                if (this.canvas.matches('body.home > canvas') && window.__skyFrame) {
                    window.__skyFrames.push(window.__skyFrame.stars);
                }
                return clear.apply(this, args);
            };
        }""")
        self.page.locator('[data-constellation="games"] .constellation__sky').hover()
        expect(self.page.locator('[data-constellation="games"].is-ready')).to_be_visible(timeout=6000)
        frames = self.page.evaluate("() => window.__skyFrames")
        formed = frames[-1]
        selected = [index for index, star in enumerate(formed) if star["radius"] > 2.2]
        self.assertEqual(len(selected), 10)
        for index in selected:
            target = formed[index]
            start = next(frame[index] for frame in frames if frame[index]["radius"] > 1.35)
            self.assertLess(math.hypot(start["x"] - target["x"], start["y"] - target["y"]), 300)

    def test_hover_gathers_background_stars_and_leaving_scatters_them(self):
        self.page.emulate_media(reduced_motion="no-preference")
        self.trace_starfield()
        self.open_as("full", wait_until="domcontentloaded")
        self.page.wait_for_function("() => window.__skyFrame && window.__skyFrame.stars.length >= 100")
        self.page.wait_for_timeout(2800)
        initial = self.page.evaluate("() => window.__skyFrame")
        self.assertEqual(self.page.locator(".universe svg").count(), 0)
        expect(self.page.locator(".is-forming, .is-ready, .is-leaving")).to_have_count(0)
        self.assertFalse(any(star["radius"] > 2.2 for star in initial["stars"]))
        self.assertEqual(float(self.page.locator(".constellation__name").first.evaluate(
            "element => getComputedStyle(element).opacity"
        )), 0)

        games = self.page.locator('[data-constellation="games"]')
        games.locator(".constellation__sky").hover()
        expect(self.page.locator(".constellation.is-forming")).to_have_count(1)
        self.page.wait_for_function("""() => window.__skyFrame.stars.filter(
            star => star.radius > 1.55 && star.radius < 2.0
        ).length >= 3""", timeout=5000)
        during = self.page.evaluate("() => window.__skyFrame")
        expect(self.page.locator(".constellation.is-ready")).to_have_count(1, timeout=6000)
        expect(games.locator(".constellation__name")).to_have_css("opacity", "1")
        formed = self.page.evaluate("() => window.__skyFrame")

        self.assertEqual(len(initial["stars"]), len(during["stars"]))
        self.assertEqual(len(initial["stars"]), len(formed["stars"]))
        selected = [index for index, star in enumerate(formed["stars"]) if star["radius"] > 2.2]
        self.assertGreaterEqual(len(selected), 8)

        def distance(first, second):
            return math.hypot(first["x"] - second["x"], first["y"] - second["y"])

        moved = [index for index in selected if distance(initial["stars"][index], formed["stars"][index]) > 5]
        in_flight = [
            index for index in moved
            if distance(initial["stars"][index], during["stars"][index]) > 2
            and distance(during["stars"][index], formed["stars"][index]) > 2
        ]
        self.assertGreaterEqual(len(moved), 7)
        self.assertGreaterEqual(len(in_flight), 3)

        bright_stars = [formed["stars"][index] for index in selected]

        def matches_star(point):
            return any(math.hypot(point[0] - star["x"], point[1] - star["y"]) < 0.1
                       for star in bright_stars)

        connections = [segment for segment in formed["segments"]
                       if math.dist(*segment) > 10
                       and matches_star(segment[0]) and matches_star(segment[1])]
        self.assertGreaterEqual(len(connections), 8)
        self.assertGreaterEqual(self.count_formed_stars(
            '[data-constellation="games"] .constellation__sky'
        ), 8)
        self.page.wait_for_timeout(200)
        later = self.page.evaluate("() => window.__skyFrame")
        self.assertTrue(any(
            distance(formed["stars"][index], later["stars"][index]) > 0.5
            for index in range(len(formed["stars"])) if index not in selected
        ))
        self.page.mouse.move(2, 2)
        expect(self.page.locator(".constellation.is-leaving")).to_have_count(1)
        expect(games.locator(".constellation__name")).to_have_css("opacity", "0")
        self.page.wait_for_timeout(300)
        departing = self.page.evaluate("() => window.__skyFrame")
        self.assertGreaterEqual(sum(
            distance(formed["stars"][index], departing["stars"][index]) > 10
            for index in selected
        ), 7)
        expect(self.page.locator(".constellation.is-leaving")).to_have_count(0)
        self.assertFalse(any(star["radius"] > 2.2 for star in
                             self.page.evaluate("() => window.__skyFrame.stars")))

    def test_all_constellations_form_in_one_second(self):
        self.page.emulate_media(reduced_motion="no-preference")
        self.trace_starfield()
        self.open_as("full")
        self.page.evaluate("""() => {
            window.__formationTimes = {};
            document.querySelectorAll('.constellation').forEach(formation => {
                let start = null;
                new MutationObserver(() => {
                    if (formation.classList.contains('is-forming') && start === null) {
                        start = performance.now();
                    }
                    if (formation.classList.contains('is-ready') && start !== null) {
                        window.__formationTimes[formation.dataset.constellation] = performance.now() - start;
                        start = null;
                    }
                }).observe(formation, { attributes: true, attributeFilter: ['class'] });
            });
        }""")
        for name in ("personal", "cv", "games", "tools", "contact", "anime", "nv194"):
            with self.subTest(constellation=name):
                constellation = self.page.locator(f'[data-constellation="{name}"]')
                sky = constellation.locator(".constellation__sky")
                sky.hover()
                expect(constellation).to_have_class("constellation is-ready", timeout=3000)
                self.page.wait_for_function("name => window.__formationTimes[name] !== undefined", arg=name)
                duration = self.page.evaluate("name => window.__formationTimes[name]", name)
                self.assertGreaterEqual(duration, 900)
                self.assertLess(duration, 1200)
                self.assertGreaterEqual(self.count_formed_stars(
                    f'[data-constellation="{name}"] .constellation__sky'
                ), 8)
                connections = self.page.evaluate("""name => {
                    const rect = document.querySelector(
                        `[data-constellation="${name}"] .constellation__sky`
                    ).getBoundingClientRect();
                    const scale = window.devicePixelRatio;
                    const stars = window.__skyFrame.stars.filter(star =>
                        star.radius / scale > 2.2 &&
                        star.x / scale >= rect.left && star.x / scale <= rect.right &&
                        star.y / scale >= rect.top && star.y / scale <= rect.bottom
                    );
                    return window.__skyFrame.segments.filter(segment =>
                        Math.hypot(segment[0][0] - segment[1][0], segment[0][1] - segment[1][1]) > 1 &&
                        segment.every(point => stars.some(star =>
                            Math.hypot(point[0] - star.x, point[1] - star.y) < 0.1
                        ))
                    ).length;
                }""", name)
                self.assertGreaterEqual(connections, 5)

    def test_static_constellations_follow_scroll_and_resize(self):
        self.page.emulate_media(reduced_motion="reduce")
        self.page.set_viewport_size({"width": 320, "height": 480})
        self.trace_starfield()
        self.open_as("full", wait_until="domcontentloaded")
        expect(self.page.locator("body")).to_have_class("home home--static")
        expect(self.page.locator(".constellation.is-forming")).to_have_count(0)
        last_sky = '[data-constellation="nv194"] .constellation__sky'
        self.page.locator('[data-constellation="nv194"]').focus()
        self.page.wait_for_timeout(100)
        self.assertGreaterEqual(self.count_formed_stars(last_sky), 5)
        self.page.locator(last_sky).scroll_into_view_if_needed()
        self.page.wait_for_timeout(100)
        self.assertGreaterEqual(self.count_formed_stars(last_sky), 5)
        self.page.set_viewport_size({"width": 375, "height": 520})
        self.page.wait_for_timeout(100)
        self.assertGreaterEqual(self.count_formed_stars(last_sky), 5)

    def test_system_reduced_motion_finishes_an_in_progress_formation(self):
        self.page.emulate_media(reduced_motion="no-preference")
        self.open_as("full", wait_until="domcontentloaded")
        self.page.locator('[data-constellation="games"] .constellation__sky').hover()
        expect(self.page.locator(".constellation.is-forming")).to_have_count(1)
        self.page.emulate_media(reduced_motion="reduce")
        expect(self.page.locator("body")).to_have_class("home home--static")
        expect(self.page.locator(".constellation.is-forming")).to_have_count(0)
        self.assertEqual(float(self.page.locator('[data-constellation="games"] .constellation__name').evaluate(
            "element => getComputedStyle(element).opacity"
        )), 1)
        before = self.page.locator("canvas").evaluate("(canvas) => canvas.toDataURL()")
        self.page.wait_for_timeout(150)
        self.assertEqual(before, self.page.locator("canvas").evaluate("(canvas) => canvas.toDataURL()"))

    def test_guest_login_and_logout_update_map_without_reload(self):
        self.page.emulate_media(reduced_motion="reduce")
        self.trace_starfield()
        self.open_as()
        expect(self.page.locator("#universe-empty")).to_be_hidden()
        expect(self.page.get_by_text("Přihlas se a otevři si cestu k souhvězdím.")).to_have_count(0)
        expect(self.page.locator("#universe-login")).to_have_count(0)
        expect(self.page.locator(".constellation:visible")).to_have_count(0)
        self.page.evaluate("""() => {
            window.SiteAuth.login = () => {
                sessionStorage.setItem('site-auth-role', 'games');
                return 'games';
            };
        }""")
        self.page.locator("#auth-btn").click()
        expect(self.page.locator("#auth-modal")).to_be_visible()
        self.page.locator("#auth-password").fill("test")
        self.page.locator("#auth-form button[type=submit]").click()
        expect(self.page.locator(".constellation:visible")).to_have_count(1)
        expect(self.page.locator('[data-page="games.html"]')).to_be_visible()
        self.assertEqual(self.count_formed_stars('[data-page="games.html"] .constellation__sky'), 0)
        self.page.locator('[data-page="games.html"] .constellation__sky').hover()
        self.assertGreaterEqual(self.count_formed_stars('[data-page="games.html"] .constellation__sky'), 5)
        self.page.locator("#auth-btn").click()
        self.page.locator("#auth-logout").click()
        expect(self.page.locator(".constellation:visible")).to_have_count(0)
        expect(self.page.locator("#universe-empty")).to_be_hidden()
        expect(self.page.get_by_text("Přihlas se a otevři si cestu k souhvězdím.")).to_have_count(0)

    def test_quick_exit_and_reentry_can_reverse_the_flight(self):
        self.page.emulate_media(reduced_motion="no-preference")
        self.trace_starfield()
        self.open_as("games")
        sky = self.page.locator('[data-constellation="games"] .constellation__sky')
        for delay in (50, 350):
            sky.hover()
            self.page.wait_for_timeout(delay)
            self.page.mouse.move(2, 2)
            self.page.wait_for_timeout(100)
        sky.hover()
        expect(self.page.locator(".constellation.is-ready")).to_have_count(1, timeout=6000)
        self.assertGreaterEqual(self.count_formed_stars(
            '[data-constellation="games"] .constellation__sky'
        ), 8)
        self.page.mouse.move(2, 2)
        expect(self.page.locator(".constellation.is-leaving")).to_have_count(0)
        self.assertFalse(any(star["radius"] > 2.2 for star in
                             self.page.evaluate("() => window.__skyFrame.stars")))

    def test_rapid_transitions_on_small_screen_keep_forming(self):
        self.page.emulate_media(reduced_motion="no-preference")
        self.page.set_viewport_size({"width": 320, "height": 480})
        self.trace_starfield()
        self.open_as("full")
        names = ("personal", "cv", "games", "tools", "contact", "anime", "nv194")
        for _ in range(2):
            for name in names:
                self.page.locator(f'[data-constellation="{name}"] .constellation__sky').hover()
                self.page.wait_for_timeout(140)
        gear = self.page.locator('[data-constellation="tools"]')
        gear.locator(".constellation__sky").hover()
        expect(gear).to_have_class("constellation is-ready", timeout=5000)
        self.assertGreaterEqual(self.count_formed_stars(
            '[data-constellation="tools"] .constellation__sky'
        ), 20)

    def test_touch_reveals_dismisses_and_opens_constellation(self):
        self.context.close()
        self.context = self.browser.new_context(
            has_touch=True, is_mobile=True, viewport={"width": 375, "height": 812},
            reduced_motion="reduce"
        )
        self.context.route("https://**/*", lambda route: route.abort())
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.trace_starfield()
        self.open_as("full")
        expect(self.page.locator(".constellation.is-ready")).to_have_count(0)
        games = self.page.locator('[data-constellation="games"]')
        games.tap()
        expect(self.page.locator(".constellation.is-ready")).to_have_count(1)
        self.assertTrue(self.page.url.endswith("/index.html"))
        self.assertGreaterEqual(self.count_formed_stars(
            '[data-constellation="games"] .constellation__sky'
        ), 8)
        self.page.touchscreen.tap(2, 200)
        expect(self.page.locator(".constellation.is-ready")).to_have_count(0)
        games.tap()
        expect(games).to_have_class("constellation is-ready")
        games.tap()
        expect(self.page).to_have_url(self.url.replace("index.html", "games.html"))

    def test_roles_and_keyboard_navigation(self):
        for role, expected in [
            ("full", ["personal.html", "cv.html", "games.html", "tools.html",
                      "contact.html", "anime.html", "nv194.html"]),
            ("games", ["games.html"]),
            ("anime", ["anime.html"]),
            ("tools", ["tools.html"]),
            ("nv194", ["nv194.html"]),
            ("cv", ["cv.html"]),
        ]:
            with self.subTest(role=role):
                self.page.goto(self.url)
                self.page.evaluate("(role) => sessionStorage.setItem('site-auth-role', role)", role)
                self.page.reload()
                visible = self.page.locator(".constellation:visible")
                self.assertEqual(visible.evaluate_all("(cards) => cards.map(c => c.dataset.page)"), expected)
                if expected:
                    link = visible.first
                    self.assertEqual(link.get_attribute("href"), expected[0])
                    link.focus()
                    expect(link).to_have_class("constellation is-forming")
                    self.page.keyboard.press("Enter")
                    expect(self.page).to_have_url(self.url.replace("index.html", expected[0]))
                else:
                    expect(self.page.locator("#universe-empty-role")).to_be_visible()
                    expect(self.page.locator("#universe-login")).to_be_hidden()

    def test_language_motion_and_mobile_layout(self):
        self.page.emulate_media(reduced_motion="reduce")
        self.page.set_viewport_size({"width": 320, "height": 600})
        self.open_as("full")
        expect(self.page.locator("body")).to_have_class("home home--static")
        expect(self.page.locator("#motion-toggle, .universe__intro, .constellation__detail")).to_have_count(0)
        before = self.page.locator("canvas").evaluate("(canvas) => canvas.toDataURL()")
        self.page.wait_for_timeout(150)
        self.assertEqual(before, self.page.locator("canvas").evaluate("(canvas) => canvas.toDataURL()"))
        self.page.emulate_media(reduced_motion="no-preference")
        expect(self.page.locator("body")).to_have_class("home")
        self.page.wait_for_timeout(150)
        self.assertNotEqual(before, self.page.locator("canvas").evaluate("(canvas) => canvas.toDataURL()"))
        self.page.emulate_media(reduced_motion="reduce")
        self.page.locator("#lang-switcher-toggle").click()
        self.page.locator('[data-lang="en"]').click()
        expect(self.page.locator('[data-page="games.html"]')).to_have_text("Games")
        expect(self.page.locator("#universe-grid")).to_have_attribute("aria-label", "Constellations")
        gear = self.page.locator('[data-constellation="tools"] .constellation__sky').bounding_box()
        self.assertAlmostEqual(gear["width"], gear["height"], delta=1)
        self.assertFalse(self.page.evaluate(
            "() => document.documentElement.scrollWidth > document.documentElement.clientWidth"
        ))

    def test_destination_opens(self):
        self.page.emulate_media(reduced_motion="reduce")
        self.open_as("full")
        for destination in ("personal.html", "cv.html", "games.html", "tools.html",
                            "contact.html", "anime.html", "nv194.html"):
            with self.subTest(destination=destination):
                if not self.page.url.endswith("/index.html"):
                    self.page.goto(self.url)
                link = self.page.locator(f'[data-page="{destination}"]')
                link.hover()
                expect(link).to_have_class("constellation is-ready")
                link.click()
                self.assertTrue(self.page.url.endswith("/" + destination))


if __name__ == "__main__":
    unittest.main()
