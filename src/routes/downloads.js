import { Router } from 'express';
import { db, schema } from '../db/index.js';
import { eq, desc, and, sql } from 'drizzle-orm';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { guestDownloadLimiter, checkDownloadLimit } from '../middleware/rateLimit.js';
import { downloadStream } from '../services/ytdlp.js';
import { notifyDownloadComplete, notifyDownloadError } from '../ws/index.js';
import { AppError } from '../utils/errors.js';
import crypto from 'crypto';

const router = Router();

function getFileSizeLimit(user) {
  if (!user) return Number(process.env.GUEST_MAX_FILE_SIZE) || 524288000;
  if (user.role === 'pro') return Number(process.env.PRO_MAX_FILE_SIZE) || 2147483648;
  return Number(process.env.FREE_MAX_FILE_SIZE) || 1073741824;
}

async function trackUsage(userId, fileSize) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const year = now.getFullYear();
  const week = getWeekNumber(now);

  const existing = await db
    .select()
    .from(schema.userUsage)
    .where(and(
      eq(schema.userUsage.userId, userId),
      eq(schema.userUsage.date, dateStr),
    ))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.userUsage)
      .set({
        downloadCount: sql`${schema.userUsage.downloadCount} + 1`,
        totalBytes: sql`${schema.userUsage.totalBytes} + ${fileSize}`,
      })
      .where(eq(schema.userUsage.id, existing[0].id));
  } else {
    await db.insert(schema.userUsage).values({
      userId,
      date: dateStr,
      downloadCount: 1,
      totalBytes: fileSize,
    });
  }
}

// Start a download (streams the file in response)
router.post(
  '/',
  optionalAuth,
  guestDownloadLimiter,
  checkDownloadLimit,
  async (req, res, next) => {
    try {
      const { url, formatId, fileSize } = req.body;

      if (!url) {
        throw new AppError('URL is required', 400);
      }

      const maxSize = getFileSizeLimit(req.user);
      if (fileSize && fileSize > maxSize) {
        throw new AppError(
          `File exceeds your size limit (${Math.round(maxSize / 1048576)}MB). Upgrade to download larger files.`,
          413,
        );
      }

      const downloadId = crypto.randomUUID();
      let downloadRecord = null;

      if (req.user) {
        [downloadRecord] = await db
          .insert(schema.downloads)
          .values({
            id: downloadId,
            userId: req.user.id,
            url,
            formatId,
            fileSize: fileSize || 0,
            status: 'downloading',
          })
          .returning();
      }

      const proc = downloadStream(url, formatId, (progress) => {
        if (downloadRecord && req.user) {
          db.update(schema.downloads)
            .set({ progress: Math.round(progress * 100) / 100 })
            .where(eq(schema.downloads.id, downloadId))
            .catch(() => {});
        }
      });

      res.setHeader('Content-Disposition', 'attachment; filename="download"');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Download-Id', downloadId);

      proc.stdout.pipe(res);

      proc.stderr.on('data', () => {});

      proc.on('close', async (code) => {
        if (code === 0) {
          if (downloadRecord && req.user) {
            await db
              .update(schema.downloads)
              .set({ status: 'completed' })
              .where(eq(schema.downloads.id, downloadId));

            await trackUsage(req.user.id, fileSize || 0);
            notifyDownloadComplete(req.user.id, { downloadId });
          }
        } else {
          if (downloadRecord && req.user) {
            await db
              .update(schema.downloads)
              .set({ status: 'failed' })
              .where(eq(schema.downloads.id, downloadId));
            notifyDownloadError(req.user.id, { downloadId });
          }
        }
      });

      req.on('close', () => {
        if (!proc.killed) {
          proc.kill();
        }
      });
    } catch (err) {
      next(err);
    }
  },
);

// List user's download history
router.get('/', authenticate, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const rows = await db
      .select()
      .from(schema.downloads)
      .where(eq(schema.downloads.userId, req.user.id))
      .orderBy(desc(schema.downloads.createdAt))
      .limit(limit)
      .offset(offset);

    const [total] = await db
      .select({ count: sql`COUNT(*)` })
      .from(schema.downloads)
      .where(eq(schema.downloads.userId, req.user.id));

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: Number(total.count),
        totalPages: Math.ceil(Number(total.count) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Get single download
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const [download] = await db
      .select()
      .from(schema.downloads)
      .where(and(
        eq(schema.downloads.id, req.params.id),
        eq(schema.downloads.userId, req.user.id),
      ))
      .limit(1);

    if (!download) {
      throw new AppError('Download not found', 404);
    }

    res.json(download);
  } catch (err) {
    next(err);
  }
});

// Delete/cancel download
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const [download] = await db
      .select()
      .from(schema.downloads)
      .where(and(
        eq(schema.downloads.id, req.params.id),
        eq(schema.downloads.userId, req.user.id),
      ))
      .limit(1);

    if (!download) {
      throw new AppError('Download not found', 404);
    }

    await db
      .delete(schema.downloads)
      .where(eq(schema.downloads.id, req.params.id));

    res.json({ message: 'Download deleted' });
  } catch (err) {
    next(err);
  }
});

function getWeekNumber(d) {
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const diff = d - startOfYear;
  const oneWeek = 604800000;
  return Math.ceil((diff / oneWeek) + 1);
}

export default router;
