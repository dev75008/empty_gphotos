"""Durable local inventory. A single process owns a journal at a time."""
import contextlib
import csv
import json
import os
import sqlite3
from pathlib import Path


@contextlib.contextmanager
def exclusive(path):
    path = Path(str(path) + ".lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(path, "a+b")
    try:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise RuntimeError("Ce journal est déjà utilisé par un autre processus.") from None
    try:
        yield
    finally:
        # Closing releases the OS lock, including after a crash. Keep the lock file.
        handle.close()


class State:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS archives(
                id TEXT PRIMARY KEY, path TEXT NOT NULL, size INTEGER NOT NULL,
                mtime INTEGER NOT NULL, complete INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS objects(
                sha256 TEXT PRIMARY KEY, sha1 TEXT NOT NULL, size INTEGER NOT NULL,
                name TEXT NOT NULL, category TEXT NOT NULL, captured INTEGER,
                folderid INTEGER, fileid INTEGER, status TEXT NOT NULL DEFAULT 'pending',
                error TEXT, checked TEXT);
            CREATE TABLE IF NOT EXISTS sources(
                archive TEXT NOT NULL REFERENCES archives(id), ordinal INTEGER NOT NULL,
                member TEXT NOT NULL, sha256 TEXT NOT NULL REFERENCES objects(sha256),
                PRIMARY KEY(archive, ordinal));
            CREATE INDEX IF NOT EXISTS sources_object ON sources(sha256);
            CREATE TABLE IF NOT EXISTS dates(
                directory TEXT NOT NULL, title TEXT NOT NULL, timestamp INTEGER NOT NULL,
                PRIMARY KEY(directory, title, timestamp));
            CREATE TABLE IF NOT EXISTS folders(key TEXT PRIMARY KEY, folderid INTEGER NOT NULL);
        """)
        version = self.get("schema")
        if version not in (None, 1):
            raise RuntimeError("Version du journal non prise en charge.")
        self.set("schema", 1)

    def close_source(self):
        cached = getattr(self, "source_zip", None)
        if cached:
            cached[2].close()
            self.source_zip = None

    def close(self):
        self.close_source()
        self.db.close()

    def get(self, key):
        row = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def set(self, key, value):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (key, json.dumps(value)))

    def counts(self):
        return dict(self.db.execute("SELECT status,count(*) FROM objects GROUP BY status").fetchall())

    def progress(self):
        counts = self.counts()
        total = sum(counts.values())
        done = counts.get("verified", 0)
        return f"Vérifiés {done}/{total} | restants {total-done} | erreurs {counts.get('error', 0)}"

    def report(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        # A new report replaces the old one only after it has been fully written.
        query = """SELECT a.path AS archive,s.member,s.ordinal,o.* FROM sources s
                   JOIN archives a ON a.id=s.archive JOIN objects o USING(sha256)
                   ORDER BY a.id,s.ordinal"""
        cursor = self.db.execute(query)
        temporary = directory / "manifest.csv.tmp"
        with temporary.open("w", newline="", encoding="utf-8-sig") as output:
            writer = csv.writer(output)
            writer.writerow([column[0] for column in cursor.description])
            for row in cursor:
                # Avoid spreadsheet formula execution when opening untrusted names.
                writer.writerow(["'" + x if isinstance(x, str) and x.startswith(("=", "+", "-", "@")) else x for x in row])
        temporary.replace(directory / "manifest.csv")
        summary = {
            "counts": self.counts(),
            "archives": [dict(row) for row in self.db.execute("""SELECT a.*,
                (SELECT count(*) FROM sources s WHERE s.archive=a.id) AS source_entries,
                (SELECT count(*) FROM sources s JOIN objects o USING(sha256)
                 WHERE s.archive=a.id AND o.status!='verified') AS unverified_entries
                FROM archives a""")],
            "binding": self.get("binding"),
            "source_entries": self.db.execute("SELECT count(*) FROM sources").fetchone()[0],
            "unique_bytes": self.db.execute("SELECT coalesce(sum(size),0) FROM objects").fetchone()[0],
            "media_without_date": self.db.execute(
                "SELECT count(*) FROM objects WHERE category='Medias' AND captured IS NULL").fetchone()[0],
            "scope": "Inventaire des ZIP fournis ; ne prouve pas la complétude du compte Google.",
        }
        temp_json = directory / "summary.json.tmp"
        temp_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_json.replace(directory / "summary.json")
