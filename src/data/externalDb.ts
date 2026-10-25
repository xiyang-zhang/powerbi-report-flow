import type { DataProfile, ExternalDbConfig, TableSpec } from "../core/types";
import { sanitizeIdentifier } from "../core/schemas";
import { finalizeDataProfile, makeTableSpec } from "./infer";

export interface ExternalDbResult {
  profile: DataProfile;
  warnings: string[];
}

function parseServer(server: string, defaultPort: number): { host: string; port: number } {
  const match = /^(.+?)(?::(\d+))?$/.exec(server.trim());
  return { host: match?.[1] ?? server, port: match?.[2] ? Number(match[2]) : defaultPort };
}

async function listTables(config: ExternalDbConfig): Promise<string[]> {
  if (!config.table) return [];
  return [config.table];
}

async function sampleSqlServer(config: ExternalDbConfig): Promise<Array<Record<string, unknown>>> {
  const mssql: any = await import("mssql");
  const { host, port } = parseServer(config.server, 1433);
  const pool = await mssql.connect({
    server: host,
    port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: { trustServerCertificate: true, encrypt: false },
    pool: { max: 2, min: 0, idleTimeoutMillis: 5000 },
  });
  try {
    const schema = config.schema ?? "dbo";
    const table = config.table;
    if (!table) {
      const listed = await pool.request().query(
        "SELECT TOP (1) TABLE_SCHEMA AS [schema], TABLE_NAME AS [table] FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
      );
      const first = listed.recordset?.[0] as { schema?: string; table?: string } | undefined;
      if (!first?.table) throw new Error("No base tables found in the database.");
      const result = await pool
        .request()
        .query(`SELECT TOP (1000) * FROM [${first.schema ?? "dbo"}].[${first.table}]`);
      return result.recordset ?? [];
    }
    const result = await pool.request().query(`SELECT TOP (1000) * FROM [${schema}].[${table}]`);
    return result.recordset ?? [];
  } finally {
    await pool.close().catch(() => undefined);
  }
}

async function samplePostgres(config: ExternalDbConfig): Promise<Array<Record<string, unknown>>> {
  const { Client } = await import("pg");
  const { host, port } = parseServer(config.server, 5432);
  const client = new Client({ host, port, database: config.database, user: config.user, password: config.password });
  await client.connect();
  try {
    let schema = config.schema ?? "public";
    let table = config.table;
    if (!table) {
      const listed = await client.query(
        "SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_name LIMIT 1",
      );
      const first = listed.rows?.[0] as { table_schema?: string; table_name?: string } | undefined;
      if (!first?.table_name) throw new Error("No base tables found in the database.");
      schema = first.table_schema ?? schema;
      table = first.table_name;
    }
    const result = await client.query(`SELECT * FROM "${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}" LIMIT 1000`);
    return result.rows ?? [];
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function sampleMySql(config: ExternalDbConfig): Promise<Array<Record<string, unknown>>> {
  const mysql: any = await import("mysql2/promise");
  const { host, port } = parseServer(config.server, 3306);
  const connection = await mysql.createConnection({
    host,
    port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectTimeout: 10_000,
  });
  try {
    let table = config.table;
    if (!table) {
      const [rows] = await connection.query(
        "SELECT table_name AS tableName FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema = DATABASE() ORDER BY table_name LIMIT 1",
      );
      const first = (rows as Array<{ tableName?: string }>)[0];
      if (!first?.tableName) throw new Error("No base tables found in the database.");
      table = first.tableName;
    }
    const [rows] = await connection.query(`SELECT * FROM \`${table.replace(/`/g, "``")}\` LIMIT 1000`);
    return rows as Array<Record<string, unknown>>;
  } finally {
    await connection.end().catch(() => undefined);
  }
}

export async function profileExternalDatabase(config: ExternalDbConfig): Promise<ExternalDbResult> {
  const warnings: string[] = [];
  const tables = await listTables(config);
  if (tables.length === 0) warnings.push("No table was specified; the first available table was profiled.");
  let rows: Array<Record<string, unknown>>;
  if (config.connector === "sqlserver") rows = await sampleSqlServer(config);
  else if (config.connector === "postgresql") rows = await samplePostgres(config);
  else rows = await sampleMySql(config);

  if (rows.length === 0) {
    throw new Error(
      "The SQL source returned no rows. Provide a table with data, or use the mock/local data mode to supply a schema.",
    );
  }
  const tableName = sanitizeIdentifier(config.table ?? Object.keys(rows[0] ?? {})[0] ?? "Query", "Query");
  const table = makeTableSpec(tableName, rows, config.table ?? tableName);
  table.partition = {
    kind: "sql",
    connector: config.connector,
    server: config.server,
    database: config.database,
    schema: config.schema,
    table: config.table ?? tableName,
  };
  const profile = finalizeDataProfile({
    sourceMode: "external",
    sourceLabel: `${config.connector}://${config.server}/${config.database}${config.table ? `/${config.table}` : ""}`,
    tables: [table],
    warnings,
  });
  return { profile, warnings };
}

export function externalTableFromProfile(profile: DataProfile): TableSpec | undefined {
  return profile.tables[0];
}
