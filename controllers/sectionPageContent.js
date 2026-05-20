const SectionPageContent = require('../models/SectionPageContent.js');
const { errorHandler } = require('../auth.js');

const VALID_KEYS = new Set(['shop', 'group-buys']);
const WHITELIST = ['blocks', 'gridAlign'];

module.exports.getPageContent = async (req, res) => {
    try {
        const { pageKey } = req.params;
        if (!VALID_KEYS.has(pageKey)) return res.status(400).json({ error: 'Invalid page key.' });

        let doc = await SectionPageContent.findOne({ pageKey });
        if (!doc) doc = await SectionPageContent.create({ pageKey });
        return res.status(200).json(doc);
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.updatePageContent = async (req, res) => {
    try {
        const { pageKey } = req.params;
        if (!VALID_KEYS.has(pageKey)) return res.status(400).json({ error: 'Invalid page key.' });

        const updateData = {};
        for (const field of WHITELIST) {
            if (req.body[field] !== undefined) updateData[field] = req.body[field];
        }
        const doc = await SectionPageContent.findOneAndUpdate(
            { pageKey },
            updateData,
            { new: true, upsert: true, runValidators: true }
        );
        return res.status(200).json(doc);
    } catch (error) { errorHandler(error, req, res); }
};
