export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function errorHandler(err, req, res, _next) {
  const status = err.statusCode || 500;
  const message = err.statusCode ? err.message : 'Internal server error';
  console.error(err);
  res.status(status).json({ error: message });
}
