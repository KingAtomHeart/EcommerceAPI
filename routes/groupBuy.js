const express = require('express');
const router = express.Router();
const gb = require('../controllers/groupBuy.js');
const { verify, verifyAdmin } = require('../auth.js');
const { upload, processUploadedImages } = require('../middleware/upload.js');

// Wrap multer for friendly errors
const safeUpload = (req, res, next) => {
    upload.array('images', 5)(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large. Maximum 10MB per image.' });
            if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files. Maximum 5 images.' });
            return res.status(400).json({ error: err.message || 'Image upload failed.' });
        }
        next();
    });
};

// ── Static paths first ──
router.get('/active', gb.getActiveGroupBuys);
router.get('/my/orders', verify, gb.getMyOrders);
router.get('/all', verify, verifyAdmin, gb.getAllGroupBuys);
// FIX: create uses JSON, images uploaded separately via /:id/images
router.post('/create', verify, verifyAdmin, gb.createGroupBuy);
router.patch('/orders/:orderId/status', verify, verifyAdmin, gb.updateOrderStatus);

// ── Parameterized /:id paths ──
router.get('/:id', gb.getGroupBuy);
router.patch('/:id', verify, verifyAdmin, gb.updateGroupBuy);
router.patch('/:id/status', verify, verifyAdmin, gb.updateGroupBuyStatus);
router.patch('/:id/archive', verify, verifyAdmin, gb.archiveGroupBuy);
router.patch('/:id/activate', verify, verifyAdmin, gb.activateGroupBuy);
router.delete('/:id', verify, verifyAdmin, gb.deleteGroupBuy);

// Images
router.post('/:id/images', verify, verifyAdmin, safeUpload, processUploadedImages, gb.uploadImages);
router.patch('/:id/images/reorder', verify, verifyAdmin, gb.reorderImages);
router.post('/:id/images/add-url', verify, verifyAdmin, gb.addImageByUrl);
router.delete('/:id/images/:imageId', verify, verifyAdmin, gb.deleteImage);

// Interest checks
router.post('/:id/interest', verify, gb.registerInterest);
router.get('/:id/interest', verify, verifyAdmin, gb.getInterestChecks);
router.get('/:id/interest/export-csv', verify, verifyAdmin, gb.exportInterestCSV);

// Orders
router.post('/:id/order', verify, gb.placeOrder);
router.get('/:id/orders', verify, verifyAdmin, gb.getGroupBuyOrders);
router.get('/:id/export-csv', verify, verifyAdmin, gb.exportOrdersCSV);

module.exports = router;