-- Country to Region Mapping
CREATE TABLE votteryy_country_region_mapping (
  id SERIAL PRIMARY KEY,
  country_code VARCHAR(2) UNIQUE NOT NULL,
  country_name VARCHAR(100) NOT NULL,
  region VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Subscription Plans


--latest plan
CREATE TABLE votteryy_subscription_plans (
  id SERIAL PRIMARY KEY,
  plan_name VARCHAR(100) NOT NULL,
  plan_type VARCHAR(50) NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  duration_days INTEGER NOT NULL,
  billing_cycle VARCHAR(50),
  max_elections INTEGER,
  max_voters_per_election INTEGER,
  processing_fee_mandatory BOOLEAN DEFAULT FALSE,
  processing_fee_type VARCHAR(50),
  processing_fee_fixed_amount DECIMAL(10, 2),
  processing_fee_percentage DECIMAL(5, 2),
  processing_fee_enabled BOOLEAN DEFAULT FALSE,
  description TEXT,
  what_included TEXT,
  what_excluded TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_type)
);

-- User Subscriptions
CREATE TABLE votteryy_user_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  plan_id INTEGER REFERENCES votteryy_subscription_plans(id),
  gateway_used VARCHAR(50),
  external_subscription_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  start_date TIMESTAMP DEFAULT NOW(),
  end_date TIMESTAMP,
  auto_renew BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, status)
);

-- Payments
CREATE TABLE votteryy_payments (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  subscription_id INTEGER REFERENCES votteryy_user_subscriptions(id),
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  gateway VARCHAR(50) NOT NULL,
  external_payment_id VARCHAR(255) UNIQUE,
  status VARCHAR(50) DEFAULT 'pending',
  payment_method VARCHAR(50),
  region VARCHAR(50),
  country_code VARCHAR(2),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Payment Failures
CREATE TABLE votteryy_payment_failures (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  subscription_id INTEGER REFERENCES votteryy_user_subscriptions(id),
  amount DECIMAL(10, 2),
  reason TEXT,
  gateway VARCHAR(50),
  region VARCHAR(50),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Regional Gateway Configuration
CREATE TABLE votteryy_regional_gateway_config (
  id SERIAL PRIMARY KEY,
  region VARCHAR(50) UNIQUE NOT NULL,
  gateway_type VARCHAR(50) NOT NULL,
  stripe_enabled BOOLEAN DEFAULT FALSE,
  paddle_enabled BOOLEAN DEFAULT FALSE,
  split_percentage INTEGER DEFAULT 50,
  recommendation_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Regional Pricing
CREATE TABLE votteryy_regional_pricing (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER REFERENCES votteryy_subscription_plans(id),
  region VARCHAR(50),
  price DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(plan_id, region)
);

-- System Configuration
CREATE TABLE votteryy_system_config (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);



-- Indexes
CREATE INDEX idx_votteryy_user_subscriptions_user_id ON votteryy_user_subscriptions(user_id);
CREATE INDEX idx_votteryy_payments_user_id ON votteryy_payments(user_id);
CREATE INDEX idx_votteryy_payments_external_payment_id ON votteryy_payments(external_payment_id);
CREATE INDEX idx_votteryy_regional_config_region ON votteryy_regional_gateway_config(region);
CREATE INDEX idx_votteryy_country_mapping_country_code ON votteryy_country_region_mapping(country_code);
CREATE INDEX idx_votteryy_country_mapping_region ON votteryy_country_region_mapping(region);