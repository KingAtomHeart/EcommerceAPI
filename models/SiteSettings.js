const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema({
    // 'classic' = original warm/serif/rounded look. 'minimal' = sharp/angular
    // origami-inspired look. Add more styles by extending the enum and the
    // matching [data-style="..."] block in globals.css.
    style: { type: String, enum: ['classic', 'minimal', 'pastel-paper'], default: 'classic' },
}, { timestamps: true });

// Singleton: every read/write resolves to the same document. Avoids needing
// to seed an ID anywhere else.
siteSettingsSchema.statics.getSingleton = async function () {
    let doc = await this.findOne();
    if (!doc) doc = await this.create({});
    return doc;
};

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
