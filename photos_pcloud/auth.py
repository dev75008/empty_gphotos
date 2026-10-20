"""pCloud authorization code flow, loopback callback, state validation."""
import secrets
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

from .pcloud import HOSTS, PCloud, TransferError, save_config


def authorize(config_path, config):
    for field in ("client_id", "client_secret"):
        if not config.get(field) or config[field].startswith("VOTRE_"):
            raise TransferError(f"Renseignez {field} dans le fichier de configuration.")
    redirect = config.get("redirect_uri", "http://127.0.0.1:8765/callback")
    parsed = urlparse(redirect)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port
            or parsed.query or parsed.fragment or parsed.username):
        raise TransferError("redirect_uri doit être http://127.0.0.1:PORT/callback.")
    expected = secrets.token_urlsafe(32)
    received = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # OAuth codes must not enter access logs.

        def do_GET(self):
            target = urlparse(self.path)
            query = parse_qs(target.query)
            valid = target.path == parsed.path and secrets.compare_digest(query.get("state", [""])[0], expected)
            if not valid:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Callback invalide.")
                return
            received.update({key: values[0] for key, values in query.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write("Réponse reçue. Revenez au terminal.".encode())

    with HTTPServer(("127.0.0.1", parsed.port), Handler) as server:
        server.timeout = 1
        url = "https://my.pcloud.com/oauth2/authorize?" + urlencode({
            "client_id": config["client_id"], "response_type": "code",
            "redirect_uri": redirect, "state": expected, "force_reapprove": "1"})
        print("Autorisez l'application dans votre navigateur. URL si nécessaire :\n" + url, flush=True)
        webbrowser.open(url)
        deadline = time.monotonic() + 300
        while not received and time.monotonic() < deadline:
            server.handle_request()
    if not received.get("code"):
        raise TransferError("Autorisation refusée ou délai de cinq minutes dépassé.")
    host = received.get("hostname")
    if host not in HOSTS:
        raise TransferError("Le callback n'indique pas un serveur pCloud autorisé.")
    updated = {**config, "hostname": host}
    client = PCloud(updated)
    try:
        token = client.request("oauth2_token", authenticate=False, data={
            "client_id": config["client_id"], "client_secret": config["client_secret"],
            "code": received["code"]})
        updated["access_token"] = token["access_token"]
        client.token = token["access_token"]
        user = client.call("userinfo")
        updated["userid"] = user["userid"]
        save_config(config_path, updated)
    finally:
        client.close()
    print("Connexion pCloud enregistrée. Aucun jeton affiché.")
