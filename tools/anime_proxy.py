#!/usr/bin/env python3
r"""Lokální pomocník pro stránku anime.html (Aktualizovat -> Seznam, ČSFD a MAL hodnocení, Zhlédnuté epizody).

Stránka běžící na GitHub Pages si sama nemůže stáhnout sledujserialy.io, ČSFD ani
MyAnimeList (CORS, přihlašovací cookie) a nemůže zapisovat soubory. Tento malý
server proto běží na vašem počítači (jen na 127.0.0.1) a umí:

  GET  /health          stav pomocníka (bez tajemství)
  GET  /fetch?url=...   stáhne stránku z povoleného webu; cookie se přidává jen
                        pro sledujserialy.io
  POST /images          {"url": "https://serialy.sx/...", "number": 319}
                        stáhne obrázek a uloží ho jako img/anime/319.jpg
  POST /csfd-ratings    {"ratings": {"1": "77%", ...}}
                        zapíše ČSFD hodnocení do data/anime.json (mění jen
                        CsfdRating, formát jako Python WriteDataToTheFile())
  POST /mal-ratings     totéž pro MAL hodnocení (mění jen MalRating)
  POST /watched-states  {"states": {"1": "DONE", "2": "S01E05", ...}}
                        zapíše zhlédnuté epizody (mění jen State)

Spuštění:      python tools\anime_proxy.py
Diagnostika:   python tools\anime_proxy.py --check

Přihlašovací cookie (hodnota "user_logged_in" ze sledujserialy.io) se čte z
proměnné prostředí SLEDUJ_SERIALY_LOGIN_COOKIE nebo ze souboru
tools/anime_proxy.local.json (je v .gitignore):

  {"sledujSerialyLoginCookie": "...", "cfClearance": "", "userAgent": ""}

"cfClearance" a "userAgent" jsou nepovinné - pro případ, že sledujserialy.io
vyžaduje ověření Cloudflare (viz README). Změna souboru se projeví hned, bez
restartu pomocníka. Cookie se nikdy nevypisuje, neloguje ani neposílá nikam jinam
než na sledujserialy.io.

Používá se jen standardní knihovna Pythonu (TLS ověřuje přes systémové
certifikáty, takže funguje i za firemním proxy s vlastní certifikační autoritou).
"""

import argparse
import codecs
import dataclasses
import http.client
import json
import os
import re
import socket
import ssl
import sys
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urljoin, urlsplit

# Verze 2 přidala POST /csfd-ratings, verze 3 POST /mal-ratings, verze 4 POST /watched-states;
# stránka starší pomocník odmítne.
VERSION = 4
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_IMAGES_DIR = os.path.join(os.path.dirname(HERE), "img", "anime")
DEFAULT_DATA_FILE = os.path.join(os.path.dirname(HERE), "data", "anime.json")
LOCAL_CONFIG_PATH = os.path.join(HERE, "anime_proxy.local.json")

DEFAULT_PORT = 8787
DEFAULT_ORIGINS = (
    "https://michal-vavrik.github.io",
    "http://127.0.0.1:8765",
    "http://localhost:8765",
)
REQUEST_HEADER = "X-Anime-Proxy"
COOKIE_ENV = "SLEDUJ_SERIALY_LOGIN_COOKIE"
COOKIE_HOST = "sledujserialy.io"
# Stejné hlavičky jako AnimeList.pyw (requests.get(..., headers={'User-agent': 'myApi'})).
USER_AGENT = "myApi"

TIMEOUT = 20
MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
MAX_REQUEST_BODY = 4096
MAX_DATA_BODY = 256 * 1024
# Odmítnuté tělo požadavku do této velikosti se před odpovědí dočte (viz Handler._discard_body).
MAX_DISCARD_BODY = 1024 * 1024
MAX_DATA_VALUES = 10000
MAX_IMAGE_NUMBER = 999999
# Hodnocení jako v data/anime.json: "85%", nebo "?%" bez hodnocení.
RATING = re.compile(r"(?:[0-9]{1,3}|\?)%")
# Stav jako ho zapisuje Python UpdateWatched(): "DONE", "S01E05", nebo "S02E--" (řada bez epizody).
WATCHED_STATE = re.compile(r"DONE|S[0-9]{1,6}E(?:[0-9]{1,6}|--)")
# Zápis do data/anime.json: adresa -> (pole v datech, klíč v těle požadavku, povolené hodnoty, název do výpisu).
DATA_ROUTES = {
    "/csfd-ratings": ("CsfdRating", "ratings", RATING, "ČSFD hodnocení"),
    "/mal-ratings": ("MalRating", "ratings", RATING, "MAL hodnocení"),
    "/watched-states": ("State", "states", WATCHED_STATE, "Zhlédnuté epizody"),
}
REDIRECT_STATUSES = (301, 302, 303, 307, 308)
EXPOSED_HEADERS = "X-Upstream-Status, X-Final-Url, X-Proxy-Error, X-Proxy-Detail"
TARGET_SAFE = "/%+:;,@$!*'()~-._"

# Povolené weby a cesty pro /fetch (kontroluje se i každé přesměrování).
FETCH_RULES = {
    "sledujserialy.io": re.compile(r"^/(?:ucet/|serial/[A-Za-z0-9_.%-]+/?)$"),
    "www.csfd.cz": re.compile(r"^/(?:hledat/?|film/[0-9]+[A-Za-z0-9_/-]*)$"),
    "myanimelist.net": re.compile(r"^/(?:anime\.php|anime/[0-9]+(?:/[^/?#]*)?)$"),
}
# Obrázky se stahují jen ze serialy.sx.
IMAGE_RULES = {"serialy.sx": re.compile(r"^/[^?#]*$")}


class ProxyError(Exception):
    """Chyba, kterou pomocník vrací stránce (kód v X-Proxy-Error)."""

    def __init__(self, code, status=502, detail=""):
        super().__init__(code)
        self.code = code
        self.status = status
        self.detail = detail


class ConfigError(Exception):
    pass


@dataclasses.dataclass(frozen=True)
class Config:
    cookie: str = ""
    cf_clearance: str = ""
    user_agent: str = ""


_COOKIE_VALUE = re.compile(r"^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$")
_USER_AGENT_VALUE = re.compile(r"^[\x20-\x7e]{1,200}$")


def load_config(env=None, path=LOCAL_CONFIG_PATH):
    env = os.environ if env is None else env
    data = {}
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        pass
    except (OSError, ValueError) as error:
        raise ConfigError("Soubor %s nelze načíst (%s)." % (path, type(error).__name__))
    if not isinstance(data, dict):
        raise ConfigError("Soubor %s musí obsahovat JSON objekt." % path)

    cookie = str(env.get(COOKIE_ENV) or data.get("sledujSerialyLoginCookie") or "").strip()
    cf_clearance = str(data.get("cfClearance") or "").strip()
    user_agent = str(data.get("userAgent") or "").strip()
    # Hodnoty se vkládají do hlaviček - nic jiného než bezpečné znaky nepustíme.
    if cookie and not _COOKIE_VALUE.match(cookie):
        raise ConfigError("Cookie sledujserialy.io obsahuje nepovolené znaky.")
    if cf_clearance and not _COOKIE_VALUE.match(cf_clearance):
        raise ConfigError("Hodnota cfClearance obsahuje nepovolené znaky.")
    if user_agent and not _USER_AGENT_VALUE.match(user_agent):
        raise ConfigError("Hodnota userAgent obsahuje nepovolené znaky.")
    return Config(cookie, cf_clearance, user_agent)


def _file_stamp(path):
    """Otisk souboru (čas změny, velikost); None, když soubor neexistuje."""
    try:
        info = os.stat(path)
    except OSError:
        return None
    return (info.st_mtime_ns, info.st_size)


def check_url(url, rules):
    """Ověří, že URL míří na povolený web a cestu; vrací rozebranou URL."""
    if not isinstance(url, str) or len(url) > 2048 or re.search(r"[\x00-\x20\x7f\\]", url):
        raise ProxyError("bad-url", 400)
    parts = urlsplit(url)
    try:
        port = parts.port
    except ValueError:
        raise ProxyError("bad-url", 400)
    if parts.scheme != "https" or parts.username is not None or parts.password is not None or port not in (None, 443):
        raise ProxyError("url-not-allowed", 403)
    host = parts.hostname or ""
    rule = rules.get(host)
    if rule is None:
        raise ProxyError("host-not-allowed", 403, host)
    if any(unquote(segment) in (".", "..") for segment in parts.path.split("/")) or not rule.match(parts.path):
        raise ProxyError("path-not-allowed", 403)
    return parts


def build_headers(host, config):
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "close",
    }
    # Cookie a případný User-Agent z prohlížeče jsou jen pro sledujserialy.io.
    if host == COOKIE_HOST:
        cookies = []
        if config.cookie:
            cookies.append("user_logged_in=" + config.cookie)
        if config.cf_clearance:
            cookies.append("cf_clearance=" + config.cf_clearance)
        if cookies:
            headers["Cookie"] = "; ".join(cookies)
        if config.user_agent:
            headers["User-Agent"] = config.user_agent
    return headers


_ssl_context = None


def _get_ssl_context():
    global _ssl_context
    if _ssl_context is None:
        _ssl_context = ssl.create_default_context()
    return _ssl_context


def _decode_body(raw, encoding, max_bytes):
    name = (encoding or "identity").strip().lower()
    if name in ("", "identity"):
        return raw
    if name in ("gzip", "x-gzip"):
        window_sizes = (zlib.MAX_WBITS | 16,)
    elif name == "deflate":
        window_sizes = (zlib.MAX_WBITS, -zlib.MAX_WBITS)
    else:
        raise ProxyError("unsupported-encoding", 502, name[:20])
    for window_size in window_sizes:
        try:
            data = zlib.decompressobj(window_size).decompress(raw, max_bytes + 1)
        except zlib.error:
            continue
        if len(data) > max_bytes:
            raise ProxyError("too-large", 502)
        return data
    raise ProxyError("bad-encoding", 502, name[:20])


def http_get_once(url, headers, timeout=TIMEOUT, max_bytes=MAX_BYTES):
    """Jedno GET bez sledování přesměrování -> (status, hlavičky malými písmeny, tělo)."""
    parts = urlsplit(url)
    target = quote(parts.path or "/", safe=TARGET_SAFE)
    if parts.query:
        target += "?" + quote(parts.query, safe=TARGET_SAFE + "?&=")
    connection = http.client.HTTPSConnection(parts.hostname, 443, timeout=timeout, context=_get_ssl_context())
    try:
        connection.request("GET", target, headers=headers)
        response = connection.getresponse()
        raw = response.read(max_bytes + 1)
        if len(raw) > max_bytes:
            raise ProxyError("too-large", 502)
        response_headers = {name.lower(): value for name, value in response.getheaders()}
        body = _decode_body(raw, response_headers.get("content-encoding"), max_bytes)
        return response.status, response_headers, body
    except ProxyError:
        raise
    except ssl.SSLCertVerificationError as error:
        raise ProxyError("tls-error", 502, str(error.verify_message))
    except (socket.timeout, TimeoutError):
        raise ProxyError("timeout", 504)
    except (OSError, http.client.HTTPException) as error:
        raise ProxyError("network-error", 502, type(error).__name__)
    finally:
        connection.close()


def is_challenge(status, headers, body):
    """Cloudflare místo stránky vrací ověřovací výzvu, kterou skript ani pomocník nesplní."""
    if headers.get("cf-mitigated", "").lower() == "challenge":
        return True
    return (
        status in (403, 429, 503)
        and "cloudflare" in headers.get("server", "").lower()
        and (b"Just a moment" in body or b"challenge-platform" in body)
    )


def fetch_page(url, config, rules=FETCH_RULES, transport=http_get_once):
    """Stáhne stránku jako requests.get() ve skriptu; přesměrování sleduje ručně,
    aby se každý krok ověřil proti povoleným webům (a cookie nikdy neodešla jinam)."""
    current = url
    for hop in range(MAX_REDIRECTS + 1):
        try:
            parts = check_url(current, rules)
        except ProxyError as error:
            if hop == 0:
                raise
            raise ProxyError("redirect-blocked", 502, error.detail or error.code)
        status, headers, body = transport(current, build_headers(parts.hostname, config), TIMEOUT, MAX_BYTES)
        if is_challenge(status, headers, body):
            raise ProxyError("cloudflare-challenge", 502)
        location = headers.get("location")
        if status in REDIRECT_STATUSES and location:
            current = urljoin(current, location)
            continue
        return status, current, body
    raise ProxyError("too-many-redirects", 502)


def looks_like_image(data):
    return (
        data.startswith(b"\xff\xd8\xff")
        or data.startswith(b"\x89PNG\r\n\x1a\n")
        or data[:6] in (b"GIF87a", b"GIF89a")
        or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


def download_image(url, transport=http_get_once):
    status, _final_url, body = fetch_page(url, Config(), IMAGE_RULES, transport)
    if status != 200:
        raise ProxyError("image-download-failed", 502, "HTTP %d" % status)
    if not looks_like_image(body):
        raise ProxyError("not-an-image", 502)
    return body


def image_path(images_dir, number):
    return os.path.join(images_dir, "%d.jpg" % number)


def max_image_number(images_dir):
    highest = 0
    try:
        for name in os.listdir(images_dir):
            match = re.fullmatch(r"([0-9]{1,9})\.jpg", name)
            if match:
                highest = max(highest, int(match.group(1)))
    except OSError:
        pass
    return highest


_image_lock = threading.Lock()


def save_image(images_dir, number, data):
    """Zapíše obrázek přes dočasný soubor; existující soubor nikdy nepřepíše."""
    final = image_path(images_dir, number)
    temporary = "%s.%d.tmp" % (final, os.getpid())
    try:
        os.makedirs(images_dir, exist_ok=True)
        with _image_lock:
            if os.path.exists(final):
                raise ProxyError("image-exists", 409)
            with open(temporary, "wb") as handle:
                handle.write(data)
            os.replace(temporary, final)
    except OSError as error:
        raise ProxyError("write-failed", 500, type(error).__name__)
    finally:
        try:
            os.remove(temporary)
        except OSError:
            pass
    return final


_data_lock = threading.Lock()


def _replace_file(path, data):
    """Zapíše soubor přes dočasný soubor, aby nikdy nezůstal napůl zapsaný."""
    temporary = "%s.%d.tmp" % (path, os.getpid())
    try:
        with open(temporary, "wb") as handle:
            handle.write(data)
        for attempt in range(5):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                # Na Windows může soubor chvíli držet otevřený jiný program (např. server stránky).
                if attempt == 4:
                    raise
                time.sleep(0.2)
    except OSError as error:
        raise ProxyError("data-write-failed", 500, type(error).__name__)
    finally:
        try:
            os.remove(temporary)
        except OSError:
            pass


def update_field(path, field, values):
    """Přepíše jedno pole anime v souboru s daty (Python UpdateCSFD()/UpdateMAL()/UpdateWatched()
    + WriteDataToTheFile()).

    `field` je "CsfdRating", "MalRating" nebo "State", `values` mapuje Number na novou hodnotu.
    Soubor se zapíše jako `json.dump(..., indent=4, ensure_ascii=False)` se
    zachovanými konci řádků, takže se v diffu ukážou jen změněné hodnoty; beze
    změny se nezapisuje. Vrací (počet změněných hodnot, čísla anime, která
    v souboru nejsou).
    """
    with _data_lock:
        try:
            with open(path, "rb") as handle:
                raw = handle.read()
        except FileNotFoundError:
            raise ProxyError("data-file-missing", 500)
        except OSError as error:
            raise ProxyError("data-read-failed", 500, type(error).__name__)
        try:
            text = raw.decode("utf-8-sig")
            data = json.loads(text)
        except ValueError:
            raise ProxyError("data-file-invalid", 500)
        if not isinstance(data, dict):
            raise ProxyError("data-file-invalid", 500)

        changed = 0
        missing = []
        for number, value in values.items():
            item = data.get(number)
            if not isinstance(item, dict):
                missing.append(number)
            elif item.get(field) != value:
                item[field] = value
                changed += 1

        if changed:
            output = json.dumps(data, indent=4, ensure_ascii=False)
            line_end = "\r\n" if "\r\n" in text else "\n"
            output = output.replace("\n", line_end)
            if text.endswith("\n"):
                output += line_end
            bom = codecs.BOM_UTF8 if raw.startswith(codecs.BOM_UTF8) else b""
            _replace_file(path, bom + output.encode("utf-8"))
        return changed, missing


def _clean_detail(detail):
    return re.sub(r"[^A-Za-z0-9._:/ -]", "?", str(detail or ""))[:120]


class Handler(BaseHTTPRequestHandler):
    server_version = "AnimeProxy/%d" % VERSION
    sys_version = ""

    def log_request(self, code="-", size="-"):
        # Bez query stringu - ten obsahuje hledané názvy.
        sys.stderr.write("%s %s -> %s\n" % (self.command, urlsplit(self.path).path, code))

    def _guard(self, preflight=False):
        # Host musí být loopback (ochrana proti DNS rebinding), Origin jen z povolených stránek.
        if (self.headers.get("Host") or "").lower() not in self.server.allowed_hosts:
            raise ProxyError("host-not-allowed", 403)
        origin = self.headers.get("Origin")
        if origin is not None and origin not in self.server.allowed_origins:
            raise ProxyError("origin-not-allowed", 403)
        if preflight:
            if origin is None:
                raise ProxyError("origin-not-allowed", 403)
        elif self.headers.get(REQUEST_HEADER) is None:
            raise ProxyError("missing-header", 403)

    def _send(self, status, body=b"", content_type="application/json; charset=utf-8", extra=None):
        self.send_response(status)
        if status != 204:
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self.headers.get("Origin")
        if origin is not None and origin in self.server.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Expose-Headers", EXPOSED_HEADERS)
            self.send_header("Vary", "Origin")
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if status != 204:
            self.wfile.write(body)

    def _send_json(self, status, payload):
        self._send(status, json.dumps(payload).encode("utf-8"))

    def _send_error(self, error):
        detail = _clean_detail(error.detail)
        extra = {"X-Proxy-Error": error.code}
        if detail:
            extra["X-Proxy-Detail"] = detail
        self._send(error.status, json.dumps({"error": error.code, "detail": detail}).encode("utf-8"), extra=extra)

    def _discard_body(self):
        # Zavření spojení s nepřečtenými daty pošle (hlavně na Windows) RST a klient
        # pak místo chybové odpovědi dostane přerušené spojení.
        if self._body_read:
            return
        self._body_read = True
        try:
            remaining = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            return
        if not 0 < remaining <= MAX_DISCARD_BODY:
            return
        try:
            self.connection.settimeout(5)
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 65536))
                if not chunk:
                    break
                remaining -= len(chunk)
        except OSError:
            pass

    def _handle(self, routes):
        self._body_read = False
        try:
            self._guard()
            parts = urlsplit(self.path)
            route = routes.get(parts.path)
            if route is None:
                known = parts.path in ("/health", "/fetch", "/images") or parts.path in DATA_ROUTES
                raise ProxyError("method-not-allowed" if known else "not-found", 405 if known else 404)
            route(parts)
        except ProxyError as error:
            self._discard_body()
            self._send_error(error)
        except Exception:
            # Žádné podrobnosti ven - mohly by obsahovat hlavičky s cookie.
            self._discard_body()
            self._send_error(ProxyError("internal-error", 500))

    def do_GET(self):
        self._handle({"/health": self._health, "/fetch": self._fetch})

    def do_POST(self):
        routes = {"/images": self._images}
        routes.update(dict.fromkeys(DATA_ROUTES, self._data_values))
        self._handle(routes)

    def do_OPTIONS(self):
        try:
            self._guard(preflight=True)
            extra = {
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, " + REQUEST_HEADER,
                "Access-Control-Max-Age": "600",
            }
            if (self.headers.get("Access-Control-Request-Private-Network") or "").lower() == "true":
                extra["Access-Control-Allow-Private-Network"] = "true"
            self._send(204, extra=extra)
        except ProxyError as error:
            self._send_error(error)

    def _health(self, _parts):
        self._send_json(200, {
            "ok": True,
            "version": VERSION,
            "cookieConfigured": bool(self.server.config.cookie),
            "maxImageNumber": max_image_number(self.server.images_dir),
            "dataFile": bool(self.server.data_path) and os.path.isfile(self.server.data_path),
        })

    def _fetch(self, parts):
        values = parse_qs(parts.query, keep_blank_values=True).get("url", [])
        if len(values) != 1:
            raise ProxyError("bad-request", 400, "url")
        status, final_url, body = fetch_page(values[0], self.server.config, FETCH_RULES, self.server.transport)
        try:
            body.decode("utf-8")
        except UnicodeDecodeError:
            raise ProxyError("invalid-encoding", 502)
        self._send(200, body, "text/plain; charset=utf-8", {
            "X-Upstream-Status": str(status),
            "X-Final-Url": quote(final_url, safe=TARGET_SAFE + "?&=#"),
        })

    def _read_json_body(self, limit):
        if not (self.headers.get("Content-Type") or "").lower().startswith("application/json"):
            raise ProxyError("bad-request", 415, "content-type")
        try:
            length = int(self.headers.get("Content-Length") or "")
        except ValueError:
            raise ProxyError("bad-request", 411, "length")
        if not 0 < length <= limit:
            raise ProxyError("bad-request", 413, "length")
        self._body_read = True
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ProxyError("bad-request", 400, "json")
        if not isinstance(payload, dict):
            raise ProxyError("bad-request", 400, "json")
        return payload

    def _images(self, _parts):
        payload = self._read_json_body(MAX_REQUEST_BODY)

        number = payload.get("number")
        if isinstance(number, str) and re.fullmatch(r"[0-9]{1,6}", number):
            number = int(number)
        if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= MAX_IMAGE_NUMBER:
            raise ProxyError("bad-request", 400, "number")
        if os.path.exists(image_path(self.server.images_dir, number)):
            raise ProxyError("image-exists", 409)

        data = download_image(payload.get("url"), self.server.transport)
        save_image(self.server.images_dir, number, data)
        self._send_json(201, {"ok": True, "number": number, "bytes": len(data)})

    def _data_values(self, parts):
        field, key, allowed, label = DATA_ROUTES[parts.path]
        values = self._read_json_body(MAX_DATA_BODY).get(key)
        if not isinstance(values, dict) or len(values) > MAX_DATA_VALUES:
            raise ProxyError("bad-request", 400, key)
        for number, value in values.items():
            if not re.fullmatch(r"[0-9]{1,6}", number) or not isinstance(value, str) or not allowed.fullmatch(value):
                raise ProxyError("bad-request", 400, "value")
        if not self.server.data_path:
            raise ProxyError("data-file-missing", 500)
        changed, missing = update_field(self.server.data_path, field, values)
        print("%s: zápis do %s (změněno %d)" % (label, self.server.data_path, changed), file=sys.stderr)
        self._send_json(200, {"ok": True, "changed": changed, "missing": missing})


class ProxyServer(ThreadingHTTPServer):
    daemon_threads = True
    # Na Windows by SO_REUSEADDR dovolil spustit druhý pomocník na stejném portu.
    allow_reuse_address = os.name != "nt"

    def __init__(self, port, origins, images_dir, config, transport=http_get_once, config_path=None, data_path=None):
        super().__init__(("127.0.0.1", port), Handler)
        self.allowed_origins = frozenset(origins)
        self.images_dir = images_dir
        self.data_path = data_path
        self.transport = transport
        self._config = config
        self._config_path = config_path
        self._config_stamp = _file_stamp(config_path) if config_path else None
        self._config_lock = threading.Lock()
        bound_port = self.server_address[1]
        self.allowed_hosts = frozenset(("127.0.0.1:%d" % bound_port, "localhost:%d" % bound_port))

    @property
    def config(self):
        """Aktuální nastavení. Povolení Cloudflare vyprší za pár desítek minut, proto
        se soubor s nastavením po změně načte znovu a pomocník nemusí běžet od začátku."""
        if self._config_path is None:
            return self._config
        with self._config_lock:
            stamp = _file_stamp(self._config_path)
            if stamp != self._config_stamp:
                self._config_stamp = stamp
                try:
                    self._config = load_config(path=self._config_path)
                    print("Nastavení znovu načteno z %s" % self._config_path, file=sys.stderr)
                except ConfigError as error:
                    print("%s Zůstává původní nastavení." % error, file=sys.stderr)
            return self._config

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def run_check(config, transport=http_get_once, out=print):
    """Zkusí dosáhnout každého zdroje stejnou cestou jako /fetch; bez tajemství ve výpisu."""
    targets = (
        ("sledujserialy.io", "https://sledujserialy.io/ucet/", FETCH_RULES),
        ("www.csfd.cz", "https://www.csfd.cz/hledat/?q=naruto", FETCH_RULES),
        ("myanimelist.net", "https://myanimelist.net/anime.php?cat=anime&q=naruto", FETCH_RULES),
        ("serialy.sx", "https://serialy.sx/", IMAGE_RULES),
    )
    out("Cookie sledujserialy.io: " + ("nastavena" if config.cookie else "CHYBÍ (viz README)"))
    all_ok = True
    for name, url, rules in targets:
        try:
            status, _final_url, body = fetch_page(url, config, rules, transport)
            if status >= 400:
                verdict, ok = "HTTP %d" % status, False
            elif name == "sledujserialy.io" and b'id="favorites"' not in body:
                verdict, ok = "stránka se načetla, ale chybí sekce oblíbených (cookie chybí nebo vypršela)", False
            elif name == "sledujserialy.io":
                verdict, ok = "OK, přihlášení funguje", True
            else:
                verdict, ok = "OK (HTTP %d)" % status, True
        except ProxyError as error:
            ok = False
            if error.code == "cloudflare-challenge":
                verdict = "Cloudflare vyžaduje ověření (výzva) - viz README, část o Cloudflare"
            elif error.code == "redirect-blocked":
                verdict = "přesměrováno na nepovolený web (%s) - pravděpodobně firemní filtr" % _clean_detail(error.detail)
            elif error.code == "tls-error":
                verdict = "chyba TLS certifikátu (%s)" % _clean_detail(error.detail)
            else:
                verdict = "chyba %s %s" % (error.code, _clean_detail(error.detail))
        all_ok = all_ok and ok
        out("%-18s %s" % (name, verdict))
    return all_ok


def _origin(value):
    if not re.fullmatch(r"https?://[^/\s*]+", value):
        raise argparse.ArgumentTypeError("očekávám originu ve tvaru https://example.com nebo http://127.0.0.1:8765")
    return value


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
        sys.stderr.reconfigure(errors="replace")
    parser = argparse.ArgumentParser(
        description="Lokální pomocník pro anime.html (Aktualizovat -> Seznam, ČSFD a MAL hodnocení, Zhlédnuté epizody).")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="port na 127.0.0.1 (výchozí %d)" % DEFAULT_PORT)
    parser.add_argument("--allow-origin", action="append", default=[], type=_origin, metavar="ORIGIN",
                        help="další povolená origin stránky (lze opakovat)")
    parser.add_argument("--images-dir", default=DEFAULT_IMAGES_DIR, help="složka pro obrázky (výchozí img/anime)")
    parser.add_argument("--data-file", default=DEFAULT_DATA_FILE,
                        help="soubor s daty pro ČSFD a MAL hodnocení a zhlédnuté epizody (výchozí data/anime.json)")
    parser.add_argument("--check", action="store_true", help="ověří dostupnost zdrojů a skončí")
    args = parser.parse_args(argv)

    try:
        config = load_config()
    except ConfigError as error:
        parser.exit(2, "%s\n" % error)

    if args.check:
        return 0 if run_check(config) else 1

    try:
        server = ProxyServer(args.port, DEFAULT_ORIGINS + tuple(args.allow_origin), args.images_dir, config,
                             config_path=LOCAL_CONFIG_PATH, data_path=args.data_file)
    except OSError as error:
        parser.exit(2, "Nelze spustit na portu %d (%s) - běží pomocník už jednou?\n" % (args.port, error.strerror or type(error).__name__))
    print("Anime pomocník běží na http://127.0.0.1:%d (Ctrl+C ukončí)" % server.server_address[1])
    print("Obrázky se ukládají do %s" % args.images_dir)
    print("ČSFD a MAL hodnocení a zhlédnuté epizody se zapisují do %s%s"
          % (args.data_file, "" if os.path.isfile(args.data_file) else " (SOUBOR CHYBÍ)"))
    print("Cookie sledujserialy.io: " + ("nastavena" if config.cookie else "CHYBÍ (viz README)"))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Ukončeno.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
