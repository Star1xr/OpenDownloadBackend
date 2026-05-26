import rateLimit from 'express-rate-limit';
import { db, schema } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { AppError } from '../utils/errors.js';

const GUEST_DAILY = Number(process.env.GUEST_DAILY_LIMIT) || 4;
const FREE_DAILY = Number(process.env.FREE_DAILY_LIMIT) || 10;
const PRO_WEEKLY = Number(process.env.PRO_WEEKLY_LIMIT) || 100;
const PRO_API_DAILY = Number(process.env.PRO_API_DAILY_LIMIT) || 500;

export const guestDownloadLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: GUEST_DAILY,
  keyGenerator: (req) => req.ip,
  skip: (req) => !!req.user,
  message: { error: 'Guest download limit reached (4/day). Sign up for more.' },
  standardHeaders: true,
  legacyHeaders: false,
});

async function getUsage(userId, dateStr, year, week) {
  const [daily] = await db
    .select()
    .from(schema.userUsage)
    .where(and(
      eq(schema.userUsage.userId, userId),
      eq(schema.userUsage.date, dateStr),
    ))
    .limit(1);

  const [weekly] = await db
    .select({
      totalBytes: sql`COALESCE(SUM(${schema.userUsage.total_bytes}), 0)`,
      totalDownloads: sql`COALESCE(SUM(${schema.userUsage.download_count}), 0)`,
    })
    .from(schema.userUsage)
    .where(and(
      eq(schema.userUsage.userId, userId),
      sql`EXTRACT(YEAR FROM ${schema.userUsage.date}::date) = ${year}`,
      sql`EXTRACT(WEEK FROM ${schema.userUsage.date}::date) = ${week}`,
    ));

  return {
    daily: daily || null,
    weeklyBytes: Number(weekly.totalBytes),
    weeklyDownloads: Number(weekly.totalDownloads),
  };
}

export async function checkDownloadLimit(req, _res, next) {
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const year = now.getFullYear();
    const week = getWeekNumber(now);

    if (!req.user) {
      return next();
    }

    const usage = await getUsage(req.user.id, dateStr, year, week);

    if (req.user.role === 'pro') {
      if (usage.weeklyBytes >= Number(process.env.PRO_MAX_FILE_SIZE)) {
        return next(new AppError('Weekly download quota exceeded (2GB)', 429));
      }
      if (usage.weeklyDownloads >= PRO_WEEKLY) {
        return next(new AppError('Weekly download limit reached (100/week)', 429));
      }
    } else {
      const dailyBytes = usage.daily ? usage.daily.totalBytes : 0;
      const maxBytes = Number(process.env.FREE_MAX_FILE_SIZE) || 1073741824;
      if (dailyBytes >= maxBytes) {
        return next(new AppError('Daily download quota exceeded (1GB)', 429));
      }
      const dailyCount = usage.daily ? usage.daily.downloadCount : 0;
      if (dailyCount >= FREE_DAILY) {
        return next(new AppError('Daily download limit reached (10/day)', 429));
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

export async function checkApiLimit(req, _res, next) {
  if (!req.user) {
    return next(new AppError('Authentication required for API access', 401));
  }

  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    const [usage] = await db
      .select()
      .from(schema.userUsage)
      .where(and(
        eq(schema.userUsage.userId, req.user.id),
        eq(schema.userUsage.date, dateStr),
      ))
      .limit(1);

    if (req.user.role === 'pro') {
      const apiCalls = usage ? usage.apiCallCount : 0;
      if (apiCalls >= PRO_API_DAILY) {
        return next(new AppError('Daily API call limit reached (500/day)', 429));
      }
    } else {
      const apiCalls = usage ? usage.apiCallCount : 0;
      const downloads = usage ? usage.downloadCount : 0;
      if ((apiCalls + downloads) >= FREE_DAILY) {
        return next(new AppError('Daily usage limit reached (10/day)', 429));
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

function getWeekNumber(d) {
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const diff = d - startOfYear;
  const oneWeek = 604800000;
  return Math.ceil((diff / oneWeek) + 1);
}
