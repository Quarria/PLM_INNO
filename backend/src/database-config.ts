import { DataSourceOptions } from 'typeorm';

export function databaseConnectionConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name];
    if (value === undefined || value.trim() === '') throw new Error(`${name} is required in backend/.env`);
    return value;
  };
  const host = required('DB_HOST').trim();
  const portText = env.DB_PORT?.trim() || '5432';
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw new Error('DB_PORT must be an integer between 1 and 65535');
  const schema = (env.DB_SCHEMA || 'plm').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('DB_SCHEMA must be a simple PostgreSQL schema name');
  const ssl = (env.DB_SSL || 'false').trim().toLowerCase();
  if (!['true', 'false'].includes(ssl)) throw new Error('DB_SSL must be true or false');
  return {
    type: 'postgres' as const,
    host,
    port: Number(portText),
    database: required('DB_NAME').trim(),
    username: required('DB_USER').trim(),
    password: required('DB_PASSWORD'),
    schema,
    ssl: ssl === 'true' ? { rejectUnauthorized: true } : false,
  } satisfies Partial<DataSourceOptions>;
}
