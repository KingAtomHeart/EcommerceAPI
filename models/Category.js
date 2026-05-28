const mongoose = require('mongoose');

/* ────────────────────────────────────────────────────────────────────────
   Category — explicit metadata for the slugs that products and group buys
   already carry as string fields. Categories used to live entirely on the
   product/GB document; this model adds the "richer" surface (image,
   description, curated product order) without forcing a migration of the
   existing data.

   Coexistence with legacy data:
   - Products/GBs still store `category` as a string (the slug).
   - Categories without an explicit record still appear in dropdowns and in
     the strip — the list endpoint merges Category records with the
     distinct strings observed on Product + GroupBuy docs.
   - Saving a product/GB with a new category string auto-creates a stub
     Category record (handled in the controllers) so the admin can
     gradually fill in metadata without re-typing names.
   ──────────────────────────────────────────────────────────────────────── */

const categorySchema = new mongoose.Schema({
    // Display name shown in the strip + dropdowns.
    name: { type: String, required: true, trim: true },
    // URL-friendly slug. Must be unique. Lowercased + dashed automatically.
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    // Optional cover image for the per-category page hero + Categories grid tile.
    image: {
        url: { type: String, default: '' },
        altText: { type: String, default: '' }
    },
    // Optional copy shown on the category page.
    description: { type: String, default: '', trim: true },
    // Manual ordering of categories in the strip + Categories grid.
    // Lower = earlier. Defaults to a large number so unsorted entries land
    // at the end (then secondary-sort by name in the controller).
    sortOrder: { type: Number, default: 1000 },
    // Admin-curated lists. Each is an array of ids that map to the relevant
    // Product or GroupBuy collection. Stored as ObjectId so populate works.
    pinnedProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    pinnedGroupBuyIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GroupBuy' }]
}, { timestamps: true });

// Normalise slug on save so admins can type "Desk Accessories" and the
// stored value becomes "desk-accessories" (matching the convention used
// by existing product.category strings).
categorySchema.pre('validate', function (next) {
    if (this.slug) {
        this.slug = String(this.slug).trim().toLowerCase().replace(/\s+/g, '-');
    } else if (this.name) {
        this.slug = String(this.name).trim().toLowerCase().replace(/\s+/g, '-');
    }
    next();
});

module.exports = mongoose.model('Category', categorySchema);
