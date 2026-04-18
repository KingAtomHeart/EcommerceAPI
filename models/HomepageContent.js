const mongoose = require('mongoose');

const homepageContentSchema = new mongoose.Schema({
    singleton: { type: String, default: 'homepage', unique: true },

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
