from PIL import Image
from pathlib import Path

source = Path("apps/web/public/orivane-atlas.png")
target = Path("assets/orivane-atlas-icon.png")
image = Image.open(source).convert("RGBA")
side = max(image.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.alpha_composite(image, ((side - image.width) // 2, (side - image.height) // 2))
canvas.save(target)
