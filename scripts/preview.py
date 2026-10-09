"""Local preview with the same room routes as production. Run: python scripts/preview.py"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
import os, re
os.chdir(Path(__file__).resolve().parents[1])
class Routes(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path.rstrip('/')
        if path == '/room' or re.fullmatch(r'/(?:r|room)/[A-Za-z0-9]{4,6}', path):
            self.path = '/p2p.html'
        super().do_GET()
if __name__ == '__main__':
    print('Pooled preview: http://localhost:8089', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8089), Routes).serve_forever()

