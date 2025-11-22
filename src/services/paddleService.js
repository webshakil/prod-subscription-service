// backend/src/services/paddleService.js
import axios from 'axios';
import { config } from '../config/env.js';

// ✅ Sandbox-aware API base URL
const PADDLE_API_BASE = process.env.PADDLE_ENVIRONMENT === 'production'
  ? 'https://api.paddle.com'
  : 'https://sandbox-api.paddle.com';

console.log('🔧 Paddle Service Initialized:');
console.log('   Environment:', process.env.PADDLE_ENVIRONMENT || 'sandbox');
console.log('   API Base:', PADDLE_API_BASE);

// ✅ Helper: Get Paddle Price ID from plan name
const getPaddlePriceId = (planName) => {
  if (!planName) {
    throw new Error('Plan name is required to get Paddle Price ID');
  }

  const normalizedName = planName.toLowerCase().replace(/\s+/g, '-');
  
  const priceIdMap = {
    'pay-as-you-go': process.env.PADDLE_PRICE_PAY_AS_YOU_GO,
    'monthly': process.env.PADDLE_PRICE_MONTHLY,
    'quarterly': process.env.PADDLE_PRICE_QUARTERLY,
    '3-month-quarterly': process.env.PADDLE_PRICE_QUARTERLY,
    'semi-annual': process.env.PADDLE_PRICE_SEMI_ANNUAL,
    '6-month-semi-annual': process.env.PADDLE_PRICE_SEMI_ANNUAL,
    'annual': process.env.PADDLE_PRICE_ANNUAL,
    'yearly': process.env.PADDLE_PRICE_ANNUAL,
  };

  const priceId = priceIdMap[normalizedName];
  
  if (!priceId) {
    console.error(`❌ No Paddle Price ID found for plan: "${planName}"`);
    throw new Error(`Missing Paddle Price ID for plan: ${planName}`);
  }
  
  return priceId;
};

export const paddleService = {
  /**
   * Create transaction (one-time payment)
   */
  createTransaction: async (data) => {
    try {
      const { user_id, email, amount, currency, planId } = data;

      if (!planId) {
        throw new Error('Plan ID is required');
      }

      const { subscriptionQueries } = await import('../models/subscriptionQueries.js');
      const planResult = await subscriptionQueries.getPlanById(planId);
      
      if (!planResult.rows || planResult.rows.length === 0) {
        throw new Error(`Plan not found: ${planId}`);
      }
      
      const plan = planResult.rows[0];
      const paddle_price_id = getPaddlePriceId(plan.plan_name);

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🏓 Creating Paddle Transaction (One-Time)');
      console.log(`   Plan: ${plan.plan_name}`);
      console.log(`   Price ID: ${paddle_price_id}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

      const requestBody = {
        items: [{ price_id: paddle_price_id, quantity: 1 }],
        custom_data: {
          user_id: user_id.toString(),
          plan_id: planId.toString(),
        },
        checkout: {
          settings: {
            success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}&status=success`,
          },
        },
      };

      const response = await axios.post(
        `${PADDLE_API_BASE}/transactions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const transaction = response.data.data;
      
      // ✅ FIX: Force correct checkout URL based on environment
      const isSandbox = PADDLE_API_BASE.includes('sandbox');
      const checkoutUrl = transaction.checkout?.url;

      // const checkoutUrl = isSandbox
      //   ? `https://sandbox-buy.paddle.com/checkout?_ptxn=${transaction.id}`
      //   : (transaction.checkout?.url || `https://buy.paddle.com/checkout?_ptxn=${transaction.id}`);

      console.log('✅ Transaction Created:');
      console.log(`   ID: ${transaction.id}`);
      console.log(`   Status: ${transaction.status}`);
      console.log(`   URL: ${checkoutUrl}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return {
        success: true,
        transaction_id: transaction.id,
        checkout_url: checkoutUrl,
        checkoutUrl: checkoutUrl,
        status: transaction.status,
      };
    } catch (error) {
      console.error('❌ Paddle Transaction Error:', error.response?.data || error.message);
      throw new Error(`Paddle transaction failed: ${error.response?.data?.error?.detail || error.message}`);
    }
  },

  /**
   * Create subscription (recurring payment)
   */
  createSubscription: async (data) => {
    try {
      const { user_id, email, planId } = data;

      if (!planId) {
        throw new Error('Plan ID is required');
      }

      const { subscriptionQueries } = await import('../models/subscriptionQueries.js');
      const planResult = await subscriptionQueries.getPlanById(planId);
      
      if (!planResult.rows || planResult.rows.length === 0) {
        throw new Error(`Plan not found: ${planId}`);
      }
      
      const plan = planResult.rows[0];
      const paddle_price_id = getPaddlePriceId(plan.plan_name);

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔄 Creating Paddle Subscription');
      console.log(`   Plan: ${plan.plan_name}`);
      console.log(`   Price ID: ${paddle_price_id}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

      const requestBody = {
  items: [{ price_id: paddle_price_id, quantity: 1 }],
  customer_email: email || `user${user_id}@votteryy.com`,  // ← ADD THIS
  custom_data: {
    user_id: user_id.toString(),
    plan_id: planId.toString(),
  },
  checkout: {
    settings: {
      success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}&status=success`,
    },
  },
};

      // const requestBody = {
      //   items: [{ price_id: paddle_price_id, quantity: 1 }],
      //   custom_data: {
      //     user_id: user_id.toString(),
      //     plan_id: planId.toString(),
      //   },
      //   checkout: {
      //     settings: {
      //       success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}&status=success`,
      //     },
      //   },
      // };

      console.log('📤 Request:', JSON.stringify(requestBody, null, 2));

      const response = await axios.post(
        `${PADDLE_API_BASE}/transactions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const transaction = response.data.data;
      
      // ✅ FIX: Force correct checkout URL based on environment
      const isSandbox = PADDLE_API_BASE.includes('sandbox');
      const checkoutUrl = isSandbox
        ? `https://sandbox-buy.paddle.com/checkout?_ptxn=${transaction.id}`
        : (transaction.checkout?.url || `https://buy.paddle.com/checkout?_ptxn=${transaction.id}`);

      console.log('✅ Subscription Created:');
      console.log(`   ID: ${transaction.id}`);
      console.log(`   Status: ${transaction.status}`);
      console.log(`   URL: ${checkoutUrl}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return {
        success: true,
        transaction_id: transaction.id,
        checkout_url: checkoutUrl,
        checkoutUrl: checkoutUrl,
        status: transaction.status,
      };
    } catch (error) {
      console.error('❌ Paddle Subscription Error:', error.response?.data || error.message);
      throw new Error(`Paddle subscription failed: ${error.response?.data?.error?.detail || error.message}`);
    }
  },

  getTransaction: async (transactionId) => {
    try {
      const response = await axios.get(
        `${PADDLE_API_BASE}/transactions/${transactionId}`,
        { headers: { 'Authorization': `Bearer ${config.PADDLE_API_KEY}` } }
      );
      return response.data.data;
    } catch (error) {
      console.error('Get transaction error:', error);
      throw error;
    }
  },

  verifyTransaction: async (transactionId) => {
    try {
      const transaction = await paddleService.getTransaction(transactionId);
      return {
        verified: transaction.status === 'completed',
        status: transaction.status,
        amount: transaction.details?.totals?.total,
        currency: transaction.currency_code,
      };
    } catch (error) {
      console.error('Verify transaction error:', error);
      throw error;
    }
  },

  cancelSubscription: async (subscriptionId) => {
    try {
      const response = await axios.post(
        `${PADDLE_API_BASE}/subscriptions/${subscriptionId}/cancel`,
        { effective_from: 'next_billing_period' },
        { headers: { 'Authorization': `Bearer ${config.PADDLE_API_KEY}`, 'Content-Type': 'application/json' } }
      );
      return { success: true, subscription: response.data.data };
    } catch (error) {
      console.error('Cancel subscription error:', error);
      throw error;
    }
  },

  verifyPayment: async (transactionId) => {
    return paddleService.verifyTransaction(transactionId);
  },

  createCheckout: async (data) => {
    console.warn('⚠️  createCheckout is deprecated');
    return paddleService.createTransaction(data);
  },
};


















// // backend/src/services/paddleService.js
// // Updated with return URLs

// import axios from 'axios';
// import { config } from '../config/env.js';

// const PADDLE_API_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://api.paddle.com'
//   : 'https://sandbox-api.paddle.com';

// // ✅ FIX: Separate checkout URL base for sandbox
// const PADDLE_CHECKOUT_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://buy.paddle.com/checkout'
//   : 'https://sandbox-buy.paddle.com/checkout';

// console.log('🔧 Paddle Configuration:');
// console.log('   Environment:', config.PADDLE_ENVIRONMENT || 'sandbox');
// console.log('   API Base:', PADDLE_API_BASE);
// console.log('   Checkout Base:', PADDLE_CHECKOUT_BASE);

// export const paddleService = {
//   /**
//    * Create transaction with return URLs
//    */
//   createTransaction: async (data) => {
//     try {
//       const { user_id, email, amount, currency, planId, paddle_price_id } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🏓 Creating Paddle Transaction (2025 API)');
//       console.log(`   Amount: ${amount} ${currency}`);
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // ✅ Set return URLs (where user goes after payment)
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           // ✅ REMOVED: customer_email - Let Paddle collect it at checkout
//           // This makes transaction status "ready" instead of "draft"
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           // ✅ ADD: Checkout settings with return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//               // Optional: Add cancel URL
//               // cancel_url: `${returnUrl}/pricing`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       // ✅ FIX: Always construct sandbox URL (don't trust Paddle's returned URL)
//       const isSandbox = PADDLE_API_BASE.includes('sandbox');
//       const checkoutUrl = isSandbox 
//         ? `https://sandbox-buy.paddle.com/checkout?_ptxn=${transaction.id}`
//         : (transaction.checkout?.url || `https://buy.paddle.com/checkout?_ptxn=${transaction.id}`);

//       console.log('✅ Paddle transaction created:', transaction.id);
//       console.log(`   Transaction status: ${transaction.status}`);
//       console.log(`   Is sandbox: ${isSandbox}`);
//       console.log(`   Paddle returned URL: ${transaction.checkout?.url}`);
//       console.log(`   Final checkout URL: ${checkoutUrl}`);
      
//       // ⚠️ Warn if transaction is still in draft
//       if (transaction.status === 'draft') {
//         console.log('⚠️  Transaction is in draft status - checkout may not load immediately');
//       }

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: checkoutUrl,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle transaction creation error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Create subscription (recurring payment)
//    */
//   createSubscription: async (data) => {
//     try {
//       const { user_id, email, paddle_price_id, planId } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🔄 Creating Paddle Subscription');
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // ✅ CHANGED: Don't create customer upfront - let Paddle handle it at checkout
//       // This makes the transaction "ready" instead of "draft"

//       // Create transaction for subscription
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           // ✅ REMOVED: customer_id - Let Paddle collect customer info at checkout
//           // customer_email can be added to pre-fill the form (optional)
//           // customer_email: email,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           // ✅ REMOVED: billing_details (not needed - price already defines recurring)
//           // ✅ ADD: Return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       // ✅ FIX: Always construct sandbox URL (don't trust Paddle's returned URL)
//       const isSandbox = PADDLE_API_BASE.includes('sandbox');
//       const checkoutUrl = isSandbox 
//         ? `https://sandbox-buy.paddle.com/checkout?_ptxn=${transaction.id}`
//         : (transaction.checkout?.url || `https://buy.paddle.com/checkout?_ptxn=${transaction.id}`);

//       console.log('✅ Paddle subscription transaction created');
//       console.log(`   Transaction ID: ${transaction.id}`);
//       console.log(`   Transaction status: ${transaction.status}`);
//       console.log(`   Is sandbox: ${isSandbox}`);
//       console.log(`   Paddle returned URL: ${transaction.checkout?.url}`);
//       console.log(`   Final checkout URL: ${checkoutUrl}`);
      
//       // ⚠️ Warn if transaction is still in draft
//       if (transaction.status === 'draft') {
//         console.log('⚠️  Transaction is in draft status - checkout may not load immediately');
//       }

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: checkoutUrl,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle subscription error:', error.response?.data || error.message);
      
//       // ✅ Log detailed error information
//       if (error.response?.data?.error?.errors) {
//         console.error('📋 Detailed errors:', JSON.stringify(error.response.data.error.errors, null, 2));
//       }
      
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Get transaction details
//    */
//   getTransaction: async (transactionId) => {
//     try {
//       const response = await axios.get(
//         `${PADDLE_API_BASE}/transactions/${transactionId}`,
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//           },
//         }
//       );

//       return response.data.data;
//     } catch (error) {
//       console.error('Get transaction error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Cancel subscription
//    */
//   cancelSubscription: async (subscriptionId) => {
//     try {
//       console.log(`🛑 Canceling Paddle subscription: ${subscriptionId}`);

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/subscriptions/${subscriptionId}/cancel`,
//         {
//           effective_from: 'next_billing_period',
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       console.log('✅ Subscription canceled');

//       return {
//         success: true,
//         subscription: response.data.data,
//       };
//     } catch (error) {
//       console.error('Cancel subscription error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Verify payment
//    */
//   verifyPayment: async (transactionId) => {
//     try {
//       const transaction = await paddleService.getTransaction(transactionId);

//       return {
//         verified: transaction.status === 'completed',
//         status: transaction.status,
//         amount: transaction.details.totals.total,
//         currency: transaction.currency_code,
//       };
//     } catch (error) {
//       console.error('Verify payment error:', error);
//       throw error;
//     }
//   },

//   /**
//    * OLD METHOD (Deprecated)
//    */
//   createCheckout: async (data) => {
//     console.warn('⚠️  createCheckout is deprecated, use createTransaction instead');
//     return paddleService.createTransaction(data);
//   },
// };
// // backend/src/services/paddleService.js
// // Updated with return URLs

// import axios from 'axios';
// import { config } from '../config/env.js';

// const PADDLE_API_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://api.paddle.com'
//   : 'https://sandbox-api.paddle.com';

// // ✅ FIX: Separate checkout URL base for sandbox
// const PADDLE_CHECKOUT_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://buy.paddle.com/checkout'
//   : 'https://sandbox-buy.paddle.com/checkout';

// console.log('🔧 Paddle Configuration:');
// console.log('   Environment:', config.PADDLE_ENVIRONMENT || 'sandbox');
// console.log('   API Base:', PADDLE_API_BASE);
// console.log('   Checkout Base:', PADDLE_CHECKOUT_BASE);

// export const paddleService = {
//   /**
//    * Create transaction with return URLs
//    */
//   createTransaction: async (data) => {
//     try {
//       const { user_id, email, amount, currency, planId, paddle_price_id } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🏓 Creating Paddle Transaction (2025 API)');
//       console.log(`   Amount: ${amount} ${currency}`);
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // ✅ Set return URLs (where user goes after payment)
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           // ✅ REMOVED: customer_email - Let Paddle collect it at checkout
//           // This makes transaction status "ready" instead of "draft"
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           // ✅ ADD: Checkout settings with return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//               // Optional: Add cancel URL
//               // cancel_url: `${returnUrl}/pricing`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       // ✅ FIX: Always construct sandbox URL (don't trust Paddle's returned URL)
//       const isSandbox = PADDLE_API_BASE.includes('sandbox');
//       const checkoutUrl = isSandbox 
//         ? `https://sandbox-buy.paddle.com/checkout?_ptxn=${transaction.id}`
//         : (transaction.checkout?.url || `https://buy.paddle.com/checkout?_ptxn=${transaction.id}`);

//       console.log('✅ Paddle transaction created:', transaction.id);
//       console.log(`   Transaction status: ${transaction.status}`);
//       console.log(`   Is sandbox: ${isSandbox}`);
//       console.log(`   Paddle returned URL: ${transaction.checkout?.url}`);
//       console.log(`   Final checkout URL: ${checkoutUrl}`);
      
//       // ⚠️ Warn if transaction is still in draft
//       if (transaction.status === 'draft') {
//         console.log('⚠️  Transaction is in draft status - checkout may not load immediately');
//       }

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: checkoutUrl,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle transaction creation error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Create subscription (recurring payment)
//    */
//   createSubscription: async (data) => {
//     try {
//       const { user_id, email, paddle_price_id, planId } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🔄 Creating Paddle Subscription');
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Get or create customer
//       let customerId;
//       try {
//         const customerResponse = await axios.post(
//           `${PADDLE_API_BASE}/customers`,
//           {
//             email: email,
//             custom_data: {
//               user_id: user_id.toString(),
//             },
//           },
//           {
//             headers: {
//               'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               'Content-Type': 'application/json',
//             },
//           }
//         );
//         customerId = customerResponse.data.data.id;
//         console.log('✅ Customer created:', customerId);
//       } catch (error) {
//         if (error.response?.status === 409) {
//           const searchResponse = await axios.get(
//             `${PADDLE_API_BASE}/customers?email=${encodeURIComponent(email)}`,
//             {
//               headers: {
//                 'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               },
//             }
//           );
//           customerId = searchResponse.data.data[0]?.id;
//           console.log('✅ Using existing customer:', customerId);
//         } else {
//           throw error;
//         }
//       }

//       // Create transaction for subscription
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           customer_id: customerId,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           // ✅ REMOVED: billing_details (not needed - price already defines recurring)
//           // ✅ ADD: Return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       // ✅ FIX: Always construct sandbox URL (don't trust Paddle's returned URL)
//       const isSandbox = PADDLE_API_BASE.includes('sandbox');
//       const checkoutUrl = isSandbox 
//         ? `https://sandbox-buy.paddle.com/checkout?_ptxn=${transaction.id}`
//         : (transaction.checkout?.url || `https://buy.paddle.com/checkout?_ptxn=${transaction.id}`);

//       console.log('✅ Paddle subscription transaction created');
//       console.log(`   Transaction ID: ${transaction.id}`);
//       console.log(`   Transaction status: ${transaction.status}`);
//       console.log(`   Is sandbox: ${isSandbox}`);
//       console.log(`   Paddle returned URL: ${transaction.checkout?.url}`);
//       console.log(`   Final checkout URL: ${checkoutUrl}`);
      
//       // ⚠️ Warn if transaction is still in draft
//       if (transaction.status === 'draft') {
//         console.log('⚠️  Transaction is in draft status - checkout may not load immediately');
//       }

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: checkoutUrl,
//         customer_id: customerId,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle subscription error:', error.response?.data || error.message);
      
//       // ✅ Log detailed error information
//       if (error.response?.data?.error?.errors) {
//         console.error('📋 Detailed errors:', JSON.stringify(error.response.data.error.errors, null, 2));
//       }
      
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Get transaction details
//    */
//   getTransaction: async (transactionId) => {
//     try {
//       const response = await axios.get(
//         `${PADDLE_API_BASE}/transactions/${transactionId}`,
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//           },
//         }
//       );

//       return response.data.data;
//     } catch (error) {
//       console.error('Get transaction error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Cancel subscription
//    */
//   cancelSubscription: async (subscriptionId) => {
//     try {
//       console.log(`🛑 Canceling Paddle subscription: ${subscriptionId}`);

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/subscriptions/${subscriptionId}/cancel`,
//         {
//           effective_from: 'next_billing_period',
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       console.log('✅ Subscription canceled');

//       return {
//         success: true,
//         subscription: response.data.data,
//       };
//     } catch (error) {
//       console.error('Cancel subscription error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Verify payment
//    */
//   verifyPayment: async (transactionId) => {
//     try {
//       const transaction = await paddleService.getTransaction(transactionId);

//       return {
//         verified: transaction.status === 'completed',
//         status: transaction.status,
//         amount: transaction.details.totals.total,
//         currency: transaction.currency_code,
//       };
//     } catch (error) {
//       console.error('Verify payment error:', error);
//       throw error;
//     }
//   },

//   /**
//    * OLD METHOD (Deprecated)
//    */
//   createCheckout: async (data) => {
//     console.warn('⚠️  createCheckout is deprecated, use createTransaction instead');
//     return paddleService.createTransaction(data);
//   },
// };
// // backend/src/services/paddleService.js
// // Updated with return URLs

// import axios from 'axios';
// import { config } from '../config/env.js';

// const PADDLE_API_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://api.paddle.com'
//   : 'https://sandbox-api.paddle.com';

// // ✅ FIX: Separate checkout URL base for sandbox
// const PADDLE_CHECKOUT_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://buy.paddle.com/checkout'
//   : 'https://sandbox-buy.paddle.com/checkout';

// console.log('🔧 Paddle Configuration:');
// console.log('   Environment:', config.PADDLE_ENVIRONMENT || 'sandbox');
// console.log('   API Base:', PADDLE_API_BASE);
// console.log('   Checkout Base:', PADDLE_CHECKOUT_BASE);

// export const paddleService = {
//   /**
//    * Create transaction with return URLs
//    */
//   createTransaction: async (data) => {
//     try {
//       const { user_id, email, amount, currency, planId, paddle_price_id } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🏓 Creating Paddle Transaction (2025 API)');
//       console.log(`   Amount: ${amount} ${currency}`);
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // ✅ Set return URLs (where user goes after payment)
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           // ✅ REMOVED: customer_email - Let Paddle collect it at checkout
//           // This makes transaction status "ready" instead of "draft"
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           // ✅ ADD: Checkout settings with return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//               // Optional: Add cancel URL
//               // cancel_url: `${returnUrl}/pricing`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       // ✅ FIX: Always construct sandbox URL (don't trust Paddle's returned URL)
//       const isSandbox = PADDLE_API_BASE.includes('sandbox');
//       const checkoutUrl = isSandbox 
//         ? `https://sandbox-buy.paddle.com/checkout?_ptxn=${transaction.id}`
//         : (transaction.checkout?.url || `https://buy.paddle.com/checkout?_ptxn=${transaction.id}`);

//       console.log('✅ Paddle transaction created:', transaction.id);
//       console.log(`   Transaction status: ${transaction.status}`);
//       console.log(`   Is sandbox: ${isSandbox}`);
//       console.log(`   Paddle returned URL: ${transaction.checkout?.url}`);
//       console.log(`   Final checkout URL: ${checkoutUrl}`);
      
//       // ⚠️ Warn if transaction is still in draft
//       if (transaction.status === 'draft') {
//         console.log('⚠️  Transaction is in draft status - checkout may not load immediately');
//       }

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: checkoutUrl,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle transaction creation error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Create subscription (recurring payment)
//    */
//   createSubscription: async (data) => {
//     try {
//       const { user_id, email, paddle_price_id, planId } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🔄 Creating Paddle Subscription');
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Get or create customer
//       let customerId;
//       try {
//         const customerResponse = await axios.post(
//           `${PADDLE_API_BASE}/customers`,
//           {
//             email: email,
//             custom_data: {
//               user_id: user_id.toString(),
//             },
//           },
//           {
//             headers: {
//               'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               'Content-Type': 'application/json',
//             },
//           }
//         );
//         customerId = customerResponse.data.data.id;
//         console.log('✅ Customer created:', customerId);
//       } catch (error) {
//         if (error.response?.status === 409) {
//           const searchResponse = await axios.get(
//             `${PADDLE_API_BASE}/customers?email=${encodeURIComponent(email)}`,
//             {
//               headers: {
//                 'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               },
//             }
//           );
//           customerId = searchResponse.data.data[0]?.id;
//           console.log('✅ Using existing customer:', customerId);
//         } else {
//           throw error;
//         }
//       }

//       // Create transaction for subscription
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           customer_id: customerId,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           billing_details: {
//             enable_checkout: true,
//             payment_terms: {
//               interval: 'month',
//             },
//           },
//           // ✅ ADD: Return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       // ✅ FIX: Always construct sandbox URL (don't trust Paddle's returned URL)
//       const isSandbox = PADDLE_API_BASE.includes('sandbox');
//       const checkoutUrl = isSandbox 
//         ? `https://sandbox-buy.paddle.com/checkout?_ptxn=${transaction.id}`
//         : (transaction.checkout?.url || `https://buy.paddle.com/checkout?_ptxn=${transaction.id}`);

//       console.log('✅ Paddle subscription transaction created');
//       console.log(`   Transaction ID: ${transaction.id}`);
//       console.log(`   Transaction status: ${transaction.status}`);
//       console.log(`   Is sandbox: ${isSandbox}`);
//       console.log(`   Paddle returned URL: ${transaction.checkout?.url}`);
//       console.log(`   Final checkout URL: ${checkoutUrl}`);
      
//       // ⚠️ Warn if transaction is still in draft
//       if (transaction.status === 'draft') {
//         console.log('⚠️  Transaction is in draft status - checkout may not load immediately');
//       }

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: checkoutUrl,
//         customer_id: customerId,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle subscription error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Get transaction details
//    */
//   getTransaction: async (transactionId) => {
//     try {
//       const response = await axios.get(
//         `${PADDLE_API_BASE}/transactions/${transactionId}`,
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//           },
//         }
//       );

//       return response.data.data;
//     } catch (error) {
//       console.error('Get transaction error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Cancel subscription
//    */
//   cancelSubscription: async (subscriptionId) => {
//     try {
//       console.log(`🛑 Canceling Paddle subscription: ${subscriptionId}`);

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/subscriptions/${subscriptionId}/cancel`,
//         {
//           effective_from: 'next_billing_period',
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       console.log('✅ Subscription canceled');

//       return {
//         success: true,
//         subscription: response.data.data,
//       };
//     } catch (error) {
//       console.error('Cancel subscription error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Verify payment
//    */
//   verifyPayment: async (transactionId) => {
//     try {
//       const transaction = await paddleService.getTransaction(transactionId);

//       return {
//         verified: transaction.status === 'completed',
//         status: transaction.status,
//         amount: transaction.details.totals.total,
//         currency: transaction.currency_code,
//       };
//     } catch (error) {
//       console.error('Verify payment error:', error);
//       throw error;
//     }
//   },

//   /**
//    * OLD METHOD (Deprecated)
//    */
//   createCheckout: async (data) => {
//     console.warn('⚠️  createCheckout is deprecated, use createTransaction instead');
//     return paddleService.createTransaction(data);
//   },
// };
// // backend/src/services/paddleService.js
// // Updated with return URLs

// import axios from 'axios';
// import { config } from '../config/env.js';

// const PADDLE_API_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://api.paddle.com'
//   : 'https://sandbox-api.paddle.com';

// // ✅ FIX: Separate checkout URL base for sandbox
// const PADDLE_CHECKOUT_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://buy.paddle.com/checkout'
//   : 'https://sandbox-buy.paddle.com/checkout';

// console.log('🔧 Paddle Configuration:');
// console.log('   Environment:', config.PADDLE_ENVIRONMENT || 'sandbox');
// console.log('   API Base:', PADDLE_API_BASE);
// console.log('   Checkout Base:', PADDLE_CHECKOUT_BASE);

// export const paddleService = {
//   /**
//    * Create transaction with return URLs
//    */
//   createTransaction: async (data) => {
//     try {
//       const { user_id, email, amount, currency, planId, paddle_price_id } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🏓 Creating Paddle Transaction (2025 API)');
//       console.log(`   Amount: ${amount} ${currency}`);
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // ✅ Set return URLs (where user goes after payment)
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           customer_email: email,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           // ✅ ADD: Checkout settings with return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//               // Optional: Add cancel URL
//               // cancel_url: `${returnUrl}/pricing`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       // ✅ FIX: Force sandbox URL (Paddle returns wrong URL sometimes)
//       let checkoutUrl;
//       if (config.PADDLE_ENVIRONMENT === 'sandbox') {
//         // Always use sandbox URL in sandbox mode
//         checkoutUrl = `https://sandbox-buy.paddle.com/checkout?_ptxn=${transaction.id}`;
//       } else {
//         // Use Paddle's returned URL in production
//         checkoutUrl = transaction.checkout?.url || `https://buy.paddle.com/checkout?_ptxn=${transaction.id}`;
//       }

//       console.log('✅ Paddle transaction created:', transaction.id);
//       console.log(`   Transaction status: ${transaction.status}`);
//       console.log(`   Paddle returned URL: ${transaction.checkout?.url}`);
//       console.log(`   Forced checkout URL: ${checkoutUrl}`);
      
//       // ⚠️ Warn if transaction is still in draft
//       if (transaction.status === 'draft') {
//         console.log('⚠️  Transaction is in draft status - checkout may not load immediately');
//       }

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: checkoutUrl,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle transaction creation error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Create subscription (recurring payment)
//    */
//   createSubscription: async (data) => {
//     try {
//       const { user_id, email, paddle_price_id, planId } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🔄 Creating Paddle Subscription');
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Get or create customer
//       let customerId;
//       try {
//         const customerResponse = await axios.post(
//           `${PADDLE_API_BASE}/customers`,
//           {
//             email: email,
//             custom_data: {
//               user_id: user_id.toString(),
//             },
//           },
//           {
//             headers: {
//               'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               'Content-Type': 'application/json',
//             },
//           }
//         );
//         customerId = customerResponse.data.data.id;
//         console.log('✅ Customer created:', customerId);
//       } catch (error) {
//         if (error.response?.status === 409) {
//           const searchResponse = await axios.get(
//             `${PADDLE_API_BASE}/customers?email=${encodeURIComponent(email)}`,
//             {
//               headers: {
//                 'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               },
//             }
//           );
//           customerId = searchResponse.data.data[0]?.id;
//           console.log('✅ Using existing customer:', customerId);
//         } else {
//           throw error;
//         }
//       }

//       // Create transaction for subscription
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           customer_id: customerId,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           billing_details: {
//             enable_checkout: true,
//             payment_terms: {
//               interval: 'month',
//             },
//           },
//           // ✅ ADD: Return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       // ✅ FIX: Force sandbox URL (Paddle returns wrong URL sometimes)
//       let checkoutUrl;
//       if (config.PADDLE_ENVIRONMENT === 'sandbox') {
//         // Always use sandbox URL in sandbox mode
//         checkoutUrl = `https://sandbox-buy.paddle.com/checkout?_ptxn=${transaction.id}`;
//       } else {
//         // Use Paddle's returned URL in production
//         checkoutUrl = transaction.checkout?.url || `https://buy.paddle.com/checkout?_ptxn=${transaction.id}`;
//       }

//       console.log('✅ Paddle subscription transaction created');
//       console.log(`   Transaction ID: ${transaction.id}`);
//       console.log(`   Transaction status: ${transaction.status}`);
//       console.log(`   Paddle returned URL: ${transaction.checkout?.url}`);
//       console.log(`   Forced checkout URL: ${checkoutUrl}`);
      
//       // ⚠️ Warn if transaction is still in draft
//       if (transaction.status === 'draft') {
//         console.log('⚠️  Transaction is in draft status - checkout may not load immediately');
//       }

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: checkoutUrl,
//         customer_id: customerId,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle subscription error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Get transaction details
//    */
//   getTransaction: async (transactionId) => {
//     try {
//       const response = await axios.get(
//         `${PADDLE_API_BASE}/transactions/${transactionId}`,
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//           },
//         }
//       );

//       return response.data.data;
//     } catch (error) {
//       console.error('Get transaction error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Cancel subscription
//    */
//   cancelSubscription: async (subscriptionId) => {
//     try {
//       console.log(`🛑 Canceling Paddle subscription: ${subscriptionId}`);

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/subscriptions/${subscriptionId}/cancel`,
//         {
//           effective_from: 'next_billing_period',
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       console.log('✅ Subscription canceled');

//       return {
//         success: true,
//         subscription: response.data.data,
//       };
//     } catch (error) {
//       console.error('Cancel subscription error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Verify payment
//    */
//   verifyPayment: async (transactionId) => {
//     try {
//       const transaction = await paddleService.getTransaction(transactionId);

//       return {
//         verified: transaction.status === 'completed',
//         status: transaction.status,
//         amount: transaction.details.totals.total,
//         currency: transaction.currency_code,
//       };
//     } catch (error) {
//       console.error('Verify payment error:', error);
//       throw error;
//     }
//   },

//   /**
//    * OLD METHOD (Deprecated)
//    */
//   createCheckout: async (data) => {
//     console.warn('⚠️  createCheckout is deprecated, use createTransaction instead');
//     return paddleService.createTransaction(data);
//   },
// };
// // backend/src/services/paddleService.js
// // Updated with return URLs

// import axios from 'axios';
// import { config } from '../config/env.js';

// const PADDLE_API_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://api.paddle.com'
//   : 'https://sandbox-api.paddle.com';

// // ✅ FIX: Separate checkout URL base for sandbox
// const PADDLE_CHECKOUT_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://buy.paddle.com/checkout'
//   : 'https://sandbox-buy.paddle.com/checkout';

// console.log('🔧 Paddle Configuration:');
// console.log('   Environment:', config.PADDLE_ENVIRONMENT || 'sandbox');
// console.log('   API Base:', PADDLE_API_BASE);
// console.log('   Checkout Base:', PADDLE_CHECKOUT_BASE);

// export const paddleService = {
//   /**
//    * Create transaction with return URLs
//    */
//   createTransaction: async (data) => {
//     try {
//       const { user_id, email, amount, currency, planId, paddle_price_id } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🏓 Creating Paddle Transaction (2025 API)');
//       console.log(`   Amount: ${amount} ${currency}`);
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // ✅ Set return URLs (where user goes after payment)
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           customer_email: email,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           // ✅ ADD: Checkout settings with return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//               // Optional: Add cancel URL
//               // cancel_url: `${returnUrl}/pricing`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       // ✅ FIX: Use Paddle's returned checkout URL (it's more reliable)
//       const checkoutUrl = transaction.checkout?.url || `${PADDLE_CHECKOUT_BASE}?_ptxn=${transaction.id}`;

//       console.log('✅ Paddle transaction created:', transaction.id);
//       console.log(`   Transaction status: ${transaction.status}`);
//       console.log(`   Paddle returned URL: ${transaction.checkout?.url}`);
//       console.log(`   Final checkout URL: ${checkoutUrl}`);

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: checkoutUrl,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle transaction creation error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Create subscription (recurring payment)
//    */
//   createSubscription: async (data) => {
//     try {
//       const { user_id, email, paddle_price_id, planId } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🔄 Creating Paddle Subscription');
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Get or create customer
//       let customerId;
//       try {
//         const customerResponse = await axios.post(
//           `${PADDLE_API_BASE}/customers`,
//           {
//             email: email,
//             custom_data: {
//               user_id: user_id.toString(),
//             },
//           },
//           {
//             headers: {
//               'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               'Content-Type': 'application/json',
//             },
//           }
//         );
//         customerId = customerResponse.data.data.id;
//         console.log('✅ Customer created:', customerId);
//       } catch (error) {
//         if (error.response?.status === 409) {
//           const searchResponse = await axios.get(
//             `${PADDLE_API_BASE}/customers?email=${encodeURIComponent(email)}`,
//             {
//               headers: {
//                 'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               },
//             }
//           );
//           customerId = searchResponse.data.data[0]?.id;
//           console.log('✅ Using existing customer:', customerId);
//         } else {
//           throw error;
//         }
//       }

//       // Create transaction for subscription
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           customer_id: customerId,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           billing_details: {
//             enable_checkout: true,
//             payment_terms: {
//               interval: 'month',
//             },
//           },
//           // ✅ ADD: Return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       // ✅ FIX: Use Paddle's returned checkout URL (it's more reliable)
//       const checkoutUrl = transaction.checkout?.url || `${PADDLE_CHECKOUT_BASE}?_ptxn=${transaction.id}`;

//       console.log('✅ Paddle subscription transaction created');
//       console.log(`   Transaction ID: ${transaction.id}`);
//       console.log(`   Transaction status: ${transaction.status}`);
//       console.log(`   Paddle returned URL: ${transaction.checkout?.url}`);
//       console.log(`   Final checkout URL: ${checkoutUrl}`);

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: checkoutUrl,
//         customer_id: customerId,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle subscription error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Get transaction details
//    */
//   getTransaction: async (transactionId) => {
//     try {
//       const response = await axios.get(
//         `${PADDLE_API_BASE}/transactions/${transactionId}`,
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//           },
//         }
//       );

//       return response.data.data;
//     } catch (error) {
//       console.error('Get transaction error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Cancel subscription
//    */
//   cancelSubscription: async (subscriptionId) => {
//     try {
//       console.log(`🛑 Canceling Paddle subscription: ${subscriptionId}`);

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/subscriptions/${subscriptionId}/cancel`,
//         {
//           effective_from: 'next_billing_period',
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       console.log('✅ Subscription canceled');

//       return {
//         success: true,
//         subscription: response.data.data,
//       };
//     } catch (error) {
//       console.error('Cancel subscription error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Verify payment
//    */
//   verifyPayment: async (transactionId) => {
//     try {
//       const transaction = await paddleService.getTransaction(transactionId);

//       return {
//         verified: transaction.status === 'completed',
//         status: transaction.status,
//         amount: transaction.details.totals.total,
//         currency: transaction.currency_code,
//       };
//     } catch (error) {
//       console.error('Verify payment error:', error);
//       throw error;
//     }
//   },

//   /**
//    * OLD METHOD (Deprecated)
//    */
//   createCheckout: async (data) => {
//     console.warn('⚠️  createCheckout is deprecated, use createTransaction instead');
//     return paddleService.createTransaction(data);
//   },
// };

//last workbale codes
// // backend/src/services/paddleService.js
// // Updated with return URLs

// import axios from 'axios';
// import { config } from '../config/env.js';

// const PADDLE_API_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://api.paddle.com'
//   : 'https://sandbox-api.paddle.com';

// export const paddleService = {
//   /**
//    * Create transaction with return URLs
//    */
//   createTransaction: async (data) => {
//     try {
//       const { user_id, email, amount, currency, planId, paddle_price_id } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🏓 Creating Paddle Transaction (2025 API)');
//       console.log(`   Amount: ${amount} ${currency}`);
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // ✅ Set return URLs (where user goes after payment)
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           customer_email: email,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           // ✅ ADD: Checkout settings with return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//               // Optional: Add cancel URL
//               // cancel_url: `${returnUrl}/pricing`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       console.log('✅ Paddle transaction created:', transaction.id);
//       console.log(`   Checkout URL: ${transaction.checkout?.url}`);

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: transaction.checkout?.url,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle transaction creation error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Create subscription (recurring payment)
//    */
//   createSubscription: async (data) => {
//     try {
//       const { user_id, email, paddle_price_id, planId } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🔄 Creating Paddle Subscription');
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Get or create customer
//       let customerId;
//       try {
//         const customerResponse = await axios.post(
//           `${PADDLE_API_BASE}/customers`,
//           {
//             email: email,
//             custom_data: {
//               user_id: user_id.toString(),
//             },
//           },
//           {
//             headers: {
//               'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               'Content-Type': 'application/json',
//             },
//           }
//         );
//         customerId = customerResponse.data.data.id;
//         console.log('✅ Customer created:', customerId);
//       } catch (error) {
//         if (error.response?.status === 409) {
//           const searchResponse = await axios.get(
//             `${PADDLE_API_BASE}/customers?email=${encodeURIComponent(email)}`,
//             {
//               headers: {
//                 'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               },
//             }
//           );
//           customerId = searchResponse.data.data[0]?.id;
//           console.log('✅ Using existing customer:', customerId);
//         } else {
//           throw error;
//         }
//       }

//       // Create transaction for subscription
//       const returnUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           customer_id: customerId,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           billing_details: {
//             enable_checkout: true,
//             payment_terms: {
//               interval: 'month',
//             },
//           },
//           // ✅ ADD: Return URLs
//           checkout: {
//             settings: {
//               success_url: `${returnUrl}/payment/callback?gateway=paddle&plan_id=${planId}`,
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       console.log('✅ Paddle subscription transaction created');
//       console.log(`   Transaction ID: ${transaction.id}`);
//       console.log(`   Checkout URL: ${transaction.checkout?.url}`);

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: transaction.checkout?.url,
//         customer_id: customerId,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle subscription error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Get transaction details
//    */
//   getTransaction: async (transactionId) => {
//     try {
//       const response = await axios.get(
//         `${PADDLE_API_BASE}/transactions/${transactionId}`,
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//           },
//         }
//       );

//       return response.data.data;
//     } catch (error) {
//       console.error('Get transaction error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Cancel subscription
//    */
//   cancelSubscription: async (subscriptionId) => {
//     try {
//       console.log(`🛑 Canceling Paddle subscription: ${subscriptionId}`);

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/subscriptions/${subscriptionId}/cancel`,
//         {
//           effective_from: 'next_billing_period',
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       console.log('✅ Subscription canceled');

//       return {
//         success: true,
//         subscription: response.data.data,
//       };
//     } catch (error) {
//       console.error('Cancel subscription error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Verify payment
//    */
//   verifyPayment: async (transactionId) => {
//     try {
//       const transaction = await paddleService.getTransaction(transactionId);

//       return {
//         verified: transaction.status === 'completed',
//         status: transaction.status,
//         amount: transaction.details.totals.total,
//         currency: transaction.currency_code,
//       };
//     } catch (error) {
//       console.error('Verify payment error:', error);
//       throw error;
//     }
//   },

//   /**
//    * OLD METHOD (Deprecated)
//    */
//   createCheckout: async (data) => {
//     console.warn('⚠️  createCheckout is deprecated, use createTransaction instead');
//     return paddleService.createTransaction(data);
//   },
// };
// // backend/src/services/paddleService.js
// // Updated for Paddle Billing API (2025) - NOT Classic API

// import axios from 'axios';
// import { config } from '../config/env.js';

// // Paddle Billing API Base URL
// const PADDLE_API_BASE = config.PADDLE_ENVIRONMENT === 'production'
//   ? 'https://api.paddle.com'
//   : 'https://sandbox-api.paddle.com';

// export const paddleService = {
//   /**
//    * Create transaction (replaces old "checkout")
//    * Paddle Billing API 2025
//    */
//   createTransaction: async (data) => {
//     try {
//       const { user_id, email, amount, currency, planId, paddle_price_id } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🏓 Creating Paddle Transaction (2025 API)');
//       console.log(`   Amount: ${amount} ${currency}`);
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Create transaction using Paddle Billing API
//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           customer_email: email,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       console.log('✅ Paddle transaction created:', transaction.id);
//       console.log(`   Checkout URL: ${transaction.checkout?.url}`);

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: transaction.checkout?.url,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle transaction creation error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Create subscription (recurring payment)
//    * Paddle Billing API 2025
//    */
//   createSubscription: async (data) => {
//     try {
//       const { user_id, email, paddle_price_id, planId } = data;

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('🔄 Creating Paddle Subscription');
//       console.log(`   Email: ${email}`);
//       console.log(`   Price ID: ${paddle_price_id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Step 1: Get or create customer
//       let customerId;
//       try {
//         const customerResponse = await axios.post(
//           `${PADDLE_API_BASE}/customers`,
//           {
//             email: email,
//             custom_data: {
//               user_id: user_id.toString(),
//             },
//           },
//           {
//             headers: {
//               'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               'Content-Type': 'application/json',
//             },
//           }
//         );
//         customerId = customerResponse.data.data.id;
//         console.log('✅ Customer created:', customerId);
//       } catch (error) {
//         // Customer might already exist
//         if (error.response?.status === 409) {
//           // Get existing customer by email
//           const searchResponse = await axios.get(
//             `${PADDLE_API_BASE}/customers?email=${encodeURIComponent(email)}`,
//             {
//               headers: {
//                 'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//               },
//             }
//           );
//           customerId = searchResponse.data.data[0]?.id;
//           console.log('✅ Using existing customer:', customerId);
//         } else {
//           throw error;
//         }
//       }

//       // Step 2: Create transaction for subscription
//       const response = await axios.post(
//         `${PADDLE_API_BASE}/transactions`,
//         {
//           items: [
//             {
//               price_id: paddle_price_id,
//               quantity: 1,
//             },
//           ],
//           customer_id: customerId,
//           custom_data: {
//             user_id: user_id.toString(),
//             plan_id: planId?.toString(),
//           },
//           billing_details: {
//             enable_checkout: true,
//             payment_terms: {
//               interval: 'month',
//             },
//           },
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       const transaction = response.data.data;

//       console.log('✅ Paddle subscription transaction created');
//       console.log(`   Transaction ID: ${transaction.id}`);
//       console.log(`   Checkout URL: ${transaction.checkout?.url}`);

//       return {
//         success: true,
//         transaction_id: transaction.id,
//         checkout_url: transaction.checkout?.url,
//         customer_id: customerId,
//         status: transaction.status,
//       };
//     } catch (error) {
//       console.error('❌ Paddle subscription error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.response?.data?.error?.detail || error.message}`);
//     }
//   },

//   /**
//    * Get transaction details
//    */
//   getTransaction: async (transactionId) => {
//     try {
//       const response = await axios.get(
//         `${PADDLE_API_BASE}/transactions/${transactionId}`,
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//           },
//         }
//       );

//       return response.data.data;
//     } catch (error) {
//       console.error('Get transaction error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Cancel subscription
//    */
//   cancelSubscription: async (subscriptionId) => {
//     try {
//       console.log(`🛑 Canceling Paddle subscription: ${subscriptionId}`);

//       const response = await axios.post(
//         `${PADDLE_API_BASE}/subscriptions/${subscriptionId}/cancel`,
//         {
//           effective_from: 'next_billing_period',
//         },
//         {
//           headers: {
//             'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );

//       console.log('✅ Subscription canceled');

//       return {
//         success: true,
//         subscription: response.data.data,
//       };
//     } catch (error) {
//       console.error('Cancel subscription error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   /**
//    * Verify payment
//    */
//   verifyPayment: async (transactionId) => {
//     try {
//       const transaction = await paddleService.getTransaction(transactionId);

//       return {
//         verified: transaction.status === 'completed',
//         status: transaction.status,
//         amount: transaction.details.totals.total,
//         currency: transaction.currency_code,
//       };
//     } catch (error) {
//       console.error('Verify payment error:', error);
//       throw error;
//     }
//   },

//   /**
//    * OLD METHOD (Deprecated - kept for compatibility)
//    * @deprecated Use createTransaction instead
//    */
//   createCheckout: async (data) => {
//     console.warn('⚠️  createCheckout is deprecated, use createTransaction instead');
//     return paddleService.createTransaction(data);
//   },
// };
// import axios from 'axios';
// import { paddleAPI } from '../config/gateways.js';
// import { paymentQueries } from '../models/paymentQueries.js';

// export const paddleService = {
//   createCheckout: async (data) => {
//     try {
//       const { amount, currency, user_id, country_code, region } = data;

//       const response = await axios.post(
//         `${paddleAPI.baseURL}/checkout`,
//         {
//           items: [
//             {
//               quantity: 1,
//               unitPrice: {
//                 amount: amount.toString(),
//                 currencyCode: currency,
//               },
//             },
//           ],
//           customData: {
//             user_id,
//             country_code,
//             region,
//           },
//         },
//         { headers: paddleAPI.headers }
//       );

//       const checkoutData = response.data.data;

//       await paymentQueries.recordPayment({
//         user_id,
//         amount,
//         currency,
//         gateway: 'paddle',
//         external_payment_id: checkoutData.id,
//         status: 'pending',
//         payment_method: 'card',
//         region,
//         country_code,
//         metadata: { checkout_id: checkoutData.id },
//       });

//       return {
//         checkoutId: checkoutData.id,
//         checkoutUrl: checkoutData.urls.checkout,
//       };
//     } catch (error) {
//       console.error('Paddle checkout error:', error.response?.data || error.message);
//       throw new Error(`Paddle error: ${error.message}`);
//     }
//   },

//   createSubscription: async (data) => {
//     try {
//       const { customerId, priceId, user_id, country_code, region } = data;

//       const response = await axios.post(
//         `${paddleAPI.baseURL}/subscriptions`,
//         {
//           customerId,
//           items: [
//             {
//               priceId,
//               quantity: 1,
//             },
//           ],
//           customData: {
//             user_id,
//             country_code,
//             region,
//           },
//         },
//         { headers: paddleAPI.headers }
//       );

//       return {
//         subscriptionId: response.data.data.id,
//         status: response.data.data.status,
//       };
//     } catch (error) {
//       console.error('Paddle subscription error:', error.response?.data || error.message);
//       throw error;
//     }
//   },

//   verifyPayment: async (checkoutId) => {
//     try {
//       const response = await axios.get(
//         `${paddleAPI.baseURL}/checkout/${checkoutId}`,
//         { headers: paddleAPI.headers }
//       );

//       const checkout = response.data.data;
//       return {
//         verified: checkout.status === 'completed',
//         status: checkout.status,
//         amount: checkout.lineItems[0]?.unitPrice?.amount || 0,
//       };
//     } catch (error) {
//       console.error('Paddle verification error:', error);
//       throw error;
//     }
//   },
// };