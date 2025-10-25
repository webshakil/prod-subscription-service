import pkg from 'pg';
import { config } from './env.js';

const { Pool } = pkg;

const pool = new Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  max: 20,
  // idleTimeoutMillis: 30000,
  // connectionTimeoutMillis: 2000,
  ssl: {
    require: true,
    rejectUnauthorized: false, // allow self-signed certificates (Render requires this)
  },
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

export const getClient = async () => {
  return pool.connect();
};

export default pool;

// import pkg from 'pg';
// import { config } from './env.js';

// const { Pool } = pkg;

// const pool = new Pool({
//   host: config.DB_HOST,
//   port: config.DB_PORT,
//   database: config.DB_NAME,
//   user: config.DB_USER,
//   password: config.DB_PASSWORD,
//   max: 20,
//   idleTimeoutMillis: 30000,
//   connectionTimeoutMillis: 2000,
// });

// pool.on('error', (err) => {
//   console.error('Unexpected error on idle client', err);
//   process.exit(-1);
// });

// export const query = async (text, params) => {
//   const start = Date.now();
//   try {
//     const result = await pool.query(text, params);
//     const duration = Date.now() - start;
//     console.log('Executed query', { text, duration, rows: result.rowCount });
//     return result;
//   } catch (error) {
//     console.error('Database query error:', error);
//     throw error;
//   }
// };

// export const getClient = async () => {
//   return pool.connect();
// };

// export default pool;