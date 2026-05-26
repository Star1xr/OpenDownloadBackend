import { EventEmitter } from 'events';
import { downloadStream } from './ytdlp.js';

class DownloadQueue extends EventEmitter {
  constructor(maxConcurrent = 3) {
    super();
    this.maxConcurrent = maxConcurrent;
    this.queue = [];
    this.active = new Map();
  }

  enqueue(job) {
    return new Promise((resolve, reject) => {
      this.queue.push({ ...job, resolve, reject });
      this.processNext();
    });
  }

  processNext() {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      this.runJob(job);
    }
  }

  async runJob(job) {
    const { id, url, formatId, onProgress, resolve, reject } = job;
    this.active.set(id, true);

    try {
      const proc = downloadStream(url, formatId, (pct) => {
        if (onProgress) onProgress(pct);
        this.emit('progress', { id, progress: pct });
      });

      resolve(proc);
      await new Promise((resolve) => proc.on('close', resolve));
    } catch (err) {
      reject(err);
    } finally {
      this.active.delete(id);
      this.processNext();
    }
  }

  cancel(id) {
    // Cancellation handled at the route level by aborting the response
    this.queue = this.queue.filter((j) => j.id !== id);
  }
}

const maxConcurrent = Number(process.env.MAX_CONCURRENT_DOWNLOADS) || 3;
export const downloadQueue = new DownloadQueue(maxConcurrent);
