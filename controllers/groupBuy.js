const GroupBuy = require('../models/GroupBuy.js');
const GroupBuyOrder = require('../models/GroupBuyOrder.js');
const User = require('../models/User.js');
const { errorHandler } = require('../auth.js');
const cloudinary = require('cloudinary').v2;

const VALID_STATUSES = ['interest-check', 'open', 'closing-soon', 'closed', 'production', 'completed'];

const generateOrderCode = async () => {
    const d = new Date();
    const prefix = `GB-${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const latest = await GroupBuyOrder.findOne({ orderCode: { $regex: `^${prefix}` } })
        .sort({ orderCode: -1 }).select('orderCode');
    let next = 1;
    if (latest?.orderCode) {
        const lastNum = parseInt(latest.orderCode.split('-').pop(), 10);
        if (!isNaN(lastNum)) next = lastNum + 1;
    }
    return `${prefix}-${String(next).padStart(4, '0')}`;
};

module.exports.createGroupBuy = async (req, res) => {
    try {
        const { name, description, basePrice, options, configurations, kits, moq, maxOrders, startDate, endDate, category, status, availabilityRules } = req.body;
        if (!name || basePrice == null) return res.status(400).json({ error: 'name and basePrice are required.' });
        let images = [];
        if (req.uploadedImages && req.uploadedImages.length > 0) images = req.uploadedImages;
        const gb = new GroupBuy({
            name, description, basePrice, images,
            options: options || [], configurations: configurations || [], kits: kits || [],
            moq: moq || 0, maxOrders: maxOrders || 0,
            startDate: startDate || null, endDate: endDate || null,
            category: category || 'keyboards', status: status || 'interest-check',
            availabilityRules: availabilityRules || []
        });
        const saved = await gb.save();
        return res.status(201).json(saved);
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.updateGroupBuy = async (req, res) => {
    try {
        const allowedFields = ['name', 'description', 'basePrice', 'options', 'configurations', 'kits', 'moq', 'maxOrders', 'startDate', 'endDate', 'category', 'availabilityRules'];
        const updateData = {};
        for (const field of allowedFields) { if (req.body[field] !== undefined) updateData[field] = req.body[field]; }
        const updated = await GroupBuy.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
        if (!updated) return res.status(404).json({ error: 'Group buy not found.' });
        return res.status(200).json({ message: 'Updated.', groupBuy: updated });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.updateGroupBuyStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
        const gb = await GroupBuy.findByIdAndUpdate(req.params.id, { status }, { new: true });
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        return res.status(200).json({ message: 'Status updated.', groupBuy: gb });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.archiveGroupBuy = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        gb.isActive = false; await gb.save();
        return res.status(200).json({ message: 'Group buy archived.' });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.activateGroupBuy = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        gb.isActive = true; await gb.save();
        return res.status(200).json({ message: 'Group buy activated.' });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.deleteGroupBuy = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        const orderCount = await GroupBuyOrder.countDocuments({ groupBuyId: req.params.id });
        if (orderCount > 0) return res.status(400).json({ error: `Cannot delete — ${orderCount} order(s) exist.` });
        await GroupBuy.findByIdAndDelete(req.params.id);
        return res.status(200).json({ message: 'Group buy deleted.' });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.uploadImages = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        if (!req.uploadedImages || req.uploadedImages.length === 0) return res.status(400).json({ error: 'No images uploaded.' });
        gb.images.push(...req.uploadedImages);
        await gb.save();
        return res.status(200).json({ message: 'Images added.', images: gb.images });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.deleteImage = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        const imgIdx = gb.images.findIndex(img => img._id.toString() === req.params.imageId);
        if (imgIdx === -1) return res.status(404).json({ error: 'Image not found.' });
        const imgUrl = gb.images[imgIdx].url;
        if (imgUrl.includes('cloudinary.com')) {
            try {
                const parts = imgUrl.split('/'); const uploadIdx = parts.indexOf('upload');
                if (uploadIdx !== -1) { const publicId = parts.slice(uploadIdx + 2).join('/').replace(/\.[^/.]+$/, ''); await cloudinary.uploader.destroy(publicId); }
            } catch (e) { console.error('Cloudinary delete error:', e); }
        }
        gb.images.splice(imgIdx, 1); await gb.save();
        return res.status(200).json({ message: 'Image deleted.', images: gb.images });
    } catch (error) { errorHandler(error, req, res); }
};

// ─── PATCH /group-buys/:id/images/reorder ────────────────────────────────────
module.exports.reorderImages = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        const { imageIds } = req.body;
        if (!Array.isArray(imageIds)) return res.status(400).json({ error: 'imageIds must be an array.' });
        const sorted = imageIds.map(id => gb.images.find(img => img._id.toString() === id)).filter(Boolean);
        const includedIds = new Set(imageIds);
        gb.images.forEach(img => { if (!includedIds.has(img._id.toString())) sorted.push(img); });
        gb.images = sorted;
        await gb.save();
        return res.status(200).json({ message: 'Images reordered.', images: gb.images });
    } catch (error) { errorHandler(error, req, res); }
};

// ─── POST /group-buys/:id/images/add-url ─────────────────────────────────────
module.exports.addImageByUrl = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        const { url, altText } = req.body;
        if (!url || !url.trim()) return res.status(400).json({ error: 'url is required.' });
        gb.images.push({ url: url.trim(), altText: altText?.trim() || '' });
        await gb.save();
        return res.status(200).json({ message: 'Image added.', images: gb.images });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.getAllGroupBuys = async (req, res) => {
    try { return res.status(200).json(await GroupBuy.find({}).sort({ createdAt: -1 })); }
    catch (error) { errorHandler(error, req, res); }
};

module.exports.getActiveGroupBuys = async (req, res) => {
    try {
        return res.status(200).json(await GroupBuy.find({ isActive: true }).select('name description basePrice options images status category orderCount endDate moq maxOrders isActive').sort({ createdAt: -1 }));
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.getGroupBuy = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id).select('-interestChecks');
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        return res.status(200).json(gb);
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.registerInterest = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        if (gb.status !== 'interest-check') return res.status(400).json({ error: 'Not in interest check phase.' });
        if (gb.interestChecks.some(ic => ic.userId.toString() === req.user.id)) return res.status(409).json({ error: 'Already registered.' });
        const user = await User.findById(req.user.id).select('firstName lastName email');
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const { configurations, kits, note, selectedOption } = req.body;
        gb.interestChecks.push({
            userId: req.user.id, email: user.email, name: `${user.firstName} ${user.lastName}`,
            configurations: configurations || [], selectedOption: selectedOption || undefined,
            kits: kits || [], note: note || ''
        });
        await gb.save();
        return res.status(201).json({ message: 'Interest registered!' });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.getInterestChecks = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id).select('name interestChecks');
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        return res.status(200).json({ name: gb.name, interestChecks: gb.interestChecks });
    } catch (error) { errorHandler(error, req, res); }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  PLACE ORDER — supports both kit-based and config-based GBs
//  Kit-based: body.kits = [{ kitId, quantity }]  → total = sum of kit prices
//  Config-based: body.configurations = [{ name, selected }] → total = basePrice + modifiers
// ═══════════════════════════════════════════════════════════════════════════════

module.exports.placeOrder = async (req, res) => {
    try {
        const { configurations, kits: kitSelections, quantity, notes,
                optionGroupId, optionValueId } = req.body;
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        if (gb.status !== 'open' && gb.status !== 'closing-soon')
            return res.status(400).json({ error: 'Not accepting orders.' });
        if (gb.maxOrders > 0 && gb.orderCount >= gb.maxOrders)
            return res.status(400).json({ error: 'Maximum orders reached.' });

        let totalPrice = 0;
        let orderKits = [];
        let selectedOption = null;

        if (gb.kits?.length > 0 && kitSelections?.length > 0) {
            // Kit-based GB: calculate from selected kits
            for (const sel of kitSelections) {
                const kitDef = gb.kits.id(sel.kitId);
                if (!kitDef || !kitDef.available) continue;
                const qty = sel.quantity || 1;
                totalPrice += kitDef.price * qty;
                orderKits.push({
                    kitId: kitDef._id, name: kitDef.name,
                    price: kitDef.price, quantity: qty
                });
            }
            if (orderKits.length === 0) {
                return res.status(400).json({
                    error: 'Please select at least one kit.'
                });
            }
        } else if (optionGroupId && optionValueId && gb.options?.length > 0) {
            // Option-based GB: use the selected option's price
            const optGroup = gb.options.id(optionGroupId);
            if (!optGroup) return res.status(400).json({
                error: 'Invalid option group.'
            });
            const optVal = optGroup.values.id(optionValueId);
            if (!optVal) return res.status(400).json({
                error: 'Invalid option value.'
            });
            if (!optVal.available) return res.status(400).json({
                error: 'Selected option is not available.'
            });
            if (optVal.stocks >= 0 && optVal.stocks < (quantity || 1)) {
                return res.status(400).json({
                    error: `Only ${optVal.stocks} "${optVal.value}" available.`
                });
            }

            selectedOption = {
                groupName: optGroup.name,
                value: optVal.value,
                price: optVal.price
            };
            totalPrice = optVal.price * (quantity || 1);

            // Add config modifiers
            if (configurations?.length > 0) {
                for (const chosen of configurations) {
                    const cfgDef = gb.configurations.find(
                        c => c.name === chosen.name
                    );
                    if (!cfgDef) continue;
                    const opt = cfgDef.options?.find(
                        o => o.value === chosen.selected
                    );
                    if (opt?.priceModifier > 0)
                        totalPrice += opt.priceModifier * (quantity || 1);
                }
            }
        } else {
            // No options, no kits: basePrice + config modifiers
            totalPrice = gb.basePrice * (quantity || 1);
            if (configurations?.length > 0) {
                for (const chosen of configurations) {
                    const cfgDef = gb.configurations.find(
                        c => c.name === chosen.name
                    );
                    if (!cfgDef) continue;
                    const opt = cfgDef.options?.find(
                        o => o.value === chosen.selected
                    );
                    if (opt?.priceModifier > 0)
                        totalPrice += opt.priceModifier * (quantity || 1);
                }
            }
        }

        const orderCode = await generateOrderCode();
        const user = await User.findById(req.user.id)
            .select('firstName lastName mobileNo');
        const order = new GroupBuyOrder({
            orderCode, groupBuyId: gb._id, userId: req.user.id,
            selectedOption: selectedOption || undefined,
            configurations: configurations || [], kits: orderKits,
            quantity: quantity || 1, totalPrice,
            shippingAddress: {
                fullName: user ? `${user.firstName} ${user.lastName}` : '',
                phone: user?.mobileNo || ''
            },
            notes: notes || ''
        });
        await order.save();
        gb.orderCount += 1;

        // Decrement option value stock if tracked
        if (optionGroupId && optionValueId) {
            const optGroup = gb.options.id(optionGroupId);
            const optVal = optGroup?.values?.id(optionValueId);
            if (optVal && optVal.stocks >= 0) {
                optVal.stocks -= (quantity || 1);
                if (optVal.stocks <= 0) {
                    optVal.stocks = 0;
                    optVal.available = false;
                }
            }
        }

        await gb.save();
        return res.status(201).json({ message: 'Order placed!', order });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.getMyOrders = async (req, res) => {
    try {
        const orders = await GroupBuyOrder
            .find({ userId: req.user.id })
            .populate('groupBuyId', 'name status images basePrice category')
            .sort({ createdAt: -1 });
        return res.status(200).json({ orders });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.getGroupBuyOrders = async (req, res) => {
    try {
        const orders = await GroupBuyOrder.find({ groupBuyId: req.params.id }).populate('userId', 'firstName lastName email mobileNo').sort({ createdAt: -1 });
        return res.status(200).json({ orders });
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const valid = ['Confirmed', 'In Production', 'Shipped', 'Delivered', 'Cancelled'];
        if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
        const order = await GroupBuyOrder.findById(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Order not found.' });

        // Restock when transitioning INTO Cancelled (one-shot; skip if already Cancelled)
        if (status === 'Cancelled' && order.status !== 'Cancelled') {
            const gb = await GroupBuy.findById(order.groupBuyId);
            if (gb) {
                if (order.selectedOption?.value && gb.options?.length > 0) {
                    for (const grp of gb.options) {
                        if (grp.name !== order.selectedOption.groupName) continue;
                        const val = grp.values.find(v => v.value === order.selectedOption.value);
                        if (val && val.stocks >= 0) {
                            val.stocks += (order.quantity || 1);
                            val.available = true;
                        }
                    }
                }
                gb.orderCount = Math.max(0, (gb.orderCount || 1) - 1);
                await gb.save();
            }
        }

        order.status = status;
        await order.save();
        return res.status(200).json({ message: 'Updated.', order });
    } catch (error) { errorHandler(error, req, res); }
};

// CSV: includes both configs and kits
module.exports.exportOrdersCSV = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        const orders = await GroupBuyOrder.find({ groupBuyId: req.params.id }).populate('userId', 'firstName lastName email mobileNo').sort({ createdAt: 1 });
        const configNames = gb.configurations.map(c => c.name);
        const kitNames = gb.kits.map(k => k.name);
        const headers = ['Order Code', 'Date', 'Customer Name', 'Email', 'Phone', 'Selected Option', ...configNames, ...(kitNames.length > 0 ? kitNames.map(k => `Kit: ${k}`) : []), 'Quantity', 'Total Price', 'Status', 'Notes'];
        const esc = (v) => { const s = String(v ?? ''); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
        const rows = orders.map(o => {
            const u = o.userId;
            const selectedOptionVal = o.selectedOption?.value
                ? `${o.selectedOption.groupName}: ${o.selectedOption.value}`
                : '';
            const configValues = configNames.map(cn => o.configurations?.find(c => c.name === cn)?.selected || '');
            const kitValues = kitNames.map(kn => {
                const k = o.kits?.find(ok => ok.name === kn);
                return k ? `${k.quantity}x (₱${k.price})` : '';
            });
            return [o.orderCode, new Date(o.createdAt).toLocaleDateString(),
                typeof u === 'object' ? `${u.firstName} ${u.lastName}` : 'Unknown',
                typeof u === 'object' ? u.email : '', typeof u === 'object' ? u.mobileNo : '',
                selectedOptionVal, ...configValues, ...kitValues, o.quantity, o.totalPrice, o.status, o.notes || ''];
        });
        const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${gb.name.replace(/[^a-zA-Z0-9]/g, '_')}_orders.csv"`);
        return res.status(200).send(csv);
    } catch (error) { errorHandler(error, req, res); }
};

module.exports.exportInterestCSV = async (req, res) => {
    try {
        const gb = await GroupBuy.findById(req.params.id);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        const configNames = gb.configurations.map(c => c.name);
        const headers = ['Name', 'Email', 'Date', ...configNames, 'Kits Interested', 'Note'];
        const esc = (v) => { const s = String(v ?? ''); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
        const rows = (gb.interestChecks || []).map(ic => [
            ic.name, ic.email, new Date(ic.registeredAt).toLocaleDateString(),
            ...configNames.map(cn => ic.configurations?.find(c => c.name === cn)?.selected || ''),
            (ic.kits || []).join(', '), ic.note || ''
        ]);
        const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${gb.name.replace(/[^a-zA-Z0-9]/g, '_')}_interest.csv"`);
        return res.status(200).send(csv);
    } catch (error) { errorHandler(error, req, res); }
};