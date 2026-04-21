const https = require('https');
const crypto = require('crypto');
const Cart = require('../models/Cart.js');
const Order = require('../models/Order.js');
const Product = require('../models/Product.js');
const GroupBuy = require('../models/GroupBuy.js');
const GroupBuyOrder = require('../models/GroupBuyOrder.js');
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
module.exports.createOrder = async (req, res) => {
    try {
        const userId = req.user.id;

        const cart = await Cart.findOne({ userId }).populate('cartItems.productId', 'name price stocks isActive options configurations useVariants variants configAvailabilityRules');

        if (!cart || cart.cartItems.length === 0) {
            return res.status(400).json({ error: 'Your cart is empty. Add items before checking out.' });
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

            // ── Variant-based item ──
            if (product.useVariants && item.variantId) {
                const variant = product.variants?.id(item.variantId);
                if (!variant) return res.status(400).json({ error: `A variant in your cart no longer exists for "${product.name}".` });
                if (variant.available === false) return res.status(400).json({ error: `A selected variant is no longer available for "${product.name}".` });
                if (variant.stock >= 0 && variant.stock < item.quantity) {
                    return res.status(400).json({ error: `Only ${variant.stock} in stock for your selected variant of "${product.name}".` });
                }
                const unitPrice = variant.price != null ? variant.price : product.price;
                const subtotal = unitPrice * item.quantity;
                totalPrice += subtotal;
                const attrs = variant.attributes instanceof Map ? Object.fromEntries(variant.attributes) : (variant.attributes || {});
                const attrStr = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(', ');
                productsOrdered.push({
                    productId: product._id,
                    productName: product.name + (attrStr ? ` (${attrStr})` : ''),
                    quantity: item.quantity,
                    subtotal,
                    variantId: item.variantId,
                    variantAttributes: attrs
                });
                continue;
            }

            let unitPrice = product.price;
            let optionLabel = '';

            // Option-based item
            if (item.selectedOption?.groupId) {
                const group = product.options?.id(item.selectedOption.groupId);
                const val = group?.values?.id(item.selectedOption.valueId);
                if (!val) {
                    return res.status(400).json({ error: `Option "${item.selectedOption.value}" no longer exists for "${product.name}".` });
                }
                if (val.stocks >= 0 && val.stocks < item.quantity) {
                    return res.status(400).json({ error: `"${product.name} — ${val.value}" only has ${val.stocks} in stock (you requested ${item.quantity}).` });
                }
                unitPrice = val.price;
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
                productName: product.name + optionLabel + (configStr ? ` (${configStr})` : ''),
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

        const order = new Order({ userId, productsOrdered, totalPrice });
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
        const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });

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
        const cart = await Cart.findOne({ userId }).populate('cartItems.productId', 'name price stocks isActive options configurations useVariants variants configAvailabilityRules');

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

            // Variant-based item
            if (product.useVariants && item.variantId) {
                const variant = product.variants?.id(item.variantId);
                if (!variant) return res.status(400).json({ error: `A variant in your cart no longer exists for "${product.name}".` });
                if (variant.available === false) return res.status(400).json({ error: `A selected variant is no longer available for "${product.name}".` });
                if (variant.stock >= 0 && variant.stock < item.quantity) {
                    return res.status(400).json({ error: `Only ${variant.stock} in stock for your selected variant of "${product.name}".` });
                }
                const vUnit = variant.price != null ? variant.price : product.price;
                const vSubtotal = vUnit * item.quantity;
                totalPrice += vSubtotal;
                const attrs = variant.attributes instanceof Map ? Object.fromEntries(variant.attributes) : (variant.attributes || {});
                const attrStr = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(', ');
                productsOrdered.push({
                    productId: product._id,
                    productName: product.name + (attrStr ? ` (${attrStr})` : ''),
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
                unitPrice = val.price;
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
                productName: product.name + optionLabel + (configStr ? ` (${configStr})` : ''),
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

        // Create order in awaiting_payment state (stock not decremented yet)
        const order = new Order({ userId, productsOrdered, totalPrice, paymentStatus: 'awaiting_payment' });
        await order.save();

        // Build PayMongo line items (amounts in centavos)
        const lineItems = productsOrdered.map(p => ({
            currency: 'PHP',
            amount: Math.round(p.subtotal * 100),
            name: p.productName,
            quantity: p.quantity
        }));

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
            await Order.findByIdAndDelete(order._id);
            return res.status(500).json({ error: 'Failed to create payment session. Please try again.' });
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

        // Restore stock when transitioning into Cancelled
        if (status === 'Cancelled' && !wasCancelled) {
            for (const item of order.productsOrdered) {
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
        }

        return res.status(200).json({ message: 'Order status updated.', order });
    } catch (error) {
        errorHandler(error, req, res);
    }
};
