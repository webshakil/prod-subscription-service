import { query } from '../config/database.js';

export const paymentQueries = {
  // Record payment - ✅ FIXED: Added plan_id
  recordPayment: async (data) => {
    const sql = `
      INSERT INTO votteryy_payments 
      (user_id, plan_id, subscription_id, amount, currency, gateway, 
       external_payment_id, status, payment_method, region, country_code, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;
    return query(sql, [
      data.user_id,
      data.plan_id,           // ✅ ADDED: plan_id
      data.subscription_id,
      data.amount,
      data.currency || 'USD',
      data.gateway,
      data.external_payment_id,
      data.status || 'pending',
      data.payment_method,
      data.region,
      data.country_code,
      JSON.stringify(data.metadata || {})
    ]);
  },

  // Update payment status
  updatePaymentStatus: async (paymentId, status) => {
    const sql = `
      UPDATE votteryy_payments 
      SET status = $1, updated_at = NOW()
      WHERE id = $2 
      RETURNING *;
    `;
    return query(sql, [status, paymentId]);
  },

  // Get payment by external ID
  getPaymentByExternalId: async (externalPaymentId) => {
    const sql = 'SELECT * FROM votteryy_payments WHERE external_payment_id = $1;';
    return query(sql, [externalPaymentId]);
  },

  // Get user payments
  getUserPayments: async (userId, limit = 20, offset = 0) => {
    const sql = `
      SELECT * FROM votteryy_payments 
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    return query(sql, [userId, limit, offset]);
  },

  // Record failed payment
  recordFailedPayment: async (data) => {
    const sql = `
      INSERT INTO votteryy_payment_failures 
      (user_id, subscription_id, amount, reason, gateway, region, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    return query(sql, [
      data.user_id,
      data.subscription_id,
      data.amount,
      data.reason,
      data.gateway,
      data.region,
      JSON.stringify(data.metadata || {})
    ]);
  },
};
// import { query } from '../config/database.js';

// export const paymentQueries = {
//   // Record payment
//   recordPayment: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_payments 
//       (user_id, subscription_id, amount, currency, gateway, 
//        external_payment_id, status, payment_method, region, country_code, metadata)
//       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.user_id,
//       data.subscription_id,
//       data.amount,
//       data.currency || 'USD',
//       data.gateway,
//       data.external_payment_id,
//       data.status || 'pending',
//       data.payment_method,
//       data.region,
//       data.country_code,
//       JSON.stringify(data.metadata || {})
//     ]);
//   },

//   // Update payment status
//   updatePaymentStatus: async (paymentId, status) => {
//     const sql = `
//       UPDATE votteryy_payments 
//       SET status = $1, updated_at = NOW()
//       WHERE id = $2 
//       RETURNING *;
//     `;
//     return query(sql, [status, paymentId]);
//   },

//   // Get payment by external ID
//   getPaymentByExternalId: async (externalPaymentId) => {
//     const sql = 'SELECT * FROM votteryy_payments WHERE external_payment_id = $1;';
//     return query(sql, [externalPaymentId]);
//   },

//   // Get user payments
//   getUserPayments: async (userId, limit = 20, offset = 0) => {
//     const sql = `
//       SELECT * FROM votteryy_payments 
//       WHERE user_id = $1
//       ORDER BY created_at DESC
//       LIMIT $2 OFFSET $3;
//     `;
//     return query(sql, [userId, limit, offset]);
//   },

//   // Record failed payment
//   recordFailedPayment: async (data) => {
//     const sql = `
//       INSERT INTO votteryy_payment_failures 
//       (user_id, subscription_id, amount, reason, gateway, region, metadata)
//       VALUES ($1, $2, $3, $4, $5, $6, $7)
//       RETURNING *;
//     `;
//     return query(sql, [
//       data.user_id,
//       data.subscription_id,
//       data.amount,
//       data.reason,
//       data.gateway,
//       data.region,
//       JSON.stringify(data.metadata || {})
//     ]);
//   },
// };