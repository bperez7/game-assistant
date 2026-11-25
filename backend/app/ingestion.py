"""Bounded HTTPS fetching; DNS addresses are checked and pinned per connection."""
import http.client
import ipaddress
import socket
import re
import ssl
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit, urljoin
from urllib.robotparser import RobotFileParser

USER_AGENT = "WalkthroughAssistant/0.1"
MAX_BYTES = 2_000_000


class SourceError(ValueError):
    pass


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "nav", "header", "footer", "noscript"}:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style", "nav", "header", "footer", "noscript"}:
            self.skip = max(0, self.skip - 1)
        if not self.skip and tag in {"p", "li", "div", "h1", "h2", "h3", "br"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


class GuideExtractor(TextExtractor):
    """Keep image positions in the same word stream used for passage chunking."""
    def __init__(self, url):
        super().__init__()
        self.url = url
        self.images = []
        self.words = 0
        self.heading = ""
        self.heading_parts = None
        self.caption_parts = None
        self.figure_images = None

    def handle_starttag(self, tag, attrs):
        super().handle_starttag(tag, attrs)
        if self.skip:
            return
        attrs = dict(attrs)
        if tag in {"h1", "h2", "h3", "h4"}:
            self.heading_parts = []
        if tag == "figure":
            self.figure_images = []
        if tag == "figcaption":
            self.caption_parts = []
        if tag != "img" or len(self.images) >= 100:
            return
        label = " ".join(attrs.get(k, "") or "" for k in ("alt", "class", "id", "role"))
        if re.search(r"\b(logo|avatar|icon|advertisement|banner|tracking|pixel)\b", label, re.I):
            return
        for dimension in ("width", "height"):
            value = attrs.get(dimension, "") or ""
            if value.isdigit() and int(value) < 100:
                return
        candidate = attrs.get("data-src") or attrs.get("data-original") or attrs.get("data-lazy-src")
        if not candidate:
            srcset = attrs.get("data-srcset") or attrs.get("srcset")
            candidate = srcset.split(",")[-1].strip().split()[0] if srcset and srcset.strip() else attrs.get("src")
        if not candidate:
            return
        try:
            url = urljoin(self.url, candidate)
            parsed = urlsplit(url)
            host = parsed.hostname or ""
            if (parsed.scheme != "https" or not host or parsed.username or parsed.password
                    or parsed.port not in {None, 443} or len(url) > 4000
                    or host == "localhost" or host.endswith((".local", ".localhost"))):
                return
            try:
                if not ipaddress.ip_address(host).is_global:
                    return
            except ValueError:
                if "." not in host:
                    return
        except ValueError:
            return
        if any(image["url"] == url for image in self.images):
            return
        image = {"url": url, "alt": (attrs.get("alt") or "")[:500],
                 "caption": "", "heading": self.heading[:500], "word_offset": self.words}
        self.images.append(image)
        if self.figure_images is not None:
            self.figure_images.append(image)

    def handle_data(self, data):
        if not self.skip:
            self.words += len(data.split())
            if self.heading_parts is not None:
                self.heading_parts.append(data)
            if self.caption_parts is not None:
                self.caption_parts.append(data)
        super().handle_data(data)

    def handle_endtag(self, tag):
        if not self.skip:
            if tag in {"h1", "h2", "h3", "h4"} and self.heading_parts is not None:
                self.heading = " ".join(self.heading_parts).strip()
                self.heading_parts = None
            if tag == "figcaption" and self.caption_parts is not None:
                caption = " ".join(self.caption_parts).strip()[:500]
                for image in self.figure_images or []:
                    image["caption"] = caption
                self.caption_parts = None
            if tag == "figure":
                self.figure_images = None
        super().handle_endtag(tag)


def public_addresses(host):
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise SourceError("Source must resolve exclusively to public IP addresses")
    return addresses


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        # Preserve TLS hostname verification while connecting only to a vetted IP.
        addresses = public_addresses(self.host)
        last_error = None
        for family, kind, protocol, _, address in addresses:
            sock = socket.socket(family, kind, protocol)
            sock.settimeout(self.timeout)
            try:
                sock.connect(address)
                self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
                return
            except OSError as exc:
                sock.close()
                last_error = exc
        if last_error is not None:
            raise last_error
        raise SourceError("Could not connect to source")


def fetch(url: str, allowed_hosts: list[str], *, robots: bool = False):
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if (parsed.scheme != "https" or not host or parsed.username or parsed.password
            or parsed.port not in {None, 443}):
        raise SourceError("Remote sources require HTTPS on port 443 without credentials")
    if host not in {h.lower() for h in allowed_hosts}:
        raise SourceError("Source host is not in WALKTHROUGH_ALLOWED_SOURCE_HOSTS")
    path = urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
    connection = PinnedHTTPSConnection(host, timeout=10, context=ssl.create_default_context())
    try:
        connection.request("GET", path, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
        response = connection.getresponse()
        if robots and response.status == 404:
            return "", "text/plain"
        if response.status != 200:
            # Redirects are intentionally rejected: configure the canonical URL.
            raise SourceError(f"Source returned HTTP {response.status}; use a direct accessible URL")
        content_type = response.getheader("Content-Type", "").split(";", 1)[0].lower()
        if content_type not in {"text/html", "text/plain", "application/xhtml+xml"}:
            raise SourceError("Source must be HTML or plain text")
        if response.getheader("Content-Encoding", "identity").lower() != "identity":
            raise SourceError("Compressed responses are not supported")
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise SourceError("Source exceeds the 2 MB limit")
        charset = response.headers.get_content_charset() or "utf-8"
        return data.decode(charset, errors="replace"), content_type
    except socket.gaierror as exc:
        raise SourceError(f"Cannot resolve {host}. Check the backend computer's internet connection and DNS settings.") from exc
    except ssl.SSLCertVerificationError as exc:
        raise SourceError(f"Cannot verify the HTTPS certificate for {host}. Check your Python certificate installation or network proxy certificates.") from exc
    except (socket.timeout, TimeoutError) as exc:
        raise SourceError(f"Timed out fetching {host}. Retry the import shortly.") from exc
    except ssl.SSLError as exc:
        raise SourceError(f"HTTPS connection failed for {host}. Check your network or proxy configuration.") from exc
    except (OSError, http.client.HTTPException, LookupError, ValueError) as exc:
        if isinstance(exc, SourceError):
            raise
        if isinstance(exc, http.client.HTTPException):
            detail = "The site closed the connection or returned an invalid HTTP response."
        elif isinstance(exc, LookupError):
            detail = "The page uses an unsupported text encoding."
        else:
            detail = "The connection failed. Check your network and retry."
        raise SourceError(f"Unable to fetch {host}. {detail}") from exc
    finally:
        connection.close()


def fetch_guide(url: str, allowed_hosts: list[str]) -> tuple[str, list[dict]]:
    parsed = urlsplit(url)
    robots_url = urlunsplit((parsed.scheme, parsed.netloc, "/robots.txt", "", ""))
    try:
        robots_text, _ = fetch(robots_url, allowed_hosts, robots=True)
    except SourceError as exc:
        raise SourceError(f"Could not check robots.txt: {exc}") from exc
    policy = RobotFileParser()
    policy.parse(robots_text.splitlines())
    if not policy.can_fetch(USER_AGENT, url):
        raise SourceError("Source robots.txt disallows fetching this URL")
    try:
        content, kind = fetch(url, allowed_hosts)
    except SourceError as exc:
        raise SourceError(f"Could not download guide: {exc}") from exc
    images = []
    if kind != "text/plain":
        parser = GuideExtractor(url)
        parser.feed(content)
        content = " ".join(parser.parts)
        images = parser.images
    content = " ".join(content.split())
    if len(content) < 40:
        raise SourceError("Source contains too little readable walkthrough text")
    if len(content) > 500_000:
        raise SourceError("Extracted source exceeds 500,000 characters")
    return content, images


def fetch_walkthrough(url: str, allowed_hosts: list[str]) -> str:
    return fetch_guide(url, allowed_hosts)[0]


class LinkExtractor(TextExtractor):
    def __init__(self):
        super().__init__()
        self.links = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        super().handle_starttag(tag, attrs)
        if tag == "a" and not self.skip:
            self.current = [dict(attrs).get("href", ""), []]

    def handle_data(self, data):
        if self.current is not None and not self.skip:
            self.current[1].append(data)
        super().handle_data(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.current is not None:
            self.links.append((self.current[0], " ".join(self.current[1]).strip()))
            self.current = None
        super().handle_endtag(tag)


def discover_walkthrough(url: str, allowed_hosts: list[str]):
    parsed = urlsplit(url)
    # Restrict discovery to the index's containing section, never the whole host.
    prefix = parsed.path.rsplit("/", 1)[0] + "/"
    if prefix == "/":
        raise SourceError("Use an index inside a game-specific section, such as /wikis/elden-ring/Walkthrough.")
    robots_url = urlunsplit((parsed.scheme, parsed.netloc, "/robots.txt", "", ""))
    robots_text, _ = fetch(robots_url, allowed_hosts, robots=True)
    policy = RobotFileParser()
    policy.parse(robots_text.splitlines())
    if not policy.can_fetch(USER_AGENT, url):
        raise SourceError("Source robots.txt disallows fetching this URL")
    content, kind = fetch(url, allowed_hosts)
    if kind == "text/plain":
        raise SourceError("Walkthrough discovery requires an HTML index page.")
    parser = LinkExtractor()
    parser.feed(content)
    canonical = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    pages = [{"url": canonical, "title": "Walkthrough index"}]
    seen = {canonical}
    for href, title in parser.links:
        try:
            target = urlsplit(urljoin(url, href))
            if (target.scheme != "https" or target.netloc != parsed.netloc
                    or not target.path.startswith(prefix) or target.query
                    or any(part in {".", ".."} for part in target.path.split("/"))):
                continue
            page_url = urlunsplit((target.scheme, target.netloc, target.path, "", ""))
            if page_url in seen or not title or not policy.can_fetch(USER_AGENT, page_url):
                continue
            if re.search(r"\.(jpg|png|gif|webp|svg|pdf|zip)$", target.path, re.I):
                continue
            seen.add(page_url)
            pages.append({"url": page_url, "title": title[:300]})
            if len(pages) >= 100:
                break
        except ValueError:
            continue
    return {"pages": pages, "scope": parsed.netloc + prefix, "limit": 25}
