import express from 'express';
import { webhookController } from '../controllers/webhookController.js';

const router = express.Router();

// Stripe webhook - Raw body for signature verification
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }), // Parse as raw buffer
  webhookController.handleStripeWebhook
);

// Paddle webhook - Raw body for signature verification
router.post(
  '/paddle',
  express.raw({ type: 'application/json' }), // Parse as raw buffer
  webhookController.handlePaddleWebhook
);

export default router;





