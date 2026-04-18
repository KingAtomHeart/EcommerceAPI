const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/homepageContent.js');
const { verify, verifyAdmin } = require('../auth.js');
const { upload, processUploadedImages } = require('../middleware/upload.js');

const safeUploadArray = (req, res, next) => {
    upload.array('images', 5)(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
        next();
    });
};

const safeUploadSingle = (req, res, next) => {
    upload.single('image')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
        if (req.file) {
            req.uploadedImages = [{ url: req.file.path, altText: req.file.originalname.split('.')[0] }];
        } else {
            req.uploadedImages = [];
        }
        next();
    });
};

// Public
router.get('/', ctrl.getHomepageContent);

// Admin
router.patch('/', verify, verifyAdmin, ctrl.updateHomepageContent);
router.post('/hero-images', verify, verifyAdmin, safeUploadArray, processUploadedImages, ctrl.uploadHeroImages);
router.delete('/hero-images/:imageId', verify, verifyAdmin, ctrl.deleteHeroImage);
router.patch('/hero-images/reorder', verify, verifyAdmin, ctrl.reorderHeroImages);
router.post('/banner-image', verify, verifyAdmin, safeUploadSingle, ctrl.uploadBannerImage);

module.exports = router;
