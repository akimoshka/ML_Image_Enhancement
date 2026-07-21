import argparse
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}


def load_image(path, max_side):
    image = Image.open(path)
    image = ImageOps.exif_transpose(image).convert('RGB')
    image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return image


def apply_gamma(image, gamma):
    arr = np.asarray(image, dtype=np.float32) / 255.0
    arr = np.power(np.clip(arr, 0, 1), gamma)
    return Image.fromarray(np.clip(arr * 255, 0, 255).astype(np.uint8), 'RGB')


def degrade_image(image, rng):
    low = image.copy()
    low = ImageEnhance.Brightness(low).enhance(rng.uniform(0.72, 1.06))
    low = ImageEnhance.Contrast(low).enhance(rng.uniform(0.72, 1.04))
    low = ImageEnhance.Color(low).enhance(rng.uniform(0.72, 1.02))
    low = apply_gamma(low, rng.uniform(0.9, 1.16))

    if rng.random() < 0.45:
      low = low.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.2, 0.8)))

    if rng.random() < 0.5:
        arr = np.asarray(low, dtype=np.float32)
        noise = rng.normalvariate(0, rng.uniform(1.5, 5.0))
        arr += np.random.default_rng(rng.randrange(1_000_000)).normal(0, abs(noise), arr.shape)
        low = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')

    return low


def iter_images(source_dir):
    for path in sorted(source_dir.rglob('*')):
        if path.suffix.lower() in IMAGE_EXTENSIONS:
            yield path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True, help='Folder with high-quality source images')
    parser.add_argument('--out', type=Path, required=True, help='Output dataset folder')
    parser.add_argument('--variants', type=int, default=2, help='Low-quality variants per source image')
    parser.add_argument('--max-side', type=int, default=768, help='Resize long side for generated pairs')
    parser.add_argument('--limit', type=int, default=0, help='Maximum number of source images to use; 0 means all')
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    low_dir = args.out / 'low'
    high_dir = args.out / 'high'
    low_dir.mkdir(parents=True, exist_ok=True)
    high_dir.mkdir(parents=True, exist_ok=True)

    count = 0
    for source_index, image_path in enumerate(iter_images(args.source)):
        if args.limit and source_index >= args.limit:
            break
        high = load_image(image_path, args.max_side)
        stem = image_path.stem.replace(' ', '_')
        for variant in range(args.variants):
            name = f'{stem}_{variant:02d}.jpg'
            low = degrade_image(high, rng)
            high.save(high_dir / name, quality=95)
            low.save(low_dir / name, quality=rng.randint(58, 82))
            count += 1

    if count == 0:
        raise SystemExit(f'No images found in {args.source}')

    print(f'Created {count} paired images in {args.out}')


if __name__ == '__main__':
    main()
