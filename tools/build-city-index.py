"""Create the embedded city-name index from the public GeoNames cities15000 dump."""
import hashlib
import json
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
archive = root / 'artifacts/geonames/cities15000.zip'
output = root / 'apps/shell/data/cities.tsv'
overrides = {'1796236': '上海', '1799962': '南京', '1816670': '北京', '1819729': '香港', '5128581': '纽约'}
rows = []
with zipfile.ZipFile(archive) as source:
    for raw in source.read('cities15000.txt').decode('utf-8').splitlines():
        f = raw.split('\t')
        if len(f) < 19 or f[6] != 'P' or f[7] == 'PPLX':
            continue
        name = f[1]
        aliases = [n for n in f[3].split(',') if n and all('\u3400' <= c <= '\u9fff' or c in '·-' for c in n)]
        if aliases:
            name = next((n for n in aliases if n.endswith('市')), aliases[0])
        name = overrides.get(f[0], name).replace('\t', ' ').replace('\n', ' ')[:48]
        rows.append('\t'.join([name, f[4], f[5], f[8], f[7]]))
output.write_text('\n'.join(rows) + '\n', encoding='utf-8')
metadata = {'source': 'https://download.geonames.org/export/dump/cities15000.zip',
            'license': 'CC BY 4.0', 'retrieved': '2026-11-02', 'rows': len(rows),
            'sourceSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
            'description': 'Names and coordinates only; nearest-city labels are approximate, not administrative boundaries.'}
(output.parent / 'cities-source.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'rows': len(rows), 'bytes': output.stat().st_size}))
