"""Serve the atlas and its original text data on localhost, without a build step."""
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlsplit, parse_qs
import io
import json
import threading
from index_store import AtlasIndex

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / 'data'
LEVELS = ('type', 'subtype', 'gene')
INDEX_LOCK = threading.Lock()


class AtlasHandler(SimpleHTTPRequestHandler):
    data_dir = DATA_DIR

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def index_store(self):
        with INDEX_LOCK:
            if not hasattr(self.server, 'atlas_index'):
                path = ROOT / '.cache' / 'atlas.sqlite' if self.data_dir == DATA_DIR else self.data_dir / '.atlas-index.sqlite'
                self.server.atlas_index = AtlasIndex(self.data_dir, path)
            return self.server.atlas_index

    def log_request(self, code='-', size='-'):
        # Avoid filling the launcher output pipe with successful asset requests.
        if str(code).startswith(('4', '5')):
            super().log_request(code, size)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def text_response(self, content):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        return io.BytesIO(content)

    def do_POST(self):
        if urlsplit(self.path).path != '/api/aggregate':
            self.send_error(404, 'Not found')
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 1024*1024:
                raise ValueError('Invalid request size')
            query = json.loads(self.rfile.read(length))
            level, files = query.get('level'), query.get('files')
            if level not in LEVELS or not isinstance(files,list) or not all(isinstance(name,str) for name in files):
                raise ValueError('Invalid profile selection')
            content = json.dumps(self.index_store().aggregate(files,level),allow_nan=False).encode()
        except (ValueError, TypeError, AttributeError, OverflowError):
            self.send_error(400, 'Invalid profile request')
            return
        self.send_response(200)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def send_head(self):
        path = urlsplit(self.path).path
        if '/.cache/' in path or path.startswith('/.cache'):
            self.send_error(404, 'Not found')
            return None
        if path == '/api/type-matrix':
            if not self.data_dir.is_dir():
                self.send_error(503, 'The data folder is unavailable')
                return None
            return self.text_response(self.index_store().response('type-matrix'))
        if path in ('/api/features', '/api/comparison'):
            query = parse_qs(urlsplit(self.path).query)
            level = query.get('level', ['type'])[0]
            feature = query.get('feature', ['@total'])[0]
            if level not in LEVELS:
                self.send_error(400, 'Invalid comparison level')
                return None
            if not self.data_dir.is_dir():
                self.send_error(503, 'The data folder is unavailable')
                return None
            content = self.index_store().response('features' if path == '/api/features' else 'comparison', level, feature)
            return self.text_response(content)
        if path == '/api/metadata':
            if not self.data_dir.is_dir():
                self.send_error(503, 'The data folder is unavailable')
                return None
            try:
                return self.text_response(self.index_store().response('metadata'))
            except (OSError, UnicodeError):
                self.send_error(503, 'Could not read the data folder; reload the page')
                return None
        if path.startswith('/data/'):
            name = unquote(path[len('/data/'):])
            # Only direct .txt children are exposed, not arbitrary workspace files.
            if not name.endswith('.txt') or '/' in name or '\\' in name or '\x00' in name:
                self.send_error(404, 'Sample not found')
                return None
            source = self.data_dir / name
            if source.is_symlink() or not source.is_file():
                self.send_error(404, 'Sample not found; reload the page')
                return None
            try:
                return self.text_response(source.read_bytes())
            except OSError:
                self.send_error(503, 'Sample could not be read; try again')
                return None
        # Old generated datasets are deliberately not used or served.
        if path in ('/dataset.js', '/build-report.json') or path.startswith('/profiles/'):
            self.send_error(410, 'Generated data has been replaced by direct text loading')
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, 'Not found')
        return None
