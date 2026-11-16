"""Check the published payload and browser calculations against original data."""
from pathlib import Path
from tempfile import TemporaryDirectory
import gzip
import json
import subprocess
from urllib.parse import quote
from index_store import AtlasIndex

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
manifest = json.loads((DIST / 'static-index/manifest.json').read_text())
with TemporaryDirectory(prefix='arg-parity-') as directory:
    store = AtlasIndex(ROOT / 'data', Path(directory) / 'index.sqlite')
    try:
        store.refresh()
        assert (DIST / 'static-index' / manifest['metadata']).read_bytes() == store.response('metadata')
        assert (DIST / 'static-index' / manifest['typeMatrix']).read_bytes() == store.response('type-matrix')
        samples = []
        for name, metadata in store.db.execute('SELECT name,metadata FROM files ORDER BY name'):
            fields = dict(line.split('\t', 1) for line in metadata.splitlines() if '\t' in line)
            samples.append({'file': name, 'cells': fields.get('nCell', ''), 'biome': fields.get('biome')})
            assert (DIST / 'data' / name).read_bytes() == (ROOT / 'data' / name).read_bytes()
        groups = [samples, samples[:35], [s for s in samples if s['biome'] == 'Marine water'], []]
        cases = {}
        for level, asset in manifest['levels'].items():
            content = (DIST / 'static-index' / asset).read_bytes()
            assert gzip.decompress((DIST / 'static-index' / (asset + '.gz')).read_bytes()) == content
            # Compare every sparse abundance entry, status, total and file order.
            lines = iter(content.decode().splitlines())
            assert next(lines) == '[samples]'
            files = []
            for name, status, total in store.db.execute('SELECT file,status,total FROM sections WHERE level=? ORDER BY file', (level,)):
                assert next(lines) == f'{quote(name, safe="")}\t{status}\t{total if status == "ok" else ""}'
                files.append(name)
            assert next(lines) == '[features]'
            entries = iter(store.db.execute('SELECT feature,file,value FROM abundance WHERE level=? ORDER BY feature,file', (level,)))
            for line in lines:
                name, *cells = line.split('\t')
                for cell in cells:
                    position, value = cell.split(':', 1)
                    expected_name, expected_file, expected_value = next(entries)
                    assert (name, files[int(position)], float(value)) == (quote(expected_name, safe=''), expected_file, expected_value)
            assert next(entries, None) is None
            cases[level] = [{'samples': group, 'expected': store.aggregate([s['file'] for s in group], level)} for group in groups]
        case_path = Path(directory) / 'cases.json'
        case_path.write_text(json.dumps(cases))
        subprocess.run(['node', str(ROOT / 'test-static.cjs'), str(case_path)], check=True)
        assert not list(DIST.rglob('*.py')) and not list(DIST.rglob('*.sqlite'))
        print(f'PASS: {len(samples)} original files unchanged; all static index entries match; compressed files verified; no backend files in deployment.')
    finally:
        store.close()
