//last workable code
import { query } from '../config/database.js';

export const subscriptionQueries = {
  // Create subscription plan
  createPlan: async (data) => {
    const sql = `
      INSERT INTO votteryy_subscription_plans 
      (plan_name, plan_type, price, duration_days, billing_cycle, max_elections, max_voters_per_election, 
       processing_fee_mandatory, processing_fee_type, processing_fee_fixed_amount, processing_fee_percentage,
       processing_fee_enabled, description, what_included, what_excluded, is_active, display_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *;
    `;
    return query(sql, [
      data.plan_name,
      data.plan_type,
      data.price,
      data.duration_days,
      data.billing_cycle,
      data.max_elections || null,
      data.max_voters_per_election || null,
      data.processing_fee_mandatory || false,
      data.processing_fee_type,
      data.processing_fee_fixed_amount || null,
      data.processing_fee_percentage || null,
      data.processing_fee_enabled || false,
      data.description,
      data.what_included,
      data.what_excluded,
      true,
      data.display_order || 0
    ]);
  },

  // Get all plans
  getAllPlans: async () => {
    const sql = `
      SELECT id, plan_name, plan_type, price, duration_days, billing_cycle, max_elections, 
             max_voters_per_election, processing_fee_mandatory, processing_fee_type, 
             processing_fee_fixed_amount, processing_fee_percentage, processing_fee_enabled,
             description, what_included, what_excluded, display_order, 
             payment_type, paddle_price_id, paddle_product_id, 
             stripe_price_id, stripe_product_id, created_at 
      FROM votteryy_subscription_plans 
      WHERE is_active = true 
      ORDER BY display_order ASC;
    `;
    return query(sql, []);
  },

  // Get plan by ID - ✅ FIXED: Added all payment gateway columns
  getPlanById: async (planId) => {
    const sql = `
      SELECT 
        id, 
        plan_name, 
        plan_type, 
        price, 
        duration_days, 
        billing_cycle, 
        max_elections, 
        max_voters_per_election, 
        processing_fee_mandatory, 
        processing_fee_type, 
        processing_fee_fixed_amount, 
        processing_fee_percentage, 
        processing_fee_enabled,
        description, 
        what_included, 
        what_excluded, 
        is_active, 
        display_order,
        payment_type,
        paddle_price_id,
        paddle_product_id,
        stripe_price_id,
        stripe_product_id,
        created_at, 
        updated_at
      FROM votteryy_subscription_plans 
      WHERE id = $1;
    `;
    return query(sql, [planId]);
  },

  // Update only editable fields
  updateEditableFields: async (planId, data) => {
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Only allow specific fields to be updated
    const allowedFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount', 'processing_fee_type', 'processing_fee_percentage'];
    
    Object.entries(data).forEach(([key, value]) => {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = $${paramCount++}`);
        values.push(value);
      }
    });

    if (fields.length === 0) {
      throw new Error('No valid fields provided for update');
    }

    fields.push(`updated_at = NOW()`);
    values.push(planId);
    
    const sql = `
      UPDATE votteryy_subscription_plans 
      SET ${fields.join(', ')} 
      WHERE id = $${paramCount} 
      RETURNING *;
    `;
    return query(sql, values);
  },

  // Update plan (for non-editable fields)
  updatePlan: async (planId, data) => {
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Exclude editable fields
    const excludeFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount', 'processing_fee_type', 'processing_fee_percentage', 'id'];

    Object.entries(data).forEach(([key, value]) => {
      if (!excludeFields.includes(key)) {
        fields.push(`${key} = $${paramCount++}`);
        values.push(value);
      }
    });

    if (fields.length === 0) {
      throw new Error('No valid fields provided for update');
    }

    fields.push(`updated_at = NOW()`);
    values.push(planId);
    
    const sql = `
      UPDATE votteryy_subscription_plans 
      SET ${fields.join(', ')} 
      WHERE id = $${paramCount} 
      RETURNING *;
    `;
    return query(sql, values);
  },

  // Create or update user subscription
  createOrUpdateSubscription: async (data) => {
    const sql = `
      INSERT INTO votteryy_user_subscriptions 
      (user_id, plan_id, gateway_used, external_subscription_id, status, 
       start_date, end_date, auto_renew)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, external_subscription_id) 
      DO UPDATE SET
        status = EXCLUDED.status,
        end_date = EXCLUDED.end_date,
        updated_at = NOW()
      RETURNING *;
    `;
    return query(sql, [
      data.user_id,
      data.plan_id,
      data.gateway || data.gateway_used,
      data.external_subscription_id,
      data.status || 'active',
      data.start_date || new Date(),
      data.end_date,
      data.auto_renew ?? true,
      
    ]);
  },

  // Create user subscription
  createUserSubscription: async (data) => {
    const sql = `
      INSERT INTO votteryy_user_subscriptions 
      (user_id, plan_id, gateway_used, external_subscription_id, status, 
       start_date, end_date, auto_renew)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    return query(sql, [
      data.user_id,
      data.plan_id,
      data.gateway_used,
      data.external_subscription_id,
      'active',
      new Date(),
      data.end_date,
      data.auto_renew || true
    ]);
  },

  // Get user subscription
  // Get user subscription
getUserSubscription: async (userId) => {
  const sql = `
    SELECT 
      us.id,
      us.user_id,
      us.plan_id,
      us.status,
      us.start_date,
      us.end_date,
      us.gateway_used as gateway,
      us.payment_type,
      us.auto_renew,
      us.external_subscription_id,
      sp.plan_name,
      sp.price as amount,
      sp.billing_cycle,
      'USD' as currency,
      EXTRACT(DAY FROM (us.end_date - NOW()))::INTEGER as days_remaining,
      us.created_at,
      us.updated_at
    FROM votteryy_user_subscriptions us
    JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
    WHERE us.user_id = $1 AND us.status = $2
    ORDER BY us.created_at DESC LIMIT 1;
  `;
  return query(sql, [userId, 'active']);
},


  // Update subscription status
  updateSubscriptionStatus: async (subscriptionId, status) => {
    const sql = `
      UPDATE votteryy_user_subscriptions 
      SET status = $1 
      WHERE id = $2 
      RETURNING *;
    `;
    return query(sql, [status, subscriptionId]);
  },

  // Check subscription validity
  checkSubscriptionValid: async (userId) => {
    const sql = `
      SELECT us.*, sp.* FROM votteryy_user_subscriptions us
      JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
      WHERE us.user_id = $1 AND us.status = $2 AND us.end_date > NOW()
      LIMIT 1;
    `;
    return query(sql, [userId, 'active']);
  },

  // Get subscription history
  getSubscriptionHistory: async (userId, limit = 10, offset = 0) => {
    const sql = `
      SELECT us.*, sp.plan_name FROM votteryy_user_subscriptions us
      JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
      WHERE us.user_id = $1
      ORDER BY us.created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    return query(sql, [userId, limit, offset]);
  },


  //two new functions
  updateSubscription: async (subscriptionId, data) => {
  const fields = [];
  const values = [];
  let paramCount = 1;

  // Build dynamic update query
  Object.entries(data).forEach(([key, value]) => {
    if (key !== 'id') {
      fields.push(`${key} = $${paramCount++}`);
      values.push(value);
    }
  });

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  fields.push(`updated_at = NOW()`);
  values.push(subscriptionId);

  const sql = `
    UPDATE votteryy_user_subscriptions 
    SET ${fields.join(', ')} 
    WHERE id = $${paramCount}
    RETURNING *;
  `;
  return query(sql, values);
},


createSubscription: async (data) => {
  const sql = `
    INSERT INTO votteryy_user_subscriptions 
    (user_id, plan_id, status, start_date, end_date, gateway_used, 
     external_subscription_id, payment_type, auto_renew)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *;
  `;
  return query(sql, [
    data.user_id,
    data.plan_id,
    data.status || 'active',
    data.current_period_start || new Date(),
    data.current_period_end,
    data.gateway,
    data.external_subscription_id,
    data.payment_type || 'recurring',
    data.auto_renew ?? true
  ]);
},
};
// import { query } from '../config/database.js';

// export const subscriptionQueries = {
//   // Create subscription plan
//   createPlan: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_subscription_plans 
//       (plan_name, plan_type, price, duration_days, billing_cycle, max_elections, max_voters_per_election, 
//        processing_fee_mandatory, processing_fee_type, processing_fee_fixed_amount, processing_fee_percentage,
//        processing_fee_enabled, description, what_included, what_excluded, is_active, display_order)
//       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.plan_name,
//       data.plan_type,
//       data.price,
//       data.duration_days,
//       data.billing_cycle,
//       data.max_elections || null,
//       data.max_voters_per_election || null,
//       data.processing_fee_mandatory || false,
//       data.processing_fee_type,
//       data.processing_fee_fixed_amount || null,
//       data.processing_fee_percentage || null,
//       data.processing_fee_enabled || false,
//       data.description,
//       data.what_included,
//       data.what_excluded,
//       true,
//       data.display_order || 0
//     ]);
//   },

//   // Get all plans
//   getAllPlans: async () => {
//     const sql = `
//       SELECT id, plan_name, plan_type, price, duration_days, billing_cycle, max_elections, 
//              max_voters_per_election, processing_fee_mandatory, processing_fee_type, 
//              processing_fee_fixed_amount, processing_fee_percentage, processing_fee_enabled,
//              description, what_included, what_excluded, display_order, 
//              payment_type, paddle_price_id, paddle_product_id, 
//              stripe_price_id, stripe_product_id, created_at 
//       FROM votteryy_subscription_plans 
//       WHERE is_active = true 
//       ORDER BY display_order ASC;
//     `;
//     return query(sql, []);
//   },

//   // Get plan by ID - ✅ FIXED: Added all payment gateway columns
//   getPlanById: async (planId) => {
//     const sql = `
//       SELECT 
//         id, 
//         plan_name, 
//         plan_type, 
//         price, 
//         duration_days, 
//         billing_cycle, 
//         max_elections, 
//         max_voters_per_election, 
//         processing_fee_mandatory, 
//         processing_fee_type, 
//         processing_fee_fixed_amount, 
//         processing_fee_percentage, 
//         processing_fee_enabled,
//         description, 
//         what_included, 
//         what_excluded, 
//         is_active, 
//         display_order,
//         payment_type,
//         paddle_price_id,
//         paddle_product_id,
//         stripe_price_id,
//         stripe_product_id,
//         created_at, 
//         updated_at
//       FROM votteryy_subscription_plans 
//       WHERE id = $1;
//     `;
//     return query(sql, [planId]);
//   },

//   // Update only editable fields
//   updateEditableFields: async (planId, data) => {
//     const fields = [];
//     const values = [];
//     let paramCount = 1;

//     // Only allow specific fields to be updated
//     const allowedFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount', 'processing_fee_type', 'processing_fee_percentage'];
    
//     Object.entries(data).forEach(([key, value]) => {
//       if (allowedFields.includes(key)) {
//         fields.push(`${key} = $${paramCount++}`);
//         values.push(value);
//       }
//     });

//     if (fields.length === 0) {
//       throw new Error('No valid fields provided for update');
//     }

//     fields.push(`updated_at = NOW()`);
//     values.push(planId);
    
//     const sql = `
//       UPDATE votteryy_subscription_plans 
//       SET ${fields.join(', ')} 
//       WHERE id = $${paramCount} 
//       RETURNING *;
//     `;
//     return query(sql, values);
//   },

//   // Update plan (for non-editable fields)
//   updatePlan: async (planId, data) => {
//     const fields = [];
//     const values = [];
//     let paramCount = 1;

//     // Exclude editable fields
//     const excludeFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount', 'processing_fee_type', 'processing_fee_percentage', 'id'];

//     Object.entries(data).forEach(([key, value]) => {
//       if (!excludeFields.includes(key)) {
//         fields.push(`${key} = $${paramCount++}`);
//         values.push(value);
//       }
//     });

//     if (fields.length === 0) {
//       throw new Error('No valid fields provided for update');
//     }

//     fields.push(`updated_at = NOW()`);
//     values.push(planId);
    
//     const sql = `
//       UPDATE votteryy_subscription_plans 
//       SET ${fields.join(', ')} 
//       WHERE id = $${paramCount} 
//       RETURNING *;
//     `;
//     return query(sql, values);
//   },

//   // Create or update user subscription
//   createOrUpdateSubscription: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_user_subscriptions 
//       (user_id, plan_id, gateway_used, external_subscription_id, status, 
//        start_date, end_date, auto_renew, metadata)
//       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
//       ON CONFLICT (user_id, external_subscription_id) 
//       DO UPDATE SET
//         status = EXCLUDED.status,
//         end_date = EXCLUDED.end_date,
//         updated_at = NOW()
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.user_id,
//       data.plan_id,
//       data.gateway || data.gateway_used,
//       data.external_subscription_id,
//       data.status || 'active',
//       data.start_date || new Date(),
//       data.end_date,
//       data.auto_renew ?? true,
//       data.metadata ? JSON.stringify(data.metadata) : null
//     ]);
//   },

//   // Create user subscription
//   createUserSubscription: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_user_subscriptions 
//       (user_id, plan_id, gateway_used, external_subscription_id, status, 
//        start_date, end_date, auto_renew)
//       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.user_id,
//       data.plan_id,
//       data.gateway_used,
//       data.external_subscription_id,
//       'active',
//       new Date(),
//       data.end_date,
//       data.auto_renew || true
//     ]);
//   },

//   // Get user subscription
//   getUserSubscription: async (userId) => {
//     const sql = `
//       SELECT us.*, sp.* FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1 AND us.status = $2
//       ORDER BY us.created_at DESC LIMIT 1;
//     `;
//     return query(sql, [userId, 'active']);
//   },

//   // Update subscription status
//   updateSubscriptionStatus: async (subscriptionId, status) => {
//     const sql = `
//       UPDATE votteryy_user_subscriptions 
//       SET status = $1 
//       WHERE id = $2 
//       RETURNING *;
//     `;
//     return query(sql, [status, subscriptionId]);
//   },

//   // Check subscription validity
//   checkSubscriptionValid: async (userId) => {
//     const sql = `
//       SELECT us.*, sp.* FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1 AND us.status = $2 AND us.end_date > NOW()
//       LIMIT 1;
//     `;
//     return query(sql, [userId, 'active']);
//   },

//   // Get subscription history
//   getSubscriptionHistory: async (userId, limit = 10, offset = 0) => {
//     const sql = `
//       SELECT us.*, sp.plan_name FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1
//       ORDER BY us.created_at DESC
//       LIMIT $2 OFFSET $3;
//     `;
//     return query(sql, [userId, limit, offset]);
//   },
// };
// import { query } from '../config/database.js';

// export const subscriptionQueries = {
//   // Create subscription plan
//   createPlan: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_subscription_plans 
//       (plan_name, plan_type, price, duration_days, billing_cycle, max_elections, max_voters_per_election, 
//        processing_fee_mandatory, processing_fee_type, processing_fee_fixed_amount, processing_fee_percentage,
//        processing_fee_enabled, description, what_included, what_excluded, is_active, display_order)
//       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.plan_name,
//       data.plan_type,
//       data.price,
//       data.duration_days,
//       data.billing_cycle,
//       data.max_elections || null,
//       data.max_voters_per_election || null,
//       data.processing_fee_mandatory || false,
//       data.processing_fee_type,
//       data.processing_fee_fixed_amount || null,
//       data.processing_fee_percentage || null,
//       data.processing_fee_enabled || false,
//       data.description,
//       data.what_included,
//       data.what_excluded,
//       true,
//       data.display_order || 0
//     ]);
//   },

//   // Get all plans
//   getAllPlans: async () => {
//     const sql = `
//       SELECT id, plan_name, plan_type, price, duration_days, billing_cycle, max_elections, 
//              max_voters_per_election, processing_fee_mandatory, processing_fee_type, 
//              processing_fee_fixed_amount, processing_fee_percentage, processing_fee_enabled,
//              description, what_included, what_excluded, display_order, created_at 
//       FROM votteryy_subscription_plans 
//       WHERE is_active = true 
//       ORDER BY display_order ASC;
//     `;
//     return query(sql, []);
//   },

//   // Get plan by ID
//   getPlanById: async (planId) => {
//     const sql = `
//       SELECT id, plan_name, plan_type, price, duration_days, billing_cycle, max_elections, 
//              max_voters_per_election, processing_fee_mandatory, processing_fee_type, 
//              processing_fee_fixed_amount, processing_fee_percentage, processing_fee_enabled,
//              description, what_included, what_excluded, is_active, display_order, created_at, updated_at
//       FROM votteryy_subscription_plans 
//       WHERE id = $1;
//     `;
//     return query(sql, [planId]);
//   },

//   // Update only editable fields
//   updateEditableFields: async (planId, data) => {
//     const fields = [];
//     const values = [];
//     let paramCount = 1;

//     // Only allow specific fields to be updated
//     const allowedFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount', 'processing_fee_type', 'processing_fee_percentage'];
    
//     Object.entries(data).forEach(([key, value]) => {
//       if (allowedFields.includes(key)) {
//         fields.push(`${key} = $${paramCount++}`);
//         values.push(value);
//       }
//     });

//     if (fields.length === 0) {
//       throw new Error('No valid fields provided for update');
//     }

//     fields.push(`updated_at = NOW()`);
//     values.push(planId);
    
//     const sql = `
//       UPDATE votteryy_subscription_plans 
//       SET ${fields.join(', ')} 
//       WHERE id = $${paramCount} 
//       RETURNING *;
//     `;
//     return query(sql, values);
//   },

//   // Update plan (for non-editable fields)
//   updatePlan: async (planId, data) => {
//     const fields = [];
//     const values = [];
//     let paramCount = 1;

//     // Exclude editable fields
//     const excludeFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount', 'processing_fee_type', 'processing_fee_percentage', 'id'];

//     Object.entries(data).forEach(([key, value]) => {
//       if (!excludeFields.includes(key)) {
//         fields.push(`${key} = $${paramCount++}`);
//         values.push(value);
//       }
//     });

//     if (fields.length === 0) {
//       throw new Error('No valid fields provided for update');
//     }

//     fields.push(`updated_at = NOW()`);
//     values.push(planId);
    
//     const sql = `
//       UPDATE votteryy_subscription_plans 
//       SET ${fields.join(', ')} 
//       WHERE id = $${paramCount} 
//       RETURNING *;
//     `;
//     return query(sql, values);
//   },

//   // Create user subscription
//   createUserSubscription: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_user_subscriptions 
//       (user_id, plan_id, gateway_used, external_subscription_id, status, 
//        start_date, end_date, auto_renew)
//       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.user_id,
//       data.plan_id,
//       data.gateway_used,
//       data.external_subscription_id,
//       'active',
//       new Date(),
//       data.end_date,
//       data.auto_renew || true
//     ]);
//   },

//   // Get user subscription
//   getUserSubscription: async (userId) => {
//     const sql = `
//       SELECT us.*, sp.* FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1 AND us.status = $2
//       ORDER BY us.created_at DESC LIMIT 1;
//     `;
//     return query(sql, [userId, 'active']);
//   },

//   // Update subscription status
//   updateSubscriptionStatus: async (subscriptionId, status) => {
//     const sql = `
//       UPDATE votteryy_user_subscriptions 
//       SET status = $1 
//       WHERE id = $2 
//       RETURNING *;
//     `;
//     return query(sql, [status, subscriptionId]);
//   },

//   // Check subscription validity
//   checkSubscriptionValid: async (userId) => {
//     const sql = `
//       SELECT us.*, sp.* FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1 AND us.status = $2 AND us.end_date > NOW()
//       LIMIT 1;
//     `;
//     return query(sql, [userId, 'active']);
//   },

//   // Get subscription history
//   getSubscriptionHistory: async (userId, limit = 10, offset = 0) => {
//     const sql = `
//       SELECT us.*, sp.plan_name FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1
//       ORDER BY us.created_at DESC
//       LIMIT $2 OFFSET $3;
//     `;
//     return query(sql, [userId, limit, offset]);
//   },
// };
// import { query } from '../config/database.js';

// export const subscriptionQueries = {
//   // Create subscription plan
//   createPlan: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_subscription_plans 
//       (plan_name, plan_type, price, duration_days, billing_cycle, max_elections, max_voters_per_election, 
//        processing_fee_mandatory, processing_fee_type, processing_fee_fixed_amount, processing_fee_percentage,
//        processing_fee_enabled, description, what_included, what_excluded, is_active, display_order)
//       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.plan_name,
//       data.plan_type,
//       data.price,
//       data.duration_days,
//       data.billing_cycle,
//       data.max_elections || null,
//       data.max_voters_per_election || null,
//       data.processing_fee_mandatory || false,
//       data.processing_fee_type,
//       data.processing_fee_fixed_amount || null,
//       data.processing_fee_percentage || null,
//       data.processing_fee_enabled || false,
//       data.description,
//       data.what_included,
//       data.what_excluded,
//       true,
//       data.display_order || 0
//     ]);
//   },

//   // Get all plans
//   getAllPlans: async () => {
//     const sql = `
//       SELECT id, plan_name, plan_type, price, duration_days, billing_cycle, max_elections, 
//              max_voters_per_election, processing_fee_mandatory, processing_fee_type, 
//              processing_fee_fixed_amount, processing_fee_percentage, processing_fee_enabled,
//              description, what_included, what_excluded, display_order, created_at 
//       FROM votteryy_subscription_plans 
//       WHERE is_active = true 
//       ORDER BY display_order ASC;
//     `;
//     return query(sql, []);
//   },

//   // Get plan by ID
//   getPlanById: async (planId) => {
//     const sql = `
//       SELECT id, plan_name, plan_type, price, duration_days, billing_cycle, max_elections, 
//              max_voters_per_election, processing_fee_mandatory, processing_fee_type, 
//              processing_fee_fixed_amount, processing_fee_percentage, processing_fee_enabled,
//              description, what_included, what_excluded, is_active, display_order, created_at, updated_at
//       FROM votteryy_subscription_plans 
//       WHERE id = $1;
//     `;
//     return query(sql, [planId]);
//   },

//   // Update only editable fields
//   updateEditableFields: async (planId, data) => {
//     const fields = [];
//     const values = [];
//     let paramCount = 1;

//     // Only allow specific fields to be updated
//     const allowedFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount'];
    
//     Object.entries(data).forEach(([key, value]) => {
//       if (allowedFields.includes(key)) {
//         fields.push(`${key} = $${paramCount++}`);
//         values.push(value);
//       }
//     });

//     if (fields.length === 0) {
//       throw new Error('No valid fields provided for update');
//     }

//     fields.push(`updated_at = NOW()`);
//     values.push(planId);
    
//     const sql = `
//       UPDATE votteryy_subscription_plans 
//       SET ${fields.join(', ')} 
//       WHERE id = $${paramCount} 
//       RETURNING *;
//     `;
//     return query(sql, values);
//   },

//   // Update plan (for non-editable fields)
//   updatePlan: async (planId, data) => {
//     const fields = [];
//     const values = [];
//     let paramCount = 1;

//     // Exclude editable fields
//     const excludeFields = ['max_elections', 'max_voters_per_election', 'processing_fee_mandatory', 'processing_fee_fixed_amount', 'id'];

//     Object.entries(data).forEach(([key, value]) => {
//       if (!excludeFields.includes(key)) {
//         fields.push(`${key} = $${paramCount++}`);
//         values.push(value);
//       }
//     });

//     if (fields.length === 0) {
//       throw new Error('No valid fields provided for update');
//     }

//     fields.push(`updated_at = NOW()`);
//     values.push(planId);
    
//     const sql = `
//       UPDATE votteryy_subscription_plans 
//       SET ${fields.join(', ')} 
//       WHERE id = $${paramCount} 
//       RETURNING *;
//     `;
//     return query(sql, values);
//   },

//   // Create user subscription
//   createUserSubscription: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_user_subscriptions 
//       (user_id, plan_id, gateway_used, external_subscription_id, status, 
//        start_date, end_date, auto_renew)
//       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.user_id,
//       data.plan_id,
//       data.gateway_used,
//       data.external_subscription_id,
//       'active',
//       new Date(),
//       data.end_date,
//       data.auto_renew || true
//     ]);
//   },

//   // Get user subscription
//   getUserSubscription: async (userId) => {
//     const sql = `
//       SELECT us.*, sp.* FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1 AND us.status = $2
//       ORDER BY us.created_at DESC LIMIT 1;
//     `;
//     return query(sql, [userId, 'active']);
//   },

//   // Update subscription status
//   updateSubscriptionStatus: async (subscriptionId, status) => {
//     const sql = `
//       UPDATE votteryy_user_subscriptions 
//       SET status = $1 
//       WHERE id = $2 
//       RETURNING *;
//     `;
//     return query(sql, [status, subscriptionId]);
//   },

//   // Check subscription validity
//   checkSubscriptionValid: async (userId) => {
//     const sql = `
//       SELECT us.*, sp.* FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1 AND us.status = $2 AND us.end_date > NOW()
//       LIMIT 1;
//     `;
//     return query(sql, [userId, 'active']);
//   },

//   // Get subscription history
//   getSubscriptionHistory: async (userId, limit = 10, offset = 0) => {
//     const sql = `
//       SELECT us.*, sp.plan_name FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1
//       ORDER BY us.created_at DESC
//       LIMIT $2 OFFSET $3;
//     `;
//     return query(sql, [userId, limit, offset]);
//   },
// };
//last working codes
// import { query } from '../config/database.js';

// export const subscriptionQueries = {
//   // Create subscription plan
//   createPlan: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_subscription_plans 
//       (name, price, duration, type, max_elections, max_voters_per_election, 
//        participation_fee_required, participation_fee_percentage, description, status)
//       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.name,
//       data.price,
//       data.duration,
//       data.type,
//       data.max_elections,
//       data.max_voters_per_election,
//       data.participation_fee_required,
//       data.participation_fee_percentage,
//       data.description,
//       'active'
//     ]);
//   },

//   // Get all plans
//   getAllPlans: async () => {
//     const sql = 'SELECT * FROM votteryy_subscription_plans WHERE status = $1 ORDER BY price ASC;';
//     return query(sql, ['active']);
//   },

//   // Get plan by ID
//   getPlanById: async (planId) => {
//     const sql = 'SELECT * FROM votteryy_subscription_plans WHERE id = $1;';
//     return query(sql, [planId]);
//   },

//   // Update plan
//   updatePlan: async (planId, data) => {
//     const fields = [];
//     const values = [];
//     let paramCount = 1;

//     Object.entries(data).forEach(([key, value]) => {
//       fields.push(`${key} = $${paramCount++}`);
//       values.push(value);
//     });

//     values.push(planId);
//     const sql = `UPDATE votteryy_subscription_plans SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *;`;
//     return query(sql, values);
//   },

//   // Create user subscription
//   createUserSubscription: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_user_subscriptions 
//       (user_id, plan_id, gateway_used, external_subscription_id, status, 
//        start_date, end_date, auto_renew)
//       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.user_id,
//       data.plan_id,
//       data.gateway_used,
//       data.external_subscription_id,
//       'active',
//       new Date(),
//       data.end_date,
//       data.auto_renew || true
//     ]);
//   },

//   // Get user subscription
//   getUserSubscription: async (userId) => {
//     const sql = `
//       SELECT us.*, sp.* FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1 AND us.status = $2
//       ORDER BY us.created_at DESC LIMIT 1;
//     `;
//     return query(sql, [userId, 'active']);
//   },

//   // Update subscription status
//   updateSubscriptionStatus: async (subscriptionId, status) => {
//     const sql = `
//       UPDATE votteryy_user_subscriptions 
//       SET status = $1 
//       WHERE id = $2 
//       RETURNING *;
//     `;
//     return query(sql, [status, subscriptionId]);
//   },

//   // Check subscription validity
//   checkSubscriptionValid: async (userId) => {
//     const sql = `
//       SELECT us.*, sp.* FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1 AND us.status = $2 AND us.end_date > NOW()
//       LIMIT 1;
//     `;
//     return query(sql, [userId, 'active']);
//   },

//   // Get subscription history
//   getSubscriptionHistory: async (userId, limit = 10, offset = 0) => {
//     const sql = `
//       SELECT us.*, sp.name as plan_name FROM votteryy_user_subscriptions us
//       JOIN votteryy_subscription_plans sp ON us.plan_id = sp.id
//       WHERE us.user_id = $1
//       ORDER BY us.created_at DESC
//       LIMIT $2 OFFSET $3;
//     `;
//     return query(sql, [userId, limit, offset]);
//   },
// };