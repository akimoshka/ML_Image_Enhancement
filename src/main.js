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
const fileName = $('fileName');
const originalPreview = $('originalPreview');
const resultPreview = $('resultPreview');
const statusText = $('statusText');
const progressText = $('progressText');
const elapsedText = $('elapsedText');
const progressBar = $('progressBar');
const taskIdText = $('taskIdText');
let taskStartedAt = 0;

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
  fileName.textContent = file.name || 'Без названия';
  taskIdText.textContent = 'нет';
  downloadBtn.hidden = true;
  startBtn.disabled = false;
  taskStartedAt = 0;
  updateProgress('ready', 0);
}

async function startEnhancement() {
  try {
    startBtn.disabled = true;
    cancelBtn.disabled = false;
    taskStartedAt = performance.now();
    resultPreview.removeAttribute('src');
    downloadBtn.hidden = true;
    currentTaskId = await enhancer.enqueueTask(currentFile);
    taskIdText.textContent = currentTaskId;
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
  elapsedText.textContent = taskStartedAt ? `${((performance.now() - taskStartedAt) / 1000).toFixed(1)} s` : '0.0 s';
  progressBar.style.width = `${Math.round(progress)}%`;
}

function humanStatus(status) {
  const map = {
    ready: 'Изображение выбрано',
    queued: 'В очереди',
    converting_heic: 'Конвертация HEIC',
    decoding: 'Декодирование',
    analyzing: 'Подбор параметров',
    enhancing: 'Обработка',
    encoding: 'Подготовка результата',
    done: 'Готово',
    failed: 'Ошибка',
    cancelled: 'Отменено'
  };
  return map[status] || status;
}
