"""Build cities.json and country native names for Wanderglobe from GeoNames.

Usage: python3 build_cities.py <cache-dir>
Downloads cities15000.zip, countryInfo.txt and alternateNamesV2.zip (~200 MB) into cache-dir.
Writes cities.json next to this script and prints the country-native JSON to stdout.
"""
import collections, io, json, os, sys, unicodedata, urllib.request, zipfile

BASE = 'https://download.geonames.org/export/dump/'
PER_COUNTRY = 40
# English is listed first but isn't what locals write; use the next language instead.
EN_FIRST_ALLOWED = {'IN', 'PK', 'PH', 'KE', 'MT'}

cache = sys.argv[1]
os.makedirs(cache, exist_ok=True)


def fetch(name):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        urllib.request.urlretrieve(BASE + name, path)
    return path


def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if not unicodedata.combining(c))


SUFFIX = {'ja': ['市', '都'], 'zh': ['市'], 'ko': ['특별자치시', '특별시', '광역시', '시']}


def tidy(lang, name):
    """Drop administrative suffixes: 横浜市 -> 横浜, 東京都 -> 東京, 서울특별시 -> 서울."""
    for suf in SUFFIX.get(lang.split('-')[0], []):
        if name.endswith(suf) and len(name) - len(suf) >= 2:
            return name[:-len(suf)]
    return name


langs, country_gid = {}, {}
for line in open(fetch('countryInfo.txt'), encoding='utf-8'):
    if line.startswith('#'):
        continue
    f = line.rstrip('\n').split('\t')
    iso, gid, ls = f[0], f[16], [x for x in f[15].split(',') if x]
    if ls and ls[0].split('-')[0] == 'en' and iso not in EN_FIRST_ALLOWED:
        ls = []
    cand = []
    for l in ls:
        for c in (l, l.split('-')[0]):
            if c != 'en' and c not in cand:
                cand.append(c)
    langs[iso] = cand
    if gid:
        country_gid[int(gid)] = iso

by = collections.defaultdict(list)
with zipfile.ZipFile(fetch('cities15000.zip')) as z:
    for line in io.TextIOWrapper(z.open('cities15000.txt'), encoding='utf-8'):
        f = line.rstrip('\n').split('\t')
        by[f[8]].append((int(f[14] or 0), f[7] == 'PPLC', f[1], round(float(f[4]), 3), round(float(f[5]), 3), int(f[0])))
top = {cc: sorted(sorted(rows, key=lambda r: (-r[1], -r[0]))[:PER_COUNTRY], key=lambda r: -r[0]) for cc, rows in by.items()}

want = {r[5]: cc for cc, rows in top.items() for r in rows}
want.update(country_gid)
best = {}  # gid -> (rank, name)
with zipfile.ZipFile(fetch('alternateNamesV2.zip')) as z:
    for line in io.TextIOWrapper(z.open('alternateNamesV2.txt'), encoding='utf-8'):
        f = line.rstrip('\n').split('\t')
        gid = int(f[1])
        cc = want.get(gid)
        if cc is None or f[6] == '1' or f[7] == '1':
            continue
        cand = langs.get(cc, [])
        if f[2] not in cand:
            continue
        name = tidy(f[2], f[3])
        is_country = gid in country_gid
        # Countries: short form ("Deutschland"). Cities: preferred form, then shortest.
        rank = (cand.index(f[2]), f[5] != '1', len(name)) if is_country else (cand.index(f[2]), f[4] != '1', len(name))
        if gid not in best or rank < best[gid][0]:
            best[gid] = (rank, name)


def native(gid, english):
    n = best.get(gid, (None, ''))[1]
    return n if n and fold(n) != fold(english) else ''


out = {}
for cc, rows in top.items():
    out[cc] = []
    for pop, cap, name, lat, lon, gid in rows:
        row = [name, lat, lon, round(pop / 1000), 1 if cap else 0]
        nat = native(gid, name)
        if nat:
            row.append(nat)
        out[cc].append(row)
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cities.json'), 'w', encoding='utf-8') as fh:
    json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))

countries = {iso: best[gid][1] for gid, iso in country_gid.items() if gid in best}
print(json.dumps(countries, ensure_ascii=False, separators=(',', ':')))
