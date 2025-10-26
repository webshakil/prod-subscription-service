// backend/src/routes/paymentRoutes.js
// Complete routes with all existing + admin routes

import express from 'express';
import { paymentController } from '../controllers/paymentController.js';
import { validatePaymentData } from '../middleware/validateInput.js';

const router = express.Router();

// ========================================
// EXISTING ROUTES
// ========================================

// Get gateway recommendation
router.get('/gateway-recommendation', paymentController.getGatewayRecommendation);

// Create payment (handles pay-as-you-go + recurring)
router.post('/create', validatePaymentData, paymentController.createPayment);

// Get user payments (original endpoint)
router.get('/user-payments', paymentController.getUserPayments);

// ✅ NEW: Add alias endpoint for frontend compatibility
router.get('/user', paymentController.getUserPayments);

// Verify payment
router.post('/verify', paymentController.verifyPayment);

// ========================================
// PAY-AS-YOU-GO ROUTES
// ========================================

// Track usage for pay-as-you-go
router.post('/track-usage', paymentController.trackUsage);

// Get unpaid usage
router.get('/unpaid-usage', paymentController.getUnpaidUsage);

// Get current plan info
router.get('/current-plan', paymentController.getCurrentPlan);

// Get usage history
router.get('/usage-history', paymentController.getUsageHistory);

// ========================================
// ADMIN ROUTES
// ========================================

// Get all plans (admin panel)
router.get('/admin/plans', paymentController.getAllPlansAdmin);

// Get single plan details (admin)
router.get('/admin/plans/:planId', paymentController.getPlanByIdAdmin);

// Update plan price (admin - updates both Votteryy DB and Stripe)
router.post('/admin/plans/:planId/update-price', paymentController.updatePlanPriceAdmin);

// ========================================
// Export
// ========================================

export default router;
// // backend/src/routes/paymentRoutes.js
// // Complete routes with all existing + admin routes

// import express from 'express';
// import { paymentController } from '../controllers/paymentController.js';
// import { validatePaymentData } from '../middleware/validateInput.js';

// const router = express.Router();

// // ========================================
// // EXISTING ROUTES
// // ========================================

// // Get gateway recommendation
// router.get('/gateway-recommendation', paymentController.getGatewayRecommendation);

// // Create payment (handles pay-as-you-go + recurring)
// router.post('/create', validatePaymentData, paymentController.createPayment);

// // Get user payments
// router.get('/user-payments', paymentController.getUserPayments);

// // Verify payment
// router.post('/verify', paymentController.verifyPayment);

// // ========================================
// // PAY-AS-YOU-GO ROUTES
// // ========================================

// // Track usage for pay-as-you-go
// router.post('/track-usage', paymentController.trackUsage);

// // Get unpaid usage
// router.get('/unpaid-usage', paymentController.getUnpaidUsage);

// // Get current plan info
// router.get('/current-plan', paymentController.getCurrentPlan);

// // Get usage history
// router.get('/usage-history', paymentController.getUsageHistory);

// // ========================================
// // ADMIN ROUTES
// // ========================================

// // Get all plans (admin panel)
// router.get('/admin/plans', paymentController.getAllPlansAdmin);

// // Get single plan details (admin)
// router.get('/admin/plans/:planId', paymentController.getPlanByIdAdmin);

// // Update plan price (admin - updates both Votteryy DB and Stripe)
// router.post('/admin/plans/:planId/update-price', paymentController.updatePlanPriceAdmin);

// // ========================================
// // Export
// // ========================================

// export default router;
// // backend/src/routes/paymentRoutes.js
// // Updated routes with pay-as-you-go endpoints

// import express from 'express';
// import { paymentController } from '../controllers/paymentController.js';
// //import { authenticate } from '../middleware/auth.js'; // Adjust based on your auth middleware
// import { validatePaymentData } from '../middleware/validateInput.js';
// const router = express.Router();

// // ========================================
// // EXISTING ROUTES (Keep as-is)
// // ========================================

// // Get gateway recommendation
// router.get('/gateway-recommendation', paymentController.getGatewayRecommendation);

// // Create payment (UPDATED to handle pay-as-you-go)
// router.post('/create',validatePaymentData, paymentController.createPayment);

// // Get user payments
// router.get('/user-payments', paymentController.getUserPayments);

// // Verify payment
// router.post('/verify', paymentController.verifyPayment);

// // ========================================
// // NEW ROUTES (Pay-as-you-go)
// // ========================================

// // Track usage for pay-as-you-go
// router.post('/track-usage', paymentController.trackUsage);

// // Get unpaid usage
// router.get('/unpaid-usage', paymentController.getUnpaidUsage);

// // Get current plan info
// router.get('/current-plan', paymentController.getCurrentPlan);

// // Get usage history
// router.get('/usage-history', paymentController.getUsageHistory);

// export default router;
// import express from 'express';
// import { roleCheck } from '../middleware/roleCheck.js';
// import { validatePaymentData } from '../middleware/validateInput.js';
// import { paymentController } from '../controllers/paymentController.js';

// const router = express.Router();

// // Get gateway recommendation by country
// router.get('/gateway-recommendation', paymentController.getGatewayRecommendation);

// // Create payment
// router.post('/create', validatePaymentData, paymentController.createPayment);

// // Get user payments
// router.get('/user', paymentController.getUserPayments);

// // Verify payment
// router.post('/verify', paymentController.verifyPayment);

// export default router;