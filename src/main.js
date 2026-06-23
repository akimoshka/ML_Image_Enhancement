import './styles.css';
import { ImageEnhancementAPI } from './imageApi.js';

const enhancer = new ImageEnhancementAPI();
let currentFile = null;
let currentTaskId = null;
let originalUrl = null;
let resultUrl = null;

const $ = (id) => document.getElementById(id);
const fileInput = $('fileInput');
const dropzone = $('dropzone');
const startBtn = $('startBtn');
const cancelBtn = $('cancelBtn');
const downloadBtn = $('downloadBtn');
const originalPreview = $('originalPreview');
const resultPreview = $('resultPreview');
const statusText = $('statusText');
const progressText = $('progressText');
const progressBar = $('progressBar');

fileInput.addEventListener('change', () => setFile(fileInput.files?.[0]));
startBtn.addEventListener('click', startEnhancement);
cancelBtn.addEventListener('click', () => currentTaskId && enhancer.cancelTask(currentTaskId));

for (const eventName of ['dragenter', 'dragover']) {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  });
}
dropzone.addEventListener('drop', (e) => setFile(e.dataTransfer.files?.[0]));

enhancer.addEventListener('statuschange', async (event) => {
  const { id, status, progress } = event.detail;
  if (id !== currentTaskId) return;
  updateProgress(status, progress);

  if (status === 'done') {
    const blob = enhancer.getResult(id);
    showResult(blob);
    cancelBtn.disabled = true;
    startBtn.disabled = false;
  }

  if (status === 'failed' || status === 'cancelled') {
    cancelBtn.disabled = true;
    startBtn.disabled = false;
  }
});

function setFile(file) {
  if (!file) return;
  currentFile = file;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(file);
  originalPreview.src = originalUrl;
  resultPreview.removeAttribute('src');
  downloadBtn.hidden = true;
  startBtn.disabled = false;
  updateProgress('ready', 0);
}

async function startEnhancement() {
  try {
    startBtn.disabled = true;
    cancelBtn.disabled = false;
    resultPreview.removeAttribute('src');
    downloadBtn.hidden = true;
    currentTaskId = await enhancer.enqueueTask(currentFile);
  } catch (error) {
    updateProgress(error.message, 0);
    startBtn.disabled = false;
    cancelBtn.disabled = true;
  }
}

function showResult(blob) {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = URL.createObjectURL(blob);
  resultPreview.src = resultUrl;
  downloadBtn.href = resultUrl;
  downloadBtn.hidden = false;
}

function updateProgress(status, progress) {
  statusText.textContent = humanStatus(status);
  progressText.textContent = `${Math.round(progress)}%`;
  progressBar.style.width = `${Math.round(progress)}%`;
}

function humanStatus(status) {
  const map = {
    ready: 'Image selected',
    queued: 'Task queued',
    converting_heic: 'Converting HEIC',
    decoding: 'Decoding image',
    analyzing: 'ML model is choosing parameters',
    enhancing: 'Applying enhancement',
    encoding: 'Preparing output',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled'
  };
  return map[status] || status;
}
