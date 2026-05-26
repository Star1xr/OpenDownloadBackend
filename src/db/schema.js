import { pgTable, uuid, varchar, text, integer, bigint, boolean, timestamp, date, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: varchar('role', { length: 16 }).notNull().default('free'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const downloads = pgTable('downloads', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  url: text('url').notNull(),
  title: varchar('title', { length: 512 }),
  formatId: varchar('format_id', { length: 64 }),
  formatNote: varchar('format_note', { length: 255 }),
  fileSize: bigint('file_size', { mode: 'number' }),
  progress: bigint('progress', { mode: 'number' }).default(0),
  status: varchar('status', { length: 32 }).notNull().default('queued'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  keyHash: varchar('key_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  lastUsedAt: timestamp('last_used_at'),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const adWatches = pgTable('ad_watches', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  watchedAt: timestamp('watched_at').notNull().defaultNow(),
  year: integer('year').notNull(),
  week: integer('week').notNull(),
});

export const userUsage = pgTable('user_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  downloadCount: integer('download_count').notNull().default(0),
  totalBytes: bigint('total_bytes', { mode: 'number' }).notNull().default(0),
  apiCallCount: integer('api_call_count').notNull().default(0),
}, (table) => {
  return {
    unq: unique().on(table.userId, table.date),
  };
});
