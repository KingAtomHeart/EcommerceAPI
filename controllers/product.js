const Product = require('../models/Product.js');
const { errorHandler } = require('../auth.js');
const cloudinary = require('cloudinary').v2;

module.exports.createProduct = async (req, res) => {
    try {
        const { name, description, price, stocks, category } = req.body;
        if (!name || !description || price == null) {
            return res.status(400).json({ error: 'name, description, and price are required.' });
        }
        const existing = await Product.findOne({ name });
        if (existing) return res.status(409).json({ error: 'A product with that name already exists.' });

        let images = [];
        if (req.uploadedImages && req.uploadedImages.length > 0) images = req.uploadedImages;

        const newProduct = new Product({ name, description, price, stocks, category, images });
        const saved = await newProduct.save();
        return res.status(201).json(saved);
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.uploadProductImages = async (req, res) => {
    try {
        const product = await Product.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        if (!req.uploadedImages || req.uploadedImages.length === 0) return res.status(400).json({ error: 'No images were uploaded.' });
        product.images.push(...req.uploadedImages);
        await product.save();
        return res.status(200).json({ message: 'Images added.', images: product.images });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.deleteProductImage = async (req, res) => {
    try {
        const { productId, imageId } = req.params;
        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        const imageIndex = product.images.findIndex(img => img._id.toString() === imageId);
        if (imageIndex === -1) return res.status(404).json({ error: 'Image not found.' });
        const imgUrl = product.images[imageIndex].url;
        if (imgUrl.includes('cloudinary.com')) {
            try {
                const parts = imgUrl.split('/');
                const uploadIdx = parts.indexOf('upload');
                if (uploadIdx !== -1) {
                    const publicId = parts.slice(uploadIdx + 2).join('/').replace(/\.[^/.]+$/, '');
                    await cloudinary.uploader.destroy(publicId);
                }
            } catch (cloudErr) { console.error('Cloudinary delete error:', cloudErr); }
        }
        product.images.splice(imageIndex, 1);
        await product.save();
        return res.status(200).json({ message: 'Image deleted.', images: product.images });
    } catch (error) { errorHandler(error, req, res); }
};

// ─── PATCH /products/:productId/images/reorder ───────────────────────────────
module.exports.reorderProductImages = async (req, res) => {
    try {
        const product = await Product.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        const { imageIds } = req.body;
        if (!Array.isArray(imageIds)) return res.status(400).json({ error: 'imageIds must be an array.' });
        const sorted = imageIds.map(id => product.images.find(img => img._id.toString() === id)).filter(Boolean);
        const includedIds = new Set(imageIds);
        product.images.forEach(img => { if (!includedIds.has(img._id.toString())) sorted.push(img); });
        product.images = sorted;
        await product.save();
        return res.status(200).json({ message: 'Images reordered.', images: product.images });
    } catch (error) { errorHandler(error, req, res); }
};

// ─── POST /products/:productId/images/add-url ────────────────────────────────
module.exports.addProductImageByUrl = async (req, res) => {
    try {
        const product = await Product.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        const { url, altText } = req.body;
        if (!url || !url.trim()) return res.status(400).json({ error: 'url is required.' });
        product.images.push({ url: url.trim(), altText: altText?.trim() || '' });
        await product.save();
        return res.status(200).json({ message: 'Image added.', images: product.images });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.retrieveAllProducts = async (req, res) => {
    try { return res.status(200).json(await Product.find({})); }
    catch (error) { errorHandler(error, req, res); }
};

module.exports.retrieveAllActive = async (req, res) => {
    try { return res.status(200).json(await Product.find({ isActive: true })); }
    catch (error) { errorHandler(error, req, res); }
};

module.exports.retrieveSingleProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        return res.status(200).json(product);
    } catch (error) { errorHandler(error, req, res); }
};

// Update — supports name, description, price, stocks, category, options, configurations, kits, variant fields
module.exports.updateProduct = async (req, res) => {
    try {
        const allowed = ['name', 'description', 'price', 'stocks', 'category', 'options', 'configurations', 'configAvailabilityRules', 'kits', 'specifications', 'useVariants', 'variantDimensions', 'variants', 'variantImages'];
        const updateData = {};
        for (const field of allowed) {
            if (req.body[field] !== undefined) updateData[field] = req.body[field];
        }
        const updated = await Product.findByIdAndUpdate(req.params.productId, updateData, { new: true, runValidators: true });
        if (!updated) return res.status(404).json({ error: 'Product not found.' });
        return res.status(200).json({ message: 'Product updated successfully.', product: updated });
    } catch (error) { errorHandler(error, req, res); }
};

// ── Variant endpoints ─────────────────────────────────────────────────────────

module.exports.importVariants = async (req, res) => {
    try {
        const { dimensions, variants, images, replace } = req.body;
        const product = await Product.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });

        if (replace || !product.useVariants) {
            product.variantDimensions = dimensions || [];
            product.variants = [];
            product.variantImages = images || [];
            product.useVariants = true;
        } else {
            if (dimensions) product.variantDimensions = dimensions;
        }

        const toObj = v => v instanceof Map ? Object.fromEntries(v) : (v || {});
        const eqAttrs = (a, b) => {
            const ae = Object.entries(toObj(a));
            const be = Object.entries(toObj(b));
            if (ae.length !== be.length) return false;
            return ae.every(([k, v]) => toObj(b)[k] === v);
        };

        for (const v of (variants || [])) {
            const ex = product.variants.find(e => eqAttrs(e.attributes, v.attributes));
            if (ex) {
                if (v.stock !== undefined) ex.stock = v.stock;
                if (v.price !== undefined) ex.price = v.price;
                if (v.sku !== undefined) ex.sku = v.sku;
                if (v.available !== undefined) ex.available = v.available;
            } else {
                product.variants.push(v);
            }
        }

        if (replace && images) {
            product.variantImages = images;
        } else if (!replace && images) {
            images.forEach(img => product.variantImages.push(img));
        }

        await product.save();
        return res.status(200).json({ message: 'Variants imported.', product });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.convertFromLegacy = async (req, res) => {
    try {
        const product = await Product.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        if (product.useVariants) return res.status(400).json({ error: 'Product already uses variants.' });
        if (!product.configurations?.length) return res.status(400).json({ error: 'No configurations to convert.' });

        const dims = product.configurations.map(c => ({
            name: c.name,
            values: c.options.map(o => o.value)
        }));

        const combos = dims.reduce((acc, d) =>
            acc.flatMap(a => d.values.map(v => ({ ...a, [d.name]: v }))),
            [{}]
        );

        const isRuleActive = (rule, attrs) => {
            const conds = rule.conditions || (rule.configName ? [{ configName: rule.configName, selectedValue: rule.selectedValue }] : []);
            return conds.length > 0 && conds.every(c => attrs[c.configName] === c.selectedValue);
        };

        const valid = combos.filter(attrs => {
            for (const cfg of product.configurations) {
                const activeRules = (product.configAvailabilityRules || []).filter(r =>
                    r.targetConfigName === cfg.name && isRuleActive(r, attrs)
                );
                if (activeRules.length === 0) continue;
                const allowed = new Set(activeRules.flatMap(r => r.availableValues || []));
                if (!allowed.has(attrs[cfg.name])) return false;
            }
            return true;
        });

        const variants = valid.map(attrs => {
            const trackedStocks = product.configurations
                .map(cfg => {
                    const opt = cfg.options.find(o => o.value === attrs[cfg.name]);
                    return opt && opt.stocks >= 0 ? opt.stocks : null;
                })
                .filter(s => s !== null);
            return {
                attributes: attrs,
                stock: trackedStocks.length ? Math.min(...trackedStocks) : -1,
                price: null,
                available: true,
                sku: ''
            };
        });

        product.variantDimensions = dims;
        product.variants = variants;
        product.variantImages = (product.images || []).map(img => ({
            url: img.url, publicId: img.publicId || '', appliesTo: {}
        }));
        product.useVariants = true;
        await product.save();

        return res.status(200).json({ message: `Converted. ${variants.length} variants created.`, product });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.uploadVariantImage = async (req, res) => {
    try {
        if (!req.uploadedImages?.length) return res.status(400).json({ error: 'No image uploaded.' });
        const product = await Product.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        const appliesTo = req.body.appliesTo ? JSON.parse(req.body.appliesTo) : {};
        req.uploadedImages.forEach(img => {
            product.variantImages.push({ url: img.url, publicId: img.publicId || '', appliesTo });
        });
        await product.save();
        return res.status(200).json({ message: 'Variant image added.', product });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.deleteVariantImage = async (req, res) => {
    try {
        const { productId, imageId } = req.params;
        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        const idx = product.variantImages.findIndex(img => img._id.toString() === imageId);
        if (idx === -1) return res.status(404).json({ error: 'Variant image not found.' });
        const imgUrl = product.variantImages[idx].url;
        const publicId = product.variantImages[idx].publicId;
        if (publicId && imgUrl.includes('cloudinary.com')) {
            try { await cloudinary.uploader.destroy(publicId); } catch (e) { console.error('Cloudinary delete error:', e); }
        }
        product.variantImages.splice(idx, 1);
        await product.save();
        return res.status(200).json({ message: 'Variant image deleted.', product });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.archiveProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        if (!product.isActive) return res.status(200).json({ message: 'Product is already archived.' });
        product.isActive = false; await product.save();
        return res.status(200).json({ message: 'Product archived successfully.' });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.activateProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        if (product.isActive) return res.status(200).json({ message: 'Product is already active.' });
        product.isActive = true; await product.save();
        return res.status(200).json({ message: 'Product activated successfully.' });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.searchByName = async (req, res) => {
    try {
        const { productName } = req.body;
        if (!productName || typeof productName !== 'string') return res.status(400).json({ error: 'productName is required.' });
        const escaped = productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return res.status(200).json(await Product.find({ name: { $regex: escaped, $options: 'i' }, isActive: true }));
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.searchByPrice = async (req, res) => {
    try {
        const { minPrice, maxPrice } = req.body;
        if (minPrice == null || maxPrice == null) return res.status(400).json({ error: 'minPrice and maxPrice are required.' });
        return res.status(200).json(await Product.find({ price: { $gte: minPrice, $lte: maxPrice }, isActive: true }));
    } catch (error) { errorHandler(error, req, res); }
};