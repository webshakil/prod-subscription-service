import { query } from '../config/database.js';

export const regionalPricingQueries = {
  // Set regional pricing for plan (uses 'region' as VARCHAR)
  setRegionalPrice: async (planId, region, price, currency = 'USD') => {
    const sql = `
      INSERT INTO votteryy_regional_pricing 
      (plan_id, region, price, currency)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (plan_id, region) 
      DO UPDATE SET price = $3, currency = $4, updated_at = NOW()
      RETURNING *;
    `;
    return query(sql, [planId, region, price, currency]);
  },

  // Get regional price for plan
  getRegionalPrice: async (planId, region) => {
    // Use region string directly (e.g., "region_1")
    const sql = `
      SELECT * FROM votteryy_regional_pricing 
      WHERE plan_id = $1 AND region = $2
      LIMIT 1;
    `;
    const result = await query(sql, [planId, region]);
    return result.rows[0];
  },

  // Get all regional prices for plan
  getPlanRegionalPrices: async (planId) => {
    const sql = `
      SELECT * FROM votteryy_regional_pricing 
      WHERE plan_id = $1
      ORDER BY region;
    `;
    return query(sql, [planId]);
  },

  // Batch set regional prices
  batchSetRegionalPrices: async (planId, prices) => {
    const client = await require('../config/database.js').getClient();
    try {
      await client.query('BEGIN');

      for (const [region, priceData] of Object.entries(prices)) {
        const price = typeof priceData === 'object' ? priceData.price : priceData;
        const currency = typeof priceData === 'object' ? priceData.currency : 'USD';

        await client.query(
          `INSERT INTO votteryy_regional_pricing (plan_id, region, price, currency)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (plan_id, region) 
           DO UPDATE SET price = $3, currency = $4, updated_at = NOW()`,
          [planId, region, price, currency]
        );
      }

      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
// import { query } from '../config/database.js';

// export const regionalPricingQueries = {
//   // Set regional pricing for plan (uses region_id INTEGER)
//   setRegionalPrice: async (planId, regionId, price, currency = 'USD') => {
//     const sql = `
//       INSERT INTO votteryy_regional_pricing 
//       (plan_id, region_id, price, currency)
//       VALUES ($1, $2, $3, $4)
//       ON CONFLICT (plan_id, region_id) 
//       DO UPDATE SET price = $3, currency = $4, updated_at = NOW()
//       RETURNING *;
//     `;
//     return query(sql, [planId, regionId, price, currency]);
//   },

//   // Get regional price for plan
//   getRegionalPrice: async (planId, region) => {
//     // Extract numeric ID from "region_1" -> 1
//     const regionIdMatch = region.match(/\d+/);
//     const regionId = regionIdMatch ? parseInt(regionIdMatch[0]) : null;
    
//     if (!regionId) {
//       return null; // No regional pricing
//     }
    
//     const sql = `
//       SELECT * FROM votteryy_regional_pricing 
//       WHERE plan_id = $1 AND region_id = $2
//       LIMIT 1;
//     `;
//     const result = await query(sql, [planId, regionId]);
//     return result.rows[0];
//   },

//   // Get all regional prices for plan
//   getPlanRegionalPrices: async (planId) => {
//     const sql = `
//       SELECT rp.*, cm.region, cm.country_name
//       FROM votteryy_regional_pricing rp
//       LEFT JOIN votteryy_country_region_mapping cm ON rp.region_id = cm.id
//       WHERE rp.plan_id = $1
//       ORDER BY rp.region_id;
//     `;
//     return query(sql, [planId]);
//   },

//   // Batch set regional prices
//   batchSetRegionalPrices: async (planId, prices) => {
//     const client = await require('../config/database.js').getClient();
//     try {
//       await client.query('BEGIN');

//       for (const [regionId, priceData] of Object.entries(prices)) {
//         const price = typeof priceData === 'object' ? priceData.price : priceData;
//         const currency = typeof priceData === 'object' ? priceData.currency : 'USD';

//         await client.query(
//           `INSERT INTO votteryy_regional_pricing (plan_id, region_id, price, currency)
//            VALUES ($1, $2, $3, $4)
//            ON CONFLICT (plan_id, region_id) 
//            DO UPDATE SET price = $3, currency = $4, updated_at = NOW()`,
//           [planId, parseInt(regionId), price, currency]
//         );
//       }

//       await client.query('COMMIT');
//       return { success: true };
//     } catch (error) {
//       await client.query('ROLLBACK');
//       throw error;
//     } finally {
//       client.release();
//     }
//   },
// };