const mongoose = require('mongoose');

// Config groups: required selections (color, layout, pcb). Customer picks one per group.
// Each option can have an optional image that overrides the product image when selected.
const configOptionSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    options: [{
        value: { type: String, required: true, trim: true },
        available: { type: Boolean, default: true },
        stocks: { type: Number, default: -1 }, // -1 = unlimited
        priceModifier: { type: Number, default: 0 },
        image: {
            url: { type: String, default: '' },
            altText: { type: String, default: '' }
        }
    }]
}, { _id: true });

// Rules that restrict which config values are available for a given combination of selections.
// Each rule has an AND-list of conditions; the rule is active only when ALL conditions match.
// Example: When Color=Beige/Mint AND Layout=WK → Grade allows [B-Stock] only.
const configAvailabilityRuleSchema = new mongoose.Schema({
    conditions: [{
        configName: { type: String, required: true },
        selectedValue: { type: String, required: true }
    }],
    targetConfigName: { type: String, required: true },
    availableValues: [{ type: String }]
}, { _id: true });

// Option values within a named option group (e.g., "Base Kit" at ₱7300).
// Selecting an option sets the base price and optionally updates the product image.
const optionValueSchema = new mongoose.Schema({
    value: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    available: { type: Boolean, default: true },
    stocks: { type: Number, default: -1 }, // -1 = unlimited
    image: {
        url: { type: String, default: '' },
        altText: { type: String, default: '' }
    }
}, { _id: true });

// Option groups (e.g., "Kit" with values "Base Kit", "Novelties").
// A product with options requires the customer to pick one value per group.
const optionGroupSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    values: [optionValueSchema]
}, { _id: true });

// Legacy kit schema — kept for backward compatibility only.
const kitSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true, default: '' },
    image: {
        url: { type: String, default: '' },
        altText: { type: String, default: '' }
    },
    available: { type: Boolean, default: true },
    stocks: { type: Number, default: -1 } // -1 = unlimited
}, { _id: true });

const productSchema = new mongoose.Schema({
    name: { type: String, required: [true, 'Product name is required'], trim: true },
    // Supports markdown: **bold**, *italic*, # headings, - lists, blank lines = paragraphs
    description: { type: String, required: [true, 'Product description is required'], trim: true },
    // Base price used when product has no options. With options, each option value has its own price.
    price: { type: Number, required: [true, 'Product price is required'], min: [0, 'Price cannot be negative'] },
    stocks: { type: Number, default: -1, min: [-1, 'Stocks cannot be less than -1'] }, // -1 = unlimited
    images: [{
        url: { type: String, required: true },
        altText: { type: String, default: '' }
    }],
    options: [optionGroupSchema],           // Named option groups (e.g., Kit: Base Kit/Novelties)
    configurations: [configOptionSchema],   // Config selectors that add to the base/option price
    configAvailabilityRules: [configAvailabilityRuleSchema], // Cross-config availability filtering
    kits: [kitSchema],                      // LEGACY: kept for backward compat, not used in new UI
    category: { type: String, trim: true, default: 'Uncategorized' },
    specifications: {
        type: [{
            label: { type: String, required: true, trim: true },
            value: { type: String, required: true, trim: true }
        }],
        default: []
    },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

productSchema.index({ name: 'text', description: 'text' });

// Upgrade legacy single-condition rules (configName/selectedValue) to conditions[] shape on save.
productSchema.pre('validate', function (next) {
    if (Array.isArray(this.configAvailabilityRules)) {
        this.configAvailabilityRules = this.configAvailabilityRules.map(r => {
            if (Array.isArray(r.conditions) && r.conditions.length > 0) return r;
            if (r.configName && r.selectedValue) {
                return {
                    _id: r._id,
                    conditions: [{ configName: r.configName, selectedValue: r.selectedValue }],
                    targetConfigName: r.targetConfigName,
                    availableValues: r.availableValues || []
                };
            }
            return r;
        });
    }
    next();
});

module.exports = mongoose.model('Product', productSchema);
