

import { query } from '../config/database.js';

export const usageQueries = {
  // Create usage record
  createUsage: async (data) => {
    const { user_id, election_id, usage_type, quantity, price_per_unit, total_amount, status = 'pending' } = data;
    
    const sql = `
      INSERT INTO votteryy_usage_tracking 
        (user_id, election_id, usage_type, quantity, price_per_unit, total_amount, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    
    const result = await query(sql, [
      user_id,
      election_id,
      usage_type,
      quantity,
      price_per_unit,
      total_amount,
      status,
    ]);
    
    return result.rows[0];
  },

  // Get unpaid usage for a user
  getUnpaidUsage: async (user_id) => {
    const sql = `
      SELECT * FROM votteryy_usage_tracking
      WHERE user_id = $1 AND status = 'pending'
      ORDER BY created_at DESC;
    `;
    
    const result = await query(sql, [user_id]);
    return result.rows;
  },

  // Get usage summary for a user
  getUsageSummary: async (user_id, startDate, endDate) => {
    const sql = `
      SELECT 
        usage_type,
        COUNT(*) as count,
        SUM(quantity) as total_quantity,
        SUM(total_amount) as total_amount,
        status
      FROM votteryy_usage_tracking
      WHERE user_id = $1 
        AND created_at >= $2 
        AND created_at <= $3
      GROUP BY usage_type, status
      ORDER BY total_amount DESC;
    `;
    
    const result = await query(sql, [user_id, startDate, endDate]);
    return result.rows;
  },

  // Mark usage as paid
  markUsageAsPaid: async (usageIds, paymentId) => {
    const sql = `
      UPDATE votteryy_usage_tracking
      SET 
        status = 'paid',
        payment_id = $1,
        paid_at = NOW()
      WHERE id = ANY($2)
      RETURNING *;
    `;
    
    const result = await query(sql, [paymentId, usageIds]);
    return result.rows;
  },

  // Get total unpaid amount for user
  getTotalUnpaid: async (user_id) => {
    const sql = `
      SELECT 
        COALESCE(SUM(total_amount), 0) as total_unpaid
      FROM votteryy_usage_tracking
      WHERE user_id = $1 AND status = 'pending';
    `;
    
    const result = await query(sql, [user_id]);
    return parseFloat(result.rows[0].total_unpaid);
  },

  // Get usage history
  getUserUsageHistory: async (user_id, limit = 50) => {
    const sql = `
      SELECT 
        u.*,
        p.external_payment_id,
        p.status as payment_status
      FROM votteryy_usage_tracking u
      LEFT JOIN votteryy_payments p ON u.payment_id = p.id
      WHERE u.user_id = $1
      ORDER BY u.created_at DESC
      LIMIT $2;
    `;
    
    const result = await query(sql, [user_id, limit]);
    return result.rows;
  },
};

// // backend/src/models/usageQueries.js
// // Queries for pay-as-you-go usage tracking

// import { query } from '../config/database.js';

// export const usageQueries = {
//   // Create usage record
//   createUsage: async (data) => {
//     const { user_id, election_id, usage_type, quantity, price_per_unit, total_amount, status = 'pending' } = data;
    
//     const sql = `
//       INSERT INTO votteryy_usage_tracking 
//         (user_id, election_id, usage_type, quantity, price_per_unit, total_amount, status)
//       VALUES ($1, $2, $3, $4, $5, $6, $7)
//       RETURNING *;
//     `;
    
//     const result = await query(sql, [
//       user_id,
//       election_id,
//       usage_type,
//       quantity,
//       price_per_unit,
//       total_amount,
//       status,
//     ]);
    
//     return result.rows[0];
//   },

//   // Get unpaid usage for a user
//   getUnpaidUsage: async (user_id) => {
//     const sql = `
//       SELECT * FROM votteryy_usage_tracking
//       WHERE user_id = $1 AND status = 'pending'
//       ORDER BY created_at DESC;
//     `;
    
//     const result = await query(sql, [user_id]);
//     return result.rows;
//   },

//   // Get usage summary for a user
//   getUsageSummary: async (user_id, startDate, endDate) => {
//     const sql = `
//       SELECT 
//         usage_type,
//         COUNT(*) as count,
//         SUM(quantity) as total_quantity,
//         SUM(total_amount) as total_amount,
//         status
//       FROM votteryy_usage_tracking
//       WHERE user_id = $1 
//         AND created_at >= $2 
//         AND created_at <= $3
//       GROUP BY usage_type, status
//       ORDER BY total_amount DESC;
//     `;
    
//     const result = await query(sql, [user_id, startDate, endDate]);
//     return result.rows;
//   },

//   // Mark usage as paid
//   markUsageAsPaid: async (usageIds, paymentId) => {
//     const sql = `
//       UPDATE votteryy_usage_tracking
//       SET 
//         status = 'paid',
//         payment_id = $1,
//         paid_at = NOW()
//       WHERE id = ANY($2)
//       RETURNING *;
//     `;
    
//     const result = await query(sql, [paymentId, usageIds]);
//     return result.rows;
//   },

//   // Get total unpaid amount for user
//   getTotalUnpaid: async (user_id) => {
//     const sql = `
//       SELECT 
//         COALESCE(SUM(total_amount), 0) as total_unpaid
//       FROM votteryy_usage_tracking
//       WHERE user_id = $1 AND status = 'pending';
//     `;
    
//     const result = await query(sql, [user_id]);
//     return parseFloat(result.rows[0].total_unpaid);
//   },

//   // Get usage history
//   getUserUsageHistory: async (user_id, limit = 50) => {
//     const sql = `
//       SELECT 
//         u.*,
//         p.external_payment_id,
//         p.status as payment_status
//       FROM votteryy_usage_tracking u
//       LEFT JOIN votteryy_payments p ON u.payment_id = p.id
//       WHERE u.user_id = $1
//       ORDER BY u.created_at DESC
//       LIMIT $2;
//     `;
    
//     const result = await query(sql, [user_id, limit]);
//     return result.rows;
//   },
// };