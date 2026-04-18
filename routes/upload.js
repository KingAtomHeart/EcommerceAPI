const express = require('express');
const router = express.Router();
const { uploadSingle } = require('../middleware/upload.js');
const { verify } = require('../auth.js');

// POST /b1/upload/single — upload one image to Cloudinary, return { url }
router.post('/single', verify, (req, res, next) => {
    uploadSingle(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
        next();
    });
}, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    return res.status(200).json({ url: req.file.path });
});

module.exports = router;
