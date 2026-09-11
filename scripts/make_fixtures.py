from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
FIXTURES.mkdir(parents=True, exist_ok=True)


def save_pattern(name, size, progressive=False, orientation=None):
    image = Image.new("RGB", size, (40, 70, 100))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, size[0] // 2, size[1] // 2), fill=(180, 40, 30))
    draw.rectangle((size[0] // 2, size[1] // 2, size[0] - 1, size[1] - 1), fill=(30, 160, 40))
    options = {"quality": 93, "subsampling": 2, "progressive": progressive}
    if orientation is not None:
        exif = Image.Exif()
        exif[274] = orientation
        options["exif"] = exif.tobytes()
    image.save(FIXTURES / name, **options)
    image.close()


save_pattern("original-5222x6024.jpg", (5222, 6024))
save_pattern("crop-4015x4594.jpg", (4015, 4594))
save_pattern("progressive-5222x6024.jpg", (5222, 6024), progressive=True)
save_pattern("oriented-320x480-o6.jpg", (320, 480), orientation=6)
