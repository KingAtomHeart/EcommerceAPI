const mongoose = require('mongoose');

const groupBuyOrderSchema = new mongoose.Schema({
    orderCode: { type: String, required: true, unique: true },
    cartOrderCode: { type: String, index: true, default: null },
    cartCheckoutId: { type: String, index: true, default: null },
    groupBuyId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupBuy', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    configurations: [{
        name: { type: String, required: true },
        selected: { type: String, required: true }
    }],
    selectedOption: {
        groupName: { type: String, default: '' },
        value: { type: String, default: '' },
        price: { type: Number, default: 0 }
    },
    kits: [{
        kitId: { type: mongoose.Schema.Types.ObjectId },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, default: 1 }
    }],
    quantity: { type: Number, default: 1, min: 1 },
    totalPrice: { type: Number, required: true },
    shippingAddress: {
        fullName: { type: String, trim: true },
        street: { type: String, trim: true },
        city: { type: String, trim: true },
        province: { type: String, trim: true },
        zipCode: { type: String, trim: true },
        phone: { type: String, trim: true }
    },
    // Per-cart shipping status, mirrors in-stock orders. Admin sets one value per cart-order
    // (all line items in a cartCheckoutId share the same status). Old enum values kept for
    // backwards compatibility with historical orders.
    status: {
        type: String,
        enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Confirmed', 'In Production'],
        default: 'Pending'
    },
    notes: { type: String, trim: true, default: '' },
    // Packing checklist — flipped by whoever is preparing the customer's box.
    // Independent of order status; admin-only field.
    packed: { type: Boolean, default: false },
    addedAfterPurchase: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('GroupBuyOrder', groupBuyOrderSchema);