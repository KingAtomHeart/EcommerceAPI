const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productsOrdered: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        productName: { type: String },
        productImage: { type: String, default: '' },
        quantity: { type: Number, required: true },
        subtotal: { type: Number, required: true },
        selectedOption: {
            groupId: { type: mongoose.Schema.Types.ObjectId },
            groupName: { type: String },
            valueId: { type: mongoose.Schema.Types.ObjectId },
            value: { type: String }
        },
        configurations: [{
            name: { type: String },
            selected: { type: String }
        }],
        variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
        variantAttributes: { type: Map, of: String, default: {} }
    }],
    totalPrice: { type: Number, required: true },
    shippingFee: { type: Number, default: 0 },
    shippingRegion: { type: String },
    shippingAddress: {
        fullName: { type: String },
        phone: { type: String },
        street: { type: String },
        city: { type: String },
        province: { type: String },
        postalCode: { type: String }
    },
    billingAddress: {
        fullName: String, phone: String,
        street: String, city: String, province: String, postalCode: String
    },
    status: {
        type: String,
        enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'],
        default: 'Pending'
    },
    paymentStatus: {
        type: String,
        enum: ['awaiting_payment', 'paid', 'failed'],
        default: 'awaiting_payment'
    },
    paymentMethod: { type: String },
    paymentSessionId: { type: String },
    paidAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
