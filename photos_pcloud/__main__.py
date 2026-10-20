"""French CLI. Nonzero exit codes mean incomplete or failed work."""
import argparse
import json
import sqlite3
import sys
import zipfile

from .auth import authorize
from .migrate import transfer, verify
from .pcloud import PCloud, TransferError, load_config
from .state import State, exclusive
from .takeout import scan


def main(argv=None):
    parser = argparse.ArgumentParser(description="Migration fiable Google Takeout ZIP vers pCloud.")
    parser.add_argument("--config", default="config.json", help="Secrets pCloud (défaut : config.json)")
    parser.add_argument("--state", default="migration.sqlite3", help="Journal SQLite à conserver")
    parser.add_argument("--reports", default="reports", help="Dossier des rapports CSV/JSON")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("auth", help="Connexion OAuth pCloud")
    inventory = commands.add_parser("scan", help="Inventorier les ZIP, sans réseau")
    inventory.add_argument("paths", nargs="+", help="ZIP ou dossiers contenant les ZIP")
    run = commands.add_parser("run", help="Transférer ou reprendre")
    run.add_argument("--folder", help="Nom initial du dossier pCloud ; demandé au premier lancement")
    check = commands.add_parser("verify", help="Revérifier tous les fichiers à distance")
    check.add_argument("--deep", action="store_true", help="Relire tous les octets distants et recalculer SHA-256")
    commands.add_parser("status", help="État et régénération des rapports, sans réseau")
    web = commands.add_parser("web", help="Ouvrir l'interface web et son compagnon local")
    web.add_argument("--local", action="store_true", help="Servir aussi l'interface sur cet ordinateur")
    web.add_argument("--no-open", action="store_true", help="Ne pas ouvrir le navigateur")
    web.add_argument("--port", type=int, default=8766)
    args = parser.parse_args(argv)
    state = None
    client = None
    try:
        if args.command == "web":
            from .web import serve
            return serve(args.config, args.state, args.reports, args.port, args.local, not args.no_open)
        with exclusive(args.state):
            if args.command == "auth":
                authorize(args.config, load_config(args.config))
                return 0
            state = State(args.state)
            try:
                if args.command == "scan":
                    scan(state, args.paths)
                    success = True
                elif args.command == "status":
                    print(state.progress())
                    success = True
                else:
                    client = PCloud(load_config(args.config))
                    success = (transfer(state, client, args.folder) if args.command == "run"
                               else verify(state, client, args.deep))
                print(state.progress())
                return 0 if success else 2
            finally:
                state.report(args.reports)
                state.close()
                state = None
    except KeyboardInterrupt:
        print("\nInterrompu. Relancez la même commande avec le même journal.", file=sys.stderr)
        return 130
    except (TransferError, RuntimeError, OSError, ValueError, sqlite3.Error, zipfile.BadZipFile,
            NotImplementedError) as error:
        print(f"Arrêt : {error}", file=sys.stderr)
        return 2
    finally:
        if client:
            client.close()
        if state:
            state.close()


if __name__ == "__main__":
    sys.exit(main())
