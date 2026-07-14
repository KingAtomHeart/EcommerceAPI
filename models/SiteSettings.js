const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema({
    // 'classic' = original warm/serif/rounded look. 'minimal' = sharp/angular
    // origami-inspired look. Add more styles by extending the enum and the
    // matching [data-style="..."] block in globals.css.
    style: { type: String, enum: ['classic', 'minimal', 'pastel-paper', 'pixel'], default: 'classic' },
    // Admin-chosen overrides for the built-in navbar link labels. Keyed by the
    // stable nav-item id (see ALLOWED_NAV_KEYS in controllers/siteSettings.js and
    // NAV_ITEMS on the client). A missing/blank entry means "use the default label".
    navLabels: { type: Map, of: String, default: {} },
}, { timestamps: true });

// Singleton: every read/write resolves to the same document. Avoids needing
// to seed an ID anywhere else.
siteSettingsSchema.statics.getSingleton = async function () {
    let doc = await this.findOne();
    if (!doc) doc = await this.create({});
    return doc;
};

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
