import Stripe from 'stripe';
import { config } from './env.js';

// export const stripeClient = new Stripe(config.STRIPE_SECRET_KEY, {
//   apiVersion: '2024-11-20.acacia', // ✅ Updated to latest stable version
// });
export const stripeClient = new Stripe(config.STRIPE_SECRET_KEY, {
  apiVersion: '2024-10-28.acacia',
});

// Paddle REST API client
export const paddleAPI = {
  baseURL: 'https://api.paddle.com/v1',
  headers: {
    'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
    'Content-Type': 'application/json',
  },
};

export const REGIONS = {
  REGION_1: 'region_1', // US & Canada
  REGION_2: 'region_2', // Western Europe
  REGION_3: 'region_3', // Eastern Europe & Russia
  REGION_4: 'region_4', // Africa
  REGION_5: 'region_5', // Latin America & Caribbeans
  REGION_6: 'region_6', // Middle East, Asia, Eurasia
  REGION_7: 'region_7', // Australasia
  REGION_8: 'region_8', // China, Macau, Hong Kong
};

export const GATEWAY_CONFIG = {
  STRIPE_ONLY: 'stripe_only',
  PADDLE_ONLY: 'paddle_only',
  SPLIT_50_50: 'split_50_50',
};
// import Stripe from 'stripe';
// import { config } from './env.js';

// export const stripeClient = new Stripe(config.STRIPE_SECRET_KEY, {
//   apiVersion: '2024-10-15',
// });

// // Paddle REST API client
// export const paddleAPI = {
//   baseURL: 'https://api.paddle.com/v1',
//   headers: {
//     'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
//     'Content-Type': 'application/json',
//   },
// };

// export const REGIONS = {
//   REGION_1: 'region_1', // US & Canada
//   REGION_2: 'region_2', // Western Europe
//   REGION_3: 'region_3', // Eastern Europe & Russia
//   REGION_4: 'region_4', // Africa
//   REGION_5: 'region_5', // Latin America & Caribbeans
//   REGION_6: 'region_6', // Middle East, Asia, Eurasia
//   REGION_7: 'region_7', // Australasia
//   REGION_8: 'region_8', // China, Macau, Hong Kong
// };

// export const GATEWAY_CONFIG = {
//   STRIPE_ONLY: 'stripe_only',
//   PADDLE_ONLY: 'paddle_only',
//   SPLIT_50_50: 'split_50_50',
// };