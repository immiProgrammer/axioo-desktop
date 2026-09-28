"""Generate every Axioo app icon from assets/icons/axioo-mark.svg.

The mark is drawn white and centred on a rounded #16232e tile, then written out
as the PNG size ladder, the 256px fallback, the multi-size Windows .ico, the
macOS .icns and the image the caption-row menu button uses.

Requirements (dev only, never shipped):
    python -m pip install pillow
    # plus Electron, which the repo already has, for the Chromium raster pass

Usage:
    python .erb/scripts/generate-icons.py
"""

from __future__ import annotations

import os
import struct
import subprocess
import sys
import tempfile
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
MARK_SVG = ROOT / 'assets' / 'icons' / 'axioo-mark.svg'
RENDER_SCRIPT = ROOT / '.erb' / 'scripts' / 'render-mark.cjs'
ICON_DIR = ROOT / 'assets' / 'icons'
TILE_BACKGROUND = (0x16, 0x23, 0x2E, 255)

RASTER = 2048  # render size of the mark before it is trimmed
KEY_COLOR = (0x00, 0xFF, 0x00)  # flat field Chromium renders the mark on
CORNER_RATIO = 0.2  # rounded-rect corner radius, as a share of the tile
MARK_RATIO = 0.75  # longest mark edge, as a share of the tile

LADDER = (16, 24, 32, 48, 64, 96, 128, 256, 512, 1024)
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
FALLBACK_SIZE = 256
MENU_BUTTON_SIZE = 64

# (pixel size, icns type code). Retina variants reuse the same PNG payload.
ICNS_LAYOUT = (
    (32, b'ic11'),
    (64, b'ic12'),
    (128, b'ic07'),
    (256, b'ic13'),
    (256, b'ic08'),
    (512, b'ic14'),
    (512, b'ic09'),
    (1024, b'ic10'),
)


def rasterise_with_chromium(target: Path) -> None:
    """Render the SVG with the Electron/Chromium already in the repo."""
    electron = ROOT / 'node_modules' / 'electron' / 'dist' / 'electron.exe'
    command = [
        str(electron) if electron.exists() else 'npx',
        *( [] if electron.exists() else ['electron'] ),
        str(RENDER_SCRIPT),
        str(MARK_SVG),
        str(target),
        str(RASTER),
    ]
    result = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, 'ELECTRON_DISABLE_SECURITY_WARNINGS': '1'},
    )
    if result.returncode != 0 or not target.exists():
        sys.exit(
            'Could not render the mark with Electron.\n'
            f'{result.stdout}\n{result.stderr}'
        )


def render_mark() -> Image.Image:
    """Rasterise the mark, key out the flat field and trim to its ink."""
    with tempfile.TemporaryDirectory() as workdir:
        rendered = Path(workdir) / 'mark.png'
        rasterise_with_chromium(rendered)
        image = Image.open(rendered).convert('RGBA')

    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, _ = pixels[x, y]
            if abs(red - KEY_COLOR[0]) < 12 and abs(green - KEY_COLOR[1]) < 12:
                pixels[x, y] = (0, 0, 0, 0)
            else:
                pixels[x, y] = (red, green, blue, 255)

    bounds = image.split()[3].getbbox()
    if bounds is None:
        raise SystemExit(f'{MARK_SVG} produced an empty mark')
    return image.crop(bounds)


def build_tile(mark: Image.Image, size: int) -> Image.Image:
    """Compose the rounded tile with the mark centred on it."""
    tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=round(size * CORNER_RATIO),
        fill=TILE_BACKGROUND,
    )
    scale = (size * MARK_RATIO) / max(mark.width, mark.height)
    width = max(1, round(mark.width * scale))
    height = max(1, round(mark.height * scale))
    tile.alpha_composite(
        mark.resize((width, height), Image.LANCZOS),
        ((size - width) // 2, (size - height) // 2),
    )
    return tile


def png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format='PNG', optimize=True)
    return buffer.getvalue()


def write_ico(tiles: dict[int, Image.Image], path: Path) -> None:
    """Write a Vista-style .ico that embeds one PNG per size."""
    payloads = [png_bytes(tiles[size]) for size in ICO_SIZES]
    directory = b''
    offset = 6 + 16 * len(payloads)
    for size, data in zip(ICO_SIZES, payloads):
        # A dimension of 0 means 256 in the ICO directory.
        edge = 0 if size >= 256 else size
        directory += struct.pack(
            '<BBBBHHII', edge, edge, 0, 0, 1, 32, len(data), offset
        )
        offset += len(data)
    path.write_bytes(
        struct.pack('<HHH', 0, 1, len(payloads)) + directory + b''.join(payloads)
    )


def write_icns(tiles: dict[int, Image.Image], path: Path) -> None:
    """Write an .icns made of PNG chunks, which macOS accepts since 10.7."""
    chunks = b''
    for size, code in ICNS_LAYOUT:
        data = png_bytes(tiles[size])
        chunks += code + struct.pack('>I', len(data) + 8) + data
    path.write_bytes(b'icns' + struct.pack('>I', len(chunks) + 8) + chunks)


def main() -> None:
    mark = render_mark()
    tiles = {size: build_tile(mark, size) for size in LADDER}

    for size, tile in tiles.items():
        tile.save(ICON_DIR / f'{size}x{size}.png')
    tiles[FALLBACK_SIZE].save(ROOT / 'assets' / 'icon.png')
    write_ico(tiles, ROOT / 'assets' / 'icon.ico')
    write_icns(tiles, ROOT / 'assets' / 'icon.icns')

    menu_button = ROOT / 'src' / 'renderer' / 'public' / 'axioo-icon.png'
    menu_button.parent.mkdir(parents=True, exist_ok=True)
    tiles[MENU_BUTTON_SIZE].save(menu_button)

    print(f'mark ink: {mark.width}x{mark.height} from {MARK_SVG.name}')
    for size in LADDER:
        print(f'  assets/icons/{size}x{size}.png')
    print('  assets/icon.png, assets/icon.ico, assets/icon.icns')
    print(f'  {menu_button.relative_to(ROOT).as_posix()}')


if __name__ == '__main__':
    main()
