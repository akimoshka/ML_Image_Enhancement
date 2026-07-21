# Browser ML Image Enhancement

Client-side image enhancement module that runs in the user's browser. The system automatically selects correction parameters for brightness, contrast, saturation, and gamma with a lightweight ML regressor, then applies the correction asynchronously in a Web Worker.

The project is designed for the required browser API workflow:

1. Submit an image for processing and receive a task id.
2. Track task status and progress through API methods or `statuschange` events.
3. Cancel a task if needed.
4. Download the processed image when the task is complete.

## Features

- Runs fully in the browser, without backend upload.
- Uses a Web Worker, so processing does not block the UI.
- Supports task API: `enqueueTask`, `getStatus`, `cancelTask`, `getResult`.
- Emits progress/status events.
- Supports JPG, PNG, BMP, HEIC/HEIF input.
- Rejects images above 15 megapixels.
- Keeps the runtime bundle under the 10 MB project limit.
- Shows processing time in the interface.

## Пример работы сервиса

Ниже показаны 5 примеров обработки из validation-набора: слева входное изображение, в центре результат работы сервиса, справа эталонное изображение.

![Примеры улучшения изображений](docs/example_results.jpg)

## How To Run

Install dependencies:

```bash
npm install
```

Start the local app:

```bash
npm.cmd run dev -- --host 127.0.0.1
```

Build production files:

```bash
npm.cmd run build
```

Preview production build:

```bash
npm.cmd run preview
```

## ML Training

The browser model is stored in:

```text
src/modelWeights.js
```

The training notebook is:

```text
ml/training_and_validation.ipynb
```

The notebook shows dataset preparation, train/validation split, training loss, validation metrics, and visual examples of:

```text
low input -> model output -> high target
```

To regenerate training pairs from high-quality images:

```bash
python ml/create_synthetic_pairs.py --source "ml/data/high res" --out ml/data/quality_pairs --variants 3 --limit 800 --max-side 512
```

To train the model and export browser weights:

```bash
python ml/train_parameter_model.py --dataset ml/data/quality_pairs --out src/modelWeights.js --max-pairs 2400 --validation-split 0.2 --metrics-out ml/training_metrics.json --epochs 4000 --hidden 24
```

Current training uses an 80/20 split: 1920 training pairs and 480 validation pairs when `--max-pairs 2400` is used.

## Module API

```js
import { ImageEnhancementAPI } from './src/imageApi.js';

const enhancer = new ImageEnhancementAPI();

const taskId = await enhancer.enqueueTask(file);
const status = enhancer.getStatus(taskId);
const resultBlob = enhancer.getResult(taskId);
const cancelResult = enhancer.cancelTask(taskId);

enhancer.addEventListener('statuschange', (event) => {
  console.log(event.detail.id, event.detail.status, event.detail.progress);
});
```

## Architecture

1. UI receives the source image.
2. HEIC/HEIF input is converted to PNG when needed.
3. Worker decodes the image with `createImageBitmap`.
4. Worker samples image statistics.
5. ML regressor predicts brightness, contrast, saturation, and gamma.
6. Worker applies correction in chunks and emits progress.
7. Worker returns the enhanced image as a PNG `Blob`.

## Notes

The model is intentionally small because the task requires browser execution and a total code size below 10 MB. It improves tone and color parameters; it is not a super-resolution model and does not reconstruct missing details from heavily pixelated images.
