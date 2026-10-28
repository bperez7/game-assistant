import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
from fastapi.testclient import TestClient

from app.api import create_app
from app.config import Settings
from app.ingestion import PinnedHTTPSConnection, SourceError, TextExtractor, fetch, fetch_walkthrough, public_addresses
from app.store import chunks


class BackendTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(database_path=Path(self.temp.name) / "test.db", admin_key="test-secret", _env_file=None)
        self.client = TestClient(create_app(self.settings))
        self.client.__enter__()
        self.headers = {"X-Admin-Key": "test-secret"}
        self.game = self.create_game("Lantern Quest", "lantern-quest")

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def create_game(self, title, slug):
        response = self.client.post("/api/games", json={"title": title, "slug": slug}, headers=self.headers)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def source(self, text=None, **extra):
        body = {"url": "https://guides.example/lantern", "title": "Lantern walkthrough",
                "text": text or "To defeat the crystal guardian, equip the silver shield. Block its beam, then strike the exposed crystal."}
        body.update(extra)
        response = self.client.post(f"/api/games/{self.game['id']}/sources", json=body, headers=self.headers)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def query(self, question="How do I defeat the crystal guardian?", **extra):
        return self.client.post(f"/api/games/{self.game['id']}/query", json={"question": question, **extra})

    def test_complete_workflow_and_persistence(self):
        source = self.source()
        answer = self.query().json()
        self.assertEqual(answer["status"], "answered")
        self.assertIn("silver shield", answer["answer"])
        self.assertEqual(answer["citations"][0]["source_id"], source["id"])
        self.assertEqual(answer["citations"][0]["url"], source["url"])
        self.assertEqual(len(self.client.get("/api/games?q=lantern").json()), 1)
        with TestClient(create_app(self.settings)) as other:
            self.assertEqual(len(other.get(f"/api/games/{self.game['id']}/sources").json()), 1)
        self.assertEqual(self.client.get("/api/health").json()["status"], "ok")
        self.assertEqual(self.client.get("/api/hello").status_code, 200)

    def test_game_isolation_and_unknown_game(self):
        self.source()
        game = self.create_game("Other Game", "other")
        response = self.client.post(f"/api/games/{game['id']}/query", json={"question": "crystal guardian"})
        self.assertEqual(response.json()["status"], "insufficient_context")
        self.assertEqual(self.client.post("/api/games/missing/query", json={"question": "guardian"}).status_code, 404)

    def test_upsert_and_delete_remove_stale_passages(self):
        old = self.source()
        new = self.source("Sail across the ocean to find the hidden island. Bring a compass and follow the northern stars.")
        self.assertEqual(old["id"], new["id"])
        self.assertEqual(self.query("crystal guardian").json()["status"], "insufficient_context")
        self.assertEqual(self.query("hidden island").json()["status"], "answered")
        path = f"/api/games/{self.game['id']}/sources/{old['id']}"
        self.assertEqual(self.client.delete(path, headers=self.headers).status_code, 204)
        self.assertEqual(self.query("hidden island").json()["citations"], [])
        self.assertEqual(self.client.delete(path, headers=self.headers).status_code, 404)

    def test_validation_and_admin_auth(self):
        self.assertEqual(self.client.post("/api/games", json={"title": "Game", "slug": "game"}).status_code, 401)
        self.assertEqual(self.client.post("/api/games", json={"title": " ", "slug": "bad slug"}, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.post("/api/games", json={"title": "Duplicate", "slug": "lantern-quest"}, headers=self.headers).status_code, 409)
        for body in ({"question": " "}, {"question": "guardian", "top_k": 50}, {"question": "guardian", "mode": "unknown"}):
            self.assertEqual(self.client.post(f"/api/games/{self.game['id']}/query", json=body).status_code, 422)

    def test_filters_and_source_diversity(self):
        first = self.source(platform="PC", version="1.0")
        second = self.source(url="https://other.example/guide", title="Another guide", platform="Switch", version="2.0")
        answer = self.query().json()
        self.assertEqual({c["source_id"] for c in answer["citations"]}, {first["id"], second["id"]})
        self.assertEqual(len(self.query(platform="PC", version="1.0").json()["citations"]), 1)
        self.assertEqual(self.query(platform="PC", version="2.0").json()["status"], "insufficient_context")

    def test_no_results_and_fts_injection(self):
        self.source()
        for question in ("quantum bananas", '" OR * --', "how do I"):
            self.assertEqual(self.query(question).json()["status"], "insufficient_context")

    def test_unconfigured_generation(self):
        self.source()
        self.assertEqual(self.query(mode="generate").status_code, 503)

    def test_generated_answer_and_invalid_citations(self):
        self.source()
        self.settings.ollama_model = "test-model"
        response = Mock()
        response.json.return_value = {"done": True, "message": {"content": json.dumps({
            "answer": "Use the silver shield [1].", "citation_numbers": [1]})}}
        with patch("app.answers.httpx.Client") as client:
            client.return_value.__enter__.return_value.post.return_value = response
            result = self.query(mode="generate")
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()["answer"], "Use the silver shield [1].")
            response.json.return_value["message"]["content"] = json.dumps({"answer": "Invented [99].", "citation_numbers": [99]})
            self.assertEqual(self.query(mode="generate").status_code, 502)
            response.json.return_value = {"done": False, "message": {"content": "{}"}}
            self.assertEqual(self.query(mode="generate").status_code, 502)
            client.return_value.__enter__.return_value.post.side_effect = httpx.ConnectError("offline")
            self.assertEqual(self.query(mode="generate").status_code, 502)

    def test_remote_ingestion_disabled_by_default(self):
        response = self.client.post(f"/api/games/{self.game['id']}/sources", json={
            "url": "https://guides.example/guide", "title": "Guide"}, headers=self.headers)
        self.assertEqual(response.status_code, 422)


class IngestionTest(unittest.TestCase):
    def test_chunk_coverage(self):
        words = [f"word{i}" for i in range(500)]
        result = chunks(" ".join(words))
        self.assertEqual(len(result), 4)
        self.assertTrue(all(len(p.split()) <= 180 for p in result))
        self.assertEqual(set(" ".join(result).split()), set(words))

    def test_html_removes_scripts_and_navigation(self):
        parser = TextExtractor()
        parser.feed("<nav>Home</nav><script>evil()</script><h1>Boss</h1><p>Block &amp; strike.</p>")
        text = " ".join(parser.parts)
        self.assertIn("Block & strike.", text)
        self.assertNotIn("evil", text)
        self.assertNotIn("Home", text)

    def test_public_dns_check_rejects_private_and_mixed_addresses(self):
        for addresses in (["127.0.0.1"], ["::1"], ["169.254.169.254"], ["93.184.216.34", "10.0.0.1"]):
            with patch("app.ingestion.socket.getaddrinfo", return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443)) for address in addresses
            ]):
                with self.assertRaises(SourceError):
                    public_addresses("example.com")

    def test_connection_pins_address_and_keeps_tls_hostname(self):
        addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        with patch("app.ingestion.public_addresses", return_value=addresses), patch("app.ingestion.socket.socket") as sock:
            connection = PinnedHTTPSConnection("example.com", timeout=10)
            with patch.object(connection._context, "wrap_socket") as wrap:
                connection.connect()
                sock.return_value.connect.assert_called_once_with(("93.184.216.34", 443))
                wrap.assert_called_once_with(sock.return_value, server_hostname="example.com")

    def test_fetch_requires_exact_allowlisted_https_host(self):
        for url in ("http://example.com", "https://example.com:444", "https://user:pass@example.com", "https://sub.example.com"):
            with self.assertRaises(SourceError):
                fetch(url, ["example.com"])

    def test_robots_policy_and_extraction(self):
        with patch("app.ingestion.fetch", return_value=("User-agent: *\nDisallow: /", "text/plain")) as mocked:
            with self.assertRaises(SourceError):
                fetch_walkthrough("https://example.com/guide", ["example.com"])
            self.assertEqual(mocked.call_count, 1)
        with patch("app.ingestion.fetch", side_effect=[("", "text/plain"), (
            "<p>Defeat the guardian by blocking the beam with your shield and striking its crystal.</p>", "text/html")]):
            self.assertIn("blocking the beam", fetch_walkthrough("https://example.com/guide", ["example.com"]))

    def test_fetch_rejects_redirects_and_oversized_content(self):
        with patch("app.ingestion.PinnedHTTPSConnection") as connection:
            response = connection.return_value.getresponse.return_value
            response.status = 302
            with self.assertRaises(SourceError):
                fetch("https://example.com/guide", ["example.com"])
            response.status = 200
            response.getheader.side_effect = lambda name, default=None: {
                "Content-Type": "text/html", "Content-Encoding": "identity"}.get(name, default)
            response.read.return_value = b"a" * 2_000_001
            with self.assertRaises(SourceError):
                fetch("https://example.com/guide", ["example.com"])


if __name__ == "__main__":
    unittest.main()
