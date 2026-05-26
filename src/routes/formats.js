import { Router } from 'express';
import { fetchFormats } from '../services/ytdlp.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const info = await fetchFormats(url);
    res.json(info);
  } catch (err) {
    next(err);
  }
});

export default router;
