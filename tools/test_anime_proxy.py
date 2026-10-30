"""Testy pomocníka tools/anime_proxy.py (bez sítě - upstream se nahrazuje atrapou).

Spuštění:  python -m unittest discover -s tools -p "test_anime_proxy.py" -v
"""

import gzip
import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import zlib
from unittest import mock
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anime_proxy as proxy  # noqa: E402

ORIGIN = "https://michal-vavrik.github.io"
COOKIE = "SENTINEL-COOKIE-VALUE-0123456789"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
UCET = "https://sledujserialy.io/ucet/"
CSFD_SEARCH = "https://www.csfd.cz/hledat/?q=Naruto+Shippuden"
CSFD_FILM = "https://www.csfd.cz/film/1032664"
MAL_SEARCH = "https://myanimelist.net/anime.php?cat=anime&q=Naruto"
IMAGE_URL = "https://serialy.sx/upload/serial/abc.jpg"


class FakeTransport:
    """Nahrazuje http_get_once: zaznamenává volání a vrací připravené odpovědi."""

    def __init__(self):
        self.calls = []
        self.routes = {}

    def __call__(self, url, headers, timeout, max_bytes):
        self.calls.append((url, dict(headers)))
        result = self.routes[url]
        if isinstance(result, list):
            result = result.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class ProxyTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        patcher = mock.patch.object(proxy.Handler, "log_request", lambda *args, **kwargs: None)
        patcher.start()
        cls.addClassCleanup(patcher.stop)

    def make_server(self):
        return proxy.ProxyServer(0, proxy.DEFAULT_ORIGINS, self.images, proxy.Config(cookie=COOKIE), self.transport)

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.images = os.path.join(self.tmp, "img")
        self.transport = FakeTransport()
        self.server = self.make_server()
        self.port = self.server.server_address[1]
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method, path, headers=None, body=None):
        merged = {"Origin": ORIGIN, proxy.REQUEST_HEADER: "1"}
        merged.update(headers or {})
        merged = {name: value for name, value in merged.items() if value is not None}
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(method, path, body=body, headers=merged)
            response = connection.getresponse()
            data = response.read()
            response_headers = {name.lower(): value for name, value in response.getheaders()}
        finally:
            connection.close()
        blob = repr(response_headers).encode("utf-8") + data
        self.assertNotIn(COOKIE.encode("utf-8"), blob, "cookie unikla v odpovědi")
        return response.status, response_headers, data

    def fetch(self, url, **kwargs):
        return self.request("GET", "/fetch?url=" + quote(url, safe=""), **kwargs)

    def post_image(self, payload, **kwargs):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        headers.update(kwargs.pop("headers", {}))
        return self.request("POST", "/images", headers=headers, body=body, **kwargs)

    def ok_page(self, body=b"<html></html>", headers=None):
        return (200, headers or {}, body)


class GuardTests(ProxyTestCase):
    def test_health_reports_state_without_secrets(self):
        for name in ("5.jpg", "12.jpg", "x.jpg", "7.png"):
            os.makedirs(self.images, exist_ok=True)
            open(os.path.join(self.images, name), "wb").close()
        status, headers, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertEqual(payload, {"ok": True, "version": proxy.VERSION, "cookieConfigured": True, "maxImageNumber": 12,
                                   "dataFile": False})
        self.assertEqual(headers["access-control-allow-origin"], ORIGIN)
        self.assertIn("X-Upstream-Status", headers["access-control-expose-headers"])
        self.assertEqual(headers["cache-control"], "no-store")

    def test_foreign_origin_is_rejected(self):
        status, headers, _ = self.request("GET", "/health", headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        self.assertEqual(headers["x-proxy-error"], "origin-not-allowed")
        self.assertNotIn("access-control-allow-origin", headers)

    def test_foreign_host_is_rejected_against_dns_rebinding(self):
        status, headers, _ = self.request("GET", "/health", headers={"Host": "evil.example:%d" % self.port})
        self.assertEqual(status, 403)
        self.assertEqual(headers["x-proxy-error"], "host-not-allowed")

    def test_localhost_host_is_accepted(self):
        status, _, _ = self.request("GET", "/health", headers={"Host": "localhost:%d" % self.port})
        self.assertEqual(status, 200)

    def test_custom_header_is_required(self):
        status, headers, _ = self.request("GET", "/health", headers={proxy.REQUEST_HEADER: None})
        self.assertEqual(status, 403)
        self.assertEqual(headers["x-proxy-error"], "missing-header")

    def test_request_without_origin_but_with_header_is_allowed(self):
        status, headers, _ = self.request("GET", "/health", headers={"Origin": None})
        self.assertEqual(status, 200)
        self.assertNotIn("access-control-allow-origin", headers)

    def test_additional_origin_can_be_allowed(self):
        self.server.allowed_origins = self.server.allowed_origins | {"http://localhost:9999"}
        status, headers, _ = self.request("GET", "/health", headers={"Origin": "http://localhost:9999"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["access-control-allow-origin"], "http://localhost:9999")

    def test_preflight_for_allowed_origin(self):
        status, headers, body = self.request("OPTIONS", "/fetch", headers={
            proxy.REQUEST_HEADER: None,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-anime-proxy",
            "Access-Control-Request-Private-Network": "true",
        })
        self.assertEqual(status, 204)
        self.assertEqual(body, b"")
        self.assertEqual(headers["access-control-allow-origin"], ORIGIN)
        self.assertIn("X-Anime-Proxy", headers["access-control-allow-headers"])
        self.assertIn("Content-Type", headers["access-control-allow-headers"])
        self.assertEqual(headers["access-control-allow-private-network"], "true")

    def test_preflight_rejects_foreign_or_missing_origin(self):
        for origin in ("https://evil.example", None):
            status, headers, _ = self.request("OPTIONS", "/fetch", headers={"Origin": origin, proxy.REQUEST_HEADER: None})
            self.assertEqual(status, 403, origin)
            self.assertNotIn("access-control-allow-origin", headers)

    def test_unknown_route_and_wrong_method(self):
        self.assertEqual(self.request("GET", "/nope")[0], 404)
        self.assertEqual(self.request("POST", "/fetch")[0], 405)
        self.assertEqual(self.request("GET", "/images")[0], 405)
        self.assertEqual(self.request("POST", "/health")[0], 405)
        self.assertEqual(self.request("GET", "/csfd-ratings")[0], 405)


class FetchTests(ProxyTestCase):
    def test_returns_body_and_upstream_info(self):
        text = "Příliš žluťoučký kůň"
        self.transport.routes[CSFD_SEARCH] = self.ok_page(text.encode("utf-8"), {"set-cookie": "a=b"})
        status, headers, body = self.fetch(CSFD_SEARCH)
        self.assertEqual(status, 200)
        self.assertEqual(body.decode("utf-8"), text)
        self.assertEqual(headers["x-upstream-status"], "200")
        self.assertEqual(headers["x-final-url"], CSFD_SEARCH)
        self.assertEqual(headers["content-type"], "text/plain; charset=utf-8")
        self.assertNotIn("set-cookie", headers)

    def test_cookie_and_script_headers(self):
        self.transport.routes[UCET] = self.ok_page()
        self.transport.routes[CSFD_SEARCH] = self.ok_page()
        self.fetch(UCET)
        self.fetch(CSFD_SEARCH)
        (_, sledujserialy), (_, csfd) = self.transport.calls
        self.assertEqual(sledujserialy["Cookie"], "user_logged_in=" + COOKIE)
        self.assertNotIn("Cookie", csfd)
        for headers in (sledujserialy, csfd):
            self.assertEqual(headers["User-Agent"], "myApi")
            self.assertEqual(headers["Accept"], "*/*")

    def test_follows_redirect_on_allowed_host(self):
        self.transport.routes[CSFD_FILM] = (302, {"location": "/film/1032664/prehled/"}, b"")
        self.transport.routes["https://www.csfd.cz/film/1032664/prehled/"] = self.ok_page(b"film")
        status, headers, body = self.fetch(CSFD_FILM)
        self.assertEqual((status, body), (200, b"film"))
        self.assertEqual(headers["x-final-url"], "https://www.csfd.cz/film/1032664/prehled/")

    def test_final_url_exposes_mal_redirect_target(self):
        target = "https://myanimelist.net/anime/61207/Tensei_shitara_Dragon_no_Tamago_datta"
        self.transport.routes[MAL_SEARCH] = (303, {"location": "/anime/61207/Tensei_shitara_Dragon_no_Tamago_datta"}, b"")
        self.transport.routes[target] = self.ok_page(b"anime page")
        _, headers, _ = self.fetch(MAL_SEARCH)
        self.assertEqual(headers["x-final-url"], target)

    def test_cookie_is_not_sent_after_redirect_to_another_host(self):
        self.transport.routes[UCET] = (302, {"location": CSFD_SEARCH}, b"")
        self.transport.routes[CSFD_SEARCH] = self.ok_page()
        self.fetch(UCET)
        self.assertIn("Cookie", self.transport.calls[0][1])
        self.assertNotIn("Cookie", self.transport.calls[1][1])

    def test_redirect_to_blocked_host_is_reported(self):
        self.transport.routes[CSFD_FILM] = (307, {"location": "https://zscalernotification.abb.com/x?user=a@b.c"}, b"")
        status, headers, body = self.fetch(CSFD_FILM)
        self.assertEqual(status, 502)
        self.assertEqual(headers["x-proxy-error"], "redirect-blocked")
        self.assertEqual(headers["x-proxy-detail"], "zscalernotification.abb.com")
        self.assertNotIn(b"a@b.c", body)
        self.assertEqual(len(self.transport.calls), 1)

    def test_redirect_to_blocked_path_is_reported(self):
        self.transport.routes[CSFD_FILM] = (302, {"location": "/uzivatel/1"}, b"")
        status, headers, _ = self.fetch(CSFD_FILM)
        self.assertEqual((status, headers["x-proxy-error"]), (502, "redirect-blocked"))

    def test_redirect_loop_is_limited(self):
        self.transport.routes[CSFD_FILM] = (302, {"location": "/film/1032664"}, b"")
        status, headers, _ = self.fetch(CSFD_FILM)
        self.assertEqual((status, headers["x-proxy-error"]), (502, "too-many-redirects"))
        self.assertEqual(len(self.transport.calls), proxy.MAX_REDIRECTS + 1)

    def test_upstream_error_status_is_passed_through(self):
        self.transport.routes[CSFD_FILM] = (404, {}, b"nenalezeno")
        status, headers, body = self.fetch(CSFD_FILM)
        self.assertEqual((status, body), (200, b"nenalezeno"))
        self.assertEqual(headers["x-upstream-status"], "404")

    def test_cloudflare_challenge_is_detected(self):
        responses = (
            (403, {"cf-mitigated": "challenge", "server": "cloudflare"}, b"<title>Just a moment...</title>"),
            (503, {"server": "cloudflare"}, b"<title>Just a moment...</title>"),
        )
        for response in responses:
            self.transport.routes[UCET] = response
            status, headers, _ = self.fetch(UCET)
            self.assertEqual((status, headers["x-proxy-error"]), (502, "cloudflare-challenge"))

    def test_plain_forbidden_is_not_a_challenge(self):
        self.transport.routes[UCET] = (403, {"server": "nginx"}, b"forbidden")
        status, headers, _ = self.fetch(UCET)
        self.assertEqual((status, headers["x-upstream-status"]), (200, "403"))

    def test_invalid_utf8_is_rejected(self):
        self.transport.routes[CSFD_FILM] = self.ok_page(b"\xff\xfe\x00")
        status, headers, _ = self.fetch(CSFD_FILM)
        self.assertEqual((status, headers["x-proxy-error"]), (502, "invalid-encoding"))

    def test_transport_errors_are_reported(self):
        for error in (proxy.ProxyError("timeout", 504), proxy.ProxyError("tls-error", 502, "unable to get local issuer certificate")):
            self.transport.routes[CSFD_FILM] = error
            status, headers, _ = self.fetch(CSFD_FILM)
            self.assertEqual((status, headers["x-proxy-error"]), (error.status, error.code))
        self.assertEqual(headers["x-proxy-detail"], "unable to get local issuer certificate")

    def test_unexpected_error_does_not_leak_details(self):
        self.transport.routes[CSFD_FILM] = RuntimeError("secret " + COOKIE)
        status, headers, _ = self.fetch(CSFD_FILM)
        self.assertEqual((status, headers["x-proxy-error"]), (500, "internal-error"))

    def test_missing_or_duplicate_url_parameter(self):
        self.assertEqual(self.request("GET", "/fetch")[0], 400)
        self.assertEqual(self.request("GET", "/fetch?url=" + quote(UCET, safe="") + "&url=" + quote(UCET, safe=""))[0], 400)

    def test_disallowed_urls_never_reach_the_network(self):
        urls = (
            "http://sledujserialy.io/ucet/",
            "https://evil.example/ucet/",
            "https://sledujserialy.io.evil.example/ucet/",
            "https://evil.example/https://sledujserialy.io/ucet/",
            "https://sledujserialy.io@evil.example/ucet/",
            "https://sledujserialy.io:8443/ucet/",
            "https://sledujserialy.io/",
            "https://sledujserialy.io/account",
            "https://sledujserialy.io/ucet/../admin",
            "https://sledujserialy.io/serial/%2e%2e",
            "https://sledujserialy.io/serial/a/b",
            "https://www.csfd.cz/",
            "https://www.csfd.cz/film/abc",
            "https://www.csfd.cz/film/1/../../uzivatel",
            "https://myanimelist.net/profile/someone",
            "https://myanimelist.net/anime/abc",
            "https://serialy.sx/upload/a.jpg",
            "file:///C:/Windows/win.ini",
            "https://sledujserialy.io\\@evil.example/ucet/",
            "",
        )
        for url in urls:
            with self.subTest(url=url):
                status, headers, _ = self.fetch(url)
                self.assertIn(status, (400, 403))
                self.assertIn("x-proxy-error", headers)
        self.assertEqual(self.transport.calls, [])

    def test_allowed_urls(self):
        urls = (
            UCET,
            "https://sledujserialy.io:443/ucet/",
            "https://sledujserialy.io/serial/naruto-shippuden",
            CSFD_SEARCH,
            CSFD_FILM,
            "https://www.csfd.cz/film/1032664-naruto/prehled/",
            MAL_SEARCH,
            "https://myanimelist.net/anime/20",
            "https://myanimelist.net/anime/20/Naruto",
            "https://myanimelist.net/anime/1535/Death_Note_(2006)",
            "https://myanimelist.net/anime/1/Cowboy%20Bebop",
        )
        for url in urls:
            with self.subTest(url=url):
                proxy.check_url(url, proxy.FETCH_RULES)


class ImageTests(ProxyTestCase):
    def test_saves_image_atomically(self):
        self.transport.routes[IMAGE_URL] = (200, {}, JPEG)
        status, _, body = self.post_image({"url": IMAGE_URL, "number": 319})
        self.assertEqual(status, 201)
        self.assertEqual(json.loads(body), {"ok": True, "number": 319, "bytes": len(JPEG)})
        with open(os.path.join(self.images, "319.jpg"), "rb") as handle:
            self.assertEqual(handle.read(), JPEG)
        self.assertEqual(os.listdir(self.images), ["319.jpg"])
        self.assertNotIn("Cookie", self.transport.calls[0][1])

    def test_number_may_be_a_digit_string(self):
        self.transport.routes[IMAGE_URL] = (200, {}, JPEG)
        self.assertEqual(self.post_image({"url": IMAGE_URL, "number": "320"})[0], 201)
        self.assertTrue(os.path.exists(os.path.join(self.images, "320.jpg")))

    def test_existing_file_is_never_overwritten(self):
        os.makedirs(self.images)
        path = os.path.join(self.images, "319.jpg")
        with open(path, "wb") as handle:
            handle.write(b"original")
        status, headers, _ = self.post_image({"url": IMAGE_URL, "number": 319})
        self.assertEqual((status, headers["x-proxy-error"]), (409, "image-exists"))
        with open(path, "rb") as handle:
            self.assertEqual(handle.read(), b"original")
        self.assertEqual(self.transport.calls, [])

    def test_save_image_refuses_to_overwrite_even_when_checked_late(self):
        os.makedirs(self.images)
        with open(os.path.join(self.images, "5.jpg"), "wb") as handle:
            handle.write(b"original")
        with self.assertRaises(proxy.ProxyError) as caught:
            proxy.save_image(self.images, 5, JPEG)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(sorted(os.listdir(self.images)), ["5.jpg"])

    def test_non_image_is_rejected(self):
        self.transport.routes[IMAGE_URL] = (200, {}, b"<html>not an image</html>")
        status, headers, _ = self.post_image({"url": IMAGE_URL, "number": 319})
        self.assertEqual((status, headers["x-proxy-error"]), (502, "not-an-image"))
        self.assertFalse(os.path.exists(self.images) and os.listdir(self.images))

    def test_upstream_error_is_reported(self):
        self.transport.routes[IMAGE_URL] = (404, {}, b"nope")
        status, headers, _ = self.post_image({"url": IMAGE_URL, "number": 319})
        self.assertEqual((status, headers["x-proxy-error"], headers["x-proxy-detail"]), (502, "image-download-failed", "HTTP 404"))

    def test_redirect_of_blocked_download_is_reported(self):
        self.transport.routes[IMAGE_URL] = (307, {"location": "https://zscalernotification.abb.com/x"}, b"")
        status, headers, _ = self.post_image({"url": IMAGE_URL, "number": 319})
        self.assertEqual((status, headers["x-proxy-error"], headers["x-proxy-detail"]), (502, "redirect-blocked", "zscalernotification.abb.com"))

    def test_invalid_numbers_are_rejected(self):
        for number in (0, -1, 1.5, True, None, "abc", "", "1e3", 1000000, [319]):
            with self.subTest(number=number):
                status, headers, _ = self.post_image({"url": IMAGE_URL, "number": number})
                self.assertEqual((status, headers["x-proxy-error"]), (400, "bad-request"))
        self.assertEqual(self.post_image({"url": IMAGE_URL})[0], 400)
        self.assertEqual(self.transport.calls, [])

    def test_only_serialy_sx_may_be_downloaded(self):
        for url in ("https://evil.example/a.jpg", UCET, CSFD_FILM, "http://serialy.sx/a.jpg", "https://serialy.sx.evil.example/a.jpg", None, 5):
            with self.subTest(url=url):
                status, _, _ = self.post_image({"url": url, "number": 319})
                self.assertIn(status, (400, 403))
        self.assertEqual(self.transport.calls, [])

    def test_request_body_validation(self):
        self.assertEqual(self.post_image(b"{", headers={})[0], 400)
        self.assertEqual(self.post_image(b"[]")[0], 400)
        self.assertEqual(self.post_image(b"{}", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.post_image(b'{"url": "' + b"a" * (proxy.MAX_REQUEST_BODY + 1) + b'"}')[0], 413)

    def test_image_signatures(self):
        self.assertTrue(proxy.looks_like_image(JPEG))
        self.assertTrue(proxy.looks_like_image(b"\x89PNG\r\n\x1a\n" + b"0" * 8))
        self.assertTrue(proxy.looks_like_image(b"GIF89a" + b"0" * 8))
        self.assertTrue(proxy.looks_like_image(b"RIFF\x00\x00\x00\x00WEBPVP8 "))
        self.assertFalse(proxy.looks_like_image(b"<html>"))
        self.assertFalse(proxy.looks_like_image(b""))


class HeaderAndConfigTests(unittest.TestCase):
    def test_browser_clearance_is_only_for_sledujserialy(self):
        config = proxy.Config(cookie="abc", cf_clearance="clear", user_agent="Mozilla/5.0 test")
        headers = proxy.build_headers("sledujserialy.io", config)
        self.assertEqual(headers["Cookie"], "user_logged_in=abc; cf_clearance=clear")
        self.assertEqual(headers["User-Agent"], "Mozilla/5.0 test")
        for host in ("www.csfd.cz", "myanimelist.net", "serialy.sx"):
            other = proxy.build_headers(host, config)
            self.assertNotIn("Cookie", other)
            self.assertEqual(other["User-Agent"], "myApi")

    def test_no_cookie_header_without_configuration(self):
        self.assertNotIn("Cookie", proxy.build_headers("sledujserialy.io", proxy.Config()))

    def test_decode_body(self):
        text = "Příliš žluťoučký".encode("utf-8")
        self.assertEqual(proxy._decode_body(text, None, 1000), text)
        self.assertEqual(proxy._decode_body(gzip.compress(text), "gzip", 1000), text)
        self.assertEqual(proxy._decode_body(zlib.compress(text), "deflate", 1000), text)
        raw = zlib.compressobj(wbits=-zlib.MAX_WBITS)
        self.assertEqual(proxy._decode_body(raw.compress(text) + raw.flush(), "deflate", 1000), text)
        with self.assertRaises(proxy.ProxyError):
            proxy._decode_body(text, "br", 1000)
        with self.assertRaises(proxy.ProxyError):
            proxy._decode_body(b"not gzip", "gzip", 1000)
        with self.assertRaises(proxy.ProxyError) as caught:
            proxy._decode_body(gzip.compress(b"0" * 5000), "gzip", 1000)
        self.assertEqual(caught.exception.code, "too-large")

    def test_config_from_file_and_environment(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "local.json")
            self.assertEqual(proxy.load_config({}, path), proxy.Config())
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"sledujSerialyLoginCookie": "fromfile", "cfClearance": "cf", "userAgent": "UA 1"}, handle)
            self.assertEqual(proxy.load_config({}, path), proxy.Config("fromfile", "cf", "UA 1"))
            self.assertEqual(proxy.load_config({proxy.COOKIE_ENV: "fromenv"}, path).cookie, "fromenv")

    def test_invalid_config_is_rejected_without_echoing_values(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "local.json")
            for content in ("{", "[]"):
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(content)
                with self.assertRaises(proxy.ConfigError):
                    proxy.load_config({}, path)
        with self.assertRaises(proxy.ConfigError) as caught:
            proxy.load_config({proxy.COOKIE_ENV: "bad value;\r\nX: y"}, os.path.join(tempfile.gettempdir(), "missing-anime-proxy.json"))
        self.assertNotIn("bad value", str(caught.exception))


class ConfigReloadTests(ProxyTestCase):
    """Soubor s nastavením se po změně načte znovu bez restartu pomocníka."""

    def make_server(self):
        patcher = mock.patch.dict(os.environ)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop(proxy.COOKIE_ENV, None)
        quiet = mock.patch("builtins.print")
        quiet.start()
        self.addCleanup(quiet.stop)
        self.config_path = os.path.join(self.tmp, "local.json")
        self.ticks = 0
        return proxy.ProxyServer(0, proxy.DEFAULT_ORIGINS, self.images, proxy.Config(), self.transport,
                                 config_path=self.config_path)

    def write_config(self, content):
        with open(self.config_path, "w", encoding="utf-8") as handle:
            handle.write(content if isinstance(content, str) else json.dumps(content))
        # Každý zápis dostane jiný čas změny, ať test nezávisí na přesnosti hodin souborového systému.
        self.ticks += 1
        os.utime(self.config_path, ns=(self.ticks * 10 ** 9, self.ticks * 10 ** 9))

    def fetch_headers(self):
        self.transport.routes[UCET] = self.ok_page()
        self.assertEqual(self.fetch(UCET)[0], 200)
        return self.transport.calls[-1][1]

    def test_changes_apply_without_restart(self):
        self.assertFalse(json.loads(self.request("GET", "/health")[2])["cookieConfigured"])
        self.assertNotIn("Cookie", self.fetch_headers())

        self.write_config({"sledujSerialyLoginCookie": "new-login"})
        self.assertTrue(json.loads(self.request("GET", "/health")[2])["cookieConfigured"])
        self.assertEqual(self.fetch_headers()["Cookie"], "user_logged_in=new-login")

        self.write_config({"sledujSerialyLoginCookie": "new-login", "cfClearance": "clearance-1", "userAgent": "Browser 1"})
        headers = self.fetch_headers()
        self.assertEqual(headers["Cookie"], "user_logged_in=new-login; cf_clearance=clearance-1")
        self.assertEqual(headers["User-Agent"], "Browser 1")

    def test_unchanged_file_is_not_read_again(self):
        self.write_config({"sledujSerialyLoginCookie": "abc"})
        with mock.patch.object(proxy, "load_config", wraps=proxy.load_config) as load:
            first = self.server.config
            self.assertIs(self.server.config, first)
            self.assertIs(self.server.config, first)
        self.assertEqual(load.call_count, 1)

    def test_invalid_change_keeps_previous_settings_and_is_not_retried(self):
        self.write_config({"sledujSerialyLoginCookie": "good"})
        good = self.server.config
        self.write_config("{")
        with mock.patch.object(proxy, "load_config", wraps=proxy.load_config) as load:
            with mock.patch("builtins.print") as printed:
                self.assertIs(self.server.config, good)
                self.assertIs(self.server.config, good)
        self.assertEqual(load.call_count, 1)
        self.assertIn("Zůstává původní nastavení", printed.call_args[0][0])

        self.write_config({"sledujSerialyLoginCookie": "fixed"})
        self.assertEqual(self.server.config.cookie, "fixed")

    def test_removed_file_resets_to_environment_only(self):
        self.write_config({"sledujSerialyLoginCookie": "abc", "cfClearance": "cf"})
        self.assertEqual(self.server.config.cf_clearance, "cf")
        os.remove(self.config_path)
        self.assertEqual(self.server.config, proxy.Config())

    def test_server_without_config_path_never_reloads(self):
        server = proxy.ProxyServer(0, proxy.DEFAULT_ORIGINS, self.images, proxy.Config(cookie="fixed"))
        self.addCleanup(server.server_close)
        with mock.patch.object(proxy, "load_config") as load:
            self.assertEqual(server.config.cookie, "fixed")
        load.assert_not_called()


class DataFileTests(ProxyTestCase):
    """POST /csfd-ratings zapisuje ČSFD hodnocení do souboru s daty."""

    ITEMS = {
        "1": {"Number": "1", "FavoriteName": "Naruto Šippúden", "NameJa": "ナルト", "CsfdRating": "80%", "MalRating": "82%"},
        "2": {"Number": "2", "FavoriteName": "Bleach", "NameJa": "ブリーチ", "CsfdRating": "?%", "MalRating": "79%"},
    }

    def make_server(self):
        quiet = mock.patch("builtins.print")
        quiet.start()
        self.addCleanup(quiet.stop)
        self.data_path = os.path.join(self.tmp, "anime.json")
        self.write_data(self.dumps(self.ITEMS).encode("utf-8"))
        return proxy.ProxyServer(0, proxy.DEFAULT_ORIGINS, self.images, proxy.Config(cookie=COOKIE), self.transport,
                                 data_path=self.data_path)

    @staticmethod
    def dumps(data):
        return json.dumps(data, indent=4, ensure_ascii=False)

    def write_data(self, raw):
        with open(self.data_path, "wb") as handle:
            handle.write(raw)

    def read_data(self):
        with open(self.data_path, "rb") as handle:
            return handle.read()

    def post_ratings(self, payload, **kwargs):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        headers.update(kwargs.pop("headers", {}))
        return self.request("POST", "/csfd-ratings", headers=headers, body=body, **kwargs)

    def test_health_reports_data_file(self):
        self.assertTrue(json.loads(self.request("GET", "/health")[2])["dataFile"])
        os.remove(self.data_path)
        self.assertFalse(json.loads(self.request("GET", "/health")[2])["dataFile"])

    def test_writes_only_ratings_in_python_format(self):
        status, _, body = self.post_ratings({"ratings": {"1": "85%", "2": "?%"}})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"ok": True, "changed": 1, "missing": []})
        expected = json.loads(json.dumps(self.ITEMS))
        expected["1"]["CsfdRating"] = "85%"
        self.assertEqual(self.read_data(), self.dumps(expected).encode("utf-8"))
        self.assertEqual(os.listdir(self.tmp), ["anime.json"])
        self.assertEqual(self.transport.calls, [])

    def test_unknown_numbers_are_reported_and_not_added(self):
        status, _, body = self.post_ratings({"ratings": {"2": "75%", "99": "60%"}})
        self.assertEqual((status, json.loads(body)), (200, {"ok": True, "changed": 1, "missing": ["99"]}))
        data = json.loads(self.read_data())
        self.assertEqual(sorted(data), ["1", "2"])
        self.assertEqual(data["2"]["CsfdRating"], "75%")

    def test_unchanged_ratings_do_not_touch_the_file(self):
        os.utime(self.data_path, ns=(10 ** 9, 10 ** 9))
        status, _, body = self.post_ratings({"ratings": {"1": "80%", "2": "?%"}})
        self.assertEqual((status, json.loads(body)), (200, {"ok": True, "changed": 0, "missing": []}))
        self.assertEqual(os.stat(self.data_path).st_mtime_ns, 10 ** 9)

    def test_keeps_bom_line_endings_and_final_newline(self):
        original = (self.dumps(self.ITEMS).replace("\n", "\r\n") + "\r\n").encode("utf-8")
        self.write_data(b"\xef\xbb\xbf" + original)
        self.assertEqual(self.post_ratings({"ratings": {"1": "81%"}})[0], 200)
        raw = self.read_data()
        self.assertEqual(raw, b"\xef\xbb\xbf" + original.replace(b'"80%"', b'"81%"'))

    def test_invalid_ratings_are_rejected_without_writing(self):
        before = self.read_data()
        for ratings in ([], "85%", {"1": 85}, {"1": "85"}, {"1": "1000%"}, {"1": ""}, {"1": None},
                        {"x": "85%"}, {"": "85%"}, {"1234567": "85%"}, {"1": "85% "}, {"1": "%"}):
            with self.subTest(ratings=ratings):
                status, headers, _ = self.post_ratings({"ratings": ratings})
                self.assertEqual((status, headers["x-proxy-error"]), (400, "bad-request"))
        self.assertEqual(self.post_ratings({})[0], 400)
        self.assertEqual(self.post_ratings(b"{", headers={})[0], 400)
        self.assertEqual(self.post_ratings(b"{}", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.post_ratings(b'{"ratings": "' + b"a" * proxy.MAX_RATINGS_BODY + b'"}')[0], 413)
        too_many = {str(number): "50%" for number in range(1, proxy.MAX_RATINGS + 2)}
        self.assertEqual(self.post_ratings({"ratings": too_many})[0], 400)
        self.assertEqual(self.read_data(), before)

    def test_large_but_valid_request_is_accepted(self):
        ratings = {str(number): "50%" for number in range(1, 3001)}
        status, _, body = self.post_ratings({"ratings": ratings})
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(body)["missing"]), 2998)

    def test_missing_or_invalid_data_file(self):
        os.remove(self.data_path)
        status, headers, _ = self.post_ratings({"ratings": {"1": "81%"}})
        self.assertEqual((status, headers["x-proxy-error"]), (500, "data-file-missing"))
        self.assertFalse(os.path.exists(self.data_path))
        for raw in (b"{", b"[]", b"\xff\xfe"):
            with self.subTest(raw=raw):
                self.write_data(raw)
                status, headers, _ = self.post_ratings({"ratings": {"1": "81%"}})
                self.assertEqual((status, headers["x-proxy-error"]), (500, "data-file-invalid"))
                self.assertEqual(self.read_data(), raw)

    def test_failed_write_keeps_original_file(self):
        before = self.read_data()
        with mock.patch.object(proxy.os, "replace", side_effect=PermissionError("locked")), \
                mock.patch.object(proxy.time, "sleep"):
            status, headers, _ = self.post_ratings({"ratings": {"1": "81%"}})
        self.assertEqual((status, headers["x-proxy-error"], headers["x-proxy-detail"]), (500, "data-write-failed", "PermissionError"))
        self.assertEqual(self.read_data(), before)
        self.assertEqual(os.listdir(self.tmp), ["anime.json"])

    def test_server_without_data_file(self):
        self.server.data_path = None
        self.assertFalse(json.loads(self.request("GET", "/health")[2])["dataFile"])
        status, headers, _ = self.post_ratings({"ratings": {"1": "81%"}})
        self.assertEqual((status, headers["x-proxy-error"]), (500, "data-file-missing"))

    def test_default_data_file_is_the_site_data(self):
        self.assertEqual(proxy.DEFAULT_DATA_FILE, os.path.join(os.path.dirname(proxy.HERE), "data", "anime.json"))


class CheckTests(unittest.TestCase):
    def run_check(self, routes, config=proxy.Config(cookie=COOKIE)):
        transport = FakeTransport()
        transport.routes = routes
        lines = []
        ok = proxy.run_check(config, transport, lines.append)
        text = "\n".join(lines)
        self.assertNotIn(COOKIE, text)
        return ok, text

    def routes(self, **overrides):
        routes = {
            UCET: (200, {}, b'<div id="favorites">'),
            "https://www.csfd.cz/hledat/?q=naruto": (200, {}, b""),
            "https://myanimelist.net/anime.php?cat=anime&q=naruto": (200, {}, b""),
            "https://serialy.sx/": (200, {}, b""),
        }
        routes.update(overrides)
        return routes

    def test_all_sources_ok(self):
        ok, text = self.run_check(self.routes())
        self.assertTrue(ok)
        self.assertIn("přihlášení funguje", text)

    def test_reports_cloudflare_and_firewall(self):
        ok, text = self.run_check(self.routes(**{
            UCET: (403, {"cf-mitigated": "challenge"}, b""),
            "https://serialy.sx/": (307, {"location": "https://zscalernotification.abb.com/x"}, b""),
        }))
        self.assertFalse(ok)
        self.assertIn("Cloudflare", text)
        self.assertIn("zscalernotification.abb.com", text)

    def test_reports_missing_login(self):
        ok, text = self.run_check(self.routes(**{UCET: (200, {}, b"<html>prihlaseni</html>")}), proxy.Config())
        self.assertFalse(ok)
        self.assertIn("CHYBÍ", text)
        self.assertIn("chybí sekce oblíbených", text)


if __name__ == "__main__":
    unittest.main()
