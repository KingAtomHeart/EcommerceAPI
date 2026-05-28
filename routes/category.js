const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/category.js');
const { verify, verifyAdmin } = require('../auth.js');

// Public reads — strip + dropdowns + per-category page all hit these.
router.get('/', ctrl.listCategories);
router.get('/:slug', ctrl.getCategory);

// Admin writes.
router.post('/', verify, verifyAdmin, ctrl.createCategory);
router.patch('/:id', verify, verifyAdmin, ctrl.updateCategory);
router.delete('/:id', verify, verifyAdmin, ctrl.deleteCategory);

module.exports = router;
