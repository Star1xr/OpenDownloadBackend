import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db, schema } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { authenticate } from '../middleware/auth.js';
import { checkApiLimit } from '../middleware/rateLimit.js';
import { AppError } from '../utils/errors.js';

const router = Router();

// Profile + usage stats
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const [user] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        role: schema.users.role,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, req.user.id))
      .limit(1);

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const year = now.getFullYear();
    const week = getWeekNumber(now);

    const [usage] = await db
      .select()
      .from(schema.userUsage)
      .where(and(
        eq(schema.userUsage.userId, req.user.id),
        eq(schema.userUsage.date, dateStr),
      ))
      .limit(1);

    const [weeklyCount] = await db
      .select({ count: sql`COALESCE(COUNT(*), 0)` })
      .from(schema.downloads)
      .where(and(
        eq(schema.downloads.userId, req.user.id),
        sql`EXTRACT(YEAR FROM ${schema.downloads.createdAt}) = ${year}`,
        sql`EXTRACT(WEEK FROM ${schema.downloads.createdAt}) = ${week}`,
      ));

    const [adCount] = await db
      .select({ count: sql`COALESCE(COUNT(*), 0)` })
      .from(schema.adWatches)
      .where(and(
        eq(schema.adWatches.userId, req.user.id),
        eq(schema.adWatches.year, year),
        eq(schema.adWatches.week, week),
      ));

    const adsPerWeekForPro = Number(process.env.ADS_PER_WEEK_FOR_PRO) || 5;
    const isProEligible = Number(adCount.count) >= adsPerWeekForPro;

    res.json({
      user,
      proEligible: isProEligible,
      usage: {
        today: usage ? {
          downloads: usage.downloadCount,
          bytes: usage.totalBytes,
          apiCalls: usage.apiCallCount,
        } : { downloads: 0, bytes: 0, apiCalls: 0 },
        thisWeek: {
          downloads: Number(weeklyCount.count),
        },
        adsThisWeek: Number(adCount.count),
        adsRequiredForPro: adsPerWeekForPro,
      },
    });
  } catch (err) {
    next(err);
  }
});

// List API keys
router.get('/me/api-keys', authenticate, async (req, res, next) => {
  try {
    const keys = await db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        revoked: schema.apiKeys.revoked,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.userId, req.user.id))
      .orderBy(sql`${schema.apiKeys.createdAt} DESC`);

    res.json(keys);
  } catch (err) {
    next(err);
  }
});

// Generate API key
router.post('/me/api-keys', authenticate, async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || name.length > 128) {
      throw new AppError('Name is required (max 128 chars)', 400);
    }

    const rawKey = `od_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = await bcrypt.hash(rawKey, 10);

    await db.insert(schema.apiKeys).values({
      userId: req.user.id,
      keyHash,
      name,
    });

    res.status(201).json({
      key: rawKey,
      name,
      warning: 'Save this key now. It will not be shown again.',
    });
  } catch (err) {
    next(err);
  }
});

// Revoke API key
router.delete('/me/api-keys/:id', authenticate, async (req, res, next) => {
  try {
    const [key] = await db
      .select()
      .from(schema.apiKeys)
      .where(and(
        eq(schema.apiKeys.id, req.params.id),
        eq(schema.apiKeys.userId, req.user.id),
      ))
      .limit(1);

    if (!key) {
      throw new AppError('API key not found', 404);
    }

    await db
      .update(schema.apiKeys)
      .set({ revoked: true })
      .where(eq(schema.apiKeys.id, req.params.id));

    res.json({ message: 'API key revoked' });
  } catch (err) {
    next(err);
  }
});

// Record ad watch
router.post('/ads/watched', authenticate, async (req, res, next) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const week = getWeekNumber(now);

    await db.insert(schema.adWatches).values({
      userId: req.user.id,
      year,
      week,
    });

    const [adCount] = await db
      .select({ count: sql`COALESCE(COUNT(*), 0)` })
      .from(schema.adWatches)
      .where(and(
        eq(schema.adWatches.userId, req.user.id),
        eq(schema.adWatches.year, year),
        eq(schema.adWatches.week, week),
      ));

    const adsPerWeekForPro = Number(process.env.ADS_PER_WEEK_FOR_PRO) || 5;
    const becamePro = Number(adCount.count) >= adsPerWeekForPro;

    if (becamePro) {
      await db
        .update(schema.users)
        .set({ role: 'pro' })
        .where(eq(schema.users.id, req.user.id));
    }

    res.json({
      adsThisWeek: Number(adCount.count),
      adsRequiredForPro: adsPerWeekForPro,
      isPro: becamePro,
    });
  } catch (err) {
    next(err);
  }
});

// Check pro status
router.get('/me/pro-status', authenticate, async (req, res, next) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const week = getWeekNumber(now);
    const adsPerWeekForPro = Number(process.env.ADS_PER_WEEK_FOR_PRO) || 5;

    const [adCount] = await db
      .select({ count: sql`COALESCE(COUNT(*), 0)` })
      .from(schema.adWatches)
      .where(and(
        eq(schema.adWatches.userId, req.user.id),
        eq(schema.adWatches.year, year),
        eq(schema.adWatches.week, week),
      ));

    const isPro = Number(adCount.count) >= adsPerWeekForPro;

    res.json({
      isPro,
      adsThisWeek: Number(adCount.count),
      adsRequiredForPro: adsPerWeekForPro,
      role: isPro ? 'pro' : 'free',
    });
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
