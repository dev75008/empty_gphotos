"""Exercise real loopback HTTP, subprocess scans, authorization and isolation."""
import json
import tempfile
import threading
import time
import unittest
import zipfile
from pathlib import Path

import requests

from photos_pcloud.pcloud import save_config
from photos_pcloud.web import Companion, make_server


class WebTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.companion = Companion(self.root / "config.json", self.root / "state.sqlite3", self.root / "reports", 0)
        self.server = make_server(self.companion, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = self.companion.local_origin
        self.headers = {"Authorization": "Bearer " + self.companion.token,
                        "Origin": "https://dev75008.github.io"}

    def tearDown(self):
        self.companion.stop()
        if self.companion.reader:
            self.companion.reader.join(timeout=10)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.temp.cleanup()

    def test_authentication_cors_and_host_validation(self):
        response = requests.get(self.base + "/api/status", timeout=5)
        self.assertEqual(response.status_code, 401)
        response = requests.get(self.base + "/api/status", headers=self.headers, timeout=5)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://dev75008.github.io")
        for changed in ({"Origin": "https://evil.example"}, {"Host": "evil.example"}, {"Authorization": "Bearer wrong"}):
            response = requests.get(self.base + "/api/status", headers={**self.headers, **changed}, timeout=5)
            self.assertIn(response.status_code, (401, 403))
        response = requests.options(self.base + "/api/settings", headers=self.headers, timeout=5)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers["Access-Control-Allow-Private-Network"], "true")

    def test_static_files_do_not_expose_project_or_secrets(self):
        save_config(self.companion.config, {"hostname": "eapi.pcloud.com", "client_id": "myid",
                    "client_secret": "NEVER-EXPOSE-SECRET", "access_token": "NEVER-EXPOSE-TOKEN"})
        for path in ("/config.json", "/state.sqlite3", "/README.md", "/photos_pcloud/pcloud.py", "/../config.json"):
            self.assertEqual(requests.get(self.base + path, timeout=5).status_code, 404)
        for path in ("/", "/app.js", "/model.js", "/style.css"):
            response = requests.get(self.base + path, timeout=5)
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("NEVER-EXPOSE", response.text)
        response = requests.get(self.base + "/api/status", headers=self.headers, timeout=5)
        self.assertNotIn("NEVER-EXPOSE", response.text)
        self.assertNotIn("client_secret", response.text)

    def test_settings_validate_paths_and_keep_secrets_local(self):
        path = self.root / "été.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("photo.jpg", b"photo")
        response = requests.post(self.base + "/api/settings", headers=self.headers,
                                 json={"paths": [str(path)], "folder": "Mes images", "client_id": "id", "client_secret": "secret"}, timeout=5)
        self.assertEqual(response.status_code, 200)
        config = json.loads(self.companion.config.read_text(encoding="utf-8"))
        self.assertEqual(config["client_secret"], "secret")
        response = requests.get(self.base + "/api/status", headers=self.headers, timeout=5)
        self.assertEqual(response.json()["settings"]["folder"], "Mes images")
        self.assertTrue(response.json()["pcloud"]["configured"])
        response = requests.post(self.base + "/api/settings", headers=self.headers,
                                 json={"paths": [str(self.root / "missing.zip")]}, timeout=5)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.companion.settings()["paths"], [str(path)])

    def test_real_scan_subprocess_progress_and_downloadable_report(self):
        path = self.root / "takeout.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("Google Photos/été.jpg", b"same")
            archive.writestr("Google Photos/album/copie.jpg", b"same")
        self.companion.save_settings({"paths": [str(path)]})
        response = requests.post(self.base + "/api/start", headers=self.headers, json={"command": "scan"}, timeout=5)
        self.assertEqual(response.status_code, 200)
        deadline = time.monotonic() + 15
        while self.companion.status()["job"]["running"] and time.monotonic() < deadline:
            time.sleep(0.05)
        status = requests.get(self.base + "/api/status", headers=self.headers, timeout=5).json()
        self.assertFalse(status["job"]["running"])
        self.assertEqual(status["job"]["exit_code"], 0)
        self.assertEqual(status["database"]["total"], 1)
        self.assertEqual(status["database"]["source_entries"], 2)
        self.assertEqual(status["database"]["archives"][0]["complete"], 1)
        self.assertEqual(status["database"]["archives"][0]["remaining"], 1)
        self.assertTrue(any("Lecture" in line for line in status["logs"]))
        response = requests.get(self.base + "/api/manifest", headers=self.headers, timeout=5)
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response.headers["Content-Disposition"])
        self.assertIn("sha256", response.content.decode("utf-8-sig"))

    def test_invalid_commands_and_concurrent_operations_rejected(self):
        for body in ({"command": "delete"}, {"command": "scan"}):
            response = requests.post(self.base + "/api/start", headers=self.headers, json=body, timeout=5)
            self.assertEqual(response.status_code, 400)
        self.companion.job["running"] = True
        response = requests.post(self.base + "/api/start", headers=self.headers, json={"command": "scan"}, timeout=5)
        self.assertEqual(response.status_code, 409)
        response = requests.post(self.base + "/api/settings", headers=self.headers, json={"folder": "Other"}, timeout=5)
        self.assertEqual(response.status_code, 409)
        self.companion.job["running"] = False


if __name__ == "__main__":
    unittest.main()
