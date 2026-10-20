"""Read ZIP entries in bounded memory. Never extract or mutate source files."""
import contextlib
import hashlib
import json
import time
import zipfile
from pathlib import Path, PurePosixPath

CHUNK = 1024 * 1024
MEDIA = set("jpg jpeg png gif webp heic heif avif tif tiff bmp dng raw cr2 cr3 nef arw raf orf rw2 srw pef mp4 mov m4v avi mkv webm mpg mpeg 3gp mts m2ts mod wmv flv insv".split())


def safe_name(name):
    # Preserve normal source names. Escape pCloud-forbidden/control characters.
    name = PurePosixPath(name).name
    name = "".join(f"_{ord(c):02x}_" if c in '/\\\x00\r\n' or ord(c) < 32 else c for c in name)
    if name in ("", ".", ".."):
        name = "fichier"
    # pCloud limits UTF-8 filenames. Leave margin without splitting a code point.
    if len(name.encode("utf-8")) > 1000:
        suffix = PurePosixPath(name).suffix[:20]
        stem = name[:-len(suffix)] if suffix else name
        while len((stem + suffix).encode("utf-8")) > 1000:
            stem = stem[:-1]
        name = stem + suffix
    return name


def category(name):
    extension = PurePosixPath(name).suffix.lower().lstrip(".")
    return "Medias" if extension in MEDIA else "Metadonnees" if extension == "json" else "Autres"


def fingerprint(infos):
    digest = hashlib.sha256()
    for item in infos:
        digest.update(json.dumps([item.filename, item.CRC, item.file_size, item.compress_size,
                                  item.header_offset, item.flag_bits, item.compress_type],
                                 ensure_ascii=True, separators=(",", ":")).encode())
        digest.update(b"\n")
    return digest.hexdigest()


def scan(state, paths):
    """Each entry commits atomically; a failed archive stays incomplete."""
    expanded = []
    for path in paths:
        path = Path(path).resolve()
        expanded.extend(sorted(path.glob("*.zip")) if path.is_dir() else [path])
    if not expanded:
        raise RuntimeError("Aucun ZIP trouvé.")
    for path in dict.fromkeys(expanded):
        before = path.stat()
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            archive_id = fingerprint(infos)
            old = state.db.execute("SELECT * FROM archives WHERE id=?", (archive_id,)).fetchone()
            with state.db:
                state.db.execute("""INSERT INTO archives(id,path,size,mtime) VALUES(?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET path=excluded.path,size=excluded.size,mtime=excluded.mtime""",
                    (archive_id, str(path), before.st_size, before.st_mtime_ns))
            if old and old["complete"]:
                print(f"Inventaire déjà présent : {path.name}", flush=True)
                continue
            print(f"Lecture et CRC : {path.name} ({len(infos)} entrées)", flush=True)
            last = time.monotonic()
            for ordinal, info in enumerate(infos):
                if info.is_dir():
                    continue
                if state.db.execute("SELECT 1 FROM sources WHERE archive=? AND ordinal=?",
                                    (archive_id, ordinal)).fetchone():
                    continue
                sha256, sha1 = hashlib.sha256(), hashlib.sha1()
                collected = bytearray() if info.filename.lower().endswith(".json") and info.file_size <= 4 * CHUNK else None
                count = 0
                with archive.open(info) as stream:
                    while chunk := stream.read(CHUNK):
                        count += len(chunk)
                        sha256.update(chunk)
                        sha1.update(chunk)
                        if collected is not None:
                            collected.extend(chunk)
                        if time.monotonic() - last >= 10:
                            print(f"  Entrée {ordinal+1}/{len(infos)} : {count}/{info.file_size} octets", flush=True)
                            last = time.monotonic()
                if count != info.file_size:
                    raise RuntimeError(f"Taille ZIP incorrecte : {info.filename}")
                with state.db:
                    state.db.execute("""INSERT OR IGNORE INTO objects(sha256,sha1,size,name,category)
                        VALUES(?,?,?,?,?)""", (sha256.hexdigest(), sha1.hexdigest(), count,
                                             safe_name(info.filename), category(info.filename)))
                    state.db.execute("INSERT INTO sources VALUES(?,?,?,?)",
                                     (archive_id, ordinal, info.filename, sha256.hexdigest()))
                    if collected is not None:
                        remember_date(state, info.filename, collected)
                if ordinal % 100 == 0:
                    print(f"  {ordinal+1}/{len(infos)} entrées lues", flush=True)
            after = path.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise RuntimeError("Archive modifiée pendant sa lecture. Recommencez avec une copie stable.")
            with state.db:
                state.db.execute("UPDATE archives SET complete=1 WHERE id=?", (archive_id,))
    apply_dates(state)


def remember_date(state, member, raw):
    try:
        data = json.loads(raw)
        title = data.get("title")
        stamp = int(data["photoTakenTime"]["timestamp"])
        if isinstance(title, str) and -62135596800 <= stamp <= 253402300799:
            state.db.execute("INSERT OR IGNORE INTO dates VALUES(?,?,?)",
                             (str(PurePosixPath(member).parent), title, stamp))
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError):
        pass  # Raw JSON is still inventoried and transferred, even if unrecognized.


def apply_dates(state):
    # Exact parent+title only. Never guess dates from truncated or ambiguous names.
    with state.db:
        state.db.execute("CREATE TEMP TABLE IF NOT EXISTS candidates(sha256 TEXT, stamp INTEGER)")
        state.db.execute("CREATE INDEX IF NOT EXISTS temp.candidates_object ON candidates(sha256)")
        state.db.execute("DELETE FROM candidates")
        for row in state.db.execute("SELECT sha256,member FROM sources"):
            path = PurePosixPath(row["member"])
            for date in state.db.execute("SELECT timestamp FROM dates WHERE directory=? AND title=?",
                                         (str(path.parent), path.name)):
                state.db.execute("INSERT INTO candidates VALUES(?,?)", (row["sha256"], date[0]))
        state.db.execute("""UPDATE objects SET captured=(SELECT min(stamp) FROM candidates c
            WHERE c.sha256=objects.sha256 HAVING count(DISTINCT stamp)=1)
            WHERE status!='verified'""")


class UploadStream:
    """MultipartEncoder sees the remaining length, not the original total."""
    def __init__(self, stream, size, progress=None):
        self.stream, self.size, self.count = stream, size, 0
        self.sha256 = hashlib.sha256()
        self.progress = progress

    @property
    def len(self):
        return self.size - self.count

    def read(self, size=-1):
        chunk = self.stream.read(min(size, CHUNK) if size >= 0 else CHUNK)
        if not chunk and self.count != self.size:
            raise RuntimeError("Source tronquée pendant l'envoi.")
        self.count += len(chunk)
        self.sha256.update(chunk)
        if self.progress:
            self.progress(self.count, self.size)
        return chunk


@contextlib.contextmanager
def open_source(state, obj, progress=None):
    rows = state.db.execute("""SELECT s.*,a.path,a.size AS archive_size,a.mtime FROM sources s
        JOIN archives a ON a.id=s.archive WHERE s.sha256=?""", (obj["sha256"],))
    source = next((row for row in rows if Path(row["path"]).is_file()), None)
    if source is None:
        raise RuntimeError("ZIP source absent. Fournissez-le à nouveau avec scan.")
    path = Path(source["path"])
    stat = path.stat()
    if (stat.st_size, stat.st_mtime_ns) != (source["archive_size"], source["mtime"]):
        raise RuntimeError("ZIP source modifié. Relancez scan avant transfert.")
    signature = (stat.st_size, stat.st_mtime_ns)
    cached = getattr(state, "source_zip", None)
    if not cached or cached[:2] != (str(path), signature):
        if cached:
            cached[2].close()
        archive = zipfile.ZipFile(path)
        infos = archive.infolist()
        if fingerprint(infos) != source["archive"]:
            archive.close()
            raise RuntimeError("L'inventaire du ZIP source a changé.")
        state.source_zip = (str(path), signature, archive)
    archive = state.source_zip[2]
    with archive.open(archive.infolist()[source["ordinal"]]) as stream:
        wrapped = UploadStream(stream, obj["size"], progress)
        yield wrapped
        if wrapped.count != obj["size"] or wrapped.sha256.hexdigest() != obj["sha256"]:
            raise RuntimeError("Les octets envoyés ne correspondent pas à l'inventaire. Vérification refusée.")
