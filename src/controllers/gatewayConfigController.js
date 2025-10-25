import { gatewayConfigQueries } from '../models/gatewayConfigQueries.js';

export const gatewayConfigController = {
  // Get regional gateway config
  getRegionalConfig: async (req, res, next) => {
    try {
      const { regionId } = req.params;  // Changed parameter name
      const result = await gatewayConfigQueries.getRegionGatewayConfig(parseInt(regionId));  // Parse to int

      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Config not found for region' });
      }

      res.json({ success: true, config: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },

  // Get all regional configs
  getAllConfigs: async (req, res, next) => {
    try {
      const result = await gatewayConfigQueries.getAllRegionalConfigs();
      res.json({ success: true, configs: result.rows });
    } catch (error) {
      next(error);
    }
  },

  // Set regional gateway config (Admin only)
  setRegionalConfig: async (req, res, next) => {
    try {
      const { regionId } = req.params;  // Changed parameter name
      const config = req.body;

      const result = await gatewayConfigQueries.setRegionGatewayConfig(parseInt(regionId), config);  // Parse to int

      res.json({ success: true, config: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },

  // Update processing fee (Admin only) - UNCHANGED
  updateProcessingFee: async (req, res, next) => {
    try {
      const { percentage } = req.body;

      if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
        return res.status(400).json({ error: 'Invalid percentage (0-100)' });
      }

      await gatewayConfigQueries.updateProcessingFee(percentage);

      res.json({ success: true, message: 'Processing fee updated', percentage });
    } catch (error) {
      next(error);
    }
  },

  // Get processing fee - UNCHANGED
  getProcessingFee: async (req, res, next) => {
    try {
      const fee = await gatewayConfigQueries.getProcessingFee();
      res.json({ success: true, processingFee: parseFloat(fee) });
    } catch (error) {
      next(error);
    }
  },
};
// import { gatewayConfigQueries } from '../models/gatewayConfigQueries.js';

// export const gatewayConfigController = {
//   // Get regional gateway config
//   getRegionalConfig: async (req, res, next) => {
//     try {
//       const { region } = req.params;
//       const result = await gatewayConfigQueries.getRegionGatewayConfig(region);

//       if (!result.rows[0]) {
//         return res.status(404).json({ error: 'Config not found for region' });
//       }

//       res.json({ success: true, config: result.rows[0] });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Get all regional configs
//   getAllConfigs: async (req, res, next) => {
//     try {
//       const result = await gatewayConfigQueries.getAllRegionalConfigs();
//       res.json({ success: true, configs: result.rows });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Set regional gateway config (Admin only)
//   setRegionalConfig: async (req, res, next) => {
//     try {
//       const { region } = req.params;
//       const config = req.body;

//       const result = await gatewayConfigQueries.setRegionGatewayConfig(region, config);

//       res.json({ success: true, config: result.rows[0] });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Update processing fee (Admin only)
//   updateProcessingFee: async (req, res, next) => {
//     try {
//       const { percentage } = req.body;

//       if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
//         return res.status(400).json({ error: 'Invalid percentage (0-100)' });
//       }

//       await gatewayConfigQueries.updateProcessingFee(percentage);

//       res.json({ success: true, message: 'Processing fee updated', percentage });
//     } catch (error) {
//       next(error);
//     }
//   },

//   // Get processing fee
//   getProcessingFee: async (req, res, next) => {
//     try {
//       const fee = await gatewayConfigQueries.getProcessingFee();
//       res.json({ success: true, processingFee: parseFloat(fee) });
//     } catch (error) {
//       next(error);
//     }
//   },
// };