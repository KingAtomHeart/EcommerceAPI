const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User ID is required']
    },
    cartItems: [{
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            auto: true 
        },
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: [true, 'Product ID is required']
        },
        quantity: {
            type: Number,
            required: [true, 'Quantity is required']
        },
        subtotal: {
            type: Number,
            required: [true, 'Subtotal is required']
        }
    }],
    totalPrice: {
        type: Number,
        required: [true, 'Total price is required']
    },
    orderedOn: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Cart', cartSchema);