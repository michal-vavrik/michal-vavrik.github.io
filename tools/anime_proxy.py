#!/usr/bin/env python3
r"""Lokální pomocník pro stránku anime.html (Aktualizovat -> Seznam, ČSFD a MAL hodnocení, Zhlédnuté epizody).

Stránka běžící na GitHub Pages si sama nemůže stáhnout sledujserialy.io, ČSFD ani
MyAnimeList (CORS, přihlašovací cookie) a nemůže zapisovat soubory. Tento malý
server proto běží na vašem počítači (jen na 127.0.0.1) a umí:

  GET  /health          stav pomocníka (bez tajemství)
  GET  /fetch?url=...   stáhne stránku z povoleného webu; cookie se přidává jen
                        pro sledujserialy.io
  POST /images          {"url": "https://sledujserialy.io/upload/...", "number": 319}
                        stáhne obrázek, uloží ho jako img/anime/319.jpg a vrátí
                        ho stránce (type, data v base64)
  POST /csfd-ratings    {"ratings": {"1": "77%", ...}}
                        zapíše ČSFD hodnocení do data/anime.json (mění jen
                        CsfdRating, formát jako Python WriteDataToTheFile())
  POST /mal-ratings     totéž pro MAL hodnocení (mění jen MalRating)
  POST /watched-states  {"states": {"1": "DONE", "2": "S01E05", ...}}
                        zapíše zhlédnuté epizody (mění jen State)
  POST /anime-items     {"items": [{"Number": "319", ...}, ...]}
                        přidá nová anime ze Seznamu do data/anime.json (číslo,
                        které v souboru už je, nikdy nepřepíše)
  POST /publish         {}  (jen na stisk tlačítka Push na stránce)
                        commitne data/anime.json a img/anime/N.jpg se zprávou
                        "feat: anime list update" a pushne větev main na origin

Spuštění:      python tools\anime_proxy.py
Diagnostika:   python tools\anime_proxy.py --check
Podrobně:      python tools\anime_proxy.py --diag ["název anime" ...]

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
import base64
import codecs
import dataclasses
import http.client
import json
import os
import platform
import re
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urljoin, urlsplit

# Verze 2 přidala POST /csfd-ratings, verze 3 POST /mal-ratings, verze 4 POST /watched-states,
# verze 5 POST /anime-items, verze 6 stahuje obrázky ze sledujserialy.io místo serialy.sx,
# verze 7 vrací uložený obrázek v odpovědi POST /images, verze 8 přidala POST /publish (tlačítko Push);
# stránka starší pomocník odmítne.
VERSION = 8
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
# Nová anime mají i popis, proto je limit pro POST /anime-items větší.
MAX_ITEMS_BODY = 4 * 1024 * 1024
# Odmítnuté tělo požadavku do této velikosti se před odpovědí dočte (viz Handler._discard_body);
# s rezervou nad největším limitem, aby i tělo těsně nad limitem dostalo odpověď 413.
MAX_DISCARD_BODY = 2 * MAX_ITEMS_BODY
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
# Pole nového anime v pořadí Python GetNewFavoriteData() (stejně jako ITEM_KEYS v js/anime-sync.js).
ITEM_KEYS = ("Number", "FavoriteName", "CsfdID", "MalID", "MalName", "Image", "NameEn", "NameJa",
             "Genres", "Description", "Date", "State", "CsfdRating", "MalRating", "MyRating")
ITEM_NUMBER = re.compile(r"[1-9][0-9]{0,5}")
REDIRECT_STATUSES = (301, 302, 303, 307, 308)
EXPOSED_HEADERS = "X-Upstream-Status, X-Final-Url, X-Proxy-Error, X-Proxy-Detail"
TARGET_SAFE = "/%+:;,@$!*'()~-._"

# Povolené weby a cesty pro /fetch (kontroluje se i každé přesměrování).
FETCH_RULES = {
    "sledujserialy.io": re.compile(r"^/(?:ucet/|serial/[A-Za-z0-9_.%-]+/?)$"),
    "www.csfd.cz": re.compile(r"^/(?:hledat/?|film/[0-9]+[A-Za-z0-9_/-]*)$"),
    "myanimelist.net": re.compile(r"^/(?:anime\.php|anime/[0-9]+(?:/[^/?#]*)?)$"),
}
# Obrázky oblíbených (IMAGE_ORIGIN v js/anime-sync.js + src z oblíbených). Skript je bral ze
# serialy.sx, který teď jen přesměrovává na sledujserialy.io; povolená je jen složka /upload/.
IMAGE_ORIGIN = "https://sledujserialy.io"
IMAGE_RULES = {"sledujserialy.io": re.compile(r"^/upload/[^?#]*$")}

# Tlačítko Push (POST /publish): commit jen dat a obrázků s pevnou zprávou a push jedné větve.
PUBLISH_BRANCH = "main"
PUBLISH_REMOTE = "origin"
PUBLISH_MESSAGE = "feat: anime list update"
GIT_TIMEOUT = 30
# Commit spouští případné hooky, push čeká na síť.
COMMIT_TIMEOUT = 60
PUSH_TIMEOUT = 120
# Jak dlouho se po ukončení gitu čeká na zavření jeho výstupu.
GIT_KILL_WAIT = 5


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


def _image_kind(data):
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "GIF"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


IMAGE_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "GIF": "image/gif", "WEBP": "image/webp"}


def looks_like_image(data):
    return _image_kind(data) is not None


def image_config(config):
    """Obrázek nepotřebuje přihlášení, ale ověření Cloudflare (cf_clearance, User-Agent) ano."""
    return dataclasses.replace(config, cookie="")


def download_image(url, config, transport=http_get_once):
    status, _final_url, body = fetch_page(url, image_config(config), IMAGE_RULES, transport)
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


def _read_data(path):
    """Načte soubor s daty; vrací (bajty, text, objekt klíčovaný Number)."""
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
    return raw, text, data


def _write_data(path, raw, text, data):
    """Zapíše data jako `json.dump(..., indent=4, ensure_ascii=False)` (Python
    WriteDataToTheFile()) se zachovaným BOM, konci řádků a koncovým odřádkováním
    původního souboru, takže se v diffu ukážou jen skutečné změny."""
    output = json.dumps(data, indent=4, ensure_ascii=False)
    line_end = "\r\n" if "\r\n" in text else "\n"
    output = output.replace("\n", line_end)
    if text.endswith("\n"):
        output += line_end
    bom = codecs.BOM_UTF8 if raw.startswith(codecs.BOM_UTF8) else b""
    _replace_file(path, bom + output.encode("utf-8"))


def update_field(path, field, values):
    """Přepíše jedno pole anime v souboru s daty (Python UpdateCSFD()/UpdateMAL()/UpdateWatched()
    + WriteDataToTheFile()).

    `field` je "CsfdRating", "MalRating" nebo "State", `values` mapuje Number na novou hodnotu.
    Formát souboru zůstane (viz _write_data()); beze změny se nezapisuje. Vrací
    (počet změněných hodnot, čísla anime, která v souboru nejsou).
    """
    with _data_lock:
        raw, text, data = _read_data(path)
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
            _write_data(path, raw, text, data)
        return changed, missing


def add_items(path, items):
    """Přidá nová anime ze Seznamu do souboru s daty (Python UpdateAnimeList() + WriteDataToTheFile()).

    `items` jsou ověřené položky s poli ITEM_KEYS. Číslo, které v souboru už je,
    se nikdy nepřepíše: celý zápis se pak odmítne chybou item-exists (stránka
    a soubor se rozešly) a soubor zůstane beze změny. Anime se seřadí podle
    čísla jako ve skriptu. Vrací počet přidaných anime.
    """
    with _data_lock:
        raw, text, data = _read_data(path)
        existing = [item["Number"] for item in items if item["Number"] in data]
        if existing:
            raise ProxyError("item-exists", 409, " ".join(existing[:10]))
        for item in items:
            data[item["Number"]] = {key: item[key] for key in ITEM_KEYS}
        if all(re.fullmatch(r"[0-9]+", number) for number in data):
            data = dict(sorted(data.items(), key=lambda entry: int(entry[0])))
        _write_data(path, raw, text, data)
        return len(items)


_publish_lock = threading.Lock()
# Rozpracovaná operace gitu, během které se necommituje (soubory v .git).
GIT_BUSY_MARKERS = ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply")
PUSH_AUTH_ERROR = re.compile(r"Authentication failed|could not read (?:Username|Password)|terminal prompts disabled"
                             r"|interactivity has been disabled|Permission denied|error: 40[13]|returned error: 40[13]"
                             r"|HTTP 40[13]", re.IGNORECASE)


def _git_env():
    """Prostředí gitu bez jakéhokoli dotazu na přihlášení: chybějící přihlášení skončí chybou místo okna."""
    env = dict(os.environ)
    env.pop("LANGUAGE", None)
    env.pop("SSH_ASKPASS", None)
    env.update({
        "GIT_TERMINAL_PROMPT": "0",
        # Prázdné GIT_ASKPASS vypne i core.askPass a SSH_ASKPASS (např. okno VS Code).
        "GIT_ASKPASS": "",
        # Git Credential Manager: jen uložené přihlášení, žádné přihlašovací okno ani prohlížeč.
        "GCM_INTERACTIVE": "never",
        "SSH_ASKPASS_REQUIRE": "never",
        "LC_ALL": "C",
    })
    return env


def _windows_job(process):
    """Windows: job object, do kterého patří `process` i všechny procesy, které spustí; jinak None.

    `taskkill /T` nenajde procesy, které spustil sh (hooky): jejich rodičovský proces už neexistuje.
    """
    if os.name != "nt":
        return None
    try:
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.CreateJobObjectW.argtypes = (wintypes.LPVOID, wintypes.LPCWSTR)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return None
        # PROCESS_SET_QUOTA | PROCESS_TERMINATE
        handle = kernel32.OpenProcess(0x0100 | 0x0001, False, process.pid)
        assigned = bool(handle) and bool(kernel32.AssignProcessToJobObject(job, handle))
        if handle:
            kernel32.CloseHandle(handle)
        if assigned:
            return job
        kernel32.CloseHandle(job)
    except (AttributeError, OSError, ImportError):
        pass
    return None


def _close_job(job, terminate=False):
    """Zavře job z _windows_job; s `terminate` předtím ukončí všechny jeho procesy. Vrací, zda je ukončil."""
    if job is None:
        return False
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.TerminateJobObject.argtypes = (wintypes.HANDLE, wintypes.UINT)
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    terminated = bool(kernel32.TerminateJobObject(job, 1)) if terminate else False
    kernel32.CloseHandle(job)
    return terminated


def _kill_tree(process, job=None):
    """Ukončí git i procesy, které spustil (hooky, git-remote-https, správce přihlášení).

    Na Windows je `git` v PATH jen spouštěč skutečného git.exe; ukončit jen jeho
    by nechalo git běžet (a dokončit commit nebo push) a výstup otevřený.
    """
    if _close_job(job, terminate=True):
        pass
    elif os.name == "nt":
        try:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=GIT_KILL_WAIT,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            pass
    try:
        process.kill()
    except OSError:
        pass


def _lock_files(git_dir):
    """Zámky gitu (*.lock) v `git_dir`, refs/ a reftable/, které může nechat ukončený git."""
    found = set()
    for folder, recursive in ((git_dir, False), (os.path.join(git_dir, "refs"), True),
                              (os.path.join(git_dir, "reftable"), False)):
        for current, _dirs, names in os.walk(folder):
            found.update(os.path.join(current, name) for name in names if name.endswith(".lock"))
            if not recursive:
                break
    return found


def _git(cwd, args, step, timeout=None, stdin=None, git_dir=None):
    """Spustí git bez interaktivních dotazů; vrací (návratový kód, stdout, stderr).

    Po `timeout` sekundách (výchozí GIT_TIMEOUT) git ukončí i s procesy, které spustil;
    s `git_dir` pak smaže zámky (index.lock apod.), které ukončený git nestihl uklidit.
    """
    if os.name == "nt":
        group = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    else:
        group = {"start_new_session": True}
    locks = _lock_files(git_dir) if git_dir else set()
    try:
        process = subprocess.Popen(["git", "-C", cwd] + list(args), stdin=subprocess.DEVNULL if stdin is None
                                   else subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=_git_env(), **group)
    except FileNotFoundError:
        raise ProxyError("git-missing", 500)
    except OSError as error:
        raise ProxyError("git-failed", 500, "%s %s" % (step, type(error).__name__))
    job = _windows_job(process)
    try:
        stdout, stderr = process.communicate(stdin, timeout=timeout or GIT_TIMEOUT)
    except subprocess.TimeoutExpired:
        _kill_tree(process, job)
        job = None
        try:
            process.communicate(timeout=GIT_KILL_WAIT)
        except subprocess.TimeoutExpired:
            pass
        if git_dir:
            # Nové zámky nechal ukončený git (commit drží index.lock po celou dobu); zámek,
            # který má otevřený jiný běžící git, Windows smazat nedovolí.
            for path in _lock_files(git_dir) - locks:
                try:
                    os.remove(path)
                except OSError:
                    pass
        raise ProxyError("git-timeout", 504, step)
    finally:
        _close_job(job)
    return process.returncode, stdout.decode("utf-8", "replace"), stderr.decode("utf-8", "replace")


def _redact(text):
    # Adresa remote může obsahovat jméno a token (https://user:token@github.com/...).
    return re.sub(r"//[^/@\s]+@", "//***@", text)


def _git_message(stderr):
    """První smysluplný řádek chybového výstupu gitu (bez "fatal:", "error:", nápověd)."""
    for line in _redact(stderr).splitlines():
        line = line.strip().lstrip("*").strip()
        if not line or line.lower().startswith(("hint:", "to ")):
            continue
        return re.sub(r"^(?:fatal|error|remote): *", "", line, flags=re.IGNORECASE)
    return ""


def _git_location(path):
    """Kořen repozitáře a cesta `path` (složky) relativně k němu s lomítky, nebo None mimo repozitář."""
    if not os.path.isdir(path):
        return None
    code, out, _err = _git(path, ["rev-parse", "--show-toplevel", "--show-prefix"], "rev-parse")
    lines = out.split("\n")
    if code != 0 or not lines[0]:
        return None
    return lines[0], lines[1] if len(lines) > 1 else ""


def _same_path(first, second):
    return os.path.normcase(os.path.normpath(first)) == os.path.normcase(os.path.normpath(second))


def _index_entries(root, paths):
    """Záznamy indexu (`ls-files --stage`) pro `paths`: cesta -> "mode oid stage\\tcesta"."""
    code, out, err = _git(root, ["--literal-pathspecs", "ls-files", "--stage", "-z", "--"] + list(paths), "ls-files")
    if code != 0:
        raise ProxyError("git-failed", 500, "ls-files: " + _git_message(err))
    entries = {}
    for record in out.split("\0"):
        path = record.partition("\t")[2]
        if path:
            entries[path] = record
    return entries


def _restore_index(root, paths, entries):
    """Vrátí `paths` v indexu do stavu `entries` (z _index_entries); co v indexu nebylo, z něj zase odebere.

    Jen pokus: chyba (např. index zamčený jiným gitem) se nehlásí, aby nepřekryla původní chybu.
    """
    known = [entries[path] for path in paths if path in entries]
    unknown = [path for path in paths if path not in entries]
    try:
        if known:
            _git(root, ["update-index", "-z", "--index-info"], "restore",
                 stdin="\0".join(known).encode("utf-8") + b"\0")
        if unknown:
            _git(root, ["update-index", "-z", "--force-remove", "--stdin"], "restore",
                 stdin="\0".join(unknown).encode("utf-8") + b"\0")
    except ProxyError:
        pass


def _head(root):
    """Hash HEAD, nebo None (žádný commit, chyba gitu)."""
    try:
        code, out, _err = _git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], "rev-parse")
    except ProxyError:
        return None
    return out.strip() if code == 0 else None


def _push_error(stdout, stderr):
    """Převede neúspěšný `git push --porcelain` na ProxyError."""
    for line in stdout.splitlines():
        if line.startswith("!"):
            reason = re.search(r"\(([^)]*)\)\s*$", line)
            reason = reason.group(1) if reason else ""
            if "[rejected]" in line:
                return ProxyError("publish-rejected", 409, reason)
            return ProxyError("publish-push-failed", 502, reason or _git_message(stderr))
    if PUSH_AUTH_ERROR.search(stderr):
        return ProxyError("publish-auth-failed", 502, _git_message(stderr))
    return ProxyError("publish-push-failed", 502, _git_message(stderr))


def publish_changes(data_path, images_dir):
    """Commitne a pushne data/anime.json a obrázky img/anime/N.jpg (tlačítko Push na stránce).

    Do commitu jdou jen tyto soubory (nové nebo změněné, ne smazané) se zprávou
    PUBLISH_MESSAGE; jiné změny v repozitáři, včetně připravených (staged), zůstanou,
    jak jsou. Když commit neproběhne, index se vrátí do původního stavu. Pracuje jen
    na větvi PUBLISH_BRANCH bez rozpracovaného merge/rebase
    a pushuje ji na PUBLISH_REMOTE (s ní i dřívější nepushnuté commity té větve);
    nic neslučuje ani nepřepisuje. Když se push nepovede, commit zůstane a příští
    volání ho pushne. Vrací {"committed", "pushed", "commit", "files"}.
    """
    if not _publish_lock.acquire(blocking=False):
        raise ProxyError("publish-running", 409)
    try:
        if not os.path.isfile(data_path):
            raise ProxyError("data-file-missing", 500)
        location = _git_location(os.path.dirname(os.path.abspath(data_path)))
        if location is None:
            raise ProxyError("not-a-repository", 409)
        root, data_prefix = location
        data_rel = data_prefix + os.path.basename(data_path)
        images_prefix = None
        images = _git_location(os.path.abspath(images_dir))
        if images is not None:
            if not _same_path(images[0], root):
                raise ProxyError("not-a-repository", 409, "images")
            images_prefix = images[1]
        elif os.path.isdir(images_dir):
            raise ProxyError("not-a-repository", 409, "images")

        code, out, _err = _git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], "branch")
        branch = out.strip() if code == 0 else "HEAD"
        if branch != PUBLISH_BRANCH:
            raise ProxyError("publish-wrong-branch", 409, branch)
        code, out, _err = _git(root, ["rev-parse", "--absolute-git-dir"], "git-dir")
        git_dir = out.strip()
        if code != 0 or not git_dir:
            raise ProxyError("not-a-repository", 409)
        for marker in GIT_BUSY_MARKERS:
            if os.path.exists(os.path.join(git_dir, marker)):
                raise ProxyError("publish-repo-busy", 409, marker)
        code, out, _err = _git(root, ["config", "--get", "remote.%s.url" % PUBLISH_REMOTE], "remote")
        if code != 0 or not out.strip():
            raise ProxyError("publish-no-remote", 409, PUBLISH_REMOTE)

        specs = [data_rel]
        if images_prefix is not None:
            specs.append(images_prefix.rstrip("/") or ".")
        code, out, err = _git(root, ["--literal-pathspecs", "status", "--porcelain=v1", "-z", "--no-renames",
                                     "--untracked-files=all", "--"] + specs, "status")
        if code != 0:
            raise ProxyError("git-failed", 500, "status: " + _git_message(err))
        candidates = []
        for entry in out.split("\0"):
            state, path = entry[:2], entry[3:]
            if len(entry) < 4 or "D" in state or "U" in state:
                continue
            name = path[len(images_prefix):] if images_prefix is not None and path.startswith(images_prefix) else None
            if path == data_rel or (name is not None and re.fullmatch(r"[0-9]+\.jpg", name)):
                candidates.append(path)

        files = []
        if candidates:
            pathspecs = "\0".join(candidates).encode("utf-8") + b"\0"
            with _data_lock:
                # `git add` mění skutečný index; když commit neproběhne, vrátí se původní stav,
                # aby se soubory nedostaly do příštího ručního commitu uživatele.
                original = _index_entries(root, candidates)
                head = _head(root)
                code, _out, err = _git(root, ["--literal-pathspecs", "add", "--pathspec-from-file=-",
                                              "--pathspec-file-nul"], "add", stdin=pathspecs)
                if code != 0:
                    raise ProxyError("git-failed", 500, "add: " + _git_message(err))
                committed = False
                try:
                    code, out, _err = _git(root, ["--literal-pathspecs", "diff", "--cached", "--name-only",
                                                  "--no-renames", "-z", "HEAD", "--"] + specs, "diff")
                    staged = set(out.split("\0")) if code == 0 else set(candidates)
                    files = [path for path in candidates if path in staged]
                    if files:
                        # --only: commit obsahuje jen tyto soubory, i když jsou připravené i jiné změny.
                        code, _out, err = _git(root, ["--literal-pathspecs", "commit", "-q", "-m", PUBLISH_MESSAGE,
                                                      "--only", "--pathspec-from-file=-", "--pathspec-file-nul"],
                                               "commit", timeout=COMMIT_TIMEOUT, git_dir=git_dir,
                                               stdin="\0".join(files).encode("utf-8") + b"\0")
                        if code != 0:
                            raise ProxyError("publish-commit-failed", 500, _git_message(err))
                        committed = True
                finally:
                    # Když commit přece jen vznikl (vypršel čas těsně po něm), index už odpovídá HEAD.
                    if not committed and _head(root) == head:
                        _restore_index(root, candidates, original)

        if not files:
            code, out, _err = _git(root, ["rev-list", "--count", "refs/remotes/%s/%s..HEAD"
                                          % (PUBLISH_REMOTE, PUBLISH_BRANCH)], "rev-list")
            if code == 0 and out.strip() == "0":
                return {"committed": False, "pushed": False, "commit": "", "files": 0}

        code, out, err = _git(root, ["push", "--porcelain", PUBLISH_REMOTE, "refs/heads/%s:refs/heads/%s"
                                     % (PUBLISH_BRANCH, PUBLISH_BRANCH)], "push", timeout=PUSH_TIMEOUT, git_dir=git_dir)
        if code != 0:
            raise _push_error(out, err)
        pushed = any(line[:1] in (" ", "+", "*") and "\t" in line for line in out.split("\n"))
        code, out, _err = _git(root, ["rev-parse", "--short", "HEAD"], "rev-parse")
        commit = out.strip() if code == 0 and (files or pushed) else ""
        return {"committed": bool(files), "pushed": pushed, "commit": commit, "files": len(files)}
    finally:
        _publish_lock.release()


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
                known = parts.path in ("/health", "/fetch", "/images", "/anime-items", "/publish") or parts.path in DATA_ROUTES
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
        routes = {"/images": self._images, "/anime-items": self._anime_items, "/publish": self._publish}
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

        data = download_image(payload.get("url"), self.server.config, self.server.transport)
        save_image(self.server.images_dir, number, data)
        # Stránka obrázek ukáže hned, i když ho web (GitHub Pages) ještě nemá.
        self._send_json(201, {"ok": True, "number": number, "bytes": len(data),
                              "type": IMAGE_TYPES[_image_kind(data)], "data": base64.b64encode(data).decode("ascii")})

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

    def _anime_items(self, _parts):
        items = self._read_json_body(MAX_ITEMS_BODY).get("items")
        if not isinstance(items, list) or not 0 < len(items) <= MAX_DATA_VALUES:
            raise ProxyError("bad-request", 400, "items")
        numbers = set()
        for item in items:
            if (not isinstance(item, dict) or set(item) != set(ITEM_KEYS)
                    or not all(isinstance(value, str) for value in item.values())):
                raise ProxyError("bad-request", 400, "item")
            if not ITEM_NUMBER.fullmatch(item["Number"]) or item["Number"] in numbers:
                raise ProxyError("bad-request", 400, "number")
            numbers.add(item["Number"])
        if not self.server.data_path:
            raise ProxyError("data-file-missing", 500)
        added = add_items(self.server.data_path, items)
        print("Seznam: zápis do %s (přidáno %d)" % (self.server.data_path, added), file=sys.stderr)
        self._send_json(200, {"ok": True, "added": added})

    def _publish(self, _parts):
        self._read_json_body(MAX_REQUEST_BODY)
        if not self.server.data_path:
            raise ProxyError("data-file-missing", 500)
        print("Push: commit a push %s na %s/%s" % (self.server.data_path, PUBLISH_REMOTE, PUBLISH_BRANCH), file=sys.stderr)
        try:
            result = publish_changes(self.server.data_path, self.server.images_dir)
        except ProxyError as error:
            detail = _clean_detail(error.detail)
            print("Push: chyba %s%s" % (error.code, " (%s)" % detail if detail else ""), file=sys.stderr)
            raise
        if result["committed"]:
            print("Push: commit %s (souborů %d)" % (result["commit"], result["files"]), file=sys.stderr)
        print("Push: %s" % ("odesláno" if result["pushed"] else "není co odeslat"), file=sys.stderr)
        payload = {"ok": True}
        payload.update(result)
        self._send_json(200, payload)


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
                verdict = "přesměrováno na nepovolený web (%s) - firemní filtr, nebo web změnil adresu" % _clean_detail(error.detail)
            elif error.code == "tls-error":
                verdict = "chyba TLS certifikátu (%s)" % _clean_detail(error.detail)
            else:
                verdict = "chyba %s %s" % (error.code, _clean_detail(error.detail))
        all_ok = all_ok and ok
        out("%-18s %s" % (name, verdict))
    return all_ok


# --diag: podrobný výpis pro hledání potíží (přesměrování, Cloudflare, obrázky).
DIAG_MAX_FAVORITES = 3
DIAG_MAX_NAMED = 5
# Python EXCEPTION_ANIME (AnimeList.pyw ř. 63), stejně jako v js/anime-sync.js.
DIAG_EXCEPTION_ANIME = ("Owari no Seraph: Nagoja kessen hen",)
# Python GetFavorites() (AnimeList.pyw ř. 1299-1303) ve tvaru parseFavorites() z js/anime-sync.js.
_DIAG_FAVORITES_SECTIONS = (
    re.compile(r'<div id="favorites"[\s\S]*?<div id="planned"'),
    re.compile(r"<div id='favorites'[\s\S]*?<div id='planned'"),
)
_DIAG_FAVORITE_ROWS = (
    re.compile(r'<a href="/episode/([\s\S]+?)-[sS]([0-9]+)[eE]([0-9]+)[\s\S]+?"[\s\S]+?<img src="([\s\S]+?)"[\s\S]+?'
               r'<h2 class="a-favorites__title">[\s]*([\s\S]+?)[\s]*<[\s\S]+?(Pokračuj|>[sS][0-9])'),
    re.compile(r"<a href='/episode/([\s\S]+?)-[sS]([0-9]+)[eE]([0-9]+)[\s\S]+?'[\s\S]+?<img src='([\s\S]+?)'[\s\S]+?"
               r"<h2 class='a-favorites__title'>[\s]*([\s\S]+?)[\s]*<[\s\S]+?(Pokračuj|>[sS][0-9])"),
)
# Dotaz v adrese se vypíše jen u těchto webů; jinde (např. stránka firemního filtru) může obsahovat osobní údaje.
_DIAG_PUBLIC_QUERY_HOSTS = frozenset(FETCH_RULES) | frozenset(IMAGE_RULES)


def _diag_text(value, limit=200):
    text = re.sub(r"[\x00-\x1f\x7f]", "?", str(value))
    return text if len(text) <= limit else text[:limit] + "…"


def _diag_url(url):
    """Adresa do výpisu: bez jména a hesla a bez dotazu u neznámých webů."""
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
    except ValueError:
        return "(neplatná adresa)"
    text = "%s://%s%s" % (parts.scheme, host, parts.path)
    if parts.query:
        text += "?" + (parts.query if host in _DIAG_PUBLIC_QUERY_HOSTS else "…")
    return _diag_text(text)


def _diag_trace(url, config, transport):
    """Stáhne adresu a sleduje přesměrování kamkoli (jen https, cookie jen pro
    sledujserialy.io); vrací kroky pro výpis a pro _diag_verdict()."""
    hops = []
    current = url
    while len(hops) <= MAX_REDIRECTS:
        hop = {"url": current}
        hops.append(hop)
        try:
            parts = urlsplit(current)
            secure = parts.scheme == "https" and bool(parts.hostname)
        except ValueError:
            secure = False
        if not secure:
            hop["error"] = "adresa není https, dál se nepokračuje"
            break
        headers = build_headers(parts.hostname, config)
        sent = headers.get("Cookie", "")
        hop["cookie"] = "user_logged_in=" in sent
        hop["clearance"] = "cf_clearance=" in sent
        try:
            hop["status"], hop["headers"], hop["body"] = transport(current, headers, TIMEOUT, MAX_BYTES)
        except ProxyError as error:
            hop["error"] = ("%s %s" % (error.code, _diag_text(error.detail or "", 120))).strip()
            break
        location = hop["headers"].get("location")
        if hop["status"] not in REDIRECT_STATUSES or not location:
            break
        current = urljoin(current, location)
    return hops


def _diag_body(hop):
    status, headers, body = hop["status"], hop["headers"], hop["body"]
    if is_challenge(status, headers, body):
        return "výzva Cloudflare (%d B)" % len(body)
    kind = _image_kind(body)
    if kind:
        return "obrázek %s (%d B)" % (kind, len(body))
    if not body:
        return "prázdné tělo"
    text = body.decode("utf-8", "replace")
    title = re.search(r"<title[^>]*>([\s\S]*?)</title>", text, re.I)
    # Stránka s přihlášením může v titulku obsahovat jméno účtu.
    if title and not hop.get("cookie"):
        return "HTML „%s“ (%d B)" % (_diag_text(" ".join(title.group(1).split()), 100), len(body))
    if re.search(r"<html|<!doctype", text[:2048], re.I):
        return "HTML (%d B)" % len(body)
    return "jiný obsah, začátek %s (%d B)" % (body[:8].hex(" "), len(body))


def _diag_print_hops(hops, out):
    for index, hop in enumerate(hops, 1):
        sent = [label for label, flag in (("cookie", hop.get("cookie")), ("cf_clearance", hop.get("clearance"))) if flag]
        out("    %d. GET %s%s" % (index, _diag_url(hop["url"]), " (s %s)" % " a ".join(sent) if sent else ""))
        if "error" in hop:
            out("       chyba: %s" % hop["error"])
            continue
        headers = hop["headers"]
        details = ["HTTP %d" % hop["status"]]
        for name in ("server", "content-type", "cf-mitigated"):
            if headers.get(name):
                details.append("%s: %s" % (name, _diag_text(headers[name], 80)))
        location = headers.get("location")
        if hop["status"] in REDIRECT_STATUSES and location:
            details.append("-> %s" % _diag_url(urljoin(hop["url"], location)))
        else:
            details.append(_diag_body(hop))
        out("       " + ", ".join(details))


def _diag_verdict(hops, rules, image):
    """Co by s těmito kroky udělal fetch_page() pomocníka (stejné kontroly, bez dalšího stahování)."""
    for index, hop in enumerate(hops):
        try:
            check_url(hop["url"], rules)
        except ProxyError as error:
            if index == 0:
                return "adresu odmítne (%s %s)" % (error.code, _diag_text(error.detail or "", 120))
            return "ZASTAVÍ SE na kroku %d: redirect-blocked (%s)" % (index + 1, _diag_text(error.detail or error.code, 120))
        if "error" in hop:
            return "chyba %s" % hop["error"]
        if is_challenge(hop["status"], hop["headers"], hop["body"]):
            return "cloudflare-challenge"
        if hop["status"] in REDIRECT_STATUSES and hop["headers"].get("location"):
            continue
        if not image:
            return "OK (HTTP %d)" % hop["status"]
        if hop["status"] != 200:
            return "image-download-failed (HTTP %d)" % hop["status"]
        if not looks_like_image(hop["body"]):
            return "not-an-image"
        return "OK, obrázek by se uložil"
    return "too-many-redirects"


def _diag_favorites(html):
    """Oblíbené jako parseFavorites() v js/anime-sync.js -> (varianta, [(název, src, <img>)]); None bez sekce."""
    for pattern in _DIAG_FAVORITES_SECTIONS:
        section = pattern.search(html)
        if section:
            break
    else:
        return None
    for variant, pattern in zip(("uvozovky", "apostrofy"), _DIAG_FAVORITE_ROWS):
        rows = []
        for match in pattern.finditer(section.group(0)):
            tag = re.search(r"<img\b[^>]*>", match.group(0))
            rows.append((match.group(5).replace(";", ","), match.group(4), tag.group(0) if tag else ""))
        if rows:
            return variant, rows
    return "žádná", []


def _diag_known_names(data_path, out):
    try:
        _raw, _text, data = _read_data(data_path)
    except ProxyError as error:
        out("Datový soubor: chyba %s, všechny oblíbené se berou jako nové" % error.code)
        return set()
    out("Datový soubor: %d anime" % len(data))
    return {item.get("FavoriteName") for item in data.values() if isinstance(item, dict)}


def run_diag(config, names=(), data_path=DEFAULT_DATA_FILE, transport=http_get_once, out=print):
    """Podrobná diagnostika (--diag): kroky přesměrování, Cloudflare a stažení obrázků
    nových oblíbených (nebo oblíbených podle `names`). Nevypisuje cookie ani obsah
    stránky účtu, výpis lze poslat dál."""
    out("=== Diagnostika anime pomocníka (verze %d) ===" % VERSION)
    out("Python %s, %s" % (platform.python_version(), platform.platform(terse=True)))
    out("Nastavení: cookie %s, cfClearance %s, userAgent %s" % (
        "ano" if config.cookie else "CHYBÍ",
        "ano" if config.cf_clearance else "ne",
        "vlastní" if config.user_agent else "výchozí (%s)" % USER_AGENT))
    known = _diag_known_names(data_path, out)

    out("")
    out("--- Stránky (stejné kontroly jako pomocník) ---")
    favorites_hops = None
    for index, (label, url, rules) in enumerate((
        ("sledujserialy.io, účet", "https://sledujserialy.io/ucet/", FETCH_RULES),
        ("ČSFD, hledání", "https://www.csfd.cz/hledat/?q=naruto", FETCH_RULES),
        ("MyAnimeList, hledání", "https://myanimelist.net/anime.php?cat=anime&q=naruto", FETCH_RULES),
    )):
        hops = _diag_trace(url, config, transport)
        out("  %s:" % label)
        _diag_print_hops(hops, out)
        out("    Pomocník: %s" % _diag_verdict(hops, rules, image=False))
        if index == 0:
            favorites_hops = hops

    out("")
    out("--- Oblíbené na sledujserialy.io ---")
    last = favorites_hops[-1]
    favorites = None
    if "error" not in last and last["status"] == 200:
        favorites = _diag_favorites(last["body"].decode("utf-8", "replace"))
    if favorites is None:
        out("  Sekce oblíbených chybí (cookie chybí nebo vypršela, výzva Cloudflare, nebo se změnila stránka).")
        out("")
        out("Konec diagnostiky.")
        return
    variant, rows = favorites
    new = [row for row in rows if row[0] not in known and row[0] not in DIAG_EXCEPTION_ANIME]
    out("  Oblíbených: %d (varianta: %s), z toho nových (nejsou v datovém souboru): %d" % (len(rows), variant, len(new)))
    for name in [row[0] for row in new[:20]]:
        out("    nové: %s" % _diag_text(name, 120))
    if names:
        wanted = [name.casefold() for name in names]
        targets = [row for row in rows if any(name in row[0].casefold() for name in wanted)][:DIAG_MAX_NAMED]
        if not targets:
            out("  Žádný oblíbený neodpovídá: %s" % _diag_text(", ".join(names), 200))
    elif new:
        targets = new[:DIAG_MAX_FAVORITES]
    else:
        out("  Žádné nové anime, pro ukázku zkouším první oblíbený.")
        targets = rows[:1]

    for name, src, tag in targets:
        out("")
        out("--- Obrázek: %s ---" % _diag_text(name, 120))
        out("  <img>: %s" % _diag_text(tag, 300))
        url = IMAGE_ORIGIN + src
        out("  Stránka stahuje: %s" % _diag_url(url))
        hops = _diag_trace(url, image_config(config), transport)
        _diag_print_hops(hops, out)
        out("    Pomocník: %s" % _diag_verdict(hops, IMAGE_RULES, image=True))

    out("")
    out("Konec diagnostiky. Výpis neobsahuje cookie ani obsah stránky účtu.")


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
                        help="soubor s daty, do kterého se zapisují výsledky aktualizací (výchozí data/anime.json)")
    parser.add_argument("--check", action="store_true", help="ověří dostupnost zdrojů a skončí")
    parser.add_argument("--diag", nargs="*", metavar="NÁZEV",
                        help="podrobná diagnostika (přesměrování, Cloudflare, obrázky nových anime, nebo anime, "
                             "jejichž název obsahuje NÁZEV) a konec; výpis neobsahuje cookie")
    args = parser.parse_args(argv)

    try:
        config = load_config()
    except ConfigError as error:
        parser.exit(2, "%s\n" % error)

    if args.diag is not None:
        run_diag(config, args.diag, args.data_file)
        return 0
    if args.check:
        return 0 if run_check(config) else 1

    try:
        server = ProxyServer(args.port, DEFAULT_ORIGINS + tuple(args.allow_origin), args.images_dir, config,
                             config_path=LOCAL_CONFIG_PATH, data_path=args.data_file)
    except OSError as error:
        parser.exit(2, "Nelze spustit na portu %d (%s) - běží pomocník už jednou?\n" % (args.port, error.strerror or type(error).__name__))
    print("Anime pomocník běží na http://127.0.0.1:%d (Ctrl+C ukončí)" % server.server_address[1])
    print("Obrázky se ukládají do %s" % args.images_dir)
    print("Výsledky aktualizací se zapisují do %s%s"
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
