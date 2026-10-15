import assert from "node:assert/strict";
import { test } from "node:test";

import { toSqlFile } from "../../photon/src/data/seed.ts";

test("strings are single-quoted with embedded quotes doubled", () => {
  const sql = toSqlFile([{ sql: "INSERT INTO t (a) VALUES (?)", params: ["O'Brien"] }]);
  assert.ok(sql.includes("'O''Brien'"), sql);
});

test("null becomes NULL and numbers are inlined as-is", () => {
  const sql = toSqlFile([{ sql: "INSERT INTO t (a, b, c) VALUES (?, ?, ?)", params: [null, 42, -1.5] }]);
  assert.equal(sql, "INSERT INTO t (a, b, c) VALUES (NULL, 42, -1.5);\n");
});

test("the output has no transaction statements", () => {
  const sql = toSqlFile([
    { sql: "DELETE FROM t", params: [] },
    { sql: "INSERT INTO t (a) VALUES (?)", params: ["x"] },
  ]);
  assert.ok(!/BEGIN|COMMIT/i.test(sql), sql);
});

test("each statement ends with a semicolon on its own line", () => {
  const sql = toSqlFile([
    { sql: "DELETE FROM t", params: [] },
    { sql: "INSERT INTO t (a) VALUES (?)", params: ["x"] },
  ]);
  assert.equal(sql, "DELETE FROM t;\nINSERT INTO t (a) VALUES ('x');\n");
});

test("a question mark inside a param, or a quoted literal, is not a placeholder", () => {
  const sql = toSqlFile([
    { sql: "INSERT INTO t (a, b) VALUES (?, ?)", params: ["what?", "b"] },
    { sql: "INSERT INTO t (a, b) VALUES ('?', ?)", params: ["c"] },
  ]);
  assert.equal(sql, "INSERT INTO t (a, b) VALUES ('what?', 'b');\nINSERT INTO t (a, b) VALUES ('?', 'c');\n");
});

test("a param count that does not match the placeholders is an error", () => {
  assert.throws(() => toSqlFile([{ sql: "INSERT INTO t (a, b) VALUES (?, ?)", params: ["x"] }]), /placeholder/);
  assert.throws(() => toSqlFile([{ sql: "INSERT INTO t (a) VALUES (?)", params: ["x", "y"] }]), /placeholder/);
});

test("a non-finite number is an error", () => {
  assert.throws(() => toSqlFile([{ sql: "INSERT INTO t (a) VALUES (?)", params: [Number.NaN] }]), /finite/);
});
