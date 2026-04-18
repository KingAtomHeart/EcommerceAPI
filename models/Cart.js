const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    groupBuyId: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupBuy', default: null },
    groupBuyName: { type: String, default: '' },

    // Legacy kit fields — kept for backward compatibility
    kitId: { type: mongoose.Schema.Types.ObjectId, default: null },
    kitName: { type: String, default: '' },

    // New option selection — used when product has options (e.g., Kit: Base Kit/Novelties)
    selectedOption: {
        groupId:   { type: mongoose.Schema.Types.ObjectId, default: null },
        groupName: { type: String, default: '' },
        valueId:   { type: mongoose.Schema.Types.ObjectId, default: null },
        value:     { type: String, default: '' }
    },

    configurations: [{     // selected config options (e.g., Layout: WK, Color: Red)
        name: { type: String },
        selected: { type: String }
    }],
    quantity: { type: Number, required: true, min: [1, 'Quantity must be at least 1'] },
    subtotal: { type: Number, required: true }
});

const cartSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    cartType: {
        type: String,
        enum: ['regular', 'groupbuy'],
        default: 'regular'
    },
    cartItems: [cartItemSchema],
    totalPrice: { type: Number, required: true, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Cart', cartSchema);
