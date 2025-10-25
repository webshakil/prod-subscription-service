import { countryRegionQueries } from '../models/countryRegionQueries.js';
import { gatewayConfigQueries } from '../models/gatewayConfigQueries.js';
import { regionalPricingQueries } from '../models/regionalPricingQueries.js';
import { GATEWAY_CONFIG } from '../config/gateways.js';

export const gatewayRecommendationService = {
  // Get gateway recommendation for country
  getRecommendation: async (countryCode, planId = null) => {
    try {
      // Step 1: Get region from country code
      const countryResult = await countryRegionQueries.getRegionByCountryCode(countryCode);
      
      if (!countryResult.rows[0]) {
        throw new Error(`Country code ${countryCode} not found`);
      }

      const { region, country_name } = countryResult.rows[0];

      // Step 2: Get gateway config for region
      const configResult = await gatewayConfigQueries.getRegionGatewayConfig(region);
      
      if (!configResult.rows[0]) {
        throw new Error(`No gateway config found for region ${region}`);
      }

      const regionConfig = configResult.rows[0];

      // Step 3: Get regional pricing if planId provided
      let regionalPrice = null;
      if (planId) {
        regionalPrice = await regionalPricingQueries.getRegionalPrice(planId, region);
      }

      // Step 4: Build recommendation
      const recommendation = {
        country_code: countryCode,
        country_name,
        region,
        gateway_type: regionConfig.gateway_type,
        stripe_enabled: regionConfig.stripe_enabled,
        paddle_enabled: regionConfig.paddle_enabled,
        split_percentage: regionConfig.split_percentage,
        recommendation_reason: regionConfig.recommendation_reason,
        regional_price: regionalPrice?.price || null,
        currency: regionalPrice?.currency || 'USD',
      };

      // Step 5: Determine best gateway(s) for user
      if (regionConfig.gateway_type === GATEWAY_CONFIG.STRIPE_ONLY) {
        recommendation.available_gateways = [
          {
            gateway: 'stripe',
            reason: regionConfig.recommendation_reason,
            recommended: true,
            split: false,
          }
        ];
      } else if (regionConfig.gateway_type === GATEWAY_CONFIG.PADDLE_ONLY) {
        recommendation.available_gateways = [
          {
            gateway: 'paddle',
            reason: regionConfig.recommendation_reason,
            recommended: true,
            split: false,
          }
        ];
      } else if (regionConfig.gateway_type === GATEWAY_CONFIG.SPLIT_50_50) {
        recommendation.available_gateways = [
          {
            gateway: 'stripe',
            reason: 'Supported with 50% routing',
            recommended: true,
            split: true,
            split_percentage: regionConfig.split_percentage,
          },
          {
            gateway: 'paddle',
            reason: 'Supported with 50% routing',
            recommended: true,
            split: true,
            split_percentage: regionConfig.split_percentage,
          }
        ];
      }

      return recommendation;
    } catch (error) {
      console.error('Gateway recommendation error:', error);
      throw error;
    }
  },

  // Select gateway based on split configuration
  selectGatewayForPayment: async (countryCode) => {
    try {
      const recommendation = await gatewayRecommendationService.getRecommendation(countryCode);
      
      if (recommendation.gateway_type === GATEWAY_CONFIG.SPLIT_50_50) {
        // Random 50-50 selection
        const useStripe = Math.random() > 0.5;
        return {
          gateway: useStripe ? 'stripe' : 'paddle',
          splitNeeded: true,
          splitPercentage: recommendation.split_percentage,
          region: recommendation.region,
        };
      } else if (recommendation.stripe_enabled && !recommendation.paddle_enabled) {
        return {
          gateway: 'stripe',
          splitNeeded: false,
          region: recommendation.region,
        };
      } else if (recommendation.paddle_enabled && !recommendation.stripe_enabled) {
        return {
          gateway: 'paddle',
          splitNeeded: false,
          region: recommendation.region,
        };
      }
    } catch (error) {
      console.error('Gateway selection error:', error);
      throw error;
    }
  },

  // Get payment method support for gateway
  getAvailablePaymentMethods: (gateway) => {
    const methods = {
      stripe: [
        { method: 'card', label: 'Credit/Debit Card' },
        { method: 'paypal', label: 'PayPal' },
        { method: 'google_pay', label: 'Google Pay' },
        { method: 'apple_pay', label: 'Apple Pay' },
      ],
      paddle: [
        { method: 'card', label: 'Credit/Debit Card' },
        { method: 'paypal', label: 'PayPal' },
      ],
    };

    return methods[gateway] || [];
  },
};