import { query } from '../config/database.js';

export const countryRegionQueries = {
  // Get region by country code (uses 'region' column, not 'region_id')
  getRegionByCountryCode: async (countryCode) => {
    const sql = `
      SELECT region, country_name FROM votteryy_country_region_mapping 
      WHERE country_code = $1;
    `;
    return query(sql, [countryCode.toUpperCase()]);
  },

  // Get all countries in region
  getCountriesByRegion: async (region) => {
    const sql = `
      SELECT country_code, country_name FROM votteryy_country_region_mapping 
      WHERE region = $1
      ORDER BY country_name;
    `;
    return query(sql, [region]);
  },

  // Add country mapping
  addCountryMapping: async (countryCode, countryName, region) => {
    const sql = `
      INSERT INTO votteryy_country_region_mapping (country_code, country_name, region)
      VALUES ($1, $2, $3)
      ON CONFLICT (country_code) 
      DO UPDATE SET region = $3, country_name = $2
      RETURNING *;
    `;
    return query(sql, [countryCode.toUpperCase(), countryName, region]);
  },

  // Get all mappings
  getAllMappings: async () => {
    const sql = `
      SELECT country_code, country_name, region FROM votteryy_country_region_mapping 
      ORDER BY region, country_name;
    `;
    return query(sql, []);
  },
};
// import { query } from '../config/database.js';

// export const countryRegionQueries = {
//   // Get region by country code (FIXED: returns region_id as integer)
//   getRegionByCountryCode: async (countryCode) => {
//     const sql = `
//       SELECT region_id as region, country_name FROM votteryy_country_region_mapping 
//       WHERE country_code = $1;
//     `;
//     return query(sql, [countryCode.toUpperCase()]);
//   },

//   // Get all countries in region
//   getCountriesByRegion: async (regionId) => {
//     const sql = `
//       SELECT country_code, country_name FROM votteryy_country_region_mapping 
//       WHERE region_id = $1
//       ORDER BY country_name;
//     `;
//     return query(sql, [regionId]);
//   },

//   // Add country mapping
//   addCountryMapping: async (countryCode, countryName, regionId) => {
//     const sql = `
//       INSERT INTO votteryy_country_region_mapping (country_code, country_name, region_id)
//       VALUES ($1, $2, $3)
//       ON CONFLICT (country_code) 
//       DO UPDATE SET region_id = $3, country_name = $2
//       RETURNING *;
//     `;
//     return query(sql, [countryCode.toUpperCase(), countryName, regionId]);
//   },

//   // Get all mappings
//   getAllMappings: async () => {
//     const sql = `
//       SELECT country_code, country_name, region_id FROM votteryy_country_region_mapping 
//       ORDER BY region_id, country_name;
//     `;
//     return query(sql, []);
//   },
// };

