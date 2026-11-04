"""Encode the browser's captured frames as small, looping README GIFs.

Requires Pillow; no image generation or visual effects are applied.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops

root = Path(__file__).resolve().parents[1]
capture_dir = root / 'artifacts' / 'readme-media'
media_dir = root / 'docs' / 'media'
capture = json.loads((capture_dir / 'capture.json').read_text(encoding='utf-8'))
results = []
for clip in capture['clips']:
    sources = sorted((capture_dir / clip['name']).glob('[0-9][0-9][0-9].png'))
    assert len(sources) == clip['frames']
    # One global palette avoids color flicker and improves delta-frame compression.
    sheet = Image.new('RGB', (320 * 5, 200 * 2))
    for i in range(10):
        with Image.open(sources[round(i * (len(sources) - 1) / 9)]) as source:
            sample = source.convert('RGB')
            sample.thumbnail((320, 200))
            sheet.paste(sample, ((i % 5) * 320, (i // 5) * 200))
    palette = sheet.quantize(colors=192, method=Image.Quantize.MEDIANCUT)
    frames = []
    for source_path in sources:
        with Image.open(source_path) as source:
            frames.append(source.convert('RGB').quantize(palette=palette, dither=Image.Dither.NONE))
    target = media_dir / f"{clip['name']}.gif"
    frames[0].save(target, save_all=True, append_images=frames[1:], duration=100,
                   loop=0, optimize=True, disposal=1)
    with Image.open(target) as encoded:
        assert encoded.n_frames > 1 and encoded.info.get('loop') == 0
        duration = 0
        samples = []
        for i in range(encoded.n_frames):
            encoded.seek(i)
            duration += encoded.info.get('duration', 0)
            if i in {0, encoded.n_frames // 2, encoded.n_frames - 1}:
                sample = encoded.convert('RGB')
                sample.save(capture_dir / f"encoded-{clip['name']}-{i}.png")
                samples.append(sample)
        assert ImageChops.difference(samples[0], samples[1]).getbbox()
        assert duration == clip['frames'] * 100
        assert target.stat().st_size < 6 * 1024 * 1024, 'README animation is too large'
        results.append({'name': target.name, 'size': encoded.size, 'frames': encoded.n_frames,
                        'durationMs': duration, 'simulationSpeed': clip['speed'],
                        'bytes': target.stat().st_size,
                        'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
(capture_dir / 'encoding.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(results, ensure_ascii=False, indent=2))
