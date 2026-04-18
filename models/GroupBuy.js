const mongoose = require('mongoose');

// Config groups: required selections (color, layout). Each option can have an image.
const configOptionSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    options: [{
        value: { type: String, required: true, trim: true },
        available: { type: Boolean, default: true },
        priceModifier: { type: Number, default: 0 },
        image: {
            url: { type: String, default: '' },
            altText: { type: String, default: '' }
        }
    }]
}, { _id: true });

// Option values within a named option group (e.g., "Base Kit" at ₱7300).
const optionValueSchema = new mongoose.Schema({
    value: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    available: { type: Boolean, default: true },
    stocks: { type: Number, default: -1 }, // -1 = unlimited, 0+ = tracked
    image: {
        url: { type: String, default: '' },
        altText: { type: String, default: '' }
    }
}, { _id: true });

// Tracks which config options are available per option value.
const availabilityRuleSchema = new mongoose.Schema({
    optionValueId: { type: mongoose.Schema.Types.ObjectId, required: true },
    configName: { type: String, required: true },
    availableValues: [{ type: String }]
}, { _id: true });

// Option groups (e.g., "Kit" with values "Base Kit", "Novelties").
const optionGroupSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    values: [optionValueSchema]
}, { _id: true });

// Legacy kit schema — retained for backward compatibility with existing orders/interest checks.
const kitSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true, default: '' },
    image: {
        url: { type: String, default: '' },
        altText: { type: String, default: '' }
    },
    available: { type: Boolean, default: true }
}, { _id: true });

const interestSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
    configurations: [{
        name: { type: String },
        selected: { type: String }
    }],
    // selectedOption stored for interest checks (groupName → value)
    selectedOption: {
        groupName: { type: String, default: '' },
        value: { type: String, default: '' }
    },
    kits: [{ type: String }],
    note: { type: String, trim: true, default: '' },
    registeredAt: { type: Date, default: Date.now }
});

const groupBuySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    // Supports markdown: **bold**, *italic*, # headings, - lists
    description: { type: String, trim: true, default: '' },
    images: [{
        url: { type: String, required: true },
        altText: { type: String, default: '' }
    }],
    // Base price used when no options are defined. With options, each value has its own price.
    basePrice: { type: Number, required: true, min: 0 },
    options: [optionGroupSchema],           // NEW: named option groups
    configurations: [configOptionSchema],   // Config selectors with optional per-option images
    availabilityRules: [availabilityRuleSchema],
    kits: [kitSchema],                      // LEGACY: kept for existing order/IC data
    interestChecks: [interestSchema],
    status: {
        type: String,
        enum: ['interest-check', 'open', 'closing-soon', 'closed', 'production', 'completed'],
        default: 'interest-check'
    },
    moq: { type: Number, default: 0 },
    maxOrders: { type: Number, default: 0 },
    startDate: { type: Date },
    endDate: { type: Date },
    orderCount: { type: Number, default: 0 },
    category: { type: String, trim: true, default: 'keyboards' },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('GroupBuy', groupBuySchema);
