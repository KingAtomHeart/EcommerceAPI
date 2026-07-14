const express = require('express');
const router = express.Router();
const currencyController = require('../controllers/currency.js');

// GET /b1/currency/rates — public: live PHP-based exchange rates for display.
router.get('/rates', currencyController.getRates);

module.exports = router;
