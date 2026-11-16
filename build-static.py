"""Build a self-contained GitHub Pages site from original data/*.txt (stdlib only)."""
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote
import gzip
import hashlib
import json
import shutil
from index_store import AtlasIndex, LEVELS

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'dist'


def build(output=OUTPUT, data_dir=ROOT / 'data'):
    output, data_dir = Path(output), Path(data_dir)
    # The dedicated output is disposable; never delete arbitrary user paths.
    if output.resolve() != OUTPUT.resolve():
        raise ValueError('Build output must be the app dist/ directory')
    if not any(data_dir.glob('*.txt')):
        raise ValueError('No source profiles found in data/')
    with TemporaryDirectory(prefix='arg-pages-') as temporary:
        stage = Path(temporary) / 'site'
        assets = stage / 'static-index'
        assets.mkdir(parents=True)
        store = AtlasIndex(data_dir, Path(temporary) / 'index.sqlite')
        try:
            store.refresh()
            manifest = {'version': 1, 'levels': {}}
            def write_asset(name, content, compress=False):
                digest = hashlib.sha256(content).hexdigest()[:16]
                filename = f'{name}.{digest}.tsv'
                (assets / filename).write_bytes(content)
                if compress:
                    (assets / (filename + '.gz')).write_bytes(gzip.compress(content, mtime=0))
                return filename
            manifest['metadata'] = write_asset('metadata', store.response('metadata'))
            manifest['typeMatrix'] = write_asset('type-matrix', store.response('type-matrix'))
            files = [name for name, in store.db.execute('SELECT name FROM files ORDER BY name')]
            positions = {name: i for i, name in enumerate(files)}
            for level in LEVELS:
                lines = ['[samples]']
                for file, status, total in store.db.execute('SELECT file,status,total FROM sections WHERE level=? ORDER BY file', (level,)):
                    lines.append(f'{quote(file, safe="")}\t{status}\t{total if status == "ok" else ""}')
                lines.append('[features]')
                previous, cells = None, []
                for name, file, value in store.db.execute('SELECT feature,file,value FROM abundance WHERE level=? ORDER BY feature,file', (level,)):
                    if name != previous:
                        if previous is not None:
                            lines.append(quote(previous, safe='') + '\t' + '\t'.join(cells))
                        previous, cells = name, []
                    cells.append(f'{positions[file]}:{value}')
                if previous is not None:
                    lines.append(quote(previous, safe='') + '\t' + '\t'.join(cells))
                manifest['levels'][level] = write_asset(level, '\n'.join(lines).encode(), compress=True)
            (assets / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            for name in ('app.js','styles.css','data-loader.js','comparison.js','static-model.js','static-worker.js','static-data.js'):
                shutil.copy2(ROOT / name, stage / name)
            html = (ROOT / 'index.html').read_text().replace('<script src="app.js">', '<script src="static-data.js"></script><script src="app.js">')
            (stage / 'index.html').write_text(html)
            (stage / '.nojekyll').touch()
            shutil.copytree(ROOT / 'assets', stage / 'assets')
            (stage / 'data').mkdir()
            for name in files:
                shutil.copy2(data_dir / name, stage / 'data' / name)
            if output.exists():
                shutil.rmtree(output)
            shutil.copytree(stage, output)
            print(f'Built {len(files)} original profiles into {output}; no runtime API or Python server required.')
        finally:
            store.close()


if __name__ == '__main__':
    build()
