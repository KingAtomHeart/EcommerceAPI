const mongoose = require('mongoose');

const contactMessageSchema = new mongoose.Schema({
    formType: { type: String, enum: ['support', 'business'], required: true },
    fields: { type: Map, of: String, required: true },
    status: { type: String, enum: ['new', 'read', 'resolved'], default: 'new' },
}, { timestamps: true });

module.exports = mongoose.model('ContactMessage', contactMessageSchema);
