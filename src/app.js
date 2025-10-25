import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';

// Routes
import webhookRoutes from './routes/webhookRoutes.js'; // ← Import first
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import countryRegionRoutes from './routes/countryRegionRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

const app = express();

// Middleware (order matters!)
app.use(morgan('combined'));
app.use(cors());

// ⚠️ CRITICAL: Webhook routes MUST come BEFORE express.json()
// This ensures raw body is preserved for signature verification
app.use('/api/v1/webhooks', webhookRoutes);

// NOW add JSON parser for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'subscription-service',
    timestamp: new Date().toISOString()
  });
});

// API Routes (these use JSON parsing)
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/country-region', countryRegionRoutes);
app.use('/api/v1/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler (must be last)
app.use(errorHandler);

export default app;
// import express from 'express';
// import cors from 'cors';
// import morgan from 'morgan';
// import { config } from './config/env.js';
// import { errorHandler } from './middleware/errorHandler.js';

// // Routes
// import subscriptionRoutes from './routes/subscriptionRoutes.js';
// import paymentRoutes from './routes/paymentRoutes.js';
// import countryRegionRoutes from './routes/countryRegionRoutes.js';
// import webhookRoutes from './routes/webhookRoutes.js';
// import adminRoutes from './routes/adminRoutes.js';

// const app = express();

// // Middleware
// app.use(morgan('combined'));
// app.use(cors());
// app.use(express.json());

// // Stripe webhook needs raw body
// app.post('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }));
// app.post('/api/v1/webhooks/paddle', express.raw({ type: 'application/json' }));

// // Health check
// app.get('/health', (req, res) => {
//   res.json({ status: 'ok', service: 'subscription-service' });
// });

// // API Routes
// app.use('/api/v1/subscriptions', subscriptionRoutes);
// app.use('/api/v1/payments', paymentRoutes);
// app.use('/api/v1/country-region', countryRegionRoutes);
// app.use('/api/v1/webhooks', webhookRoutes);
// app.use('/api/v1/admin', adminRoutes);

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({ error: 'Not found' });
// });

// // Error handler
// app.use(errorHandler);

// export default app;