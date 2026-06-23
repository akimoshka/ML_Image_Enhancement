# ML Image Enhancement

Client-side browser module for automatic enhancement of brightness, contrast and colorfulness.

## Features

- Works fully in browser, without backend upload.
- Public task API: enqueue, status, cancel, result.
- Async processing in Web Worker, so UI is not blocked.
- Progress events through `statuschange`.
- JPG, PNG, BMP support through browser image decoding.
- HEIC/HEIF conversion through `heic2any` fallback.
- Input guard for images above 15 megapixels.
- Output as PNG Blob.

## Local setup

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy to GitHub Pages

This repository includes `.github/workflows/deploy.yml`.

In GitHub:
1. Open repository Settings.
2. Go to Pages.
3. Set Source to GitHub Actions.
4. Push to `main`.

## Module API

```js
import { ImageEnhancementAPI } from './src/imageApi.js';

const enhancer = new ImageEnhancementAPI();
const taskId = await enhancer.enqueueTask(file);
const status = enhancer.getStatus(taskId);
enhancer.cancelTask(taskId);
const resultBlob = enhancer.getResult(taskId);

enhancer.addEventListener('statuschange', (event) => {
  console.log(event.detail.id, event.detail.status, event.detail.progress);
});
```

## Architecture

1. UI receives the source image.
2. HEIC/HEIF is converted to PNG when needed.
3. Worker decodes image with `createImageBitmap`.
4. Worker samples pixels and estimates enhancement parameters.
5. Worker applies brightness, contrast, gamma and saturation correction in chunks.
6. Worker emits progress events and returns a Blob.

## Notes

HEIC support is limited across browsers, so the project includes conversion fallback. If conversion fails because of browser limitations, the UI shows an error and recommends converting to JPG/PNG.
