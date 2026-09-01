import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { requireModule } from '../config.js';
import { recent } from '../lib/audit.js';

const router = Router();

/** The audit trail is Super Admin's own record of administrative actions. */
router.get('/', requireAuth('SUPER_ADMIN'), requireModule('systemLogs'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json({
    logs: recent({ limit, action: req.query.action || undefined, actor: req.query.actor || undefined }),
  });
});

export default router;
