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





// // import express from 'express';
// // import webhookRoutes from './routes/webhookRoutes.js';
// // import otherRoutes from './routes/otherRoutes.js';

// // const app = express();

// // // ⚠️ IMPORTANT: Webhook routes BEFORE body parser!
// // app.use('/api/v1/webhooks', webhookRoutes);

// // // Now add JSON body parser for other routes
// // app.use(express.json());
// // app.use('/api/v1', otherRoutes);


// import express from 'express';
// import bodyParser from 'body-parser';
// import { webhookController } from '../controllers/webhookController.js';

// const router = express.Router();

// // Store raw body for signature verification
// router.use('/stripe', bodyParser.raw({ type: 'application/json' }));
// router.use('/paddle', bodyParser.raw({ type: 'application/json' }));

// router.post('/stripe', webhookController.handleStripeWebhook);
// router.post('/paddle', webhookController.handlePaddleWebhook);

// export default router;