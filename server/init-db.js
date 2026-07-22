// Runs schema.sql against the configured database. Usage: npm run init-db
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

(async () => {
  const pool = new Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {}
  );
  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(sql);
    console.log("Schema applied successfully.");
  } catch (err) {
    console.error("Failed to apply schema:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
