const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/siteSettings.js');
const { verify, verifyAdmin } = require('../auth.js');

// Public — every customer page reads this on load to apply the correct theme.
router.get('/', ctrl.getSiteSettings);

// Admin — change the site-wide visual style.
router.patch('/', verify, verifyAdmin, ctrl.updateSiteSettings);

module.exports = router;
