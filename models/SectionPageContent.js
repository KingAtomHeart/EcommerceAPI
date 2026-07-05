const mongoose = require('mongoose');

// Generic page-blocks document. Powers the Shop and Group Buys pages — same
// block system as the homepage, but stored per-pageKey so each surface has its
// own admin-built sections (hero, banner, collection, etc.) that render ABOVE
// the existing catalog grid. The catalog itself stays untouched.
const blockSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['hero', 'categoryStrip', 'categoriesGrid', 'collection', 'productGrid', 'productHero', 'banner', 'groupBuys', 'catalog'],
        required: true
    },
    enabled: { type: Boolean, default: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: true });

const sectionPageContentSchema = new mongoose.Schema({
    // Built-in pages use the reserved keys 'shop' / 'group-buys'. Custom,
    // admin-created pages use a slug derived from their title and live at
    // /p/<pageKey>. The enum lock was removed so any slug is allowed.
    pageKey: { type: String, required: true, unique: true },
    // Custom-page metadata (built-in pages leave these at defaults).
    title: { type: String, default: '' },        // display name for custom pages
    isCustom: { type: Boolean, default: false },  // true for admin-created pages
    navInclude: { type: Boolean, default: false },// render a link in the navbar
    navLabel: { type: String, default: '' },      // navbar link text (falls back to title)
    navOrder: { type: Number, default: 100 },     // navbar ordering (low = first)
    blocks: { type: [blockSchema], default: [] },
    // Catalog-grid alignment for the page below the blocks. The catalog grid
    // itself isn't built out of blocks — it's the live product/group-buy list
    // with its own filters. This single knob centers OR left-aligns it.
    gridAlign: { type: String, enum: ['left', 'center'], default: 'left' },
}, { timestamps: true });

module.exports = mongoose.model('SectionPageContent', sectionPageContentSchema);
