const mongoose = require('mongoose');

const groupBuyOrderSchema = new mongoose.Schema({
    orderCode: { type: String, required: true, unique: true },
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
    status: {
        type: String,
        enum: ['Confirmed', 'In Production', 'Shipped', 'Delivered', 'Cancelled'],
        default: 'Confirmed'
    },
    notes: { type: String, trim: true, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('GroupBuyOrder', groupBuyOrderSchema);