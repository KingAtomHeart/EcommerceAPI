const Category = require('../models/Category.js');
const Product = require('../models/Product.js');
const GroupBuy = require('../models/GroupBuy.js');
const { errorHandler } = require('../auth.js');

/* List endpoint — public.
   Merges Category records with the distinct category strings observed on
   active products + group buys. Categories with a record carry the full
   metadata; categories that only exist as strings get a stub entry so they
   still show up in the strip and dropdowns.
   ─────────────────────────────────────────────────────────────────────── */
module.exports.listCategories = async (req, res) => {
    try {
        const [records, productSlugs, gbSlugs] = await Promise.all([
            Category.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
            Product.distinct('category', { isActive: true, isQueued: { $ne: true } }),
            GroupBuy.distinct('category', { isActive: true, isQueued: { $ne: true } })
        ]);

        // Normalise to slug shape and de-duplicate. Strings from product/GB
        // docs are sometimes typed with spaces ("Desk Accessories") so flatten
        // to the same lowercase-dashed convention before comparing.
        const slugOf = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '-');
        const allStringSlugs = new Set([...productSlugs, ...gbSlugs].map(slugOf).filter(Boolean));

        const byslug = new Map();
        for (const r of records) {
            byslug.set(r.slug, {
                _id: r._id,
                name: r.name,
                slug: r.slug,
                image: r.image || { url: '', altText: '' },
                description: r.description || '',
                sortOrder: r.sortOrder ?? 1000,
                pinnedProductIds: r.pinnedProductIds || [],
                pinnedGroupBuyIds: r.pinnedGroupBuyIds || [],
                landingPage: Array.isArray(r.landingPage) ? r.landingPage : [],
                customPageHtml: r.customPageHtml || '',
                hasRecord: true,
            });
        }
        for (const slug of allStringSlugs) {
            if (!byslug.has(slug)) {
                // Title-case the slug so the stub looks reasonable in the UI
                // until the admin fills in proper metadata.
                const name = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                byslug.set(slug, {
                    _id: null,
                    name,
                    slug,
                    image: { url: '', altText: '' },
                    description: '',
                    sortOrder: 1000,
                    pinnedProductIds: [],
                    pinnedGroupBuyIds: [],
                    landingPage: [],
                    customPageHtml: '',
                    hasRecord: false,
                });
            }
        }

        const list = [...byslug.values()].sort((a, b) =>
            (a.sortOrder ?? 1000) - (b.sortOrder ?? 1000)
            || a.name.localeCompare(b.name)
        );
        return res.status(200).json(list);
    } catch (error) { errorHandler(error, req, res); }
};

/* Single — public. Includes populated pinned arrays so the per-category
   page can render product cards without a second round-trip. */
module.exports.getCategory = async (req, res) => {
    try {
        const slug = String(req.params.slug || '').toLowerCase();
        const record = await Category.findOne({ slug })
            .populate('pinnedProductIds')
            .populate('pinnedGroupBuyIds')
            .lean();

        // Returns a stub (no record yet) when the slug is used by products
        // but hasn't been promoted to a Category record. Lets the page still
        // render the auto-derived list.
        if (!record) {
            const [productMatch, gbMatch] = await Promise.all([
                Product.exists({ category: { $regex: new RegExp(`^${slug.replace(/-/g, '\\s?')}$`, 'i') } }),
                GroupBuy.exists({ category: { $regex: new RegExp(`^${slug.replace(/-/g, '\\s?')}$`, 'i') } })
            ]);
            if (!productMatch && !gbMatch) {
                return res.status(404).json({ error: 'Category not found.' });
            }
            const name = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            return res.status(200).json({
                _id: null, name, slug,
                image: { url: '', altText: '' }, description: '',
                sortOrder: 1000, pinnedProductIds: [], pinnedGroupBuyIds: [],
                landingPage: [], customPageHtml: '',
                hasRecord: false,
            });
        }
        return res.status(200).json({ ...record, hasRecord: true });
    } catch (error) { errorHandler(error, req, res); }
};

/* Create — admin only. Slug is derived from name when missing. Returns 409
   if the slug already has a record. */
module.exports.createCategory = async (req, res) => {
    try {
        const { name, slug, image, description, sortOrder, pinnedProductIds, pinnedGroupBuyIds, landingPage, customPageHtml } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required.' });
        const finalSlug = String(slug || name).trim().toLowerCase().replace(/\s+/g, '-');
        const exists = await Category.findOne({ slug: finalSlug });
        if (exists) return res.status(409).json({ error: 'A category with this slug already exists.' });
        const created = await Category.create({
            name, slug: finalSlug,
            image: image || { url: '', altText: '' },
            description: description || '',
            sortOrder: sortOrder == null ? 1000 : Number(sortOrder),
            pinnedProductIds: Array.isArray(pinnedProductIds) ? pinnedProductIds : [],
            pinnedGroupBuyIds: Array.isArray(pinnedGroupBuyIds) ? pinnedGroupBuyIds : [],
            landingPage: Array.isArray(landingPage) ? landingPage : [],
            customPageHtml: customPageHtml || '',
        });
        return res.status(201).json(created);
    } catch (error) { errorHandler(error, req, res); }
};

/* Update — admin only. Slug change cascades: existing products/GBs using
   the old slug are NOT auto-renamed (would break links + history). Admin
   has to update those manually if they want the old data to follow. */
module.exports.updateCategory = async (req, res) => {
    try {
        const allowed = ['name', 'slug', 'image', 'description', 'sortOrder', 'pinnedProductIds', 'pinnedGroupBuyIds', 'landingPage', 'customPageHtml'];
        const patch = {};
        for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
        if (patch.slug) {
            patch.slug = String(patch.slug).trim().toLowerCase().replace(/\s+/g, '-');
            // Reject collision before save() to give the admin a friendlier
            // error than Mongoose's E11000.
            const collide = await Category.findOne({ slug: patch.slug, _id: { $ne: req.params.id } });
            if (collide) return res.status(409).json({ error: 'Another category already uses this slug.' });
        }
        const updated = await Category.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
        if (!updated) return res.status(404).json({ error: 'Category not found.' });
        return res.status(200).json(updated);
    } catch (error) { errorHandler(error, req, res); }
};

/* Delete — admin only. Only removes the metadata record; products/GBs that
   still use this category string keep their tag, so the slug continues to
   appear as a stub in the list endpoint. */
module.exports.deleteCategory = async (req, res) => {
    try {
        const deleted = await Category.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Category not found.' });
        return res.status(200).json({ message: 'Category deleted.', slug: deleted.slug });
    } catch (error) { errorHandler(error, req, res); }
};

/* Helper used by product + GB save flows to upgrade a new category string
   into a Category record (no-op if one already exists). Keeps the admin
   off the hook for switching tabs to "register" a category before saving.
   ─────────────────────────────────────────────────────────────────────── */
module.exports.ensureCategoryExists = async (rawCategory) => {
    const slug = String(rawCategory || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) return null;
    const existing = await Category.findOne({ slug });
    if (existing) return existing;
    const name = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    try {
        return await Category.create({ name, slug });
    } catch {
        // Concurrent saves with the same new category — swallow the
        // duplicate-key error and re-fetch.
        return Category.findOne({ slug });
    }
};
