"""Small pCloud HTTP client. Never retry a consumed upload body."""
import hashlib
import json
import os
import random
import time
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

import requests
from requests_toolbelt.multipart.encoder import MultipartEncoder

HOSTS = {"api.pcloud.com", "eapi.pcloud.com"}


class TransferError(RuntimeError):
    pass


class AuthError(TransferError):
    pass


class TemporaryError(TransferError):
    def __init__(self, message, retry_after=0):
        super().__init__(message)
        self.retry_after = retry_after


class APIError(TransferError):
    def __init__(self, method, code):
        self.code = code
        explanation = {2008: "Espace pCloud insuffisant", 2003: "Accès refusé",
                       2005: "Dossier absent", 2009: "Fichier absent"}.get(code, "Erreur pCloud")
        super().__init__(f"{explanation} ({method}, code {code}).")


def load_config(path):
    data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if data.get("hostname") not in HOSTS:
        raise TransferError("hostname doit être api.pcloud.com ou eapi.pcloud.com.")
    if not 1 <= int(data.get("attempts", 6)) <= 20:
        raise TransferError("attempts doit être compris entre 1 et 20.")
    return data


def save_config(path, data):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(data, output, indent=2, ensure_ascii=False)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    if os.name != "nt":
        path.chmod(0o600)


def pause(attempt, error):
    delay = max(min(60, 2 ** attempt + random.uniform(0, 1)), getattr(error, "retry_after", 0))
    # Honor Retry-After without monopolizing one long blocking call.
    delay = min(delay, 3600)
    while delay > 0:
        part = min(30, delay)
        print(f"Nouvelle tentative dans {int(delay)+1} s : {error}", flush=True)
        time.sleep(part)
        delay -= part


def retry_after(response):
    value = response.headers.get("Retry-After", "0")
    try:
        return max(0, float(value))
    except ValueError:
        try:
            return max(0, parsedate_to_datetime(value).timestamp() - time.time())
        except (ValueError, TypeError, OverflowError):
            return 0


class PCloud:
    def __init__(self, config):
        self.host = config["hostname"]
        self.token = config.get("access_token", "")
        self.attempts = int(config.get("attempts", 6))
        self.session = requests.Session()

    def close(self):
        self.session.close()

    def request(self, method, *, data=None, headers=None, authenticate=True):
        merged = {"User-Agent": "Takeout-pCloud/1.0"}
        if authenticate:
            if not self.token:
                raise AuthError("Connexion requise : lancez auth.")
            if data is None or isinstance(data, dict):
                # Documented pCloud global parameter, in the HTTPS body, not URL.
                data = {**(data or {}), "access_token": self.token}
        merged.update(headers or {})
        try:
            with self.session.post(f"https://{self.host}/{method}", data=data or {},
                                   headers=merged, timeout=(20, 120), allow_redirects=False) as response:
                if response.status_code in (401, 403):
                    raise AuthError("Jeton refusé. Relancez auth puis la même commande.")
                if response.status_code == 429 or 500 <= response.status_code < 600:
                    raise TemporaryError(f"pCloud HTTP {response.status_code}", retry_after(response))
                if response.status_code != 200:
                    raise TransferError(f"pCloud HTTP {response.status_code} ({method}).")
                try:
                    result = response.json()
                except ValueError:
                    raise TemporaryError("Réponse pCloud non JSON.") from None
        except requests.RequestException:
            # Do not print requests exceptions: URLs or headers may contain secrets.
            raise TemporaryError("Connexion pCloud interrompue ou délai dépassé.") from None
        if not isinstance(result, dict) or "result" not in result:
            raise TemporaryError("Réponse pCloud incomplète.")
        code = result["result"]
        if code in (1000, 2000, 2094):
            raise AuthError("Jeton pCloud invalide/révoqué. Relancez auth.")
        if code in (2041, 4000, 5000, 5001):
            raise TemporaryError(f"pCloud temporairement indisponible (code {code}).")
        if code:
            raise APIError(method, code)
        return result

    def call(self, method, **parameters):
        for attempt in range(self.attempts):
            try:
                return self.request(method, data=parameters)
            except TemporaryError as error:
                if attempt + 1 == self.attempts:
                    raise
                pause(attempt, error)

    def folder(self, parent, name):
        return self.call("createfolderifnotexists", folderid=parent, name=name)["metadata"]["folderid"]

    def contents(self, folderid):
        return self.call("listfolder", folderid=folderid)["metadata"].get("contents", [])

    def upload(self, obj, stream, folderid):
        fields = [("access_token", self.token), ("folderid", str(folderid)), ("nopartial", "1")]
        if obj["captured"] is not None:
            fields += [("mtime", str(obj["captured"])), ("ctime", str(obj["captured"]))]
        fields.append(("file", (obj["name"], stream, "application/octet-stream")))
        encoder = MultipartEncoder(fields=fields)
        # Deterministic private content folder. No renameifexists: an ambiguous
        # completion must address the same name, never create "file (2)".
        result = self.request("uploadfile", data=encoder, headers={"Content-Type": encoder.content_type})
        metadata = result.get("metadata", [])
        if len(metadata) != 1:
            raise TemporaryError("Réponse upload ambiguë ; contrôle distant nécessaire.")
        return metadata[0]["fileid"]

    def matches(self, obj, fileid, deep=False):
        result = self.call("checksumfile", fileid=fileid)
        if result["metadata"]["size"] != obj["size"] or result.get("sha1", "").lower() != obj["sha1"]:
            return False
        sha256 = result.get("sha256")
        if sha256 and sha256.lower() != obj["sha256"]:
            return False
        # US has no server SHA-256. Read back in bounded memory for full proof.
        if deep or not sha256:
            return self.download_hash(fileid) == obj["sha256"]
        return True

    def download_hash(self, fileid):
        for attempt in range(self.attempts):
            try:
                link = self.call("getfilelink", fileid=fileid)
                host = link["hosts"][0]
                if not host.endswith(".pcloud.com") or urlparse("https://" + host).hostname != host:
                    raise TransferError("Hôte de téléchargement pCloud inattendu ; contrôle refusé.")
                path = link["path"]
                if not path.startswith("/") or path.startswith("//"):
                    raise TransferError("Lien de téléchargement pCloud invalide.")
                digest = hashlib.sha256()
                # Signed link: never forward the API bearer to a download host.
                with self.session.get("https://" + host + path, stream=True,
                                      timeout=(20, 120), allow_redirects=False) as response:
                    if response.status_code != 200:
                        raise TemporaryError(f"Relecture pCloud HTTP {response.status_code}.")
                    last = time.monotonic()
                    count = 0
                    for chunk in response.iter_content(1024 * 1024):
                        digest.update(chunk)
                        count += len(chunk)
                        if time.monotonic() - last >= 10:
                            print(f"  Relecture SHA-256 : {count} octets", flush=True)
                            last = time.monotonic()
                return digest.hexdigest()
            except requests.RequestException:
                error = TemporaryError("Relecture pCloud interrompue.")
            except TemporaryError as caught:
                error = caught
            if attempt + 1 == self.attempts:
                raise error
            pause(attempt, error)
