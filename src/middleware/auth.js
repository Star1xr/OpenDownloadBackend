import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { AppError } from '../utils/errors.js';

export async function authenticate(req, _res, next) {
  const apiKey = req.headers['x-api-key'];

  if (apiKey) {
    try {
      const keys = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.revoked, false));

      for (const key of keys) {
        const match = await bcrypt.compare(apiKey, key.keyHash);
        if (match) {
          const [user] = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, key.userId))
            .limit(1);

          if (!user) break;

          req.user = { id: user.id, role: user.role, apiKeyId: key.id };
          req.usingApiKey = true;

          await db
            .update(schema.apiKeys)
            .set({ lastUsedAt: new Date() })
            .where(eq(schema.apiKeys.id, key.id));

          return next();
        }
      }
    } catch {
      return next(new AppError('Invalid API key', 401));
    }
    return next(new AppError('Invalid API key', 401));
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Missing or invalid token', 401));
  }

  try {
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    req.usingApiKey = false;
    next();
  } catch {
    next(new AppError('Invalid or expired token', 401));
  }
}

export async function optionalAuth(req, _res, next) {
  const apiKey = req.headers['x-api-key'];

  if (apiKey) {
    try {
      const keys = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.revoked, false));

      for (const key of keys) {
        const match = await bcrypt.compare(apiKey, key.keyHash);
        if (match) {
          const [user] = await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, key.userId))
            .limit(1);

          if (!user) break;

          req.user = { id: user.id, role: user.role, apiKeyId: key.id };
          req.usingApiKey = true;

          await db
            .update(schema.apiKeys)
            .set({ lastUsedAt: new Date() })
            .where(eq(schema.apiKeys.id, key.id));

          return next();
        }
      }
    } catch {
      req.user = null;
      return next();
    }
    req.user = null;
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  try {
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    req.usingApiKey = false;
  } catch {
    req.user = null;
  }
  next();
}
