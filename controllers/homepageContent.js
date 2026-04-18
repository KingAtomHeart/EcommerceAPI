const HomepageContent = require('../models/HomepageContent.js');
const { errorHandler } = require('../auth.js');
const cloudinary = require('cloudinary').v2;

const WHITELIST = [
    'heroImages', 'heroEyebrow', 'heroTitle', 'heroSubtitle',
    'heroPrimaryCtaLabel', 'heroPrimaryCtaLink',
    'heroSecondaryCtaLabel', 'heroSecondaryCtaLink',
    'bannerEyebrow', 'bannerTitle', 'bannerSubtitle',
    'bannerCtaLabel', 'bannerCtaLink',
    'bannerImage', 'bannerLayout'
];

module.exports.getHomepageContent = async (req, res) => {
    try {
        let doc = await HomepageContent.findOne({ singleton: 'homepage' });
        if (!doc) {
            doc = await HomepageContent.create({ singleton: 'homepage' });
        }
        return res.status(200).json(doc);
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.updateHomepageContent = async (req, res) => {
    try {
        const updateData = {};
        for (const field of WHITELIST) {
            if (req.body[field] !== undefined) updateData[field] = req.body[field];
        }
        const doc = await HomepageContent.findOneAndUpdate(
            { singleton: 'homepage' },
            updateData,
            { new: true, upsert: true, runValidators: true }
        );
        return res.status(200).json(doc);
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.uploadHeroImages = async (req, res) => {
    try {
        if (!req.uploadedImages || req.uploadedImages.length === 0) {
            return res.status(400).json({ error: 'No images uploaded.' });
        }
        let doc = await HomepageContent.findOne({ singleton: 'homepage' });
        if (!doc) doc = await HomepageContent.create({ singleton: 'homepage' });
        doc.heroImages.push(...req.uploadedImages);
        await doc.save();
        return res.status(200).json({ message: 'Images added.', heroImages: doc.heroImages });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.deleteHeroImage = async (req, res) => {
    try {
        const doc = await HomepageContent.findOne({ singleton: 'homepage' });
        if (!doc) return res.status(404).json({ error: 'Homepage content not found.' });
        const idx = doc.heroImages.findIndex(img => img._id.toString() === req.params.imageId);
        if (idx === -1) return res.status(404).json({ error: 'Image not found.' });
        const imgUrl = doc.heroImages[idx].url;
        if (imgUrl.includes('cloudinary.com')) {
            try {
                const parts = imgUrl.split('/');
                const uploadIdx = parts.indexOf('upload');
                if (uploadIdx !== -1) {
                    const publicId = parts.slice(uploadIdx + 2).join('/').replace(/\.[^/.]+$/, '');
                    await cloudinary.uploader.destroy(publicId);
                }
            } catch (cloudErr) { console.error('Cloudinary delete error:', cloudErr); }
        }
        doc.heroImages.splice(idx, 1);
        await doc.save();
        return res.status(200).json({ message: 'Image deleted.', heroImages: doc.heroImages });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.reorderHeroImages = async (req, res) => {
    try {
        const doc = await HomepageContent.findOne({ singleton: 'homepage' });
        if (!doc) return res.status(404).json({ error: 'Homepage content not found.' });
        const { imageIds } = req.body;
        if (!Array.isArray(imageIds)) return res.status(400).json({ error: 'imageIds must be an array.' });
        const sorted = imageIds.map(id => doc.heroImages.find(img => img._id.toString() === id)).filter(Boolean);
        const includedIds = new Set(imageIds);
        doc.heroImages.forEach(img => { if (!includedIds.has(img._id.toString())) sorted.push(img); });
        doc.heroImages = sorted;
        await doc.save();
        return res.status(200).json({ message: 'Images reordered.', heroImages: doc.heroImages });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.uploadBannerImage = async (req, res) => {
    try {
        if (!req.uploadedImages || req.uploadedImages.length === 0) {
            return res.status(400).json({ error: 'No image uploaded.' });
        }
        let doc = await HomepageContent.findOne({ singleton: 'homepage' });
        if (!doc) doc = await HomepageContent.create({ singleton: 'homepage' });
        // Delete old banner image from Cloudinary if present
        if (doc.bannerImage?.url && doc.bannerImage.url.includes('cloudinary.com')) {
            try {
                const parts = doc.bannerImage.url.split('/');
                const uploadIdx = parts.indexOf('upload');
                if (uploadIdx !== -1) {
                    const publicId = parts.slice(uploadIdx + 2).join('/').replace(/\.[^/.]+$/, '');
                    await cloudinary.uploader.destroy(publicId);
                }
            } catch (cloudErr) { console.error('Cloudinary delete error:', cloudErr); }
        }
        doc.bannerImage = { url: req.uploadedImages[0].url, altText: req.uploadedImages[0].altText || '' };
        await doc.save();
        return res.status(200).json({ message: 'Banner image updated.', doc });
    } catch (error) { errorHandler(error, req, res); }
};
