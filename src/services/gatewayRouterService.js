// backend/src/services/gatewayRouterService.js
// FIXED: Skip Paddle check for pay-as-you-go plans

import { stripeClient, GATEWAY_CONFIG, REGIONS } from '../config/gateways.js';
import { gatewayConfigQueries } from '../models/gatewayConfigQueries.js';
import { gatewayRecommendationService } from './gatewayRecommendationService.js';
import { subscriptionQueries } from '../models/subscriptionQueries.js';

export const gatewayRouterService = {
  // Create payment with country-based routing
  createPaymentByCountry: async (data) => {
    try {
      const { amount, currency, country_code, payment_method, user_id, email, plan_id } = data;

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🌍 Gateway Router - Country-Based Routing');
      console.log(`   Country: ${country_code}`);
      console.log(`   Amount: ${amount} ${currency}`);
      console.log(`   Method: ${payment_method}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Get plan details first
      let planDetails = null;
      if (plan_id) {
        const planResult = await subscriptionQueries.getPlanById(plan_id);
        planDetails = planResult.rows[0];

          console.log('━━━ DEBUG PLAN DATA ━━━');
  console.log('Plan Details:', JSON.stringify(planDetails, null, 2));
  console.log('paddle_price_id type:', typeof planDetails?.paddle_price_id);
  console.log('paddle_price_id value:', planDetails?.paddle_price_id);
  console.log('Is null?', planDetails?.paddle_price_id === null);
  console.log('Is [null] string?', planDetails?.paddle_price_id === '[null]');
  console.log('━━━━━━━━━━━━━━━━━━━━━');
        
        // ✅ FIX: Check if pay-as-you-go plan
        if (planDetails?.payment_type === 'pay_as_you_go') {
          console.log('⚠️  Pay-as-you-go plan detected - no gateway routing needed');
          return {
            success: false,
            error: 'Pay-as-you-go plans should not use gateway routing. Use /payments/track-usage instead.',
            payment_type: 'pay_as_you_go',
          };
        }
      }

      // Get recommendation and select gateway
      const recommendation = await gatewayRecommendationService.getRecommendation(country_code, plan_id);
      const gatewaySelection = await gatewayRecommendationService.selectGatewayForPayment(country_code);

      console.log(`✅ Selected Gateway: ${gatewaySelection.gateway.toUpperCase()}`);

      // Check payment method support
      const availableMethods = gatewayRecommendationService.getAvailablePaymentMethods(gatewaySelection.gateway);
      const methodSupported = availableMethods.some(m => m.method === payment_method);

      if (!methodSupported) {
        return {
          success: false,
          error: `Payment method ${payment_method} not supported by ${gatewaySelection.gateway}`,
          availableMethods: availableMethods.map(m => m.method),
          gateway: gatewaySelection.gateway,
          recommendation,
        };
      }

      // Build payment data
      const paymentData = {
        amount,
        currency: recommendation.currency || currency,
        country_code,
        payment_method,
        user_id,
        email: email || `user${user_id}@votteryy.com`,
        region: recommendation.region,
        plan_id,
      };

      // Route to appropriate gateway
      let paymentResult;

      if (gatewaySelection.gateway === 'stripe') {
        console.log('→ Routing to Stripe');
        const stripeService = await import('./stripeService.js');
        paymentResult = await stripeService.stripeService.createPaymentIntent(paymentData);
      } else {
        console.log('→ Routing to Paddle (2025 API)');

        // ✅ FIX: Only check paddle_price_id for recurring plans
        if (!planDetails?.paddle_price_id) {
          throw new Error(
            `Plan "${planDetails?.plan_name || plan_id}" does not have a paddle_price_id. Please create a Paddle price for this plan in Paddle Dashboard.`
          );
        }

        const paddleService = await import('./paddleService.js');

        // Use new createTransaction method (2025 API)
        paymentResult = await paddleService.paddleService.createTransaction({
          ...paymentData,
          paddle_price_id: planDetails.paddle_price_id,
        });
      }

      console.log('✅ Payment created successfully');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return {
        success: true,
        payment: paymentResult,
        gateway: gatewaySelection.gateway,
        recommendation,
        splitNeeded: gatewaySelection.splitNeeded,
      };
    } catch (error) {
      console.error('❌ Payment creation error:', error);
      throw error;
    }
  },

  // Get optimal gateway for country
  getOptimalGateway: async (country_code, preferredMethod) => {
    try {
      const recommendation = await gatewayRecommendationService.getRecommendation(country_code);
      const selection = await gatewayRecommendationService.selectGatewayForPayment(country_code);

      const gatewayCapabilities = {
        stripe: ['card', 'paypal', 'google_pay', 'apple_pay'],
        paddle: ['card', 'paypal'],
      };

      const capabilities = gatewayCapabilities[selection.gateway] || [];
      const supportsMethod = capabilities.includes(preferredMethod);

      return {
        ...selection,
        ...recommendation,
        methodSupported: supportsMethod,
        availableMethods: capabilities,
        allAvailableGateways: recommendation.available_gateways,
      };
    } catch (error) {
      console.error('Optimal gateway error:', error);
      throw error;
    }
  },
};
// import { stripeClient, GATEWAY_CONFIG, REGIONS } from '../config/gateways.js';
// import { gatewayConfigQueries } from '../models/gatewayConfigQueries.js';
// import { gatewayRecommendationService } from './gatewayRecommendationService.js';

// export const gatewayRouterService = {
//   // Create payment with country-based routing
//   createPaymentByCountry: async (data) => {
//     try {
//       const { amount, currency, country_code, payment_method, user_id, planId } = data;

//       // Get recommendation and select gateway
//       const recommendation = await gatewayRecommendationService.getRecommendation(country_code, planId);
//       const gatewaySelection = await gatewayRecommendationService.selectGatewayForPayment(country_code);

//       // Check payment method support
//       const availableMethods = gatewayRecommendationService.getAvailablePaymentMethods(gatewaySelection.gateway);
//       const methodSupported = availableMethods.some(m => m.method === payment_method);

//       if (!methodSupported) {
//         return {
//           success: false,
//           error: `Payment method ${payment_method} not supported by ${gatewaySelection.gateway}`,
//           availableMethods: availableMethods.map(m => m.method),
//           gateway: gatewaySelection.gateway,
//           recommendation,
//         };
//       }

//       // Build payment data
//       const paymentData = {
//         amount,
//         currency: recommendation.currency || currency,
//         country_code,
//         payment_method,
//         user_id,
//         region: recommendation.region,
//       };

//       // Route to appropriate gateway
//       let paymentResult;
//       if (gatewaySelection.gateway === 'stripe') {
//         const stripeService = await import('./stripeService.js');
//         paymentResult = await stripeService.stripeService.createPaymentIntent(paymentData);
//       } else {
//         const paddleService = await import('./paddleService.js');
//         paymentResult = await paddleService.paddleService.createCheckout(paymentData);
//       }

//       return {
//         success: true,
//         payment: paymentResult,
//         gateway: gatewaySelection.gateway,
//         recommendation,
//         splitNeeded: gatewaySelection.splitNeeded,
//       };
//     } catch (error) {
//       console.error('Payment creation error:', error);
//       throw error;
//     }
//   },

//   // Get optimal gateway for country
//   getOptimalGateway: async (country_code, preferredMethod) => {
//     try {
//       const recommendation = await gatewayRecommendationService.getRecommendation(country_code);
//       const selection = await gatewayRecommendationService.selectGatewayForPayment(country_code);

//       const gatewayCapabilities = {
//         stripe: ['card', 'paypal', 'google_pay', 'apple_pay'],
//         paddle: ['card', 'paypal'],
//       };

//       const capabilities = gatewayCapabilities[selection.gateway] || [];
//       const supportsMethod = capabilities.includes(preferredMethod);

//       return {
//         ...selection,
//         ...recommendation,
//         methodSupported: supportsMethod,
//         availableMethods: capabilities,
//         allAvailableGateways: recommendation.available_gateways,
//       };
//     } catch (error) {
//       console.error('Optimal gateway error:', error);
//       throw error;
//     }
//   },
// };