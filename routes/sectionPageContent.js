const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/sectionPageContent.js');
const { verify, verifyAdmin } = require('../auth.js');

// Public read so the shop / group-buys pages can render blocks.
router.get('/:pageKey', ctrl.getPageContent);

// Admin write.
router.patch('/:pageKey', verify, verifyAdmin, ctrl.updatePageContent);

module.exports = router;
