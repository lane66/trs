"""Verify raw file delivery and live folder updates using disposable data only."""
import tempfile
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen, Request
from server import AtlasHandler
from index_store import AtlasIndex
from unittest.mock import patch


class LiveDataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)

        class Handler(AtlasHandler):
            data_dir = self.directory

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        if hasattr(self.server, 'atlas_index'):
            self.server.atlas_index.close()
        self.temp.cleanup()

    def read(self, path):
        with urlopen(self.origin + path) as response:
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            return response.read()

    def test_raw_delivery_and_live_edits(self):
        sample = self.directory / 'sample with spaces.txt'
        original = b'[metadata]\nSample\ttest\nbiome\tFW\n\n[gene]\ngeneA\t0.123456789012345\n'
        sample.write_bytes(original)
        self.assertEqual(self.read('/data/sample%20with%20spaces.txt'), original)
        self.assertIn(b'biome\tFW', self.read('/api/metadata'))
        changed = original.replace(b'biome\tFW', b'biome\tRW').replace(b'0.123456789012345', b'0.5')
        sample.write_bytes(changed)
        self.assertEqual(self.read('/data/sample%20with%20spaces.txt'), changed)
        self.assertIn(b'biome\tRW', self.read('/api/metadata'))
        self.assertNotIn(b'[gene]', self.read('/api/metadata'))
        second = self.directory / 'new.txt'
        second.write_bytes(original)
        self.assertEqual(self.read('/api/metadata').count(b'[source]\t'), 2)
        sample.unlink()
        self.assertEqual(self.read('/api/metadata').count(b'[source]\t'), 1)
        with self.assertRaises(HTTPError) as error:
            self.read('/data/sample%20with%20spaces.txt')
        self.assertEqual(error.exception.code, 404)

    def test_restricted_paths_and_retired_generated_data(self):
        for path in ('/data/..%2FREADME.md', '/data/%2Fetc%2Fpasswd.txt', '/data/missing.txt'):
            with self.assertRaises(HTTPError) as error:
                self.read(path)
            self.assertEqual(error.exception.code, 404)
        for path in ('/dataset.js', '/profiles/0.js'):
            with self.assertRaises(HTTPError) as error:
                self.read(path)
            self.assertEqual(error.exception.code, 410)

    def test_comparison_exact_features_and_missing_values(self):
        sample = self.directory / 'sample.txt'
        sample.write_text('[metadata]\nSample\tA\n[type]\nbeta_lactam\t0.25\npolymyxin\t0.75\n[subtype]\npolymyxin__mcr-1.1\t0.1\npolymyxin__mcr-1.2\t0.2\npolymyxin__mcr-1.2\t0.05\npolymyxin__mcr-10.1\t99\n')
        (self.directory / 'zero.txt').write_text('[type]\npolymyxin\t2\n[subtype]\npolymyxin__mcr-10.1\t3\n')
        (self.directory / 'missing.txt').write_text('[metadata]\nSample\tMissing\n[gene]\na\t1\n')
        (self.directory / 'invalid.txt').write_text('[type]\nbeta_lactam\tnan\n')

        def values(query):
            return {line.split('\t')[0]: line.split('\t')[1:] for line in self.read('/api/comparison?' + query).decode().splitlines()[1:]}

        exact = values('level=type&feature=beta_lactam')
        self.assertEqual(exact['sample.txt'], ['0.25', 'ok'])
        self.assertEqual(exact['zero.txt'], ['0.0', 'ok'])
        self.assertEqual(exact['missing.txt'], ['', 'missing_section'])
        self.assertEqual(exact['invalid.txt'], ['', 'invalid_data'])
        subtype = values('level=subtype&feature=polymyxin__mcr-1.2')
        self.assertAlmostEqual(float(subtype['sample.txt'][0]), 0.25)
        self.assertEqual(subtype['zero.txt'], ['0.0', 'ok'])
        self.assertEqual(values('level=type&feature=%40total')['sample.txt'], ['1.0', 'ok'])
        self.assertIn(b'beta_lactam', self.read('/api/features?level=type'))
        sample.write_text('[type]\nbeta_lactam\t7\n')
        self.assertEqual(values('level=type&feature=beta_lactam')['sample.txt'], ['7.0', 'ok'])
        with self.assertRaises(HTTPError) as error:
            self.read('/api/comparison?level=invalid&feature=%40total')
        self.assertEqual(error.exception.code, 400)

    def test_type_matrix_matches_individual_comparisons_and_live_edits(self):
        sample = self.directory / 'sample with spaces.txt'
        sample.write_text('[type]\nbeta_lactam\t0.25\nbeta_lactam\t0.125\npolymyxin\t0.75\n')
        (self.directory / 'zero.txt').write_text('[type]\npolymyxin\t2\n')
        (self.directory / 'missing.txt').write_text('[gene]\na\t1\n')
        (self.directory / 'invalid.txt').write_text('[type]\nbeta_lactam\tnan\n')
        (self.directory / 'empty.txt').write_text('[type]\n')
        matrix = self.read('/api/type-matrix').decode().splitlines()
        features = matrix[0].split('\t')[2:]
        rows = {cells[0]: cells[1:] for cells in (line.split('\t') for line in matrix[1:])}
        for index, feature in enumerate(features):
            exact = self.read('/api/comparison?level=type&feature=' + feature.replace('@', '%40')).decode().splitlines()[1:]
            for line in exact:
                name, value, status = line.split('\t')
                self.assertEqual(rows[name][0], status)
                self.assertEqual(rows[name][index + 1], value)
        sample.write_text('[type]\nnew_type\t7\n')
        changed = self.read('/api/type-matrix').decode()
        self.assertIn('new_type', changed.splitlines()[0])
        self.assertIn('sample%20with%20spaces.txt\tok\t7.0', changed)

    def test_index_persists_and_does_not_reparse_unchanged_sources(self):
        sample = self.directory / 'sample.txt'
        sample.write_text('[metadata]\nSample\tA\n[gene]\ngeneA\t0.25\ngeneA\t0.5\n[type]\nbeta_lactam\t0\n')
        first = self.read('/api/comparison?level=gene&feature=geneA')
        self.assertIn(b'0.75\tok', first)
        with patch('index_store.parse_source', side_effect=AssertionError('Unexpected source reread')):
            self.assertEqual(self.read('/api/comparison?level=gene&feature=geneA'), first)
            self.assertIn(b'geneA', self.read('/api/features?level=gene'))
            self.assertIn(b'Sample\tA', self.read('/api/metadata'))
            reopened = AtlasIndex(self.directory, self.directory / '.atlas-index.sqlite')
            try:
                self.assertEqual(reopened.response('comparison','gene','geneA'), first)
            finally:
                reopened.close()
        sample.write_text('[gene]\ngeneB\t2\n')
        self.assertEqual(self.read('/api/features?level=gene'), b'geneB')
        self.assertIn(b'0.0\tok', self.read('/api/comparison?level=gene&feature=geneA'))
        sample.unlink()
        self.assertEqual(self.read('/api/features?level=gene'), b'')


    def test_cell_weighted_district_profile(self):
        fixtures = {
            'a.txt':'[metadata]\nnCell\t10\n[type]\nx\t1\n',
            'b.txt':'[metadata]\nnCell\t30\n[type]\nx\t2\nx\t1\ny\t2\n',
            'zero.txt':'[metadata]\nnCell\t10\n[type]\nx\t0\n',
            'missing.txt':'[metadata]\nnCell\t10000\n[gene]\ng\t100\n',
            'no-cells.txt':'[metadata]\nnCell\tNA\n[type]\nx\t100\n',
        }
        for name,text in fixtures.items():
            (self.directory/name).write_text(text)
        def aggregate(files,level='type'):
            request=Request(self.origin+'/api/aggregate',data=json.dumps({'files':files,'level':level}).encode(),headers={'Content-Type':'application/json'})
            with urlopen(request) as response:
                return json.load(response)
        result=aggregate([*fixtures,'a.txt'])
        self.assertEqual(dict(result['features']),{'x':2.0,'y':1.2})
        self.assertEqual(result['total'],3.2)
        self.assertEqual(result['totalCells'],50)
        self.assertEqual(result['usedSamples'],3)
        self.assertEqual(result['excludedSamples'],2)
        self.assertEqual(aggregate(['a.txt'])['total'],1)
        self.assertEqual(aggregate([])['features'],[])
        self.assertIsNone(aggregate(['missing.txt'])['total'])
        self.assertEqual(aggregate(['missing.txt'],'gene')['total'],100)
        with self.assertRaises(HTTPError):
            aggregate(['a.txt'],'invalid')



if __name__ == '__main__':
    unittest.main()
