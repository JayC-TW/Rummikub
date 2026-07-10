#!/usr/bin/env python3
"""拉密 Rummikub 本機啟動器

在終端機執行：
    python3 start_server.py          # 預設埠號 8000
    python3 start_server.py 9000     # 指定埠號

啟動服務成功後會自動開啟預設瀏覽器；按 Ctrl+C 停止服務。
"""

import os
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_PORT = 8000


class QuietHandler(SimpleHTTPRequestHandler):
    """只顯示錯誤，避免每個請求都洗版；並停用快取方便開發時看到最新變更。"""

    def log_message(self, fmt, *args):
        code = args[1] if len(args) > 1 else ""
        if str(code).startswith(("4", "5")):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def find_available_port(start_port: int) -> int:
    """從 start_port 開始往上找可用的埠號。"""
    for port in range(start_port, start_port + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("找不到可用的埠號")


def main() -> None:
    # 切換到本腳本所在資料夾，確保相對路徑正確
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    want_port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    port = find_available_port(want_port)
    if port != want_port:
        print(f"埠號 {want_port} 已被占用，改用 {port}")

    url = f"http://localhost:{port}/"
    server = ThreadingHTTPServer(("127.0.0.1", port), QuietHandler)

    print("=" * 40)
    print("  拉密 Rummikub 已啟動")
    print(f"  網址：{url}")
    print("  按 Ctrl+C 停止服務")
    print("=" * 40)

    # 稍等 0.5 秒讓伺服器就緒後再開瀏覽器
    threading.Timer(0.5, webbrowser.open, args=(url,)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服務已停止，再見！")
        server.server_close()


if __name__ == "__main__":
    main()
