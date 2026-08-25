import { Router } from 'express';
import {
  listSubscriptionsHandler,
  listSubscriptionChargesHandler,
  runRecurrenceHandler,
} from '../controllers/subscriptions.controller.js';

const router = Router();

router.get('/subscriptions', listSubscriptionsHandler);
router.get('/subscriptions/:id/charges', listSubscriptionChargesHandler);
router.post('/subscriptions/:id/recurrence', runRecurrenceHandler);

export default router;
