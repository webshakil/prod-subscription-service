import { stripeClient } from '../config/gateways.js';
import { paymentQueries } from '../models/paymentQueries.js';
import { gatewayRecommendationService } from './gatewayRecommendationService.js';

export const stripeService = {
  createPaymentIntent: async (data) => {
    try {
      const { amount, currency, payment_method, user_id, country_code, region, plan_id } = data; // ✅ ADDED: plan_id

      // Create payment intent WITHOUT confirming (frontend will confirm)
      const paymentIntent = await stripeClient.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          user_id,
          country_code,
          region,
          plan_id: plan_id || null, // ✅ ADDED: Store plan_id in metadata
          payment_method_type: payment_method,
        },
      });

      await paymentQueries.recordPayment({
        user_id,
        plan_id: plan_id || null, // ✅ ADDED: Store plan_id in database
        subscription_id: null,
        amount,
        currency,
        gateway: 'stripe',
        external_payment_id: paymentIntent.id,
        status: 'pending',
        payment_method,
        region,
        country_code,
        metadata: { 
          intent_id: paymentIntent.id,
          plan_id: plan_id || null // ✅ ADDED: Also store in metadata JSON
        },
      });

      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        clientSecret: paymentIntent.client_secret,
      };
    } catch (error) {
      console.error('Stripe payment intent error:', error);
      throw new Error(`Stripe error: ${error.message}`);
    }
  },

  verifyPayment: async (paymentIntentId) => {
    try {
      const paymentIntent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
      return {
        verified: paymentIntent.status === 'succeeded',
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        metadata: paymentIntent.metadata, // ✅ ADDED: Return metadata including plan_id
      };
    } catch (error) {
      console.error('Stripe verification error:', error);
      throw error;
    }
  },

  createSubscription: async (data) => {
    try {
      const { customerId, priceId, user_id, country_code, region, plan_id } = data; // ✅ ADDED: plan_id

      const subscription = await stripeClient.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        metadata: { 
          user_id, 
          country_code, 
          region,
          plan_id: plan_id || null // ✅ ADDED: Store plan_id
        },
      });

      return {
        subscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      };
    } catch (error) {
      console.error('Stripe subscription error:', error);
      throw error;
    }
  },

  cancelSubscription: async (subscriptionId) => {
    try {
      const subscription = await stripeClient.subscriptions.del(subscriptionId);
      return { canceled: subscription.status === 'canceled' };
    } catch (error) {
      console.error('Stripe cancellation error:', error);
      throw error;
    }
  },
};
// import { stripeClient } from '../config/gateways.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { gatewayRecommendationService } from './gatewayRecommendationService.js';

// export const stripeService = {
//   createPaymentIntent: async (data) => {
//     try {
//       const { amount, currency, payment_method, user_id, country_code, region, plan_id } = data; // ✅ ADDED: plan_id

//       // Create payment intent WITHOUT confirming (frontend will confirm)
//       const paymentIntent = await stripeClient.paymentIntents.create({
//         amount: Math.round(amount * 100),
//         currency: currency.toLowerCase(),
//         automatic_payment_methods: {
//           enabled: true,
//         },
//         metadata: {
//           user_id,
//           country_code,
//           region,
//           plan_id: plan_id || null, // ✅ ADDED: Store plan_id in metadata
//           payment_method_type: payment_method,
//         },
//       });

//       await paymentQueries.recordPayment({
//         user_id,
//         plan_id: plan_id || null, // ✅ ADDED: Store plan_id in database
//         subscription_id: null,
//         amount,
//         currency,
//         gateway: 'stripe',
//         external_payment_id: paymentIntent.id,
//         status: 'pending',
//         payment_method,
//         region,
//         country_code,
//         metadata: { 
//           intent_id: paymentIntent.id,
//           plan_id: plan_id || null // ✅ ADDED: Also store in metadata JSON
//         },
//       });

//       return {
//         success: true,
//         paymentIntentId: paymentIntent.id,
//         status: paymentIntent.status,
//         clientSecret: paymentIntent.client_secret,
//       };
//     } catch (error) {
//       console.error('Stripe payment intent error:', error);
//       throw new Error(`Stripe error: ${error.message}`);
//     }
//   },

//   verifyPayment: async (paymentIntentId) => {
//     try {
//       const paymentIntent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
//       return {
//         verified: paymentIntent.status === 'succeeded',
//         status: paymentIntent.status,
//         amount: paymentIntent.amount / 100,
//         metadata: paymentIntent.metadata, // ✅ ADDED: Return metadata including plan_id
//       };
//     } catch (error) {
//       console.error('Stripe verification error:', error);
//       throw error;
//     }
//   },

//   createSubscription: async (data) => {
//     try {
//       const { customerId, priceId, user_id, country_code, region, plan_id } = data; // ✅ ADDED: plan_id

//       const subscription = await stripeClient.subscriptions.create({
//         customer: customerId,
//         items: [{ price: priceId }],
//         metadata: { 
//           user_id, 
//           country_code, 
//           region,
//           plan_id: plan_id || null // ✅ ADDED: Store plan_id
//         },
//       });

//       return {
//         subscriptionId: subscription.id,
//         status: subscription.status,
//         currentPeriodEnd: new Date(subscription.current_period_end * 1000),
//       };
//     } catch (error) {
//       console.error('Stripe subscription error:', error);
//       throw error;
//     }
//   },

//   cancelSubscription: async (subscriptionId) => {
//     try {
//       const subscription = await stripeClient.subscriptions.del(subscriptionId);
//       return { canceled: subscription.status === 'canceled' };
//     } catch (error) {
//       console.error('Stripe cancellation error:', error);
//       throw error;
//     }
//   },
// };
// import { stripeClient } from '../config/gateways.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { gatewayRecommendationService } from './gatewayRecommendationService.js';

// export const stripeService = {
//   createPaymentIntent: async (data) => {
//     try {
//       const { amount, currency, payment_method, user_id, country_code, region } = data;

//       // Create payment intent WITHOUT confirming (frontend will confirm)
//       const paymentIntent = await stripeClient.paymentIntents.create({
//         amount: Math.round(amount * 100),
//         currency: currency.toLowerCase(),
//         automatic_payment_methods: {
//           enabled: true,
//         },
//         metadata: {
//           user_id,
//           country_code,
//           region,
//           payment_method_type: payment_method, // Store the type for reference
//         },
//       });

//       await paymentQueries.recordPayment({
//         user_id,
//         amount,
//         currency,
//         gateway: 'stripe',
//         external_payment_id: paymentIntent.id,
//         status: 'pending', // Always pending until webhook confirms
//         payment_method,
//         region,
//         country_code,
//         metadata: { intent_id: paymentIntent.id },
//       });

//       return {
//         success: true,
//         paymentIntentId: paymentIntent.id,
//         status: paymentIntent.status,
//         clientSecret: paymentIntent.client_secret,
//       };
//     } catch (error) {
//       console.error('Stripe payment intent error:', error);
//       throw new Error(`Stripe error: ${error.message}`);
//     }
//   },

//   verifyPayment: async (paymentIntentId) => {
//     try {
//       const paymentIntent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
//       return {
//         verified: paymentIntent.status === 'succeeded',
//         status: paymentIntent.status,
//         amount: paymentIntent.amount / 100,
//       };
//     } catch (error) {
//       console.error('Stripe verification error:', error);
//       throw error;
//     }
//   },

//   createSubscription: async (data) => {
//     try {
//       const { customerId, priceId, user_id, country_code, region } = data;

//       const subscription = await stripeClient.subscriptions.create({
//         customer: customerId,
//         items: [{ price: priceId }],
//         metadata: { user_id, country_code, region },
//       });

//       return {
//         subscriptionId: subscription.id,
//         status: subscription.status,
//         currentPeriodEnd: new Date(subscription.current_period_end * 1000),
//       };
//     } catch (error) {
//       console.error('Stripe subscription error:', error);
//       throw error;
//     }
//   },

//   cancelSubscription: async (subscriptionId) => {
//     try {
//       const subscription = await stripeClient.subscriptions.del(subscriptionId);
//       return { canceled: subscription.status === 'canceled' };
//     } catch (error) {
//       console.error('Stripe cancellation error:', error);
//       throw error;
//     }
//   },
// };
// import { stripeClient } from '../config/gateways.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { gatewayRecommendationService } from './gatewayRecommendationService.js';

// export const stripeService = {
//   createPaymentIntent: async (data) => {
//     try {
//       const { amount, currency, payment_method, user_id, country_code, region } = data;

//       const paymentIntent = await stripeClient.paymentIntents.create({
//         amount: Math.round(amount * 100),
//         currency: currency.toLowerCase(),
//         payment_method,
//         confirm: true,
//         automatic_payment_methods: {
//           enabled: true,
//           allow_redirects: 'never',
//         },
//         metadata: {
//           user_id,
//           country_code,
//           region,
//         },
//       });

//       await paymentQueries.recordPayment({
//         user_id,
//         amount,
//         currency,
//         gateway: 'stripe',
//         external_payment_id: paymentIntent.id,
//         status: paymentIntent.status === 'succeeded' ? 'success' : 'pending',
//         payment_method,
//         region,
//         country_code,
//         metadata: { intent_id: paymentIntent.id },
//       });

//       return {
//         success: paymentIntent.status === 'succeeded',
//         paymentIntentId: paymentIntent.id,
//         status: paymentIntent.status,
//         clientSecret: paymentIntent.client_secret,
//       };
//     } catch (error) {
//       console.error('Stripe payment intent error:', error);
//       throw new Error(`Stripe error: ${error.message}`);
//     }
//   },

//   verifyPayment: async (paymentIntentId) => {
//     try {
//       const paymentIntent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
//       return {
//         verified: paymentIntent.status === 'succeeded',
//         status: paymentIntent.status,
//         amount: paymentIntent.amount / 100,
//       };
//     } catch (error) {
//       console.error('Stripe verification error:', error);
//       throw error;
//     }
//   },

//   createSubscription: async (data) => {
//     try {
//       const { customerId, priceId, user_id, country_code, region } = data;

//       const subscription = await stripeClient.subscriptions.create({
//         customer: customerId,
//         items: [{ price: priceId }],
//         metadata: { user_id, country_code, region },
//       });

//       return {
//         subscriptionId: subscription.id,
//         status: subscription.status,
//         currentPeriodEnd: new Date(subscription.current_period_end * 1000),
//       };
//     } catch (error) {
//       console.error('Stripe subscription error:', error);
//       throw error;
//     }
//   },

//   cancelSubscription: async (subscriptionId) => {
//     try {
//       const subscription = await stripeClient.subscriptions.del(subscriptionId);
//       return { canceled: subscription.status === 'canceled' };
//     } catch (error) {
//       console.error('Stripe cancellation error:', error);
//       throw error;
//     }
//   },
// };