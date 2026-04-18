const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'ecommerce/products',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto:good' }]
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

const processUploadedImages = (req, res, next) => {
    if (!req.files || req.files.length === 0) {
        req.uploadedImages = [];
        return next();
    }
    req.uploadedImages = req.files.map((file) => ({
        url: file.path,
        altText: file.originalname.split('.')[0]
    }));
    next();
};

const uploadSingle = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }).single('image');

module.exports = { upload, processUploadedImages, uploadSingle };