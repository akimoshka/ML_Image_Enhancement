import heic2any from 'heic2any';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/bmp', 'image/heic', 'image/heif']);
const HEIC_EXT = /\.(heic|heif)$/i;

export class ImageEnhancementAPI extends EventTarget {
  constructor() {
    super();
    this.tasks = new Map();
    this.worker = new Worker(new URL('./enhance.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event) => this.#handleWorkerMessage(event.data);
  }

  async enqueueTask(file) {
    if (!file) throw new Error('No image provided');
    if (!ACCEPTED_TYPES.has(file.type) && !HEIC_EXT.test(file.name || '')) {
      throw new Error('Unsupported format. Use JPG, PNG, BMP, HEIC or HEIF.');
    }

    const taskId = crypto.randomUUID();
    const preparedBlob = await this.#prepareBlob(file, taskId);

    this.tasks.set(taskId, {
      id: taskId,
      status: 'queued',
      progress: 0,
      result: null,
      error: null,
      startedAt: performance.now()
    });

    this.#emit(taskId, 'queued', 0);
    this.worker.postMessage({ type: 'start', taskId, blob: preparedBlob });
    return taskId;
  }

  getStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return { id: taskId, status: 'not_found', progress: 0 };
    return { id: task.id, status: task.status, progress: task.progress, error: task.error };
  }

  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, reason: 'Task not found' };
    this.worker.postMessage({ type: 'cancel', taskId });
    this.#emit(taskId, 'cancelled', task.progress);
    return { ok: true };
  }

  getResult(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'done') return null;
    return task.result;
  }

  async #prepareBlob(file, taskId) {
    const looksHeic = file.type.includes('heic') || file.type.includes('heif') || HEIC_EXT.test(file.name || '');
    if (!looksHeic) return file;

    this.#emit(taskId, 'converting_heic', 3);
    try {
      const converted = await heic2any({ blob: file, toType: 'image/png', quality: 0.92 });
      return Array.isArray(converted) ? converted[0] : converted;
    } catch (error) {
      throw new Error('HEIC conversion failed in this browser. Try Safari or convert the file to JPG/PNG first.');
    }
  }

  #handleWorkerMessage(message) {
    const task = this.tasks.get(message.taskId);
    if (!task) return;

    if (message.type === 'status') {
      this.#emit(message.taskId, message.status, message.progress);
    }

    if (message.type === 'done') {
      task.result = message.blob;
      this.#emit(message.taskId, 'done', 100);
    }

    if (message.type === 'error') {
      task.error = message.error;
      this.#emit(message.taskId, 'failed', task.progress || 0);
    }
  }

  #emit(taskId, status, progress) {
    const task = this.tasks.get(taskId) || { id: taskId };
    task.status = status;
    task.progress = Math.round(progress);
    this.tasks.set(taskId, task);
    this.dispatchEvent(new CustomEvent('statuschange', {
      detail: { id: taskId, status, progress: Math.round(progress) }
    }));
  }
}
