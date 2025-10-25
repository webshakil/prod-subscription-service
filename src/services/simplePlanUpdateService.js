//by chatgpt
// backend/src/services/simplePlanUpdateService.js
// Service to update or create recurring Stripe plans (monthly, 3-month, 6-month, yearly)

import { stripeClient } from '../config/gateways.js';
import { query } from '../config/database.js';

export const simplePlanUpdateService = {
  /**
   * Update plan price - Creates new recurring Stripe price and updates database
   */
  updatePlanPrice: async (planId, newPrice) => {
    try {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`💰 Updating Plan ${planId} to $${newPrice}`);

      // Fetch plan from DB
      const planResult = await query(
        'SELECT * FROM votteryy_subscription_plans WHERE id = $1',
        [planId]
      );

      if (planResult.rows.length === 0) {
        throw new Error('Plan not found');
      }

      const plan = planResult.rows[0];

      // If Pay-as-you-go → no Stripe recurring logic
      if (plan.payment_type === 'pay_as_you_go') {
        console.log('⚠️ Pay-as-you-go plan - updating DB only');

        await query(
          `UPDATE votteryy_subscription_plans 
           SET price = $1, updated_at = NOW()
           WHERE id = $2`,
          [newPrice, planId]
        );

        console.log('✅ Database updated (pay-as-you-go)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        return {
          success: true,
          message: 'Pay-as-you-go plan updated successfully',
          plan: {
            id: planId,
            name: plan.plan_name,
            old_price: plan.price,
            new_price: newPrice,
            payment_type: 'pay_as_you_go',
          },
        };
      }

      // 🧩 Determine recurring interval
      const { interval, intervalCount } = simplePlanUpdateService.getIntervalFromDays(
        plan.duration_days
      );

      // 🧱 Ensure Stripe product exists
      let productId = plan.stripe_product_id;
      if (!productId) {
        const product = await stripeClient.products.create({
          name: plan.plan_name,
          description: plan.description || `${plan.plan_name} subscription`,
        });
        productId = product.id;
        console.log(`✅ Created Stripe Product: ${productId}`);
      }

      // 💰 Create recurring Stripe price
      const stripePrice = await stripeClient.prices.create({
        product: productId,
        unit_amount: Math.round(newPrice * 100), // Stripe uses cents
        currency: 'usd',
        recurring: {
          interval,
          interval_count: intervalCount,
        },
      });

      console.log(
        `✅ Created Stripe Price: ${stripePrice.id} ($${newPrice}/${intervalCount} ${interval})`
      );

      // 🗃️ Update DB with new Stripe info
      await query(
        `UPDATE votteryy_subscription_plans 
         SET 
           price = $1,
           stripe_price_id = $2,
           stripe_product_id = $3,
           updated_at = NOW()
         WHERE id = $4`,
        [newPrice, stripePrice.id, productId, planId]
      );

      console.log('✅ Database updated');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return {
        success: true,
        message: 'Recurring plan price updated successfully',
        plan: {
          id: planId,
          name: plan.plan_name,
          old_price: plan.price,
          new_price: newPrice,
          stripe_price_id: stripePrice.id,
          stripe_product_id: productId,
          interval,
          interval_count: intervalCount,
        },
      };
    } catch (error) {
      console.error('❌ Update price error:', error);
      throw error;
    }
  },

  /**
   * Helper: Convert duration_days → Stripe interval mapping
   * Supports monthly, 3-month, 6-month, and yearly billing
   */
  getIntervalFromDays: (days) => {
    switch (days) {
      case 30: // Monthly
        return { interval: 'month', intervalCount: 1 };
      case 90: // 3 months
        return { interval: 'month', intervalCount: 3 };
      case 180: // 6 months
        return { interval: 'month', intervalCount: 6 };
      case 365: // Yearly
      case 366:
        return { interval: 'year', intervalCount: 1 };
      default:
        // Fallback to monthly if undefined duration
        const months = Math.max(1, Math.round(days / 30));
        return { interval: 'month', intervalCount: months };
    }
  },
};

// // // backend/src/services/simplePlanUpdateService.js
// // backend/src/services/simplePlanUpdateService.js
// // Service to update plan prices (creates new Stripe price and updates database)

// import { stripeClient } from '../config/gateways.js';
// import { query } from '../config/database.js';

// export const simplePlanUpdateService = {
//   /**
//    * Update plan price - Creates new Stripe price and updates database
//    */
//   updatePlanPrice: async (planId, newPrice) => {
//     try {
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`💰 Updating Plan ${planId} to $${newPrice}`);

//       // Get current plan
//       const planResult = await query(
//         'SELECT * FROM votteryy_subscription_plans WHERE id = $1',
//         [planId]
//       );

//       if (planResult.rows.length === 0) {
//         throw new Error('Plan not found');
//       }

//       const plan = planResult.rows[0];

//       // Skip Stripe for pay-as-you-go plans
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('⚠️  Pay-as-you-go plan - updating database only (no Stripe)');
        
//         await query(
//           `UPDATE votteryy_subscription_plans 
//            SET price = $1, updated_at = NOW()
//            WHERE id = $2`,
//           [newPrice, planId]
//         );

//         console.log('✅ Database updated (pay-as-you-go)');
//         console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//         return {
//           success: true,
//           message: 'Pay-as-you-go price updated successfully',
//           plan: {
//             id: planId,
//             name: plan.plan_name,
//             old_price: plan.price,
//             new_price: newPrice,
//             payment_type: 'pay_as_you_go',
//           },
//         };
//       }

//       // For recurring plans, update Stripe
//       const { interval, intervalCount } = simplePlanUpdateService.getIntervalFromDays(
//         plan.duration_days
//       );

//       // Get or create Stripe product
//       let productId = plan.stripe_product_id;

//       if (!productId) {
//         const product = await stripeClient.products.create({
//           name: plan.plan_name,
//           description: plan.description || `${plan.plan_name} subscription`,
//         });
//         productId = product.id;
//         console.log(`✅ Created Stripe Product: ${productId}`);
//       }

//       // Create new Stripe price
//       const stripePrice = await stripeClient.prices.create({
//         product: productId,
//         unit_amount: Math.round(newPrice * 100), // Convert to cents
//         currency: 'usd',
//         recurring: {
//           interval: interval,
//           interval_count: intervalCount,
//         },
//       });

//       console.log(`✅ Created Stripe Price: ${stripePrice.id} ($${newPrice}/${interval})`);

//       // Update database
//       await query(
//         `UPDATE votteryy_subscription_plans 
//          SET 
//            price = $1,
//            stripe_price_id = $2,
//            stripe_product_id = $3,
//            updated_at = NOW()
//          WHERE id = $4`,
//         [newPrice, stripePrice.id, productId, planId]
//       );

//       console.log('✅ Database updated');
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       return {
//         success: true,
//         message: 'Price updated successfully',
//         plan: {
//           id: planId,
//           name: plan.plan_name,
//           old_price: plan.price,
//           new_price: newPrice,
//           stripe_price_id: stripePrice.id,
//           stripe_product_id: productId,
//         },
//       };
//     } catch (error) {
//       console.error('Update price error:', error);
//       throw error;
//     }
//   },

//   /**
//    * Helper: Convert duration_days to Stripe interval
//    */
//   getIntervalFromDays: (days) => {
//     if (days === 1) return { interval: 'day', intervalCount: 1 };
//     if (days === 7) return { interval: 'week', intervalCount: 1 };
//     if (days === 30) return { interval: 'month', intervalCount: 1 };
//     if (days === 90) return { interval: 'month', intervalCount: 3 };
//     if (days === 180) return { interval: 'month', intervalCount: 6 };
//     if (days === 365) return { interval: 'year', intervalCount: 1 };
    
//     // Default to monthly
//     return { interval: 'month', intervalCount: Math.round(days / 30) };
//   },
// };

// // backend/src/services/simplePlanUpdateService.js
// // SIMPLE VERSION THAT WAS WORKING

// import { stripeClient } from '../config/gateways.js';
// import { query } from '../config/database.js';

// export const simplePlanUpdateService = {
//   /**
//    * Update plan price - Creates new Stripe price and updates database
//    */
//   updatePlanPrice: async (planId, newPrice) => {
//     try {
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`💰 Updating Plan ${planId} to $${newPrice}`);

//       // Get current plan
//       const planResult = await query(
//         'SELECT * FROM votteryy_subscription_plans WHERE id = $1',
//         [planId]
//       );

//       if (planResult.rows.length === 0) {
//         throw new Error('Plan not found');
//       }

//       const plan = planResult.rows[0];

//       // Skip Stripe for pay-as-you-go plans
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('⚠️  Pay-as-you-go plan - updating database only (no Stripe)');
        
//         await query(
//           `UPDATE votteryy_subscription_plans 
//            SET price = $1, updated_at = NOW()
//            WHERE id = $2`,
//           [newPrice, planId]
//         );

//         console.log('✅ Database updated (pay-as-you-go)');
//         console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//         return {
//           success: true,
//           message: 'Pay-as-you-go price updated successfully',
//           plan: {
//             id: planId,
//             name: plan.plan_name,
//             old_price: plan.price,
//             new_price: newPrice,
//             payment_type: 'pay_as_you_go',
//           },
//         };
//       }

//       // For recurring plans, update Stripe
//       const { interval, intervalCount } = simplePlanUpdateService.getIntervalFromDays(
//         plan.duration_days
//       );

//       // Get or create Stripe product
//       let productId = plan.stripe_product_id;

//       if (!productId) {
//         const product = await stripeClient.products.create({
//           name: plan.plan_name,
//           description: plan.description || `${plan.plan_name} subscription`,
//         });
//         productId = product.id;
//         console.log(`✅ Created Stripe Product: ${productId}`);
//       }

//       // Create new Stripe price
//       const stripePrice = await stripeClient.prices.create({
//         product: productId,
//         unit_amount: Math.round(newPrice * 100), // Convert to cents
//         currency: 'usd',
//         recurring: {
//           interval: interval,
//           interval_count: intervalCount,
//         },
//       });

//       console.log(`✅ Created Stripe Price: ${stripePrice.id} ($${newPrice}/${interval})`);

//       // Update database
//       await query(
//         `UPDATE votteryy_subscription_plans 
//          SET 
//            price = $1,
//            stripe_price_id = $2,
//            stripe_product_id = $3,
//            updated_at = NOW()
//          WHERE id = $4`,
//         [newPrice, stripePrice.id, productId, planId]
//       );

//       console.log('✅ Database updated');
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       return {
//         success: true,
//         message: 'Price updated successfully',
//         plan: {
//           id: planId,
//           name: plan.plan_name,
//           old_price: plan.price,
//           new_price: newPrice,
//           stripe_price_id: stripePrice.id,
//           stripe_product_id: productId,
//         },
//       };
//     } catch (error) {
//       console.error('Update price error:', error);
//       throw error;
//     }
//   },

//   /**
//    * Helper: Convert duration_days to Stripe interval
//    */
//   getIntervalFromDays: (days) => {
//     if (days === 1) return { interval: 'day', intervalCount: 1 };
//     if (days === 7) return { interval: 'week', intervalCount: 1 };
//     if (days === 30) return { interval: 'month', intervalCount: 1 };
//     if (days === 90) return { interval: 'month', intervalCount: 3 };
//     if (days === 180) return { interval: 'month', intervalCount: 6 };
//     if (days === 365) return { interval: 'year', intervalCount: 1 };
    
//     // Default to monthly
//     return { interval: 'month', intervalCount: Math.round(days / 30) };
//   },
// };













// // backend/src/services/simplePlanUpdateService.js
// // FIXED: Creates unique Stripe products based on plan_id to avoid conflicts

// import { stripeClient } from '../config/gateways.js';
// import { query } from '../config/database.js';

// export const simplePlanUpdateService = {
//   /**
//    * Update plan price - Creates unique Stripe product per plan_id
//    */
//   updatePlanPrice: async (planId, newPrice) => {
//     try {
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`💰 Updating Plan ${planId} to $${newPrice}`);

//       // Get current plan
//       const planResult = await query(
//         'SELECT * FROM votteryy_subscription_plans WHERE id = $1',
//         [planId]
//       );

//       if (planResult.rows.length === 0) {
//         throw new Error('Plan not found');
//       }

//       const plan = planResult.rows[0];

//       // Skip Stripe for pay-as-you-go plans
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('⚠️  Pay-as-you-go plan - updating database only (no Stripe)');
        
//         await query(
//           `UPDATE votteryy_subscription_plans 
//            SET price = $1, updated_at = NOW()
//            WHERE id = $2`,
//           [newPrice, planId]
//         );

//         console.log('✅ Database updated (pay-as-you-go)');
//         console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//         return {
//           success: true,
//           message: 'Pay-as-you-go price updated successfully',
//           plan: {
//             id: planId,
//             name: plan.plan_name,
//             old_price: plan.price,
//             new_price: newPrice,
//             payment_type: 'pay_as_you_go',
//           },
//         };
//       }

//       // For recurring plans, update Stripe
//       const { interval, intervalCount } = simplePlanUpdateService.getIntervalFromDays(
//         plan.duration_days
//       );

//       let productId = plan.stripe_product_id;

//       // ✅ FIX: If product exists, verify it matches this plan
//       if (productId) {
//         try {
//           const existingProduct = await stripeClient.products.retrieve(productId);
          
//           // Check if product metadata matches this plan_id
//           if (existingProduct.metadata?.plan_id === planId.toString()) {
//             console.log(`✅ Reusing existing Stripe Product: ${productId}`);
            
//             // Update product name to match current plan name
//             await stripeClient.products.update(productId, {
//               name: plan.plan_name,
//               description: plan.description || `${plan.plan_name} subscription`,
//             });
//           } else {
//             // Product belongs to different plan, create new one
//             console.log(`⚠️  Product ${productId} belongs to different plan, creating new one`);
//             productId = null;
//           }
//         } catch (error) {
//           // Product doesn't exist in Stripe anymore, create new one
//           console.log('⚠️  Stripe product not found, creating new one');
//           productId = null;
//         }
//       }

//       // Create new product if needed
//       if (!productId) {
//         const product = await stripeClient.products.create({
//           name: plan.plan_name,
//           description: plan.description || `${plan.plan_name} subscription`,
//           metadata: {
//             plan_id: planId.toString(), // ✅ Critical: Track which plan this product belongs to
//             plan_name: plan.plan_name,
//           },
//         });
//         productId = product.id;
//         console.log(`✅ Created NEW Stripe Product: ${productId}`);
//         console.log(`   Name: ${plan.plan_name}`);
//         console.log(`   Plan ID: ${planId}`);
//       }

//       // Create new price (Stripe requirement - prices can't be edited)
//       const stripePrice = await stripeClient.prices.create({
//         product: productId,
//         unit_amount: Math.round(newPrice * 100), // Convert to cents
//         currency: 'usd',
//         recurring: {
//           interval: interval,
//           interval_count: intervalCount,
//         },
//         metadata: {
//           plan_id: planId.toString(),
//           plan_name: plan.plan_name,
//         },
//       });

//       console.log(`✅ Created NEW Stripe Price: ${stripePrice.id} ($${newPrice}/${interval})`);

//       // Update database
//       await query(
//         `UPDATE votteryy_subscription_plans 
//          SET 
//            price = $1,
//            stripe_price_id = $2,
//            stripe_product_id = $3,
//            updated_at = NOW()
//          WHERE id = $4`,
//         [newPrice, stripePrice.id, productId, planId]
//       );

//       console.log('✅ Database updated');
//       console.log(`   Plan ID: ${planId}`);
//       console.log(`   Product ID: ${productId}`);
//       console.log(`   Price ID: ${stripePrice.id}`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       return {
//         success: true,
//         message: 'Price updated successfully',
//         plan: {
//           id: planId,
//           name: plan.plan_name,
//           old_price: plan.price,
//           new_price: newPrice,
//           stripe_price_id: stripePrice.id,
//           stripe_product_id: productId,
//         },
//       };
//     } catch (error) {
//       console.error('Update price error:', error);
//       throw error;
//     }
//   },

//   /**
//    * Helper: Convert duration_days to Stripe interval
//    */
//   getIntervalFromDays: (days) => {
//     if (days === 1) return { interval: 'day', intervalCount: 1 };
//     if (days === 7) return { interval: 'week', intervalCount: 1 };
//     if (days === 30) return { interval: 'month', intervalCount: 1 };
//     if (days === 90) return { interval: 'month', intervalCount: 3 };
//     if (days === 180) return { interval: 'month', intervalCount: 6 };
//     if (days === 365) return { interval: 'year', intervalCount: 1 };
    
//     // Default to monthly
//     return { interval: 'month', intervalCount: Math.round(days / 30) };
//   },
// };






// backend/src/services/simplePlanUpdateService.js
// FIXED: Reuses existing Stripe product instead of creating duplicates

// import { stripeClient } from '../config/gateways.js';
// import { query } from '../config/database.js';

// export const simplePlanUpdateService = {
//   /**
//    * Update plan price - Reuses existing Stripe product, creates new price
//    */
//   updatePlanPrice: async (planId, newPrice) => {
//     try {
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`💰 Updating Plan ${planId} to $${newPrice}`);

//       // Get current plan
//       const planResult = await query(
//         'SELECT * FROM votteryy_subscription_plans WHERE id = $1',
//         [planId]
//       );

//       if (planResult.rows.length === 0) {
//         throw new Error('Plan not found');
//       }

//       const plan = planResult.rows[0];

//       // Skip Stripe for pay-as-you-go plans
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('⚠️  Pay-as-you-go plan - updating database only (no Stripe)');
        
//         await query(
//           `UPDATE votteryy_subscription_plans 
//            SET price = $1, updated_at = NOW()
//            WHERE id = $2`,
//           [newPrice, planId]
//         );

//         console.log('✅ Database updated (pay-as-you-go)');
//         console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//         return {
//           success: true,
//           message: 'Pay-as-you-go price updated successfully',
//           plan: {
//             id: planId,
//             name: plan.plan_name,
//             old_price: plan.price,
//             new_price: newPrice,
//             payment_type: 'pay_as_you_go',
//           },
//         };
//       }

//       // For recurring plans, update Stripe
//       const { interval, intervalCount } = simplePlanUpdateService.getIntervalFromDays(
//         plan.duration_days
//       );

//       // ✅ FIX: Reuse existing Stripe product OR create new one
//       let productId = plan.stripe_product_id;

//       if (productId) {
//         // Product exists - verify it's still active in Stripe
//         try {
//           const existingProduct = await stripeClient.products.retrieve(productId);
//           console.log(`✅ Reusing existing Stripe Product: ${productId}`);
          
//           // Update product name if needed
//           if (existingProduct.name !== plan.plan_name) {
//             await stripeClient.products.update(productId, {
//               name: plan.plan_name,
//             });
//             console.log(`   Updated product name to: ${plan.plan_name}`);
//           }
//         } catch (error) {
//           // Product doesn't exist in Stripe anymore, create new one
//           console.log('⚠️  Stripe product not found, creating new one');
//           productId = null;
//         }
//       }

//       // Create new product if needed
//       if (!productId) {
//         const product = await stripeClient.products.create({
//           name: plan.plan_name,
//           description: plan.description || `${plan.plan_name} subscription`,
//           metadata: {
//             plan_id: planId.toString(),
//           },
//         });
//         productId = product.id;
//         console.log(`✅ Created NEW Stripe Product: ${productId}`);
//       }

//       // ✅ Always create NEW price (Stripe requirement - prices can't be edited)
//       const stripePrice = await stripeClient.prices.create({
//         product: productId,
//         unit_amount: Math.round(newPrice * 100), // Convert to cents
//         currency: 'usd',
//         recurring: {
//           interval: interval,
//           interval_count: intervalCount,
//         },
//         metadata: {
//           plan_id: planId.toString(),
//         },
//       });

//       console.log(`✅ Created NEW Stripe Price: ${stripePrice.id} ($${newPrice}/${interval})`);

//       // Update database with new price ID (keep same product ID)
//       await query(
//         `UPDATE votteryy_subscription_plans 
//          SET 
//            price = $1,
//            stripe_price_id = $2,
//            stripe_product_id = $3,
//            updated_at = NOW()
//          WHERE id = $4`,
//         [newPrice, stripePrice.id, productId, planId]
//       );

//       console.log('✅ Database updated');
//       console.log(`   Product ID: ${productId} (reused)`);
//       console.log(`   Price ID: ${stripePrice.id} (new)`);
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       return {
//         success: true,
//         message: 'Price updated successfully',
//         plan: {
//           id: planId,
//           name: plan.plan_name,
//           old_price: plan.price,
//           new_price: newPrice,
//           stripe_price_id: stripePrice.id,
//           stripe_product_id: productId,
//         },
//       };
//     } catch (error) {
//       console.error('Update price error:', error);
//       throw error;
//     }
//   },

//   /**
//    * Helper: Convert duration_days to Stripe interval
//    */
//   getIntervalFromDays: (days) => {
//     if (days === 1) return { interval: 'day', intervalCount: 1 };
//     if (days === 7) return { interval: 'week', intervalCount: 1 };
//     if (days === 30) return { interval: 'month', intervalCount: 1 };
//     if (days === 90) return { interval: 'month', intervalCount: 3 };
//     if (days === 180) return { interval: 'month', intervalCount: 6 };
//     if (days === 365) return { interval: 'year', intervalCount: 1 };
    
//     // Default to monthly
//     return { interval: 'month', intervalCount: Math.round(days / 30) };
//   },

//   /**
//    * Clean up duplicate products in Stripe (optional utility)
//    */
//   cleanupDuplicateProducts: async (planName) => {
//     try {
//       console.log(`🧹 Cleaning up duplicate products for: ${planName}`);

//       // Find all products with this name
//       const products = await stripeClient.products.list({
//         limit: 100,
//       });

//       const duplicates = products.data.filter(p => p.name === planName);

//       if (duplicates.length <= 1) {
//         console.log('✅ No duplicates found');
//         return { duplicates: 0 };
//       }

//       console.log(`Found ${duplicates.length} products with name "${planName}"`);
      
//       // Keep the newest one, archive the rest
//       const sorted = duplicates.sort((a, b) => b.created - a.created);
//       const keepProduct = sorted[0];
//       const archiveProducts = sorted.slice(1);

//       for (const product of archiveProducts) {
//         await stripeClient.products.update(product.id, {
//           active: false,
//         });
//         console.log(`   Archived old product: ${product.id}`);
//       }

//       console.log(`✅ Kept product: ${keepProduct.id}`);
//       console.log(`✅ Archived ${archiveProducts.length} duplicate(s)`);

//       return {
//         kept: keepProduct.id,
//         archived: archiveProducts.length,
//       };
//     } catch (error) {
//       console.error('Cleanup error:', error);
//       throw error;
//     }
//   },
// };




// // backend/src/services/simplePlanUpdateService.js
// // Service to update plan prices (creates new Stripe price and updates database)

// import { stripeClient } from '../config/gateways.js';
// import { query } from '../config/database.js';

// export const simplePlanUpdateService = {
//   /**
//    * Update plan price - Creates new Stripe price and updates database
//    */
//   updatePlanPrice: async (planId, newPrice) => {
//     try {
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
//       console.log(`💰 Updating Plan ${planId} to $${newPrice}`);

//       // Get current plan
//       const planResult = await query(
//         'SELECT * FROM votteryy_subscription_plans WHERE id = $1',
//         [planId]
//       );

//       if (planResult.rows.length === 0) {
//         throw new Error('Plan not found');
//       }

//       const plan = planResult.rows[0];

//       // Skip Stripe for pay-as-you-go plans
//       if (plan.payment_type === 'pay_as_you_go') {
//         console.log('⚠️  Pay-as-you-go plan - updating database only (no Stripe)');
        
//         await query(
//           `UPDATE votteryy_subscription_plans 
//            SET price = $1, updated_at = NOW()
//            WHERE id = $2`,
//           [newPrice, planId]
//         );

//         console.log('✅ Database updated (pay-as-you-go)');
//         console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//         return {
//           success: true,
//           message: 'Pay-as-you-go price updated successfully',
//           plan: {
//             id: planId,
//             name: plan.plan_name,
//             old_price: plan.price,
//             new_price: newPrice,
//             payment_type: 'pay_as_you_go',
//           },
//         };
//       }

//       // For recurring plans, update Stripe
//       const { interval, intervalCount } = simplePlanUpdateService.getIntervalFromDays(
//         plan.duration_days
//       );

//       // Get or create Stripe product
//       let productId = plan.stripe_product_id;

//       if (!productId) {
//         const product = await stripeClient.products.create({
//           name: plan.plan_name,
//           description: plan.description || `${plan.plan_name} subscription`,
//         });
//         productId = product.id;
//         console.log(`✅ Created Stripe Product: ${productId}`);
//       }

//       // Create new Stripe price
//       const stripePrice = await stripeClient.prices.create({
//         product: productId,
//         unit_amount: Math.round(newPrice * 100), // Convert to cents
//         currency: 'usd',
//         recurring: {
//           interval: interval,
//           interval_count: intervalCount,
//         },
//       });

//       console.log(`✅ Created Stripe Price: ${stripePrice.id} ($${newPrice}/${interval})`);

//       // Update database
//       await query(
//         `UPDATE votteryy_subscription_plans 
//          SET 
//            price = $1,
//            stripe_price_id = $2,
//            stripe_product_id = $3,
//            updated_at = NOW()
//          WHERE id = $4`,
//         [newPrice, stripePrice.id, productId, planId]
//       );

//       console.log('✅ Database updated');
//       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

//       return {
//         success: true,
//         message: 'Price updated successfully',
//         plan: {
//           id: planId,
//           name: plan.plan_name,
//           old_price: plan.price,
//           new_price: newPrice,
//           stripe_price_id: stripePrice.id,
//           stripe_product_id: productId,
//         },
//       };
//     } catch (error) {
//       console.error('Update price error:', error);
//       throw error;
//     }
//   },

//   /**
//    * Helper: Convert duration_days to Stripe interval
//    */
//   getIntervalFromDays: (days) => {
//     if (days === 1) return { interval: 'day', intervalCount: 1 };
//     if (days === 7) return { interval: 'week', intervalCount: 1 };
//     if (days === 30) return { interval: 'month', intervalCount: 1 };
//     if (days === 90) return { interval: 'month', intervalCount: 3 };
//     if (days === 180) return { interval: 'month', intervalCount: 6 };
//     if (days === 365) return { interval: 'year', intervalCount: 1 };
    
//     // Default to monthly
//     return { interval: 'month', intervalCount: Math.round(days / 30) };
//   },
// };