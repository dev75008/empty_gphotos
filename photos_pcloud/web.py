"""Loopback-only companion for the GitHub Pages UI, using the existing CLI engine."""
import collections
from contextlib import closing
import json
import mimetypes
import os
import secrets
import sqlite3
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

from .pcloud import load_config, save_config
from .state import exclusive

SITE = "https://dev75008.github.io/empty_gphotos/"
ORIGIN = "https://dev75008.github.io"
ASSETS = Path(__file__).resolve().parent.parent / "docs"


class WebError(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


class Companion:
    def __init__(self, config, state, reports, port):
        self.config = Path(config).resolve()
        self.state = Path(state).resolve()
        self.reports = Path(reports).resolve()
        self.preferences = self.state.parent / "web-settings.json"
        self.port = port
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.process = None
        self.job = {"command": None, "running": False, "exit_code": None, "paused": False}
        self.logs = collections.deque(maxlen=160)
        self.log_sequence = 0
        self.reader = None

    @property
    def local_origin(self):
        return f"http://127.0.0.1:{self.port}"

    def settings(self):
        if not self.preferences.exists():
            return {"paths": [], "folder": "Ma phototheque"}
        return json.loads(self.preferences.read_text(encoding="utf-8"))

    def config_data(self):
        if self.config.exists():
            return load_config(self.config)
        return {"client_id": "", "client_secret": "", "access_token": "",
                "hostname": "eapi.pcloud.com", "redirect_uri": "http://127.0.0.1:8765/callback", "attempts": 6}

    def require_idle(self):
        if self.job["running"]:
            raise WebError("Une opération est en cours. Mettez-la en pause avant de modifier la préparation.", 409)

    def save_settings(self, data):
        with self.lock:
            self.require_idle()
            settings = self.settings()
            if "paths" in data:
                paths = data["paths"]
                if not isinstance(paths, list) or not all(isinstance(p, str) and p for p in paths):
                    raise WebError("Choisissez des archives ZIP ou un dossier.")
                for path in paths:
                    item = Path(path)
                    if not item.exists() or (not item.is_dir() and item.suffix.lower() != ".zip"):
                        raise WebError("Un chemin est absent ou ne désigne pas une archive ZIP.")
                settings["paths"] = paths
            if "folder" in data:
                if not isinstance(data["folder"], str) or not data["folder"].strip():
                    raise WebError("Indiquez un nom de dossier pCloud.")
                settings["folder"] = data["folder"].strip()
            self.preferences.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.preferences.with_suffix(".tmp")
            temporary.write_text(json.dumps(settings, ensure_ascii=False), encoding="utf-8")
            temporary.replace(self.preferences)
            if "client_id" in data or "client_secret" in data:
                config = self.config_data()
                changed = False
                for key in ("client_id", "client_secret"):
                    value = data.get(key, "")
                    if not isinstance(value, str) or len(value) > 4096:
                        raise WebError("Identifiant pCloud invalide.")
                    if value.strip() and value.strip() != config.get(key):
                        config[key] = value.strip()
                        changed = True
                if changed:
                    config["access_token"] = ""
                    config.pop("userid", None)
                save_config(self.config, config)

    def database(self):
        result = {"counts": {}, "total": 0, "verified": 0, "remaining": 0, "errors": 0,
                  "source_entries": 0, "bytes": 0, "verified_bytes": 0, "archives": [],
                  "binding": None, "error_rows": []}
        if not self.state.exists():
            return result
        try:
            with closing(sqlite3.connect(self.state.as_uri() + "?mode=ro", uri=True, timeout=2)) as database:
                database.row_factory = sqlite3.Row
                database.execute("BEGIN")
                counts = dict(database.execute("SELECT status,count(*) FROM objects GROUP BY status").fetchall())
                result["counts"] = counts
                result["total"] = sum(counts.values())
                result["verified"] = counts.get("verified", 0)
                result["remaining"] = result["total"] - result["verified"]
                result["errors"] = counts.get("error", 0)
                result["source_entries"] = database.execute("SELECT count(*) FROM sources").fetchone()[0]
                result["bytes"] = database.execute("SELECT coalesce(sum(size),0) FROM objects").fetchone()[0]
                result["verified_bytes"] = database.execute("SELECT coalesce(sum(size),0) FROM objects WHERE status='verified'").fetchone()[0]
                result["archives"] = [dict(row) for row in database.execute("""SELECT a.id,a.path,a.complete,
                    (SELECT count(DISTINCT s.sha256) FROM sources s JOIN objects o USING(sha256)
                     WHERE s.archive=a.id AND o.status!='verified') AS remaining
                    FROM archives a ORDER BY a.path""")]
                binding = database.execute("SELECT value FROM settings WHERE key='binding'").fetchone()
                result["binding"] = json.loads(binding[0]) if binding else None
                result["error_rows"] = [dict(row) for row in database.execute(
                    "SELECT name,error FROM objects WHERE status='error' LIMIT 10")]
        except sqlite3.OperationalError:
            # A very first scan may not have created its schema yet. Other errors
            # must never be represented as an empty successful inventory.
            if self.job["running"] and self.job["command"] == "scan":
                result["loading"] = True
            else:
                raise WebError("Le journal local est illisible. Consultez le terminal et conservez sa sauvegarde.", 503)
        return result

    def status(self):
        with self.lock:
            config = self.config_data()
            configured = all(config.get(key) and not config[key].startswith("VOTRE_") for key in ("client_id", "client_secret"))
            return {"version": 1, "settings": self.settings(), "database": self.database(),
                    "pcloud": {"configured": bool(configured), "connected": bool(config.get("access_token")),
                               "userid": config.get("userid"), "hostname": config["hostname"]},
                    "job": dict(self.job), "logs": list(self.logs), "log_sequence": self.log_sequence}

    def start(self, command, deep=False):
        with self.lock:
            self.require_idle()
            if command not in {"auth", "scan", "run", "verify"}:
                raise WebError("Opération inconnue.")
            arguments = [sys.executable, "-u", "-m", "photos_pcloud", "--config", str(self.config),
                         "--state", str(self.state), "--reports", str(self.reports), command]
            settings = self.settings()
            if command == "scan":
                if not settings.get("paths"):
                    raise WebError("Choisissez vos archives Takeout avant leur analyse.")
                arguments += settings["paths"]
            elif command == "run" and not self.database()["binding"]:
                arguments += ["--folder", settings["folder"]]
            elif command == "verify" and deep:
                arguments += ["--deep"]
            environment = os.environ.copy()
            environment["PYTHONIOENCODING"] = "utf-8"
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            self.process = subprocess.Popen(arguments, cwd=ASSETS.parent, env=environment,
                                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                            stdin=subprocess.DEVNULL, text=True, encoding="utf-8",
                                            errors="replace", creationflags=flags)
            self.job = {"command": command, "running": True, "exit_code": None, "paused": False}
            self.logs.clear()
            self.reader = threading.Thread(target=self._collect, args=(self.process,), daemon=True)
            self.reader.start()

    def _collect(self, process):
        try:
            for line in process.stdout:
                with self.lock:
                    self.logs.append(line.rstrip())
                    self.log_sequence += 1
            code = process.wait()
            with self.lock:
                self.job["running"] = False
                self.job["exit_code"] = code
        finally:
            process.stdout.close()

    def stop(self):
        with self.lock:
            if self.process and self.job["running"]:
                self.job["paused"] = True
                self.process.terminate()
        # A forcibly stopped child is still safe: SQLite commits and remote
        # reconciliation belong to the existing engine, not the web process.

    def pick(self):
        with self.lock:
            self.require_idle()
        code = """import json,tkinter as tk
from tkinter import filedialog
root=tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
paths=filedialog.askopenfilenames(title='Choisir les archives Google Takeout', filetypes=[('Archives ZIP','*.zip')])
print(json.dumps(list(paths))); root.destroy()
"""
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                                    encoding="utf-8", timeout=300, creationflags=flags,
                                    env={**os.environ, "PYTHONIOENCODING": "utf-8"})
            if result.returncode:
                raise WebError("Le sélecteur de fichiers est indisponible. Utilisez la saisie du chemin.")
            paths = json.loads(result.stdout)
        except subprocess.TimeoutExpired:
            raise WebError("Sélection annulée après cinq minutes.") from None
        if paths:
            self.save_settings({"paths": paths})
        return paths


def make_server(companion, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def origin_allowed(self):
            return self.headers.get("Origin") in {None, ORIGIN, companion.local_origin}

        def authorized(self):
            host = self.headers.get("Host")
            if host != f"127.0.0.1:{companion.port}" or not self.origin_allowed():
                raise WebError("Origine non autorisée.", 403)
            supplied = self.headers.get("Authorization", "")
            if not secrets.compare_digest(supplied, "Bearer " + companion.token):
                raise WebError("Ouvrez l'interface depuis le compagnon local pour la connecter.", 401)

        def send(self, status, body, content_type="application/json; charset=utf-8", attachment=None):
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin and self.origin_allowed():
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            if attachment:
                self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
            self.end_headers()
            self.wfile.write(body)

        def respond(self, status, data):
            self.send(status, json.dumps(data, ensure_ascii=False).encode())

        def do_OPTIONS(self):
            if not self.origin_allowed() or self.headers.get("Host") != f"127.0.0.1:{companion.port}":
                self.respond(403, {"error": "Origine non autorisée."})
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", companion.local_origin))
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")
            self.end_headers()

        def do_GET(self):
            try:
                path = urlparse(self.path).path
                if path.startswith("/api/"):
                    self.authorized()
                    if path == "/api/status":
                        self.respond(200, companion.status())
                    elif path in {"/api/manifest", "/api/summary"}:
                        name = "manifest.csv" if path.endswith("manifest") else "summary.json"
                        report = companion.reports / name
                        if not report.is_file():
                            raise WebError("Le rapport sera disponible après la première analyse terminée.", 404)
                        self.send(200, report.read_bytes(), "text/csv; charset=utf-8" if name.endswith("csv") else "application/json", name)
                    else:
                        raise WebError("Page inconnue.", 404)
                    return
                # Serve exactly the public UI files, never project data/secrets.
                names = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js",
                         "/style.css": "style.css", "/model.js": "model.js", "/favicon.svg": "favicon.svg",
                         "/assets/geist-latin.woff2": "assets/geist-latin.woff2"}
                if path not in names:
                    raise WebError("Page inconnue.", 404)
                file = ASSETS / names[path]
                self.send(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] or "application/octet-stream")
            except WebError as error:
                self.respond(error.code, {"error": str(error)})
            except (OSError, ValueError, RuntimeError) as error:
                self.respond(400, {"error": str(error)})

        def do_POST(self):
            try:
                self.authorized()
                if self.headers.get_content_type() != "application/json":
                    raise WebError("Une requête JSON est attendue.", 415)
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 65536:
                    raise WebError("Requête trop volumineuse ou vide.", 413)
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise WebError("Une requête JSON objet est attendue.")
                path = urlparse(self.path).path
                if path == "/api/settings":
                    companion.save_settings(data)
                elif path == "/api/start":
                    companion.start(data.get("command"), data.get("deep") is True)
                elif path == "/api/pause":
                    companion.stop()
                elif path == "/api/pick":
                    self.respond(200, {"paths": companion.pick()})
                    return
                else:
                    raise WebError("Opération inconnue.", 404)
                self.respond(200, {"ok": True})
            except WebError as error:
                self.respond(error.code, {"error": str(error)})
            except (OSError, ValueError, RuntimeError, TypeError) as error:
                self.respond(400, {"error": str(error)})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    companion.port = server.server_address[1]
    return server


def serve(config, state, reports, port=8766, local=False, open_browser=True):
    with exclusive(str(state) + ".web"):
        companion = Companion(config, state, reports, port)
        server = make_server(companion, port)
        target = companion.local_origin + "/" if local else SITE
        target += "#session=" + quote(companion.token) + "&port=" + str(companion.port)
        print("Passage Photos est ouvert sur cet ordinateur. Gardez cette fenêtre ouverte.")
        print("Si le navigateur bloque la liaison depuis GitHub Pages, utilisez --local.")
        if open_browser:
            webbrowser.open(target)
        try:
            server.serve_forever(poll_interval=0.5)
        except KeyboardInterrupt:
            pass
        finally:
            companion.stop()
            if companion.process:
                companion.process.wait(timeout=10)
            server.server_close()
    return 0
