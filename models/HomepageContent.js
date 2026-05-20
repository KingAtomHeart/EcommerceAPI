const mongoose = require('mongoose');

// Each block is one section of the homepage. Admin can add/remove/reorder.
// `data` is type-specific and validated client-side; we keep it Mixed so block
// shapes can evolve without a migration.
const blockSchema = new mongoose.Schema({
    type: {
        type: String,
        // `collection` is the new unified type that subsumes productGrid,
        // productHero, and groupBuys — admin picks source + layout inside it.
        // The old types stay in the enum so legacy docs continue to validate
        // until the controller migrates them on read.
        enum: ['hero', 'categoryStrip', 'collection', 'productGrid', 'productHero', 'banner', 'groupBuys'],
        required: true
    },
    enabled: { type: Boolean, default: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: true });

const homepageContentSchema = new mongoose.Schema({
    singleton: { type: String, default: 'homepage', unique: true },

    // Modular section list. When empty (legacy doc), the controller lazily seeds
    // it from the flat fields below so existing copy isn't lost.
    blocks: [blockSchema],

    // Flips to true the first time we seed `blocks` from the legacy flat fields.
    // After that, admin can clear all blocks intentionally without us re-seeding.
    blocksInitialized: { type: Boolean, default: false },

    // Legacy flat fields — kept for the migration seed and as fallbacks. New
    // edits live in `blocks`; these are no longer the source of truth.
    heroImages: [{
        url: { type: String, required: true },
        altText: { type: String, default: '' }
    }],

    heroEyebrow:  { type: String, default: 'Spring 2026 Collection' },
    heroTitle:    { type: String, default: 'Craft your perfect *setup.*' },
    heroSubtitle: { type: String, default: 'Precision-built mechanical keyboards and desk accessories for those who care about every detail — from switch feel to surface texture.' },
    heroPrimaryCtaLabel:    { type: String, default: 'Shop Now' },
    heroPrimaryCtaLink:     { type: String, default: '/products' },
    heroSecondaryCtaLabel:  { type: String, default: 'Explore Keyboards' },
    heroSecondaryCtaLink:   { type: String, default: '/products?cat=keyboards' },

    bannerEyebrow:  { type: String, default: 'Limited Drop' },
    bannerTitle:    { type: String, default: 'The *Origami Keys Originals* is here.' },
    bannerSubtitle: { type: String, default: 'Our very own design of keyboards and accessories.' },
    bannerCtaLabel: { type: String, default: 'Browse Collection' },
    bannerCtaLink:  { type: String, default: '/products' },
    bannerImage: {
        url:     { type: String, default: '' },
        altText: { type: String, default: '' }
    },
    bannerLayout: {
        type: String,
        enum: ['split', 'overlay', 'stacked', 'fullbleed'],
        default: 'overlay'
    }
}, { timestamps: true });

module.exports = mongoose.model('HomepageContent', homepageContentSchema);
