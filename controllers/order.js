const Cart = require('../models/Cart.js');
const Order = require('../models/Order.js');
const Product = require('../models/Product.js');
const GroupBuy = require('../models/GroupBuy.js');
const GroupBuyOrder = require('../models/GroupBuyOrder.js');
const { errorHandler } = require('../auth.js');

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

        const cart = await Cart.findOne({ userId }).populate('cartItems.productId', 'name price stocks isActive options configurations');

        if (!cart || cart.cartItems.length === 0) {
            return res.status(400).json({ error: 'Your cart is empty. Add items before checking out.' });
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
                subtotal
            });
        }

        const order = new Order({ userId, productsOrdered, totalPrice });
        const savedOrder = await order.save();

        // Decrement stock for each product/option/config
        for (const item of cart.cartItems) {
            const product = item.productId;
            const fullProduct = await Product.findById(product._id);
            let needsSave = false;

            if (item.selectedOption?.groupId) {
                // Decrement option-level stock
                const group = fullProduct.options?.id(item.selectedOption.groupId);
                const val = group?.values?.id(item.selectedOption.valueId);
                if (val && val.stocks >= 0) {
                    val.stocks = Math.max(0, val.stocks - item.quantity);
                    if (val.stocks === 0) val.available = false;
                    needsSave = true;
                }
            } else {
                // Decrement product-level stock
                fullProduct.stocks = Math.max(0, (fullProduct.stocks || 0) - item.quantity);
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


// ─── Update Order Status (Admin) ─────────────────────────────────────────────
module.exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const order = await Order.findByIdAndUpdate(
            req.params.orderId,
            { status },
            { new: true }
        );

        if (!order) return res.status(404).json({ error: 'Order not found.' });

        return res.status(200).json({ message: 'Order status updated.', order });
    } catch (error) {
        errorHandler(error, req, res);
    }
};
