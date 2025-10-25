
import express from 'express';
import { roleCheck } from '../middleware/roleCheck.js';
import { validateSubscriptionPlan } from '../middleware/validateInput.js';
import { subscriptionController } from '../controllers/subscriptionController.js';

const router = express.Router();

// Public routes
router.get('/plans', subscriptionController.getAllPlans);
router.get('/plans/:planId', subscriptionController.getPlanById);
router.get('/user/current', subscriptionController.getUserSubscription);
router.get('/user/valid', subscriptionController.checkSubscriptionValid);
router.get('/user/history', subscriptionController.getSubscriptionHistory);

// Admin routes - editable fields only
router.post('/plans', roleCheck(['manager', 'admin']), validateSubscriptionPlan, subscriptionController.createPlan);
router.put('/plans/:planId', roleCheck(['manager', 'admin']), subscriptionController.updatePlan);
router.put('/plans/:planId/editable-fields', roleCheck(['manager', 'admin']), subscriptionController.updateEditableFields);
router.get('/plans/:planId/regional-prices', subscriptionController.getPlanRegionalPrices);
router.post('/plans/:planId/regional-prices', roleCheck(['manager', 'admin']), subscriptionController.setRegionalPrices);

export default router;

