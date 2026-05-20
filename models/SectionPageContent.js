const mongoose = require('mongoose');

// Generic page-blocks document. Powers the Shop and Group Buys pages — same
// block system as the homepage, but stored per-pageKey so each surface has its
// own admin-built sections (hero, banner, collection, etc.) that render ABOVE
// the existing catalog grid. The catalog itself stays untouched.
const blockSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['hero', 'categoryStrip', 'collection', 'productGrid', 'productHero', 'banner', 'groupBuys'],
        required: true
    },
    enabled: { type: Boolean, default: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: true });

const sectionPageContentSchema = new mongoose.Schema({
    pageKey: { type: String, required: true, unique: true, enum: ['shop', 'group-buys'] },
    blocks: { type: [blockSchema], default: [] },
    // Catalog-grid alignment for the page below the blocks. The catalog grid
    // itself isn't built out of blocks — it's the live product/group-buy list
    // with its own filters. This single knob centers OR left-aligns it.
    gridAlign: { type: String, enum: ['left', 'center'], default: 'left' },
}, { timestamps: true });

module.exports = mongoose.model('SectionPageContent', sectionPageContentSchema);
