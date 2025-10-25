import { query } from "../config/database.js";

export const gatewayConfigQueries = {
  // Get gateway config for region
  // Handles region as string like "region_1", "region_2", etc.
  getRegionGatewayConfig: async (region) => {
    // Extract numeric ID from "region_1" -> 1
    const regionIdMatch = region.match(/\d+/);
    const regionId = regionIdMatch ? parseInt(regionIdMatch[0]) : null;
    
    if (!regionId) {
      throw new Error(`Invalid region format: ${region}`);
    }
    
    const sql = `
      SELECT * FROM votteryy_regional_gateway_config 
      WHERE region_id = $1
      LIMIT 1;
    `;
    return query(sql, [regionId]);
  },

  // Set gateway config for region
  setRegionGatewayConfig: async (regionId, config) => {
    const sql = `
      INSERT INTO votteryy_regional_gateway_config 
      (region_id, gateway_type, stripe_enabled, paddle_enabled, split_percentage, recommendation_reason)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (region_id)
      DO UPDATE SET 
        gateway_type = $2,
        stripe_enabled = $3,
        paddle_enabled = $4,
        split_percentage = $5,
        recommendation_reason = $6,
        updated_at = NOW()
      RETURNING *;
    `;
    return query(sql, [
      regionId,
      config.gateway_type,
      config.stripe_enabled,
      config.paddle_enabled,
      config.split_percentage,
      config.recommendation_reason
    ]);
  },

  // Get all regional configs
  getAllRegionalConfigs: async () => {
    const sql = `
      SELECT gc.*, cm.region, cm.country_name
      FROM votteryy_regional_gateway_config gc
      LEFT JOIN votteryy_country_region_mapping cm ON gc.region_id = cm.id
      ORDER BY gc.region_id;
    `;
    return query(sql, []);
  },

  // Processing fee methods
  updateProcessingFee: async (percentage) => {
    const sql = `
      INSERT INTO votteryy_system_config (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) 
      DO UPDATE SET value = $2, updated_at = NOW()
      RETURNING *;
    `;
    return query(sql, ['payment_processing_fee', percentage.toString()]);
  },

  getProcessingFee: async () => {
    const sql = `
      SELECT value FROM votteryy_system_config 
      WHERE key = $1;
    `;
    const result = await query(sql, ['payment_processing_fee']);
    return result.rows[0]?.value || '0';
  },
};