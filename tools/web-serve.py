"""Serve target/web for tools/run-web.sh, with HTTP Range support.

--disc PATH additionally serves that disc image read-only at /disc.iso, so
a development page can open it with ?disc=disc.iso (docs/APP.md). The image
is only read, never copied. Binds to 0.0.0.0.
"""
from __future__ import annotations

import argparse
import functools
import os
import re
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import json
import random
import time

CHUNK = 1 << 20
ROOMS: dict[str, dict] = {}


def generate_room_code() -> str:
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(100):
        code = "".join(random.choices(chars, k=4))
        if code not in ROOMS:
            return code
    return "".join(random.choices(chars, k=6))


class Handler(SimpleHTTPRequestHandler):
    disc: str | None = None

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        elif path.endswith((".wasm", ".ttf", ".woff2", ".png", ".jpg", ".svg")):
            # High-performance caching for heavy binary assets over tunnels
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        if self.disc and path.split("?", 1)[0] == "/disc.iso":
            return self.disc
        return super().translate_path(path)

    def do_HEAD(self) -> None:  # noqa: N802
        self.send(head=True)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.OK)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        url_path = self.path.split("?", 1)[0]
        query = self.path.split("?", 1)[1] if "?" in self.path else ""

        if url_path == "/api/controller-profile":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            profile_path = os.path.join(os.path.dirname(__file__), "..", "config", "controller_profile.json")
            if os.path.isfile(profile_path):
                with open(profile_path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.wfile.write(b"{}")
            return

        if url_path == "/api/room/poll":
            params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
            code = params.get("code", "").upper()
            peer = params.get("peer", "")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            room = ROOMS.get(code)
            if not room:
                self.wfile.write(json.dumps({"ok": False, "error": "Room not found"}).encode())
                return
            room["last_active"] = time.time()
            if peer == "guest":
                cands = list(room["guest_candidates"])
                room["guest_candidates"].clear()
                resp = {
                    "ok": True,
                    "code": code,
                    "mode": room.get("mode", "1v1"),
                    "status": room.get("status", "open"),
                    "offer": room.get("offer"),
                    "candidates": cands,
                }
            else:
                cands = list(room["host_candidates"])
                room["host_candidates"].clear()
                resp = {
                    "ok": True,
                    "code": code,
                    "mode": room.get("mode", "1v1"),
                    "status": room.get("status", "open"),
                    "answer": room.get("answer"),
                    "candidates": cands,
                }
            self.wfile.write(json.dumps(resp).encode())
            return

        self.send(head=False)

    def do_POST(self) -> None:  # noqa: N802
        url_path = self.path.split("?", 1)[0]
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b""

        if url_path == "/api/controller-profile":
            config_dir = os.path.join(os.path.dirname(__file__), "..", "config")
            os.makedirs(config_dir, exist_ok=True)
            profile_path = os.path.join(config_dir, "controller_profile.json")
            with open(profile_path, "wb") as f:
                f.write(body)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"ok": true}')
            return

        if url_path == "/api/room/create":
            data = json.loads(body.decode()) if body else {}
            code = (data.get("code") or generate_room_code()).upper()
            mode = data.get("mode", "1v1")
            ROOMS[code] = {
                "code": code,
                "mode": mode,
                "status": "open",
                "offer": None,
                "answer": None,
                "host_candidates": [],
                "guest_candidates": [],
                "created_at": time.time(),
                "last_active": time.time(),
            }
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "code": code, "mode": mode}).encode())
            return

        if url_path == "/api/room/join":
            data = json.loads(body.decode()) if body else {}
            code = data.get("code", "").upper()
            room = ROOMS.get(code)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            if not room:
                self.wfile.write(json.dumps({"ok": False, "error": "Room code does not exist"}).encode())
                return
            room["status"] = "connected"
            room["last_active"] = time.time()
            self.wfile.write(json.dumps({
                "ok": True,
                "code": code,
                "mode": room.get("mode", "1v1"),
                "offer": room.get("offer"),
            }).encode())
            return

        if url_path == "/api/room/signal":
            data = json.loads(body.decode()) if body else {}
            code = data.get("code", "").upper()
            sender = data.get("from", "")
            signal = data.get("signal", {})
            room = ROOMS.get(code)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            if not room:
                self.wfile.write(json.dumps({"ok": False, "error": "Room not found"}).encode())
                return
            room["last_active"] = time.time()
            sig_type = signal.get("type")
            if sig_type == "offer":
                room["offer"] = signal.get("sdp")
            elif sig_type == "answer":
                room["answer"] = signal.get("sdp")
                room["status"] = "connected"
            elif sig_type == "candidate":
                cand = signal.get("candidate")
                if cand:
                    if sender == "host":
                        room["guest_candidates"].append(cand)
                    else:
                        room["host_candidates"].append(cand)
            self.wfile.write(b'{"ok": true}')
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def send(self, head: bool) -> None:
        path = self.translate_path(self.path)
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        if not os.path.isfile(path) or not match:
            return super().do_HEAD() if head else super().do_GET()
        size = os.path.getsize(path)
        start = int(match[1])
        end = min(int(match[2]) + 1 if match[2] else size, size)
        if start >= end:
            self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            return
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end - 1}/{size}")
        self.send_header("Content-Length", str(end - start))
        self.end_headers()
        if head:
            return
        with open(path, "rb") as f:
            f.seek(start)
            remaining = end - start
            while remaining > 0:
                chunk = f.read(min(CHUNK, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("directory", nargs="?", default=None, help="directory to serve (defaults to dist or target/web)")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--disc", help="disc image to serve read-only at /disc.iso")
    parser.add_argument("--host", default="0.0.0.0", help="host address to bind")
    args = parser.parse_args()

    dir_to_serve = args.directory
    if not dir_to_serve:
        if os.path.isdir("dist"):
            dir_to_serve = "dist"
        elif os.path.isdir("target/web"):
            dir_to_serve = "target/web"
        else:
            dir_to_serve = "dist"

    Handler.disc = os.path.abspath(args.disc) if args.disc else None
    handler = functools.partial(Handler, directory=dir_to_serve)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"serving {dir_to_serve} at http://localhost:{args.port} (bound to {args.host}:{args.port})" + (" (disc at /disc.iso)" if args.disc else ""))
    server.serve_forever()


if __name__ == "__main__":
    main()
