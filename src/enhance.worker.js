const cancelled = new Set();
const MAX_PIXELS = 15_000_000;

self.onmessage = async (event) => {
  const { type, taskId, blob } = event.data;
  if (type === 'cancel') {
    cancelled.add(taskId);
    return;
  }
  if (type !== 'start') return;

  try {
    postStatus(taskId, 'decoding', 8);
    const bitmap = await createImageBitmap(blob);
    const pixels = bitmap.width * bitmap.height;
    if (pixels > MAX_PIXELS) {
      throw new Error(`Image is too large: ${(pixels / 1_000_000).toFixed(1)} MP. Maximum is 15 MP.`);
    }

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    postStatus(taskId, 'analyzing', 18);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const params = estimateEnhancementParams(imageData.data);

    postStatus(taskId, 'enhancing', 28);
    await enhancePixels(taskId, imageData.data, params);
    if (cancelled.has(taskId)) return finishCancel(taskId);

    ctx.putImageData(imageData, 0, 0);
    postStatus(taskId, 'encoding', 94);
    const resultBlob = await canvas.convertToBlob({ type: 'image/png' });

    postMessage({ type: 'done', taskId, blob: resultBlob });
  } catch (error) {
    postMessage({ type: 'error', taskId, error: error.message || String(error) });
  }
};

function estimateEnhancementParams(data) {
  const step = Math.max(4, Math.floor(data.length / 220_000) * 4);
  let n = 0, sumL = 0, sumL2 = 0, sumSat = 0;
  let dark = 0, bright = 0;

  for (let i = 0; i < data.length; i += step) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = max === 0 ? 0 : (max - min) / max;
    sumL += luma;
    sumL2 += luma * luma;
    sumSat += sat;
    if (luma < 0.12) dark++;
    if (luma > 0.92) bright++;
    n++;
  }

  const mean = sumL / n;
  const variance = Math.max(0, sumL2 / n - mean * mean);
  const contrast = Math.sqrt(variance);
  const saturation = sumSat / n;
  const darkRatio = dark / n;
  const brightRatio = bright / n;

  // Tiny deterministic “ML-like” regression layer trained by design targets:
  // target mean ≈ 0.52, contrast ≈ 0.22, saturation ≈ 0.42.
  const brightness = clamp((0.52 - mean) * 72 - brightRatio * 10 + darkRatio * 8, -28, 34);
  const contrastBoost = clamp(1 + (0.22 - contrast) * 1.15, 0.88, 1.32);
  const saturationBoost = clamp(1 + (0.42 - saturation) * 0.85, 0.9, 1.28);
  const gamma = clamp(1 - (0.5 - mean) * 0.18, 0.88, 1.12);

  return { brightness, contrastBoost, saturationBoost, gamma };
}

async function enhancePixels(taskId, data, p) {
  const chunk = 900_000 * 4;
  for (let start = 0; start < data.length; start += chunk) {
    if (cancelled.has(taskId)) return;
    const end = Math.min(start + chunk, data.length);
    for (let i = start; i < end; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];

      r = applyTone(r, p);
      g = applyTone(g, p);
      b = applyTone(b, p);

      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      data[i] = clamp(gray + (r - gray) * p.saturationBoost, 0, 255);
      data[i + 1] = clamp(gray + (g - gray) * p.saturationBoost, 0, 255);
      data[i + 2] = clamp(gray + (b - gray) * p.saturationBoost, 0, 255);
    }
    const progress = 28 + (end / data.length) * 64;
    postStatus(taskId, 'enhancing', progress);
    await sleep(0);
  }
}

function applyTone(v, p) {
  let x = v / 255;
  x = Math.pow(x, p.gamma);
  x = (x - 0.5) * p.contrastBoost + 0.5;
  x = x * 255 + p.brightness;
  return clamp(x, 0, 255);
}

function postStatus(taskId, status, progress) {
  postMessage({ type: 'status', taskId, status, progress });
}

function finishCancel(taskId) {
  postStatus(taskId, 'cancelled', 0);
  cancelled.delete(taskId);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
