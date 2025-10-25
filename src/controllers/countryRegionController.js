import { countryRegionQueries } from '../models/countryRegionQueries.js';

export const countryRegionController = {
  // Get region by country code get req
  getRegionByCountry: async (req, res, next) => {
    try {
      const { country_code } = req.params;

      if (!country_code) {
        return res.status(400).json({ error: 'Country code required' });
      }

      const result = await countryRegionQueries.getRegionByCountryCode(country_code);

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Country not found' });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },

  // Get all countries in region get req
  getCountriesByRegion: async (req, res, next) => {
    try {
      const { region } = req.params;

      if (!region) {
        return res.status(400).json({ error: 'Region required' });
      }

      const result = await countryRegionQueries.getCountriesByRegion(region);

      res.json({ success: true, countries: result.rows });
    } catch (error) {
      next(error);
    }
  },

  // Get all mappings get
  getAllMappings: async (req, res, next) => {
    try {
      const result = await countryRegionQueries.getAllMappings();
      res.json({ success: true, mappings: result.rows });
    } catch (error) {
      next(error);
    }
  },

  // Add country mapping (Admin only) post req
  addCountryMapping: async (req, res, next) => {
    try {
      const { country_code, country_name, region } = req.body;

      if (!country_code || !country_name || !region) {
        return res.status(400).json({ error: 'All fields required' });
      }

      const result = await countryRegionQueries.addCountryMapping(country_code, country_name, region);

      res.status(201).json({ success: true, mapping: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
};