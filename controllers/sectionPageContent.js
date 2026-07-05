const SectionPageContent = require('../models/SectionPageContent.js');
const { errorHandler } = require('../auth.js');

// Built-in pages are auto-created on first read and can't be deleted.
const BUILTIN_KEYS = new Set(['shop', 'group-buys']);
// Slugs reserved by built-in pages / top-level routes — custom pages can't use them.
const RESERVED_KEYS = new Set([
    'shop', 'group-buys', 'homepage', 'home', 'products', 'product', 'cart',
    'checkout', 'login', 'register', 'logout', 'profile', 'order-history',
    'community', 'contact', 'payment-success', 'admin', 'p', 'category',
    'categories', 'add-to-order', 'page-content',
]);
const META_FIELDS = ['title', 'navInclude', 'navLabel', 'navOrder'];
const CONTENT_FIELDS = ['blocks', 'gridAlign'];

const slugify = (s) => String(s || '').trim().toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // drop anything that isn't alphanumeric / space / dash
    .replace(/\s+/g, '-')           // spaces → dashes
    .replace(/-+/g, '-')            // collapse repeats
    .replace(/^-|-$/g, '');         // trim leading/trailing dashes

// Light metadata view (no blocks) for the navbar + admin page list.
const toMeta = (d) => ({
    pageKey: d.pageKey,
    title: d.title || '',
    isCustom: !!d.isCustom,
    navInclude: !!d.navInclude,
    navLabel: d.navLabel || '',
    navOrder: d.navOrder ?? 100,
});

// GET /  — list all pages (built-in + custom). Public so the navbar can read it.
module.exports.listPages = async (req, res) => {
    try {
        const docs = await SectionPageContent.find({}, '-blocks')
            .sort({ navOrder: 1, title: 1 }).lean();
        return res.status(200).json(docs.map(toMeta));
    } catch (error) { errorHandler(error, req, res); }
};

// POST /  — create a custom page (admin). Body: { title }.
module.exports.createPage = async (req, res) => {
    try {
        const title = String(req.body.title || '').trim();
        if (!title) return res.status(400).json({ error: 'A page name is required.' });

        const pageKey = slugify(req.body.slug || title);
        if (!pageKey) return res.status(400).json({ error: 'Could not derive a valid URL slug from that name.' });
        if (RESERVED_KEYS.has(pageKey)) return res.status(409).json({ error: `"${pageKey}" is reserved. Pick another name.` });
        if (await SectionPageContent.findOne({ pageKey })) {
            return res.status(409).json({ error: `A page with the slug "${pageKey}" already exists.` });
        }

        const doc = await SectionPageContent.create({
            pageKey, title, isCustom: true,
            navInclude: req.body.navInclude === true,
            navLabel: req.body.navLabel || '',
            navOrder: req.body.navOrder ?? 100,
            blocks: [], gridAlign: 'left',
        });
        return res.status(201).json(doc);
    } catch (error) { errorHandler(error, req, res); }
};

// GET /:pageKey  — full page document (blocks included). Public.
module.exports.getPageContent = async (req, res) => {
    try {
        const { pageKey } = req.params;
        let doc = await SectionPageContent.findOne({ pageKey });
        // Built-in pages are lazily created so the editor/page always has a doc.
        if (!doc && BUILTIN_KEYS.has(pageKey)) doc = await SectionPageContent.create({ pageKey });
        if (!doc) return res.status(404).json({ error: 'Page not found.' });
        return res.status(200).json(doc);
    } catch (error) { errorHandler(error, req, res); }
};

// PATCH /:pageKey  — update blocks/gridAlign (any page) + metadata (custom). Admin.
module.exports.updatePageContent = async (req, res) => {
    try {
        const { pageKey } = req.params;
        let doc = await SectionPageContent.findOne({ pageKey });
        if (!doc && BUILTIN_KEYS.has(pageKey)) doc = await SectionPageContent.create({ pageKey });
        if (!doc) return res.status(404).json({ error: 'Page not found.' });

        for (const f of CONTENT_FIELDS) if (req.body[f] !== undefined) doc[f] = req.body[f];
        // Metadata (title / nav settings) is only meaningful for custom pages.
        if (doc.isCustom) {
            for (const f of META_FIELDS) if (req.body[f] !== undefined) doc[f] = req.body[f];
        }
        await doc.save();
        return res.status(200).json(doc);
    } catch (error) { errorHandler(error, req, res); }
};

// DELETE /:pageKey  — remove a custom page (admin). Built-in pages are protected.
module.exports.deletePage = async (req, res) => {
    try {
        const { pageKey } = req.params;
        const doc = await SectionPageContent.findOne({ pageKey });
        if (!doc) return res.status(404).json({ error: 'Page not found.' });
        if (!doc.isCustom || BUILTIN_KEYS.has(pageKey)) {
            return res.status(400).json({ error: 'Built-in pages cannot be deleted.' });
        }
        await doc.deleteOne();
        return res.status(200).json({ message: 'Page deleted.', pageKey });
    } catch (error) { errorHandler(error, req, res); }
};
