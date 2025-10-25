import express from 'express';
import { roleCheck } from '../middleware/roleCheck.js';
import { countryRegionController } from '../controllers/countryRegionController.js';

const router = express.Router();

// Public routes
router.get('/region/:country_code', countryRegionController.getRegionByCountry);
router.get('/countries/:region', countryRegionController.getCountriesByRegion);
router.get('/all', countryRegionController.getAllMappings);

// Admin routes
router.post('/add', roleCheck(['manager', 'admin']), countryRegionController.addCountryMapping);

export default router;