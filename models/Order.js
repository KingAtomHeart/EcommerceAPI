const mongoose = require('mongoose');

// Crockford-style alphabet (omits I, L, O, U) so order numbers are unambiguous when
// dictated over chat/phone. 32^8 = ~1.1 trillion possible values — collision risk
// is effectively zero for any small-shop volume; the unique index catches the rest.
const ORDER_NUMBER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function generateOrderNumber() {
    let suffix = '';
    for (let i = 0; i < 8; i++) {
        suffix += ORDER_NUMBER_ALPHABET[Math.floor(Math.random() * ORDER_NUMBER_ALPHABET.length)];
    }
    return `OR-${suffix}`;
}

const orderSchema = new mongoose.Schema({
    // Customer-facing order identifier. Used for support tickets / cancellation requests.
    // Sparse so legacy orders without one don't trip the unique index until they're backfilled.
    orderNumber: { type: String, unique: true, sparse: true, index: true },
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
        variantAttributes: { type: Map, of: String, default: {} },
        status: {
            type: String,
            enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'],
            default: 'Pending'
        },
        // Packing checklist — flipped by whoever is preparing the box.
        // Independent of order/item status; admin-only field.
        packed: { type: Boolean, default: false },
        addedAfterPurchase: { type: Boolean, default: false }
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

// Auto-allocate an order number on first save. Retries on the rare unique-index hit.
orderSchema.pre('save', async function (next) {
    if (this.orderNumber) return next();
    for (let attempt = 0; attempt < 6; attempt++) {
        const candidate = generateOrderNumber();
        // eslint-disable-next-line no-await-in-loop
        const taken = await this.constructor.exists({ orderNumber: candidate });
        if (!taken) { this.orderNumber = candidate; return next(); }
    }
    next(new Error('Could not allocate a unique order number'));
});

orderSchema.statics.generateOrderNumber = generateOrderNumber;

module.exports = mongoose.model('Order', orderSchema);
