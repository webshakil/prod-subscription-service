import { subscriptionQueries } from '../models/subscriptionQueries.js';
import { regionalPricingQueries } from '../models/regionalPricingQueries.js';

export const subscriptionController = {
  // Get all subscription plans
  getAllPlans: async (req, res, next) => {
    try {
      const result = await subscriptionQueries.getAllPlans();
      res.json({ success: true, plans: result.rows });
    } catch (error) {
      next(error);
    }
  },

  // Get plan by ID
  getPlanById: async (req, res, next) => {
    try {
      const { planId } = req.params;
      const result = await subscriptionQueries.getPlanById(planId);

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      res.json({ success: true, plan: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },

  // Create subscription plan (Admin only)
  createPlan: async (req, res, next) => {
    try {
      const data = req.body;
      const result = await subscriptionQueries.createPlan(data);

      res.status(201).json({
        success: true,
        plan: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  },

  // Update only editable fields (max_elections, max_voters_per_election, processing_fee_mandatory, processing_fee_fixed_amount, processing_fee_type, processing_fee_percentage)
  updateEditableFields: async (req, res, next) => {
    try {
      const { planId } = req.params;
      const { max_elections, max_voters_per_election, processing_fee_mandatory, processing_fee_fixed_amount, processing_fee_type, processing_fee_percentage } = req.body;

      // Validate that only allowed fields are being updated
      const allowedFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount', 'processing_fee_type', 'processing_fee_percentage'];
      const providedFields = Object.keys(req.body);
      
      const invalidFields = providedFields.filter(field => !allowedFields.includes(field));
      if (invalidFields.length > 0) {
        return res.status(400).json({ 
          error: `Invalid fields: ${invalidFields.join(', ')}. Only these fields can be edited: ${allowedFields.join(', ')}` 
        });
      }

      const result = await subscriptionQueries.updateEditableFields(planId, {
        max_elections,
        max_voters_per_election,
        processing_fee_mandatory,
        processing_fee_fixed_amount,
        processing_fee_type,
        processing_fee_percentage
      });

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      res.json({ 
        success: true, 
        message: 'Editable fields updated successfully',
        plan: result.rows[0] 
      });
    } catch (error) {
      next(error);
    }
  },

  // Update subscription plan (Admin only) - for non-editable fields
  updatePlan: async (req, res, next) => {
    try {
      const { planId } = req.params;
      const data = req.body;

      // Prevent updating editable fields through this endpoint
      const editableFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount', 'processing_fee_type', 'processing_fee_percentage'];
      const providedFields = Object.keys(data);
      
      const hasEditableFields = providedFields.some(field => editableFields.includes(field));
      if (hasEditableFields) {
        return res.status(400).json({ 
          error: 'Use /plans/:planId/editable-fields endpoint to update: max_elections, max_voters_per_election, processing_fee_mandatory, processing_fee_fixed_amount, processing_fee_type, processing_fee_percentage' 
        });
      }

      const result = await subscriptionQueries.updatePlan(planId, data);

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      res.json({ success: true, plan: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },

  // Get user current subscription
  getUserSubscription: async (req, res, next) => {
    try {
      const userId = req.headers['x-user-id'];

      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      const result = await subscriptionQueries.getUserSubscription(userId);

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'No active subscription found' });
      }

      res.json({ success: true, subscription: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },

  // Check if user has valid subscription
  checkSubscriptionValid: async (req, res, next) => {
    try {
      const userId = req.headers['x-user-id'];

      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      const result = await subscriptionQueries.checkSubscriptionValid(userId);

      res.json({
        success: true,
        isValid: result.rows.length > 0,
        subscription: result.rows[0] || null,
      });
    } catch (error) {
      next(error);
    }
  },

  // Get subscription history
  getSubscriptionHistory: async (req, res, next) => {
    try {
      const userId = req.headers['x-user-id'];
      const { limit = 10, offset = 0 } = req.query;

      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      const result = await subscriptionQueries.getSubscriptionHistory(
        userId,
        parseInt(limit),
        parseInt(offset)
      );

      res.json({ success: true, history: result.rows });
    } catch (error) {
      next(error);
    }
  },

  // Get plan regional prices
  getPlanRegionalPrices: async (req, res, next) => {
    try {
      const { planId } = req.params;
      const result = await regionalPricingQueries.getPlanRegionalPrices(planId);

      res.json({ success: true, prices: result.rows });
    } catch (error) {
      next(error);
    }
  },

  // Set regional prices for plan (Admin only)
  setRegionalPrices: async (req, res, next) => {
    try {
      const { planId } = req.params;
      const { prices } = req.body;

      await regionalPricingQueries.batchSetRegionalPrices(planId, prices);

      res.json({ success: true, message: 'Regional prices updated' });
    } catch (error) {
      next(error);
    }
  },
};
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { regionalPricingQueries } from '../models/regionalPricingQueries.js';

// export const subscriptionController = {
//   // Get all subscription plans
//   getAllPlans: async (req, res, next) => {
//     try {
//       const result = await subscriptionQueries.getAllPlans();
//       res.json({ success: true, plans: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Get plan by ID
//   getPlanById: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const result = await subscriptionQueries.getPlanById(planId);

//       if (!result.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       res.json({ success: true, plan: result.rows[0] });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Create subscription plan (Admin only)
//   createPlan: async (req, res, next) => {
//     try {
//       const data = req.body;
//       const result = await subscriptionQueries.createPlan(data);

//       res.status(201).json({
//         success: true,
//         plan: result.rows[0],
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Update only editable fields (max_elections, max_voters_per_election, processing_fee_mandatory, processing_fee_fixed_amount)
//   updateEditableFields: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const { max_elections, max_voters_per_election, processing_fee_mandatory, processing_fee_fixed_amount } = req.body;

//       // Validate that only allowed fields are being updated
//       const allowedFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount'];
//       const providedFields = Object.keys(req.body);
      
//       const invalidFields = providedFields.filter(field => !allowedFields.includes(field));
//       if (invalidFields.length > 0) {
//         return res.status(400).json({ 
//           error: `Invalid fields: ${invalidFields.join(', ')}. Only these fields can be edited: ${allowedFields.join(', ')}` 
//         });
//       }

//       const result = await subscriptionQueries.updateEditableFields(planId, {
//         max_elections,
//         max_voters_per_election,
//         processing_fee_mandatory,
//         processing_fee_fixed_amount

//       });

//       if (!result.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       res.json({ 
//         success: true, 
//         message: 'Editable fields updated successfully',
//         plan: result.rows[0] 
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Update subscription plan (Admin only) - for non-editable fields
//   updatePlan: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const data = req.body;

//       // Prevent updating editable fields through this endpoint
//       const editableFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount'];
//       const providedFields = Object.keys(data);
      
//       const hasEditableFields = providedFields.some(field => editableFields.includes(field));
//       if (hasEditableFields) {
//         return res.status(400).json({ 
//           error: 'Use /plans/:planId/editable-fields endpoint to update: max_elections, max_voters_per_election, processing_fee_mandatory, processing_fee_fixed_amount' 
//         });
//       }

//       const result = await subscriptionQueries.updatePlan(planId, data);

//       if (!result.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       res.json({ success: true, plan: result.rows[0] });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Get user current subscription
//   getUserSubscription: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await subscriptionQueries.getUserSubscription(userId);

//       if (!result.rows[0]) {
//         return res.status(404).json({ error: 'No active subscription found' });
//       }

//       res.json({ success: true, subscription: result.rows[0] });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Check if user has valid subscription
//   checkSubscriptionValid: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await subscriptionQueries.checkSubscriptionValid(userId);

//       res.json({
//         success: true,
//         isValid: result.rows.length > 0,
//         subscription: result.rows[0] || null,
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Get subscription history
//   getSubscriptionHistory: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 10, offset = 0 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await subscriptionQueries.getSubscriptionHistory(
//         userId,
//         parseInt(limit),
//         parseInt(offset)
//       );

//       res.json({ success: true, history: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Get plan regional prices
//   getPlanRegionalPrices: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const result = await regionalPricingQueries.getPlanRegionalPrices(planId);

//       res.json({ success: true, prices: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Set regional prices for plan (Admin only)
//   setRegionalPrices: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const { prices } = req.body;

//       await regionalPricingQueries.batchSetRegionalPrices(planId, prices);

//       res.json({ success: true, message: 'Regional prices updated' });
//     } catch (error) {
//       next(error);
//     }
//   },
// };
//last working codes
// import { subscriptionQueries } from '../models/subscriptionQueries.js';
// import { regionalPricingQueries } from '../models/regionalPricingQueries.js';

// export const subscriptionController = {
//   // Get all subscription plans
//   getAllPlans: async (req, res, next) => {
//     try {
//       const result = await subscriptionQueries.getAllPlans();
//       res.json({ success: true, plans: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Get plan by ID
//   getPlanById: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const result = await subscriptionQueries.getPlanById(planId);

//       if (!result.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       res.json({ success: true, plan: result.rows[0] });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Create subscription plan (Admin only)
//   createPlan: async (req, res, next) => {
//     try {
//       const data = req.body;
//       const result = await subscriptionQueries.createPlan(data);

//       res.status(201).json({
//         success: true,
//         plan: result.rows[0],
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Update subscription plan (Admin only)
//   updatePlan: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const data = req.body;

//       const result = await subscriptionQueries.updatePlan(planId, data);

//       if (!result.rows[0]) {
//         return res.status(404).json({ error: 'Plan not found' });
//       }

//       res.json({ success: true, plan: result.rows[0] });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Get user current subscription
//   getUserSubscription: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await subscriptionQueries.getUserSubscription(userId);

//       if (!result.rows[0]) {
//         return res.status(404).json({ error: 'No active subscription found' });
//       }

//       res.json({ success: true, subscription: result.rows[0] });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Check if user has valid subscription
//   checkSubscriptionValid: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await subscriptionQueries.checkSubscriptionValid(userId);

//       res.json({
//         success: true,
//         isValid: result.rows.length > 0,
//         subscription: result.rows[0] || null,
//       });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Get subscription history
//   getSubscriptionHistory: async (req, res, next) => {
//     try {
//       const userId = req.headers['x-user-id'];
//       const { limit = 10, offset = 0 } = req.query;

//       if (!userId) {
//         return res.status(401).json({ error: 'User ID required' });
//       }

//       const result = await subscriptionQueries.getSubscriptionHistory(
//         userId,
//         parseInt(limit),
//         parseInt(offset)
//       );

//       res.json({ success: true, history: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Get plan regional prices
//   getPlanRegionalPrices: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const result = await regionalPricingQueries.getPlanRegionalPrices(planId);

//       res.json({ success: true, prices: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Set regional prices for plan (Admin only)
//   setRegionalPrices: async (req, res, next) => {
//     try {
//       const { planId } = req.params;
//       const { prices } = req.body;

//       await regionalPricingQueries.batchSetRegionalPrices(planId, prices);

//       res.json({ success: true, message: 'Regional prices updated' });
//     } catch (error) {
//       next(error);
//     }
//   },
// };