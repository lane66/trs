"""Disposable SQLite index of original sample files, refreshed incrementally."""
import math
import sqlite3
import threading
from pathlib import Path
from urllib.parse import quote

LEVELS = ('type', 'subtype', 'gene')


def parse_source(path):
    sections, invalid, metadata = {}, set(), []
    try:
        text = path.read_text(encoding='utf-8-sig')
    except (OSError, UnicodeError):
        return '', {level: (None, 'invalid_data') for level in LEVELS}
    section = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1].lower()
            if section in LEVELS:
                sections.setdefault(section, {})
        elif section in LEVELS:
            try:
                name, value = line.split('\t', 1)
                value = float(value)
                if not math.isfinite(value) or value < 0:
                    raise ValueError('Invalid abundance')
                sections[section].setdefault(name, []).append(value)
            except (ValueError, OverflowError):
                invalid.add(section)
        if section == 'metadata':
            metadata.append(raw)
    result = {}
    for level in LEVELS:
        if level in invalid:
            result[level] = None, 'invalid_data'
        elif level not in sections:
            result[level] = None, 'missing_section'
        else:
            try:
                values = {name: math.fsum(rows) for name, rows in sections[level].items()}
                if not math.isfinite(math.fsum(values.values())):
                    raise ValueError('Invalid total')
                result[level] = values, 'ok'
            except (ValueError, OverflowError):
                result[level] = None, 'invalid_data'
    return '\n'.join(metadata), result


class AtlasIndex:
    def __init__(self, data_dir, index_path):
        self.data_dir = Path(data_dir)
        self.lock = threading.RLock()
        Path(index_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(index_path, check_same_thread=False)
        self.db.executescript('''
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS files (
                name TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, metadata TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sections (
                file TEXT REFERENCES files(name) ON DELETE CASCADE,
                level TEXT, status TEXT, total REAL, PRIMARY KEY(file,level));
            CREATE TABLE IF NOT EXISTS abundance (
                file TEXT REFERENCES files(name) ON DELETE CASCADE,
                level TEXT, feature TEXT, value REAL, PRIMARY KEY(file,level,feature));
            CREATE INDEX IF NOT EXISTS feature_lookup ON abundance(level,feature,file);
        ''')
        self.cache = {}

    def close(self):
        self.db.close()

    def refresh(self):
        """Stat files, but only parse added/changed files; remove deleted records."""
        with self.lock:
            current = {}
            for path in sorted(self.data_dir.glob('*.txt')):
                if path.is_symlink() or not path.is_file():
                    continue
                stat = path.stat()
                current[path.name] = f'{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}'
            previous = dict(self.db.execute('SELECT name,fingerprint FROM files'))
            changed = [name for name, stamp in current.items() if previous.get(name) != stamp]
            removed = previous.keys() - current.keys()
            if not changed and not removed:
                return 0
            with self.db:
                for name in [*removed, *changed]:
                    self.db.execute('DELETE FROM files WHERE name=?', (name,))
                for name in changed:
                    path = self.data_dir / name
                    metadata, sections = parse_source(path)
                    # Reject a concurrent edit; the next request can retry cleanly.
                    stat = path.stat()
                    if f'{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}' != current[name]:
                        raise OSError(f'Source changed during indexing: {name}')
                    self.db.execute('INSERT INTO files VALUES(?,?,?)', (name,current[name],metadata))
                    for level, (values,status) in sections.items():
                        total = math.fsum(values.values()) if values is not None else None
                        self.db.execute('INSERT INTO sections VALUES(?,?,?,?)', (name,level,status,total))
                        if values:
                            self.db.executemany('INSERT INTO abundance VALUES(?,?,?,?)',
                                                ((name,level,feature,value) for feature,value in values.items()))
            self.cache.clear()
            return len(changed)

    def response(self, kind, level='type', feature='@total'):
        with self.lock:
            self.refresh()
            key = kind, level, feature
            if key in self.cache:
                return self.cache[key]
            if kind == 'metadata':
                result = '\n\n'.join('[source]\t'+quote(name,safe='')+'\n'+metadata
                                     for name,metadata in self.db.execute('SELECT name,metadata FROM files ORDER BY name'))
            elif kind == 'features':
                result = '\n'.join(quote(name,safe='') for name, in self.db.execute(
                    'SELECT DISTINCT feature FROM abundance WHERE level=? ORDER BY feature', (level,)))
            elif kind == 'comparison':
                if feature == '@total':
                    rows = self.db.execute('SELECT file,total,status FROM sections WHERE level=? ORDER BY file', (level,))
                else:
                    rows = self.db.execute('''SELECT s.file,COALESCE(a.value,0.0),s.status FROM sections s
                        LEFT JOIN abundance a ON a.file=s.file AND a.level=s.level AND a.feature=?
                        WHERE s.level=? ORDER BY s.file''', (feature,level))
                result = 'file\tabundance\tstatus\n'+'\n'.join(
                    f'{quote(file,safe="")}\t{value if status=="ok" else ""}\t{status}' for file,value,status in rows)
            elif kind == 'type-matrix':
                features = [name for name, in self.db.execute("SELECT DISTINCT feature FROM abundance WHERE level='type' ORDER BY feature")]
                records = {}
                for file,name,value in self.db.execute("SELECT file,feature,value FROM abundance WHERE level='type'"):
                    records.setdefault(file,{})[name] = value
                lines = ['\t'.join(['file','status','@total',*(quote(name,safe='') for name in features)])]
                for file,status,total in self.db.execute("SELECT file,status,total FROM sections WHERE level='type' ORDER BY file"):
                    values = records.get(file,{})
                    cells = [str(total),*(str(values.get(name,0.0)) for name in features)] if status=='ok' else ['']*(len(features)+1)
                    lines.append('\t'.join([quote(file,safe=''),status,*cells]))
                result = '\n'.join(lines)
            else:
                raise ValueError('Unknown index query')
            content = result.encode('utf-8')
            self.cache[key] = content
            return content

    def aggregate(self, files, level):
        """Cell-weighted profile for a selected cohort; absent features are zero."""
        with self.lock:
            self.refresh()
            requested = set(files)
            weights = {}
            for file,metadata,status,total in self.db.execute('''SELECT f.name,f.metadata,s.status,s.total
                    FROM files f JOIN sections s ON s.file=f.name WHERE s.level=?''', (level,)):
                if file not in requested or status != 'ok':
                    continue
                fields = dict(line.split('\t',1) for line in metadata.splitlines() if '\t' in line)
                try:
                    cells = float(fields.get('nCell',''))
                except ValueError:
                    continue
                if cells > 0 and math.isfinite(cells) and math.isfinite(cells*total):
                    weights[file] = cells
            total_cells = math.fsum(weights.values())
            copies = {}
            names = list(weights)
            for offset in range(0,len(names),400):
                batch = names[offset:offset+400]
                placeholders = ','.join('?' for _ in batch)
                for file,feature,value in self.db.execute(
                        f'SELECT file,feature,value FROM abundance WHERE level=? AND file IN ({placeholders})',
                        [level,*batch]):
                    copies.setdefault(feature,[]).append(value*weights[file])
            features = sorted(((name,math.fsum(values)/total_cells) for name,values in copies.items()),
                              key=lambda item:(-item[1],item[0])) if total_cells else []
            return {'features':features,'total':math.fsum(value for _,value in features) if weights else None,
                    'totalCells':total_cells,'usedSamples':len(weights),'totalSamples':len(requested),
                    'excludedSamples':len(requested)-len(weights)}
