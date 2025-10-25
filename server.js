import app from './src/app.js';
import { config } from './src/config/env.js';

const server = app.listen(config.PORT, () => {
  console.log(`Subscription service running on port ${config.PORT}`);
  console.log(`Environment: ${config.NODE_ENV}`);
});

// Graceful shutdown
// process.on('SIGTERM', () => {
//   console.log('SIGTERM received, shutting down gracefully');
//   server.close(() => {
//     console.log('Server closed');
//     process.exit(0);
//   });
// });