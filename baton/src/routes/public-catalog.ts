/**
 * Public platform catalog — unauthenticated.
 *
 * Powers the in-product documentation's setup guides (/docs/setup/*), which are
 * publicly readable. Returns the same payload as the authenticated
 * GET /api/platforms/catalog but is mounted before `requireAuth` so logged-out
 * visitors (and the docs reader) can load it.
 *
 * Safe to expose: the internal `verificationMethod` (signature scheme, header
 * names, encodings) is stripped — only platform names, categories, setup steps,
 * supported event types and secret *labels* are returned. No secrets, no org
 * data.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { getAllAppTemplates } from '../lib/app-catalog';

const router = Router();

router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const templates = getAllAppTemplates().map((t) => {
      // Never expose internal verification details (signing scheme, headers).
      const { verificationMethod: _vm, ...safe } = t;
      return safe;
    });
    // Static, non-sensitive content — let clients/CDN cache briefly.
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ templates });
  } catch (error) {
    next(error);
  }
});

export default router;
