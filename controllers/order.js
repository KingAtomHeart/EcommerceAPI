const https = require('https');
const crypto = require('crypto');
const Cart = require('../models/Cart.js');
const Order = require('../models/Order.js');
const Product = require('../models/Product.js');
const GroupBuy = require('../models/GroupBuy.js');
const GroupBuyOrder = require('../models/GroupBuyOrder.js');
const OrderAddToken = require('../models/OrderAddToken.js');
const { errorHandler } = require('../auth.js');

const paymongoRequest = (method, path, body) => new Promise((resolve, reject) => {
    const encoded = Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64');
    const payload = body ? JSON.stringify(body) : null;
    const options = {
        hostname: 'api.paymongo.com',
        path: `/v1${path}`,
        method,
        headers: {
            'Authorization': `Basic ${encoded}`,
            'Content-Type': 'application/json',
            ...(payload && { 'Content-Length': Buffer.byteLength(payload) })
        }
    };
    const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
            catch { reject(new Error('Invalid PayMongo response')); }
        });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
});

const decrementStocksForCart = async (cart, Product) => {
    for (const item of cart.cartItems) {
        const product = item.productId;
        const fullProduct = await Product.findById(product._id || product);
        if (!fullProduct) continue;
        let needsSave = false;
        if (fullProduct.useVariants && item.variantId) {
            const variant = fullProduct.variants?.id(item.variantId);
            if (variant && variant.stock >= 0) {
                variant.stock = Math.max(0, variant.stock - item.quantity);
                if (variant.stock === 0) variant.available = false;
                await fullProduct.save();
            }
            continue;
        }
        if (item.selectedOption?.groupId) {
            const group = fullProduct.options?.id(item.selectedOption.groupId);
            const val = group?.values?.id(item.selectedOption.valueId);
            if (val && val.stocks >= 0) {
                val.stocks = Math.max(0, val.stocks - item.quantity);
                if (val.stocks === 0) val.available = false;
                needsSave = true;
            }
        } else if (fullProduct.stocks !== undefined && fullProduct.stocks !== -1) {
            fullProduct.stocks = Math.max(0, fullProduct.stocks - item.quantity);
            needsSave = true;
        }
        if (item.configurations?.length > 0) {
            for (const chosen of item.configurations) {
                const cfgDef = fullProduct.configurations?.find(c => c.name === chosen.name);
                const cfgOpt = cfgDef?.options?.find(o => o.value === chosen.selected);
                if (cfgOpt && cfgOpt.stocks >= 0) {
                    cfgOpt.stocks = Math.max(0, cfgOpt.stocks - item.quantity);
                    if (cfgOpt.stocks === 0) cfgOpt.available = false;
                    needsSave = true;
                }
            }
        }
        if (needsSave) await fullProduct.save();
    }
};

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


// ─── Checkout (Create Order) ─────────────────────────────────────────────────
// Handles both regular and group buy carts via the same endpoint.
module.exports.createOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const { addToOrderToken } = req.body || {};

        // Resolve add-to-order token if present
        let addLink = null;
        if (addToOrderToken) {
            addLink = await OrderAddToken.findOne({ token: addToOrderToken });
            if (!addLink) return res.status(400).json({ error: 'Invalid add-to-order link.' });
            if (addLink.usedAt) return res.status(400).json({ error: 'This add-to-order link has already been used.' });
            if (addLink.expiresAt < new Date()) return res.status(400).json({ error: 'This add-to-order link has expired.' });
            if (addLink.targetUserId.toString() !== userId) return res.status(403).json({ error: 'This link is not for your account.' });
        }

        const cart = await Cart.findOne({ userId }).populate({
            path: 'cartItems.productId',
            select: 'name price stocks isActive options configurations useVariants variants configAvailabilityRules parentProductId images',
            populate: { path: 'parentProductId', select: 'name images' }
        });

        if (!cart || cart.cartItems.length === 0) {
            return res.status(400).json({ error: 'Your cart is empty. Add items before checking out.' });
        }

        // ─── Group Buy cart branch ────────────────────────────────────────────
        if (cart.cartItems.some(i => i.groupBuyId)) {
            // If add-link is for in-stock, reject GB cart
            if (addLink && addLink.targetType !== 'gb-cart') {
                return res.status(400).json({ error: 'This add-to-order link is for an in-stock order. Group buy items cannot be added to it.' });
            }

            const orders = [];
            // If add-link mode: reuse existing cartOrderCode/cartCheckoutId + shipping
            // Else: generate new ones from request body shipping
            let cartCheckoutId, cartOrderCode, shippingForOrders;
            if (addLink) {
                cartCheckoutId = addLink.targetCartCheckoutId;
                cartOrderCode = addLink.targetCartOrderCode;
                shippingForOrders = addLink.shippingAddress || {};
            } else {
                const { shippingAddress } = req.body || {};
                if (!shippingAddress?.fullName || !shippingAddress?.phone || !shippingAddress?.street || !shippingAddress?.city || !shippingAddress?.province) {
                    return res.status(400).json({ error: 'Please provide a complete shipping address.' });
                }
                cartCheckoutId = new (require('mongoose')).Types.ObjectId().toString();
                cartOrderCode = await generateOrderCode();
                shippingForOrders = {
                    fullName: shippingAddress.fullName, phone: shippingAddress.phone,
                    street: shippingAddress.street, city: shippingAddress.city,
                    province: shippingAddress.province,
                    zipCode: shippingAddress.postalCode || shippingAddress.zipCode || ''
                };
            }

            for (const item of cart.cartItems) {
                const gb = await GroupBuy.findById(item.groupBuyId);
                if (!gb) continue;
                if (gb.status !== 'open' && gb.status !== 'closing-soon') continue;

                const orderCode = await generateOrderCode();
                const order = new GroupBuyOrder({
                    orderCode,
                    cartOrderCode,
                    cartCheckoutId,
                    addedAfterPurchase: !!addLink,
                    groupBuyId: gb._id,
                    userId,
                    selectedOption: item.selectedOption?.groupName ? {
                        groupName: item.selectedOption.groupName,
                        value: item.selectedOption.value,
                        price: item.quantity > 0 ? item.subtotal / item.quantity : 0
                    } : undefined,
                    configurations: item.configurations || [],
                    quantity: item.quantity,
                    totalPrice: item.subtotal,
                    shippingAddress: shippingForOrders,
                    notes: ''
                });
                await order.save();

                if (item.selectedOption?.valueId) {
                    const optGroup = gb.options?.find(g =>
                        g.values?.some(v => v._id.toString() === item.selectedOption.valueId.toString())
                    );
                    if (optGroup) {
                        const optVal = optGroup.values.id(item.selectedOption.valueId);
                        if (optVal && optVal.stocks >= 0) {
                            optVal.stocks -= item.quantity;
                            if (optVal.stocks <= 0) { optVal.stocks = 0; optVal.available = false; }
                        }
                    }
                }
                gb.orderCount += 1;
                await gb.save();
                orders.push(order);
            }

            if (orders.length === 0) {
                return res.status(400).json({ error: 'No valid group buy items could be checked out.' });
            }
            if (addLink) { addLink.usedAt = new Date(); await addLink.save(); }
            await Cart.deleteOne({ userId });
            return res.status(201).json({
                message: addLink ? `${orders.length} item(s) added to your existing order!` : `${orders.length} group buy order(s) placed!`,
                orders, addedToExisting: !!addLink
            });
        }

        // Tally total cart quantities per product/config-option across ALL cart items
        // so shared option values (e.g. two items both using Grade=B-Stock) are
        // validated together, not per-item.
        const configTotals = new Map(); // key: `${productId}::${configName}::${configValue}` -> qty
        for (const item of cart.cartItems) {
            for (const c of (item.configurations || [])) {
                const key = `${item.productId?._id || item.productId}::${c.name}::${c.selected}`;
                configTotals.set(key, (configTotals.get(key) || 0) + item.quantity);
            }
        }

        // Validate config option stocks against cart totals + availability rules
        for (const item of cart.cartItems) {
            const product = item.productId;
            if (!product) continue;
            const configMap = Object.fromEntries((item.configurations || []).map(c => [c.name, c.selected]));
            for (const c of (item.configurations || [])) {
                const cfgDef = product.configurations?.find(cf => cf.name === c.name);
                const opt = cfgDef?.options?.find(o => o.value === c.selected);
                if (!opt) continue;
                if (opt.available === false) {
                    return res.status(400).json({ error: `"${opt.value}" for ${c.name} is no longer available.` });
                }
                if (opt.stocks >= 0) {
                    const key = `${product._id}::${c.name}::${c.selected}`;
                    const requested = configTotals.get(key) || 0;
                    if (opt.stocks < requested) {
                        return res.status(400).json({ error: `Only ${opt.stocks} "${opt.value}" (${c.name}) in stock. You have ${requested} across your cart items.` });
                    }
                }
                // Availability rules (multi-condition AND) — reject invalid combos
                if (product.configAvailabilityRules?.length > 0) {
                    for (const rule of product.configAvailabilityRules) {
                        if (rule.targetConfigName !== c.name) continue;
                        const conds = rule.conditions || (rule.configName ? [{ configName: rule.configName, selectedValue: rule.selectedValue }] : []);
                        const active = conds.length > 0 && conds.every(cond => configMap[cond.configName] === cond.selectedValue);
                        if (active && !rule.availableValues.includes(c.selected)) {
                            return res.status(400).json({ error: `"${c.selected}" for ${c.name} is not a valid combination with the selected configuration.` });
                        }
                    }
                }
            }
        }

        // Recalculate prices from current product data + validate stock
        const productsOrdered = [];
        let totalPrice = 0;

        for (const item of cart.cartItems) {
            const product = item.productId;

            if (!product) {
                return res.status(400).json({ error: `A product in your cart no longer exists.` });
            }
            if (!product.isActive) {
                return res.status(400).json({ error: `"${product.name}" is no longer available.` });
            }

            // For add-ons, surface the parent product as the order line so the
            // customer sees the parent in their order history.
            const displayName = product.parentProductId?.name || product.name;
            const displayImage = product.parentProductId?.images?.[0]?.url || product.images?.[0]?.url || '';

            // ── Variant-based item ──
            if (product.useVariants && item.variantId) {
                const variant = product.variants?.id(item.variantId);
                if (!variant) return res.status(400).json({ error: `A variant in your cart no longer exists for "${product.name}".` });
                if (variant.available === false) return res.status(400).json({ error: `A selected variant is no longer available for "${product.name}".` });
                if (variant.stock >= 0 && variant.stock < item.quantity) {
                    return res.status(400).json({ error: `Only ${variant.stock} in stock for your selected variant of "${product.name}".` });
                }
                const unitPrice = (product.price || 0) + (variant.price || 0);
                const subtotal = unitPrice * item.quantity;
                totalPrice += subtotal;
                const attrs = variant.attributes instanceof Map ? Object.fromEntries(variant.attributes) : (variant.attributes || {});
                const attrStr = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(', ');
                productsOrdered.push({
                    productId: product._id,
                    productName: displayName + (attrStr ? ` (${attrStr})` : ''),
                    productImage: displayImage,
                    quantity: item.quantity,
                    subtotal,
                    variantId: item.variantId,
                    variantAttributes: attrs
                });
                continue;
            }

            let unitPrice = product.price;
            let optionLabel = '';

            // Option-based item — option price adds on top of product.price
            if (item.selectedOption?.groupId) {
                const group = product.options?.id(item.selectedOption.groupId);
                const val = group?.values?.id(item.selectedOption.valueId);
                if (!val) {
                    return res.status(400).json({ error: `Option "${item.selectedOption.value}" no longer exists for "${product.name}".` });
                }
                if (val.stocks >= 0 && val.stocks < item.quantity) {
                    return res.status(400).json({ error: `"${product.name} — ${val.value}" only has ${val.stocks} in stock (you requested ${item.quantity}).` });
                }
                unitPrice = (product.price || 0) + (val.price || 0);
                optionLabel = ` — ${item.selectedOption.groupName}: ${item.selectedOption.value}`;
            } else if (product.stocks !== undefined && product.stocks !== -1 && product.stocks < item.quantity) {
                return res.status(400).json({ error: `"${product.name}" only has ${product.stocks} in stock (you requested ${item.quantity}).` });
            }

            // Add config price modifiers
            if (item.configurations?.length > 0) {
                for (const chosen of item.configurations) {
                    const cfgDef = product.configurations?.find(c => c.name === chosen.name);
                    const opt = cfgDef?.options?.find(o => o.value === chosen.selected);
                    if (opt?.priceModifier > 0) unitPrice += opt.priceModifier;
                }
            }

            const subtotal = unitPrice * item.quantity;
            totalPrice += subtotal;

            const configStr = (item.configurations || []).map(c => `${c.name}: ${c.selected}`).join(', ');
            productsOrdered.push({
                productId: product._id,
                productName: displayName + optionLabel + (configStr ? ` (${configStr})` : ''),
                productImage: displayImage,
                quantity: item.quantity,
                subtotal,
                selectedOption: item.selectedOption?.groupId ? {
                    groupId: item.selectedOption.groupId,
                    groupName: item.selectedOption.groupName,
                    valueId: item.selectedOption.valueId,
                    value: item.selectedOption.value
                } : undefined,
                configurations: item.configurations || []
            });
        }

        // ── Add-link branch: append cart items to an existing in-stock order ──
        if (addLink) {
            if (addLink.targetType !== 'order') {
                return res.status(400).json({ error: 'This add-to-order link is for a group buy. In-stock items cannot be added to it.' });
            }
            const target = await Order.findById(addLink.targetOrderId);
            if (!target) return res.status(404).json({ error: 'Target order not found.' });
            if (target.userId.toString() !== userId) return res.status(403).json({ error: 'You cannot add to this order.' });

            for (const p of productsOrdered) {
                target.productsOrdered.push({ ...p, status: 'Pending', addedAfterPurchase: true });
            }
            // Decrement stock (same as below)
            await decrementStocksForCart(cart, Product);

            // Recalculate totalPrice from active items + existing shipping
            const activeSubtotal = target.productsOrdered.filter(p => p.status !== 'Cancelled').reduce((s, p) => s + (p.subtotal || 0), 0);
            target.totalPrice = activeSubtotal + (target.shippingFee || 0);
            await target.save();

            addLink.usedAt = new Date(); await addLink.save();
            await Cart.deleteOne({ userId });
            return res.status(201).json({ message: `${productsOrdered.length} item(s) added to your existing order!`, order: target, addedToExisting: true });
        }

        // Shipping (design-phase: no PayMongo, just record on order)
        const { computeShippingFromProvince } = require('../utils/shipping.js');
        const { shippingAddress, billingAddress } = req.body || {};
        let shippingFee = 0, shippingRegion = null;
        if (shippingAddress?.province) {
            if (!shippingAddress.fullName || !shippingAddress.phone || !shippingAddress.street || !shippingAddress.city) {
                return res.status(400).json({ error: 'Please provide a complete shipping address.' });
            }
            const shipResult = computeShippingFromProvince(shippingAddress.province);
            if (!shipResult.ok) return res.status(400).json({ error: shipResult.error });
            shippingFee = shipResult.fee;
            shippingRegion = shipResult.regionCode;
        }
        const grandTotal = totalPrice + shippingFee;

        const order = new Order({
            userId,
            productsOrdered,
            totalPrice: grandTotal,
            shippingFee,
            shippingRegion,
            shippingAddress: shippingAddress || undefined,
            billingAddress: (billingAddress && billingAddress.fullName) ? billingAddress : (shippingAddress || undefined),
        });
        const savedOrder = await order.save();

        // Decrement stock for each product/option/config
        for (const item of cart.cartItems) {
            const product = item.productId;
            const fullProduct = await Product.findById(product._id);
            let needsSave = false;

            // Variant-based decrement
            if (fullProduct.useVariants && item.variantId) {
                const variant = fullProduct.variants?.id(item.variantId);
                if (variant && variant.stock >= 0) {
                    variant.stock = Math.max(0, variant.stock - item.quantity);
                    if (variant.stock === 0) variant.available = false;
                    await fullProduct.save();
                }
                continue;
            }

            if (item.selectedOption?.groupId) {
                // Decrement option-level stock
                const group = fullProduct.options?.id(item.selectedOption.groupId);
                const val = group?.values?.id(item.selectedOption.valueId);
                if (val && val.stocks >= 0) {
                    val.stocks = Math.max(0, val.stocks - item.quantity);
                    if (val.stocks === 0) val.available = false;
                    needsSave = true;
                }
            } else if (fullProduct.stocks !== undefined && fullProduct.stocks !== -1) {
                fullProduct.stocks = Math.max(0, fullProduct.stocks - item.quantity);
                needsSave = true;
            }

            // Decrement config option stocks
            if (item.configurations?.length > 0) {
                for (const chosen of item.configurations) {
                    const cfgDef = fullProduct.configurations?.find(c => c.name === chosen.name);
                    const cfgOpt = cfgDef?.options?.find(o => o.value === chosen.selected);
                    if (cfgOpt && cfgOpt.stocks >= 0) {
                        cfgOpt.stocks = Math.max(0, cfgOpt.stocks - item.quantity);
                        if (cfgOpt.stocks === 0) cfgOpt.available = false;
                        needsSave = true;
                    }
                }
            }

            if (needsSave) await fullProduct.save();
        }

        // Clear the cart after successful order
        await Cart.deleteOne({ userId });

        return res.status(201).json({ message: 'Order placed successfully.', order: savedOrder });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── Get My Orders (User) ────────────────────────────────────────────────────
module.exports.retrieveUserOrders = async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.user.id })
            .populate('productsOrdered.productId', 'images')
            .sort({ createdAt: -1 });

        if (orders.length === 0) {
            return res.status(200).json({ message: 'You have no orders yet.', orders: [] });
        }

        return res.status(200).json({ orders });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── Get All Orders (Admin) ──────────────────────────────────────────────────
module.exports.retrieveAllOrders = async (req, res) => {
    try {
        const orders = await Order.find({})
            .populate('userId', 'firstName lastName email')
            .populate('productsOrdered.productId', 'images')
            .sort({ createdAt: -1 });

        return res.status(200).json({ orders });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── POST /orders/checkout-group-buy ─────────────────────────────────────────
module.exports.checkoutGroupBuy = async (req, res) => {
    try {
        const userId = req.user.id;
        const cart = await Cart.findOne({ userId });

        if (!cart || cart.cartItems.length === 0) {
            return res.status(400).json({ error: 'Your cart is empty.' });
        }
        if (cart.cartType !== 'groupbuy') {
            return res.status(400).json({ error: 'This checkout is for group buy items only. Use regular checkout.' });
        }

        const User = require('../models/User.js');
        const user = await User.findById(userId).select('firstName lastName mobileNo');
        const orders = [];

        for (const item of cart.cartItems) {
            const gb = await GroupBuy.findById(item.groupBuyId);
            if (!gb) continue;
            if (gb.status !== 'open' && gb.status !== 'closing-soon') continue;

            const orderCode = await generateOrderCode();
            const order = new GroupBuyOrder({
                orderCode,
                groupBuyId: gb._id,
                userId,
                selectedOption: item.selectedOption?.groupName ? {
                    groupName: item.selectedOption.groupName,
                    value: item.selectedOption.value,
                    price: item.subtotal / item.quantity
                } : undefined,
                configurations: item.configurations || [],
                quantity: item.quantity,
                totalPrice: item.subtotal,
                shippingAddress: {
                    fullName: user ? `${user.firstName} ${user.lastName}` : '',
                    phone: user?.mobileNo || ''
                },
                notes: ''
            });
            await order.save();

            // Decrement option stock
            if (item.selectedOption?.valueId) {
                const optGroup = gb.options?.find(g =>
                    g.values?.some(v => v._id.toString() === item.selectedOption.valueId.toString())
                );
                if (optGroup) {
                    const optVal = optGroup.values.id(item.selectedOption.valueId);
                    if (optVal && optVal.stocks >= 0) {
                        optVal.stocks -= item.quantity;
                        if (optVal.stocks <= 0) {
                            optVal.stocks = 0;
                            optVal.available = false;
                        }
                    }
                }
            }

            gb.orderCount += 1;
            await gb.save();
            orders.push(order);
        }

        if (orders.length === 0) {
            return res.status(400).json({ error: 'No valid group buy items could be checked out.' });
        }

        await Cart.deleteOne({ userId });

        return res.status(201).json({
            message: `${orders.length} group buy order(s) placed!`,
            orders
        });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── Create PayMongo Payment Session ─────────────────────────────────────────
module.exports.createPaymentSession = async (req, res) => {
    try {
        const userId = req.user.id;
        const cart = await Cart.findOne({ userId }).populate({
            path: 'cartItems.productId',
            select: 'name price stocks isActive options configurations useVariants variants configAvailabilityRules parentProductId images',
            populate: { path: 'parentProductId', select: 'name images' }
        });

        if (!cart || cart.cartItems.length === 0) {
            return res.status(400).json({ error: 'Your cart is empty.' });
        }

        // Run same cart validation as createOrder
        const configTotals = new Map();
        for (const item of cart.cartItems) {
            for (const c of (item.configurations || [])) {
                const key = `${item.productId?._id || item.productId}::${c.name}::${c.selected}`;
                configTotals.set(key, (configTotals.get(key) || 0) + item.quantity);
            }
        }

        for (const item of cart.cartItems) {
            const product = item.productId;
            if (!product) continue;
            const configMap = Object.fromEntries((item.configurations || []).map(c => [c.name, c.selected]));
            for (const c of (item.configurations || [])) {
                const cfgDef = product.configurations?.find(cf => cf.name === c.name);
                const opt = cfgDef?.options?.find(o => o.value === c.selected);
                if (!opt) continue;
                if (opt.available === false) return res.status(400).json({ error: `"${opt.value}" for ${c.name} is no longer available.` });
                if (opt.stocks >= 0) {
                    const key = `${product._id}::${c.name}::${c.selected}`;
                    const requested = configTotals.get(key) || 0;
                    if (opt.stocks < requested) return res.status(400).json({ error: `Only ${opt.stocks} "${opt.value}" (${c.name}) in stock.` });
                }
                if (product.configAvailabilityRules?.length > 0) {
                    for (const rule of product.configAvailabilityRules) {
                        if (rule.targetConfigName !== c.name) continue;
                        const conds = rule.conditions || (rule.configName ? [{ configName: rule.configName, selectedValue: rule.selectedValue }] : []);
                        const active = conds.length > 0 && conds.every(cond => configMap[cond.configName] === cond.selectedValue);
                        if (active && !rule.availableValues.includes(c.selected)) {
                            return res.status(400).json({ error: `"${c.selected}" for ${c.name} is not valid with the selected configuration.` });
                        }
                    }
                }
            }
        }

        const productsOrdered = [];
        let totalPrice = 0;

        for (const item of cart.cartItems) {
            const product = item.productId;
            if (!product) return res.status(400).json({ error: 'A product in your cart no longer exists.' });
            if (!product.isActive) return res.status(400).json({ error: `"${product.name}" is no longer available.` });

            const displayName = product.parentProductId?.name || product.name;
            const displayImage = product.parentProductId?.images?.[0]?.url || product.images?.[0]?.url || '';

            // Variant-based item
            if (product.useVariants && item.variantId) {
                const variant = product.variants?.id(item.variantId);
                if (!variant) return res.status(400).json({ error: `A variant in your cart no longer exists for "${product.name}".` });
                if (variant.available === false) return res.status(400).json({ error: `A selected variant is no longer available for "${product.name}".` });
                if (variant.stock >= 0 && variant.stock < item.quantity) {
                    return res.status(400).json({ error: `Only ${variant.stock} in stock for your selected variant of "${product.name}".` });
                }
                const vUnit = (product.price || 0) + (variant.price || 0);
                const vSubtotal = vUnit * item.quantity;
                totalPrice += vSubtotal;
                const attrs = variant.attributes instanceof Map ? Object.fromEntries(variant.attributes) : (variant.attributes || {});
                const attrStr = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(', ');
                productsOrdered.push({
                    productId: product._id,
                    productName: displayName + (attrStr ? ` (${attrStr})` : ''),
                    productImage: displayImage,
                    quantity: item.quantity,
                    subtotal: vSubtotal,
                    variantId: item.variantId,
                    variantAttributes: attrs
                });
                continue;
            }

            let unitPrice = product.price;
            let optionLabel = '';

            if (item.selectedOption?.groupId) {
                const group = product.options?.id(item.selectedOption.groupId);
                const val = group?.values?.id(item.selectedOption.valueId);
                if (!val) return res.status(400).json({ error: `Option no longer exists for "${product.name}".` });
                if (val.stocks >= 0 && val.stocks < item.quantity) return res.status(400).json({ error: `"${product.name} — ${val.value}" only has ${val.stocks} in stock.` });
                unitPrice = (product.price || 0) + (val.price || 0);
                optionLabel = ` — ${item.selectedOption.groupName}: ${item.selectedOption.value}`;
            } else if (product.stocks !== undefined && product.stocks !== -1 && product.stocks < item.quantity) {
                return res.status(400).json({ error: `"${product.name}" only has ${product.stocks} in stock.` });
            }

            if (item.configurations?.length > 0) {
                for (const chosen of item.configurations) {
                    const cfgDef = product.configurations?.find(c => c.name === chosen.name);
                    const opt = cfgDef?.options?.find(o => o.value === chosen.selected);
                    if (opt?.priceModifier > 0) unitPrice += opt.priceModifier;
                }
            }

            const subtotal = unitPrice * item.quantity;
            totalPrice += subtotal;
            const configStr = (item.configurations || []).map(c => `${c.name}: ${c.selected}`).join(', ');
            productsOrdered.push({
                productId: product._id,
                productName: displayName + optionLabel + (configStr ? ` (${configStr})` : ''),
                productImage: displayImage,
                quantity: item.quantity,
                subtotal,
                selectedOption: item.selectedOption?.groupId ? {
                    groupId: item.selectedOption.groupId,
                    groupName: item.selectedOption.groupName,
                    valueId: item.selectedOption.valueId,
                    value: item.selectedOption.value
                } : undefined,
                configurations: item.configurations || []
            });
        }

        // Derive region + rate from the customer's province. Client can't choose the zone.
        const { computeShippingFromProvince } = require('../utils/shipping.js');
        const { shippingAddress, billingAddress } = req.body || {};
        if (!shippingAddress?.fullName || !shippingAddress?.phone || !shippingAddress?.street || !shippingAddress?.city || !shippingAddress?.province) {
            return res.status(400).json({ error: 'Please provide a complete shipping address.' });
        }
        const shipResult = computeShippingFromProvince(shippingAddress.province);
        if (!shipResult.ok) return res.status(400).json({ error: shipResult.error });
        const shippingFee = shipResult.fee;
        const grandTotal = totalPrice + shippingFee;

        // Create order in awaiting_payment state (stock not decremented yet)
        const order = new Order({
            userId,
            productsOrdered,
            totalPrice: grandTotal,
            shippingFee,
            shippingRegion: shipResult.regionCode,
            shippingAddress,
            billingAddress: (billingAddress && billingAddress.fullName) ? billingAddress : shippingAddress,
            paymentStatus: 'awaiting_payment'
        });
        await order.save();

        // Build PayMongo line items (amounts in centavos)
        const lineItems = productsOrdered.map(p => ({
            currency: 'PHP',
            amount: Math.round(p.subtotal * 100),
            name: p.productName,
            quantity: p.quantity
        }));
        lineItems.push({
            currency: 'PHP',
            amount: Math.round(shippingFee * 100),
            name: `Shipping — ${shipResult.regionLabel}`,
            quantity: 1
        });

        const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
        const sessionRes = await paymongoRequest('POST', '/checkout_sessions', {
            data: {
                attributes: {
                    line_items: lineItems,
                    payment_method_types: ['gcash', 'paymaya', 'card', 'billease', 'dob', 'dob_ubp', 'qrph'],
                    show_line_items: true,
                    success_url: `${clientUrl}/payment-success?orderId=${order._id}`,
                    cancel_url: `${clientUrl}/cart`,
                    metadata: { orderId: order._id.toString() }
                }
            }
        });

        if (sessionRes.status !== 200 && sessionRes.status !== 201) {
            console.error('[PayMongo] status=', sessionRes.status, 'body=', JSON.stringify(sessionRes.body));
            console.error('[PayMongo] lineItems=', JSON.stringify(lineItems));
            await Order.findByIdAndDelete(order._id);
            const pmDetail = sessionRes.body?.errors?.[0]?.detail;
            return res.status(500).json({ error: pmDetail ? `PayMongo: ${pmDetail}` : 'Failed to create payment session. Please try again.' });
        }

        const sessionId = sessionRes.body.data.id;
        const checkoutUrl = sessionRes.body.data.attributes.checkout_url;

        order.paymentSessionId = sessionId;
        await order.save();

        return res.status(200).json({ checkoutUrl, orderId: order._id });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── PayMongo Webhook ─────────────────────────────────────────────────────────
module.exports.handleWebhook = async (req, res) => {
    try {
        const sigHeader = req.headers['paymongo-signature'];
        const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;

        if (webhookSecret && webhookSecret !== 'whsec_REPLACE_WITH_YOUR_WEBHOOK_SECRET' && sigHeader) {
            const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
            const timestamp = parts['t'];
            const rawBody = req.rawBody?.toString() || JSON.stringify(req.body);
            const computed = crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.${rawBody}`).digest('hex');
            const provided = parts['te'] || parts['li'];
            if (computed !== provided) {
                return res.status(400).json({ error: 'Invalid webhook signature.' });
            }
        }

        const event = req.body?.data;
        if (event?.attributes?.type !== 'checkout_session.payment.paid') {
            return res.status(200).json({ received: true });
        }

        const orderId = event.attributes.data?.attributes?.metadata?.orderId;
        if (!orderId) return res.status(200).json({ received: true });

        const order = await Order.findById(orderId);
        if (!order || order.paymentStatus !== 'awaiting_payment') {
            return res.status(200).json({ received: true });
        }

        const paymentMethod = event.attributes.data?.attributes?.payment_method_used || 'unknown';

        order.paymentStatus = 'paid';
        order.paymentMethod = paymentMethod;
        order.status = 'Processing';
        order.paidAt = new Date();
        await order.save();

        // Decrement stock now that payment is confirmed
        for (const item of order.productsOrdered) {
            const fullProduct = await Product.findById(item.productId);
            if (!fullProduct) continue;
            let needsSave = false;

            if (item.selectedOption?.groupId) {
                const group = fullProduct.options?.id(item.selectedOption.groupId);
                const val = group?.values?.id(item.selectedOption.valueId);
                if (val && val.stocks >= 0) {
                    val.stocks = Math.max(0, val.stocks - item.quantity);
                    if (val.stocks === 0) val.available = false;
                    needsSave = true;
                }
            } else if (fullProduct.stocks !== undefined && fullProduct.stocks !== -1) {
                fullProduct.stocks = Math.max(0, fullProduct.stocks - item.quantity);
                needsSave = true;
            }

            if (item.configurations?.length > 0) {
                for (const chosen of item.configurations) {
                    const cfgDef = fullProduct.configurations?.find(c => c.name === chosen.name);
                    const cfgOpt = cfgDef?.options?.find(o => o.value === chosen.selected);
                    if (cfgOpt && cfgOpt.stocks >= 0) {
                        cfgOpt.stocks = Math.max(0, cfgOpt.stocks - item.quantity);
                        if (cfgOpt.stocks === 0) cfgOpt.available = false;
                        needsSave = true;
                    }
                }
            }

            if (needsSave) await fullProduct.save();
        }

        await Cart.deleteOne({ userId: order.userId });

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Webhook processing failed.' });
    }
};


// ─── Get Payment Status ───────────────────────────────────────────────────────
module.exports.getPaymentStatus = async (req, res) => {
    try {
        const order = await Order.findOne({ _id: req.params.orderId, userId: req.user.id })
            .select('paymentStatus status totalPrice createdAt');
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        return res.status(200).json({ order });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── Update Single Item Status within an Order (Admin) ──────────────────────
// Restocks the cancelled item; recalculates order.totalPrice as active items only.
module.exports.updateOrderItemStatus = async (req, res) => {
    try {
        const { orderId, itemId } = req.params;
        const { status } = req.body;
        const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
        if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        const item = order.productsOrdered.id(itemId);
        if (!item) return res.status(404).json({ error: 'Item not found in order.' });

        const wasCancelled = item.status === 'Cancelled';
        const becomingCancelled = status === 'Cancelled' && !wasCancelled;
        const becomingActive = status !== 'Cancelled' && wasCancelled;

        item.status = status;

        // Restock on cancel
        if (becomingCancelled) {
            const fullProduct = await Product.findById(item.productId);
            if (fullProduct) {
                let needsSave = false;
                if (fullProduct.useVariants && item.variantId) {
                    const variant = fullProduct.variants?.id(item.variantId);
                    if (variant && variant.stock >= 0) {
                        variant.stock += item.quantity;
                        variant.available = true;
                        needsSave = true;
                    }
                } else if (item.selectedOption?.groupId) {
                    const group = fullProduct.options?.id(item.selectedOption.groupId);
                    const val = group?.values?.id(item.selectedOption.valueId);
                    if (val && val.stocks >= 0) { val.stocks += item.quantity; val.available = true; needsSave = true; }
                } else if (fullProduct.stocks !== undefined && fullProduct.stocks !== -1) {
                    fullProduct.stocks += item.quantity;
                    needsSave = true;
                }
                if (item.configurations?.length > 0) {
                    for (const chosen of item.configurations) {
                        const cfgDef = fullProduct.configurations?.find(c => c.name === chosen.name);
                        const cfgOpt = cfgDef?.options?.find(o => o.value === chosen.selected);
                        if (cfgOpt && cfgOpt.stocks >= 0) { cfgOpt.stocks += item.quantity; cfgOpt.available = true; needsSave = true; }
                    }
                }
                if (needsSave) await fullProduct.save();
            }
        }
        // Re-decrement on un-cancel
        if (becomingActive) {
            const fullProduct = await Product.findById(item.productId);
            if (fullProduct) {
                let needsSave = false;
                if (fullProduct.useVariants && item.variantId) {
                    const variant = fullProduct.variants?.id(item.variantId);
                    if (variant && variant.stock >= 0) {
                        if (variant.stock < item.quantity) return res.status(400).json({ error: `Cannot reactivate — only ${variant.stock} variants in stock.` });
                        variant.stock -= item.quantity;
                        if (variant.stock === 0) variant.available = false;
                        needsSave = true;
                    }
                } else if (item.selectedOption?.groupId) {
                    const group = fullProduct.options?.id(item.selectedOption.groupId);
                    const val = group?.values?.id(item.selectedOption.valueId);
                    if (val && val.stocks >= 0) {
                        if (val.stocks < item.quantity) return res.status(400).json({ error: `Cannot reactivate — only ${val.stocks} in stock.` });
                        val.stocks -= item.quantity;
                        if (val.stocks === 0) val.available = false;
                        needsSave = true;
                    }
                } else if (fullProduct.stocks !== undefined && fullProduct.stocks !== -1) {
                    if (fullProduct.stocks < item.quantity) return res.status(400).json({ error: `Cannot reactivate — only ${fullProduct.stocks} in stock.` });
                    fullProduct.stocks -= item.quantity;
                    needsSave = true;
                }
                if (needsSave) await fullProduct.save();
            }
        }

        // Recalculate order totalPrice from active items + shipping
        const activeSubtotal = order.productsOrdered
            .filter(p => p.status !== 'Cancelled')
            .reduce((s, p) => s + (p.subtotal || 0), 0);
        order.totalPrice = activeSubtotal + (order.shippingFee || 0);

        await order.save();
        return res.status(200).json({ message: 'Item status updated.', order });
    } catch (error) { errorHandler(error, req, res); }
};

// ─── Add an Item to an Existing Order (Admin) ────────────────────────────────
module.exports.addItemToOrder = async (req, res) => {
    try {
        const { productId, quantity = 1, selectedOption, configurations = [], variantId } = req.body;
        if (!productId) return res.status(400).json({ error: 'productId is required.' });

        const order = await Order.findById(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Order not found.' });

        const product = await Product.findById(productId).populate('parentProductId', 'name images');
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        if (!product.isActive) return res.status(400).json({ error: 'Product is not active.' });

        const displayName = product.parentProductId?.name || product.name;
        const displayImage = product.parentProductId?.images?.[0]?.url || product.images?.[0]?.url || '';

        let unitPrice = product.price;
        let optionLabel = '';
        let resolvedVariantId = null;
        let resolvedVariantAttrs = {};

        if (product.useVariants && variantId) {
            const variant = product.variants?.id(variantId);
            if (!variant) return res.status(400).json({ error: 'Variant not found.' });
            if (variant.available === false) return res.status(400).json({ error: 'Variant unavailable.' });
            if (variant.stock >= 0 && variant.stock < quantity) return res.status(400).json({ error: `Only ${variant.stock} in stock.` });
            unitPrice = (product.price || 0) + (variant.price || 0);
            resolvedVariantId = variantId;
            resolvedVariantAttrs = variant.attributes instanceof Map ? Object.fromEntries(variant.attributes) : (variant.attributes || {});
        } else if (selectedOption?.groupId) {
            const group = product.options?.id(selectedOption.groupId);
            const val = group?.values?.id(selectedOption.valueId);
            if (!val) return res.status(400).json({ error: 'Option not found.' });
            if (val.stocks >= 0 && val.stocks < quantity) return res.status(400).json({ error: `Only ${val.stocks} in stock.` });
            unitPrice = (product.price || 0) + (val.price || 0);
            optionLabel = ` — ${selectedOption.groupName}: ${selectedOption.value}`;
        } else if (product.stocks !== undefined && product.stocks !== -1 && product.stocks < quantity) {
            return res.status(400).json({ error: `Only ${product.stocks} in stock.` });
        }

        for (const c of configurations) {
            const cfgDef = product.configurations?.find(d => d.name === c.name);
            const opt = cfgDef?.options?.find(o => o.value === c.selected);
            if (opt?.priceModifier > 0) unitPrice += opt.priceModifier;
        }

        const subtotal = unitPrice * quantity;
        const attrStr = Object.entries(resolvedVariantAttrs).map(([k, v]) => `${k}: ${v}`).join(', ');
        const configStr = configurations.map(c => `${c.name}: ${c.selected}`).join(', ');
        const productName = displayName + optionLabel + (attrStr ? ` (${attrStr})` : configStr ? ` (${configStr})` : '');

        order.productsOrdered.push({
            productId: product._id,
            productName,
            productImage: displayImage,
            quantity, subtotal,
            selectedOption: selectedOption?.groupId ? selectedOption : undefined,
            configurations,
            variantId: resolvedVariantId,
            variantAttributes: resolvedVariantAttrs,
            status: 'Pending'
        });

        // Decrement stock
        const fullProduct = await Product.findById(productId);
        if (fullProduct) {
            let needsSave = false;
            if (fullProduct.useVariants && resolvedVariantId) {
                const v = fullProduct.variants?.id(resolvedVariantId);
                if (v && v.stock >= 0) { v.stock = Math.max(0, v.stock - quantity); if (v.stock === 0) v.available = false; needsSave = true; }
            } else if (selectedOption?.groupId) {
                const g = fullProduct.options?.id(selectedOption.groupId);
                const val = g?.values?.id(selectedOption.valueId);
                if (val && val.stocks >= 0) { val.stocks = Math.max(0, val.stocks - quantity); if (val.stocks === 0) val.available = false; needsSave = true; }
            } else if (fullProduct.stocks !== undefined && fullProduct.stocks !== -1) {
                fullProduct.stocks = Math.max(0, fullProduct.stocks - quantity);
                needsSave = true;
            }
            for (const c of configurations) {
                const cfgDef = fullProduct.configurations?.find(d => d.name === c.name);
                const cfgOpt = cfgDef?.options?.find(o => o.value === c.selected);
                if (cfgOpt && cfgOpt.stocks >= 0) { cfgOpt.stocks = Math.max(0, cfgOpt.stocks - quantity); if (cfgOpt.stocks === 0) cfgOpt.available = false; needsSave = true; }
            }
            if (needsSave) await fullProduct.save();
        }

        // Recalculate totalPrice from active items
        const activeSubtotal = order.productsOrdered
            .filter(p => p.status !== 'Cancelled')
            .reduce((s, p) => s + (p.subtotal || 0), 0);
        order.totalPrice = activeSubtotal + (order.shippingFee || 0);

        await order.save();
        return res.status(200).json({ message: 'Item added to order.', order });
    } catch (error) { errorHandler(error, req, res); }
};

// ─── Generate Add-to-Order Link (Admin) ──────────────────────────────────────
// Generates a single-use token that lets the customer add items to their
// existing order. Items added via this link skip shipping fees and get the
// addedAfterPurchase flag.
module.exports.generateAddOrderLink = async (req, res) => {
    try {
        const { type, orderId, cartOrderCode, cartCheckoutId, expiresInHours = 168 } = req.body || {};
        if (!['order', 'gb-cart'].includes(type)) return res.status(400).json({ error: 'type must be "order" or "gb-cart".' });

        let token = require('crypto').randomBytes(20).toString('hex');
        const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000);

        const tokenDoc = new OrderAddToken({
            token, targetType: type, expiresAt, createdBy: req.user.id
        });

        if (type === 'order') {
            const order = await Order.findById(orderId);
            if (!order) return res.status(404).json({ error: 'Order not found.' });
            tokenDoc.targetOrderId = order._id;
            tokenDoc.targetUserId = order.userId;
            tokenDoc.shippingAddress = order.shippingAddress;
        } else {
            // gb-cart: identify by cartOrderCode (or cartCheckoutId)
            const filter = {};
            if (cartOrderCode) filter.cartOrderCode = cartOrderCode;
            else if (cartCheckoutId) filter.cartCheckoutId = cartCheckoutId;
            else return res.status(400).json({ error: 'cartOrderCode or cartCheckoutId required for gb-cart type.' });

            const sample = await GroupBuyOrder.findOne(filter);
            if (!sample) return res.status(404).json({ error: 'Group buy cart not found.' });
            tokenDoc.targetCartOrderCode = sample.cartOrderCode;
            tokenDoc.targetCartCheckoutId = sample.cartCheckoutId;
            tokenDoc.targetUserId = sample.userId;
            tokenDoc.shippingAddress = sample.shippingAddress;
        }

        await tokenDoc.save();
        const base = process.env.CLIENT_URL || '';
        return res.status(201).json({ token, url: `${base}/add-to-order/${token}`, expiresAt });
    } catch (error) { errorHandler(error, req, res); }
};

// ─── Validate Add-Order Token (Customer) ─────────────────────────────────────
// Returns target order info so the frontend can show a banner.
module.exports.validateAddOrderToken = async (req, res) => {
    try {
        const tokenDoc = await OrderAddToken.findOne({ token: req.params.token });
        if (!tokenDoc) return res.status(404).json({ error: 'Invalid link.' });
        if (tokenDoc.usedAt) return res.status(410).json({ error: 'This link has already been used.' });
        if (tokenDoc.expiresAt < new Date()) return res.status(410).json({ error: 'This link has expired.' });
        if (tokenDoc.targetUserId.toString() !== req.user.id) return res.status(403).json({ error: 'This link is not for your account.' });

        const info = {
            type: tokenDoc.targetType,
            expiresAt: tokenDoc.expiresAt,
        };
        if (tokenDoc.targetType === 'order' && tokenDoc.targetOrderId) {
            const order = await Order.findById(tokenDoc.targetOrderId).select('_id totalPrice productsOrdered');
            info.targetLabel = `Order ${tokenDoc.targetOrderId.toString().slice(-8).toUpperCase()}`;
            info.itemCount = order?.productsOrdered?.length || 0;
        } else {
            info.targetLabel = `Order ${tokenDoc.targetCartOrderCode}`;
            const items = await GroupBuyOrder.find({ cartOrderCode: tokenDoc.targetCartOrderCode }).select('_id');
            info.itemCount = items.length;
        }
        return res.status(200).json(info);
    } catch (error) { errorHandler(error, req, res); }
};


// ─── Search orders by ID/order code (Admin) ──────────────────────────────────
// Returns matches across regular orders and group buy orders.
module.exports.searchOrders = async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) return res.status(200).json({ orders: [], gbOrders: [] });

        const isObjectId = /^[a-f0-9]{24}$/i.test(q);
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');

        const orderQuery = isObjectId
            ? { _id: q }
            : { _id: { $exists: true } }; // we'll filter by _id substring client-fallback

        // Regular orders: match by _id (exact) or last-8 substring
        const orderFilter = isObjectId
            ? { _id: q }
            : { $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: escaped, options: 'i' } } };
        const orders = await Order.find(orderFilter)
            .populate('userId', 'firstName lastName email')
            .populate('productsOrdered.productId', 'images')
            .sort({ createdAt: -1 })
            .limit(20);

        // GB orders: match by orderCode or cartOrderCode
        const gbOrders = await GroupBuyOrder.find({
            $or: [{ orderCode: regex }, { cartOrderCode: regex }]
        })
            .populate('userId', 'firstName lastName email mobileNo')
            .populate('groupBuyId', 'name parentGroupBuyId images')
            .sort({ createdAt: -1 })
            .limit(20);

        return res.status(200).json({ orders, gbOrders });
    } catch (error) { errorHandler(error, req, res); }
};


// ─── Update Order Status (Admin) ─────────────────────────────────────────────
module.exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const existing = await Order.findById(req.params.orderId);
        if (!existing) return res.status(404).json({ error: 'Order not found.' });

        const wasCancelled = existing.status === 'Cancelled';
        existing.status = status;
        const order = await existing.save();

        // Mark all non-cancelled items as cancelled too, restock each
        if (status === 'Cancelled' && !wasCancelled) {
            for (const item of order.productsOrdered) {
                if (item.status === 'Cancelled') continue; // already restocked
                item.status = 'Cancelled';
                const fullProduct = await Product.findById(item.productId);
                if (!fullProduct) continue;
                let needsSave = false;

                // Variant-based restore
                if (fullProduct.useVariants && item.variantId) {
                    const variant = fullProduct.variants?.id(item.variantId);
                    if (variant && variant.stock >= 0) {
                        variant.stock += item.quantity;
                        variant.available = true;
                        await fullProduct.save();
                    }
                    continue;
                }

                if (item.selectedOption?.groupId) {
                    const group = fullProduct.options?.id(item.selectedOption.groupId);
                    const val = group?.values?.id(item.selectedOption.valueId);
                    if (val && val.stocks >= 0) {
                        val.stocks += item.quantity;
                        val.available = true;
                        needsSave = true;
                    }
                } else if (fullProduct.stocks !== undefined && fullProduct.stocks !== -1) {
                    fullProduct.stocks += item.quantity;
                    needsSave = true;
                }

                if (item.configurations?.length > 0) {
                    for (const chosen of item.configurations) {
                        const cfgDef = fullProduct.configurations?.find(c => c.name === chosen.name);
                        const cfgOpt = cfgDef?.options?.find(o => o.value === chosen.selected);
                        if (cfgOpt && cfgOpt.stocks >= 0) {
                            cfgOpt.stocks += item.quantity;
                            cfgOpt.available = true;
                            needsSave = true;
                        }
                    }
                }

                if (needsSave) await fullProduct.save();
            }
            // Persist item.status changes; recalculate total from active items
            const activeSubtotal = order.productsOrdered
                .filter(p => p.status !== 'Cancelled')
                .reduce((s, p) => s + (p.subtotal || 0), 0);
            order.totalPrice = activeSubtotal > 0 ? activeSubtotal + (order.shippingFee || 0) : 0;
            await order.save();
        }

        return res.status(200).json({ message: 'Order status updated.', order });
    } catch (error) {
        errorHandler(error, req, res);
    }
};
