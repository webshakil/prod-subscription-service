import { paymentQueries } from '../models/paymentQueries.js';
import { subscriptionQueries } from '../models/subscriptionQueries.js';
import { usageQueries } from '../models/usageQueries.js';

export const webhookService = {
  // ✅ FIXED: Handle Stripe webhook events with proper plan_id extraction
  handleStripeEvent: async (event) => {
    console.log(`\n🎯 Processing Stripe Event: ${event.type}`);
    console.log(`📋 Event ID: ${event.id}`);

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await webhookService.handlePaymentSuccess(event.data.object, 'stripe');
          break;

        case 'payment_intent.payment_failed':
          await webhookService.handlePaymentFailed(event.data.object, 'stripe');
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await webhookService.handleSubscriptionUpdate(event.data.object, 'stripe');
          break;

        case 'customer.subscription.deleted':
          await webhookService.handleSubscriptionCanceled(event.data.object, 'stripe');
          break;

        default:
          console.log(`⚠️  Unhandled event type: ${event.type}`);
      }

      console.log('✅ Webhook processed successfully\n');
    } catch (error) {
      console.error('❌ Webhook processing error:', error);
      throw error;
    }
  },

  // ✅ FIXED: Handle payment success with plan_id
  handlePaymentSuccess: async (paymentIntent, gateway) => {
    console.log('\n💰 Payment Success Handler');
    console.log('Payment Intent ID:', paymentIntent.id);
    console.log('Amount:', paymentIntent.amount / 100, paymentIntent.currency.toUpperCase());
    console.log('Metadata:', JSON.stringify(paymentIntent.metadata, null, 2));

    try {
      // ✅ FIXED: Extract plan_id from metadata
      const plan_id = paymentIntent.metadata?.plan_id || null;
      const user_id = paymentIntent.metadata?.user_id;

      console.log('🔍 Extracted plan_id:', plan_id);
      console.log('🔍 Extracted user_id:', user_id);

      if (!user_id) {
        console.error('❌ No user_id in payment metadata');
        throw new Error('Missing user_id in payment metadata');
      }

      // Find existing payment record
      const existingPayment = await paymentQueries.getPaymentByExternalId(paymentIntent.id);

      if (existingPayment.rows.length > 0) {
        console.log('📝 Updating existing payment record:', existingPayment.rows[0].id);
        
        // ✅ FIXED: Update payment with plan_id if not already set
        const currentPlanId = existingPayment.rows[0].plan_id;
        const updatedPlanId = currentPlanId || plan_id;

        console.log('Current plan_id in DB:', currentPlanId);
        console.log('Will update to plan_id:', updatedPlanId);

        await paymentQueries.updatePaymentStatus(existingPayment.rows[0].id, 'completed');
        
        // ✅ ADDED: If plan_id was missing, update it now
        if (!currentPlanId && plan_id) {
          console.log('🔄 Updating payment record with plan_id:', plan_id);
          const updateSql = `
            UPDATE votteryy_payments 
            SET plan_id = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING *;
          `;
          const { query } = await import('../config/database.js');
          await query(updateSql, [plan_id, existingPayment.rows[0].id]);
        }
      } else {
        console.log('📝 Creating new payment record');
        
        // ✅ FIXED: Include plan_id when creating payment record
        await paymentQueries.recordPayment({
          user_id,
          plan_id: plan_id || null, // ✅ ADDED: Include plan_id
          subscription_id: null,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency.toUpperCase(),
          gateway,
          external_payment_id: paymentIntent.id,
          status: 'completed',
          payment_method: paymentIntent.payment_method_types?.[0] || 'card',
          region: paymentIntent.metadata?.region,
          country_code: paymentIntent.metadata?.country_code,
          metadata: paymentIntent.metadata,
        });
      }

      // ✅ FIXED: Create/update subscription if plan_id exists
      if (plan_id) {
        console.log('🎫 Creating/updating subscription for plan:', plan_id);
        
        // Check if user has existing subscription
        const existingSub = await subscriptionQueries.getUserSubscription(user_id);
        
        if (existingSub.rows.length > 0) {
          console.log('🔄 Updating existing subscription');
          // Update existing subscription
          await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
            plan_id: plan_id,
            status: 'active',
            current_period_end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days for quarterly
          });
        } else {
          console.log('✨ Creating new subscription');
          // Create new subscription
          await subscriptionQueries.createSubscription({
            user_id,
            plan_id: plan_id,
            status: 'active',
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
            gateway,
            external_subscription_id: paymentIntent.id, // Use payment intent as reference
          });
        }

        // Track usage
        await usageQueries.trackUsage({
          user_id,
          tracking_id: paymentIntent.id,
          usage_type: 'subscription_payment',
          metadata: { plan_id, amount: paymentIntent.amount / 100 },
        });
      } else {
        console.warn('⚠️  No plan_id found - payment recorded but no subscription created');
      }

      console.log('✅ Payment success handled completely\n');
    } catch (error) {
      console.error('❌ Error in handlePaymentSuccess:', error);
      throw error;
    }
  },

  // Handle payment failure
  handlePaymentFailed: async (paymentIntent, gateway) => {
    console.log('\n❌ Payment Failed Handler');
    console.log('Payment Intent ID:', paymentIntent.id);
    
    try {
      const existingPayment = await paymentQueries.getPaymentByExternalId(paymentIntent.id);

      if (existingPayment.rows.length > 0) {
        await paymentQueries.updatePaymentStatus(existingPayment.rows[0].id, 'failed');
      }

      await paymentQueries.recordFailedPayment({
        user_id: paymentIntent.metadata?.user_id,
        subscription_id: null,
        amount: paymentIntent.amount / 100,
        reason: paymentIntent.last_payment_error?.message || 'Payment failed',
        gateway,
        region: paymentIntent.metadata?.region,
        metadata: paymentIntent.metadata,
      });

      console.log('✅ Payment failure recorded\n');
    } catch (error) {
      console.error('Error in handlePaymentFailed:', error);
      throw error;
    }
  },

  // Handle subscription updates
  handleSubscriptionUpdate: async (subscription, gateway) => {
    console.log('\n🔄 Subscription Update Handler');
    console.log('Subscription ID:', subscription.id);
    console.log('Status:', subscription.status);

    try {
      const user_id = subscription.metadata?.user_id;
      const plan_id = subscription.metadata?.plan_id; // ✅ ADDED: Extract plan_id

      if (!user_id) {
        console.error('No user_id in subscription metadata');
        return;
      }

      const existingSub = await subscriptionQueries.getUserSubscription(user_id);

      const subscriptionData = {
        status: subscription.status,
        current_period_start: new Date(subscription.current_period_start * 1000),
        current_period_end: new Date(subscription.current_period_end * 1000),
        external_subscription_id: subscription.id,
        plan_id: plan_id || null, // ✅ ADDED: Include plan_id
      };

      if (existingSub.rows.length > 0) {
        await subscriptionQueries.updateSubscription(existingSub.rows[0].id, subscriptionData);
      } else {
        await subscriptionQueries.createSubscription({
          user_id,
          plan_id: plan_id || 4, // ✅ MODIFIED: Use plan_id from metadata or default to 4
          ...subscriptionData,
          gateway,
        });
      }

      console.log('✅ Subscription updated\n');
    } catch (error) {
      console.error('Error in handleSubscriptionUpdate:', error);
      throw error;
    }
  },

  // Handle subscription cancellation
  handleSubscriptionCanceled: async (subscription, gateway) => {
    console.log('\n🚫 Subscription Canceled Handler');
    console.log('Subscription ID:', subscription.id);

    try {
      const user_id = subscription.metadata?.user_id;

      if (!user_id) {
        console.error('No user_id in subscription metadata');
        return;
      }

      const existingSub = await subscriptionQueries.getUserSubscription(user_id);

      if (existingSub.rows.length > 0) {
        await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
          status: 'canceled',
          canceled_at: new Date(),
        });
      }

      console.log('✅ Subscription canceled\n');
    } catch (error) {
      console.error('Error in handleSubscriptionCanceled:', error);
      throw error;
    }
  },

  // ✅ FIXED: Handle Paddle events (2025 API)
  handlePaddleEvent: async (event) => {
    console.log(`\n🎯 Processing Paddle Event: ${event.event_type}`);
    console.log(`📋 Event ID: ${event.event_id}`);

    try {
      switch (event.event_type) {
        case 'transaction.completed':
          await webhookService.handlePaddlePaymentSuccess(event.data);
          break;

        case 'transaction.payment_failed':
          await webhookService.handlePaddlePaymentFailed(event.data);
          break;

        case 'subscription.created':
        case 'subscription.updated':
          await webhookService.handlePaddleSubscriptionUpdate(event.data);
          break;

        case 'subscription.canceled':
          await webhookService.handlePaddleSubscriptionCanceled(event.data);
          break;

        default:
          console.log(`⚠️  Unhandled Paddle event: ${event.event_type}`);
      }

      console.log('✅ Paddle webhook processed successfully\n');
    } catch (error) {
      console.error('❌ Paddle webhook error:', error);
      throw error;
    }
  },

  handlePaddlePaymentSuccess: async (transaction) => {
    console.log('\n💰 Paddle Payment Success');
    console.log('Transaction ID:', transaction.id);
    
    try {
      const user_id = transaction.custom_data?.user_id;
      const plan_id = transaction.custom_data?.plan_id; // ✅ ADDED: Extract plan_id

      await paymentQueries.recordPayment({
        user_id,
        plan_id: plan_id || null, // ✅ ADDED: Include plan_id
        subscription_id: transaction.subscription_id || null,
        amount: parseFloat(transaction.details.totals.total) / 100,
        currency: transaction.currency_code,
        gateway: 'paddle',
        external_payment_id: transaction.id,
        status: 'completed',
        payment_method: 'paddle',
        region: transaction.custom_data?.region,
        country_code: transaction.billing_details?.country_code,
        metadata: transaction.custom_data,
      });

      console.log('✅ Paddle payment recorded\n');
    } catch (error) {
      console.error('Error in handlePaddlePaymentSuccess:', error);
      throw error;
    }
  },

  handlePaddlePaymentFailed: async (transaction) => {
    console.log('\n❌ Paddle Payment Failed');
    console.log('Transaction ID:', transaction.id);
    
    try {
      await paymentQueries.recordFailedPayment({
        user_id: transaction.custom_data?.user_id,
        subscription_id: transaction.subscription_id || null,
        amount: parseFloat(transaction.details.totals.total) / 100,
        reason: 'Paddle payment failed',
        gateway: 'paddle',
        region: transaction.custom_data?.region,
        metadata: transaction.custom_data,
      });

      console.log('✅ Paddle payment failure recorded\n');
    } catch (error) {
      console.error('Error in handlePaddlePaymentFailed:', error);
      throw error;
    }
  },

  handlePaddleSubscriptionUpdate: async (subscription) => {
    console.log('\n🔄 Paddle Subscription Update');
    console.log('Subscription ID:', subscription.id);
    
    try {
      const user_id = subscription.custom_data?.user_id;
      const plan_id = subscription.custom_data?.plan_id; // ✅ ADDED: Extract plan_id

      if (!user_id) return;

      const existingSub = await subscriptionQueries.getUserSubscription(user_id);

      const subscriptionData = {
        status: subscription.status === 'active' ? 'active' : 'inactive',
        current_period_start: new Date(subscription.current_billing_period?.starts_at),
        current_period_end: new Date(subscription.current_billing_period?.ends_at),
        external_subscription_id: subscription.id,
        plan_id: plan_id || null, // ✅ ADDED: Include plan_id
      };

      if (existingSub.rows.length > 0) {
        await subscriptionQueries.updateSubscription(existingSub.rows[0].id, subscriptionData);
      } else {
        await subscriptionQueries.createSubscription({
          user_id,
          plan_id: plan_id || 4, // ✅ MODIFIED: Use plan_id from metadata or default
          ...subscriptionData,
          gateway: 'paddle',
        });
      }

      console.log('✅ Paddle subscription updated\n');
    } catch (error) {
      console.error('Error in handlePaddleSubscriptionUpdate:', error);
      throw error;
    }
  },

  handlePaddleSubscriptionCanceled: async (subscription) => {
    console.log('\n🚫 Paddle Subscription Canceled');
    console.log('Subscription ID:', subscription.id);
    
    try {
      const user_id = subscription.custom_data?.user_id;

      if (!user_id) return;

      const existingSub = await subscriptionQueries.getUserSubscription(user_id);

      if (existingSub.rows.length > 0) {
        await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
          status: 'canceled',
          canceled_at: new Date(),
        });
      }

      console.log('✅ Paddle subscription canceled\n');
    } catch (error) {
      console.error('Error in handlePaddleSubscriptionCanceled:', error);
      throw error;
    }
  },
};

// import crypto from 'crypto';
// import { config } from '../config/env.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { query } from '../config/database.js';

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

//       case 'customer.subscription.updated':
//         return webhookService.handleStripeSubscriptionUpdated(event.data.object);

//       case 'invoice.payment_succeeded':
//         return webhookService.handleStripeInvoicePaymentSucceeded(event.data.object);

//       case 'invoice.payment_failed':
//         return webhookService.handleStripeInvoicePaymentFailed(event.data.object);

//       default:
//         console.log('Unhandled Stripe event:', event.type);
//     }
//   },

//   // Handle Stripe subscription updated
//   handleStripeSubscriptionUpdated: async (subscription) => {
//     try {
//       console.log('🔄 Stripe subscription updated:', subscription.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = $1,
//            end_date = $2,
//            updated_at = NOW()
//          WHERE external_subscription_id = $3 AND gateway_used = 'stripe'`,
//         [
//           subscription.status,
//           new Date(subscription.current_period_end * 1000),
//           subscription.id,
//         ]
//       );

//       console.log('✅ Stripe subscription updated in database');
//     } catch (error) {
//       console.error('Stripe subscription update error:', error);
//       throw error;
//     }
//   },

//   // Handle Stripe invoice payment succeeded
//   handleStripeInvoicePaymentSucceeded: async (invoice) => {
//     try {
//       console.log('💰 Stripe invoice paid:', invoice.id);

//       // Record payment
//       await query(
//         `INSERT INTO votteryy_payments (
//           user_id,
//           amount,
//           currency,
//           status,
//           gateway,
//           external_payment_id,
//           metadata,
//           created_at
//         ) VALUES (
//           (SELECT user_id FROM votteryy_user_subscriptions 
//            WHERE external_subscription_id = $1 AND gateway_used = 'stripe' LIMIT 1),
//           $2, $3, $4, $5, $6, $7, NOW()
//         )`,
//         [
//           invoice.subscription,
//           invoice.amount_paid / 100, // Convert from cents
//           invoice.currency,
//           'completed',
//           'stripe',
//           invoice.id,
//           JSON.stringify({
//             invoice_id: invoice.id,
//             subscription_id: invoice.subscription,
//             payment_intent: invoice.payment_intent,
//           }),
//         ]
//       );

//       console.log('✅ Stripe payment recorded');
//     } catch (error) {
//       console.error('Stripe invoice payment error:', error);
//       throw error;
//     }
//   },

//   // Handle Stripe invoice payment failed
//   handleStripeInvoicePaymentFailed: async (invoice) => {
//     try {
//       console.log('❌ Stripe invoice payment failed:', invoice.id);

//       await query(
//         `INSERT INTO votteryy_payments (
//           user_id,
//           amount,
//           currency,
//           status,
//           gateway,
//           external_payment_id,
//           metadata,
//           created_at
//         ) VALUES (
//           (SELECT user_id FROM votteryy_user_subscriptions 
//            WHERE external_subscription_id = $1 AND gateway_used = 'stripe' LIMIT 1),
//           $2, $3, $4, $5, $6, $7, NOW()
//         )`,
//         [
//           invoice.subscription,
//           invoice.amount_due / 100,
//           invoice.currency,
//           'failed',
//           'stripe',
//           invoice.id,
//           JSON.stringify({
//             invoice_id: invoice.id,
//             subscription_id: invoice.subscription,
//             error: invoice.last_payment_error,
//           }),
//         ]
//       );

//       console.log('✅ Failed payment recorded');
//     } catch (error) {
//       console.error('Stripe invoice failure error:', error);
//       throw error;
//     }
//   },

//   // ========================================
//   // PADDLE WEBHOOK HANDLERS (Updated 2025)
//   // ========================================

//   // Verify Paddle webhook (Paddle Billing API 2025)
//   verifyPaddleWebhook: (rawBody, signature) => {
//     try {
//       // Paddle Billing API uses format: ts=<timestamp>;h1=<signature>
//       const sigParts = signature.split(';');
//       const ts = sigParts.find(p => p.startsWith('ts='))?.split('=')[1];
//       const h1 = sigParts.find(p => p.startsWith('h1='))?.split('=')[1];

//       if (!ts || !h1) {
//         console.error('❌ Invalid Paddle signature format');
//         return false;
//       }

//       // Create the signed payload
//       const signedPayload = `${ts}:${rawBody}`;

//       // Create HMAC
//       const expectedSignature = crypto
//         .createHmac('sha256', config.PADDLE_WEBHOOK_SECRET)
//         .update(signedPayload)
//         .digest('hex');

//       // Compare signatures
//       const isValid = crypto.timingSafeEqual(
//         Buffer.from(h1, 'hex'),
//         Buffer.from(expectedSignature, 'hex')
//       );

//       // Check timestamp (within 5 minutes)
//       const now = Math.floor(Date.now() / 1000);
//       const tsNumber = parseInt(ts, 10);
//       const timeDiff = now - tsNumber;

//       if (timeDiff > 300) {
//         console.warn('⚠️  Paddle webhook timestamp too old:', timeDiff, 'seconds');
//         return false;
//       }

//       return isValid;
//     } catch (error) {
//       console.error('Paddle webhook verification error:', error);
//       return false;
//     }
//   },

//   // Handle Paddle webhook events (Paddle Billing API 2025)
//   handlePaddleEvent: async (event) => {
//     console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//     console.log('🎣 Paddle Webhook Event');
//     console.log(`   Type: ${event.event_type}`);
//     console.log(`   ID: ${event.event_id}`);
//     console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//     switch (event.event_type) {
//       // Subscription events
//       case 'subscription.created':
//         return webhookService.handlePaddleSubscriptionCreated(event.data);

//       case 'subscription.updated':
//         return webhookService.handlePaddleSubscriptionUpdated(event.data);

//       case 'subscription.activated':
//         return webhookService.handlePaddleSubscriptionActivated(event.data);

//       case 'subscription.canceled':
//         return webhookService.handlePaddleSubscriptionCanceled(event.data);

//       case 'subscription.paused':
//         return webhookService.handlePaddleSubscriptionPaused(event.data);

//       case 'subscription.resumed':
//         return webhookService.handlePaddleSubscriptionResumed(event.data);

//       // Transaction events
//       case 'transaction.completed':
//         return webhookService.handlePaddleTransactionCompleted(event.data);

//       case 'transaction.payment_failed':
//         return webhookService.handlePaddleTransactionFailed(event.data);

//       case 'transaction.updated':
//         return webhookService.handlePaddleTransactionUpdated(event.data);

//       default:
//         console.log('Unhandled Paddle event:', event.event_type);
//     }
//   },

//   // Paddle: Subscription created
//   handlePaddleSubscriptionCreated: async (data) => {
//     try {
//       console.log('🆕 Paddle subscription created:', data.id);

//       const userId = data.custom_data?.user_id;
//       if (!userId) {
//         console.warn('⚠️  No user_id in custom_data');
//         return;
//       }

//       const planId = data.items?.[0]?.price?.product_id;

//       await query(
//         `INSERT INTO votteryy_user_subscriptions (
//           user_id,
//           plan_id,
//           gateway_used,
//           external_subscription_id,
//           status,
//           start_date,
//           end_date,
//           auto_renew,
//           created_at,
//           updated_at
//         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
//         [
//           userId,
//           planId,
//           'paddle',
//           data.id,
//           data.status,
//           new Date(data.current_billing_period?.starts_at),
//           new Date(data.current_billing_period?.ends_at),
//           true,
//         ]
//       );

//       console.log('✅ Paddle subscription created');
//     } catch (error) {
//       console.error('Paddle subscription creation error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Subscription updated
//   handlePaddleSubscriptionUpdated: async (data) => {
//     try {
//       console.log('🔄 Paddle subscription updated:', data.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = $1,
//            end_date = $2,
//            updated_at = NOW()
//          WHERE external_subscription_id = $3 AND gateway_used = 'paddle'`,
//         [
//           data.status,
//           new Date(data.current_billing_period?.ends_at),
//           data.id,
//         ]
//       );

//       console.log('✅ Paddle subscription updated');
//     } catch (error) {
//       console.error('Paddle subscription update error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Subscription activated
//   handlePaddleSubscriptionActivated: async (data) => {
//     try {
//       console.log('✅ Paddle subscription activated:', data.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = 'active',
//            start_date = $1,
//            end_date = $2,
//            updated_at = NOW()
//          WHERE external_subscription_id = $3 AND gateway_used = 'paddle'`,
//         [
//           new Date(data.current_billing_period?.starts_at),
//           new Date(data.current_billing_period?.ends_at),
//           data.id,
//         ]
//       );

//       console.log('✅ Paddle subscription activated');
//     } catch (error) {
//       console.error('Paddle subscription activation error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Subscription canceled
//   handlePaddleSubscriptionCanceled: async (data) => {
//     try {
//       console.log('❌ Paddle subscription canceled:', data.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = 'canceled',
//            end_date = $1,
//            auto_renew = false,
//            updated_at = NOW()
//          WHERE external_subscription_id = $2 AND gateway_used = 'paddle'`,
//         [
//           new Date(data.canceled_at),
//           data.id,
//         ]
//       );

//       console.log('✅ Paddle subscription canceled');
//     } catch (error) {
//       console.error('Paddle subscription cancellation error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Subscription paused
//   handlePaddleSubscriptionPaused: async (data) => {
//     try {
//       console.log('⏸️  Paddle subscription paused:', data.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = 'paused',
//            updated_at = NOW()
//          WHERE external_subscription_id = $1 AND gateway_used = 'paddle'`,
//         [data.id]
//       );

//       console.log('✅ Paddle subscription paused');
//     } catch (error) {
//       console.error('Paddle subscription pause error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Subscription resumed
//   handlePaddleSubscriptionResumed: async (data) => {
//     try {
//       console.log('▶️  Paddle subscription resumed:', data.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = 'active',
//            updated_at = NOW()
//          WHERE external_subscription_id = $1 AND gateway_used = 'paddle'`,
//         [data.id]
//       );

//       console.log('✅ Paddle subscription resumed');
//     } catch (error) {
//       console.error('Paddle subscription resume error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Transaction completed
//   handlePaddleTransactionCompleted: async (data) => {
//     try {
//       console.log('💰 Paddle transaction completed:', data.id);

//       const userId = data.custom_data?.user_id;
//       if (!userId) {
//         console.warn('⚠️  No user_id in transaction');
//         return;
//       }

//       await query(
//         `INSERT INTO votteryy_payments (
//           user_id,
//           amount,
//           currency,
//           status,
//           gateway,
//           external_payment_id,
//           metadata,
//           created_at
//         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
//         [
//           userId,
//           parseFloat(data.details.totals.total),
//           data.currency_code,
//           'completed',
//           'paddle',
//           data.id,
//           JSON.stringify({
//             transaction_id: data.id,
//             subscription_id: data.subscription_id,
//             customer_id: data.customer_id,
//           }),
//         ]
//       );

//       console.log('✅ Paddle payment recorded');
//     } catch (error) {
//       console.error('Paddle transaction completion error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Transaction failed
//   handlePaddleTransactionFailed: async (data) => {
//     try {
//       console.log('❌ Paddle transaction failed:', data.id);

//       const userId = data.custom_data?.user_id;
//       if (!userId) return;

//       await query(
//         `INSERT INTO votteryy_payments (
//           user_id,
//           amount,
//           currency,
//           status,
//           gateway,
//           external_payment_id,
//           metadata,
//           created_at
//         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
//         [
//           userId,
//           parseFloat(data.details.totals.total),
//           data.currency_code,
//           'failed',
//           'paddle',
//           data.id,
//           JSON.stringify({
//             transaction_id: data.id,
//             subscription_id: data.subscription_id,
//             error: data.details?.error_code || 'payment_failed',
//           }),
//         ]
//       );

//       console.log('✅ Failed Paddle payment recorded');
//     } catch (error) {
//       console.error('Paddle transaction failure error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Transaction updated
//   handlePaddleTransactionUpdated: async (data) => {
//     try {
//       console.log('🔄 Paddle transaction updated:', data.id);

//       await query(
//         `UPDATE votteryy_payments
//          SET 
//            status = $1,
//            updated_at = NOW()
//          WHERE external_payment_id = $2 AND gateway = 'paddle'`,
//         [data.status, data.id]
//       );

//       console.log('✅ Paddle payment updated');
//     } catch (error) {
//       console.error('Paddle transaction update error:', error);
//       throw error;
//     }
//   },



//   // ✅ MODIFIED: Handle payment success - AUTO CREATE SUBSCRIPTION FOR STRIPE
//   handlePaymentSuccess: async (paymentData, gateway) => {
//     try {
//       const externalId = gateway === 'stripe' ? paymentData.id : paymentData.checkoutId;
      
//       console.log(`💰 Payment succeeded: ${externalId} via ${gateway}`);
      
//       const paymentResult = await paymentQueries.getPaymentByExternalId(externalId);
//       if (!paymentResult.rows[0]) {
//         console.warn('⚠️  Payment not found in database:', externalId);
//         return;
//       }

//       const payment = paymentResult.rows[0];

//       // Update payment status
//       await paymentQueries.updatePaymentStatus(payment.id, 'completed');
//       console.log('✅ Payment status updated to completed');

//       // ✅ NEW: AUTO CREATE SUBSCRIPTION FOR STRIPE PAYMENTS
//       if (gateway === 'stripe' && payment.plan_id) {
//         console.log('🔄 Creating subscription for plan:', payment.plan_id);
        
//         // Get plan details to calculate end date
//         const planResult = await query(
//           `SELECT id, plan_name, duration_days, billing_cycle 
//            FROM votteryy_subscription_plans 
//            WHERE id = $1`,
//           [payment.plan_id]
//         );

//         if (planResult.rows[0]) {
//           const plan = planResult.rows[0];
          
//           // Calculate dates
//           const startDate = new Date();
//           const endDate = new Date();
//           endDate.setDate(endDate.getDate() + plan.duration_days);

//           console.log(`📅 Subscription dates: ${startDate.toISOString()} to ${endDate.toISOString()}`);
//           console.log(`⏱️  Duration: ${plan.duration_days} days (${plan.billing_cycle})`);

//           // Create or update subscription
//           await query(
//             `INSERT INTO votteryy_user_subscriptions (
//               user_id,
//               plan_id,
//               status,
//               start_date,
//               end_date,
//               gateway,
//               payment_type,
//               auto_renew,
//               external_subscription_id,
//               created_at,
//               updated_at
//             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
//             ON CONFLICT (user_id) 
//             DO UPDATE SET 
//               plan_id = EXCLUDED.plan_id,
//               status = EXCLUDED.status,
//               start_date = EXCLUDED.start_date,
//               end_date = EXCLUDED.end_date,
//               gateway = EXCLUDED.gateway,
//               payment_type = EXCLUDED.payment_type,
//               auto_renew = EXCLUDED.auto_renew,
//               external_subscription_id = EXCLUDED.external_subscription_id,
//               updated_at = EXCLUDED.updated_at`,
//             [
//               payment.user_id,
//               plan.id,
//               'active',
//               startDate,
//               endDate,
//               'stripe',
//               'recurring',
//               false, // Set to true when you implement true recurring
//               externalId,
//             ]
//           );

//           console.log('✅ Subscription created/updated successfully');
//           console.log(`   User: ${payment.user_id}`);
//           console.log(`   Plan: ${plan.plan_name}`);
//           console.log(`   Valid until: ${endDate.toISOString()}`);
//         } else {
//           console.warn('⚠️  Plan not found:', payment.plan_id);
//         }
//       }

//       // If subscription payment, update subscription status (for existing subscriptions)
//       if (payment.subscription_id) {
//         await subscriptionQueries.updateSubscriptionStatus(payment.subscription_id, 'active');
//         console.log('✅ Existing subscription status updated');
//       }

//       console.log(`✅ Payment ${externalId} processing complete`);
//     } catch (error) {
//       console.error('❌ Payment success handling error:', error);
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
//       console.log(`Subscription ${externalId} canceled via ${gateway}`);
//     } catch (error) {
//       console.error('Subscription cancellation handling error:', error);
//       throw error;
//     }
//   },
// };

// import crypto from 'crypto';
// import { config } from '../config/env.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { query } from '../config/database.js';

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

//       case 'customer.subscription.updated':
//         return webhookService.handleStripeSubscriptionUpdated(event.data.object);

//       case 'invoice.payment_succeeded':
//         return webhookService.handleStripeInvoicePaymentSucceeded(event.data.object);

//       case 'invoice.payment_failed':
//         return webhookService.handleStripeInvoicePaymentFailed(event.data.object);

//       default:
//         console.log('Unhandled Stripe event:', event.type);
//     }
//   },

//   // Handle Stripe subscription updated
//   handleStripeSubscriptionUpdated: async (subscription) => {
//     try {
//       console.log('🔄 Stripe subscription updated:', subscription.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = $1,
//            end_date = $2,
//            updated_at = NOW()
//          WHERE external_subscription_id = $3 AND gateway_used = 'stripe'`,
//         [
//           subscription.status,
//           new Date(subscription.current_period_end * 1000),
//           subscription.id,
//         ]
//       );

//       console.log('✅ Stripe subscription updated in database');
//     } catch (error) {
//       console.error('Stripe subscription update error:', error);
//       throw error;
//     }
//   },

//   // Handle Stripe invoice payment succeeded
//   handleStripeInvoicePaymentSucceeded: async (invoice) => {
//     try {
//       console.log('💰 Stripe invoice paid:', invoice.id);

//       // Record payment
//       await query(
//         `INSERT INTO votteryy_payments (
//           user_id,
//           amount,
//           currency,
//           status,
//           gateway,
//           external_payment_id,
//           metadata,
//           created_at
//         ) VALUES (
//           (SELECT user_id FROM votteryy_user_subscriptions 
//            WHERE external_subscription_id = $1 AND gateway_used = 'stripe' LIMIT 1),
//           $2, $3, $4, $5, $6, $7, NOW()
//         )`,
//         [
//           invoice.subscription,
//           invoice.amount_paid / 100, // Convert from cents
//           invoice.currency,
//           'completed',
//           'stripe',
//           invoice.id,
//           JSON.stringify({
//             invoice_id: invoice.id,
//             subscription_id: invoice.subscription,
//             payment_intent: invoice.payment_intent,
//           }),
//         ]
//       );

//       console.log('✅ Stripe payment recorded');
//     } catch (error) {
//       console.error('Stripe invoice payment error:', error);
//       throw error;
//     }
//   },

//   // Handle Stripe invoice payment failed
//   handleStripeInvoicePaymentFailed: async (invoice) => {
//     try {
//       console.log('❌ Stripe invoice payment failed:', invoice.id);

//       await query(
//         `INSERT INTO votteryy_payments (
//           user_id,
//           amount,
//           currency,
//           status,
//           gateway,
//           external_payment_id,
//           metadata,
//           created_at
//         ) VALUES (
//           (SELECT user_id FROM votteryy_user_subscriptions 
//            WHERE external_subscription_id = $1 AND gateway_used = 'stripe' LIMIT 1),
//           $2, $3, $4, $5, $6, $7, NOW()
//         )`,
//         [
//           invoice.subscription,
//           invoice.amount_due / 100,
//           invoice.currency,
//           'failed',
//           'stripe',
//           invoice.id,
//           JSON.stringify({
//             invoice_id: invoice.id,
//             subscription_id: invoice.subscription,
//             error: invoice.last_payment_error,
//           }),
//         ]
//       );

//       console.log('✅ Failed payment recorded');
//     } catch (error) {
//       console.error('Stripe invoice failure error:', error);
//       throw error;
//     }
//   },

//   // ========================================
//   // PADDLE WEBHOOK HANDLERS (Updated 2025)
//   // ========================================

//   // Verify Paddle webhook (Paddle Billing API 2025)
//   verifyPaddleWebhook: (rawBody, signature) => {
//     try {
//       // Paddle Billing API uses format: ts=<timestamp>;h1=<signature>
//       const sigParts = signature.split(';');
//       const ts = sigParts.find(p => p.startsWith('ts='))?.split('=')[1];
//       const h1 = sigParts.find(p => p.startsWith('h1='))?.split('=')[1];

//       if (!ts || !h1) {
//         console.error('❌ Invalid Paddle signature format');
//         return false;
//       }

//       // Create the signed payload
//       const signedPayload = `${ts}:${rawBody}`;

//       // Create HMAC
//       const expectedSignature = crypto
//         .createHmac('sha256', config.PADDLE_WEBHOOK_SECRET)
//         .update(signedPayload)
//         .digest('hex');

//       // Compare signatures
//       const isValid = crypto.timingSafeEqual(
//         Buffer.from(h1, 'hex'),
//         Buffer.from(expectedSignature, 'hex')
//       );

//       // Check timestamp (within 5 minutes)
//       const now = Math.floor(Date.now() / 1000);
//       const tsNumber = parseInt(ts, 10);
//       const timeDiff = now - tsNumber;

//       if (timeDiff > 300) {
//         console.warn('⚠️  Paddle webhook timestamp too old:', timeDiff, 'seconds');
//         return false;
//       }

//       return isValid;
//     } catch (error) {
//       console.error('Paddle webhook verification error:', error);
//       return false;
//     }
//   },

//   // Handle Paddle webhook events (Paddle Billing API 2025)
//   handlePaddleEvent: async (event) => {
//     console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//     console.log('🎣 Paddle Webhook Event');
//     console.log(`   Type: ${event.event_type}`);
//     console.log(`   ID: ${event.event_id}`);
//     console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//     switch (event.event_type) {
//       // Subscription events
//       case 'subscription.created':
//         return webhookService.handlePaddleSubscriptionCreated(event.data);

//       case 'subscription.updated':
//         return webhookService.handlePaddleSubscriptionUpdated(event.data);

//       case 'subscription.activated':
//         return webhookService.handlePaddleSubscriptionActivated(event.data);

//       case 'subscription.canceled':
//         return webhookService.handlePaddleSubscriptionCanceled(event.data);

//       case 'subscription.paused':
//         return webhookService.handlePaddleSubscriptionPaused(event.data);

//       case 'subscription.resumed':
//         return webhookService.handlePaddleSubscriptionResumed(event.data);

//       // Transaction events
//       case 'transaction.completed':
//         return webhookService.handlePaddleTransactionCompleted(event.data);

//       case 'transaction.payment_failed':
//         return webhookService.handlePaddleTransactionFailed(event.data);

//       case 'transaction.updated':
//         return webhookService.handlePaddleTransactionUpdated(event.data);

//       default:
//         console.log('Unhandled Paddle event:', event.event_type);
//     }
//   },

//   // Paddle: Subscription created
//   handlePaddleSubscriptionCreated: async (data) => {
//     try {
//       console.log('🆕 Paddle subscription created:', data.id);

//       const userId = data.custom_data?.user_id;
//       if (!userId) {
//         console.warn('⚠️  No user_id in custom_data');
//         return;
//       }

//       const planId = data.items?.[0]?.price?.custom_data?.plan_id;

//       await subscriptionQueries.createOrUpdateSubscription({
//         user_id: userId,
//         plan_id: planId,
//         external_subscription_id: data.id,
//         status: data.status,
//         start_date: new Date(data.current_billing_period?.starts_at),
//         end_date: new Date(data.current_billing_period?.ends_at),
//         gateway: 'paddle',
//         is_recurring: true,
//         metadata: {
//           paddle_customer_id: data.customer_id,
//           paddle_subscription_id: data.id,
//         },
//       });

//       console.log('✅ Paddle subscription created in database');
//     } catch (error) {
//       console.error('Paddle subscription creation error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Subscription updated
//   handlePaddleSubscriptionUpdated: async (data) => {
//     try {
//       console.log('🔄 Paddle subscription updated:', data.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = $1,
//            end_date = $2,
//            updated_at = NOW()
//          WHERE external_subscription_id = $3 AND gateway_used = 'paddle'`,
//         [
//           data.status,
//           new Date(data.current_billing_period?.ends_at),
//           data.id,
//         ]
//       );

//       console.log('✅ Paddle subscription updated');
//     } catch (error) {
//       console.error('Paddle subscription update error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Subscription activated
//   handlePaddleSubscriptionActivated: async (data) => {
//     try {
//       console.log('✅ Paddle subscription activated:', data.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = 'active',
//            start_date = $1,
//            end_date = $2,
//            updated_at = NOW()
//          WHERE external_subscription_id = $3 AND gateway_used = 'paddle'`,
//         [
//           new Date(data.current_billing_period?.starts_at),
//           new Date(data.current_billing_period?.ends_at),
//           data.id,
//         ]
//       );

//       console.log('✅ Paddle subscription activated');
//     } catch (error) {
//       console.error('Paddle subscription activation error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Subscription canceled
//   handlePaddleSubscriptionCanceled: async (data) => {
//     try {
//       console.log('❌ Paddle subscription canceled:', data.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = 'canceled',
//            end_date = $1,
//            auto_renew = false,
//            updated_at = NOW()
//          WHERE external_subscription_id = $2 AND gateway_used = 'paddle'`,
//         [
//           new Date(data.canceled_at),
//           data.id,
//         ]
//       );

//       console.log('✅ Paddle subscription canceled');
//     } catch (error) {
//       console.error('Paddle subscription cancellation error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Subscription paused
//   handlePaddleSubscriptionPaused: async (data) => {
//     try {
//       console.log('⏸️  Paddle subscription paused:', data.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = 'paused',
//            updated_at = NOW()
//          WHERE external_subscription_id = $1 AND gateway_used = 'paddle'`,
//         [data.id]
//       );

//       console.log('✅ Paddle subscription paused');
//     } catch (error) {
//       console.error('Paddle subscription pause error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Subscription resumed
//   handlePaddleSubscriptionResumed: async (data) => {
//     try {
//       console.log('▶️  Paddle subscription resumed:', data.id);

//       await query(
//         `UPDATE votteryy_user_subscriptions
//          SET 
//            status = 'active',
//            updated_at = NOW()
//          WHERE external_subscription_id = $1 AND gateway_used = 'paddle'`,
//         [data.id]
//       );

//       console.log('✅ Paddle subscription resumed');
//     } catch (error) {
//       console.error('Paddle subscription resume error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Transaction completed
//   handlePaddleTransactionCompleted: async (data) => {
//     try {
//       console.log('💰 Paddle transaction completed:', data.id);

//       const userId = data.custom_data?.user_id;
//       if (!userId) {
//         console.warn('⚠️  No user_id in transaction');
//         return;
//       }

//       await query(
//         `INSERT INTO votteryy_payments (
//           user_id,
//           amount,
//           currency,
//           status,
//           gateway,
//           external_payment_id,
//           metadata,
//           created_at
//         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
//         [
//           userId,
//           parseFloat(data.details.totals.total),
//           data.currency_code,
//           'completed',
//           'paddle',
//           data.id,
//           JSON.stringify({
//             transaction_id: data.id,
//             subscription_id: data.subscription_id,
//             customer_id: data.customer_id,
//           }),
//         ]
//       );

//       console.log('✅ Paddle payment recorded');
//     } catch (error) {
//       console.error('Paddle transaction completion error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Transaction failed
//   handlePaddleTransactionFailed: async (data) => {
//     try {
//       console.log('❌ Paddle transaction failed:', data.id);

//       const userId = data.custom_data?.user_id;
//       if (!userId) return;

//       await query(
//         `INSERT INTO votteryy_payments (
//           user_id,
//           amount,
//           currency,
//           status,
//           gateway,
//           external_payment_id,
//           metadata,
//           created_at
//         ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
//         [
//           userId,
//           parseFloat(data.details.totals.total),
//           data.currency_code,
//           'failed',
//           'paddle',
//           data.id,
//           JSON.stringify({
//             transaction_id: data.id,
//             subscription_id: data.subscription_id,
//             error: data.details?.error_code || 'payment_failed',
//           }),
//         ]
//       );

//       console.log('✅ Failed Paddle payment recorded');
//     } catch (error) {
//       console.error('Paddle transaction failure error:', error);
//       throw error;
//     }
//   },

//   // Paddle: Transaction updated
//   handlePaddleTransactionUpdated: async (data) => {
//     try {
//       console.log('🔄 Paddle transaction updated:', data.id);

//       await query(
//         `UPDATE votteryy_payments
//          SET 
//            status = $1,
//            updated_at = NOW()
//          WHERE external_payment_id = $2 AND gateway = 'paddle'`,
//         [data.status, data.id]
//       );

//       console.log('✅ Paddle payment updated');
//     } catch (error) {
//       console.error('Paddle transaction update error:', error);
//       throw error;
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