"""Transfer state machine: reconcile, send, verify, then commit success."""
import time
from datetime import datetime, timezone

from .pcloud import APIError, AuthError, TemporaryError, TransferError, pause
from .takeout import open_source, safe_name


def bind(state, client, folder_name=None):
    user = client.call("userinfo")
    identity = {"userid": user["userid"], "hostname": client.host}
    binding = state.get("binding")
    if binding:
        if any(binding[key] != identity[key] for key in identity):
            raise TransferError("Ce journal appartient à un autre compte/région pCloud.")
        if folder_name and folder_name != binding["initial_name"]:
            raise TransferError("Destination déjà fixée. Renommez-la sur pCloud ; omettez --folder pour reprendre.")
        # Check existence by ID, without listing a potentially huge tree.
        client.call("listfolder", folderid=binding["folderid"], nofiles=1)
        return binding["folderid"]
    if folder_name is None:
        folder_name = input("Nom du dossier destination pCloud : ").strip()
    if not folder_name or folder_name != safe_name(folder_name) or "/" in folder_name or "\\" in folder_name:
        raise TransferError("Choisissez un nom de dossier simple, sans séparateur, de 1000 octets maximum.")
    folderid = client.folder(0, folder_name)
    state.set("binding", {**identity, "folderid": folderid, "initial_name": folder_name})
    return folderid


def cached_folder(state, client, key, parent, name):
    old = state.db.execute("SELECT folderid FROM folders WHERE key=?", (key,)).fetchone()
    if old:
        return old[0]
    folderid = client.folder(parent, name)
    with state.db:
        state.db.execute("INSERT INTO folders VALUES(?,?)", (key, folderid))
    return folderid


def object_folder(state, client, root, obj):
    if obj["folderid"] is not None:
        return obj["folderid"]
    files = cached_folder(state, client, "files", root, "Fichiers")
    prefix = obj["sha256"][:2]
    shard = cached_folder(state, client, "shard:" + prefix, files, prefix)
    folderid = client.folder(shard, obj["sha256"])
    with state.db:
        state.db.execute("UPDATE objects SET folderid=? WHERE sha256=?", (folderid, obj["sha256"]))
    return folderid


def mark_verified(state, digest, fileid):
    with state.db:
        state.db.execute("""UPDATE objects SET fileid=?,status='verified',error=NULL,checked=?
                            WHERE sha256=?""", (fileid, datetime.now(timezone.utc).isoformat(), digest))


def transfer_one(state, client, root, obj):
    # All retries begin with remote reconciliation. Never trust a missing receipt.
    for attempt in range(client.attempts):
        try:
            folderid = object_folder(state, client, root, obj)
            contents = client.contents(folderid)
            if contents:
                # This private directory is named by the full content SHA-256.
                # Any unexpected content is a conflict: do not overwrite it.
                if len(contents) != 1 or contents[0].get("isfolder"):
                    raise TransferError("Dossier de contenu modifié : contrôle manuel requis.")
                fileid = contents[0]["fileid"]
                if not client.matches(obj, fileid):
                    raise TransferError("Intégrité distante incorrecte. Fichier conservé, aucun écrasement.")
                mark_verified(state, obj["sha256"], fileid)
                return
            last = time.monotonic()

            def progress(count, size):
                nonlocal last
                if time.monotonic() - last >= 10:
                    print(f"  Envoi : {count}/{size} octets", flush=True)
                    last = time.monotonic()

            with state.db:
                state.db.execute("UPDATE objects SET status='uploading',error=NULL WHERE sha256=?", (obj["sha256"],))
            with open_source(state, obj, progress) as stream:
                fileid = client.upload(obj, stream, folderid)
            # Record the receipt before expensive verification. Recovery still
            # reconciles by folder, covering a crash before this transaction.
            with state.db:
                state.db.execute("UPDATE objects SET fileid=? WHERE sha256=?", (fileid, obj["sha256"]))
            if not client.matches(obj, fileid):
                raise TransferError("Empreintes différentes après envoi. Validation refusée.")
            mark_verified(state, obj["sha256"], fileid)
            return
        except TemporaryError as error:
            if attempt + 1 == client.attempts:
                raise
            pause(attempt, error)


def transfer(state, client, folder_name=None):
    try:
        return _transfer(state, client, folder_name)
    finally:
        state.close_source()


def _transfer(state, client, folder_name=None):
    incomplete = state.db.execute("SELECT count(*) FROM archives WHERE complete=0").fetchone()[0]
    if incomplete:
        raise TransferError("Inventaire incomplet. Relancez scan sur les ZIP concernés.")
    total = state.db.execute("SELECT count(*) FROM objects").fetchone()[0]
    if not total:
        raise TransferError("Inventaire vide. Lancez scan avant run.")
    root = bind(state, client, folder_name)
    user = client.call("userinfo")
    pending_bytes = state.db.execute("SELECT coalesce(sum(size),0) FROM objects WHERE status!='verified'").fetchone()[0]
    available = user.get("quota", 0) - user.get("usedquota", 0)
    if available < pending_bytes:
        # In-flight uploads might already occupy space, so this is advisory.
        print(f"Espace libre annoncé : {available} octets ; restant local : {pending_bytes}. "
              "Les envois déjà reçus seront d'abord retrouvés.", flush=True)
    print(state.progress(), flush=True)
    failures = 0
    cursor = state.db.execute("""SELECT * FROM objects WHERE status!='verified' ORDER BY
        (SELECT min(s.archive || printf('%012d',s.ordinal)) FROM sources s WHERE s.sha256=objects.sha256)""")
    for index, obj in enumerate(cursor, 1):
        print(f"Transfert : {obj['name']} ({obj['size']} octets)", flush=True)
        try:
            transfer_one(state, client, root, obj)
        except AuthError:
            raise
        except APIError as error:
            if error.code in (2008, 2003, 2005):
                record_error(state, obj, error)
                raise
            failures += 1
            record_error(state, obj, error)
        except TemporaryError as error:
            # An outage would otherwise cause thousands of identical retries.
            record_error(state, obj, error)
            raise
        except (TransferError, OSError, RuntimeError) as error:
            failures += 1
            record_error(state, obj, error)
        if index % 25 == 0:
            print(state.progress(), flush=True)
    return failures == 0 and state.counts().get("verified", 0) == total


def record_error(state, obj, error):
    with state.db:
        state.db.execute("UPDATE objects SET status='error',error=? WHERE sha256=?", (str(error), obj["sha256"]))
    print(f"Erreur : {error}", flush=True)


def verify(state, client, deep=False):
    if not state.get("binding"):
        raise TransferError("Aucune destination liée. Lancez run avant verify.")
    bind(state, client)
    total = state.db.execute("SELECT count(*) FROM objects").fetchone()[0]
    if not total:
        raise TransferError("Inventaire vide.")
    failures = 0
    for index, obj in enumerate(state.db.execute("SELECT * FROM objects ORDER BY sha256"), 1):
        try:
            if obj["fileid"] is None or not client.matches(obj, obj["fileid"], deep=deep):
                raise TransferError("Fichier absent ou empreinte incorrecte.")
            mark_verified(state, obj["sha256"], obj["fileid"])
        except AuthError:
            raise
        except TemporaryError:
            raise
        except (TransferError, KeyError) as error:
            failures += 1
            record_error(state, obj, error)
        print(f"Contrôle {index}/{total} | erreurs {failures}", flush=True)
    return failures == 0 and not state.db.execute("SELECT 1 FROM archives WHERE complete=0").fetchone()
