//by chatgpt
// backend/src/controllers/paymentController.js
// Complete controller with recurring Stripe payments added + Paddle subscription support

import { stripeService } from '../services/stripeService.js';
import { paddleService } from '../services/paddleService.js';
import { gatewayRouterService } from '../services/gatewayRouterService.js';
import { paymentService } from '../services/paymentService.js';
import { paymentQueries } from '../models/paymentQueries.js';
import { subscriptionQueries } from '../models/subscriptionQueries.js';
import { simplePlanUpdateService } from '../services/simplePlanUpdateService.js';
import { query } from '../config/database.js';

export const paymentController = {
  // ========================================
  // EXISTING ENDPOINTS
  // ========================================

  // Get gateway recommendation for country
  getGatewayRecommendation: async (req, res, next) => {
    try {
      const { country_code, plan_id } = req.query;

      if (!country_code) {
        return res.status(400).json({ error: 'Country code required' });
      }

      const recommendation = await gatewayRouterService.getOptimalGateway(country_code, 'card');

      res.json({
        success: true,
        recommendation,
      });
    } catch (error) {
      next(error);
    }
  },

  // Create payment with country routing (handles pay-as-you-go + recurring)
  createPayment: async (req, res, next) => {
    try {
      const { planId, country_code, payment_method, region } = req.body;
      const userId = req.headers['x-user-id'];
      let userEmail = req.headers['x-user-email'] || req.user?.email;

      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      if (!country_code) {
        return res.status(400).json({ error: 'Country code required' });
      }

      // ✅ Get email from database if not in headers
      if (!userEmail) {
        try {
          const userResult = await query(
            'SELECT email FROM votteryy_users WHERE user_id = $1',
            [userId]
          );
          userEmail = userResult.rows[0]?.email;
          console.log(`📧 Email fetched from database: ${userEmail}`);
        } catch (emailError) {
          console.error('❌ Failed to fetch email from database:', emailError.message);
          // If email fetch fails, try without schema prefix
          try {
            const userResult = await query(
              'SELECT email FROM users WHERE user_id = $1',
              [userId]
            );
            userEmail = userResult.rows[0]?.email;
            console.log(`📧 Email fetched from users table: ${userEmail}`);
          } catch (fallbackError) {
            console.error('❌ Fallback email fetch also failed:', fallbackError.message);
          }
        }
      }

      if (!userEmail) {
        return res.status(400).json({ 
          error: 'User email required. Please provide x-user-email header or ensure user email exists in database.' 
        });
      }

      // Get plan details
      const planResult = await subscriptionQueries.getPlanById(planId);
      if (!planResult.rows[0]) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      const plan = planResult.rows[0];

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📥 Payment Request:');
      console.log(`   User: ${userId}`);
      console.log(`   Plan: ${plan.plan_name} (ID: ${planId})`);
      console.log(`   Type: ${plan.payment_type || 'recurring'}`);
      console.log(`   Country: ${country_code}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Check if pay-as-you-go
      if (plan.payment_type === 'pay_as_you_go') {
        console.log('→ Routing to pay-as-you-go handler');
        
        const result = await paymentService.handlePayAsYouGo({
          user_id: userId,
          plan,
        });

        return res.json(result);
      }

      // ===============================
      // 🔁 Handle recurring plans (Stripe)
      // ===============================
      if (plan.is_recurring) {
        console.log('🔁 Recurring plan detected — creating Stripe Subscription');

        // Determine billing interval from duration_days
        let interval = 'month';
        let intervalCount = 1;

        if (plan.duration_days === 90) intervalCount = 3;     // 3 months
        else if (plan.duration_days === 180) intervalCount = 6; // 6 months
        else if (plan.duration_days >= 360) interval = 'year';  // yearly

        // Create subscription directly via Stripe
        const { stripeClient } = await import('../config/gateways.js');

        // Get or create Stripe customer
        let customerId;
        const userResult = await query(
          'SELECT stripe_customer_id FROM votteryy_users WHERE id = $1',
          [userId]
        );
        if (userResult.rows[0]?.stripe_customer_id) {
          customerId = userResult.rows[0].stripe_customer_id;
        } else {
          const customer = await stripeClient.customers.create({
            email: userEmail,
            metadata: { userId },
          });
          customerId = customer.id;
          await query(
            'UPDATE votteryy_users SET stripe_customer_id = $1 WHERE id = $2',
            [customerId, userId]
          );
        }

        // If price exists in Stripe, use it. Otherwise create a new price.
        let priceId = plan.stripe_price_id;
        if (!priceId) {
          const price = await stripeClient.prices.create({
            unit_amount: Math.round(plan.price * 100),
            currency: 'usd',
            recurring: { interval, interval_count: intervalCount },
            product: plan.stripe_product_id,
          });
          priceId = price.id;

          // Save new price ID to DB
          await query(
            'UPDATE votteryy_subscription_plans SET stripe_price_id = $1 WHERE id = $2',
            [priceId, planId]
          );
        }

        // Create subscription
        const subscription = await stripeClient.subscriptions.create({
          customer: customerId,
          items: [{ price: priceId }],
          payment_behavior: 'default_incomplete',
          expand: ['latest_invoice.payment_intent'],
          metadata: { userId, planId, recurring: true },
        });

        // Save payment record
        await query(
          `INSERT INTO votteryy_payments 
            (user_id, plan_id, external_payment_id, stripe_subscription_id, status, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            userId,
            planId,
            subscription.latest_invoice.payment_intent.id,
            subscription.id,
            'pending',
          ]
        );

        console.log(`✅ Stripe Subscription Created: ${subscription.id}`);

        return res.json({
          success: true,
          type: 'recurring',
          client_secret: subscription.latest_invoice.payment_intent.client_secret,
          subscription_id: subscription.id,
          planDetails: {
            id: plan.id,
            name: plan.plan_name,
            price: plan.price,
            recurring: true,
            interval,
            interval_count: intervalCount,
          },
        });
      }

      // ===============================
      // 🧾 Non-recurring Stripe or Paddle
      // ===============================
      console.log('→ Routing to gateway router (non-recurring Stripe or Paddle)');

      const paymentData = {
        amount: plan.price,
        currency: 'USD',
        country_code: country_code.toUpperCase(),
        region,
        payment_method: payment_method || 'card',
        user_id: userId,
        email: userEmail,
        planId,
      };

      const result = await gatewayRouterService.createPaymentByCountry(paymentData);

      if (!result.success) {
        return res.status(400).json(result);
      }

      // ✅ NEW: Check if selected gateway is Paddle and plan is recurring
      if (result.gateway === 'paddle' && plan.payment_type === 'recurring') {
        console.log('🔁 Paddle recurring plan detected — creating Paddle Subscription');

        // Use Paddle subscription API for recurring plans
        const paddleResult = await paddleService.createSubscription({
          user_id: userId,
          email: userEmail,
          paddle_price_id: plan.paddle_price_id,
          planId: planId,
        });

        console.log(`✅ Paddle Subscription Created: ${paddleResult.transaction_id}`);

        // Save payment record with required fields
        await query(
          `INSERT INTO votteryy_payments 
            (user_id, amount, currency, gateway, external_payment_id, status, payment_method, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          [
            userId, 
            parseFloat(plan.price), 
            'USD', 
            'paddle', 
            paddleResult.transaction_id, 
            'pending',
            'card'
          ]
        );

        console.log('✅ Payment record saved to database');

        return res.json({
          success: true,
          type: 'recurring',
          paymentData: {
            transaction_id: paddleResult.transaction_id,
            checkout_url: paddleResult.checkout_url,
          },
          gateway: 'paddle',
          recommendation: result.recommendation,
          planDetails: {
            id: plan.id,
            name: plan.plan_name,
            price: plan.price,
            recurring: true,
          },
        });
      }

      res.json({
        success: true,
        type: 'one_time',
        paymentData: result.payment,
        gateway: result.gateway,
        recommendation: result.recommendation,
        splitNeeded: result.splitNeeded,
        planDetails: {
          id: plan.id,
          name: plan.plan_name,
          price: plan.price,
          recurring: false,
        },
      });
    } catch (error) {
      console.error('Payment creation error:', error);
      next(error);
    }
  },

  // Get user payments
  getUserPayments: async (req, res, next) => {
    try {
      const userId = req.headers['x-user-id'];
      const { limit = 20, offset = 0 } = req.query;

      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      const result = await paymentQueries.getUserPayments(
        userId,
        parseInt(limit),
        parseInt(offset)
      );

      res.json({ success: true, payments: result.rows });
    } catch (error) {
      next(error);
    }
  },

  // Verify payment
  verifyPayment: async (req, res, next) => {
    try {
      const { paymentId, gateway } = req.body;

      let verification;

      if (gateway === 'stripe') {
        verification = await stripeService.verifyPayment(paymentId);
      } else if (gateway === 'paddle') {
        verification = await paddleService.verifyPayment(paymentId);
      } else {
        return res.status(400).json({ error: 'Invalid gateway' });
      }

      res.json({ success: true, verification });
    } catch (error) {
      next(error);
    }
  },

  // ========================================
  // PAY-AS-YOU-GO ENDPOINTS
  // ========================================

  // Track usage for pay-as-you-go plans
  trackUsage: async (req, res, next) => {
    try {
      const userId = req.headers['x-user-id'];
      const { election_id, usage_type = 'election_created', quantity = 1 } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      console.log('📊 Tracking usage:', { userId, election_id, usage_type, quantity });

      const usage = await paymentService.trackUsage({
        user_id: userId,
        election_id,
        usage_type,
        quantity,
      });

      if (!usage) {
        return res.json({
          success: true,
          message: 'User is on subscription plan, no usage tracking needed',
        });
      }

      res.json({
        success: true,
        usage,
        message: 'Usage tracked successfully',
      });
    } catch (error) {
      console.error('Usage tracking error:', error);
      next(error);
    }
  },

  // Get unpaid usage (for billing)
  getUnpaidUsage: async (req, res, next) => {
    try {
      const userId = req.headers['x-user-id'];

      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      const unpaidUsage = await paymentService.getUnpaidUsage(userId);

      res.json({
        success: true,
        unpaidUsage,
      });
    } catch (error) {
      console.error('Get unpaid usage error:', error);
      next(error);
    }
  },

  // Get current plan info (including usage for pay-as-you-go)
  getCurrentPlan: async (req, res, next) => {
    try {
      const userId = req.headers['x-user-id'];

      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      const planInfo = await paymentService.getCurrentPlan(userId);

      if (!planInfo) {
        return res.json({
          success: true,
          plan: null,
          message: 'No active subscription',
        });
      }

      res.json({
        success: true,
        plan: planInfo,
      });
    } catch (error) {
      console.error('Get current plan error:', error);
      next(error);
    }
  },

  // Get usage history for pay-as-you-go users
  getUsageHistory: async (req, res, next) => {
    try {
      const userId = req.headers['x-user-id'];
      const { limit = 50 } = req.query;

      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      const usageQueries = await import('../models/usageQueries.js');
      const history = await usageQueries.usageQueries.getUserUsageHistory(
        userId,
        parseInt(limit)
      );

      res.json({
        success: true,
        history,
      });
    } catch (error) {
      console.error('Get usage history error:', error);
      next(error);
    }
  },

  // ========================================
  // ADMIN ENDPOINTS
  // ========================================

  getAllPlansAdmin: async (req, res, next) => {
    try {
      const result = await query(`
        SELECT 
          id,
          plan_name,
          description,
          price,
          duration_days,
          stripe_price_id,
          stripe_product_id,
          payment_type,
          is_recurring,
          is_active,
          what_included,
          created_at,
          updated_at
        FROM votteryy_subscription_plans
        ORDER BY 
          CASE 
            WHEN payment_type = 'pay_as_you_go' THEN 0
            ELSE 1
          END,
          duration_days ASC
      `);

      res.json({
        success: true,
        plans: result.rows,
        count: result.rows.length,
      });
    } catch (error) {
      console.error('Get plans admin error:', error);
      next(error);
    }
  },

  updatePlanPriceAdmin: async (req, res, next) => {
    try {
      const { planId } = req.params;
      const { newPrice } = req.body;

      if (!newPrice || newPrice <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Price must be greater than 0',
        });
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🔧 Admin updating plan ${planId} price to $${newPrice}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const result = await simplePlanUpdateService.updatePlanPrice(
        parseInt(planId),
        parseFloat(newPrice)
      );

      res.json(result);
    } catch (error) {
      console.error('Update plan price error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  getPlanByIdAdmin: async (req, res, next) => {
    try {
      const { planId } = req.params;

      const planResult = await subscriptionQueries.getPlanById(parseInt(planId));

      if (!planResult.rows[0]) {
        return res.status(404).json({
          success: false,
          error: 'Plan not found',
        });
      }

      res.json({
        success: true,
        plan: planResult.rows[0],
      });
    } catch (error) {
      console.error('Get plan by ID error:', error);
      next(error);
    }
  },
};
// //by chatgpt
// // backend/src/controllers/paymentController.js
// // Complete controller with recurring Stripe payments added + Paddle subscription support

// import { stripeService } from '../services/stripeService.js';
// import { paddleService } from '../services/paddleService.js';
// import { gatewayRouterService } from '../services/gatewayRouterService.js';
// import { paymentService } from '../services/paymentService.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { simplePlanUpdateService } from '../services/simplePlanUpdateService.js';
// import { query } from '../config/database.js';

// export const paymentController = {
//   // ========================================
//   // EXISTING ENDPOINTS
//   // ========================================

//   // Get gateway recommendation for country
//   getGatewayRecommendation: async (req, res, next) => {
//     try {
//       const { country_code, plan_id } = req.query;

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       const recommendation = await gatewayRouterService.getOptimalGateway(country_code, 'card');

//       res.json({
//         success: true,
//         recommendation,
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Create payment with country routing (handles pay-as-you-go + recurring)
//   createPayment: async (req, res, next) => {
//     try {
//       const { planId, country_code, payment_method, region } = req.body;
//       const userId = req.headers['x-user-id'];
//       let userEmail = req.headers['x-user-email'] || req.user?.email;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       // ✅ Get email from database if not in headers
//       if (!userEmail) {
//         try {
//           const userResult = await query(
//             'SELECT email FROM votteryy_users WHERE user_id = $1',
//             [userId]
//           );
//           userEmail = userResult.rows[0]?.email;
//           console.log(`📧 Email fetched from database: ${userEmail}`);
//         } catch (emailError) {
//           console.error('❌ Failed to fetch email from database:', emailError.message);
//           // If email fetch fails, try without schema prefix
//           try {
//             const userResult = await query(
//               'SELECT email FROM users WHERE user_id = $1',
//               [userId]
//             );
//             userEmail = userResult.rows[0]?.email;
//             console.log(`📧 Email fetched from users table: ${userEmail}`);
//           } catch (fallbackError) {
//             console.error('❌ Fallback email fetch also failed:', fallbackError.message);
//           }
//         }
//       }

//       if (!userEmail) {
//         return res.status(400).json({ 
//           error: 'User email required. Please provide x-user-email header or ensure user email exists in database.' 
//         });
//       }

//       // Get plan details
//       const planResult = await subscriptionQueries.getPlanById(planId);
//       if (!planResult.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       const plan = planResult.rows[0];

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('📥 Payment Request:');
//       console.log(`   User: ${userId}`);
//       console.log(`   Plan: ${plan.plan_name} (ID: ${planId})`);
//       console.log(`   Type: ${plan.payment_type || 'recurring'}`);
//       console.log(`   Country: ${country_code}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Check if pay-as-you-go
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('→ Routing to pay-as-you-go handler');
        
//         const result = await paymentService.handlePayAsYouGo({
//           user_id: userId,
//           plan,
//         });

//         return res.json(result);
//       }

//       // ===============================
//       // 🔁 Handle recurring plans (Stripe)
//       // ===============================
//       if (plan.is_recurring) {
//         console.log('🔁 Recurring plan detected — creating Stripe Subscription');

//         // Determine billing interval from duration_days
//         let interval = 'month';
//         let intervalCount = 1;

//         if (plan.duration_days === 90) intervalCount = 3;     // 3 months
//         else if (plan.duration_days === 180) intervalCount = 6; // 6 months
//         else if (plan.duration_days >= 360) interval = 'year';  // yearly

//         // Create subscription directly via Stripe
//         const { stripeClient } = await import('../config/gateways.js');

//         // Get or create Stripe customer
//         let customerId;
//         const userResult = await query(
//           'SELECT stripe_customer_id FROM votteryy_users WHERE id = $1',
//           [userId]
//         );
//         if (userResult.rows[0]?.stripe_customer_id) {
//           customerId = userResult.rows[0].stripe_customer_id;
//         } else {
//           const customer = await stripeClient.customers.create({
//             email: userEmail,
//             metadata: { userId },
//           });
//           customerId = customer.id;
//           await query(
//             'UPDATE votteryy_users SET stripe_customer_id = $1 WHERE id = $2',
//             [customerId, userId]
//           );
//         }

//         // If price exists in Stripe, use it. Otherwise create a new price.
//         let priceId = plan.stripe_price_id;
//         if (!priceId) {
//           const price = await stripeClient.prices.create({
//             unit_amount: Math.round(plan.price * 100),
//             currency: 'usd',
//             recurring: { interval, interval_count: intervalCount },
//             product: plan.stripe_product_id,
//           });
//           priceId = price.id;

//           // Save new price ID to DB
//           await query(
//             'UPDATE votteryy_subscription_plans SET stripe_price_id = $1 WHERE id = $2',
//             [priceId, planId]
//           );
//         }

//         // Create subscription
//         const subscription = await stripeClient.subscriptions.create({
//           customer: customerId,
//           items: [{ price: priceId }],
//           payment_behavior: 'default_incomplete',
//           expand: ['latest_invoice.payment_intent'],
//           metadata: { userId, planId, recurring: true },
//         });

//         // Save payment record
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, plan_id, external_payment_id, stripe_subscription_id, status, created_at)
//            VALUES ($1, $2, $3, $4, $5, NOW())`,
//           [
//             userId,
//             planId,
//             subscription.latest_invoice.payment_intent.id,
//             subscription.id,
//             'pending',
//           ]
//         );

//         console.log(`✅ Stripe Subscription Created: ${subscription.id}`);

//         return res.json({
//           success: true,
//           type: 'recurring',
//           client_secret: subscription.latest_invoice.payment_intent.client_secret,
//           subscription_id: subscription.id,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//             interval,
//             interval_count: intervalCount,
//           },
//         });
//       }

//       // ===============================
//       // 🧾 Non-recurring Stripe or Paddle
//       // ===============================
//       console.log('→ Routing to gateway router (non-recurring Stripe or Paddle)');

//       const paymentData = {
//         amount: plan.price,
//         currency: 'USD',
//         country_code: country_code.toUpperCase(),
//         region,
//         payment_method: payment_method || 'card',
//         user_id: userId,
//         email: userEmail,
//         planId,
//       };

//       const result = await gatewayRouterService.createPaymentByCountry(paymentData);

//       if (!result.success) {
//         return res.status(400).json(result);
//       }

//       // ✅ NEW: Check if selected gateway is Paddle and plan is recurring
//       if (result.gateway === 'paddle' && plan.payment_type === 'recurring') {
//         console.log('🔁 Paddle recurring plan detected — creating Paddle Subscription');

//         // Use Paddle subscription API for recurring plans
//         const paddleResult = await paddleService.createSubscription({
//           user_id: userId,
//           email: userEmail,
//           paddle_price_id: plan.paddle_price_id,
//           planId: planId,
//         });

//         console.log(`✅ Paddle Subscription Created: ${paddleResult.transaction_id}`);

//         // Save payment record with required fields
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, amount, currency, gateway, external_payment_id, status, payment_method, created_at, updated_at)
//            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
//           [
//             userId, 
//             parseFloat(plan.price), 
//             'USD', 
//             'paddle', 
//             paddleResult.transaction_id, 
//             'pending',
//             'card'
//           ]
//         );

//         console.log('✅ Payment record saved to database');

//         return res.json({
//           success: true,
//           type: 'recurring',
//           paymentData: {
//             transaction_id: paddleResult.transaction_id,
//             checkout_url: paddleResult.checkout_url,
//             customer_id: paddleResult.customer_id,
//           },
//           gateway: 'paddle',
//           recommendation: result.recommendation,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//           },
//         });
//       }

//       res.json({
//         success: true,
//         type: 'one_time',
//         paymentData: result.payment,
//         gateway: result.gateway,
//         recommendation: result.recommendation,
//         splitNeeded: result.splitNeeded,
//         planDetails: {
//           id: plan.id,
//           name: plan.plan_name,
//           price: plan.price,
//           recurring: false,
//         },
//       });
//     } catch (error) {
//       console.error('Payment creation error:', error);
//       next(error);
//     }
//   },

//   // Get user payments
//   getUserPayments: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 20, offset = 0 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await paymentQueries.getUserPayments(
//         userId,
//         parseInt(limit),
//         parseInt(offset)
//       );

//       res.json({ success: true, payments: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Verify payment
//   verifyPayment: async (req, res, next) => {
//     try {
//       const { paymentId, gateway } = req.body;

//       let verification;

//       if (gateway === 'stripe') {
//         verification = await stripeService.verifyPayment(paymentId);
//       } else if (gateway === 'paddle') {
//         verification = await paddleService.verifyPayment(paymentId);
//       } else {
//         return res.status(400).json({ error: 'Invalid gateway' });
//       }

//       res.json({ success: true, verification });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // ========================================
//   // PAY-AS-YOU-GO ENDPOINTS
//   // ========================================

//   // Track usage for pay-as-you-go plans
//   trackUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { election_id, usage_type = 'election_created', quantity = 1 } = req.body;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       console.log('📊 Tracking usage:', { userId, election_id, usage_type, quantity });

//       const usage = await paymentService.trackUsage({
//         user_id: userId,
//         election_id,
//         usage_type,
//         quantity,
//       });

//       if (!usage) {
//         return res.json({
//           success: true,
//           message: 'User is on subscription plan, no usage tracking needed',
//         });
//       }

//       res.json({
//         success: true,
//         usage,
//         message: 'Usage tracked successfully',
//       });
//     } catch (error) {
//       console.error('Usage tracking error:', error);
//       next(error);
//     }
//   },

//   // Get unpaid usage (for billing)
//   getUnpaidUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const unpaidUsage = await paymentService.getUnpaidUsage(userId);

//       res.json({
//         success: true,
//         unpaidUsage,
//       });
//     } catch (error) {
//       console.error('Get unpaid usage error:', error);
//       next(error);
//     }
//   },

//   // Get current plan info (including usage for pay-as-you-go)
//   getCurrentPlan: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const planInfo = await paymentService.getCurrentPlan(userId);

//       if (!planInfo) {
//         return res.json({
//           success: true,
//           plan: null,
//           message: 'No active subscription',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planInfo,
//       });
//     } catch (error) {
//       console.error('Get current plan error:', error);
//       next(error);
//     }
//   },

//   // Get usage history for pay-as-you-go users
//   getUsageHistory: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 50 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const usageQueries = await import('../models/usageQueries.js');
//       const history = await usageQueries.usageQueries.getUserUsageHistory(
//         userId,
//         parseInt(limit)
//       );

//       res.json({
//         success: true,
//         history,
//       });
//     } catch (error) {
//       console.error('Get usage history error:', error);
//       next(error);
//     }
//   },

//   // ========================================
//   // ADMIN ENDPOINTS
//   // ========================================

//   getAllPlansAdmin: async (req, res, next) => {
//     try {
//       const result = await query(`
//         SELECT 
//           id,
//           plan_name,
//           description,
//           price,
//           duration_days,
//           stripe_price_id,
//           stripe_product_id,
//           payment_type,
//           is_recurring,
//           is_active,
//           what_included,
//           created_at,
//           updated_at
//         FROM votteryy_subscription_plans
//         ORDER BY 
//           CASE 
//             WHEN payment_type = 'pay_as_you_go' THEN 0
//             ELSE 1
//           END,
//           duration_days ASC
//       `);

//       res.json({
//         success: true,
//         plans: result.rows,
//         count: result.rows.length,
//       });
//     } catch (error) {
//       console.error('Get plans admin error:', error);
//       next(error);
//     }
//   },

//   updatePlanPriceAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const { newPrice } = req.body;

//       if (!newPrice || newPrice <= 0) {
//         return res.status(400).json({
//           success: false,
//           error: 'Price must be greater than 0',
//         });
//       }

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`🔧 Admin updating plan ${planId} price to $${newPrice}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       const result = await simplePlanUpdateService.updatePlanPrice(
//         parseInt(planId),
//         parseFloat(newPrice)
//       );

//       res.json(result);
//     } catch (error) {
//       console.error('Update plan price error:', error);
//       res.status(500).json({
//         success: false,
//         error: error.message,
//       });
//     }
//   },

//   getPlanByIdAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;

//       const planResult = await subscriptionQueries.getPlanById(parseInt(planId));

//       if (!planResult.rows[0]) {
//         return res.status(404).json({
//           success: false,
//           error: 'Plan not found',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planResult.rows[0],
//       });
//     } catch (error) {
//       console.error('Get plan by ID error:', error);
//       next(error);
//     }
//   },
// };
// //by chatgpt
// // backend/src/controllers/paymentController.js
// // Complete controller with recurring Stripe payments added + Paddle subscription support

// import { stripeService } from '../services/stripeService.js';
// import { paddleService } from '../services/paddleService.js';
// import { gatewayRouterService } from '../services/gatewayRouterService.js';
// import { paymentService } from '../services/paymentService.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { simplePlanUpdateService } from '../services/simplePlanUpdateService.js';
// import { query } from '../config/database.js';

// export const paymentController = {
//   // ========================================
//   // EXISTING ENDPOINTS
//   // ========================================

//   // Get gateway recommendation for country
//   getGatewayRecommendation: async (req, res, next) => {
//     try {
//       const { country_code, plan_id } = req.query;

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       const recommendation = await gatewayRouterService.getOptimalGateway(country_code, 'card');

//       res.json({
//         success: true,
//         recommendation,
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Create payment with country routing (handles pay-as-you-go + recurring)
//   createPayment: async (req, res, next) => {
//     try {
//       const { planId, country_code, payment_method, region } = req.body;
//       const userId = req.headers['x-user-id'];
//       let userEmail = req.headers['x-user-email'] || req.user?.email;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       // ✅ Get email from database if not in headers
//       if (!userEmail) {
//         try {
//           const userResult = await query(
//             'SELECT email FROM votteryy_users WHERE user_id = $1',
//             [userId]
//           );
//           userEmail = userResult.rows[0]?.email;
//           console.log(`📧 Email fetched from database: ${userEmail}`);
//         } catch (emailError) {
//           console.error('❌ Failed to fetch email from database:', emailError.message);
//           // If email fetch fails, try without schema prefix
//           try {
//             const userResult = await query(
//               'SELECT email FROM users WHERE user_id = $1',
//               [userId]
//             );
//             userEmail = userResult.rows[0]?.email;
//             console.log(`📧 Email fetched from users table: ${userEmail}`);
//           } catch (fallbackError) {
//             console.error('❌ Fallback email fetch also failed:', fallbackError.message);
//           }
//         }
//       }

//       if (!userEmail) {
//         return res.status(400).json({ 
//           error: 'User email required. Please provide x-user-email header or ensure user email exists in database.' 
//         });
//       }

//       // Get plan details
//       const planResult = await subscriptionQueries.getPlanById(planId);
//       if (!planResult.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       const plan = planResult.rows[0];

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('📥 Payment Request:');
//       console.log(`   User: ${userId}`);
//       console.log(`   Plan: ${plan.plan_name} (ID: ${planId})`);
//       console.log(`   Type: ${plan.payment_type || 'recurring'}`);
//       console.log(`   Country: ${country_code}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Check if pay-as-you-go
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('→ Routing to pay-as-you-go handler');
        
//         const result = await paymentService.handlePayAsYouGo({
//           user_id: userId,
//           plan,
//         });

//         return res.json(result);
//       }

//       // ===============================
//       // 🔁 Handle recurring plans (Stripe)
//       // ===============================
//       if (plan.is_recurring) {
//         console.log('🔁 Recurring plan detected — creating Stripe Subscription');

//         // Determine billing interval from duration_days
//         let interval = 'month';
//         let intervalCount = 1;

//         if (plan.duration_days === 90) intervalCount = 3;     // 3 months
//         else if (plan.duration_days === 180) intervalCount = 6; // 6 months
//         else if (plan.duration_days >= 360) interval = 'year';  // yearly

//         // Create subscription directly via Stripe
//         const { stripeClient } = await import('../config/gateways.js');

//         // Get or create Stripe customer
//         let customerId;
//         const userResult = await query(
//           'SELECT stripe_customer_id FROM votteryy_users WHERE id = $1',
//           [userId]
//         );
//         if (userResult.rows[0]?.stripe_customer_id) {
//           customerId = userResult.rows[0].stripe_customer_id;
//         } else {
//           const customer = await stripeClient.customers.create({
//             email: userEmail,
//             metadata: { userId },
//           });
//           customerId = customer.id;
//           await query(
//             'UPDATE votteryy_users SET stripe_customer_id = $1 WHERE id = $2',
//             [customerId, userId]
//           );
//         }

//         // If price exists in Stripe, use it. Otherwise create a new price.
//         let priceId = plan.stripe_price_id;
//         if (!priceId) {
//           const price = await stripeClient.prices.create({
//             unit_amount: Math.round(plan.price * 100),
//             currency: 'usd',
//             recurring: { interval, interval_count: intervalCount },
//             product: plan.stripe_product_id,
//           });
//           priceId = price.id;

//           // Save new price ID to DB
//           await query(
//             'UPDATE votteryy_subscription_plans SET stripe_price_id = $1 WHERE id = $2',
//             [priceId, planId]
//           );
//         }

//         // Create subscription
//         const subscription = await stripeClient.subscriptions.create({
//           customer: customerId,
//           items: [{ price: priceId }],
//           payment_behavior: 'default_incomplete',
//           expand: ['latest_invoice.payment_intent'],
//           metadata: { userId, planId, recurring: true },
//         });

//         // Save payment record
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, plan_id, external_payment_id, stripe_subscription_id, status, created_at)
//            VALUES ($1, $2, $3, $4, $5, NOW())`,
//           [
//             userId,
//             planId,
//             subscription.latest_invoice.payment_intent.id,
//             subscription.id,
//             'pending',
//           ]
//         );

//         console.log(`✅ Stripe Subscription Created: ${subscription.id}`);

//         return res.json({
//           success: true,
//           type: 'recurring',
//           client_secret: subscription.latest_invoice.payment_intent.client_secret,
//           subscription_id: subscription.id,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//             interval,
//             interval_count: intervalCount,
//           },
//         });
//       }

//       // ===============================
//       // 🧾 Non-recurring Stripe or Paddle
//       // ===============================
//       console.log('→ Routing to gateway router (non-recurring Stripe or Paddle)');

//       const paymentData = {
//         amount: plan.price,
//         currency: 'USD',
//         country_code: country_code.toUpperCase(),
//         region,
//         payment_method: payment_method || 'card',
//         user_id: userId,
//         email: userEmail,
//         planId,
//       };

//       const result = await gatewayRouterService.createPaymentByCountry(paymentData);

//       if (!result.success) {
//         return res.status(400).json(result);
//       }

//       // ✅ NEW: Check if selected gateway is Paddle and plan is recurring
//       if (result.gateway === 'paddle' && plan.payment_type === 'recurring') {
//         console.log('🔁 Paddle recurring plan detected — creating Paddle Subscription');

//         // Use Paddle subscription API for recurring plans
//         const paddleResult = await paddleService.createSubscription({
//           user_id: userId,
//           email: userEmail,
//           paddle_price_id: plan.paddle_price_id,
//           planId: planId,
//         });

//         console.log(`✅ Paddle Subscription Created: ${paddleResult.transaction_id}`);

//         // Save payment record
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, external_payment_id, gateway, status, created_at)
//            VALUES ($1, $2, $3, $4, NOW())`,
//           [userId, paddleResult.transaction_id, 'paddle', 'pending']
//         );

//         return res.json({
//           success: true,
//           type: 'recurring',
//           paymentData: {
//             transaction_id: paddleResult.transaction_id,
//             checkout_url: paddleResult.checkout_url,
//             customer_id: paddleResult.customer_id,
//           },
//           gateway: 'paddle',
//           recommendation: result.recommendation,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//           },
//         });
//       }

//       res.json({
//         success: true,
//         type: 'one_time',
//         paymentData: result.payment,
//         gateway: result.gateway,
//         recommendation: result.recommendation,
//         splitNeeded: result.splitNeeded,
//         planDetails: {
//           id: plan.id,
//           name: plan.plan_name,
//           price: plan.price,
//           recurring: false,
//         },
//       });
//     } catch (error) {
//       console.error('Payment creation error:', error);
//       next(error);
//     }
//   },

//   // Get user payments
//   getUserPayments: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 20, offset = 0 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await paymentQueries.getUserPayments(
//         userId,
//         parseInt(limit),
//         parseInt(offset)
//       );

//       res.json({ success: true, payments: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Verify payment
//   verifyPayment: async (req, res, next) => {
//     try {
//       const { paymentId, gateway } = req.body;

//       let verification;

//       if (gateway === 'stripe') {
//         verification = await stripeService.verifyPayment(paymentId);
//       } else if (gateway === 'paddle') {
//         verification = await paddleService.verifyPayment(paymentId);
//       } else {
//         return res.status(400).json({ error: 'Invalid gateway' });
//       }

//       res.json({ success: true, verification });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // ========================================
//   // PAY-AS-YOU-GO ENDPOINTS
//   // ========================================

//   // Track usage for pay-as-you-go plans
//   trackUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { election_id, usage_type = 'election_created', quantity = 1 } = req.body;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       console.log('📊 Tracking usage:', { userId, election_id, usage_type, quantity });

//       const usage = await paymentService.trackUsage({
//         user_id: userId,
//         election_id,
//         usage_type,
//         quantity,
//       });

//       if (!usage) {
//         return res.json({
//           success: true,
//           message: 'User is on subscription plan, no usage tracking needed',
//         });
//       }

//       res.json({
//         success: true,
//         usage,
//         message: 'Usage tracked successfully',
//       });
//     } catch (error) {
//       console.error('Usage tracking error:', error);
//       next(error);
//     }
//   },

//   // Get unpaid usage (for billing)
//   getUnpaidUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const unpaidUsage = await paymentService.getUnpaidUsage(userId);

//       res.json({
//         success: true,
//         unpaidUsage,
//       });
//     } catch (error) {
//       console.error('Get unpaid usage error:', error);
//       next(error);
//     }
//   },

//   // Get current plan info (including usage for pay-as-you-go)
//   getCurrentPlan: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const planInfo = await paymentService.getCurrentPlan(userId);

//       if (!planInfo) {
//         return res.json({
//           success: true,
//           plan: null,
//           message: 'No active subscription',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planInfo,
//       });
//     } catch (error) {
//       console.error('Get current plan error:', error);
//       next(error);
//     }
//   },

//   // Get usage history for pay-as-you-go users
//   getUsageHistory: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 50 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const usageQueries = await import('../models/usageQueries.js');
//       const history = await usageQueries.usageQueries.getUserUsageHistory(
//         userId,
//         parseInt(limit)
//       );

//       res.json({
//         success: true,
//         history,
//       });
//     } catch (error) {
//       console.error('Get usage history error:', error);
//       next(error);
//     }
//   },

//   // ========================================
//   // ADMIN ENDPOINTS
//   // ========================================

//   getAllPlansAdmin: async (req, res, next) => {
//     try {
//       const result = await query(`
//         SELECT 
//           id,
//           plan_name,
//           description,
//           price,
//           duration_days,
//           stripe_price_id,
//           stripe_product_id,
//           payment_type,
//           is_recurring,
//           is_active,
//           what_included,
//           created_at,
//           updated_at
//         FROM votteryy_subscription_plans
//         ORDER BY 
//           CASE 
//             WHEN payment_type = 'pay_as_you_go' THEN 0
//             ELSE 1
//           END,
//           duration_days ASC
//       `);

//       res.json({
//         success: true,
//         plans: result.rows,
//         count: result.rows.length,
//       });
//     } catch (error) {
//       console.error('Get plans admin error:', error);
//       next(error);
//     }
//   },

//   updatePlanPriceAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const { newPrice } = req.body;

//       if (!newPrice || newPrice <= 0) {
//         return res.status(400).json({
//           success: false,
//           error: 'Price must be greater than 0',
//         });
//       }

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`🔧 Admin updating plan ${planId} price to $${newPrice}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       const result = await simplePlanUpdateService.updatePlanPrice(
//         parseInt(planId),
//         parseFloat(newPrice)
//       );

//       res.json(result);
//     } catch (error) {
//       console.error('Update plan price error:', error);
//       res.status(500).json({
//         success: false,
//         error: error.message,
//       });
//     }
//   },

//   getPlanByIdAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;

//       const planResult = await subscriptionQueries.getPlanById(parseInt(planId));

//       if (!planResult.rows[0]) {
//         return res.status(404).json({
//           success: false,
//           error: 'Plan not found',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planResult.rows[0],
//       });
//     } catch (error) {
//       console.error('Get plan by ID error:', error);
//       next(error);
//     }
//   },
// };
// //by chatgpt
// // backend/src/controllers/paymentController.js
// // Complete controller with recurring Stripe payments added + Paddle subscription support

// import { stripeService } from '../services/stripeService.js';
// import { paddleService } from '../services/paddleService.js';
// import { gatewayRouterService } from '../services/gatewayRouterService.js';
// import { paymentService } from '../services/paymentService.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { simplePlanUpdateService } from '../services/simplePlanUpdateService.js';
// import { query } from '../config/database.js';

// export const paymentController = {
//   // ========================================
//   // EXISTING ENDPOINTS
//   // ========================================

//   // Get gateway recommendation for country
//   getGatewayRecommendation: async (req, res, next) => {
//     try {
//       const { country_code, plan_id } = req.query;

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       const recommendation = await gatewayRouterService.getOptimalGateway(country_code, 'card');

//       res.json({
//         success: true,
//         recommendation,
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Create payment with country routing (handles pay-as-you-go + recurring)
//   createPayment: async (req, res, next) => {
//     try {
//       const { planId, country_code, payment_method, region } = req.body;
//       const userId = req.headers['x-user-id'];
//       let userEmail = req.headers['x-user-email'] || req.user?.email;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       // ✅ Get email from database if not in headers
//       if (!userEmail) {
//         try {
//           const userResult = await query(
//             'SELECT email FROM votteryy_users WHERE user_id = $1',
//             [userId]
//           );
//           userEmail = userResult.rows[0]?.email;
//           console.log(`📧 Email fetched from database: ${userEmail}`);
//         } catch (emailError) {
//           console.error('❌ Failed to fetch email from database:', emailError.message);
//           // If email fetch fails, try without schema prefix
//           try {
//             const userResult = await query(
//               'SELECT email FROM users WHERE user_id = $1',
//               [userId]
//             );
//             userEmail = userResult.rows[0]?.email;
//             console.log(`📧 Email fetched from users table: ${userEmail}`);
//           } catch (fallbackError) {
//             console.error('❌ Fallback email fetch also failed:', fallbackError.message);
//           }
//         }
//       }

//       if (!userEmail) {
//         return res.status(400).json({ 
//           error: 'User email required. Please provide x-user-email header or ensure user email exists in database.' 
//         });
//       }

//       // Get plan details
//       const planResult = await subscriptionQueries.getPlanById(planId);
//       if (!planResult.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       const plan = planResult.rows[0];

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('📥 Payment Request:');
//       console.log(`   User: ${userId}`);
//       console.log(`   Plan: ${plan.plan_name} (ID: ${planId})`);
//       console.log(`   Type: ${plan.payment_type || 'recurring'}`);
//       console.log(`   Country: ${country_code}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Check if pay-as-you-go
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('→ Routing to pay-as-you-go handler');
        
//         const result = await paymentService.handlePayAsYouGo({
//           user_id: userId,
//           plan,
//         });

//         return res.json(result);
//       }

//       // ===============================
//       // 🔁 Handle recurring plans (Stripe)
//       // ===============================
//       if (plan.is_recurring) {
//         console.log('🔁 Recurring plan detected — creating Stripe Subscription');

//         // Determine billing interval from duration_days
//         let interval = 'month';
//         let intervalCount = 1;

//         if (plan.duration_days === 90) intervalCount = 3;     // 3 months
//         else if (plan.duration_days === 180) intervalCount = 6; // 6 months
//         else if (plan.duration_days >= 360) interval = 'year';  // yearly

//         // Create subscription directly via Stripe
//         const { stripeClient } = await import('../config/gateways.js');

//         // Get or create Stripe customer
//         let customerId;
//         const userResult = await query(
//           'SELECT stripe_customer_id FROM votteryy_users WHERE id = $1',
//           [userId]
//         );
//         if (userResult.rows[0]?.stripe_customer_id) {
//           customerId = userResult.rows[0].stripe_customer_id;
//         } else {
//           const customer = await stripeClient.customers.create({
//             email: userEmail,
//             metadata: { userId },
//           });
//           customerId = customer.id;
//           await query(
//             'UPDATE votteryy_users SET stripe_customer_id = $1 WHERE id = $2',
//             [customerId, userId]
//           );
//         }

//         // If price exists in Stripe, use it. Otherwise create a new price.
//         let priceId = plan.stripe_price_id;
//         if (!priceId) {
//           const price = await stripeClient.prices.create({
//             unit_amount: Math.round(plan.price * 100),
//             currency: 'usd',
//             recurring: { interval, interval_count: intervalCount },
//             product: plan.stripe_product_id,
//           });
//           priceId = price.id;

//           // Save new price ID to DB
//           await query(
//             'UPDATE votteryy_subscription_plans SET stripe_price_id = $1 WHERE id = $2',
//             [priceId, planId]
//           );
//         }

//         // Create subscription
//         const subscription = await stripeClient.subscriptions.create({
//           customer: customerId,
//           items: [{ price: priceId }],
//           payment_behavior: 'default_incomplete',
//           expand: ['latest_invoice.payment_intent'],
//           metadata: { userId, planId, recurring: true },
//         });

//         // Save payment record
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, plan_id, external_payment_id, stripe_subscription_id, status, created_at)
//            VALUES ($1, $2, $3, $4, $5, NOW())`,
//           [
//             userId,
//             planId,
//             subscription.latest_invoice.payment_intent.id,
//             subscription.id,
//             'pending',
//           ]
//         );

//         console.log(`✅ Stripe Subscription Created: ${subscription.id}`);

//         return res.json({
//           success: true,
//           type: 'recurring',
//           client_secret: subscription.latest_invoice.payment_intent.client_secret,
//           subscription_id: subscription.id,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//             interval,
//             interval_count: intervalCount,
//           },
//         });
//       }

//       // ===============================
//       // 🧾 Non-recurring Stripe or Paddle
//       // ===============================
//       console.log('→ Routing to gateway router (non-recurring Stripe or Paddle)');

//       const paymentData = {
//         amount: plan.price,
//         currency: 'USD',
//         country_code: country_code.toUpperCase(),
//         region,
//         payment_method: payment_method || 'card',
//         user_id: userId,
//         email: userEmail,
//         planId,
//       };

//       const result = await gatewayRouterService.createPaymentByCountry(paymentData);

//       if (!result.success) {
//         return res.status(400).json(result);
//       }

//       // ✅ NEW: Check if selected gateway is Paddle and plan is recurring
//       if (result.gateway === 'paddle' && plan.payment_type === 'recurring') {
//         console.log('🔁 Paddle recurring plan detected — creating Paddle Subscription');

//         // Use Paddle subscription API for recurring plans
//         const paddleResult = await paddleService.createSubscription({
//           user_id: userId,
//           email: userEmail,
//           paddle_price_id: plan.paddle_price_id,
//           planId: planId,
//         });

//         console.log(`✅ Paddle Subscription Created: ${paddleResult.transaction_id}`);

//         // Save payment record
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, plan_id, external_payment_id, gateway, status, created_at)
//            VALUES ($1, $2, $3, $4, $5, NOW())`,
//           [userId, planId, paddleResult.transaction_id, 'paddle', 'pending']
//         );

//         return res.json({
//           success: true,
//           type: 'recurring',
//           paymentData: {
//             transaction_id: paddleResult.transaction_id,
//             checkout_url: paddleResult.checkout_url,
//             customer_id: paddleResult.customer_id,
//           },
//           gateway: 'paddle',
//           recommendation: result.recommendation,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//           },
//         });
//       }

//       res.json({
//         success: true,
//         type: 'one_time',
//         paymentData: result.payment,
//         gateway: result.gateway,
//         recommendation: result.recommendation,
//         splitNeeded: result.splitNeeded,
//         planDetails: {
//           id: plan.id,
//           name: plan.plan_name,
//           price: plan.price,
//           recurring: false,
//         },
//       });
//     } catch (error) {
//       console.error('Payment creation error:', error);
//       next(error);
//     }
//   },

//   // Get user payments
//   getUserPayments: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 20, offset = 0 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await paymentQueries.getUserPayments(
//         userId,
//         parseInt(limit),
//         parseInt(offset)
//       );

//       res.json({ success: true, payments: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Verify payment
//   verifyPayment: async (req, res, next) => {
//     try {
//       const { paymentId, gateway } = req.body;

//       let verification;

//       if (gateway === 'stripe') {
//         verification = await stripeService.verifyPayment(paymentId);
//       } else if (gateway === 'paddle') {
//         verification = await paddleService.verifyPayment(paymentId);
//       } else {
//         return res.status(400).json({ error: 'Invalid gateway' });
//       }

//       res.json({ success: true, verification });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // ========================================
//   // PAY-AS-YOU-GO ENDPOINTS
//   // ========================================

//   // Track usage for pay-as-you-go plans
//   trackUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { election_id, usage_type = 'election_created', quantity = 1 } = req.body;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       console.log('📊 Tracking usage:', { userId, election_id, usage_type, quantity });

//       const usage = await paymentService.trackUsage({
//         user_id: userId,
//         election_id,
//         usage_type,
//         quantity,
//       });

//       if (!usage) {
//         return res.json({
//           success: true,
//           message: 'User is on subscription plan, no usage tracking needed',
//         });
//       }

//       res.json({
//         success: true,
//         usage,
//         message: 'Usage tracked successfully',
//       });
//     } catch (error) {
//       console.error('Usage tracking error:', error);
//       next(error);
//     }
//   },

//   // Get unpaid usage (for billing)
//   getUnpaidUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const unpaidUsage = await paymentService.getUnpaidUsage(userId);

//       res.json({
//         success: true,
//         unpaidUsage,
//       });
//     } catch (error) {
//       console.error('Get unpaid usage error:', error);
//       next(error);
//     }
//   },

//   // Get current plan info (including usage for pay-as-you-go)
//   getCurrentPlan: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const planInfo = await paymentService.getCurrentPlan(userId);

//       if (!planInfo) {
//         return res.json({
//           success: true,
//           plan: null,
//           message: 'No active subscription',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planInfo,
//       });
//     } catch (error) {
//       console.error('Get current plan error:', error);
//       next(error);
//     }
//   },

//   // Get usage history for pay-as-you-go users
//   getUsageHistory: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 50 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const usageQueries = await import('../models/usageQueries.js');
//       const history = await usageQueries.usageQueries.getUserUsageHistory(
//         userId,
//         parseInt(limit)
//       );

//       res.json({
//         success: true,
//         history,
//       });
//     } catch (error) {
//       console.error('Get usage history error:', error);
//       next(error);
//     }
//   },

//   // ========================================
//   // ADMIN ENDPOINTS
//   // ========================================

//   getAllPlansAdmin: async (req, res, next) => {
//     try {
//       const result = await query(`
//         SELECT 
//           id,
//           plan_name,
//           description,
//           price,
//           duration_days,
//           stripe_price_id,
//           stripe_product_id,
//           payment_type,
//           is_recurring,
//           is_active,
//           what_included,
//           created_at,
//           updated_at
//         FROM votteryy_subscription_plans
//         ORDER BY 
//           CASE 
//             WHEN payment_type = 'pay_as_you_go' THEN 0
//             ELSE 1
//           END,
//           duration_days ASC
//       `);

//       res.json({
//         success: true,
//         plans: result.rows,
//         count: result.rows.length,
//       });
//     } catch (error) {
//       console.error('Get plans admin error:', error);
//       next(error);
//     }
//   },

//   updatePlanPriceAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const { newPrice } = req.body;

//       if (!newPrice || newPrice <= 0) {
//         return res.status(400).json({
//           success: false,
//           error: 'Price must be greater than 0',
//         });
//       }

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`🔧 Admin updating plan ${planId} price to $${newPrice}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       const result = await simplePlanUpdateService.updatePlanPrice(
//         parseInt(planId),
//         parseFloat(newPrice)
//       );

//       res.json(result);
//     } catch (error) {
//       console.error('Update plan price error:', error);
//       res.status(500).json({
//         success: false,
//         error: error.message,
//       });
//     }
//   },

//   getPlanByIdAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;

//       const planResult = await subscriptionQueries.getPlanById(parseInt(planId));

//       if (!planResult.rows[0]) {
//         return res.status(404).json({
//           success: false,
//           error: 'Plan not found',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planResult.rows[0],
//       });
//     } catch (error) {
//       console.error('Get plan by ID error:', error);
//       next(error);
//     }
//   },
// };
// //by chatgpt
// // backend/src/controllers/paymentController.js
// // Complete controller with recurring Stripe payments added + Paddle subscription support

// import { stripeService } from '../services/stripeService.js';
// import { paddleService } from '../services/paddleService.js';
// import { gatewayRouterService } from '../services/gatewayRouterService.js';
// import { paymentService } from '../services/paymentService.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { simplePlanUpdateService } from '../services/simplePlanUpdateService.js';
// import { query } from '../config/database.js';

// export const paymentController = {
//   // ========================================
//   // EXISTING ENDPOINTS
//   // ========================================

//   // Get gateway recommendation for country
//   getGatewayRecommendation: async (req, res, next) => {
//     try {
//       const { country_code, plan_id } = req.query;

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       const recommendation = await gatewayRouterService.getOptimalGateway(country_code, 'card');

//       res.json({
//         success: true,
//         recommendation,
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Create payment with country routing (handles pay-as-you-go + recurring)
//   createPayment: async (req, res, next) => {
//     try {
//       const { planId, country_code, payment_method, region } = req.body;
//       const userId = req.headers['x-user-id'];
//       let userEmail = req.headers['x-user-email'] || req.user?.email;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       // ✅ Get email from database if not in headers
//       if (!userEmail) {
//         const userResult = await query(
//           'SELECT email FROM votteryy_users WHERE id = $1',
//           [userId]
//         );
//         userEmail = userResult.rows[0]?.email;
//         console.log(`📧 Email fetched from database: ${userEmail}`);
//       }

//       // Get plan details
//       const planResult = await subscriptionQueries.getPlanById(planId);
//       if (!planResult.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       const plan = planResult.rows[0];

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('📥 Payment Request:');
//       console.log(`   User: ${userId}`);
//       console.log(`   Plan: ${plan.plan_name} (ID: ${planId})`);
//       console.log(`   Type: ${plan.payment_type || 'recurring'}`);
//       console.log(`   Country: ${country_code}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Check if pay-as-you-go
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('→ Routing to pay-as-you-go handler');
        
//         const result = await paymentService.handlePayAsYouGo({
//           user_id: userId,
//           plan,
//         });

//         return res.json(result);
//       }

//       // ===============================
//       // 🔁 Handle recurring plans (Stripe)
//       // ===============================
//       if (plan.is_recurring) {
//         console.log('🔁 Recurring plan detected — creating Stripe Subscription');

//         // Determine billing interval from duration_days
//         let interval = 'month';
//         let intervalCount = 1;

//         if (plan.duration_days === 90) intervalCount = 3;     // 3 months
//         else if (plan.duration_days === 180) intervalCount = 6; // 6 months
//         else if (plan.duration_days >= 360) interval = 'year';  // yearly

//         // Create subscription directly via Stripe
//         const { stripeClient } = await import('../config/gateways.js');

//         // Get or create Stripe customer
//         let customerId;
//         const userResult = await query(
//           'SELECT stripe_customer_id FROM votteryy_users WHERE id = $1',
//           [userId]
//         );
//         if (userResult.rows[0]?.stripe_customer_id) {
//           customerId = userResult.rows[0].stripe_customer_id;
//         } else {
//           const customer = await stripeClient.customers.create({
//             email: userEmail,
//             metadata: { userId },
//           });
//           customerId = customer.id;
//           await query(
//             'UPDATE votteryy_users SET stripe_customer_id = $1 WHERE id = $2',
//             [customerId, userId]
//           );
//         }

//         // If price exists in Stripe, use it. Otherwise create a new price.
//         let priceId = plan.stripe_price_id;
//         if (!priceId) {
//           const price = await stripeClient.prices.create({
//             unit_amount: Math.round(plan.price * 100),
//             currency: 'usd',
//             recurring: { interval, interval_count: intervalCount },
//             product: plan.stripe_product_id,
//           });
//           priceId = price.id;

//           // Save new price ID to DB
//           await query(
//             'UPDATE votteryy_subscription_plans SET stripe_price_id = $1 WHERE id = $2',
//             [priceId, planId]
//           );
//         }

//         // Create subscription
//         const subscription = await stripeClient.subscriptions.create({
//           customer: customerId,
//           items: [{ price: priceId }],
//           payment_behavior: 'default_incomplete',
//           expand: ['latest_invoice.payment_intent'],
//           metadata: { userId, planId, recurring: true },
//         });

//         // Save payment record
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, plan_id, external_payment_id, stripe_subscription_id, status, created_at)
//            VALUES ($1, $2, $3, $4, $5, NOW())`,
//           [
//             userId,
//             planId,
//             subscription.latest_invoice.payment_intent.id,
//             subscription.id,
//             'pending',
//           ]
//         );

//         console.log(`✅ Stripe Subscription Created: ${subscription.id}`);

//         return res.json({
//           success: true,
//           type: 'recurring',
//           client_secret: subscription.latest_invoice.payment_intent.client_secret,
//           subscription_id: subscription.id,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//             interval,
//             interval_count: intervalCount,
//           },
//         });
//       }

//       // ===============================
//       // 🧾 Non-recurring Stripe or Paddle
//       // ===============================
//       console.log('→ Routing to gateway router (non-recurring Stripe or Paddle)');

//       const paymentData = {
//         amount: plan.price,
//         currency: 'USD',
//         country_code: country_code.toUpperCase(),
//         region,
//         payment_method: payment_method || 'card',
//         user_id: userId,
//         email: userEmail,
//         planId,
//       };

//       const result = await gatewayRouterService.createPaymentByCountry(paymentData);

//       if (!result.success) {
//         return res.status(400).json(result);
//       }

//       // ✅ NEW: Check if selected gateway is Paddle and plan is recurring
//       if (result.gateway === 'paddle' && plan.payment_type === 'recurring') {
//         console.log('🔁 Paddle recurring plan detected — creating Paddle Subscription');

//         // Use Paddle subscription API for recurring plans
//         const paddleResult = await paddleService.createSubscription({
//           user_id: userId,
//           email: userEmail,
//           paddle_price_id: plan.paddle_price_id,
//           planId: planId,
//         });

//         console.log(`✅ Paddle Subscription Created: ${paddleResult.transaction_id}`);

//         // Save payment record
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, plan_id, external_payment_id, gateway, status, created_at)
//            VALUES ($1, $2, $3, $4, $5, NOW())`,
//           [userId, planId, paddleResult.transaction_id, 'paddle', 'pending']
//         );

//         return res.json({
//           success: true,
//           type: 'recurring',
//           paymentData: {
//             transaction_id: paddleResult.transaction_id,
//             checkout_url: paddleResult.checkout_url,
//             customer_id: paddleResult.customer_id,
//           },
//           gateway: 'paddle',
//           recommendation: result.recommendation,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//           },
//         });
//       }

//       res.json({
//         success: true,
//         type: 'one_time',
//         paymentData: result.payment,
//         gateway: result.gateway,
//         recommendation: result.recommendation,
//         splitNeeded: result.splitNeeded,
//         planDetails: {
//           id: plan.id,
//           name: plan.plan_name,
//           price: plan.price,
//           recurring: false,
//         },
//       });
//     } catch (error) {
//       console.error('Payment creation error:', error);
//       next(error);
//     }
//   },

//   // Get user payments
//   getUserPayments: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 20, offset = 0 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await paymentQueries.getUserPayments(
//         userId,
//         parseInt(limit),
//         parseInt(offset)
//       );

//       res.json({ success: true, payments: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Verify payment
//   verifyPayment: async (req, res, next) => {
//     try {
//       const { paymentId, gateway } = req.body;

//       let verification;

//       if (gateway === 'stripe') {
//         verification = await stripeService.verifyPayment(paymentId);
//       } else if (gateway === 'paddle') {
//         verification = await paddleService.verifyPayment(paymentId);
//       } else {
//         return res.status(400).json({ error: 'Invalid gateway' });
//       }

//       res.json({ success: true, verification });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // ========================================
//   // PAY-AS-YOU-GO ENDPOINTS
//   // ========================================

//   // Track usage for pay-as-you-go plans
//   trackUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { election_id, usage_type = 'election_created', quantity = 1 } = req.body;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       console.log('📊 Tracking usage:', { userId, election_id, usage_type, quantity });

//       const usage = await paymentService.trackUsage({
//         user_id: userId,
//         election_id,
//         usage_type,
//         quantity,
//       });

//       if (!usage) {
//         return res.json({
//           success: true,
//           message: 'User is on subscription plan, no usage tracking needed',
//         });
//       }

//       res.json({
//         success: true,
//         usage,
//         message: 'Usage tracked successfully',
//       });
//     } catch (error) {
//       console.error('Usage tracking error:', error);
//       next(error);
//     }
//   },

//   // Get unpaid usage (for billing)
//   getUnpaidUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const unpaidUsage = await paymentService.getUnpaidUsage(userId);

//       res.json({
//         success: true,
//         unpaidUsage,
//       });
//     } catch (error) {
//       console.error('Get unpaid usage error:', error);
//       next(error);
//     }
//   },

//   // Get current plan info (including usage for pay-as-you-go)
//   getCurrentPlan: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const planInfo = await paymentService.getCurrentPlan(userId);

//       if (!planInfo) {
//         return res.json({
//           success: true,
//           plan: null,
//           message: 'No active subscription',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planInfo,
//       });
//     } catch (error) {
//       console.error('Get current plan error:', error);
//       next(error);
//     }
//   },

//   // Get usage history for pay-as-you-go users
//   getUsageHistory: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 50 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const usageQueries = await import('../models/usageQueries.js');
//       const history = await usageQueries.usageQueries.getUserUsageHistory(
//         userId,
//         parseInt(limit)
//       );

//       res.json({
//         success: true,
//         history,
//       });
//     } catch (error) {
//       console.error('Get usage history error:', error);
//       next(error);
//     }
//   },

//   // ========================================
//   // ADMIN ENDPOINTS
//   // ========================================

//   getAllPlansAdmin: async (req, res, next) => {
//     try {
//       const result = await query(`
//         SELECT 
//           id,
//           plan_name,
//           description,
//           price,
//           duration_days,
//           stripe_price_id,
//           stripe_product_id,
//           payment_type,
//           is_recurring,
//           is_active,
//           what_included,
//           created_at,
//           updated_at
//         FROM votteryy_subscription_plans
//         ORDER BY 
//           CASE 
//             WHEN payment_type = 'pay_as_you_go' THEN 0
//             ELSE 1
//           END,
//           duration_days ASC
//       `);

//       res.json({
//         success: true,
//         plans: result.rows,
//         count: result.rows.length,
//       });
//     } catch (error) {
//       console.error('Get plans admin error:', error);
//       next(error);
//     }
//   },

//   updatePlanPriceAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const { newPrice } = req.body;

//       if (!newPrice || newPrice <= 0) {
//         return res.status(400).json({
//           success: false,
//           error: 'Price must be greater than 0',
//         });
//       }

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`🔧 Admin updating plan ${planId} price to $${newPrice}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       const result = await simplePlanUpdateService.updatePlanPrice(
//         parseInt(planId),
//         parseFloat(newPrice)
//       );

//       res.json(result);
//     } catch (error) {
//       console.error('Update plan price error:', error);
//       res.status(500).json({
//         success: false,
//         error: error.message,
//       });
//     }
//   },

//   getPlanByIdAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;

//       const planResult = await subscriptionQueries.getPlanById(parseInt(planId));

//       if (!planResult.rows[0]) {
//         return res.status(404).json({
//           success: false,
//           error: 'Plan not found',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planResult.rows[0],
//       });
//     } catch (error) {
//       console.error('Get plan by ID error:', error);
//       next(error);
//     }
//   },
// };
// //by chatgpt
// // backend/src/controllers/paymentController.js
// // Complete controller with recurring Stripe payments added + Paddle subscription support

// import { stripeService } from '../services/stripeService.js';
// import { paddleService } from '../services/paddleService.js';
// import { gatewayRouterService } from '../services/gatewayRouterService.js';
// import { paymentService } from '../services/paymentService.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { simplePlanUpdateService } from '../services/simplePlanUpdateService.js';
// import { query } from '../config/database.js';

// export const paymentController = {
//   // ========================================
//   // EXISTING ENDPOINTS
//   // ========================================

//   // Get gateway recommendation for country
//   getGatewayRecommendation: async (req, res, next) => {
//     try {
//       const { country_code, plan_id } = req.query;

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       const recommendation = await gatewayRouterService.getOptimalGateway(country_code, 'card');

//       res.json({
//         success: true,
//         recommendation,
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Create payment with country routing (handles pay-as-you-go + recurring)
//   createPayment: async (req, res, next) => {
//     try {
//       const { planId, country_code, payment_method, region } = req.body;
//       const userId = req.headers['x-user-id'];
//       const userEmail = req.headers['x-user-email'] || req.user?.email;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       // Get plan details
//       const planResult = await subscriptionQueries.getPlanById(planId);
//       if (!planResult.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       const plan = planResult.rows[0];

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('📥 Payment Request:');
//       console.log(`   User: ${userId}`);
//       console.log(`   Plan: ${plan.plan_name} (ID: ${planId})`);
//       console.log(`   Type: ${plan.payment_type || 'recurring'}`);
//       console.log(`   Country: ${country_code}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Check if pay-as-you-go
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('→ Routing to pay-as-you-go handler');
        
//         const result = await paymentService.handlePayAsYouGo({
//           user_id: userId,
//           plan,
//         });

//         return res.json(result);
//       }

//       // ===============================
//       // 🔁 Handle recurring plans (Stripe)
//       // ===============================
//       if (plan.is_recurring) {
//         console.log('🔁 Recurring plan detected — creating Stripe Subscription');

//         // Determine billing interval from duration_days
//         let interval = 'month';
//         let intervalCount = 1;

//         if (plan.duration_days === 90) intervalCount = 3;     // 3 months
//         else if (plan.duration_days === 180) intervalCount = 6; // 6 months
//         else if (plan.duration_days >= 360) interval = 'year';  // yearly

//         // Create subscription directly via Stripe
//         const { stripeClient } = await import('../config/gateways.js');

//         // Get or create Stripe customer
//         let customerId;
//         const userResult = await query(
//           'SELECT stripe_customer_id FROM votteryy_users WHERE id = $1',
//           [userId]
//         );
//         if (userResult.rows[0]?.stripe_customer_id) {
//           customerId = userResult.rows[0].stripe_customer_id;
//         } else {
//           const customer = await stripeClient.customers.create({
//             email: userEmail,
//             metadata: { userId },
//           });
//           customerId = customer.id;
//           await query(
//             'UPDATE votteryy_users SET stripe_customer_id = $1 WHERE id = $2',
//             [customerId, userId]
//           );
//         }

//         // If price exists in Stripe, use it. Otherwise create a new price.
//         let priceId = plan.stripe_price_id;
//         if (!priceId) {
//           const price = await stripeClient.prices.create({
//             unit_amount: Math.round(plan.price * 100),
//             currency: 'usd',
//             recurring: { interval, interval_count: intervalCount },
//             product: plan.stripe_product_id,
//           });
//           priceId = price.id;

//           // Save new price ID to DB
//           await query(
//             'UPDATE votteryy_subscription_plans SET stripe_price_id = $1 WHERE id = $2',
//             [priceId, planId]
//           );
//         }

//         // Create subscription
//         const subscription = await stripeClient.subscriptions.create({
//           customer: customerId,
//           items: [{ price: priceId }],
//           payment_behavior: 'default_incomplete',
//           expand: ['latest_invoice.payment_intent'],
//           metadata: { userId, planId, recurring: true },
//         });

//         // Save payment record
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, plan_id, external_payment_id, stripe_subscription_id, status, created_at)
//            VALUES ($1, $2, $3, $4, $5, NOW())`,
//           [
//             userId,
//             planId,
//             subscription.latest_invoice.payment_intent.id,
//             subscription.id,
//             'pending',
//           ]
//         );

//         console.log(`✅ Stripe Subscription Created: ${subscription.id}`);

//         return res.json({
//           success: true,
//           type: 'recurring',
//           client_secret: subscription.latest_invoice.payment_intent.client_secret,
//           subscription_id: subscription.id,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//             interval,
//             interval_count: intervalCount,
//           },
//         });
//       }

//       // ===============================
//       // 🧾 Non-recurring Stripe or Paddle
//       // ===============================
//       console.log('→ Routing to gateway router (non-recurring Stripe or Paddle)');

//       const paymentData = {
//         amount: plan.price,
//         currency: 'USD',
//         country_code: country_code.toUpperCase(),
//         region,
//         payment_method: payment_method || 'card',
//         user_id: userId,
//         email: userEmail,
//         planId,
//       };

//       const result = await gatewayRouterService.createPaymentByCountry(paymentData);

//       if (!result.success) {
//         return res.status(400).json(result);
//       }

//       // ✅ NEW: Check if selected gateway is Paddle and plan is recurring
//       if (result.gateway === 'paddle' && plan.payment_type === 'recurring') {
//         console.log('🔁 Paddle recurring plan detected — creating Paddle Subscription');

//         // Use Paddle subscription API for recurring plans
//         const paddleResult = await paddleService.createSubscription({
//           user_id: userId,
//           email: userEmail,
//           paddle_price_id: plan.paddle_price_id,
//           planId: planId,
//         });

//         console.log(`✅ Paddle Subscription Created: ${paddleResult.transaction_id}`);

//         // Save payment record
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, plan_id, external_payment_id, gateway, status, created_at)
//            VALUES ($1, $2, $3, $4, $5, NOW())`,
//           [userId, planId, paddleResult.transaction_id, 'paddle', 'pending']
//         );

//         return res.json({
//           success: true,
//           type: 'recurring',
//           paymentData: {
//             transaction_id: paddleResult.transaction_id,
//             checkout_url: paddleResult.checkout_url,
//             customer_id: paddleResult.customer_id,
//           },
//           gateway: 'paddle',
//           recommendation: result.recommendation,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//           },
//         });
//       }

//       res.json({
//         success: true,
//         type: 'one_time',
//         paymentData: result.payment,
//         gateway: result.gateway,
//         recommendation: result.recommendation,
//         splitNeeded: result.splitNeeded,
//         planDetails: {
//           id: plan.id,
//           name: plan.plan_name,
//           price: plan.price,
//           recurring: false,
//         },
//       });
//     } catch (error) {
//       console.error('Payment creation error:', error);
//       next(error);
//     }
//   },

//   // Get user payments
//   getUserPayments: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 20, offset = 0 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await paymentQueries.getUserPayments(
//         userId,
//         parseInt(limit),
//         parseInt(offset)
//       );

//       res.json({ success: true, payments: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Verify payment
//   verifyPayment: async (req, res, next) => {
//     try {
//       const { paymentId, gateway } = req.body;

//       let verification;

//       if (gateway === 'stripe') {
//         verification = await stripeService.verifyPayment(paymentId);
//       } else if (gateway === 'paddle') {
//         verification = await paddleService.verifyPayment(paymentId);
//       } else {
//         return res.status(400).json({ error: 'Invalid gateway' });
//       }

//       res.json({ success: true, verification });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // ========================================
//   // PAY-AS-YOU-GO ENDPOINTS
//   // ========================================

//   // Track usage for pay-as-you-go plans
//   trackUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { election_id, usage_type = 'election_created', quantity = 1 } = req.body;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       console.log('📊 Tracking usage:', { userId, election_id, usage_type, quantity });

//       const usage = await paymentService.trackUsage({
//         user_id: userId,
//         election_id,
//         usage_type,
//         quantity,
//       });

//       if (!usage) {
//         return res.json({
//           success: true,
//           message: 'User is on subscription plan, no usage tracking needed',
//         });
//       }

//       res.json({
//         success: true,
//         usage,
//         message: 'Usage tracked successfully',
//       });
//     } catch (error) {
//       console.error('Usage tracking error:', error);
//       next(error);
//     }
//   },

//   // Get unpaid usage (for billing)
//   getUnpaidUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const unpaidUsage = await paymentService.getUnpaidUsage(userId);

//       res.json({
//         success: true,
//         unpaidUsage,
//       });
//     } catch (error) {
//       console.error('Get unpaid usage error:', error);
//       next(error);
//     }
//   },

//   // Get current plan info (including usage for pay-as-you-go)
//   getCurrentPlan: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const planInfo = await paymentService.getCurrentPlan(userId);

//       if (!planInfo) {
//         return res.json({
//           success: true,
//           plan: null,
//           message: 'No active subscription',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planInfo,
//       });
//     } catch (error) {
//       console.error('Get current plan error:', error);
//       next(error);
//     }
//   },

//   // Get usage history for pay-as-you-go users
//   getUsageHistory: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 50 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const usageQueries = await import('../models/usageQueries.js');
//       const history = await usageQueries.usageQueries.getUserUsageHistory(
//         userId,
//         parseInt(limit)
//       );

//       res.json({
//         success: true,
//         history,
//       });
//     } catch (error) {
//       console.error('Get usage history error:', error);
//       next(error);
//     }
//   },

//   // ========================================
//   // ADMIN ENDPOINTS
//   // ========================================

//   getAllPlansAdmin: async (req, res, next) => {
//     try {
//       const result = await query(`
//         SELECT 
//           id,
//           plan_name,
//           description,
//           price,
//           duration_days,
//           stripe_price_id,
//           stripe_product_id,
//           payment_type,
//           is_recurring,
//           is_active,
//           what_included,
//           created_at,
//           updated_at
//         FROM votteryy_subscription_plans
//         ORDER BY 
//           CASE 
//             WHEN payment_type = 'pay_as_you_go' THEN 0
//             ELSE 1
//           END,
//           duration_days ASC
//       `);

//       res.json({
//         success: true,
//         plans: result.rows,
//         count: result.rows.length,
//       });
//     } catch (error) {
//       console.error('Get plans admin error:', error);
//       next(error);
//     }
//   },

//   updatePlanPriceAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const { newPrice } = req.body;

//       if (!newPrice || newPrice <= 0) {
//         return res.status(400).json({
//           success: false,
//           error: 'Price must be greater than 0',
//         });
//       }

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`🔧 Admin updating plan ${planId} price to $${newPrice}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       const result = await simplePlanUpdateService.updatePlanPrice(
//         parseInt(planId),
//         parseFloat(newPrice)
//       );

//       res.json(result);
//     } catch (error) {
//       console.error('Update plan price error:', error);
//       res.status(500).json({
//         success: false,
//         error: error.message,
//       });
//     }
//   },

//   getPlanByIdAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;

//       const planResult = await subscriptionQueries.getPlanById(parseInt(planId));

//       if (!planResult.rows[0]) {
//         return res.status(404).json({
//           success: false,
//           error: 'Plan not found',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planResult.rows[0],
//       });
//     } catch (error) {
//       console.error('Get plan by ID error:', error);
//       next(error);
//     }
//   },
// };
// //by chatgpt
// // backend/src/controllers/paymentController.js
// // Complete controller with recurring Stripe payments added

// import { stripeService } from '../services/stripeService.js';
// import { paddleService } from '../services/paddleService.js';
// import { gatewayRouterService } from '../services/gatewayRouterService.js';
// import { paymentService } from '../services/paymentService.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { simplePlanUpdateService } from '../services/simplePlanUpdateService.js';
// import { query } from '../config/database.js';

// export const paymentController = {
//   // ========================================
//   // EXISTING ENDPOINTS
//   // ========================================

//   // Get gateway recommendation for country
//   getGatewayRecommendation: async (req, res, next) => {
//     try {
//       const { country_code, plan_id } = req.query;

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       const recommendation = await gatewayRouterService.getOptimalGateway(country_code, 'card');

//       res.json({
//         success: true,
//         recommendation,
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Create payment with country routing (handles pay-as-you-go + recurring)
//   createPayment: async (req, res, next) => {
//     try {
//       const { planId, country_code, payment_method, region } = req.body;
//       const userId = req.headers['x-user-id'];
//       const userEmail = req.headers['x-user-email'] || req.user?.email;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       // Get plan details
//       const planResult = await subscriptionQueries.getPlanById(planId);
//       if (!planResult.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       const plan = planResult.rows[0];

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('📥 Payment Request:');
//       console.log(`   User: ${userId}`);
//       console.log(`   Plan: ${plan.plan_name} (ID: ${planId})`);
//       console.log(`   Type: ${plan.payment_type || 'recurring'}`);
//       console.log(`   Country: ${country_code}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Check if pay-as-you-go
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('→ Routing to pay-as-you-go handler');
        
//         const result = await paymentService.handlePayAsYouGo({
//           user_id: userId,
//           plan,
//         });

//         return res.json(result);
//       }

//       // ===============================
//       // 🔁 Handle recurring plans (Stripe)
//       // ===============================
//       if (plan.is_recurring) {
//         console.log('🔁 Recurring plan detected — creating Stripe Subscription');

//         // Determine billing interval from duration_days
//         let interval = 'month';
//         let intervalCount = 1;

//         if (plan.duration_days === 90) intervalCount = 3;     // 3 months
//         else if (plan.duration_days === 180) intervalCount = 6; // 6 months
//         else if (plan.duration_days >= 360) interval = 'year';  // yearly

//         // Create subscription directly via Stripe
//         const { stripeClient } = await import('../config/gateways.js');

//         // Get or create Stripe customer
//         let customerId;
//         const userResult = await query(
//           'SELECT stripe_customer_id FROM votteryy_users WHERE id = $1',
//           [userId]
//         );
//         if (userResult.rows[0]?.stripe_customer_id) {
//           customerId = userResult.rows[0].stripe_customer_id;
//         } else {
//           const customer = await stripeClient.customers.create({
//             email: userEmail,
//             metadata: { userId },
//           });
//           customerId = customer.id;
//           await query(
//             'UPDATE votteryy_users SET stripe_customer_id = $1 WHERE id = $2',
//             [customerId, userId]
//           );
//         }

//         // If price exists in Stripe, use it. Otherwise create a new price.
//         let priceId = plan.stripe_price_id;
//         if (!priceId) {
//           const price = await stripeClient.prices.create({
//             unit_amount: Math.round(plan.price * 100),
//             currency: 'usd',
//             recurring: { interval, interval_count: intervalCount },
//             product: plan.stripe_product_id,
//           });
//           priceId = price.id;

//           // Save new price ID to DB
//           await query(
//             'UPDATE votteryy_subscription_plans SET stripe_price_id = $1 WHERE id = $2',
//             [priceId, planId]
//           );
//         }

//         // Create subscription
//         const subscription = await stripeClient.subscriptions.create({
//           customer: customerId,
//           items: [{ price: priceId }],
//           payment_behavior: 'default_incomplete',
//           expand: ['latest_invoice.payment_intent'],
//           metadata: { userId, planId, recurring: true },
//         });

//         // Save payment record
//         await query(
//           `INSERT INTO votteryy_payments 
//             (user_id, plan_id, external_payment_id, stripe_subscription_id, status, created_at)
//            VALUES ($1, $2, $3, $4, $5, NOW())`,
//           [
//             userId,
//             planId,
//             subscription.latest_invoice.payment_intent.id,
//             subscription.id,
//             'pending',
//           ]
//         );

//         console.log(`✅ Stripe Subscription Created: ${subscription.id}`);

//         return res.json({
//           success: true,
//           type: 'recurring',
//           client_secret: subscription.latest_invoice.payment_intent.client_secret,
//           subscription_id: subscription.id,
//           planDetails: {
//             id: plan.id,
//             name: plan.plan_name,
//             price: plan.price,
//             recurring: true,
//             interval,
//             interval_count: intervalCount,
//           },
//         });
//       }

//       // ===============================
//       // 🧾 Non-recurring Stripe or Paddle
//       // ===============================
//       console.log('→ Routing to gateway router (non-recurring Stripe or Paddle)');

//       const paymentData = {
//         amount: plan.price,
//         currency: 'USD',
//         country_code: country_code.toUpperCase(),
//         region,
//         payment_method: payment_method || 'card',
//         user_id: userId,
//         email: userEmail,
//         planId,
//       };

//       const result = await gatewayRouterService.createPaymentByCountry(paymentData);

//       if (!result.success) {
//         return res.status(400).json(result);
//       }

//       res.json({
//         success: true,
//         type: 'one_time',
//         paymentData: result.payment,
//         gateway: result.gateway,
//         recommendation: result.recommendation,
//         splitNeeded: result.splitNeeded,
//         planDetails: {
//           id: plan.id,
//           name: plan.plan_name,
//           price: plan.price,
//           recurring: false,
//         },
//       });
//     } catch (error) {
//       console.error('Payment creation error:', error);
//       next(error);
//     }
//   },

//   // Get user payments
//   getUserPayments: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 20, offset = 0 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await paymentQueries.getUserPayments(
//         userId,
//         parseInt(limit),
//         parseInt(offset)
//       );

//       res.json({ success: true, payments: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Verify payment
//   verifyPayment: async (req, res, next) => {
//     try {
//       const { paymentId, gateway } = req.body;

//       let verification;

//       if (gateway === 'stripe') {
//         verification = await stripeService.verifyPayment(paymentId);
//       } else if (gateway === 'paddle') {
//         verification = await paddleService.verifyPayment(paymentId);
//       } else {
//         return res.status(400).json({ error: 'Invalid gateway' });
//       }

//       res.json({ success: true, verification });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // ========================================
//   // PAY-AS-YOU-GO ENDPOINTS
//   // ========================================

//   // Track usage for pay-as-you-go plans
//   trackUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { election_id, usage_type = 'election_created', quantity = 1 } = req.body;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       console.log('📊 Tracking usage:', { userId, election_id, usage_type, quantity });

//       const usage = await paymentService.trackUsage({
//         user_id: userId,
//         election_id,
//         usage_type,
//         quantity,
//       });

//       if (!usage) {
//         return res.json({
//           success: true,
//           message: 'User is on subscription plan, no usage tracking needed',
//         });
//       }

//       res.json({
//         success: true,
//         usage,
//         message: 'Usage tracked successfully',
//       });
//     } catch (error) {
//       console.error('Usage tracking error:', error);
//       next(error);
//     }
//   },

//   // Get unpaid usage (for billing)
//   getUnpaidUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const unpaidUsage = await paymentService.getUnpaidUsage(userId);

//       res.json({
//         success: true,
//         unpaidUsage,
//       });
//     } catch (error) {
//       console.error('Get unpaid usage error:', error);
//       next(error);
//     }
//   },

//   // Get current plan info (including usage for pay-as-you-go)
//   getCurrentPlan: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const planInfo = await paymentService.getCurrentPlan(userId);

//       if (!planInfo) {
//         return res.json({
//           success: true,
//           plan: null,
//           message: 'No active subscription',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planInfo,
//       });
//     } catch (error) {
//       console.error('Get current plan error:', error);
//       next(error);
//     }
//   },

//   // Get usage history for pay-as-you-go users
//   getUsageHistory: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 50 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const usageQueries = await import('../models/usageQueries.js');
//       const history = await usageQueries.usageQueries.getUserUsageHistory(
//         userId,
//         parseInt(limit)
//       );

//       res.json({
//         success: true,
//         history,
//       });
//     } catch (error) {
//       console.error('Get usage history error:', error);
//       next(error);
//     }
//   },

//   // ========================================
//   // ADMIN ENDPOINTS
//   // ========================================

//   getAllPlansAdmin: async (req, res, next) => {
//     try {
//       const result = await query(`
//         SELECT 
//           id,
//           plan_name,
//           description,
//           price,
//           duration_days,
//           stripe_price_id,
//           stripe_product_id,
//           payment_type,
//           is_recurring,
//           is_active,
//           what_included,
//           created_at,
//           updated_at
//         FROM votteryy_subscription_plans
//         ORDER BY 
//           CASE 
//             WHEN payment_type = 'pay_as_you_go' THEN 0
//             ELSE 1
//           END,
//           duration_days ASC
//       `);

//       res.json({
//         success: true,
//         plans: result.rows,
//         count: result.rows.length,
//       });
//     } catch (error) {
//       console.error('Get plans admin error:', error);
//       next(error);
//     }
//   },

//   updatePlanPriceAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const { newPrice } = req.body;

//       if (!newPrice || newPrice <= 0) {
//         return res.status(400).json({
//           success: false,
//           error: 'Price must be greater than 0',
//         });
//       }

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`🔧 Admin updating plan ${planId} price to $${newPrice}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       const result = await simplePlanUpdateService.updatePlanPrice(
//         parseInt(planId),
//         parseFloat(newPrice)
//       );

//       res.json(result);
//     } catch (error) {
//       console.error('Update plan price error:', error);
//       res.status(500).json({
//         success: false,
//         error: error.message,
//       });
//     }
//   },

//   getPlanByIdAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;

//       const planResult = await subscriptionQueries.getPlanById(parseInt(planId));

//       if (!planResult.rows[0]) {
//         return res.status(404).json({
//           success: false,
//           error: 'Plan not found',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planResult.rows[0],
//       });
//     } catch (error) {
//       console.error('Get plan by ID error:', error);
//       next(error);
//     }
//   },
// };

// // backend/src/controllers/paymentController.js
// // Complete controller with all existing functionality + admin methods

// import { stripeService } from '../services/stripeService.js';
// import { paddleService } from '../services/paddleService.js';
// import { gatewayRouterService } from '../services/gatewayRouterService.js';
// import { paymentService } from '../services/paymentService.js';
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { simplePlanUpdateService } from '../services/simplePlanUpdateService.js';
// import { query } from '../config/database.js';

// export const paymentController = {
//   // ========================================
//   // EXISTING ENDPOINTS
//   // ========================================

//   // Get gateway recommendation for country
//   getGatewayRecommendation: async (req, res, next) => {
//     try {
//       const { country_code, plan_id } = req.query;

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       const recommendation = await gatewayRouterService.getOptimalGateway(country_code, 'card');

//       res.json({
//         success: true,
//         recommendation,
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Create payment with country routing (handles pay-as-you-go + recurring)
//   createPayment: async (req, res, next) => {
//     try {
//       const { planId, country_code, payment_method, region } = req.body;
//       const userId = req.headers['x-user-id'];
//       const userEmail = req.headers['x-user-email'] || req.user?.email;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       // Get plan details
//       const planResult = await subscriptionQueries.getPlanById(planId);
//       if (!planResult.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       const plan = planResult.rows[0];

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('📥 Payment Request:');
//       console.log(`   User: ${userId}`);
//       console.log(`   Plan: ${plan.plan_name} (ID: ${planId})`);
//       console.log(`   Type: ${plan.payment_type || 'recurring'}`);
//       console.log(`   Country: ${country_code}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // Check if pay-as-you-go
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('→ Routing to pay-as-you-go handler');
        
//         const result = await paymentService.handlePayAsYouGo({
//           user_id: userId,
//           plan,
//         });

//         return res.json(result);
//       }

//       // Use gateway router for recurring/one-time payments
//       console.log('→ Routing to gateway router (existing logic)');

//       const paymentData = {
//         amount: plan.price,
//         currency: 'USD',
//         country_code: country_code.toUpperCase(),
//         region,
//         payment_method: payment_method || 'card',
//         user_id: userId,
//         email: userEmail,
//         planId,
//       };

//       const result = await gatewayRouterService.createPaymentByCountry(paymentData);

//       if (!result.success) {
//         return res.status(400).json(result);
//       }

//       res.json({
//         success: true,
//         type: plan.is_recurring ? 'recurring' : 'one_time',
//         paymentData: result.payment,
//         gateway: result.gateway,
//         recommendation: result.recommendation,
//         splitNeeded: result.splitNeeded,
//         planDetails: {
//           id: plan.id,
//           name: plan.plan_name,
//           price: plan.price,
//           recurring: plan.is_recurring,
//         },
//       });
//     } catch (error) {
//       console.error('Payment creation error:', error);
//       next(error);
//     }
//   },

//   // Get user payments
//   getUserPayments: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 20, offset = 0 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await paymentQueries.getUserPayments(
//         userId,
//         parseInt(limit),
//         parseInt(offset)
//       );

//       res.json({ success: true, payments: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Verify payment
//   verifyPayment: async (req, res, next) => {
//     try {
//       const { paymentId, gateway } = req.body;

//       let verification;

//       if (gateway === 'stripe') {
//         verification = await stripeService.verifyPayment(paymentId);
//       } else if (gateway === 'paddle') {
//         verification = await paddleService.verifyPayment(paymentId);
//       } else {
//         return res.status(400).json({ error: 'Invalid gateway' });
//       }

//       res.json({ success: true, verification });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // ========================================
//   // PAY-AS-YOU-GO ENDPOINTS
//   // ========================================

//   // Track usage for pay-as-you-go plans
//   trackUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { election_id, usage_type = 'election_created', quantity = 1 } = req.body;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       console.log('📊 Tracking usage:', { userId, election_id, usage_type, quantity });

//       const usage = await paymentService.trackUsage({
//         user_id: userId,
//         election_id,
//         usage_type,
//         quantity,
//       });

//       if (!usage) {
//         return res.json({
//           success: true,
//           message: 'User is on subscription plan, no usage tracking needed',
//         });
//       }

//       res.json({
//         success: true,
//         usage,
//         message: 'Usage tracked successfully',
//       });
//     } catch (error) {
//       console.error('Usage tracking error:', error);
//       next(error);
//     }
//   },

//   // Get unpaid usage (for billing)
//   getUnpaidUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const unpaidUsage = await paymentService.getUnpaidUsage(userId);

//       res.json({
//         success: true,
//         unpaidUsage,
//       });
//     } catch (error) {
//       console.error('Get unpaid usage error:', error);
//       next(error);
//     }
//   },

//   // Get current plan info (including usage for pay-as-you-go)
//   getCurrentPlan: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const planInfo = await paymentService.getCurrentPlan(userId);

//       if (!planInfo) {
//         return res.json({
//           success: true,
//           plan: null,
//           message: 'No active subscription',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planInfo,
//       });
//     } catch (error) {
//       console.error('Get current plan error:', error);
//       next(error);
//     }
//   },

//   // Get usage history for pay-as-you-go users
//   getUsageHistory: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 50 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const usageQueries = await import('../models/usageQueries.js');
//       const history = await usageQueries.usageQueries.getUserUsageHistory(
//         userId,
//         parseInt(limit)
//       );

//       res.json({
//         success: true,
//         history,
//       });
//     } catch (error) {
//       console.error('Get usage history error:', error);
//       next(error);
//     }
//   },

//   // ========================================
//   // ADMIN ENDPOINTS
//   // ========================================

//   /**
//    * Get all plans (for admin panel)
//    * GET /api/v1/payments/admin/plans
//    */
//   getAllPlansAdmin: async (req, res, next) => {
//     try {
//       const result = await query(`
//         SELECT 
//           id,
//           plan_name,
//           description,
//           price,
//           duration_days,
//           stripe_price_id,
//           stripe_product_id,
//           payment_type,
//           is_recurring,
//           is_active,
//           what_included,
//           created_at,
//           updated_at
//         FROM votteryy_subscription_plans
//         ORDER BY 
//           CASE 
//             WHEN payment_type = 'pay_as_you_go' THEN 0
//             ELSE 1
//           END,
//           duration_days ASC
//       `);

//       res.json({
//         success: true,
//         plans: result.rows,
//         count: result.rows.length,
//       });
//     } catch (error) {
//       console.error('Get plans admin error:', error);
//       next(error);
//     }
//   },

//   /**
//    * Update plan price (admin only)
//    * POST /api/v1/payments/admin/plans/:planId/update-price
//    */
//   updatePlanPriceAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const { newPrice } = req.body;

//       // Validation
//       if (!newPrice || newPrice <= 0) {
//         return res.status(400).json({
//           success: false,
//           error: 'Price must be greater than 0',
//         });
//       }

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`🔧 Admin updating plan ${planId} price to $${newPrice}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       const result = await simplePlanUpdateService.updatePlanPrice(
//         parseInt(planId),
//         parseFloat(newPrice)
//       );

//       res.json(result);
//     } catch (error) {
//       console.error('Update plan price error:', error);
//       res.status(500).json({
//         success: false,
//         error: error.message,
//       });
//     }
//   },

//   /**
//    * Get single plan details (admin)
//    * GET /api/v1/payments/admin/plans/:planId
//    */
//   getPlanByIdAdmin: async (req, res, next) => {
//     try {
//       const { planId } = req.params;

//       const planResult = await subscriptionQueries.getPlanById(parseInt(planId));

//       if (!planResult.rows[0]) {
//         return res.status(404).json({
//           success: false,
//           error: 'Plan not found',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planResult.rows[0],
//       });
//     } catch (error) {
//       console.error('Get plan by ID error:', error);
//       next(error);
//     }
//   },
// };
// // backend/src/controllers/paymentController.js
// // Merged version: Keeps ALL existing functionality + adds pay-as-you-go

// import { stripeService } from '../services/stripeService.js';
// import { paddleService } from '../services/paddleService.js';
// import { gatewayRouterService } from '../services/gatewayRouterService.js';
// import { paymentService } from '../services/paymentService.js'; // NEW
// import { paymentQueries } from '../models/paymentQueries.js';
// import { subscriptionQueries } from '../models/subscriptionQueries.js';

// export const paymentController = {
//   // ========================================
//   // EXISTING ENDPOINTS (Keep as-is)
//   // ========================================

//   // Get gateway recommendation for country
//   getGatewayRecommendation: async (req, res, next) => {
//     try {
//       const { country_code, plan_id } = req.query;

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       const recommendation = await gatewayRouterService.getOptimalGateway(country_code, 'card');

//       res.json({
//         success: true,
//         recommendation,
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Create payment with country routing (UPDATED to handle pay-as-you-go)
//   createPayment: async (req, res, next) => {
//     try {
//       const { planId, country_code, payment_method, region } = req.body;
//       const userId = req.headers['x-user-id'];
//       const userEmail = req.headers['x-user-email'] || req.user?.email;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       if (!country_code) {
//         return res.status(400).json({ error: 'Country code required' });
//       }

//       // Get plan details
//       const planResult = await subscriptionQueries.getPlanById(planId);
//       if (!planResult.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       const plan = planResult.rows[0];

//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log('📥 Payment Request:');
//       console.log(`   User: ${userId}`);
//       console.log(`   Plan: ${plan.plan_name} (ID: ${planId})`);
//       console.log(`   Type: ${plan.payment_type || 'recurring'}`);
//       console.log(`   Country: ${country_code}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       // NEW: Check if pay-as-you-go
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('→ Routing to pay-as-you-go handler');
        
//         const result = await paymentService.handlePayAsYouGo({
//           user_id: userId,
//           plan,
//         });

//         return res.json(result);
//       }

//       // EXISTING: Use gateway router for recurring/one-time payments
//       console.log('→ Routing to gateway router (existing logic)');

//       const paymentData = {
//         amount: plan.price,
//         currency: 'USD',
//         country_code: country_code.toUpperCase(),
//         region,
//         payment_method: payment_method || 'card',
//         user_id: userId,
//         email: userEmail,
//         planId,
//       };

//       const result = await gatewayRouterService.createPaymentByCountry(paymentData);

//       if (!result.success) {
//         return res.status(400).json(result);
//       }

//       res.json({
//         success: true,
//         type: plan.is_recurring ? 'recurring' : 'one_time',
//         paymentData: result.payment,
//         gateway: result.gateway,
//         recommendation: result.recommendation,
//         splitNeeded: result.splitNeeded,
//         planDetails: {
//           id: plan.id,
//           name: plan.plan_name,
//           price: plan.price,
//           recurring: plan.is_recurring,
//         },
//       });
//     } catch (error) {
//       console.error('Payment creation error:', error);
//       next(error);
//     }
//   },

//   // Get user payments
//   getUserPayments: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 20, offset = 0 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await paymentQueries.getUserPayments(
//         userId,
//         parseInt(limit),
//         parseInt(offset)
//       );

//       res.json({ success: true, payments: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Verify payment
//   verifyPayment: async (req, res, next) => {
//     try {
//       const { paymentId, gateway } = req.body;

//       let verification;

//       if (gateway === 'stripe') {
//         verification = await stripeService.verifyPayment(paymentId);
//       } else if (gateway === 'paddle') {
//         verification = await paddleService.verifyPayment(paymentId);
//       } else {
//         return res.status(400).json({ error: 'Invalid gateway' });
//       }

//       res.json({ success: true, verification });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // ========================================
//   // NEW ENDPOINTS (Pay-as-you-go)
//   // ========================================

//   // Track usage for pay-as-you-go plans
//   trackUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { election_id, usage_type = 'election_created', quantity = 1 } = req.body;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       console.log('📊 Tracking usage:', { userId, election_id, usage_type, quantity });

//       const usage = await paymentService.trackUsage({
//         user_id: userId,
//         election_id,
//         usage_type,
//         quantity,
//       });

//       if (!usage) {
//         // User is not on pay-as-you-go plan
//         return res.json({
//           success: true,
//           message: 'User is on subscription plan, no usage tracking needed',
//         });
//       }

//       res.json({
//         success: true,
//         usage,
//         message: 'Usage tracked successfully',
//       });
//     } catch (error) {
//       console.error('Usage tracking error:', error);
//       next(error);
//     }
//   },

//   // Get unpaid usage (for billing)
//   getUnpaidUsage: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const unpaidUsage = await paymentService.getUnpaidUsage(userId);

//       res.json({
//         success: true,
//         unpaidUsage,
//       });
//     } catch (error) {
//       console.error('Get unpaid usage error:', error);
//       next(error);
//     }
//   },

//   // Get current plan info (including usage for pay-as-you-go)
//   getCurrentPlan: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const planInfo = await paymentService.getCurrentPlan(userId);

//       if (!planInfo) {
//         return res.json({
//           success: true,
//           plan: null,
//           message: 'No active subscription',
//         });
//       }

//       res.json({
//         success: true,
//         plan: planInfo,
//       });
//     } catch (error) {
//       console.error('Get current plan error:', error);
//       next(error);
//     }
//   },

//   // Get usage history for pay-as-you-go users
//   getUsageHistory: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 50 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const usageQueries = await import('../models/usageQueries.js');
//       const history = await usageQueries.usageQueries.getUserUsageHistory(
//         userId,
//         parseInt(limit)
//       );

//       res.json({
//         success: true,
//         history,
//       });
//     } catch (error) {
//       console.error('Get usage history error:', error);
//       next(error);
//     }
//   },
// };




