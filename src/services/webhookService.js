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
      const plan_id = paymentIntent.metadata?.plan_id?.trim() || null;
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
        
        // Get plan details to calculate correct end date
        const planResult = await subscriptionQueries.getPlanById(plan_id);
        const plan = planResult.rows[0];
        
        if (!plan) {
          console.error('❌ Plan not found:', plan_id);
          console.warn('⚠️  No plan_id found - payment recorded but no subscription created');
          console.log('✅ Payment success handled completely\n');
          return;
        }
        
        // ✅ MODIFIED: Calculate end date - null for pay-as-you-go, calculated for others
        let endDate;
        
        if (plan.payment_type === 'pay_as_you_go') {
          console.log('🎫 Pay-as-you-go plan detected - no expiry date');
          endDate = null;
        } else {
          // Calculate end date based on plan duration for recurring plans
          let durationDays = plan.duration_days;
          
          // If duration_days is not set, calculate from billing_cycle
          if (!durationDays) {
            const cycleMap = {
              'monthly': 30,
              'quarterly': 90,
              'semi_annual': 180,
              'annual': 365
            };
            durationDays = cycleMap[plan.billing_cycle] || 30;
          }
          
          endDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
        }
        
        // Check if user has existing subscription
        const existingSub = await subscriptionQueries.getUserSubscription(user_id);
        
        if (existingSub.rows.length > 0) {
          console.log('🔄 Updating existing subscription');
          await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
            plan_id: plan_id,
            status: 'active',
            end_date: endDate,
          });
        } else {
          console.log('✨ Creating new subscription');
          await subscriptionQueries.createSubscription({
            user_id,
            plan_id: plan_id,
            status: 'active',
            start_date: new Date(),
            end_date: endDate,
            gateway,
            external_subscription_id: paymentIntent.id,
          });
        }

        // ✅ REMOVED: usageQueries.trackUsage() call - not needed for subscription payments
        // Usage tracking is only for pay-as-you-go elections, not subscription payments
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
      const plan_id = subscription.metadata?.plan_id;

      if (!user_id) {
        console.error('No user_id in subscription metadata');
        return;
      }

      const existingSub = await subscriptionQueries.getUserSubscription(user_id);

      const subscriptionData = {
        status: subscription.status,
        start_date: new Date(subscription.current_period_start * 1000),
        end_date: new Date(subscription.current_period_end * 1000),
        external_subscription_id: subscription.id,
        plan_id: plan_id || null,
      };

      if (existingSub.rows.length > 0) {
        await subscriptionQueries.updateSubscription(existingSub.rows[0].id, subscriptionData);
      } else {
        await subscriptionQueries.createSubscription({
          user_id,
          plan_id: plan_id || 4,
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
      const plan_id = transaction.custom_data?.plan_id;

      await paymentQueries.recordPayment({
        user_id,
        plan_id: plan_id || null,
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
      const plan_id = subscription.custom_data?.plan_id;

      if (!user_id) return;

      const existingSub = await subscriptionQueries.getUserSubscription(user_id);

      const subscriptionData = {
        status: subscription.status === 'active' ? 'active' : 'inactive',
        start_date: new Date(subscription.current_billing_period?.starts_at),
        end_date: new Date(subscription.current_billing_period?.ends_at),
        external_subscription_id: subscription.id,
        plan_id: plan_id || null,
      };

      if (existingSub.rows.length > 0) {
        await subscriptionQueries.updateSubscription(existingSub.rows[0].id, subscriptionData);
      } else {
        await subscriptionQueries.createSubscription({
          user_id,
          plan_id: plan_id || 4,
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
//last workable codes
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { usageQueries } from '../models/usageQueries.js';

// export const webhookService = {
//   // ✅ FIXED: Handle Stripe webhook events with proper plan_id extraction
//   handleStripeEvent: async (event) => {
//     console.log(`\n🎯 Processing Stripe Event: ${event.type}`);
//     console.log(`📋 Event ID: ${event.id}`);

//     try {
//       switch (event.type) {
//         case 'payment_intent.succeeded':
//           await webhookService.handlePaymentSuccess(event.data.object, 'stripe');
//           break;

//         case 'payment_intent.payment_failed':
//           await webhookService.handlePaymentFailed(event.data.object, 'stripe');
//           break;

//         case 'customer.subscription.created':
//         case 'customer.subscription.updated':
//           await webhookService.handleSubscriptionUpdate(event.data.object, 'stripe');
//           break;

//         case 'customer.subscription.deleted':
//           await webhookService.handleSubscriptionCanceled(event.data.object, 'stripe');
//           break;

//         default:
//           console.log(`⚠️  Unhandled event type: ${event.type}`);
//       }

//       console.log('✅ Webhook processed successfully\n');
//     } catch (error) {
//       console.error('❌ Webhook processing error:', error);
//       throw error;
//     }
//   },

//   // ✅ FIXED: Handle payment success with plan_id
//   handlePaymentSuccess: async (paymentIntent, gateway) => {
//     console.log('\n💰 Payment Success Handler');
//     console.log('Payment Intent ID:', paymentIntent.id);
//     console.log('Amount:', paymentIntent.amount / 100, paymentIntent.currency.toUpperCase());
//     console.log('Metadata:', JSON.stringify(paymentIntent.metadata, null, 2));

//     try {
//       // ✅ FIXED: Extract plan_id from metadata
//       const plan_id = paymentIntent.metadata?.plan_id?.trim() || null;
//       const user_id = paymentIntent.metadata?.user_id;

//       console.log('🔍 Extracted plan_id:', plan_id);
//       console.log('🔍 Extracted user_id:', user_id);

//       if (!user_id) {
//         console.error('❌ No user_id in payment metadata');
//         throw new Error('Missing user_id in payment metadata');
//       }

//       // Find existing payment record
//       const existingPayment = await paymentQueries.getPaymentByExternalId(paymentIntent.id);

//       if (existingPayment.rows.length > 0) {
//         console.log('📝 Updating existing payment record:', existingPayment.rows[0].id);
        
//         // ✅ FIXED: Update payment with plan_id if not already set
//         const currentPlanId = existingPayment.rows[0].plan_id;
//         const updatedPlanId = currentPlanId || plan_id;

//         console.log('Current plan_id in DB:', currentPlanId);
//         console.log('Will update to plan_id:', updatedPlanId);

//         await paymentQueries.updatePaymentStatus(existingPayment.rows[0].id, 'completed');
        
//         // ✅ ADDED: If plan_id was missing, update it now
//         if (!currentPlanId && plan_id) {
//           console.log('🔄 Updating payment record with plan_id:', plan_id);
//           const updateSql = `
//             UPDATE votteryy_payments 
//             SET plan_id = $1, updated_at = NOW()
//             WHERE id = $2
//             RETURNING *;
//           `;
//           const { query } = await import('../config/database.js');
//           await query(updateSql, [plan_id, existingPayment.rows[0].id]);
//         }
//       } else {
//         console.log('📝 Creating new payment record');
        
//         // ✅ FIXED: Include plan_id when creating payment record
//         await paymentQueries.recordPayment({
//           user_id,
//           plan_id: plan_id || null, // ✅ ADDED: Include plan_id
//           subscription_id: null,
//           amount: paymentIntent.amount / 100,
//           currency: paymentIntent.currency.toUpperCase(),
//           gateway,
//           external_payment_id: paymentIntent.id,
//           status: 'completed',
//           payment_method: paymentIntent.payment_method_types?.[0] || 'card',
//           region: paymentIntent.metadata?.region,
//           country_code: paymentIntent.metadata?.country_code,
//           metadata: paymentIntent.metadata,
//         });
//       }

//       // ✅ FIXED: Create/update subscription if plan_id exists
//       if (plan_id) {
//         console.log('🎫 Creating/updating subscription for plan:', plan_id);
        
//         // Get plan details to calculate correct end date
//         const planResult = await subscriptionQueries.getPlanById(plan_id);
//         const plan = planResult.rows[0];
        
//         if (!plan) {
//           console.error('❌ Plan not found:', plan_id);
//           console.warn('⚠️  No plan_id found - payment recorded but no subscription created');
//           console.log('✅ Payment success handled completely\n');
//           return;
//         }
        
//         // Calculate end date based on plan duration
//         let durationDays = plan.duration_days;
        
//         // If duration_days is not set, calculate from billing_cycle
//         if (!durationDays) {
//           const cycleMap = {
//             'monthly': 30,
//             'quarterly': 90,
//             'semi_annual': 180,
//             'annual': 365
//           };
//           durationDays = cycleMap[plan.billing_cycle] || 30;
//         }
        
//         const endDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
        
//         // Check if user has existing subscription
//         const existingSub = await subscriptionQueries.getUserSubscription(user_id);
        
//         if (existingSub.rows.length > 0) {
//           console.log('🔄 Updating existing subscription');
//           await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
//             plan_id: plan_id,
//             status: 'active',
//             end_date: endDate,
//           });
//         } else {
//           console.log('✨ Creating new subscription');
//           await subscriptionQueries.createSubscription({
//             user_id,
//             plan_id: plan_id,
//             status: 'active',
//             start_date: new Date(),
//             end_date: endDate,
//             gateway,
//             external_subscription_id: paymentIntent.id,
//           });
//         }

//         // ✅ REMOVED: usageQueries.trackUsage() call - not needed for subscription payments
//         // Usage tracking is only for pay-as-you-go elections, not subscription payments
//       } else {
//         console.warn('⚠️  No plan_id found - payment recorded but no subscription created');
//       }

//       console.log('✅ Payment success handled completely\n');
//     } catch (error) {
//       console.error('❌ Error in handlePaymentSuccess:', error);
//       throw error;
//     }
//   },

//   // Handle payment failure
//   handlePaymentFailed: async (paymentIntent, gateway) => {
//     console.log('\n❌ Payment Failed Handler');
//     console.log('Payment Intent ID:', paymentIntent.id);
    
//     try {
//       const existingPayment = await paymentQueries.getPaymentByExternalId(paymentIntent.id);

//       if (existingPayment.rows.length > 0) {
//         await paymentQueries.updatePaymentStatus(existingPayment.rows[0].id, 'failed');
//       }

//       await paymentQueries.recordFailedPayment({
//         user_id: paymentIntent.metadata?.user_id,
//         subscription_id: null,
//         amount: paymentIntent.amount / 100,
//         reason: paymentIntent.last_payment_error?.message || 'Payment failed',
//         gateway,
//         region: paymentIntent.metadata?.region,
//         metadata: paymentIntent.metadata,
//       });

//       console.log('✅ Payment failure recorded\n');
//     } catch (error) {
//       console.error('Error in handlePaymentFailed:', error);
//       throw error;
//     }
//   },

//   // Handle subscription updates
//   handleSubscriptionUpdate: async (subscription, gateway) => {
//     console.log('\n🔄 Subscription Update Handler');
//     console.log('Subscription ID:', subscription.id);
//     console.log('Status:', subscription.status);

//     try {
//       const user_id = subscription.metadata?.user_id;
//       const plan_id = subscription.metadata?.plan_id;

//       if (!user_id) {
//         console.error('No user_id in subscription metadata');
//         return;
//       }

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       const subscriptionData = {
//         status: subscription.status,
//         start_date: new Date(subscription.current_period_start * 1000),
//         end_date: new Date(subscription.current_period_end * 1000),
//         external_subscription_id: subscription.id,
//         plan_id: plan_id || null,
//       };

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, subscriptionData);
//       } else {
//         await subscriptionQueries.createSubscription({
//           user_id,
//           plan_id: plan_id || 4,
//           ...subscriptionData,
//           gateway,
//         });
//       }

//       console.log('✅ Subscription updated\n');
//     } catch (error) {
//       console.error('Error in handleSubscriptionUpdate:', error);
//       throw error;
//     }
//   },

//   // Handle subscription cancellation
//   handleSubscriptionCanceled: async (subscription, gateway) => {
//     console.log('\n🚫 Subscription Canceled Handler');
//     console.log('Subscription ID:', subscription.id);

//     try {
//       const user_id = subscription.metadata?.user_id;

//       if (!user_id) {
//         console.error('No user_id in subscription metadata');
//         return;
//       }

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
//           status: 'canceled',
//           canceled_at: new Date(),
//         });
//       }

//       console.log('✅ Subscription canceled\n');
//     } catch (error) {
//       console.error('Error in handleSubscriptionCanceled:', error);
//       throw error;
//     }
//   },

//   // ✅ FIXED: Handle Paddle events (2025 API)
//   handlePaddleEvent: async (event) => {
//     console.log(`\n🎯 Processing Paddle Event: ${event.event_type}`);
//     console.log(`📋 Event ID: ${event.event_id}`);

//     try {
//       switch (event.event_type) {
//         case 'transaction.completed':
//           await webhookService.handlePaddlePaymentSuccess(event.data);
//           break;

//         case 'transaction.payment_failed':
//           await webhookService.handlePaddlePaymentFailed(event.data);
//           break;

//         case 'subscription.created':
//         case 'subscription.updated':
//           await webhookService.handlePaddleSubscriptionUpdate(event.data);
//           break;

//         case 'subscription.canceled':
//           await webhookService.handlePaddleSubscriptionCanceled(event.data);
//           break;

//         default:
//           console.log(`⚠️  Unhandled Paddle event: ${event.event_type}`);
//       }

//       console.log('✅ Paddle webhook processed successfully\n');
//     } catch (error) {
//       console.error('❌ Paddle webhook error:', error);
//       throw error;
//     }
//   },

//   handlePaddlePaymentSuccess: async (transaction) => {
//     console.log('\n💰 Paddle Payment Success');
//     console.log('Transaction ID:', transaction.id);
    
//     try {
//       const user_id = transaction.custom_data?.user_id;
//       const plan_id = transaction.custom_data?.plan_id;

//       await paymentQueries.recordPayment({
//         user_id,
//         plan_id: plan_id || null,
//         subscription_id: transaction.subscription_id || null,
//         amount: parseFloat(transaction.details.totals.total) / 100,
//         currency: transaction.currency_code,
//         gateway: 'paddle',
//         external_payment_id: transaction.id,
//         status: 'completed',
//         payment_method: 'paddle',
//         region: transaction.custom_data?.region,
//         country_code: transaction.billing_details?.country_code,
//         metadata: transaction.custom_data,
//       });

//       console.log('✅ Paddle payment recorded\n');
//     } catch (error) {
//       console.error('Error in handlePaddlePaymentSuccess:', error);
//       throw error;
//     }
//   },

//   handlePaddlePaymentFailed: async (transaction) => {
//     console.log('\n❌ Paddle Payment Failed');
//     console.log('Transaction ID:', transaction.id);
    
//     try {
//       await paymentQueries.recordFailedPayment({
//         user_id: transaction.custom_data?.user_id,
//         subscription_id: transaction.subscription_id || null,
//         amount: parseFloat(transaction.details.totals.total) / 100,
//         reason: 'Paddle payment failed',
//         gateway: 'paddle',
//         region: transaction.custom_data?.region,
//         metadata: transaction.custom_data,
//       });

//       console.log('✅ Paddle payment failure recorded\n');
//     } catch (error) {
//       console.error('Error in handlePaddlePaymentFailed:', error);
//       throw error;
//     }
//   },

//   handlePaddleSubscriptionUpdate: async (subscription) => {
//     console.log('\n🔄 Paddle Subscription Update');
//     console.log('Subscription ID:', subscription.id);
    
//     try {
//       const user_id = subscription.custom_data?.user_id;
//       const plan_id = subscription.custom_data?.plan_id;

//       if (!user_id) return;

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       const subscriptionData = {
//         status: subscription.status === 'active' ? 'active' : 'inactive',
//         start_date: new Date(subscription.current_billing_period?.starts_at),
//         end_date: new Date(subscription.current_billing_period?.ends_at),
//         external_subscription_id: subscription.id,
//         plan_id: plan_id || null,
//       };

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, subscriptionData);
//       } else {
//         await subscriptionQueries.createSubscription({
//           user_id,
//           plan_id: plan_id || 4,
//           ...subscriptionData,
//           gateway: 'paddle',
//         });
//       }

//       console.log('✅ Paddle subscription updated\n');
//     } catch (error) {
//       console.error('Error in handlePaddleSubscriptionUpdate:', error);
//       throw error;
//     }
//   },

//   handlePaddleSubscriptionCanceled: async (subscription) => {
//     console.log('\n🚫 Paddle Subscription Canceled');
//     console.log('Subscription ID:', subscription.id);
    
//     try {
//       const user_id = subscription.custom_data?.user_id;

//       if (!user_id) return;

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
//           status: 'canceled',
//           canceled_at: new Date(),
//         });
//       }

//       console.log('✅ Paddle subscription canceled\n');
//     } catch (error) {
//       console.error('Error in handlePaddleSubscriptionCanceled:', error);
//       throw error;
//     }
//   },
// };
//last workable codes
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { usageQueries } from '../models/usageQueries.js';

// export const webhookService = {
//   // ✅ FIXED: Handle Stripe webhook events with proper plan_id extraction
//   handleStripeEvent: async (event) => {
//     console.log(`\n🎯 Processing Stripe Event: ${event.type}`);
//     console.log(`📋 Event ID: ${event.id}`);

//     try {
//       switch (event.type) {
//         case 'payment_intent.succeeded':
//           await webhookService.handlePaymentSuccess(event.data.object, 'stripe');
//           break;

//         case 'payment_intent.payment_failed':
//           await webhookService.handlePaymentFailed(event.data.object, 'stripe');
//           break;

//         case 'customer.subscription.created':
//         case 'customer.subscription.updated':
//           await webhookService.handleSubscriptionUpdate(event.data.object, 'stripe');
//           break;

//         case 'customer.subscription.deleted':
//           await webhookService.handleSubscriptionCanceled(event.data.object, 'stripe');
//           break;

//         default:
//           console.log(`⚠️  Unhandled event type: ${event.type}`);
//       }

//       console.log('✅ Webhook processed successfully\n');
//     } catch (error) {
//       console.error('❌ Webhook processing error:', error);
//       throw error;
//     }
//   },

//   // ✅ FIXED: Handle payment success with plan_id
//   handlePaymentSuccess: async (paymentIntent, gateway) => {
//     console.log('\n💰 Payment Success Handler');
//     console.log('Payment Intent ID:', paymentIntent.id);
//     console.log('Amount:', paymentIntent.amount / 100, paymentIntent.currency.toUpperCase());
//     console.log('Metadata:', JSON.stringify(paymentIntent.metadata, null, 2));

//     try {
//       // ✅ FIXED: Extract plan_id from metadata
//       //const plan_id = paymentIntent.metadata?.plan_id || null;
//       const plan_id = paymentIntent.metadata?.plan_id && paymentIntent.metadata.plan_id !== "" 
//   ? paymentIntent.metadata.plan_id 
//   : null;
//       const user_id = paymentIntent.metadata?.user_id;

//       console.log('🔍 Extracted plan_id:', plan_id);
//       console.log('🔍 Extracted user_id:', user_id);

//       if (!user_id) {
//         console.error('❌ No user_id in payment metadata');
//         throw new Error('Missing user_id in payment metadata');
//       }

//       // Find existing payment record
//       const existingPayment = await paymentQueries.getPaymentByExternalId(paymentIntent.id);

//       if (existingPayment.rows.length > 0) {
//         console.log('📝 Updating existing payment record:', existingPayment.rows[0].id);
        
//         // ✅ FIXED: Update payment with plan_id if not already set
//         const currentPlanId = existingPayment.rows[0].plan_id;
//         const updatedPlanId = currentPlanId || plan_id;

//         console.log('Current plan_id in DB:', currentPlanId);
//         console.log('Will update to plan_id:', updatedPlanId);

//         await paymentQueries.updatePaymentStatus(existingPayment.rows[0].id, 'completed');
        
//         // ✅ ADDED: If plan_id was missing, update it now
//         if (!currentPlanId && plan_id) {
//           console.log('🔄 Updating payment record with plan_id:', plan_id);
//           const updateSql = `
//             UPDATE votteryy_payments 
//             SET plan_id = $1, updated_at = NOW()
//             WHERE id = $2
//             RETURNING *;
//           `;
//           const { query } = await import('../config/database.js');
//           await query(updateSql, [plan_id, existingPayment.rows[0].id]);
//         }
//       } else {
//         console.log('📝 Creating new payment record');
        
//         // ✅ FIXED: Include plan_id when creating payment record
//         await paymentQueries.recordPayment({
//           user_id,
//           plan_id: plan_id || null, // ✅ ADDED: Include plan_id
//           subscription_id: null,
//           amount: paymentIntent.amount / 100,
//           currency: paymentIntent.currency.toUpperCase(),
//           gateway,
//           external_payment_id: paymentIntent.id,
//           status: 'completed',
//           payment_method: paymentIntent.payment_method_types?.[0] || 'card',
//           region: paymentIntent.metadata?.region,
//           country_code: paymentIntent.metadata?.country_code,
//           metadata: paymentIntent.metadata,
//         });
//       }

//       // ✅ FIXED: Create/update subscription if plan_id exists
//       // ✅ CORRECT VERSION - Calculate end_date based on plan
// if (plan_id) {
//   console.log('🎫 Creating/updating subscription for plan:', plan_id);
  
//   // Get plan details to calculate correct end date
//   const planResult = await subscriptionQueries.getPlanById(plan_id);
//   const plan = planResult.rows[0];
  
//   if (!plan) {
//     console.error('❌ Plan not found:', plan_id);
//     return;
//   }
  
//   // Calculate end date based on plan duration
//   let durationDays = plan.duration_days;
  
//   // If duration_days is not set, calculate from billing_cycle
//   if (!durationDays) {
//     const cycleMap = {
//       'monthly': 30,
//       'quarterly': 90,
//       'semi_annual': 180,
//       'annual': 365
//     };
//     durationDays = cycleMap[plan.billing_cycle] || 30;
//   }
  
//   const endDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
  
//   // Check if user has existing subscription
//   const existingSub = await subscriptionQueries.getUserSubscription(user_id);
  
//   if (existingSub.rows.length > 0) {
//     console.log('🔄 Updating existing subscription');
//     await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
//       plan_id: plan_id,
//       status: 'active',
//       end_date: endDate, // ✅ Use calculated end date
//     });
//   } else {
//     console.log('✨ Creating new subscription');
//     await subscriptionQueries.createSubscription({
//       user_id,
//       plan_id: plan_id,
//       status: 'active',
//       start_date: new Date(),
//       end_date: endDate, // ✅ Use calculated end date
//       gateway,
//       external_subscription_id: paymentIntent.id,
//     });
//   }

      

//         // Track usage
//         await usageQueries.trackUsage({
//           user_id,
//           tracking_id: paymentIntent.id,
//           usage_type: 'subscription_payment',
//           metadata: { plan_id, amount: paymentIntent.amount / 100 },
//         });
//       } else {
//         console.warn('⚠️  No plan_id found - payment recorded but no subscription created');
//       }

//       console.log('✅ Payment success handled completely\n');
//     } catch (error) {
//       console.error('❌ Error in handlePaymentSuccess:', error);
//       throw error;
//     }
//   },

//   // Handle payment failure
//   handlePaymentFailed: async (paymentIntent, gateway) => {
//     console.log('\n❌ Payment Failed Handler');
//     console.log('Payment Intent ID:', paymentIntent.id);
    
//     try {
//       const existingPayment = await paymentQueries.getPaymentByExternalId(paymentIntent.id);

//       if (existingPayment.rows.length > 0) {
//         await paymentQueries.updatePaymentStatus(existingPayment.rows[0].id, 'failed');
//       }

//       await paymentQueries.recordFailedPayment({
//         user_id: paymentIntent.metadata?.user_id,
//         subscription_id: null,
//         amount: paymentIntent.amount / 100,
//         reason: paymentIntent.last_payment_error?.message || 'Payment failed',
//         gateway,
//         region: paymentIntent.metadata?.region,
//         metadata: paymentIntent.metadata,
//       });

//       console.log('✅ Payment failure recorded\n');
//     } catch (error) {
//       console.error('Error in handlePaymentFailed:', error);
//       throw error;
//     }
//   },

//   // Handle subscription updates
//   handleSubscriptionUpdate: async (subscription, gateway) => {
//     console.log('\n🔄 Subscription Update Handler');
//     console.log('Subscription ID:', subscription.id);
//     console.log('Status:', subscription.status);

//     try {
//       const user_id = subscription.metadata?.user_id;
//       const plan_id = subscription.metadata?.plan_id; // ✅ ADDED: Extract plan_id

//       if (!user_id) {
//         console.error('No user_id in subscription metadata');
//         return;
//       }

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       const subscriptionData = {
//         status: subscription.status,
//         start_date: new Date(subscription.start_date * 1000),
//         end_date: new Date(subscription.end_date * 1000),
//         external_subscription_id: subscription.id,
//         plan_id: plan_id || null, // ✅ ADDED: Include plan_id
//       };

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, subscriptionData);
//       } else {
//         await subscriptionQueries.createSubscription({
//           user_id,
//           plan_id: plan_id || 4, // ✅ MODIFIED: Use plan_id from metadata or default to 4
//           ...subscriptionData,
//           gateway,
//         });
//       }

//       console.log('✅ Subscription updated\n');
//     } catch (error) {
//       console.error('Error in handleSubscriptionUpdate:', error);
//       throw error;
//     }
//   },

//   // Handle subscription cancellation
//   handleSubscriptionCanceled: async (subscription, gateway) => {
//     console.log('\n🚫 Subscription Canceled Handler');
//     console.log('Subscription ID:', subscription.id);

//     try {
//       const user_id = subscription.metadata?.user_id;

//       if (!user_id) {
//         console.error('No user_id in subscription metadata');
//         return;
//       }

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
//           status: 'canceled',
//           canceled_at: new Date(),
//         });
//       }

//       console.log('✅ Subscription canceled\n');
//     } catch (error) {
//       console.error('Error in handleSubscriptionCanceled:', error);
//       throw error;
//     }
//   },

//   // ✅ FIXED: Handle Paddle events (2025 API)
//   handlePaddleEvent: async (event) => {
//     console.log(`\n🎯 Processing Paddle Event: ${event.event_type}`);
//     console.log(`📋 Event ID: ${event.event_id}`);

//     try {
//       switch (event.event_type) {
//         case 'transaction.completed':
//           await webhookService.handlePaddlePaymentSuccess(event.data);
//           break;

//         case 'transaction.payment_failed':
//           await webhookService.handlePaddlePaymentFailed(event.data);
//           break;

//         case 'subscription.created':
//         case 'subscription.updated':
//           await webhookService.handlePaddleSubscriptionUpdate(event.data);
//           break;

//         case 'subscription.canceled':
//           await webhookService.handlePaddleSubscriptionCanceled(event.data);
//           break;

//         default:
//           console.log(`⚠️  Unhandled Paddle event: ${event.event_type}`);
//       }

//       console.log('✅ Paddle webhook processed successfully\n');
//     } catch (error) {
//       console.error('❌ Paddle webhook error:', error);
//       throw error;
//     }
//   },

//   handlePaddlePaymentSuccess: async (transaction) => {
//     console.log('\n💰 Paddle Payment Success');
//     console.log('Transaction ID:', transaction.id);
    
//     try {
//       const user_id = transaction.custom_data?.user_id;
//       const plan_id = transaction.custom_data?.plan_id; // ✅ ADDED: Extract plan_id

//       await paymentQueries.recordPayment({
//         user_id,
//         plan_id: plan_id || null, // ✅ ADDED: Include plan_id
//         subscription_id: transaction.subscription_id || null,
//         amount: parseFloat(transaction.details.totals.total) / 100,
//         currency: transaction.currency_code,
//         gateway: 'paddle',
//         external_payment_id: transaction.id,
//         status: 'completed',
//         payment_method: 'paddle',
//         region: transaction.custom_data?.region,
//         country_code: transaction.billing_details?.country_code,
//         metadata: transaction.custom_data,
//       });

//       console.log('✅ Paddle payment recorded\n');
//     } catch (error) {
//       console.error('Error in handlePaddlePaymentSuccess:', error);
//       throw error;
//     }
//   },

//   handlePaddlePaymentFailed: async (transaction) => {
//     console.log('\n❌ Paddle Payment Failed');
//     console.log('Transaction ID:', transaction.id);
    
//     try {
//       await paymentQueries.recordFailedPayment({
//         user_id: transaction.custom_data?.user_id,
//         subscription_id: transaction.subscription_id || null,
//         amount: parseFloat(transaction.details.totals.total) / 100,
//         reason: 'Paddle payment failed',
//         gateway: 'paddle',
//         region: transaction.custom_data?.region,
//         metadata: transaction.custom_data,
//       });

//       console.log('✅ Paddle payment failure recorded\n');
//     } catch (error) {
//       console.error('Error in handlePaddlePaymentFailed:', error);
//       throw error;
//     }
//   },

//   handlePaddleSubscriptionUpdate: async (subscription) => {
//     console.log('\n🔄 Paddle Subscription Update');
//     console.log('Subscription ID:', subscription.id);
    
//     try {
//       const user_id = subscription.custom_data?.user_id;
//       const plan_id = subscription.custom_data?.plan_id; // ✅ ADDED: Extract plan_id

//       if (!user_id) return;

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       const subscriptionData = {
//         status: subscription.status === 'active' ? 'active' : 'inactive',
//         start_date: new Date(subscription.current_billing_period?.starts_at),
//         end_date: new Date(subscription.current_billing_period?.ends_at),
//         external_subscription_id: subscription.id,
//         plan_id: plan_id || null, // ✅ ADDED: Include plan_id
//       };

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, subscriptionData);
//       } else {
//         await subscriptionQueries.createSubscription({
//           user_id,
//           plan_id: plan_id || 4, // ✅ MODIFIED: Use plan_id from metadata or default
//           ...subscriptionData,
//           gateway: 'paddle',
//         });
//       }

//       console.log('✅ Paddle subscription updated\n');
//     } catch (error) {
//       console.error('Error in handlePaddleSubscriptionUpdate:', error);
//       throw error;
//     }
//   },

//   handlePaddleSubscriptionCanceled: async (subscription) => {
//     console.log('\n🚫 Paddle Subscription Canceled');
//     console.log('Subscription ID:', subscription.id);
    
//     try {
//       const user_id = subscription.custom_data?.user_id;

//       if (!user_id) return;

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
//           status: 'canceled',
//           canceled_at: new Date(),
//         });
//       }

//       console.log('✅ Paddle subscription canceled\n');
//     } catch (error) {
//       console.error('Error in handlePaddleSubscriptionCanceled:', error);
//       throw error;
//     }
//   },
// };
//last working codes
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { usageQueries } from '../models/usageQueries.js';

// export const webhookService = {
//   // ✅ FIXED: Handle Stripe webhook events with proper plan_id extraction
//   handleStripeEvent: async (event) => {
//     console.log(`\n🎯 Processing Stripe Event: ${event.type}`);
//     console.log(`📋 Event ID: ${event.id}`);

//     try {
//       switch (event.type) {
//         case 'payment_intent.succeeded':
//           await webhookService.handlePaymentSuccess(event.data.object, 'stripe');
//           break;

//         case 'payment_intent.payment_failed':
//           await webhookService.handlePaymentFailed(event.data.object, 'stripe');
//           break;

//         case 'customer.subscription.created':
//         case 'customer.subscription.updated':
//           await webhookService.handleSubscriptionUpdate(event.data.object, 'stripe');
//           break;

//         case 'customer.subscription.deleted':
//           await webhookService.handleSubscriptionCanceled(event.data.object, 'stripe');
//           break;

//         default:
//           console.log(`⚠️  Unhandled event type: ${event.type}`);
//       }

//       console.log('✅ Webhook processed successfully\n');
//     } catch (error) {
//       console.error('❌ Webhook processing error:', error);
//       throw error;
//     }
//   },

//   // ✅ FIXED: Handle payment success with plan_id
//   handlePaymentSuccess: async (paymentIntent, gateway) => {
//     console.log('\n💰 Payment Success Handler');
//     console.log('Payment Intent ID:', paymentIntent.id);
//     console.log('Amount:', paymentIntent.amount / 100, paymentIntent.currency.toUpperCase());
//     console.log('Metadata:', JSON.stringify(paymentIntent.metadata, null, 2));

//     try {
//       // ✅ FIXED: Extract plan_id from metadata
//       //const plan_id = paymentIntent.metadata?.plan_id || null;
//       const plan_id = paymentIntent.metadata?.plan_id && paymentIntent.metadata.plan_id !== "" 
//   ? paymentIntent.metadata.plan_id 
//   : null;
//       const user_id = paymentIntent.metadata?.user_id;

//       console.log('🔍 Extracted plan_id:', plan_id);
//       console.log('🔍 Extracted user_id:', user_id);

//       if (!user_id) {
//         console.error('❌ No user_id in payment metadata');
//         throw new Error('Missing user_id in payment metadata');
//       }

//       // Find existing payment record
//       const existingPayment = await paymentQueries.getPaymentByExternalId(paymentIntent.id);

//       if (existingPayment.rows.length > 0) {
//         console.log('📝 Updating existing payment record:', existingPayment.rows[0].id);
        
//         // ✅ FIXED: Update payment with plan_id if not already set
//         const currentPlanId = existingPayment.rows[0].plan_id;
//         const updatedPlanId = currentPlanId || plan_id;

//         console.log('Current plan_id in DB:', currentPlanId);
//         console.log('Will update to plan_id:', updatedPlanId);

//         await paymentQueries.updatePaymentStatus(existingPayment.rows[0].id, 'completed');
        
//         // ✅ ADDED: If plan_id was missing, update it now
//         if (!currentPlanId && plan_id) {
//           console.log('🔄 Updating payment record with plan_id:', plan_id);
//           const updateSql = `
//             UPDATE votteryy_payments 
//             SET plan_id = $1, updated_at = NOW()
//             WHERE id = $2
//             RETURNING *;
//           `;
//           const { query } = await import('../config/database.js');
//           await query(updateSql, [plan_id, existingPayment.rows[0].id]);
//         }
//       } else {
//         console.log('📝 Creating new payment record');
        
//         // ✅ FIXED: Include plan_id when creating payment record
//         await paymentQueries.recordPayment({
//           user_id,
//           plan_id: plan_id || null, // ✅ ADDED: Include plan_id
//           subscription_id: null,
//           amount: paymentIntent.amount / 100,
//           currency: paymentIntent.currency.toUpperCase(),
//           gateway,
//           external_payment_id: paymentIntent.id,
//           status: 'completed',
//           payment_method: paymentIntent.payment_method_types?.[0] || 'card',
//           region: paymentIntent.metadata?.region,
//           country_code: paymentIntent.metadata?.country_code,
//           metadata: paymentIntent.metadata,
//         });
//       }

//       // ✅ FIXED: Create/update subscription if plan_id exists
//       if (plan_id) {
//         console.log('🎫 Creating/updating subscription for plan:', plan_id);
        
//         // Check if user has existing subscription
//         const existingSub = await subscriptionQueries.getUserSubscription(user_id);
        
//         if (existingSub.rows.length > 0) {
//           console.log('🔄 Updating existing subscription');
//           // Update existing subscription
//           await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
//             plan_id: plan_id,
//             status: 'active',
//             end_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days for quarterly
//           });
//         } else {
//           console.log('✨ Creating new subscription');
//           // Create new subscription
//           await subscriptionQueries.createSubscription({
//             user_id,
//             plan_id: plan_id,
//             status: 'active',
//             start_date: new Date(),
//             end_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
//             gateway,
//             external_subscription_id: paymentIntent.id, // Use payment intent as reference
//           });
//         }

//         // Track usage
//         await usageQueries.trackUsage({
//           user_id,
//           tracking_id: paymentIntent.id,
//           usage_type: 'subscription_payment',
//           metadata: { plan_id, amount: paymentIntent.amount / 100 },
//         });
//       } else {
//         console.warn('⚠️  No plan_id found - payment recorded but no subscription created');
//       }

//       console.log('✅ Payment success handled completely\n');
//     } catch (error) {
//       console.error('❌ Error in handlePaymentSuccess:', error);
//       throw error;
//     }
//   },

//   // Handle payment failure
//   handlePaymentFailed: async (paymentIntent, gateway) => {
//     console.log('\n❌ Payment Failed Handler');
//     console.log('Payment Intent ID:', paymentIntent.id);
    
//     try {
//       const existingPayment = await paymentQueries.getPaymentByExternalId(paymentIntent.id);

//       if (existingPayment.rows.length > 0) {
//         await paymentQueries.updatePaymentStatus(existingPayment.rows[0].id, 'failed');
//       }

//       await paymentQueries.recordFailedPayment({
//         user_id: paymentIntent.metadata?.user_id,
//         subscription_id: null,
//         amount: paymentIntent.amount / 100,
//         reason: paymentIntent.last_payment_error?.message || 'Payment failed',
//         gateway,
//         region: paymentIntent.metadata?.region,
//         metadata: paymentIntent.metadata,
//       });

//       console.log('✅ Payment failure recorded\n');
//     } catch (error) {
//       console.error('Error in handlePaymentFailed:', error);
//       throw error;
//     }
//   },

//   // Handle subscription updates
//   handleSubscriptionUpdate: async (subscription, gateway) => {
//     console.log('\n🔄 Subscription Update Handler');
//     console.log('Subscription ID:', subscription.id);
//     console.log('Status:', subscription.status);

//     try {
//       const user_id = subscription.metadata?.user_id;
//       const plan_id = subscription.metadata?.plan_id; // ✅ ADDED: Extract plan_id

//       if (!user_id) {
//         console.error('No user_id in subscription metadata');
//         return;
//       }

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       const subscriptionData = {
//         status: subscription.status,
//         start_date: new Date(subscription.start_date * 1000),
//         end_date: new Date(subscription.end_date * 1000),
//         external_subscription_id: subscription.id,
//         plan_id: plan_id || null, // ✅ ADDED: Include plan_id
//       };

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, subscriptionData);
//       } else {
//         await subscriptionQueries.createSubscription({
//           user_id,
//           plan_id: plan_id || 4, // ✅ MODIFIED: Use plan_id from metadata or default to 4
//           ...subscriptionData,
//           gateway,
//         });
//       }

//       console.log('✅ Subscription updated\n');
//     } catch (error) {
//       console.error('Error in handleSubscriptionUpdate:', error);
//       throw error;
//     }
//   },

//   // Handle subscription cancellation
//   handleSubscriptionCanceled: async (subscription, gateway) => {
//     console.log('\n🚫 Subscription Canceled Handler');
//     console.log('Subscription ID:', subscription.id);

//     try {
//       const user_id = subscription.metadata?.user_id;

//       if (!user_id) {
//         console.error('No user_id in subscription metadata');
//         return;
//       }

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
//           status: 'canceled',
//           canceled_at: new Date(),
//         });
//       }

//       console.log('✅ Subscription canceled\n');
//     } catch (error) {
//       console.error('Error in handleSubscriptionCanceled:', error);
//       throw error;
//     }
//   },

//   // ✅ FIXED: Handle Paddle events (2025 API)
//   handlePaddleEvent: async (event) => {
//     console.log(`\n🎯 Processing Paddle Event: ${event.event_type}`);
//     console.log(`📋 Event ID: ${event.event_id}`);

//     try {
//       switch (event.event_type) {
//         case 'transaction.completed':
//           await webhookService.handlePaddlePaymentSuccess(event.data);
//           break;

//         case 'transaction.payment_failed':
//           await webhookService.handlePaddlePaymentFailed(event.data);
//           break;

//         case 'subscription.created':
//         case 'subscription.updated':
//           await webhookService.handlePaddleSubscriptionUpdate(event.data);
//           break;

//         case 'subscription.canceled':
//           await webhookService.handlePaddleSubscriptionCanceled(event.data);
//           break;

//         default:
//           console.log(`⚠️  Unhandled Paddle event: ${event.event_type}`);
//       }

//       console.log('✅ Paddle webhook processed successfully\n');
//     } catch (error) {
//       console.error('❌ Paddle webhook error:', error);
//       throw error;
//     }
//   },

//   handlePaddlePaymentSuccess: async (transaction) => {
//     console.log('\n💰 Paddle Payment Success');
//     console.log('Transaction ID:', transaction.id);
    
//     try {
//       const user_id = transaction.custom_data?.user_id;
//       const plan_id = transaction.custom_data?.plan_id; // ✅ ADDED: Extract plan_id

//       await paymentQueries.recordPayment({
//         user_id,
//         plan_id: plan_id || null, // ✅ ADDED: Include plan_id
//         subscription_id: transaction.subscription_id || null,
//         amount: parseFloat(transaction.details.totals.total) / 100,
//         currency: transaction.currency_code,
//         gateway: 'paddle',
//         external_payment_id: transaction.id,
//         status: 'completed',
//         payment_method: 'paddle',
//         region: transaction.custom_data?.region,
//         country_code: transaction.billing_details?.country_code,
//         metadata: transaction.custom_data,
//       });

//       console.log('✅ Paddle payment recorded\n');
//     } catch (error) {
//       console.error('Error in handlePaddlePaymentSuccess:', error);
//       throw error;
//     }
//   },

//   handlePaddlePaymentFailed: async (transaction) => {
//     console.log('\n❌ Paddle Payment Failed');
//     console.log('Transaction ID:', transaction.id);
    
//     try {
//       await paymentQueries.recordFailedPayment({
//         user_id: transaction.custom_data?.user_id,
//         subscription_id: transaction.subscription_id || null,
//         amount: parseFloat(transaction.details.totals.total) / 100,
//         reason: 'Paddle payment failed',
//         gateway: 'paddle',
//         region: transaction.custom_data?.region,
//         metadata: transaction.custom_data,
//       });

//       console.log('✅ Paddle payment failure recorded\n');
//     } catch (error) {
//       console.error('Error in handlePaddlePaymentFailed:', error);
//       throw error;
//     }
//   },

//   handlePaddleSubscriptionUpdate: async (subscription) => {
//     console.log('\n🔄 Paddle Subscription Update');
//     console.log('Subscription ID:', subscription.id);
    
//     try {
//       const user_id = subscription.custom_data?.user_id;
//       const plan_id = subscription.custom_data?.plan_id; // ✅ ADDED: Extract plan_id

//       if (!user_id) return;

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       const subscriptionData = {
//         status: subscription.status === 'active' ? 'active' : 'inactive',
//         start_date: new Date(subscription.current_billing_period?.starts_at),
//         end_date: new Date(subscription.current_billing_period?.ends_at),
//         external_subscription_id: subscription.id,
//         plan_id: plan_id || null, // ✅ ADDED: Include plan_id
//       };

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, subscriptionData);
//       } else {
//         await subscriptionQueries.createSubscription({
//           user_id,
//           plan_id: plan_id || 4, // ✅ MODIFIED: Use plan_id from metadata or default
//           ...subscriptionData,
//           gateway: 'paddle',
//         });
//       }

//       console.log('✅ Paddle subscription updated\n');
//     } catch (error) {
//       console.error('Error in handlePaddleSubscriptionUpdate:', error);
//       throw error;
//     }
//   },

//   handlePaddleSubscriptionCanceled: async (subscription) => {
//     console.log('\n🚫 Paddle Subscription Canceled');
//     console.log('Subscription ID:', subscription.id);
    
//     try {
//       const user_id = subscription.custom_data?.user_id;

//       if (!user_id) return;

//       const existingSub = await subscriptionQueries.getUserSubscription(user_id);

//       if (existingSub.rows.length > 0) {
//         await subscriptionQueries.updateSubscription(existingSub.rows[0].id, {
//           status: 'canceled',
//           canceled_at: new Date(),
//         });
//       }

//       console.log('✅ Paddle subscription canceled\n');
//     } catch (error) {
//       console.error('Error in handlePaddleSubscriptionCanceled:', error);
//       throw error;
//     }
//   },
// };

