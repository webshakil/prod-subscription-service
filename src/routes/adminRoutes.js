import express from 'express';
import { roleCheck } from '../middleware/roleCheck.js';
import { validateGatewayConfig } from '../middleware/validateInput.js';
import { gatewayConfigController } from '../controllers/gatewayConfigController.js';

const router = express.Router();

// Gateway configuration routes (Admin only)
router.get('/gateway-config', roleCheck(['manager', 'admin']), gatewayConfigController.getAllConfigs);
router.get('/gateway-config/:regionId', roleCheck(['manager', 'admin']), gatewayConfigController.getRegionalConfig);  // Changed param name
router.post('/gateway-config/:regionId', roleCheck(['manager','admin']), validateGatewayConfig, gatewayConfigController.setRegionalConfig);  // Changed param name
router.post('/processing-fee', roleCheck(['manager']), gatewayConfigController.updateProcessingFee);
router.get('/processing-fee', roleCheck(['manager', 'admin']), gatewayConfigController.getProcessingFee);

export default router;
// import express from 'express';
// import { roleCheck } from '../middleware/roleCheck.js';
// import { validateGatewayConfig } from '../middleware/validateInput.js';
// import { gatewayConfigController } from '../controllers/gatewayConfigController.js';

// const router = express.Router();

// // Gateway configuration routes (Admin only)
// router.get('/gateway-config', roleCheck(['manager', 'admin']), gatewayConfigController.getAllConfigs);
// router.get('/gateway-config/:region', roleCheck(['manager', 'admin']), gatewayConfigController.getRegionalConfig);
// router.post('/gateway-config/:region', roleCheck(['manager']), validateGatewayConfig, gatewayConfigController.setRegionalConfig);
// router.post('/processing-fee', roleCheck(['manager']), gatewayConfigController.updateProcessingFee);
// router.get('/processing-fee', roleCheck(['manager', 'admin']), gatewayConfigController.getProcessingFee);

// export default router;