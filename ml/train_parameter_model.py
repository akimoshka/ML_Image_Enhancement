import argparse
import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image


IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp'}


def load_rgb(path, size=256):
    image = Image.open(path).convert('RGB')
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    return np.asarray(image, dtype=np.float32) / 255.0


def image_features(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    max_rgb = rgb.max(axis=-1)
    min_rgb = rgb.min(axis=-1)
    saturation = np.divide(max_rgb - min_rgb, max_rgb, out=np.zeros_like(max_rgb), where=max_rgb != 0)
    p05, p25, p50, p75, p95 = np.percentile(luma, [5, 25, 50, 75, 95])
    sat_p50, sat_p90 = np.percentile(saturation, [50, 90])
    return np.array(
        [
            float(luma.mean()),
            float(luma.std()),
            float(saturation.mean()),
            float((luma < 0.12).mean()),
            float((luma > 0.92).mean()),
            float(p05),
            float(p25),
            float(p50),
            float(p75),
            float(p95),
            float(saturation.std()),
            float(sat_p50),
            float(sat_p90),
            float((r - b).mean()),
            float((g - b).mean()),
        ],
        dtype=np.float32,
    )


def fit_target_params(source, target):
    source_features = image_features(source)
    target_features = image_features(target)
    source_mean, source_contrast, source_saturation, source_dark, source_bright = source_features[:5]
    target_mean, target_contrast, target_saturation, target_dark, target_bright = target_features[:5]

    brightness = np.clip((target_mean - source_mean) * 92 + (source_dark - target_dark) * 8 - source_bright * 4, -28, 36)
    contrast = np.clip(target_contrast / max(source_contrast, 0.03), 0.88, 1.34)
    saturation = np.clip(target_saturation / max(source_saturation, 0.05), 0.9, 1.3)
    gamma = np.clip(1 - (target_mean - source_mean) * 0.22, 0.88, 1.12)

    return np.array([brightness, contrast, saturation, gamma], dtype=np.float32)


def paired_paths(input_dir, target_dir):
    targets = {path.name.lower(): path for path in target_dir.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS}
    for source in input_dir.iterdir():
        if source.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        target = targets.get(source.name.lower())
        if target:
            yield source, target


def paired_paths_from_csv(dataset_dir, csv_path, input_dir, target_dir):
    with csv_path.open(newline='', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            source_name = row.get('low_res') or row.get('low') or row.get('input')
            target_name = row.get('high_res') or row.get('high') or row.get('target')
            if not source_name or not target_name:
                continue

            source = dataset_dir / input_dir / source_name
            target = dataset_dir / target_dir / target_name
            if source.exists() and target.exists():
                yield source, target


def relu(x):
    return np.maximum(x, 0)


def predict_mlp(features, weights):
    x_mean, x_scale, y_mean, y_scale, w1, b1, w2, b2 = weights
    x = (features - x_mean) / x_scale
    hidden = relu(x @ w1 + b1)
    predicted = hidden @ w2 + b2
    return predicted * y_scale + y_mean


def train_mlp(features, targets, epochs=2500, lr=0.008, hidden=24):
    rng = np.random.default_rng(42)
    x_mean = features.mean(axis=0)
    x_scale = features.std(axis=0) + 1e-6
    y_mean = targets.mean(axis=0)
    y_scale = targets.std(axis=0) + 1e-6
    x = (features - x_mean) / x_scale
    y = (targets - y_mean) / y_scale

    w1 = rng.normal(0, 0.2, (features.shape[1], hidden)).astype(np.float32)
    b1 = np.zeros(hidden, dtype=np.float32)
    w2 = rng.normal(0, 0.2, (hidden, targets.shape[1])).astype(np.float32)
    b2 = np.zeros(targets.shape[1], dtype=np.float32)

    history = []
    for epoch in range(epochs):
        h_raw = x @ w1 + b1
        h = relu(h_raw)
        pred = h @ w2 + b2
        loss = float(np.mean((pred - y) ** 2))
        if epoch % 100 == 0 or epoch == epochs - 1:
            history.append({'epoch': epoch, 'loss': loss})
        grad = 2 * (pred - y) / len(x)
        dw2 = h.T @ grad
        db2 = grad.sum(axis=0)
        dh = grad @ w2.T
        dh[h_raw <= 0] = 0
        dw1 = x.T @ dh
        db1 = dh.sum(axis=0)
        w1 -= lr * dw1
        b1 -= lr * db1
        w2 -= lr * dw2
        b2 -= lr * db2

    return (x_mean, x_scale, y_mean, y_scale, w1, b1, w2, b2), history


def split_train_validation(features, targets, validation_split, seed):
    rng = np.random.default_rng(seed)
    indices = np.arange(len(features))
    rng.shuffle(indices)
    validation_count = int(round(len(indices) * validation_split))
    validation_count = min(max(validation_count, 1), len(indices) - 1)
    validation_indices = indices[:validation_count]
    train_indices = indices[validation_count:]
    return (
        features[train_indices],
        targets[train_indices],
        features[validation_indices],
        targets[validation_indices],
    )


def parameter_metrics(predicted, expected):
    names = ['brightness', 'contrast', 'saturation', 'gamma']
    absolute_error = np.abs(predicted - expected)
    return {
        name: {
            'mae': float(absolute_error[:, index].mean()),
            'max_error': float(absolute_error[:, index].max()),
        }
        for index, name in enumerate(names)
    }


def js_array(name, value):
    return f"export const {name} = {np.asarray(value).round(6).tolist()};\n"


def export_weights(out_path, weights):
    x_mean, x_scale, y_mean, y_scale, w1, b1, w2, b2 = weights
    content = "export const MODEL_VERSION = 'trained-regressor-v1';\n\n"
    content += js_array('FEATURE_MEAN', x_mean)
    content += js_array('FEATURE_SCALE', x_scale)
    content += js_array('TARGET_MEAN', y_mean)
    content += js_array('TARGET_SCALE', y_scale)
    content += js_array('HIDDEN_WEIGHTS', w1.T)
    content += js_array('HIDDEN_BIAS', b1)
    content += js_array('OUTPUT_WEIGHTS', w2.T)
    content += js_array('OUTPUT_BIAS', b2)
    out_path.write_text(content, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--input-dir', default='low')
    parser.add_argument('--target-dir', default='high')
    parser.add_argument('--pairs-csv', type=Path, default=None)
    parser.add_argument('--out', type=Path, default=Path('src/modelWeights.js'))
    parser.add_argument('--metrics-out', type=Path, default=Path('ml/training_metrics.json'))
    parser.add_argument('--max-pairs', type=int, default=0, help='Maximum number of image pairs to train on; 0 means all')
    parser.add_argument('--validation-split', type=float, default=0.2)
    parser.add_argument('--epochs', type=int, default=2500)
    parser.add_argument('--hidden', type=int, default=24)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

    input_dir = args.dataset / args.input_dir
    target_dir = args.dataset / args.target_dir
    csv_path = args.pairs_csv if args.pairs_csv is None or args.pairs_csv.is_absolute() else args.dataset / args.pairs_csv
    features = []
    targets = []

    pairs = (
        paired_paths_from_csv(args.dataset, csv_path, args.input_dir, args.target_dir)
        if csv_path
        else paired_paths(input_dir, target_dir)
    )

    for pair_index, (source_path, target_path) in enumerate(pairs):
        if args.max_pairs and pair_index >= args.max_pairs:
            break
        source = load_rgb(source_path)
        target = load_rgb(target_path)
        if source.shape != target.shape:
            target_image = Image.fromarray((target * 255).astype(np.uint8)).resize(source.shape[1::-1])
            target = np.asarray(target_image, dtype=np.float32) / 255.0
        features.append(image_features(source))
        targets.append(fit_target_params(source, target))

    if not features:
        raise SystemExit(f'No paired images found in {input_dir} and {target_dir}')

    features = np.vstack(features)
    targets = np.vstack(targets)
    train_x, train_y, validation_x, validation_y = split_train_validation(
        features,
        targets,
        args.validation_split,
        args.seed,
    )

    weights, history = train_mlp(train_x, train_y, epochs=args.epochs, hidden=args.hidden)
    train_predictions = predict_mlp(train_x, weights)
    validation_predictions = predict_mlp(validation_x, weights)
    export_weights(args.out, weights)
    metrics = {
        'pairs_total': int(len(features)),
        'pairs_train': int(len(train_x)),
        'pairs_validation': int(len(validation_x)),
        'epochs': int(args.epochs),
        'hidden_units': int(args.hidden),
        'history': history,
        'train': parameter_metrics(train_predictions, train_y),
        'validation': parameter_metrics(validation_predictions, validation_y),
    }
    args.metrics_out.parent.mkdir(parents=True, exist_ok=True)
    args.metrics_out.write_text(json.dumps(metrics, indent=2), encoding='utf-8')
    print(f'Exported weights from {len(train_x)} training pairs to {args.out}')
    print(f'Validation pairs: {len(validation_x)}')
    print(f'Metrics: {args.metrics_out}')


if __name__ == '__main__':
    main()
