import { Router } from 'express';
import * as db from '../lib/store.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

/** Public: the multi-select on the registration forms reads from here. */
router.get('/', (req, res) => {
  const includeInactive = req.user && ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
  const events = includeInactive ? db.all('EventMaster') : db.filter('EventMaster', (e) => e.active);
  res.json({ events });
});

router.post('/', requireAuth('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const { ok, values, errors } = validate(req.body, {
    name: { required: true, min: 3, label: 'Event name' },
    category: { required: true, label: 'Category' },
    description: { required: false, label: 'Description', default: '' },
  });
  if (!ok) return res.status(400).json({ errors });

  const event = {
    eventId: db.nextId('EventMaster', 'eventId', 'EVENT'),
    ...values,
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.insert('EventMaster', event);
  res.status(201).json({ event });
});

router.patch('/:eventId', requireAuth('ADMIN', 'SUPER_ADMIN'), (req, res) => {
  const patch = {};
  if (typeof req.body?.active === 'boolean') patch.active = req.body.active;
  for (const f of ['name', 'category', 'description']) {
    if (typeof req.body?.[f] === 'string' && req.body[f].trim()) patch[f] = req.body[f].trim();
  }
  const event = db.update('EventMaster', (e) => e.eventId === req.params.eventId, patch);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({ event });
});

export default router;
