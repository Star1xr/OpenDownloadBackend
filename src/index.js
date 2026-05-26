import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { setupWebSocket } from './ws/index.js';
import { errorHandler } from './utils/errors.js';
import authRoutes from './routes/auth.js';
import formatRoutes from './routes/formats.js';
import downloadRoutes from './routes/downloads.js';
import accountRoutes from './routes/account.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  const start = Date.now();
  _res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${_res.statusCode} ${ms}ms`);
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/formats', formatRoutes);
app.use('/api/downloads', downloadRoutes);
app.use('/api', accountRoutes);

app.use(errorHandler);

setupWebSocket(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`opendownload running on port ${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

boot();
