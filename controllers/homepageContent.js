const HomepageContent = require('../models/HomepageContent.js');
const { errorHandler } = require('../auth.js');
const cloudinary = require('cloudinary').v2;

const WHITELIST = [
    'blocks',
    'heroImages', 'heroEyebrow', 'heroTitle', 'heroSubtitle',
    'heroPrimaryCtaLabel', 'heroPrimaryCtaLink',
    'heroSecondaryCtaLabel', 'heroSecondaryCtaLink',
    'bannerEyebrow', 'bannerTitle', 'bannerSubtitle',
    'bannerCtaLabel', 'bannerCtaLink',
    'bannerImage', 'bannerLayout'
];

// Seed the blocks array from legacy flat fields so admins who customized the
// homepage before the block refactor don't lose their copy. Runs at most once
// per doc (only when `blocks` is empty).
function seedBlocksFromLegacy(doc) {
    const heroImages = (doc.heroImages || []).map(i => ({ url: i.url, altText: i.altText || '' }));
    return [
        {
            type: 'hero', enabled: true, data: {
                eyebrow: doc.heroEyebrow || '',
                title: doc.heroTitle || '',
                subtitle: doc.heroSubtitle || '',
                primaryCtaLabel: doc.heroPrimaryCtaLabel || '',
                primaryCtaLink: doc.heroPrimaryCtaLink || '',
                secondaryCtaLabel: doc.heroSecondaryCtaLabel || '',
                secondaryCtaLink: doc.heroSecondaryCtaLink || '',
                images: heroImages,
            }
        },
        { type: 'categoryStrip', enabled: true, data: {} },
        {
            type: 'collection', enabled: true, data: {
                source: 'products', layout: 'carousel',
                title: 'Featured Products', subtitle: '',
                category: '', sort: 'featured', limit: 6, viewAllLink: '/products',
            }
        },
        {
            type: 'collection', enabled: true, data: {
                source: 'group-buys', layout: 'grid', columns: 4,
                gbMode: 'active', limit: 4,
                title: 'Active Group Buys',
                subtitle: 'Join production runs for exclusive keyboards and accessories.',
                viewAllLink: '/group-buys',
            }
        },
        {
            type: 'collection', enabled: true, data: {
                source: 'group-buys', layout: 'grid', columns: 4,
                gbMode: 'interest-check', limit: 4,
                title: 'Interest Checks',
                subtitle: 'Help shape what we make next. Show interest — no commitment.',
                viewAllLink: '/group-buys',
            }
        },
        {
            type: 'banner', enabled: true, data: {
                eyebrow: doc.bannerEyebrow || '',
                title: doc.bannerTitle || '',
                subtitle: doc.bannerSubtitle || '',
                ctaLabel: doc.bannerCtaLabel || '',
                ctaLink: doc.bannerCtaLink || '',
                image: { url: doc.bannerImage?.url || '', altText: doc.bannerImage?.altText || '' },
                layout: doc.bannerLayout || 'overlay',
            }
        },
    ];
}

// Convert a legacy block to the unified `collection` shape. Returns the
// original block unchanged for already-migrated types (hero, banner,
// categoryStrip, collection).
function migrateBlockToCollection(b) {
    const block = b.toObject ? b.toObject() : { ...b };
    const data = { ...(block.data || {}) };

    if (block.type === 'productGrid') {
        return {
            ...block,
            type: 'collection',
            data: {
                ...data,
                source: 'products',
                layout: data.layout === 'grid' ? 'grid' : 'carousel',
            },
        };
    }
    if (block.type === 'productHero') {
        return {
            ...block,
            type: 'collection',
            data: {
                ...data,
                source: 'products',
                layout: 'hero',
                // The legacy productHero block stored single/pair/triple under
                // `layout`; the unified collection uses `layout: 'hero'` for the
                // mode and `heroVariant` for the tile count.
                heroVariant: data.layout || 'pair',
            },
        };
    }
    if (block.type === 'groupBuys') {
        return {
            ...block,
            type: 'collection',
            data: {
                ...data,
                source: 'group-buys',
                gbMode: data.mode || 'active',
                layout: data.layout || 'grid',
                // Legacy home-card-grid was 4-up; preserve that as the default so
                // migrated blocks don't shrink from 4 columns to 3.
                columns: data.columns || 4,
            },
        };
    }
    return block;
}

module.exports.getHomepageContent = async (req, res) => {
    try {
        let doc = await HomepageContent.findOne({ singleton: 'homepage' });
        if (!doc) {
            doc = await HomepageContent.create({ singleton: 'homepage' });
        }
        if (!doc.blocksInitialized) {
            doc.blocks = seedBlocksFromLegacy(doc);
            doc.blocksInitialized = true;
            await doc.save();
        }
        // Lazy migration: convert any legacy block types in stored docs to the
        // unified `collection` shape. Idempotent — already-migrated blocks pass
        // through. Only persists when at least one block actually changes.
        const migratedBlocks = (doc.blocks || []).map(migrateBlockToCollection);
        const didMigrate = migratedBlocks.some((b, i) => b.type !== doc.blocks[i].type);
        if (didMigrate) {
            doc.blocks = migratedBlocks;
            doc.markModified('blocks');
            await doc.save();
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
