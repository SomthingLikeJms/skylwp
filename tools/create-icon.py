from pathlib import Path
from PIL import Image, ImageDraw

folder = Path(__file__).resolve().parents[1] / 'apps/shell/icons'
folder.mkdir(parents=True, exist_ok=True)
image = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 255, 255), 44, fill=(8, 13, 25, 255))
for left, top, right, bottom, color in [(42, 40, 78, 216, '#f2b35b'), (112, 96, 148, 216, '#73dbcc'), (182, 64, 218, 216, '#9e86df')]:
    for y in range(top, bottom, 12):
        for x in range(left, right, 12):
            draw.rectangle((x, y, x + 5, y + 5), fill=color)
image.save(folder / 'icon.png')
image.save(folder / 'icon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
