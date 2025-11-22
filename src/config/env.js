import dotenv from 'dotenv';
dotenv.config();
export const config = {
  PORT: process.env.PORT || 3003,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Database
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: process.env.DB_PORT || 5432,
  DB_NAME: process.env.DB_NAME || 'subscription_db',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'password',
  
  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  
  // Paddle
PADDLE_API_KEY: process.env.PADDLE_API_KEY,
  PADDLE_ENVIRONMENT: process.env.PADDLE_ENVIRONMENT || 'production',
  PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET,

    PADDLE_PRICES: {
    'pay-as-you-go': process.env.PADDLE_PRICE_PAY_AS_YOU_GO,
    'monthly': process.env.PADDLE_PRICE_MONTHLY,
    'quarterly': process.env.PADDLE_PRICE_QUARTERLY,
    'semi-annual': process.env.PADDLE_PRICE_SEMI_ANNUAL,
    'annual': process.env.PADDLE_PRICE_ANNUAL,
  },
  
  // API
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3003',

   FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
};