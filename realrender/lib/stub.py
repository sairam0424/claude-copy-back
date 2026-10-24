#!/usr/bin/env python3
"""Local stub for the sealed render rig.

Binds 127.0.0.1 on a free port, writes the port number to --port-file, and
answers EVERY request (any method, any path) with HTTP 401. The only thing it
records, one line per request, is a timestamp, the method and the request
target (path plus query string) in --log. Headers and bodies are never stored:
a request body is read and thrown away so the client does not see a reset.

Standard library only. Stop it with SIGTERM or SIGINT.
"""

import argparse
import http.server
import os
import signal
import socketserver
import threading
import time

BODY = (
    b'{"type":"error","error":{"type":"authentication_error",'
    b'"message":"stub: this rig accepts no credentials"}}'
)
MAX_DRAIN = 1 << 20  # discard at most 1 MiB of request body
METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, log_path):
        super().__init__(address, handler)
        self.log_path = log_path
        self.log_lock = threading.Lock()

    def record(self, method, target):
        stamp = "%.3f" % time.time()
        line = "%s %s %s\n" % (stamp, method, target)
        with self.log_lock:
            with open(self.log_path, "a", encoding="utf-8") as handle:
                handle.write(line)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        return  # no stderr logging: nothing but the method/target line is kept

    def answer(self):
        self.server.record(self.command, self.path)
        self.drain_body()
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(BODY)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(BODY)
        self.close_connection = True

    def drain_body(self):
        try:
            remaining = min(int(self.headers.get("Content-Length") or 0), MAX_DRAIN)
        except ValueError:
            return
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 65536))
            if not chunk:
                return
            remaining -= len(chunk)


for _name in METHODS:
    setattr(Handler, "do_" + _name, Handler.answer)


def write_port(path, port):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(str(port) + "\n")
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--log", required=True)
    parser.add_argument("--port-file", required=True)
    args = parser.parse_args()
    open(args.log, "a", encoding="utf-8").close()  # exists (empty) from the start
    server = Server(("127.0.0.1", 0), Handler, args.log)
    write_port(args.port_file, server.server_address[1])

    def stop(_signum, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server.serve_forever()
    server.server_close()


if __name__ == "__main__":
    main()
