import contextlib
import hashlib
import io
import json
import tempfile
import unittest
import zipfile
from email.parser import BytesParser
from email.policy import default
from pathlib import Path
from unittest.mock import patch

import requests

from photos_pcloud.__main__ import main
from photos_pcloud.migrate import bind, transfer, verify
from photos_pcloud.pcloud import AuthError, PCloud, TemporaryError, TransferError, save_config
from photos_pcloud.state import State, exclusive
from photos_pcloud.takeout import UploadStream, open_source, scan


class FakeCloud:
    """Persistent remote service, independent of the SQLite connection."""
    host = "eapi.pcloud.com"
    attempts = 2

    def __init__(self):
        self.userid = 12
        self.folders = {0: {"name": "/", "parent": None}}
        self.files = {}
        self.nextid = 1
        self.uploads = 0
        self.lose_receipt = False
        self.crash_after_commit = False
        self.fail_before_commit = False
        self.reject_token = False

    def call(self, method, **parameters):
        if self.reject_token:
            raise AuthError("Connexion requise.")
        if method == "userinfo":
            return {"userid": self.userid, "quota": 2_000_000_000_000, "usedquota": 0}
        if method == "listfolder":
            if parameters["folderid"] not in self.folders:
                raise TransferError("Dossier absent")
            return {"metadata": {"contents": self.contents(parameters["folderid"])}}
        raise AssertionError(method)

    def folder(self, parent, name):
        for key, item in self.folders.items():
            if item == {"parent": parent, "name": name}:
                return key
        key = self.nextid
        self.nextid += 1
        self.folders[key] = {"parent": parent, "name": name}
        return key

    def contents(self, folderid):
        return [{"fileid": key, "isfolder": False, "name": item["name"], "size": len(item["bytes"])}
                for key, item in self.files.items() if item["folderid"] == folderid]

    def upload(self, obj, stream, folderid):
        self.uploads += 1
        payload = bytearray()
        while chunk := stream.read(16384):
            payload.extend(chunk)
        if self.fail_before_commit:
            raise TemporaryError("Connexion perdue avant réception")
        key = self.nextid
        self.nextid += 1
        self.files[key] = {"name": obj["name"], "folderid": folderid, "bytes": bytes(payload)}
        if self.crash_after_commit:
            self.crash_after_commit = False
            raise KeyboardInterrupt()
        if self.lose_receipt:
            self.lose_receipt = False
            raise TemporaryError("Réponse perdue après réception")
        return key

    def matches(self, obj, fileid, deep=False):
        item = self.files.get(fileid)
        return bool(item and hashlib.sha256(item["bytes"]).hexdigest() == obj["sha256"])


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = State(self.root / "state.sqlite3")
        self.cloud = FakeCloud()
        self.quiet = contextlib.redirect_stdout(io.StringIO())
        self.quiet.__enter__()

    def tearDown(self):
        self.state.close()
        self.quiet.__exit__(None, None, None)
        self.temp.cleanup()

    def archive(self, name="part1.zip", entries=None):
        path = self.root / name
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for member, payload in (entries or {"Takeout/Google Photos/2020/été.jpg": b"photo"}).items():
                archive.writestr(member, payload)
        return path

    def obj(self):
        return self.state.db.execute("SELECT * FROM objects LIMIT 1").fetchone()

    def test_full_transfer_dedup_collision_dates_and_reports(self):
        path = self.archive(entries={
            "Takeout/Google Photos/2020/été.jpg": b"photo1",
            "Takeout/Google Photos/album/été.jpg": b"photo1",
            "Takeout/Google Photos/2021/été.jpg": b"photo2",
            "Takeout/Google Photos/2020/été.jpg.supplemental-metadata.json": json.dumps({
                "title": "été.jpg", "photoTakenTime": {"timestamp": "1580000000"}}).encode(),
            "Takeout/Google Photos/2020/video.MOV": b"video",
            "Takeout/Google Photos/2020/unknown.xyz": b"unknown",
            "archive_browser.html": b"<html></html>",
        })
        scan(self.state, [path])
        self.assertEqual(self.state.db.execute("SELECT count(*) FROM sources").fetchone()[0], 7)
        self.assertEqual(sum(self.state.counts().values()), 6)
        media = self.state.db.execute("SELECT * FROM objects WHERE sha256=?", (hashlib.sha256(b"photo1").hexdigest(),)).fetchone()
        self.assertEqual(media["captured"], 1580000000)
        self.assertTrue(transfer(self.state, self.cloud, "Mes photos"))
        self.assertEqual(self.cloud.uploads, 6)
        self.assertEqual(len(self.cloud.files), 6)
        self.assertEqual(sum(item["name"] == "été.jpg" for item in self.cloud.files.values()), 2)
        self.assertTrue(transfer(self.state, self.cloud))
        self.assertEqual(self.cloud.uploads, 6)
        self.assertTrue(verify(self.state, self.cloud, deep=True))
        self.state.report(self.root / "reports")
        summary = json.loads((self.root / "reports/summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["counts"], {"verified": 6})
        self.assertEqual(summary["source_entries"], 7)

    @patch("photos_pcloud.migrate.pause")
    def test_lost_receipt_reconciled_without_second_upload(self, pause):
        scan(self.state, [self.archive()])
        self.cloud.lose_receipt = True
        self.assertTrue(transfer(self.state, self.cloud, "Photos"))
        self.assertEqual(self.cloud.uploads, 1)
        self.assertEqual(len(self.cloud.files), 1)

    def test_hard_interruption_after_remote_commit_then_restart(self):
        path = self.archive()
        scan(self.state, [path])
        self.cloud.crash_after_commit = True
        with self.assertRaises(KeyboardInterrupt):
            transfer(self.state, self.cloud, "Photos")
        self.assertEqual(self.state.counts(), {"uploading": 1})
        self.state.close()
        self.state = State(self.root / "state.sqlite3")
        # Reconciliation does not even need the source archive after commit.
        path.unlink()
        rootid = self.state.get("binding")["folderid"]
        self.cloud.folders[rootid]["name"] = "Nom modifié librement"
        self.assertTrue(transfer(self.state, self.cloud))
        self.assertEqual(self.cloud.uploads, 1)

    @patch("photos_pcloud.migrate.pause")
    def test_network_failure_then_resume(self, pause):
        scan(self.state, [self.archive()])
        self.cloud.fail_before_commit = True
        with self.assertRaises(TemporaryError):
            transfer(self.state, self.cloud, "Photos")
        self.assertEqual(self.state.counts(), {"error": 1})
        self.cloud.fail_before_commit = False
        self.assertTrue(transfer(self.state, self.cloud))
        self.assertEqual(len(self.cloud.files), 1)

    def test_corrupt_remote_never_overwritten_and_verify_fails(self):
        scan(self.state, [self.archive()])
        transfer(self.state, self.cloud, "Photos")
        fileid = self.obj()["fileid"]
        self.cloud.files[fileid]["bytes"] = b"CORRUPTION"
        self.assertFalse(verify(self.state, self.cloud))
        self.assertFalse(transfer(self.state, self.cloud))
        self.assertEqual(self.cloud.uploads, 1)
        self.assertEqual(self.cloud.files[fileid]["bytes"], b"CORRUPTION")

    def test_auth_failure_preserves_state_and_wrong_account_is_rejected(self):
        scan(self.state, [self.archive()])
        bind(self.state, self.cloud, "Photos")
        self.cloud.reject_token = True
        with self.assertRaises(AuthError):
            transfer(self.state, self.cloud)
        self.assertEqual(self.state.counts(), {"pending": 1})
        self.cloud.reject_token = False
        self.cloud.userid = 99
        with self.assertRaises(TransferError):
            transfer(self.state, self.cloud)

    def test_second_archive_incremental_and_moved_archive(self):
        path = self.archive()
        scan(self.state, [path])
        transfer(self.state, self.cloud, "Photos")
        moved = path.rename(self.root / "renamed.zip")
        scan(self.state, [moved])
        second = self.archive("part2.zip", {"album/copy.jpg": b"photo", "album/next.jpg": b"next"})
        scan(self.state, [second])
        self.assertTrue(transfer(self.state, self.cloud))
        self.assertEqual(self.cloud.uploads, 2)

    def test_conflicting_dates_never_guessed(self):
        path = self.archive(entries={
            "2020/a.jpg": b"same",
            "2021/a.jpg": b"same",
            "2020/a.json": json.dumps({"title": "a.jpg", "photoTakenTime": {"timestamp": "1"}}),
            "2021/a.json": json.dumps({"title": "a.jpg", "photoTakenTime": {"timestamp": "2"}}),
        })
        scan(self.state, [path])
        obj = self.state.db.execute("SELECT * FROM objects WHERE category='Medias'").fetchone()
        self.assertIsNone(obj["captured"])

    def test_crc_failure_cannot_complete_inventory(self):
        path = self.root / "bad.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as archive:
            archive.writestr("photo.jpg", b"unique-original-photo-payload")
        raw = path.read_bytes().replace(b"unique-original-photo-payload", b"broken-original-photo-payload")
        path.write_bytes(raw)
        with self.assertRaises(zipfile.BadZipFile):
            scan(self.state, [path])
        self.assertEqual(self.state.db.execute("SELECT complete FROM archives").fetchone()[0], 0)
        with self.assertRaises(TransferError):
            transfer(self.state, self.cloud, "Photos")

    def test_changed_source_cannot_be_uploaded(self):
        path = self.archive()
        scan(self.state, [path])
        with path.open("ab") as output:
            output.write(b"change")
        with self.assertRaises(RuntimeError):
            with open_source(self.state, self.obj()):
                pass

    def test_upload_source_hash_is_checked_even_if_crc_matches(self):
        scan(self.state, [self.archive()])
        # Simulate a faulty decoder returning equal-size wrong bytes despite CRC.
        with patch("zipfile.ZipFile.open", return_value=io.BytesIO(b"other")):
            with self.assertRaisesRegex(RuntimeError, "octets envoyés"):
                with open_source(self.state, self.obj()) as source:
                    while source.read(1024):
                        pass

    def test_lock_and_configuration_atomic_save(self):
        with exclusive(self.root / "lock-state"):
            with self.assertRaises(RuntimeError):
                with exclusive(self.root / "lock-state"):
                    pass
        with exclusive(self.root / "lock-state"):
            pass
        path = self.root / "config.json"
        save_config(path, {"access_token": "secret"})
        self.assertEqual(json.loads(path.read_text())["access_token"], "secret")

    def test_multipart_stream_wire_and_timestamps(self):
        # Exercise the real encoder, including non-ASCII names and zero length.
        for payload in (b"", b"x" * (2 * 1024 * 1024 + 11)):
            client = PCloud({"hostname": "eapi.pcloud.com", "access_token": "secret"})
            obj = {"name": "été.mov", "captured": 1580000000}
            stream = UploadStream(io.BytesIO(payload), len(payload))
            response = requests.Response()
            response.status_code = 200
            response._content = b'{"result":0,"metadata":[{"fileid":12}]}'

            def post(url, data, headers, **kwargs):
                chunks = []
                while chunk := data.read(16384):
                    self.assertLessEqual(len(chunk), 16384)
                    chunks.append(chunk)
                message = BytesParser(policy=default).parsebytes(
                    ("Content-Type: " + headers["Content-Type"] + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + b"".join(chunks))
                parts = list(message.iter_parts())
                self.assertEqual(parts[-1].get_filename(), "été.mov")
                self.assertEqual(parts[-1].get_payload(decode=True), payload)
                parameters = {part.get_param("name", header="Content-Disposition"): part.get_payload()
                              for part in parts[:-1]}
                self.assertEqual(parameters["nopartial"], "1")
                self.assertEqual(parameters["mtime"], "1580000000")
                self.assertEqual(parameters["access_token"], "secret")
                self.assertNotIn("secret", url)
                return response

            with patch.object(client.session, "post", side_effect=post):
                self.assertEqual(client.upload(obj, stream, 1), 12)
            self.assertEqual(stream.count, len(payload))
            self.assertEqual(stream.sha256.hexdigest(), hashlib.sha256(payload).hexdigest())
            client.close()

    def test_eu_sha256_and_us_readback(self):
        client = PCloud({"hostname": "eapi.pcloud.com", "access_token": "secret"})
        obj = {"size": 3, "sha1": hashlib.sha1(b"abc").hexdigest(), "sha256": hashlib.sha256(b"abc").hexdigest()}
        result = {"metadata": {"size": 3}, "sha1": obj["sha1"], "sha256": obj["sha256"]}
        with patch.object(client, "call", return_value=result), patch.object(client, "download_hash", return_value=obj["sha256"]) as readback:
            self.assertTrue(client.matches(obj, 12))
            readback.assert_not_called()
            self.assertTrue(client.matches(obj, 12, deep=True))
            del result["sha256"]
            self.assertTrue(client.matches(obj, 12))
            self.assertEqual(readback.call_count, 2)
            result["sha1"] = "wrong"
            self.assertFalse(client.matches(obj, 12))
        client.close()

    def test_http_retries_do_not_expose_tokens(self):
        client = PCloud({"hostname": "eapi.pcloud.com", "access_token": "TOPSECRET", "attempts": 2})
        response = requests.Response()
        response.status_code = 429
        response._content = b""
        response._content_consumed = True
        response.headers["Retry-After"] = "2"
        with patch.object(client.session, "post", return_value=response), patch("photos_pcloud.pcloud.pause") as pause:
            with self.assertRaises(TemporaryError) as caught:
                client.call("userinfo")
            self.assertNotIn("TOPSECRET", str(caught.exception))
            self.assertEqual(pause.call_count, 1)
        response.status_code = 401
        with patch.object(client.session, "post", return_value=response):
            with self.assertRaises(AuthError):
                client.call("userinfo")
        client.close()

    def test_cli_offline_scan_and_status(self):
        path = self.archive()
        args = ["--state", str(self.root / "cli.sqlite3"), "--reports", str(self.root / "cli-reports")]
        self.assertEqual(main(args + ["scan", str(path)]), 0)
        self.assertEqual(main(args + ["status"]), 0)
        self.assertTrue((self.root / "cli-reports/manifest.csv").exists())


if __name__ == "__main__":
    unittest.main()
