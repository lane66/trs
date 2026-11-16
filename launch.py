"""Open the atlas directly against bundled data/; Ctrl+C stops the local server."""
import argparse
import os
from http.server import ThreadingHTTPServer
import webbrowser

from server import AtlasHandler, DATA_DIR, ROOT
from index_store import AtlasIndex

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8765')))
    parser.add_argument('--host', default='127.0.0.1', help='Bind address; use 0.0.0.0 for hosted deployment')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not DATA_DIR.is_dir():
        parser.error(f'Data folder not found: {DATA_DIR}')
    server = ThreadingHTTPServer((args.host, args.port), AtlasHandler)
    server.atlas_index = AtlasIndex(DATA_DIR, ROOT / '.cache' / 'atlas.sqlite')
    server.atlas_index.refresh()
    url = f'http://127.0.0.1:{server.server_address[1]}/'
    print(f'ARG Atlas: {url}\nReading original files from {DATA_DIR}\nKeep this terminal open. Press Ctrl+C to stop.', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.atlas_index.close()
