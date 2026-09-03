import mysql from 'mysql2/promise';

let pool;

export function dbEnabled() {
  return Boolean(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER);
}

export function getPool() {
  if (!dbEnabled()) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_POOL_SIZE || 4),
      maxIdle: Number(process.env.DB_POOL_SIZE || 4),
      idleTimeout: 60000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      timezone: 'Z'
    });
  }
  return pool;
}

export async function query(sql, params = []) {
  const connection = getPool();
  if (!connection) throw new Error('database_not_configured');
  const [rows] = await connection.execute(sql, params);
  return rows;
}

export async function withTransaction(work) {
  const connectionPool = getPool();
  if (!connectionPool) throw new Error('database_not_configured');
  const connection = await connectionPool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function healthcheck() {
  if (!dbEnabled()) return { configured: false, ok: false };
  try {
    const rows = await query('SELECT 1 AS ok');
    return { configured: true, ok: rows?.[0]?.ok === 1 };
  } catch (error) {
    return { configured: true, ok: false, error: error.message };
  }
}
