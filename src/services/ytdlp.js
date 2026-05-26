import { spawn } from 'child_process';
import { AppError } from '../utils/errors.js';

export async function fetchFormats(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      '--dump-json',
      '--no-download',
      url,
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new AppError(stderr.trim() || 'Failed to fetch formats', 400));
        return;
      }
      try {
        const info = JSON.parse(stdout.trim().split('\n')[0]);
        const formats = (info.formats || []).map((f) => ({
          formatId: f.format_id,
          ext: f.ext,
          resolution: f.resolution || f.format_note || 'unknown',
          filesize: f.filesize || f.filesize_approx || 0,
          vcodec: f.vcodec || 'none',
          acodec: f.acodec || 'none',
          note: f.format_note || '',
        }));

        resolve({
          title: info.title,
          thumbnail: info.thumbnail,
          duration: info.duration,
          formats,
        });
      } catch {
        reject(new AppError('Failed to parse media info', 500));
      }
    });
  });
}

export function downloadStream(url, formatId, onProgress) {
  const args = ['--no-playlist'];

  if (formatId && formatId !== 'best') {
    args.push('-f', formatId);
  }

  args.push('-o', '-', url);

  const proc = spawn('yt-dlp', args, { stdio: ['pipe', 'pipe', 'pipe'] });

  let stderr = '';
  proc.stderr.on('data', (data) => {
    stderr += data.toString();
    const match = stderr.match(/(\d+\.?\d*)%/);
    if (match && onProgress) {
      onProgress(parseFloat(match[1]));
    }
  });

  proc.on('error', () => {
    if (onProgress) onProgress(-1, 'Process error');
  });

  return proc;
}
