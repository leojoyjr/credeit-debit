/**
 * src/routes/transactionRoutes.js
 * Fast-entry transactions, reversal (owner only), open invoice allocations, attachments.
 */

const express = require('express');
const router = express.Router();
const path = require('node:path');
const multer = require('multer');
const { getDb } = require('../db');
const config = require('../config');
const {
  createTransaction,
  reverseTransaction,
  getOpenInvoices,
} = require('../services/transactionService');
const { addAttachment, getAttachmentsForTransaction } = require('../services/attachmentService');
const { requireAuth, requireOwner } = require('../middleware/auth');

router.use(requireAuth);

// Setup multer for bill/receipt attachments
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `attachment-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, and PDF files are allowed.'));
    }
  },
});

// Fast-entry transaction create
router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const tx = createTransaction(req.body, req.user, db);
    res.status(201).json(tx);
  } catch (err) {
    next(err);
  }
});

// Reverse transaction (Owner only)
router.post('/:id/reverse', requireOwner, (req, res, next) => {
  try {
    const db = getDb();
    const reversal = reverseTransaction(parseInt(req.params.id, 10), req.body.note, req.user, db);
    res.status(201).json(reversal);
  } catch (err) {
    next(err);
  }
});

// Get open invoices for a party to allocate payments
router.get('/open-invoices/:partyId', (req, res, next) => {
  try {
    const db = getDb();
    const invoices = getOpenInvoices(parseInt(req.params.partyId, 10), db);
    res.json(invoices);
  } catch (err) {
    next(err);
  }
});

// Upload attachment
router.post('/:id/attachments', upload.single('file'), (req, res, next) => {
  try {
    const db = getDb();
    const attachment = addAttachment(parseInt(req.params.id, 10), req.file, db);
    res.status(201).json(attachment);
  } catch (err) {
    next(err);
  }
});

// Get attachments for a transaction
router.get('/:id/attachments', (req, res, next) => {
  try {
    const db = getDb();
    const list = getAttachmentsForTransaction(parseInt(req.params.id, 10), db);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
