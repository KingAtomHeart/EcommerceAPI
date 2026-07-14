const SiteSettings = require('../models/SiteSettings.js');

const ALLOWED_STYLES = ['classic', 'minimal', 'pastel-paper', 'pixel'];

// Built-in navbar links an admin may rename. Keep in sync with
// EcommerceCLIENT/src/utils/navItems.js (NAV_ITEMS).
const ALLOWED_NAV_KEYS = ['home', 'shop', 'groupBuys', 'community', 'contact', 'dashboard', 'messages'];
const MAX_NAV_LABEL = 24;

// Mongoose Maps serialize oddly through res.json depending on version; convert
// to a plain object so the client always gets { key: label }.
function navLabelsToObject(doc) {
    if (!doc.navLabels) return {};
    return doc.navLabels instanceof Map ? Object.fromEntries(doc.navLabels) : { ...doc.navLabels };
}

exports.getSiteSettings = async (req, res, next) => {
    try {
        const doc = await SiteSettings.getSingleton();
        res.json({ style: doc.style, navLabels: navLabelsToObject(doc) });
    } catch (err) { next(err); }
};

exports.updateSiteSettings = async (req, res, next) => {
    try {
        const { style, navLabels } = req.body;
        if (style !== undefined && !ALLOWED_STYLES.includes(style)) {
            return res.status(400).json({ error: `style must be one of: ${ALLOWED_STYLES.join(', ')}` });
        }
        if (navLabels !== undefined && (typeof navLabels !== 'object' || navLabels === null || Array.isArray(navLabels))) {
            return res.status(400).json({ error: 'navLabels must be an object of { key: label }' });
        }
        const doc = await SiteSettings.getSingleton();
        if (style !== undefined) doc.style = style;
        if (navLabels !== undefined) {
            if (!(doc.navLabels instanceof Map)) doc.navLabels = new Map(Object.entries(doc.navLabels || {}));
            for (const [key, value] of Object.entries(navLabels)) {
                if (!ALLOWED_NAV_KEYS.includes(key)) {
                    return res.status(400).json({ error: `Unknown nav item: ${key}` });
                }
                if (value !== null && typeof value !== 'string') {
                    return res.status(400).json({ error: `Label for "${key}" must be a string` });
                }
                const trimmed = (value || '').trim().slice(0, MAX_NAV_LABEL);
                // Blank label = clear the override so the built-in default shows again.
                if (trimmed) doc.navLabels.set(key, trimmed);
                else doc.navLabels.delete(key);
            }
        }
        await doc.save();
        res.json({ style: doc.style, navLabels: navLabelsToObject(doc) });
    } catch (err) { next(err); }
};
