# Hong Kong Resistome Map

An interactive map of ARG profiles from `data/*.txt`, deployable as a static GitHub Pages site. No Python server or database runs on the deployed site. The map uses no external tiles, fonts, analytics, or upload services.

## Deploy to GitHub Pages

1. Upload this folder's contents as your GitHub repository root, including the hidden `.github/workflows/pages.yml`, `data/`, and `assets/` directories. The workflow also supports this whole workspace with the app inside `hong-kong-arg-map/`; a matching workflow is provided at the workspace root.
2. In the GitHub repository, open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. Push to `main` or `master`, or run **Deploy resistome map to GitHub Pages** manually from the Actions tab. If using a different default branch, update the workflow's branch list.
4. Open the site URL shown by the deployment job when it succeeds.

The workflow builds a static index from the original text files, validates the calculations, and publishes only `dist/`. Python runs during the build in GitHub Actions; visitors need only a browser. The deployed site includes the research profiles as downloadable static files. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

All asset, worker, and sample URLs are relative, so project URLs such as `https://username.github.io/repository/` work without configuration. No account credentials or repository name are embedded in the app.

## Build and preview locally

From this directory:

```sh
python3 build-static.py
python3 -m http.server 8766 --directory dist --bind 127.0.0.1
```

Open <http://127.0.0.1:8766>. This uses a generic static file server for preview; it has no atlas API or database. Any static web host can serve `dist/`. Do not open `index.html` directly with a `file://` URL, because browser fetches and workers require HTTP(S).

`dist/` is generated and ignored by Git. The build uses only Python's standard library and copies the original profiles unchanged. It does not publish Python scripts, the SQLite cache, notebooks, or parent-directory research inputs.

### Optional live local mode

`python3 launch.py` still provides the original live-data preview at <http://127.0.0.1:8765>. This mode uses a local Python API and refreshes its SQLite index automatically after data edits. It is optional and is not part of the Pages deployment.

## Explore

- Choose a biome or resistance type on the front page, or use the arrow to explore all samples. Desktop entry selects one matching mapped location at random and opens its aggregate profile. On mobile (600 px wide or less), both panels start closed with no location selected: tap Filters to open the left panel, or select a location or district to open its profile. Later filter changes do not randomly change the selection.
- The map stays at a fixed Hong Kong overview. Biome shades are consistent; split markers show biome proportions by sample count. Hover for location and sample information.
- Filter by **Biome**, **Resistance** (Gene / Subtype / Type), and **Area** (District / Location). Feature search helps find exact source labels; it does not pool matching search results into families. Only positive comparison abundances appear in the map and ranking.
- Click a location or district to open its aggregate ARG profile and restrict the ranking and summary counts to that selection. District membership includes marine sites. Location and district selections are mutually exclusive. Click the selection again, click the map background, close the profile, or press Escape to deselect it.
- The right panel supports Gene / Subtype / Type profiles, feature search, individual sample inspection, and complete profile CSV export. The sample picker returns to the aggregate view.
- The ranking below the map supports sorting, pagination, sample inspection, and full-precision CSV export. Equal abundances share a competition rank. Samples without coordinates remain available in the unscoped ranking but cannot be chosen as mapped locations or assigned to districts.
- The reset icon clears filters and selections. **Overview** returns to the front page. Panels can be closed independently of the map.

## Data and calculations

The original text files are the source of truth. Each contains `[metadata]`, `[gene]`, `[subtype]`, and `[type]` sections. Individual sample profiles are read byte-for-byte from those files. Levels use their supplied values independently; duplicate feature rows are summed. Missing metadata is retained as unavailable, and missing coordinates are never inferred. Locations group coordinates rounded to five decimal places.

Point abundance and aggregate profiles use:

```text
sum(ARG abundance × nCell) / sum(nCell)
```

The separate metadata `cpg` field is not used as ARG abundance. Valid zeros contribute cells to the denominator. A feature absent from a valid section is zero; missing or invalid sections are unavailable. Samples with missing, non-finite, zero, or negative cell counts are excluded from weighted calculations. Aggregate panels report coverage.

Marker sizes use selected-biome samples at each site, including valid zeros. Diameters span 14–26 pixels on a square-root scale, with a fixed reference for each comparison measure. Location and district profiles use the currently filtered cohort shown in the ranking. Individual sample values remain unpooled. Profile totals sum the selected section, and chart bars scale to that profile's largest feature.

Displayed abundances and numeric metadata use five significant digits; coordinates use five decimal places. Calculations, sorting, and CSV exports retain full stored precision. Source filename and metadata `cpg` are omitted from the on-screen ranking but retained in its export.

### Updating data

Edit, add, or remove original profiles in `data/` and push the change. GitHub Actions rebuilds and redeploys the index automatically. For a local static preview, rerun `python3 build-static.py` and reload. In optional live local mode, reloading is enough.

The static build includes metadata and a type matrix for startup, plus sparse tables for Gene, Subtype, and Type. A browser worker loads the requested level and computes comparisons and cell-weighted aggregates without blocking the interface. Compressed tables are used when browser decompression is available, with plain-text fallback. Gene and subtype tables load on first use, so the first selection can take longer on a slow connection; subsequent selections reuse the in-memory tables. Content-hashed index filenames prevent stale cached values after deployment.

Individual profiles still load the original `.txt` files. Missing/invalid section status, duplicate sums, valid zeros, cell weights, and coverage follow the same rules as the local index. Static aggregation is checked against the Python calculations across all three levels before deployment.

## Repository layout

- `data/`: original sample profiles, included with the app.
- `index.html`, `styles.css`, `app.js`: interface and interactions.
- `data-loader.js`, `comparison.js`: text parsing, ranking, geometry membership, and abundance calculations.
- `build-static.py`: reproducible static build for Pages.
- `static-data.js`, `static-worker.js`, `static-model.js`: static loading and browser-side calculations.
- `.github/workflows/pages.yml`: build, validation, and Pages deployment.
- `launch.py`, `server.py`, `index_store.py`: optional live local mode and build-time indexing.
- `assets/`: vendored Leaflet, its license, display geometry, administrative geometry, and compressed census source.
- `prepare-boundaries.py`: optional offline map regeneration.
- `validate.py`, `validate-source.cjs`, `test-comparison.cjs`, `test_server.py`: source and behavior checks.

The parent directory retains the original CSV, spreadsheet, metadata, structure mappings, location TSV, and `init.ipynb` used to produce the research profiles. These are research inputs, not application build artifacts. Do not run the notebook merely to launch the map: its generation cell replaces `hong-kong-arg-map/data/`.

## Validate

Node.js is required for JavaScript validation (GitHub Actions installs it automatically):

```sh
python3 validate.py
node --check app.js
python3 build-static.py
node test-static.cjs
python3 validate-static.py
```

Validation compares every original profile with the browser parser and indexed metadata, checks weighted calculations and geometry membership, and exercises the local server with disposable fixtures. Server tests cover live edits, persistent indexing, invalid data, restricted paths, and aggregate profiles.

## Map sources and attribution

- **Display geometry:** [Census and Statistics Department, 2021 Population Census district boundaries](https://data.gov.hk/en-data/dataset/hk-censtatd-census_geo-2021-population-census-by-dcd), via the [official CSDI service](https://portal.csdi.gov.hk/geoportal/?datasetId=censtatd_rcd_1635932856094_19982), downloaded 2026-11-06. The compressed source is `assets/sources/census-2021-districts.geojson.gz`. This is the **2021 boundary vintage**, not current survey or reclamation geometry; population statistics are not used.
- **District membership:** [Home Affairs Department administrative district boundaries](https://data.gov.hk/en-data/dataset/hk-had-json1-hong-kong-administrative-boundaries), stored in `assets/districts.geojson`. All 18 geometries were verified against the official download on 2026-11-06. These include marine areas and are used for membership, without drawing ocean boundaries. They join to the display districts by name.
- **Map library:** [Leaflet 1.9.4](https://leafletjs.com/), vendored with its BSD-2-Clause license in `assets/LEAFLET-LICENSE.txt`.

The display layers share a single boundary network, simplified at approximately one metre with junctions retained. `districts-land.geojson` provides hit areas and selection outlines; `land-display.geojson` is their union; `boundary-mesh.geojson` draws each edge once. Regeneration verifies 18 valid, non-overlapping districts with less than 0.1% changed area per district. Sample coordinates are untouched. This is display geometry, not a survey map.

To regenerate these layers offline from the retained census source, install Shapely 2.0 or later and run `python3 prepare-boundaries.py`. Shapely is not needed to run the app.
