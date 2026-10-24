"""Serve the player and the live panel on localhost.

    python3 video/serve.py            # http://localhost:8000/player/

Python's built-in file server ignores byte-range requests, and browsers need them to
seek inside a video; this one answers them.
"""

import argparse
import http.server
import os
import re
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    range_left = None

    def send_head(self):
        path = self.translate_path(self.path)
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if not match or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        first, last = match.groups()
        if first:
            start, end = int(first), min(int(last), size - 1) if last else size - 1
        else:
            start, end = max(0, size - int(last or 0)), size - 1
        if start >= size or start > end:
            self.send_error(416, "Requested range not satisfiable")
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self.range_left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        try:
            if self.range_left is None:
                return super().copyfile(source, outputfile)
            while self.range_left > 0:
                chunk = source.read(min(256 * 1024, self.range_left))
                if not chunk:
                    break
                outputfile.write(chunk)
                self.range_left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the browser dropped a range it no longer needs

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(ROOT)))
    print(f"Player:     http://localhost:{args.port}/player/")
    print(f"Live panel: http://localhost:{args.port}/panel/")
    server.serve_forever()


if __name__ == "__main__":
    main()
