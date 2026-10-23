# -*- coding: utf-8 -*-
"""慢速下载源：40 块 × 64KB，每块停 0.12s（约 4.8 秒下完），用来实测“下载中 XX%”"""
import io
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
CHUNK = b"\x07" * (64 * 1024)
N = 40


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/apk"):
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(CHUNK) * N))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            for _ in range(N):
                self.wfile.write(CHUNK)
                self.wfile.flush()
                time.sleep(0.12)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    print("slow server on", port)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
