const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const sql = require("mssql");

const publicDirectory = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

let poolPromise;

function getPool() {
  if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
    throw new Error("Set DB_USER and DB_PASSWORD in the environment before starting the server.");
  }

  if (!poolPromise) {
    poolPromise = sql.connect({
      server: process.env.DB_SERVER || "sqldw.database.windows.net",
      database: process.env.DB_NAME || "AdventureWorksDW2020",
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      options: {
        encrypt: true,
        trustServerCertificate: false,
      },
      connectionTimeout: 15000,
      requestTimeout: 30000,
    }).catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }

  return poolPromise;
}

async function getSchema() {
  const pool = await getPool();
  const [columnsResult, foreignKeysResult] = await Promise.all([
    pool.request().query(`
      SELECT
        s.name AS schema_name,
        t.name AS table_name,
        c.column_id,
        c.name AS column_name,
        ty.name AS type_name,
        c.max_length,
        c.precision,
        c.scale,
        c.is_nullable,
        c.is_identity,
        dc.definition AS default_definition,
        CONVERT(bit, CASE WHEN pk.column_id IS NULL THEN 0 ELSE 1 END) AS is_primary_key
      FROM sys.tables AS t
      INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
      INNER JOIN sys.columns AS c ON c.object_id = t.object_id
      INNER JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
      LEFT JOIN sys.default_constraints AS dc
        ON dc.object_id = c.default_object_id
      LEFT JOIN (
        SELECT ic.object_id, ic.column_id
        FROM sys.indexes AS i
        INNER JOIN sys.index_columns AS ic
          ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        WHERE i.is_primary_key = 1
      ) AS pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
      WHERE t.is_ms_shipped = 0
      ORDER BY s.name, t.name, c.column_id;
    `),
    pool.request().query(`
      SELECT
        fk.name AS foreign_key_name,
        s_from.name AS from_schema,
        t_from.name AS from_table,
        c_from.name AS from_column,
        s_to.name AS to_schema,
        t_to.name AS to_table,
        c_to.name AS to_column,
        fkc.constraint_column_id,
        CONVERT(bit, CASE WHEN EXISTS (
          SELECT 1 FROM sys.indexes AS i
          WHERE i.object_id = fk.parent_object_id
            AND i.is_unique = 1 AND i.has_filter = 0
            AND (SELECT COUNT(*) FROM sys.index_columns AS ic
                 WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0)
              = (SELECT COUNT(*) FROM sys.foreign_key_columns AS f WHERE f.constraint_object_id = fk.object_id)
            AND (SELECT COUNT(*) FROM sys.index_columns AS ic
                 INNER JOIN sys.foreign_key_columns AS f
                   ON f.constraint_object_id = fk.object_id AND f.parent_column_id = ic.column_id
                 WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0)
              = (SELECT COUNT(*) FROM sys.foreign_key_columns AS f WHERE f.constraint_object_id = fk.object_id)
        ) THEN 1 ELSE 0 END) AS is_one_to_one
      FROM sys.foreign_keys AS fk
      INNER JOIN sys.foreign_key_columns AS fkc
        ON fkc.constraint_object_id = fk.object_id
      INNER JOIN sys.tables AS t_from ON t_from.object_id = fk.parent_object_id
      INNER JOIN sys.schemas AS s_from ON s_from.schema_id = t_from.schema_id
      INNER JOIN sys.columns AS c_from
        ON c_from.object_id = t_from.object_id AND c_from.column_id = fkc.parent_column_id
      INNER JOIN sys.tables AS t_to ON t_to.object_id = fk.referenced_object_id
      INNER JOIN sys.schemas AS s_to ON s_to.schema_id = t_to.schema_id
      INNER JOIN sys.columns AS c_to
        ON c_to.object_id = t_to.object_id AND c_to.column_id = fkc.referenced_column_id
      ORDER BY fk.name, fkc.constraint_column_id;
    `),
  ]);

  const tables = new Map();
  for (const row of columnsResult.recordset) {
    const key = `${row.schema_name}.${row.table_name}`;
    if (!tables.has(key)) {
      tables.set(key, {
        schema: row.schema_name,
        name: row.table_name,
        columns: [],
      });
    }

    tables.get(key).columns.push({
      name: row.column_name,
      type: formatType(row),
      nullable: Boolean(row.is_nullable),
      identity: Boolean(row.is_identity),
      primaryKey: Boolean(row.is_primary_key),
      default: row.default_definition,
    });
  }

  const relationships = new Map();
  for (const row of foreignKeysResult.recordset) {
    if (!relationships.has(row.foreign_key_name)) {
      relationships.set(row.foreign_key_name, {
        name: row.foreign_key_name,
        from: `${row.from_schema}.${row.from_table}`,
        to: `${row.to_schema}.${row.to_table}`,
        oneToOne: Boolean(row.is_one_to_one),
        columns: [],
      });
    }

    relationships.get(row.foreign_key_name).columns.push({
      from: row.from_column,
      to: row.to_column,
    });
  }

  return {
    database: process.env.DB_NAME || "AdventureWorksDW2020",
    tables: [...tables.values()],
    relationships: [...relationships.values()],
  };
}

function formatType(column) {
  const type = column.type_name.toLowerCase();
  if (["varchar", "char", "varbinary", "binary"].includes(type)) {
    return `${column.type_name}(${column.max_length === -1 ? "max" : column.max_length})`;
  }
  if (["nvarchar", "nchar"].includes(type)) {
    return `${column.type_name}(${column.max_length === -1 ? "max" : column.max_length / 2})`;
  }
  if (["decimal", "numeric"].includes(type)) {
    return `${column.type_name}(${column.precision},${column.scale})`;
  }
  if (["datetime2", "datetimeoffset", "time"].includes(type)) {
    return `${column.type_name}(${column.scale})`;
  }
  return column.type_name;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;

  if (pathname === "/api/schema") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    try {
      sendJson(response, 200, await getSchema());
    } catch (error) {
      console.error("Schema metadata request failed:", error.message);
      sendJson(response, 503, {
        error: "Could not load database metadata.",
        detail: error.message,
      });
    }
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(publicDirectory, relativePath);
  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  });
});

if (require.main === module) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`AdventureWorksDW2020 ERD is ready at http://localhost:${port}`);
  });
}

module.exports = { getSchema };
