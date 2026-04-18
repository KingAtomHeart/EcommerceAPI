const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.js');
const { verify, verifyAdmin } = require('../auth.js');
const { upload, processUploadedImages } = require('../middleware/upload.js');

// Wrap multer to return friendly error messages
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

// Admin Routes
router.post('/', verify, verifyAdmin, safeUpload, processUploadedImages, productController.createProduct);
router.post('/:productId/images', verify, verifyAdmin, safeUpload, processUploadedImages, productController.uploadProductImages);
router.patch('/:productId/images/reorder', verify, verifyAdmin, productController.reorderProductImages);
router.post('/:productId/images/add-url', verify, verifyAdmin, productController.addProductImageByUrl);
router.delete('/:productId/images/:imageId', verify, verifyAdmin, productController.deleteProductImage);
router.get('/all', verify, verifyAdmin, productController.retrieveAllProducts);
router.patch('/:productId/update', verify, verifyAdmin, productController.updateProduct);
router.patch('/:productId/archive', verify, verifyAdmin, productController.archiveProduct);
router.patch('/:productId/activate', verify, verifyAdmin, productController.activateProduct);

// Public Routes
router.get('/active', productController.retrieveAllActive);
router.post('/search-by-name', productController.searchByName);
router.post('/search-by-price', productController.searchByPrice);
router.get('/:productId', productController.retrieveSingleProduct);

module.exports = router;