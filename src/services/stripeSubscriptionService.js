// backend/src/services/stripeSubscriptionService.js
// Handles Stripe recurring subscriptions

import { stripeClient } from '../config/gateways.js';
import { subscriptionQueries } from '../models/subscriptionQueries.js';

export const stripeSubscriptionService = {
  /**
   * Create recurring subscription
   */
  createRecurringSubscription: async (data) => {
    try {
      const { user_id, email, price_id, country_code, region } = data;

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔄 Creating Stripe Recurring Subscription');
      console.log(`   User: ${user_id}`);
      console.log(`   Email: ${email}`);
      console.log(`   Price ID: ${price_id}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Step 1: Create or get Stripe customer
      let customer;
      const existingCustomers = await stripeClient.customers.list({
        email: email,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
        console.log(`✅ Using existing Stripe customer: ${customer.id}`);
      } else {
        customer = await stripeClient.customers.create({
          email: email,
          metadata: {
            user_id: user_id.toString(),
            country_code: country_code || '',
            region: region || '',
          },
        });
        console.log(`✅ Created new Stripe customer: ${customer.id}`);
      }

      // Step 2: Create subscription
      const subscription = await stripeClient.subscriptions.create({
        customer: customer.id,
        items: [{ price: price_id }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          user_id: user_id.toString(),
          country_code: country_code || '',
          region: region || '',
        },
      });

      console.log(`✅ Stripe subscription created: ${subscription.id}`);
      console.log(`   Status: ${subscription.status}`);
      console.log(`   Current period: ${new Date(subscription.current_period_start * 1000).toLocaleDateString()} - ${new Date(subscription.current_period_end * 1000).toLocaleDateString()}`);

      // Step 3: Save to database
      await subscriptionQueries.createOrUpdateSubscription({
        user_id: user_id.toString(),
        plan_id: data.plan_id,
        external_subscription_id: subscription.id,
        status: subscription.status,
        start_date: new Date(subscription.current_period_start * 1000),
        end_date: new Date(subscription.current_period_end * 1000),
        gateway: 'stripe',
        is_recurring: true,
        metadata: {
          stripe_customer_id: customer.id,
          stripe_subscription_id: subscription.id,
          stripe_price_id: price_id,
        },
      });

      console.log('✅ Subscription saved to database');

      return {
        success: true,
        type: 'recurring',
        gateway: 'stripe',
        customerId: customer.id,
        subscriptionId: subscription.id,
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
        status: subscription.status,
      };
    } catch (error) {
      console.error('Stripe subscription creation error:', error);
      throw new Error(`Stripe error: ${error.message}`);
    }
  },

  /**
   * Verify subscription status
   */
  verifySubscription: async (subscriptionId) => {
    try {
      const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);

      return {
        verified: subscription.status === 'active',
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      };
    } catch (error) {
      console.error('Stripe subscription verification error:', error);
      throw error;
    }
  },

  /**
   * Cancel subscription
   */
  cancelSubscription: async (subscriptionId) => {
    try {
      // Cancel at period end (don't charge immediately)
      const subscription = await stripeClient.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });

      console.log(`✅ Subscription ${subscriptionId} will cancel at period end`);

      return {
        success: true,
        cancelAt: new Date(subscription.current_period_end * 1000),
        status: subscription.status,
      };
    } catch (error) {
      console.error('Stripe cancellation error:', error);
      throw error;
    }
  },

  /**
   * Resume cancelled subscription
   */
  resumeSubscription: async (subscriptionId) => {
    try {
      const subscription = await stripeClient.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });

      console.log(`✅ Subscription ${subscriptionId} resumed`);

      return {
        success: true,
        status: subscription.status,
      };
    } catch (error) {
      console.error('Stripe resume error:', error);
      throw error;
    }
  },
};
// //last workable codes 
// // backend/src/services/stripeSubscriptionService.js
// // Handles Stripe recurring subscriptions

// import { stripeClient } from '../config/gateways.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';

// export const stripeSubscriptionService = {
//   /**
//    * Create recurring subscription
//    */
//   createRecurringSubscription: async (data) => {
//     try {
//       const { user_id, email, price_id, country_code, region } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🔄 Creating Stripe Recurring Subscription');
//       console.log(`   User: ${user_id}`);
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Step 1: Create or get Stripe customer
//       let customer;
//       const existingCustomers = await stripeClient.customers.list({
//         email: email,
//         limit: 1,
//       });

//       if (existingCustomers.data.length > 0) {
//         customer = existingCustomers.data[0];
//         console.log(`✅ Using existing Stripe customer: ${customer.id}`);
//       } else {
//         customer = await stripeClient.customers.create({
//           email: email,
//           metadata: {
//             user_id: user_id.toString(),
//             country_code: country_code || '',
//             region: region || '',
//           },
//         });
//         console.log(`✅ Created new Stripe customer: ${customer.id}`);
//       }

//       // Step 2: Create subscription
//       const subscription = await stripeClient.subscriptions.create({
//         customer: customer.id,
//         items: [{ price: price_id }],
//         payment_behavior: 'default_incomplete',
//         payment_settings: {
//           save_default_payment_method: 'on_subscription',
//           payment_method_types: ['card'],
//         },
//         expand: ['latest_invoice.payment_intent'],
//         metadata: {
//           user_id: user_id.toString(),
//           country_code: country_code || '',
//           region: region || '',
//         },
//       });

//       console.log(`✅ Stripe subscription created: ${subscription.id}`);
//       console.log(`   Status: ${subscription.status}`);
//       console.log(`   Current period: ${new Date(subscription.current_period_start * 1000).toLocaleDateString()} - ${new Date(subscription.current_period_end * 1000).toLocaleDateString()}`);

//       // Step 3: Save to database
//       await subscriptionQueries.createOrUpdateSubscription({
//         user_id: user_id.toString(),
//         plan_id: data.plan_id,
//         external_subscription_id: subscription.id,
//         status: subscription.status,
//         start_date: new Date(subscription.current_period_start * 1000),
//         end_date: new Date(subscription.current_period_end * 1000),
//         gateway: 'stripe',
//         is_recurring: true,
//         metadata: {
//           stripe_customer_id: customer.id,
//           stripe_subscription_id: subscription.id,
//           stripe_price_id: price_id,
//         },
//       });

//       console.log('✅ Subscription saved to database');

//       return {
//         success: true,
//         type: 'recurring',
//         gateway: 'stripe',
//         customerId: customer.id,
//         subscriptionId: subscription.id,
//         clientSecret: subscription.latest_invoice.payment_intent.client_secret,
//         status: subscription.status,
//       };
//     } catch (error) {
//       console.error('Stripe subscription creation error:', error);
//       throw new Error(`Stripe error: ${error.message}`);
//     }
//   },

//   /**
//    * Verify subscription status
//    */
//   verifySubscription: async (subscriptionId) => {
//     try {
//       const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);

//       return {
//         verified: subscription.status === 'active',
//         status: subscription.status,
//         currentPeriodEnd: new Date(subscription.current_period_end * 1000),
//         cancelAtPeriodEnd: subscription.cancel_at_period_end,
//       };
//     } catch (error) {
//       console.error('Stripe subscription verification error:', error);
//       throw error;
//     }
//   },

//   /**
//    * Cancel subscription
//    */
//   cancelSubscription: async (subscriptionId) => {
//     try {
//       // Cancel at period end (don't charge immediately)
//       const subscription = await stripeClient.subscriptions.update(subscriptionId, {
//         cancel_at_period_end: true,
//       });

//       console.log(`✅ Subscription ${subscriptionId} will cancel at period end`);

//       return {
//         success: true,
//         cancelAt: new Date(subscription.current_period_end * 1000),
//         status: subscription.status,
//       };
//     } catch (error) {
//       console.error('Stripe cancellation error:', error);
//       throw error;
//     }
//   },

//   /**
//    * Resume cancelled subscription
//    */
//   resumeSubscription: async (subscriptionId) => {
//     try {
//       const subscription = await stripeClient.subscriptions.update(subscriptionId, {
//         cancel_at_period_end: false,
//       });

//       console.log(`✅ Subscription ${subscriptionId} resumed`);

//       return {
//         success: true,
//         status: subscription.status,
//       };
//     } catch (error) {
//       console.error('Stripe resume error:', error);
//       throw error;
//     }
//   },
// };
// // backend/src/services/stripeSubscriptionService.js
// // For RECURRING payments

// import { stripeClient } from '../config/gateways.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';

// export const stripeSubscriptionService = {
//   // Create recurring subscription
//   createRecurringSubscription: async (data) => {
//     try {
//       const { user_id, email, price_id, country_code, region } = data;

//       // Step 1: Create or get customer
//       let customer;
//       const existingCustomers = await stripeClient.customers.list({
//         email: email,
//         limit: 1,
//       });

//       if (existingCustomers.data.length > 0) {
//         customer = existingCustomers.data[0];
//       } else {
//         customer = await stripeClient.customers.create({
//           email: email,
//           metadata: {
//             user_id: user_id.toString(),
//             country_code,
//           },
//         });
//       }

//       // Step 2: Create setup intent (to collect payment method)
//       const setupIntent = await stripeClient.setupIntents.create({
//         customer: customer.id,
//         payment_method_types: ['card'],
//         metadata: {
//           user_id: user_id.toString(),
//           price_id,
//         },
//       });

//       return {
//         success: true,
//         customerId: customer.id,
//         setupIntentId: setupIntent.id,
//         clientSecret: setupIntent.client_secret,
//       };
//     } catch (error) {
//       console.error('Stripe setup intent error:', error);
//       throw new Error(`Stripe error: ${error.message}`);
//     }
//   },

//   // Confirm subscription after payment method attached
//   confirmSubscription: async (data) => {
//     try {
//       const { customer_id, payment_method_id, price_id, user_id, country_code } = data;

//       // Attach payment method to customer
//       await stripeClient.paymentMethods.attach(payment_method_id, {
//         customer: customer_id,
//       });

//       // Set as default payment method
//       await stripeClient.customers.update(customer_id, {
//         invoice_settings: {
//           default_payment_method: payment_method_id,
//         },
//       });

//       // Create subscription
//       const subscription = await stripeClient.subscriptions.create({
//         customer: customer_id,
//         items: [{ price: price_id }],
//         payment_behavior: 'default_incomplete',
//         payment_settings: { save_default_payment_method: 'on_subscription' },
//         expand: ['latest_invoice.payment_intent'],
//         metadata: {
//           user_id: user_id.toString(),
//           country_code,
//         },
//       });

//       // Save to database
//       await subscriptionQueries.createOrUpdateSubscription({
//         user_id,
//         plan_id: price_id,
//         external_subscription_id: subscription.id,
//         status: subscription.status,
//         start_date: new Date(subscription.current_period_start * 1000),
//         end_date: new Date(subscription.current_period_end * 1000),
//         gateway: 'stripe',
//       });

//       return {
//         success: true,
//         subscriptionId: subscription.id,
//         status: subscription.status,
//         clientSecret: subscription.latest_invoice.payment_intent.client_secret,
//       };
//     } catch (error) {
//       console.error('Stripe subscription creation error:', error);
//       throw new Error(`Stripe error: ${error.message}`);
//     }
//   },

//   // Verify subscription status
//   verifySubscription: async (subscriptionId) => {
//     try {
//       const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
      
//       return {
//         verified: subscription.status === 'active',
//         status: subscription.status,
//         currentPeriodEnd: new Date(subscription.current_period_end * 1000),
//       };
//     } catch (error) {
//       console.error('Stripe subscription verification error:', error);
//       throw error;
//     }
//   },

//   // Cancel subscription
//   cancelSubscription: async (subscriptionId) => {
//     try {
//       const subscription = await stripeClient.subscriptions.cancel(subscriptionId);
      
//       return {
//         canceled: subscription.status === 'canceled',
//         canceledAt: new Date(subscription.canceled_at * 1000),
//       };
//     } catch (error) {
//       console.error('Stripe cancellation error:', error);
//       throw error;
//     }
//   },
// };