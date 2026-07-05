const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/sectionPageContent.js');
const { verify, verifyAdmin } = require('../auth.js');

// Public reads so the navbar can list pages and the customer page can render.
router.get('/', ctrl.listPages);
router.get('/:pageKey', ctrl.getPageContent);

// Admin writes.
router.post('/', verify, verifyAdmin, ctrl.createPage);
router.patch('/:pageKey', verify, verifyAdmin, ctrl.updatePageContent);
router.delete('/:pageKey', verify, verifyAdmin, ctrl.deletePage);

module.exports = router;
