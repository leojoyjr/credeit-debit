/**
 * src/services/attachmentService.js
 * Manages receipt and bill attachments linked to transactions.
 */

const path = require('node:path');
const fs = require('node:fs');

function addAttachment(txId, file, db) {
  if (!txId) throw new Error('Transaction ID is required');
  if (!file) throw new Error('No file uploaded');

  const stmt = db.prepare(`
    INSERT INTO attachments (transaction_id, file_path, original_name, mime_type, size_bytes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    txId,
    file.filename,
    file.originalname,
    file.mimetype,
    file.size
  );

  return {
    id: Number(result.lastInsertRowid),
    transaction_id: txId,
    file_path: file.filename,
    original_name: file.originalname,
    mime_type: file.mimetype,
    size_bytes: file.size,
  };
}

function getAttachmentsForTransaction(txId, db) {
  return db.prepare('SELECT * FROM attachments WHERE transaction_id = ? ORDER BY id ASC').all(txId);
}

module.exports = {
  addAttachment,
  getAttachmentsForTransaction,
};
