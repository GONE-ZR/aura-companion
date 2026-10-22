#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
本地 mock 的 DeepSeek 服务，只用于离线自测（不联网、不花钱）。
用法：python tests/mock_deepseek.py
接口：POST /v1/chat/completions（支持 stream）
"""
import json
import time
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPLIES = [
    "他凭什么。",
    "骂得重吗。",
    "……嗯。",
    "不是。",
    "行。那我不问了。",
    "我不知道能陪多久。现在是。",
    "嗯。今天不算白过。",
]


class H(BaseHTTPRequestHandler):
    n = 0

    def log_message(self, *a):
        pass

    def do_POST(self):
        if not self.path.endswith("/chat/completions"):
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw or b"{}")
        except Exception:
            body = {}
        stream = bool(body.get("stream"))
        msgs = body.get("messages") or []
        has_image = any(
            isinstance(m.get("content"), list) for m in msgs
        )
        text = REPLIES[H.n % len(REPLIES)]
        H.n += 1

        if stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            # 按字符分块吐，模拟真实流式
            chunks = [text[i:i + 2] for i in range(0, len(text), 2)]
            for c in chunks:
                payload = {"choices": [{"delta": {"content": c}}]}
                self.wfile.write(("data: " + json.dumps(payload, ensure_ascii=False) + "\n\n").encode("utf-8"))
                self.wfile.flush()
                time.sleep(0.05)
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            payload = {
                "id": "mock",
                "model": body.get("model", "deepseek-flash"),
                "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 10}
            }
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        sys.stderr.write("[mock] stream=%s image=%s reply=%s\n" % (stream, has_image, text))
        sys.stderr.flush()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8020
    print("mock deepseek on http://127.0.0.1:%d/v1" % port)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
