const SiteSettings = require('../models/SiteSettings.js');

const ALLOWED_STYLES = ['classic', 'minimal', 'pastel-paper', 'pixel'];

exports.getSiteSettings = async (req, res, next) => {
    try {
        const doc = await SiteSettings.getSingleton();
        res.json({ style: doc.style });
    } catch (err) { next(err); }
};

exports.updateSiteSettings = async (req, res, next) => {
    try {
        const { style } = req.body;
        if (style !== undefined && !ALLOWED_STYLES.includes(style)) {
            return res.status(400).json({ error: `style must be one of: ${ALLOWED_STYLES.join(', ')}` });
        }
        const doc = await SiteSettings.getSingleton();
        if (style !== undefined) doc.style = style;
        await doc.save();
        res.json({ style: doc.style });
    } catch (err) { next(err); }
};
