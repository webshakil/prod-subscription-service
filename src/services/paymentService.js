// backend/src/services/paymentService.js
// Simplified: Only handles pay-as-you-go
// All other payments go through your EXISTING gatewayRouterService

import { subscriptionQueries } from '../models/subscriptionQueries.js';
import { usageQueries } from '../models/usageQueries.js';

export const paymentService = {
  /**
   * Handle pay-as-you-go plan activation (no payment gateway)
   */
  handlePayAsYouGo: async (params) => {
    const { user_id, plan } = params;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💰 PAY-AS-YOU-GO Plan Activation');
    console.log(`   Plan: ${plan.plan_name}`);
    console.log(`   Price per election: $${plan.price_per_unit || plan.price}`);
    console.log('   No upfront payment required');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Activate plan immediately (no payment gateway needed)
    await subscriptionQueries.createOrUpdateSubscription({
      user_id,
      plan_id: plan.id,
      status: 'active',
      start_date: new Date(),
      end_date: null, // No expiry for pay-as-you-go
      gateway: 'manual',
      is_recurring: false,
      metadata: {
        payment_type: 'pay_as_you_go',
        price_per_unit: plan.price_per_unit || plan.price,
      },
    });

    console.log('✅ Pay-as-you-go plan activated');

    return {
      success: true,
      type: 'pay_as_you_go',
      message: 'Pay-as-you-go plan activated. You will be charged per election.',
      planDetails: {
        id: plan.id,
        name: plan.plan_name,
        pricePerUnit: plan.price_per_unit || plan.price,
        paymentType: 'pay_as_you_go',
      },
    };
  },

  /**
   * Track usage for pay-as-you-go users
   */
  trackUsage: async (data) => {
    const { user_id, election_id, usage_type = 'election_created', quantity = 1 } = data;

    console.log('📊 Tracking usage for pay-as-you-go...');

    // Get user's active subscription
    const subscriptionResult = await subscriptionQueries.getActiveSubscriptionByUserId(user_id);
    
    if (!subscriptionResult || !subscriptionResult.rows || subscriptionResult.rows.length === 0) {
      console.log('⚠️  No active subscription found');
      return null;
    }

    const subscription = subscriptionResult.rows[0];

    // Get plan details
    const planResult = await subscriptionQueries.getPlanById(subscription.plan_id);
    if (!planResult || !planResult.rows || planResult.rows.length === 0) {
      throw new Error('Plan not found');
    }

    const plan = planResult.rows[0];

    // Only track for pay-as-you-go plans
    if (plan.payment_type !== 'pay_as_you_go') {
      console.log('ℹ️  User is on recurring plan, no usage tracking needed');
      return null;
    }

    const pricePerUnit = plan.price_per_unit || plan.price;
    const totalAmount = pricePerUnit * quantity;

    // Record usage
    const usage = await usageQueries.createUsage({
      user_id,
      election_id,
      usage_type,
      quantity,
      price_per_unit: pricePerUnit,
      total_amount: totalAmount,
      status: 'pending',
    });

    console.log(`✅ Usage tracked: $${totalAmount} (${quantity} × $${pricePerUnit})`);

    return usage;
  },

  /**
   * Get unpaid usage for billing
   */
  getUnpaidUsage: async (user_id) => {
    const usage = await usageQueries.getUnpaidUsage(user_id);
    const total = usage.reduce((sum, item) => sum + parseFloat(item.total_amount), 0);

    return {
      items: usage,
      total: total.toFixed(2),
      count: usage.length,
    };
  },

  /**
   * Get user's current plan info
   */
  getCurrentPlan: async (user_id) => {
    const subscriptionResult = await subscriptionQueries.getActiveSubscriptionByUserId(user_id);
    
    if (!subscriptionResult || !subscriptionResult.rows || subscriptionResult.rows.length === 0) {
      return null;
    }

    const subscription = subscriptionResult.rows[0];

    // Get plan details
    const planResult = await subscriptionQueries.getPlanById(subscription.plan_id);
    if (!planResult || !planResult.rows || planResult.rows.length === 0) {
      return null;
    }

    const plan = planResult.rows[0];

    const result = {
      subscription: subscription,
      plan: plan,
      status: subscription.status,
      isPayAsYouGo: plan.payment_type === 'pay_as_you_go',
      isRecurring: subscription.is_recurring,
    };

    // Add usage data for pay-as-you-go
    if (result.isPayAsYouGo) {
      const unpaidUsage = await paymentService.getUnpaidUsage(user_id);
      result.unpaidUsage = unpaidUsage;
    }

    return result;
  },
};
// // backend/src/services/paymentService.js
// // Orchestrator that works WITH your existing services

// import { gatewayRouterService } from './gatewayRouterService.js';
// import { gatewayRecommendationService } from './gatewayRecommendationService.js';
// import { stripeService } from './stripeService.js';
// import { stripeSubscriptionService } from './stripeSubscriptionService.js';
// import { paddleService } from './paddleService.js';
// import { planQueries } from '../models/planQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { usageQueries } from '../models/usageQueries.js';

// export const paymentService = {
//   /**
//    * Main entry point for all payment creation
//    * Delegates to existing services based on payment type
//    */
//   createPayment: async (data) => {
//     try {
//       const { user_id, email, plan_id, country_code, region } = data;

//       // Step 1: Get plan from database
//       const planResult = await planQueries.getPlanById(plan_id);
//       if (!planResult.rows[0]) {
//         throw new Error('Plan not found');
//       }

//       const plan = planResult.rows[0];

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('📦 Payment Request via Orchestrator:');
//       console.log(`   Plan: ${plan.plan_name}`);
//       console.log(`   Type: ${plan.payment_type || 'recurring'}`);
//       console.log(`   Price: $${plan.price}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Step 2: Determine payment type and route accordingly
//       const paymentType = plan.payment_type || 'recurring';

//       switch (paymentType) {
//         case 'pay_as_you_go':
//           // Handle manually (no gateway needed)
//           return await paymentService.handlePayAsYouGo({ user_id, plan });

//         case 'recurring':
//         case 'subscription':
//           // Use your EXISTING gateway routing logic
//           return await paymentService.handleRecurringPayment({
//             user_id,
//             email,
//             plan,
//             country_code,
//             region,
//             data,
//           });

//         default:
//           throw new Error(`Unknown payment type: ${paymentType}`);
//       }
//     } catch (error) {
//       console.error('Payment orchestration error:', error);
//       throw error;
//     }
//   },

//   /**
//    * Handle recurring payments - delegates to YOUR existing services
//    */
//   handleRecurringPayment: async (params) => {
//     const { user_id, email, plan, country_code, region, data } = params;

//     console.log('🔄 Routing to existing gateway services...');

//     // Step 1: Use YOUR gatewayRecommendationService (keep intact!)
//     const recommendation = await gatewayRecommendationService.recommendGateway({
//       country: country_code,
//       region: region,
//       amount: plan.price,
//       currency: 'USD',
//     });

//     console.log(`📡 Gateway Recommendation: ${recommendation.gateway}`);

//     // Step 2: Use YOUR gatewayRouterService (keep intact!)
//     const gateway = data.gateway || recommendation.gateway;

//     // Step 3: Delegate to appropriate service
//     if (gateway === 'stripe') {
//       // Use YOUR stripeSubscriptionService
//       console.log('→ Delegating to stripeSubscriptionService');
      
//       return await stripeSubscriptionService.createRecurringSubscription({
//         user_id,
//         email,
//         price_id: plan.stripe_price_id,
//         country_code,
//         region,
//       });
//     } else if (gateway === 'paddle') {
//       // Use YOUR paddleService
//       console.log('→ Delegating to paddleService');
      
//       return await paddleService.createSubscription({
//         user_id,
//         customer_email: email,
//         price_id: plan.paddle_price_id || plan.stripe_price_id,
//         country_code,
//       });
//     }

//     throw new Error(`Unsupported gateway: ${gateway}`);
//   },

//   /**
//    * Handle pay-as-you-go (manual, no gateway)
//    */
//   handlePayAsYouGo: async (params) => {
//     const { user_id, plan } = params;

//     console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//     console.log('💰 PAY-AS-YOU-GO Plan (Manual)');
//     console.log(`   Price per election: $${plan.price_per_unit || plan.price}`);
//     console.log('   No upfront payment required');
//     console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//     // Activate plan immediately (no payment gateway)
//     await subscriptionQueries.createOrUpdateSubscription({
//       user_id,
//       plan_id: plan.id,
//       status: 'active',
//       start_date: new Date(),
//       end_date: null, // No expiry for pay-as-you-go
//       gateway: 'manual',
//       is_recurring: false,
//       metadata: {
//         payment_type: 'pay_as_you_go',
//         price_per_unit: plan.price_per_unit || plan.price,
//       },
//     });

//     console.log('✅ Pay-as-you-go plan activated');

//     return {
//       success: true,
//       type: 'pay_as_you_go',
//       message: 'Pay-as-you-go plan activated. You will be charged per election.',
//       planDetails: {
//         id: plan.id,
//         name: plan.plan_name,
//         pricePerUnit: plan.price_per_unit || plan.price,
//         paymentType: 'pay_as_you_go',
//       },
//     };
//   },

//   /**
//    * Track usage for pay-as-you-go users
//    */
//   trackUsage: async (data) => {
//     const { user_id, election_id, usage_type = 'election_created', quantity = 1 } = data;

//     console.log('📊 Tracking usage for pay-as-you-go...');

//     // Get user's active subscription
//     const subscription = await subscriptionQueries.getActiveSubscription(user_id);
    
//     if (!subscription) {
//       throw new Error('No active subscription found');
//     }

//     const plan = subscription.plan;

//     // Only track for pay-as-you-go plans
//     if (plan.payment_type !== 'pay_as_you_go') {
//       console.log('ℹ️  User is on recurring plan, no usage tracking needed');
//       return null;
//     }

//     const pricePerUnit = plan.price_per_unit || plan.price;
//     const totalAmount = pricePerUnit * quantity;

//     // Record usage
//     const usage = await usageQueries.createUsage({
//       user_id,
//       election_id,
//       usage_type,
//       quantity,
//       price_per_unit: pricePerUnit,
//       total_amount: totalAmount,
//       status: 'pending',
//     });

//     console.log(`✅ Usage tracked: $${totalAmount} (${quantity} × $${pricePerUnit})`);

//     // Optional: Update user's total usage
//     await subscriptionQueries.updateUsageStats(user_id, totalAmount);

//     return usage;
//   },

//   /**
//    * Get unpaid usage for billing
//    */
//   getUnpaidUsage: async (user_id) => {
//     const usage = await usageQueries.getUnpaidUsage(user_id);
//     const total = usage.reduce((sum, item) => sum + parseFloat(item.total_amount), 0);

//     return {
//       items: usage,
//       total: total.toFixed(2),
//       count: usage.length,
//     };
//   },

//   /**
//    * Get user's current plan info
//    */
//   getCurrentPlan: async (user_id) => {
//     const subscription = await subscriptionQueries.getActiveSubscription(user_id);
    
//     if (!subscription) {
//       return null;
//     }

//     const result = {
//       plan: subscription.plan,
//       status: subscription.status,
//       isPayAsYouGo: subscription.plan.payment_type === 'pay_as_you_go',
//       isRecurring: subscription.is_recurring,
//     };

//     // Add usage data for pay-as-you-go
//     if (result.isPayAsYouGo) {
//       const unpaidUsage = await paymentService.getUnpaidUsage(user_id);
//       result.unpaidUsage = unpaidUsage;
//     }

//     return result;
//   },
// };