const db = require('./db');

async function bad(req) {
  // ruleid: db-query-string-concat
  await db.query("SELECT * FROM users WHERE username = '" + req.body.username + "'");
  // ruleid: db-query-string-concat
  await pool.query(`SELECT * FROM terms WHERE section = ${req.query.section}`);
  const sql = 'SELECT * FROM battles WHERE id = ' + req.params.id;
  // ruleid: db-query-string-concat
  await db.query(sql);
  let q = 'SELECT * FROM terms';
  q += " WHERE term LIKE '%" + req.query.q + "%'";
  // ruleid: db-query-string-concat
  return client.query(q);
}

async function good(req) {
  // ok: db-query-string-concat
  await db.query('SELECT * FROM users WHERE username = $1', [req.body.username]);
  // ok: db-query-string-concat
  await db.query('SELECT id, term FROM terms ' + 'WHERE section = $1 ORDER BY id', [req.query.section]);
  // ok: db-query-string-concat
  await db.query(`SELECT * FROM battles WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
  // ok: db-query-string-concat
  const label = 'Section ' + req.query.section;
  return label;
}
