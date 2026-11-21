/**
 * src/services/auditService.js
 * Querying and recording immutable audit logs.
 */

function logAction(userId, action, entity, entityId, beforeData, afterData, db) {
  const stmt = db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    userId || null,
    action,
    entity,
    entityId || null,
    beforeData ? JSON.stringify(beforeData) : null,
    afterData ? JSON.stringify(afterData) : null
  );
}

function listAuditLogs(options = {}, db) {
  let sql = `
    SELECT a.*, u.name as user_name, u.username as user_username
    FROM audit_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (options.entity) {
    sql += ' AND a.entity = ?';
    params.push(options.entity);
  }

  if (options.action) {
    sql += ' AND a.action = ?';
    params.push(options.action);
  }

  sql += ' ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?';
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));
  const offset = Math.max(0, parseInt(options.offset, 10) || 0);
  params.push(limit, offset);

  return db.prepare(sql).all(...params);
}

module.exports = {
  logAction,
  listAuditLogs,
};
