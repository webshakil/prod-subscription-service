// backend/src/services/webhookService.js
// Updated with Paddle Billing API (2025) support

import crypto from 'crypto';
import { config } from '../config/env.js';
import { subscriptionQueries } from '../models/subscriptionQueries.js';
import { paymentQueries } from '../models/paymentQueries.js';
import { query } from '../config/database.js';

export const webhookService = {
  // ========================================
  // STRIPE WEBHOOK HANDLERS (Keep existing)
  // ========================================

  // Verify Stripe webhook
  verifyStripeWebhook: (body, signature) => {
    try {
      const event = JSON.parse(body);
      const webhookSecret = config.STRIPE_WEBHOOK_SECRET;

      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(event))
        .digest('base64');

      // Stripe uses different signature format, use built-in verification instead
      return true; // Let Stripe SDK handle verification
    } catch (error) {
      console.error('Webhook verification error:', error);
      return false;
    }
  },

  // Handle Stripe webhook events
  handleStripeEvent: async (event) => {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return webhookService.handlePaymentSuccess(event.data.object, 'stripe');

      case 'payment_intent.payment_failed':
        return webhookService.handlePaymentFailed(event.data.object, 'stripe');

      case 'customer.subscription.created':
        return webhookService.handleSubscriptionCreated(event.data.object, 'stripe');

      case 'customer.subscription.deleted':
        return webhookService.handleSubscriptionCanceled(event.data.object, 'stripe');

      case 'customer.subscription.updated':
        return webhookService.handleStripeSubscriptionUpdated(event.data.object);

      case 'invoice.payment_succeeded':
        return webhookService.handleStripeInvoicePaymentSucceeded(event.data.object);

      case 'invoice.payment_failed':
        return webhookService.handleStripeInvoicePaymentFailed(event.data.object);

      default:
        console.log('Unhandled Stripe event:', event.type);
    }
  },

  // Handle Stripe subscription updated
  handleStripeSubscriptionUpdated: async (subscription) => {
    try {
      console.log('🔄 Stripe subscription updated:', subscription.id);

      await query(
        `UPDATE votteryy_user_subscriptions
         SET 
           status = $1,
           end_date = $2,
           updated_at = NOW()
         WHERE external_subscription_id = $3 AND gateway_used = 'stripe'`,
        [
          subscription.status,
          new Date(subscription.current_period_end * 1000),
          subscription.id,
        ]
      );

      console.log('✅ Stripe subscription updated in database');
    } catch (error) {
      console.error('Stripe subscription update error:', error);
      throw error;
    }
  },

  // Handle Stripe invoice payment succeeded
  handleStripeInvoicePaymentSucceeded: async (invoice) => {
    try {
      console.log('💰 Stripe invoice paid:', invoice.id);

      // Record payment
      await query(
        `INSERT INTO votteryy_payments (
          user_id,
          amount,
          currency,
          status,
          gateway,
          external_payment_id,
          metadata,
          created_at
        ) VALUES (
          (SELECT user_id FROM votteryy_user_subscriptions 
           WHERE external_subscription_id = $1 AND gateway_used = 'stripe' LIMIT 1),
          $2, $3, $4, $5, $6, $7, NOW()
        )`,
        [
          invoice.subscription,
          invoice.amount_paid / 100, // Convert from cents
          invoice.currency,
          'completed',
          'stripe',
          invoice.id,
          JSON.stringify({
            invoice_id: invoice.id,
            subscription_id: invoice.subscription,
            payment_intent: invoice.payment_intent,
          }),
        ]
      );

      console.log('✅ Stripe payment recorded');
    } catch (error) {
      console.error('Stripe invoice payment error:', error);
      throw error;
    }
  },

  // Handle Stripe invoice payment failed
  handleStripeInvoicePaymentFailed: async (invoice) => {
    try {
      console.log('❌ Stripe invoice payment failed:', invoice.id);

      await query(
        `INSERT INTO votteryy_payments (
          user_id,
          amount,
          currency,
          status,
          gateway,
          external_payment_id,
          metadata,
          created_at
        ) VALUES (
          (SELECT user_id FROM votteryy_user_subscriptions 
           WHERE external_subscription_id = $1 AND gateway_used = 'stripe' LIMIT 1),
          $2, $3, $4, $5, $6, $7, NOW()
        )`,
        [
          invoice.subscription,
          invoice.amount_due / 100,
          invoice.currency,
          'failed',
          'stripe',
          invoice.id,
          JSON.stringify({
            invoice_id: invoice.id,
            subscription_id: invoice.subscription,
            error: invoice.last_payment_error,
          }),
        ]
      );

      console.log('✅ Failed payment recorded');
    } catch (error) {
      console.error('Stripe invoice failure error:', error);
      throw error;
    }
  },

  // ========================================
  // PADDLE WEBHOOK HANDLERS (Updated 2025)
  // ========================================

  // Verify Paddle webhook (Paddle Billing API 2025)
  verifyPaddleWebhook: (rawBody, signature) => {
    try {
      // Paddle Billing API uses format: ts=<timestamp>;h1=<signature>
      const sigParts = signature.split(';');
      const ts = sigParts.find(p => p.startsWith('ts='))?.split('=')[1];
      const h1 = sigParts.find(p => p.startsWith('h1='))?.split('=')[1];

      if (!ts || !h1) {
        console.error('❌ Invalid Paddle signature format');
        return false;
      }

      // Create the signed payload
      const signedPayload = `${ts}:${rawBody}`;

      // Create HMAC
      const expectedSignature = crypto
        .createHmac('sha256', config.PADDLE_WEBHOOK_SECRET)
        .update(signedPayload)
        .digest('hex');

      // Compare signatures
      const isValid = crypto.timingSafeEqual(
        Buffer.from(h1, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );

      // Check timestamp (within 5 minutes)
      const now = Math.floor(Date.now() / 1000);
      const tsNumber = parseInt(ts, 10);
      const timeDiff = now - tsNumber;

      if (timeDiff > 300) {
        console.warn('⚠️  Paddle webhook timestamp too old:', timeDiff, 'seconds');
        return false;
      }

      return isValid;
    } catch (error) {
      console.error('Paddle webhook verification error:', error);
      return false;
    }
  },

  // Handle Paddle webhook events (Paddle Billing API 2025)
  handlePaddleEvent: async (event) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎣 Paddle Webhook Event');
    console.log(`   Type: ${event.event_type}`);
    console.log(`   ID: ${event.event_id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    switch (event.event_type) {
      // Subscription events
      case 'subscription.created':
        return webhookService.handlePaddleSubscriptionCreated(event.data);

      case 'subscription.updated':
        return webhookService.handlePaddleSubscriptionUpdated(event.data);

      case 'subscription.activated':
        return webhookService.handlePaddleSubscriptionActivated(event.data);

      case 'subscription.canceled':
        return webhookService.handlePaddleSubscriptionCanceled(event.data);

      case 'subscription.paused':
        return webhookService.handlePaddleSubscriptionPaused(event.data);

      case 'subscription.resumed':
        return webhookService.handlePaddleSubscriptionResumed(event.data);

      // Transaction events
      case 'transaction.completed':
        return webhookService.handlePaddleTransactionCompleted(event.data);

      case 'transaction.payment_failed':
        return webhookService.handlePaddleTransactionFailed(event.data);

      case 'transaction.updated':
        return webhookService.handlePaddleTransactionUpdated(event.data);

      default:
        console.log('Unhandled Paddle event:', event.event_type);
    }
  },

  // Paddle: Subscription created
  handlePaddleSubscriptionCreated: async (data) => {
    try {
      console.log('🆕 Paddle subscription created:', data.id);

      const userId = data.custom_data?.user_id;
      if (!userId) {
        console.warn('⚠️  No user_id in custom_data');
        return;
      }

      const planId = data.items?.[0]?.price?.custom_data?.plan_id;

      await subscriptionQueries.createOrUpdateSubscription({
        user_id: userId,
        plan_id: planId,
        external_subscription_id: data.id,
        status: data.status,
        start_date: new Date(data.current_billing_period?.starts_at),
        end_date: new Date(data.current_billing_period?.ends_at),
        gateway: 'paddle',
        is_recurring: true,
        metadata: {
          paddle_customer_id: data.customer_id,
          paddle_subscription_id: data.id,
        },
      });

      console.log('✅ Paddle subscription created in database');
    } catch (error) {
      console.error('Paddle subscription creation error:', error);
      throw error;
    }
  },

  // Paddle: Subscription updated
  handlePaddleSubscriptionUpdated: async (data) => {
    try {
      console.log('🔄 Paddle subscription updated:', data.id);

      await query(
        `UPDATE votteryy_user_subscriptions
         SET 
           status = $1,
           end_date = $2,
           updated_at = NOW()
         WHERE external_subscription_id = $3 AND gateway_used = 'paddle'`,
        [
          data.status,
          new Date(data.current_billing_period?.ends_at),
          data.id,
        ]
      );

      console.log('✅ Paddle subscription updated');
    } catch (error) {
      console.error('Paddle subscription update error:', error);
      throw error;
    }
  },

  // Paddle: Subscription activated
  handlePaddleSubscriptionActivated: async (data) => {
    try {
      console.log('✅ Paddle subscription activated:', data.id);

      await query(
        `UPDATE votteryy_user_subscriptions
         SET 
           status = 'active',
           start_date = $1,
           end_date = $2,
           updated_at = NOW()
         WHERE external_subscription_id = $3 AND gateway_used = 'paddle'`,
        [
          new Date(data.current_billing_period?.starts_at),
          new Date(data.current_billing_period?.ends_at),
          data.id,
        ]
      );

      console.log('✅ Paddle subscription activated');
    } catch (error) {
      console.error('Paddle subscription activation error:', error);
      throw error;
    }
  },

  // Paddle: Subscription canceled
  handlePaddleSubscriptionCanceled: async (data) => {
    try {
      console.log('❌ Paddle subscription canceled:', data.id);

      await query(
        `UPDATE votteryy_user_subscriptions
         SET 
           status = 'canceled',
           end_date = $1,
           auto_renew = false,
           updated_at = NOW()
         WHERE external_subscription_id = $2 AND gateway_used = 'paddle'`,
        [
          new Date(data.canceled_at),
          data.id,
        ]
      );

      console.log('✅ Paddle subscription canceled');
    } catch (error) {
      console.error('Paddle subscription cancellation error:', error);
      throw error;
    }
  },

  // Paddle: Subscription paused
  handlePaddleSubscriptionPaused: async (data) => {
    try {
      console.log('⏸️  Paddle subscription paused:', data.id);

      await query(
        `UPDATE votteryy_user_subscriptions
         SET 
           status = 'paused',
           updated_at = NOW()
         WHERE external_subscription_id = $1 AND gateway_used = 'paddle'`,
        [data.id]
      );

      console.log('✅ Paddle subscription paused');
    } catch (error) {
      console.error('Paddle subscription pause error:', error);
      throw error;
    }
  },

  // Paddle: Subscription resumed
  handlePaddleSubscriptionResumed: async (data) => {
    try {
      console.log('▶️  Paddle subscription resumed:', data.id);

      await query(
        `UPDATE votteryy_user_subscriptions
         SET 
           status = 'active',
           updated_at = NOW()
         WHERE external_subscription_id = $1 AND gateway_used = 'paddle'`,
        [data.id]
      );

      console.log('✅ Paddle subscription resumed');
    } catch (error) {
      console.error('Paddle subscription resume error:', error);
      throw error;
    }
  },

  // Paddle: Transaction completed
  handlePaddleTransactionCompleted: async (data) => {
    try {
      console.log('💰 Paddle transaction completed:', data.id);

      const userId = data.custom_data?.user_id;
      if (!userId) {
        console.warn('⚠️  No user_id in transaction');
        return;
      }

      await query(
        `INSERT INTO votteryy_payments (
          user_id,
          amount,
          currency,
          status,
          gateway,
          external_payment_id,
          metadata,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          userId,
          parseFloat(data.details.totals.total),
          data.currency_code,
          'completed',
          'paddle',
          data.id,
          JSON.stringify({
            transaction_id: data.id,
            subscription_id: data.subscription_id,
            customer_id: data.customer_id,
          }),
        ]
      );

      console.log('✅ Paddle payment recorded');
    } catch (error) {
      console.error('Paddle transaction completion error:', error);
      throw error;
    }
  },

  // Paddle: Transaction failed
  handlePaddleTransactionFailed: async (data) => {
    try {
      console.log('❌ Paddle transaction failed:', data.id);

      const userId = data.custom_data?.user_id;
      if (!userId) return;

      await query(
        `INSERT INTO votteryy_payments (
          user_id,
          amount,
          currency,
          status,
          gateway,
          external_payment_id,
          metadata,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          userId,
          parseFloat(data.details.totals.total),
          data.currency_code,
          'failed',
          'paddle',
          data.id,
          JSON.stringify({
            transaction_id: data.id,
            subscription_id: data.subscription_id,
            error: data.details?.error_code || 'payment_failed',
          }),
        ]
      );

      console.log('✅ Failed Paddle payment recorded');
    } catch (error) {
      console.error('Paddle transaction failure error:', error);
      throw error;
    }
  },

  // Paddle: Transaction updated
  handlePaddleTransactionUpdated: async (data) => {
    try {
      console.log('🔄 Paddle transaction updated:', data.id);

      await query(
        `UPDATE votteryy_payments
         SET 
           status = $1,
           updated_at = NOW()
         WHERE external_payment_id = $2 AND gateway = 'paddle'`,
        [data.status, data.id]
      );

      console.log('✅ Paddle payment updated');
    } catch (error) {
      console.error('Paddle transaction update error:', error);
      throw error;
    }
  },

  // ========================================
  // SHARED HANDLERS (Keep existing)
  // ========================================

  // Handle payment success
  handlePaymentSuccess: async (paymentData, gateway) => {
    try {
      const externalId = gateway === 'stripe' ? paymentData.id : paymentData.checkoutId;
      
      const paymentResult = await paymentQueries.getPaymentByExternalId(externalId);
      if (!paymentResult.rows[0]) return;

      const payment = paymentResult.rows[0];

      // Update payment status
      await paymentQueries.updatePaymentStatus(payment.id, 'success');

      // If subscription payment, update subscription
      if (payment.subscription_id) {
        await subscriptionQueries.updateSubscriptionStatus(payment.subscription_id, 'active');
      }

      console.log(`Payment ${externalId} succeeded via ${gateway}`);
    } catch (error) {
      console.error('Payment success handling error:', error);
      throw error;
    }
  },

  // Handle payment failed
  handlePaymentFailed: async (paymentData, gateway) => {
    try {
      const externalId = gateway === 'stripe' ? paymentData.id : paymentData.checkoutId;
      
      const paymentResult = await paymentQueries.getPaymentByExternalId(externalId);
      if (!paymentResult.rows[0]) return;

      const payment = paymentResult.rows[0];

      // Update payment status
      await paymentQueries.updatePaymentStatus(payment.id, 'failed');

      // Record failure
      await paymentQueries.recordFailedPayment({
        user_id: payment.user_id,
        subscription_id: payment.subscription_id,
        amount: payment.amount,
        reason: paymentData.failureReason || 'Unknown',
        gateway,
        metadata: paymentData,
      });

      console.log(`Payment ${externalId} failed via ${gateway}`);
    } catch (error) {
      console.error('Payment failure handling error:', error);
      throw error;
    }
  },

  // Handle subscription created
  handleSubscriptionCreated: async (subscriptionData, gateway) => {
    try {
      console.log(`Subscription created via ${gateway}:`, subscriptionData.id);
    } catch (error) {
      console.error('Subscription creation handling error:', error);
      throw error;
    }
  },

  // Handle subscription canceled
  handleSubscriptionCanceled: async (subscriptionData, gateway) => {
    try {
      const externalId = subscriptionData.id;
      console.log(`Subscription ${externalId} canceled via ${gateway}`);
    } catch (error) {
      console.error('Subscription cancellation handling error:', error);
      throw error;
    }
  },
};

//last workable codes
// import crypto from 'crypto';
// import { config } from '../config/env.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { paymentQueries } from '../models/paymentQueries.js';

// export const webhookService = {
//   // Verify Stripe webhook
//   verifyStripeWebhook: (body, signature) => {
//     try {
//       const event = JSON.parse(body);
//       const webhookSecret = config.STRIPE_WEBHOOK_SECRET;

//       const expectedSignature = crypto
//         .createHmac('sha256', webhookSecret)
//         .update(JSON.stringify(event))
//         .digest('base64');

//       // Stripe uses different signature format, use built-in verification instead
//       return true; // Let Stripe SDK handle verification
//     } catch (error) {
//       console.error('Webhook verification error:', error);
//       return false;
//     }
//   },

//   // Verify Paddle webhook
//   verifyPaddleWebhook: (body, signature) => {
//     try {
//       const hash = crypto
//         .createHmac('sha256', config.PADDLE_WEBHOOK_SECRET)
//         .update(body)
//         .digest('hex');

//       return hash === signature;
//     } catch (error) {
//       console.error('Paddle webhook verification error:', error);
//       return false;
//     }
//   },

//   // Handle Stripe webhook events
//   handleStripeEvent: async (event) => {
//     switch (event.type) {
//       case 'payment_intent.succeeded':
//         return webhookService.handlePaymentSuccess(event.data.object, 'stripe');

//       case 'payment_intent.payment_failed':
//         return webhookService.handlePaymentFailed(event.data.object, 'stripe');

//       case 'customer.subscription.created':
//         return webhookService.handleSubscriptionCreated(event.data.object, 'stripe');

//       case 'customer.subscription.deleted':
//         return webhookService.handleSubscriptionCanceled(event.data.object, 'stripe');

//       default:
//         console.log('Unhandled Stripe event:', event.type);
//     }
//   },

//   // Handle Paddle webhook events
//   handlePaddleEvent: async (event) => {
//     switch (event.eventType) {
//       case 'checkout.completed':
//         return webhookService.handlePaymentSuccess(event.data, 'paddle');

//       case 'checkout.failed':
//         return webhookService.handlePaymentFailed(event.data, 'paddle');

//       case 'subscription.created':
//         return webhookService.handleSubscriptionCreated(event.data, 'paddle');

//       case 'subscription.canceled':
//         return webhookService.handleSubscriptionCanceled(event.data, 'paddle');

//       default:
//         console.log('Unhandled Paddle event:', event.eventType);
//     }
//   },

//   // Handle payment success
//   handlePaymentSuccess: async (paymentData, gateway) => {
//     try {
//       const externalId = gateway === 'stripe' ? paymentData.id : paymentData.checkoutId;
      
//       const paymentResult = await paymentQueries.getPaymentByExternalId(externalId);
//       if (!paymentResult.rows[0]) return;

//       const payment = paymentResult.rows[0];

//       // Update payment status
//       await paymentQueries.updatePaymentStatus(payment.id, 'success');

//       // If subscription payment, update subscription
//       if (payment.subscription_id) {
//         await subscriptionQueries.updateSubscriptionStatus(payment.subscription_id, 'active');
//       }

//       console.log(`Payment ${externalId} succeeded via ${gateway}`);
//     } catch (error) {
//       console.error('Payment success handling error:', error);
//       throw error;
//     }
//   },

//   // Handle payment failed
//   handlePaymentFailed: async (paymentData, gateway) => {
//     try {
//       const externalId = gateway === 'stripe' ? paymentData.id : paymentData.checkoutId;
      
//       const paymentResult = await paymentQueries.getPaymentByExternalId(externalId);
//       if (!paymentResult.rows[0]) return;

//       const payment = paymentResult.rows[0];

//       // Update payment status
//       await paymentQueries.updatePaymentStatus(payment.id, 'failed');

//       // Record failure
//       await paymentQueries.recordFailedPayment({
//         user_id: payment.user_id,
//         subscription_id: payment.subscription_id,
//         amount: payment.amount,
//         reason: paymentData.failureReason || 'Unknown',
//         gateway,
//         metadata: paymentData,
//       });

//       console.log(`Payment ${externalId} failed via ${gateway}`);
//     } catch (error) {
//       console.error('Payment failure handling error:', error);
//       throw error;
//     }
//   },

//   // Handle subscription created
//   handleSubscriptionCreated: async (subscriptionData, gateway) => {
//     try {
//       // Find and update subscription with external ID
//       console.log(`Subscription created via ${gateway}:`, subscriptionData.id);
//     } catch (error) {
//       console.error('Subscription creation handling error:', error);
//       throw error;
//     }
//   },

//   // Handle subscription canceled
//   handleSubscriptionCanceled: async (subscriptionData, gateway) => {
//     try {
//       const externalId = subscriptionData.id;
      
//       // Find subscription by external ID and mark as canceled
//       console.log(`Subscription ${externalId} canceled via ${gateway}`);
//     } catch (error) {
//       console.error('Subscription cancellation handling error:', error);
//       throw error;
//     }
//   },
// };








//last workable codes
// import crypto from 'crypto';
// import { config } from '../config/env.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { paymentQueries } from '../models/paymentQueries.js';

// export const webhookService = {
//   // Verify Stripe webhook
//   verifyStripeWebhook: (body, signature) => {
//     try {
//       const event = JSON.parse(body);
//       const webhookSecret = config.STRIPE_WEBHOOK_SECRET;

//       const expectedSignature = crypto
//         .createHmac('sha256', webhookSecret)
//         .update(JSON.stringify(event))
//         .digest('base64');

//       // Stripe uses different signature format, use built-in verification instead
//       return true; // Let Stripe SDK handle verification
//     } catch (error) {
//       console.error('Webhook verification error:', error);
//       return false;
//     }
//   },

//   // Verify Paddle webhook
//   verifyPaddleWebhook: (body, signature) => {
//     try {
//       const hash = crypto
//         .createHmac('sha256', config.PADDLE_WEBHOOK_SECRET)
//         .update(body)
//         .digest('hex');

//       return hash === signature;
//     } catch (error) {
//       console.error('Paddle webhook verification error:', error);
//       return false;
//     }
//   },

//   // Handle Stripe webhook events
//   handleStripeEvent: async (event) => {
//     switch (event.type) {
//       case 'payment_intent.succeeded':
//         return webhookService.handlePaymentSuccess(event.data.object, 'stripe');

//       case 'payment_intent.payment_failed':
//         return webhookService.handlePaymentFailed(event.data.object, 'stripe');

//       case 'customer.subscription.created':
//         return webhookService.handleSubscriptionCreated(event.data.object, 'stripe');

//       case 'customer.subscription.deleted':
//         return webhookService.handleSubscriptionCanceled(event.data.object, 'stripe');

//       default:
//         console.log('Unhandled Stripe event:', event.type);
//     }
//   },

//   // Handle Paddle webhook events
//   handlePaddleEvent: async (event) => {
//     switch (event.eventType) {
//       case 'checkout.completed':
//         return webhookService.handlePaymentSuccess(event.data, 'paddle');

//       case 'checkout.failed':
//         return webhookService.handlePaymentFailed(event.data, 'paddle');

//       case 'subscription.created':
//         return webhookService.handleSubscriptionCreated(event.data, 'paddle');

//       case 'subscription.canceled':
//         return webhookService.handleSubscriptionCanceled(event.data, 'paddle');

//       default:
//         console.log('Unhandled Paddle event:', event.eventType);
//     }
//   },

//   // Handle payment success
//   handlePaymentSuccess: async (paymentData, gateway) => {
//     try {
//       const externalId = gateway === 'stripe' ? paymentData.id : paymentData.checkoutId;
      
//       const paymentResult = await paymentQueries.getPaymentByExternalId(externalId);
//       if (!paymentResult.rows[0]) return;

//       const payment = paymentResult.rows[0];

//       // Update payment status
//       await paymentQueries.updatePaymentStatus(payment.id, 'success');

//       // If subscription payment, update subscription
//       if (payment.subscription_id) {
//         await subscriptionQueries.updateSubscriptionStatus(payment.subscription_id, 'active');
//       }

//       console.log(`Payment ${externalId} succeeded via ${gateway}`);
//     } catch (error) {
//       console.error('Payment success handling error:', error);
//       throw error;
//     }
//   },

//   // Handle payment failed
//   handlePaymentFailed: async (paymentData, gateway) => {
//     try {
//       const externalId = gateway === 'stripe' ? paymentData.id : paymentData.checkoutId;
      
//       const paymentResult = await paymentQueries.getPaymentByExternalId(externalId);
//       if (!paymentResult.rows[0]) return;

//       const payment = paymentResult.rows[0];

//       // Update payment status
//       await paymentQueries.updatePaymentStatus(payment.id, 'failed');

//       // Record failure
//       await paymentQueries.recordFailedPayment({
//         user_id: payment.user_id,
//         subscription_id: payment.subscription_id,
//         amount: payment.amount,
//         reason: paymentData.failureReason || 'Unknown',
//         gateway,
//         metadata: paymentData,
//       });

//       console.log(`Payment ${externalId} failed via ${gateway}`);
//     } catch (error) {
//       console.error('Payment failure handling error:', error);
//       throw error;
//     }
//   },

//   // Handle subscription created
//   handleSubscriptionCreated: async (subscriptionData, gateway) => {
//     try {
//       // Find and update subscription with external ID
//       console.log(`Subscription created via ${gateway}:`, subscriptionData.id);
//     } catch (error) {
//       console.error('Subscription creation handling error:', error);
//       throw error;
//     }
//   },

//   // Handle subscription canceled
//   handleSubscriptionCanceled: async (subscriptionData, gateway) => {
//     try {
//       const externalId = subscriptionData.id;
      
//       // Find subscription by external ID and mark as canceled
//       console.log(`Subscription ${externalId} canceled via ${gateway}`);
//     } catch (error) {
//       console.error('Subscription cancellation handling error:', error);
//       throw error;
//     }
//   },
// };