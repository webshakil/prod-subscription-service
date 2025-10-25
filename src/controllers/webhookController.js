// backend/src/controllers/webhookController.js
import { config } from '../config/env.js';
import { stripeClient } from '../config/gateways.js';
import { webhookService } from '../services/webhookService.js';
import crypto from 'crypto';

export const webhookController = {
  // Handle Stripe webhook (unchanged)
  handleStripeWebhook: async (req, res, next) => {
    try {
      const sig = req.headers['stripe-signature'];
      const userAgent = req.headers['user-agent'] || '';
      const ipAddress = req.ip || req.connection.remoteAddress || '';
      
      const isLocalhost = ipAddress.includes('127.0.0.1') || 
                         ipAddress.includes('::1') || 
                         ipAddress === 'localhost';
      
      const webhookSource = isLocalhost
        ? '🖥️  STRIPE CLI (Local Forwarding)' 
        : '☁️  STRIPE CLOUD (Direct from Stripe)';
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📡 Webhook Source: ${webhookSource}`);
      console.log(`🌐 IP Address: ${ipAddress}`);
      console.log(`🔐 User-Agent: ${userAgent}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      let event;

      try {
        event = stripeClient.webhooks.constructEvent(
          req.body,
          sig,
          config.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        console.error('❌ Stripe signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      console.log(`✅ Stripe webhook verified: ${event.type}`);
      console.log(`📋 Event ID: ${event.id}`);
      console.log(`⏰ Created: ${new Date(event.created * 1000).toISOString()}`);

      event.webhookSource = webhookSource.includes('CLI') ? 'cli' : 'direct';

      await webhookService.handleStripeEvent(event);

      res.json({ received: true });
    } catch (error) {
      console.error('Stripe webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  },

  // ✅ FIXED: Handle Paddle webhook (2025 API)
  handlePaddleWebhook: async (req, res, next) => {
    try {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🎣 Paddle Webhook Received');
      
      const signature = req.headers['paddle-signature'];
      
      if (!signature) {
        console.error('❌ No Paddle-Signature header');
        return res.status(401).json({ error: 'Missing signature' });
      }

      console.log('🔐 Signature:', signature);

      // Get raw body as string
      const rawBody = req.body.toString('utf8');
      
      console.log('📦 Body length:', rawBody.length);

      // Verify signature
      const isValid = webhookController.verifyPaddleSignature2025(rawBody, signature);

      if (!isValid) {
        console.error('❌ Paddle signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      console.log('✅ Paddle webhook verified');

      // Parse event
      const event = JSON.parse(rawBody);
      
      console.log('📋 Event:', event.event_type);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Handle the event
      await webhookService.handlePaddleEvent(event);

      res.json({ received: true });
    } catch (error) {
      console.error('Paddle webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  },

  // ✅ FIXED: Paddle Billing API 2025 signature verification
  verifyPaddleSignature2025: (rawBody, signature) => {
    try {
      // Parse signature: "ts=1234567890;h1=abc123..."
      const parts = {};
      signature.split(';').forEach(part => {
        const [key, value] = part.split('=');
        parts[key] = value;
      });

      const { ts: timestamp, h1: hash } = parts;

      if (!timestamp || !hash) {
        console.error('❌ Invalid signature format');
        return false;
      }

      console.log('⏰ Timestamp:', timestamp);

      // Check if webhook secret is set
      if (!config.PADDLE_WEBHOOK_SECRET) {
        console.error('❌ PADDLE_WEBHOOK_SECRET not set in .env');
        return false;
      }

      // Create signed payload: "timestamp:body"
      const signedPayload = `${timestamp}:${rawBody}`;

      // Calculate expected signature
      const expectedSignature = crypto
        .createHmac('sha256', config.PADDLE_WEBHOOK_SECRET)
        .update(signedPayload)
        .digest('hex');

      console.log('🔐 Expected:', expectedSignature.substring(0, 20) + '...');
      console.log('🔐 Received:', hash.substring(0, 20) + '...');

      // ✅ FIX: Simple string comparison (case-insensitive)
      // Paddle signatures are hex strings, so we can compare directly
      const isValid = expectedSignature.toLowerCase() === hash.toLowerCase();

      if (!isValid) {
        console.log('❌ Signature mismatch');
        console.log('   Full expected:', expectedSignature);
        console.log('   Full received:', hash);
      }

      return isValid;
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  },
};
// // backend/src/controllers/webhookController.js
// import { config } from '../config/env.js';
// import { stripeClient } from '../config/gateways.js';
// import { webhookService } from '../services/webhookService.js';
// import crypto from 'crypto';

// export const webhookController = {
//   // Handle Stripe webhook (unchanged)
//   handleStripeWebhook: async (req, res, next) => {
//     try {
//       const sig = req.headers['stripe-signature'];
//       const userAgent = req.headers['user-agent'] || '';
//       const ipAddress = req.ip || req.connection.remoteAddress || '';
      
//       const isLocalhost = ipAddress.includes('127.0.0.1') || 
//                          ipAddress.includes('::1') || 
//                          ipAddress === 'localhost';
      
//       const webhookSource = isLocalhost
//         ? '🖥️  STRIPE CLI (Local Forwarding)' 
//         : '☁️  STRIPE CLOUD (Direct from Stripe)';
      
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`📡 Webhook Source: ${webhookSource}`);
//       console.log(`🌐 IP Address: ${ipAddress}`);
//       console.log(`🔐 User-Agent: ${userAgent}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       let event;

//       try {
//         event = stripeClient.webhooks.constructEvent(
//           req.body,
//           sig,
//           config.STRIPE_WEBHOOK_SECRET
//         );
//       } catch (err) {
//         console.error('❌ Stripe signature verification failed:', err.message);
//         return res.status(400).send(`Webhook Error: ${err.message}`);
//       }

//       console.log(`✅ Stripe webhook verified: ${event.type}`);
//       console.log(`📋 Event ID: ${event.id}`);
//       console.log(`⏰ Created: ${new Date(event.created * 1000).toISOString()}`);

//       event.webhookSource = webhookSource.includes('CLI') ? 'cli' : 'direct';

//       await webhookService.handleStripeEvent(event);

//       res.json({ received: true });
//     } catch (error) {
//       console.error('Stripe webhook error:', error);
//       res.status(500).json({ error: 'Webhook processing failed' });
//     }
//   },

//   // ✅ FIXED: Handle Paddle webhook (2025 API)
//   handlePaddleWebhook: async (req, res, next) => {
//     try {
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🎣 Paddle Webhook Received');
      
//       const signature = req.headers['paddle-signature'];
      
//       if (!signature) {
//         console.error('❌ No Paddle-Signature header');
//         return res.status(401).json({ error: 'Missing signature' });
//       }

//       console.log('🔐 Signature:', signature);

//       // ✅ Get raw body as string
//       const rawBody = req.body.toString('utf8');
      
//       console.log('📦 Body length:', rawBody.length);

//       // ✅ Verify using Paddle Billing API 2025 format
//       const isValid = webhookController.verifyPaddleSignature2025(rawBody, signature);

//       if (!isValid) {
//         console.error('❌ Paddle signature verification failed');
//         return res.status(401).json({ error: 'Invalid signature' });
//       }

//       console.log('✅ Paddle webhook verified');

//       // Parse event
//       const event = JSON.parse(rawBody);
      
//       console.log('📋 Event:', event.event_type);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Handle the event
//       await webhookService.handlePaddleEvent(event);

//       res.json({ received: true });
//     } catch (error) {
//       console.error('Paddle webhook error:', error);
//       res.status(500).json({ error: 'Webhook processing failed' });
//     }
//   },

//   // ✅ NEW: Paddle Billing API 2025 signature verification
//   verifyPaddleSignature2025: (rawBody, signature) => {
//     try {
//       // Parse signature: "ts=1234567890;h1=abc123..."
//       const parts = {};
//       signature.split(';').forEach(part => {
//         const [key, value] = part.split('=');
//         parts[key] = value;
//       });

//       const { ts: timestamp, h1: hash } = parts;

//       if (!timestamp || !hash) {
//         console.error('❌ Invalid signature format');
//         return false;
//       }

//       console.log('⏰ Timestamp:', timestamp);

//       // Check if webhook secret is set
//       if (!config.PADDLE_WEBHOOK_SECRET) {
//         console.error('❌ PADDLE_WEBHOOK_SECRET not set in .env');
//         return false;
//       }

//       // Create signed payload: "timestamp:body"
//       const signedPayload = `${timestamp}:${rawBody}`;

//       // Calculate expected signature
//       const expectedSignature = crypto
//         .createHmac('sha256', config.PADDLE_WEBHOOK_SECRET)
//         .update(signedPayload)
//         .digest('hex');

//       console.log('🔐 Expected:', expectedSignature.substring(0, 20) + '...');
//       console.log('🔐 Received:', hash.substring(0, 20) + '...');

//       // Timing-safe comparison
//       return crypto.timingSafeEqual(
//         Buffer.from(hash, 'hex'),
//         Buffer.from(expectedSignature, 'hex')
//       );
//     } catch (error) {
//       console.error('Signature verification error:', error);
//       return false;
//     }
//   },
// };

// import { config } from '../config/env.js';
// import { stripeClient } from '../config/gateways.js';
// import { webhookService } from '../services/webhookService.js';

// export const webhookController = {
//   // Handle Stripe webhook
//   handleStripeWebhook: async (req, res, next) => {
//     try {
//       const sig = req.headers['stripe-signature'];
//       const userAgent = req.headers['user-agent'] || '';
//       const ipAddress = req.ip || req.connection.remoteAddress || '';
      
//       // 🔍 Detect webhook source based on IP address
//       // Stripe CLI: 127.0.0.1 or ::ffff:127.0.0.1 or ::1
//       // Direct Stripe: Real Stripe IPs (54.x.x.x, 35.x.x.x, etc.)
//       const isLocalhost = ipAddress.includes('127.0.0.1') || 
//                          ipAddress.includes('::1') || 
//                          ipAddress === 'localhost';
      
//       const webhookSource = isLocalhost
//         ? '🖥️  STRIPE CLI (Local Forwarding)' 
//         : '☁️  STRIPE CLOUD (Direct from Stripe)';
      
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`📡 Webhook Source: ${webhookSource}`);
//       console.log(`🌐 IP Address: ${ipAddress}`);
//       console.log(`🔐 User-Agent: ${userAgent}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       let event;

//       try {
//         event = stripeClient.webhooks.constructEvent(
//           req.body,
//           sig,
//           config.STRIPE_WEBHOOK_SECRET
//         );
//       } catch (err) {
//         console.error('❌ Stripe signature verification failed:', err.message);
//         return res.status(400).send(`Webhook Error: ${err.message}`);
//       }

//       console.log(`✅ Stripe webhook verified: ${event.type}`);
//       console.log(`📋 Event ID: ${event.id}`);
//       console.log(`⏰ Created: ${new Date(event.created * 1000).toISOString()}`);

//       // Pass webhook source to service
//       event.webhookSource = webhookSource.includes('CLI') ? 'cli' : 'direct';

//       // Handle the event
//       await webhookService.handleStripeEvent(event);

//       res.json({ received: true });
//     } catch (error) {
//       console.error('Stripe webhook error:', error);
//       res.status(500).json({ error: 'Webhook processing failed' });
//     }
//   },

//   // Handle Paddle webhook
//   handlePaddleWebhook: async (req, res, next) => {
//     try {
//       const signature = req.headers['paddle-signature'];

//       if (!webhookService.verifyPaddleWebhook(req.body, signature)) {
//         console.error('❌ Paddle signature verification failed');
//         return res.status(401).json({ error: 'Invalid signature' });
//       }

//       console.log('✅ Paddle webhook verified');

//       const event = JSON.parse(req.body.toString());

//       // Handle the event
//       await webhookService.handlePaddleEvent(event);

//       res.json({ received: true });
//     } catch (error) {
//       console.error('Paddle webhook error:', error);
//       res.status(500).json({ error: 'Webhook processing failed' });
//     }
//   },
// };







// // import { config } from '../config/env.js';
// // import { stripeClient } from '../config/gateways.js';
// // import { webhookService } from '../services/webhookService.js';

// // export const webhookController = {
// //   // Handle Stripe webhook
// //   handleStripeWebhook: async (req, res, next) => {
// //     try {
// //       const sig = req.headers['stripe-signature'];
// //       const userAgent = req.headers['user-agent'] || '';
      
// //       // 🔍 Detect webhook source
// //       const webhookSource = userAgent.includes('Stripe-CLI') 
// //         ? '🖥️  STRIPE CLI (Local Forwarding)' 
// //         : '☁️  STRIPE CLOUD (Direct from Stripe)';
      
// //       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
// //       console.log(`📡 Webhook Source: ${webhookSource}`);
// //       console.log(`🔐 User-Agent: ${userAgent}`);
// //       console.log(`🌐 IP Address: ${req.ip || req.connection.remoteAddress}`);
// //       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// //       let event;

// //       try {
// //         event = stripeClient.webhooks.constructEvent(
// //           req.body,
// //           sig,
// //           config.STRIPE_WEBHOOK_SECRET
// //         );
// //       } catch (err) {
// //         console.error('❌ Stripe signature verification failed:', err.message);
// //         return res.status(400).send(`Webhook Error: ${err.message}`);
// //       }

// //       console.log(`✅ Stripe webhook verified: ${event.type}`);
// //       console.log(`📋 Event ID: ${event.id}`);
// //       console.log(`⏰ Created: ${new Date(event.created * 1000).toISOString()}`);

// //       // Pass webhook source to service
// //       event.webhookSource = webhookSource.includes('CLI') ? 'cli' : 'direct';

// //       // Handle the event
// //       await webhookService.handleStripeEvent(event);

// //       res.json({ received: true });
// //     } catch (error) {
// //       console.error('Stripe webhook error:', error);
// //       res.status(500).json({ error: 'Webhook processing failed' });
// //     }
// //   },

// //   // Handle Paddle webhook
// //   handlePaddleWebhook: async (req, res, next) => {
// //     try {
// //       const signature = req.headers['paddle-signature'];

// //       if (!webhookService.verifyPaddleWebhook(req.body, signature)) {
// //         console.error('❌ Paddle signature verification failed');
// //         return res.status(401).json({ error: 'Invalid signature' });
// //       }

// //       console.log('✅ Paddle webhook verified');

// //       const event = JSON.parse(req.body.toString());

// //       // Handle the event
// //       await webhookService.handlePaddleEvent(event);

// //       res.json({ received: true });
// //     } catch (error) {
// //       console.error('Paddle webhook error:', error);
// //       res.status(500).json({ error: 'Webhook processing failed' });
// //     }
// //   },
// // };
// //last working codes
// // import { config } from '../config/env.js';
// // import { stripeClient } from '../config/gateways.js';
// // import { webhookService } from '../services/webhookService.js';

// // export const webhookController = {
// //   // Handle Stripe webhook
// //   handleStripeWebhook: async (req, res, next) => {
// //     try {
// //       const sig = req.headers['stripe-signature'];
// //       let event;

// //       try {
// //         // req.body is already raw buffer thanks to bodyParser.raw()
// //         event = stripeClient.webhooks.constructEvent(
// //           req.body, // ✅ Use req.body (raw buffer)
// //           sig,
// //           config.STRIPE_WEBHOOK_SECRET
// //         );
// //       } catch (err) {
// //         console.error('❌ Stripe signature verification failed:', err.message);
// //         return res.status(400).send(`Webhook Error: ${err.message}`);
// //       }

// //       console.log('✅ Stripe webhook verified:', event.type);

// //       // Handle the event
// //       await webhookService.handleStripeEvent(event);

// //       res.json({ received: true });
// //     } catch (error) {
// //       console.error('Stripe webhook error:', error);
// //       res.status(500).json({ error: 'Webhook processing failed' });
// //     }
// //   },

// //   // Handle Paddle webhook
// //   handlePaddleWebhook: async (req, res, next) => {
// //     try {
// //       const signature = req.headers['paddle-signature'];

// //       if (!webhookService.verifyPaddleWebhook(req.body, signature)) {
// //         console.error('❌ Paddle signature verification failed');
// //         return res.status(401).json({ error: 'Invalid signature' });
// //       }

// //       console.log('✅ Paddle webhook verified');

// //       const event = JSON.parse(req.body.toString());

// //       // Handle the event
// //       await webhookService.handlePaddleEvent(event);

// //       res.json({ received: true });
// //     } catch (error) {
// //       console.error('Paddle webhook error:', error);
// //       res.status(500).json({ error: 'Webhook processing failed' });
// //     }
// //   },
// // };
// // import { config } from '../config/env.js';
// // import { stripeClient } from '../config/gateways.js';
// // import { webhookService } from '../services/webhookService.js';

// // export const webhookController = {
// //   // Handle Stripe webhook
// //   handleStripeWebhook: async (req, res, next) => {
// //     try {
// //       const sig = req.headers['stripe-signature'];
// //       let event;

// //       try {
// //         // req.body is already raw buffer thanks to bodyParser.raw()
// //         event = stripeClient.webhooks.constructEvent(
// //           req.body, // ✅ Use req.body (raw buffer)
// //           sig,
// //           config.STRIPE_WEBHOOK_SECRET
// //         );
// //       } catch (err) {
// //         console.error('❌ Stripe signature verification failed:', err.message);
// //         return res.status(400).send(`Webhook Error: ${err.message}`);
// //       }

// //       console.log('✅ Stripe webhook verified:', event.type);

// //       // Handle the event
// //       await webhookService.handleStripeEvent(event);

// //       res.json({ received: true });
// //     } catch (error) {
// //       console.error('Stripe webhook error:', error);
// //       res.status(500).json({ error: 'Webhook processing failed' });
// //     }
// //   },

// //   // Handle Paddle webhook
// //   handlePaddleWebhook: async (req, res, next) => {
// //     try {
// //       const signature = req.headers['paddle-signature'];

// //       if (!webhookService.verifyPaddleWebhook(req.body, signature)) {
// //         console.error('❌ Paddle signature verification failed');
// //         return res.status(401).json({ error: 'Invalid signature' });
// //       }

// //       console.log('✅ Paddle webhook verified');

// //       const event = JSON.parse(req.body.toString());

// //       // Handle the event
// //       await webhookService.handlePaddleEvent(event);

// //       res.json({ received: true });
// //     } catch (error) {
// //       console.error('Paddle webhook error:', error);
// //       res.status(500).json({ error: 'Webhook processing failed' });
// //     }
// //   },
// // };
// // import { config } from '../config/env.js';
// // import { stripeClient } from '../config/gateways.js';
// // import { webhookService } from '../services/webhookService.js';

// // export const webhookController = {
// //   // Handle Stripe webhook
// //   handleStripeWebhook: async (req, res, next) => {
// //     try {
// //       const sig = req.headers['stripe-signature'];
// //       let event;

// //       try {
// //         event = stripeClient.webhooks.constructEvent(
// //           req.rawBody,
// //           sig,
// //           config.STRIPE_WEBHOOK_SECRET
// //         );
// //       } catch (err) {
// //         console.error('Stripe signature verification failed:', err.message);
// //         return res.status(400).send(`Webhook Error: ${err.message}`);
// //       }

// //       // Handle the event
// //       await webhookService.handleStripeEvent(event);

// //       res.json({ received: true });
// //     } catch (error) {
// //       console.error('Stripe webhook error:', error);
// //       res.status(500).json({ error: 'Webhook processing failed' });
// //     }
// //   },

// //   // Handle Paddle webhook
// //   handlePaddleWebhook: async (req, res, next) => {
// //     try {
// //       const signature = req.headers['paddle-signature'];

// //       if (!webhookService.verifyPaddleWebhook(req.rawBody, signature)) {
// //         return res.status(401).json({ error: 'Invalid signature' });
// //       }

// //       const event = req.body;

// //       // Handle the event
// //       await webhookService.handlePaddleEvent(event);

// //       res.json({ received: true });
// //     } catch (error) {
// //       console.error('Paddle webhook error:', error);
// //       res.status(500).json({ error: 'Webhook processing failed' });
// //     }
// //   },
// // };