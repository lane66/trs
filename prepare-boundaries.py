"""Build a consistent display map from the official 2021 census geometry.

Optional maintenance command; requires Shapely >= 2.0. The atlas itself has no
GIS runtime dependency. Sample metadata and coordinates are never processed here.
"""
from pathlib import Path
import gzip
import json
from shapely import set_precision
from shapely.geometry import shape, mapping
from shapely.ops import unary_union, linemerge, polygonize

ASSETS = Path(__file__).resolve().parent / 'assets'
GRID = 0.0000001  # About 1 cm: normalize numerical projection noise at shared edges.
TOLERANCE = 0.00001  # About 1 metre: below a display pixel at the fixed city overview.
source = json.loads(gzip.decompress((ASSETS / 'sources/census-2021-districts.geojson.gz').read_bytes()))
originals = [shape(f['geometry']) for f in source['features']]
assert len(originals) == 18 and all(not g.is_empty for g in originals)
geometries = [set_precision(g, GRID) for g in originals]
assert all(g.is_valid for g in geometries)
assert all(abs(g.area - raw.area) / raw.area < 0.00001 for raw, g in zip(originals, geometries))

# Simplify shared arcs once, keeping all junctions fixed. Re-node after
# simplification so near-coincident shoreline intersections form closed faces.
network = linemerge(unary_union([g.boundary for g in geometries]))
arcs = [arc.simplify(TOLERANCE, preserve_topology=True) for arc in network.geoms]
faces = list(polygonize(unary_union(arcs)))
assigned = [[] for _ in geometries]
for face in faces:
    point = face.representative_point()
    owners = [i for i, geometry in enumerate(geometries) if geometry.covers(point)]
    assert len(owners) <= 1
    if owners:  # Unowned faces are water holes; do not fill them.
        assigned[owners[0]].append(face)
districts = [set_precision(unary_union(parts), GRID) for parts in assigned]
land = unary_union(districts)
mesh = linemerge(unary_union([g.boundary for g in districts]))

# These checks catch dropped districts, duplicate areas, broken polygons, and
# significant shape changes. Every displayed edge comes from this one network.
assert all(g.is_valid and not g.is_empty for g in districts)
assert land.is_valid and mesh.is_valid
assert abs(sum(g.area for g in districts) - land.area) < 1e-12
errors = [old.symmetric_difference(new).area / old.area for old, new in zip(geometries, districts)]
assert max(errors) < 0.001, errors  # Less than 0.1% changed area in every district.
assert abs(mesh.length - unary_union(mesh).length) < 1e-12


def rounded(value):
    if isinstance(value, float):
        return round(value, 7)
    if isinstance(value, (list, tuple)):
        return [rounded(v) for v in value]
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    return value


def feature(geometry, properties):
    result = rounded({'type': 'Feature', 'properties': properties, 'geometry': mapping(geometry)})
    assert shape(result['geometry']).is_valid
    return result


def write(name, features):
    (ASSETS / name).write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, ensure_ascii=False, separators=(',', ':')))


write('districts-land.geojson', [feature(g, f['properties']) for g, f in zip(districts, source['features'])])
write('land-display.geojson', [feature(land, {'source': 'Census and Statistics Department, 2021 census district boundaries'})])
write('boundary-mesh.geojson', [feature(mesh, {'description': 'Coastline and shared district edges, drawn once'})])
print(f'PASS: 18 valid, non-overlapping districts; maximum changed area {max(errors):.4%}; consistent land union and single-stroke boundary mesh.')
