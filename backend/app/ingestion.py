"""Bounded HTTPS fetching; DNS addresses are checked and pinned per connection."""
import http.client
import ipaddress
import socket
import ssl
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit
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
        raise SourceError("Could not connect to source") from last_error


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
    except (OSError, http.client.HTTPException, LookupError, ValueError) as exc:
        if isinstance(exc, SourceError):
            raise
        raise SourceError("Unable to fetch source") from exc
    finally:
        connection.close()


def fetch_walkthrough(url: str, allowed_hosts: list[str]) -> str:
    parsed = urlsplit(url)
    robots_url = urlunsplit((parsed.scheme, parsed.netloc, "/robots.txt", "", ""))
    robots_text, _ = fetch(robots_url, allowed_hosts, robots=True)
    policy = RobotFileParser()
    policy.parse(robots_text.splitlines())
    if not policy.can_fetch(USER_AGENT, url):
        raise SourceError("Source robots.txt disallows fetching this URL")
    content, kind = fetch(url, allowed_hosts)
    if kind != "text/plain":
        parser = TextExtractor()
        parser.feed(content)
        content = " ".join(parser.parts)
    content = " ".join(content.split())
    if len(content) < 40:
        raise SourceError("Source contains too little readable walkthrough text")
    if len(content) > 500_000:
        raise SourceError("Extracted source exceeds 500,000 characters")
    return content
