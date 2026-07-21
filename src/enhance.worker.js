import {
  FEATURE_MEAN,
  FEATURE_SCALE,
  HIDDEN_BIAS,
  HIDDEN_WEIGHTS,
  MODEL_VERSION,
  OUTPUT_BIAS,
  OUTPUT_WEIGHTS,
  TARGET_MEAN,
  TARGET_SCALE
} from './modelWeights.js';

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
    const features = extractImageFeatures(imageData.data);
    const params = predictEnhancementParams(features);

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

function extractImageFeatures(data) {
  const step = Math.max(4, Math.floor(data.length / 220_000) * 4);
  let n = 0, sumL = 0, sumL2 = 0, sumSat = 0;
  let sumSat2 = 0, sumWarmth = 0, sumGreenBlue = 0;
  let dark = 0, bright = 0;
  const lumas = [];
  const saturations = [];

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
    sumSat2 += sat * sat;
    sumWarmth += r - b;
    sumGreenBlue += g - b;
    if (luma < 0.12) dark++;
    if (luma > 0.92) bright++;
    lumas.push(luma);
    saturations.push(sat);
    n++;
  }

  const mean = sumL / n;
  const variance = Math.max(0, sumL2 / n - mean * mean);
  const contrast = Math.sqrt(variance);
  const saturation = sumSat / n;
  const saturationVariance = Math.max(0, sumSat2 / n - saturation * saturation);
  const darkRatio = dark / n;
  const brightRatio = bright / n;

  lumas.sort((a, b) => a - b);
  saturations.sort((a, b) => a - b);

  return [
    mean,
    contrast,
    saturation,
    darkRatio,
    brightRatio,
    percentile(lumas, 0.05),
    percentile(lumas, 0.25),
    percentile(lumas, 0.5),
    percentile(lumas, 0.75),
    percentile(lumas, 0.95),
    Math.sqrt(saturationVariance),
    percentile(saturations, 0.5),
    percentile(saturations, 0.9),
    sumWarmth / n,
    sumGreenBlue / n
  ];
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * ratio)));
  return values[index];
}

function predictEnhancementParams(features) {
  if (MODEL_VERSION.startsWith('baseline-')) {
    return estimateBaselineParams(features);
  }

  const normalized = features.map((value, index) => (value - FEATURE_MEAN[index]) / FEATURE_SCALE[index]);
  const hidden = HIDDEN_WEIGHTS.map((weights, row) => {
    const value = weights.reduce((sum, weight, index) => sum + weight * normalized[index], HIDDEN_BIAS[row]);
    return Math.max(0, value);
  });

  const raw = OUTPUT_WEIGHTS.map((weights, row) => {
    return weights.reduce((sum, weight, index) => sum + weight * hidden[index], OUTPUT_BIAS[row]);
  });

  const params = raw.map((value, index) => value * TARGET_SCALE[index] + TARGET_MEAN[index]);
  const brightness = clamp(params[0], -22, 30);
  const contrastBoost = clamp(1 + (params[1] - 1) * 0.52, 0.92, 1.18);
  const saturationBoost = clamp(1 + (params[2] - 1) * 0.34, 0.95, 1.12);
  const gamma = clamp(1 + (params[3] - 1) * 0.9, 0.9, 1.1);

  return { brightness, contrastBoost, saturationBoost, gamma };
}

function estimateBaselineParams(features) {
  const [mean, contrast, saturation, darkRatio, brightRatio] = features;
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
