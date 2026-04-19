const Cart = require('../models/Cart.js');
const Product = require('../models/Product.js');
const GroupBuy = require('../models/GroupBuy.js');
const { errorHandler } = require('../auth.js');

const recalcTotal = (cartItems) =>
    cartItems.reduce((sum, item) => sum + item.subtotal, 0);

// Resolve unit price from a product + cart request body.
// Priority: option group selection > legacy kit > base price + config modifiers.
function resolveUnitPrice(product, { optionGroupId, optionValueId, kitId, configurations }) {
    // ── Option-based (new system) ──
    if (optionGroupId && optionValueId) {
        const group = product.options?.id(optionGroupId);
        const val = group?.values?.id(optionValueId);
        if (!val) return null; // signals "not found"
        let price = val.price;
        if (configurations?.length > 0) {
            for (const chosen of configurations) {
                const cfgDef = product.configurations?.find(c => c.name === chosen.name);
                const opt = cfgDef?.options?.find(o => o.value === chosen.selected);
                if (opt?.priceModifier > 0) price += opt.priceModifier;
            }
        }
        return price;
    }

    // ── Legacy kit-based ──
    if (kitId) {
        const kit = product.kits?.id(kitId);
        if (!kit) return null;
        return kit.price;
    }

    // ── Base product + config modifiers ──
    let price = product.price;
    if (configurations?.length > 0) {
        for (const chosen of configurations) {
            const cfgDef = product.configurations?.find(c => c.name === chosen.name);
            const opt = cfgDef?.options?.find(o => o.value === chosen.selected);
            if (opt?.priceModifier > 0) price += opt.priceModifier;
        }
    }
    return price;
}


// ─── GET /cart/get-cart ───────────────────────────────────────────────────────
module.exports.retrieveUserCart = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user.id })
            .populate('cartItems.productId', 'name price images isActive stocks options kits')
            .populate('cartItems.groupBuyId', 'name images status basePrice options');

        if (!cart || cart.cartItems.length === 0) {
            return res.status(200).json({ message: 'Cart is empty', cart: { cartItems: [], totalPrice: 0 } });
        }

        return res.status(200).json({ cart });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── POST /cart/add-to-cart ───────────────────────────────────────────────────
// Accepts: { productId, quantity, optionGroupId?, optionValueId?, kitId?, configurations? }
// Option-based: optionGroupId + optionValueId sets the base price from product.options
// Legacy kit: kitId sets price from product.kits
// Base product: product.price + config modifiers
module.exports.addToCart = async (req, res) => {
    try {
        const { productId, quantity, optionGroupId, optionValueId, kitId, configurations } = req.body;

        if (!productId || !quantity || quantity < 1) {
            return res.status(400).json({ error: 'productId and a valid quantity are required.' });
        }

        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        if (!product.isActive) return res.status(400).json({ error: 'Product is no longer available.' });

        // Block if cart currently has group buy items
        const existingCart = await Cart.findOne({ userId: req.user.id });
        if (existingCart && existingCart.cartItems.length > 0 && existingCart.cartType === 'groupbuy') {
            return res.status(400).json({
                error: 'Your cart contains group buy items. Please clear your cart or checkout first before adding regular items.'
            });
        }

        // ── Option-based purchase (new system) ──
        if (optionGroupId && optionValueId) {
            const group = product.options?.id(optionGroupId);
            if (!group) return res.status(404).json({ error: 'Option group not found.' });
            const optVal = group.values?.id(optionValueId);
            if (!optVal) return res.status(404).json({ error: 'Option not found.' });
            if (!optVal.available) return res.status(400).json({ error: `"${optVal.value}" is not available.` });
            // Check option-level stock (-1 = unlimited)
            if (optVal.stocks >= 0 && optVal.stocks < quantity) {
                return res.status(400).json({ error: `Only ${optVal.stocks} "${optVal.value}" in stock.` });
            }

            // Validate config availability rules and stock
            if (configurations?.length > 0) {
                for (const chosen of configurations) {
                    // Check availability rules (multi-condition AND semantics)
                    if (product.configAvailabilityRules?.length > 0) {
                        const configMap = Object.fromEntries(configurations.map(c => [c.name, c.selected]));
                        for (const rule of product.configAvailabilityRules) {
                            if (rule.targetConfigName !== chosen.name) continue;
                            const conds = rule.conditions || (rule.configName ? [{ configName: rule.configName, selectedValue: rule.selectedValue }] : []);
                            const active = conds.length > 0 && conds.every(c => configMap[c.configName] === c.selectedValue);
                            if (active && !rule.availableValues.includes(chosen.selected)) {
                                return res.status(400).json({ error: `"${chosen.selected}" for ${chosen.name} is not available with the selected configuration.` });
                            }
                        }
                    }
                    // Check config option stock
                    const cfgDef = product.configurations?.find(c => c.name === chosen.name);
                    const cfgOpt = cfgDef?.options?.find(o => o.value === chosen.selected);
                    if (cfgOpt) {
                        if (!cfgOpt.available) return res.status(400).json({ error: `"${cfgOpt.value}" for ${chosen.name} is not available.` });
                        if (cfgOpt.stocks >= 0 && cfgOpt.stocks < quantity) {
                            return res.status(400).json({ error: `Only ${cfgOpt.stocks} "${cfgOpt.value}" (${chosen.name}) in stock.` });
                        }
                    }
                }
            }

            const unitPrice = resolveUnitPrice(product, { optionGroupId, optionValueId, configurations });
            const subtotal = unitPrice * quantity;
            const selectedOption = {
                groupId: group._id, groupName: group.name,
                valueId: optVal._id, value: optVal.value
            };

            let cart = await Cart.findOne({ userId: req.user.id });
            if (!cart) {
                cart = new Cart({
                    userId: req.user.id,
                    cartItems: [{ productId, selectedOption, configurations: configurations || [], quantity, subtotal }],
                    totalPrice: subtotal
                });
            } else {
                const existing = cart.cartItems.find(i =>
                    i.productId.toString() === productId &&
                    i.selectedOption?.valueId?.toString() === optionValueId
                );
                if (existing) {
                    const newQty = existing.quantity + quantity;
                    if (optVal.stocks >= 0 && optVal.stocks < newQty) {
                        return res.status(400).json({ error: `Only ${optVal.stocks} "${optVal.value}" in stock. You already have ${existing.quantity} in cart.` });
                    }
                    existing.quantity = newQty;
                    existing.subtotal = unitPrice * newQty;
                } else {
                    cart.cartItems.push({ productId, selectedOption, configurations: configurations || [], quantity, subtotal });
                }
                cart.totalPrice = recalcTotal(cart.cartItems);
            }
            await cart.save();
            return res.status(200).json({ message: 'Added to cart.', cart });
        }

        // ── Legacy kit-based purchase ──
        let unitPrice = product.price;
        let kitName = '';
        let kitIdVal = null;

        if (kitId) {
            const kit = product.kits?.id(kitId);
            if (!kit) return res.status(404).json({ error: 'Kit not found.' });
            if (!kit.available) return res.status(400).json({ error: `"${kit.name}" is not available.` });
            if (kit.stocks >= 0 && kit.stocks < quantity) {
                return res.status(400).json({ error: `Only ${kit.stocks} "${kit.name}" in stock.` });
            }
            unitPrice = kit.price;
            kitName = kit.name;
            kitIdVal = kit._id;
        } else {
            // ── Base product + configs ──
            if (product.stocks !== undefined && product.stocks !== -1 && product.stocks < quantity) {
                return res.status(400).json({ error: `Only ${product.stocks} item(s) in stock.` });
            }
            if (configurations?.length > 0) {
                for (const chosen of configurations) {
                    const cfgDef = product.configurations?.find(c => c.name === chosen.name);
                    const opt = cfgDef?.options?.find(o => o.value === chosen.selected);
                    if (opt) {
                        if (!opt.available) return res.status(400).json({ error: `"${opt.value}" for ${chosen.name} is not available.` });
                        if (opt.stocks >= 0 && opt.stocks < quantity) {
                            return res.status(400).json({ error: `Only ${opt.stocks} "${opt.value}" (${chosen.name}) in stock.` });
                        }
                    }
                    // Check availability rules (multi-condition AND semantics)
                    if (product.configAvailabilityRules?.length > 0) {
                        const configMap = Object.fromEntries(configurations.map(c => [c.name, c.selected]));
                        for (const rule of product.configAvailabilityRules) {
                            if (rule.targetConfigName !== chosen.name) continue;
                            const conds = rule.conditions || (rule.configName ? [{ configName: rule.configName, selectedValue: rule.selectedValue }] : []);
                            const active = conds.length > 0 && conds.every(c => configMap[c.configName] === c.selectedValue);
                            if (active && !rule.availableValues.includes(chosen.selected)) {
                                return res.status(400).json({ error: `"${chosen.selected}" for ${chosen.name} is not available with the selected configuration.` });
                            }
                        }
                    }
                    if (opt?.priceModifier > 0) unitPrice += opt.priceModifier;
                }
            }
            // Product has options defined — force selection
            if (product.options?.length > 0) {
                return res.status(400).json({ error: 'This product has options. Please select an option before adding to cart.' });
            }
            // Legacy: product has kits but no kitId
            if (product.kits?.length > 0) {
                return res.status(400).json({ error: 'This product has kits. Please select a specific kit to add.' });
            }
        }

        const subtotal = unitPrice * quantity;
        let cart = await Cart.findOne({ userId: req.user.id });

        if (!cart) {
            cart = new Cart({
                userId: req.user.id,
                cartItems: [{ productId, kitId: kitIdVal, kitName, configurations: configurations || [], quantity, subtotal }],
                totalPrice: subtotal
            });
        } else {
            const existingItem = cart.cartItems.find(item =>
                item.productId.toString() === productId &&
                (item.kitId?.toString() || null) === (kitIdVal?.toString() || null)
            );
            if (existingItem) {
                const newQty = existingItem.quantity + quantity;
                if (kitIdVal) {
                    const kit = product.kits?.id(kitIdVal);
                    if (kit?.stocks >= 0 && kit.stocks < newQty) {
                        return res.status(400).json({ error: `Only ${kit.stocks} "${kit.name}" in stock. You already have ${existingItem.quantity} in cart.` });
                    }
                } else {
                    if (product.stocks !== undefined && product.stocks !== -1 && product.stocks < newQty) {
                        return res.status(400).json({ error: `Only ${product.stocks} item(s) in stock. You already have ${existingItem.quantity} in cart.` });
                    }
                }
                existingItem.quantity = newQty;
                existingItem.subtotal = unitPrice * newQty;
            } else {
                cart.cartItems.push({ productId, kitId: kitIdVal, kitName, configurations: configurations || [], quantity, subtotal });
            }
            cart.totalPrice = recalcTotal(cart.cartItems);
        }

        await cart.save();
        return res.status(200).json({ message: 'Added to cart.', cart });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── PATCH /cart/update-cart-quantity ────────────────────────────────────────
module.exports.updateCartQuantity = async (req, res) => {
    try {
        const { productId, kitId, optionValueId } = req.body;
        const quantity = req.body.quantity || req.body.newQuantity;

        if (!productId || quantity == null || quantity < 1) {
            return res.status(400).json({ error: 'productId and a valid quantity (>=1) are required.' });
        }

        // If this is a group buy cart, validate against group buy stock
        const cartCheck = await Cart.findOne({ userId: req.user.id });
        if (cartCheck?.cartType === 'groupbuy') {
            const item = cartCheck.cartItems.find(i =>
                i.productId.toString() === productId
            );
            if (item?.groupBuyId) {
                const gb = await GroupBuy.findById(item.groupBuyId);
                if (gb && item.selectedOption?.valueId) {
                    for (const grp of (gb.options || [])) {
                        const val = grp.values?.find(v =>
                            v._id.toString() === item.selectedOption.valueId.toString()
                        );
                        if (val && val.stocks >= 0 && val.stocks < quantity) {
                            return res.status(400).json({
                                error: `Only ${val.stocks} "${val.value}" available.`
                            });
                        }
                    }
                }
                // Update subtotal for group buy item and return early
                const unitPrice = item.quantity > 0 ? item.subtotal / item.quantity : 0;
                item.quantity = quantity;
                item.subtotal = unitPrice * quantity;
                cartCheck.totalPrice = recalcTotal(cartCheck.cartItems);
                await cartCheck.save();
                return res.status(200).json({ message: 'Cart updated.', cart: cartCheck });
            }
        }

        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        if (!product.isActive) return res.status(400).json({ error: `"${product.name}" is no longer available.` });

        const cart = await Cart.findOne({ userId: req.user.id });
        if (!cart) return res.status(404).json({ error: 'Cart not found.' });

        // Find matching item (option, kit, or base)
        let item;
        if (optionValueId) {
            item = cart.cartItems.find(i =>
                i.productId.toString() === productId &&
                i.selectedOption?.valueId?.toString() === optionValueId
            );
        } else {
            item = cart.cartItems.find(i =>
                i.productId.toString() === productId &&
                (i.kitId?.toString() || null) === (kitId || null)
            );
        }
        if (!item) return res.status(404).json({ error: 'Item not in cart.' });

        // Stock validation: option-level > kit-level > product-level
        if (item.selectedOption?.groupId) {
            const group = product.options?.id(item.selectedOption.groupId);
            const val = group?.values?.id(item.selectedOption.valueId);
            if (val && val.stocks >= 0 && val.stocks < quantity) {
                return res.status(400).json({ error: `Only ${val.stocks} "${val.value}" in stock.` });
            }
        } else if (kitId) {
            const kit = product.kits?.id(kitId);
            if (kit?.stocks >= 0 && kit.stocks < quantity) {
                return res.status(400).json({ error: `Only ${kit.stocks} "${kit.name}" in stock.` });
            }
        } else if (product.stocks !== undefined && product.stocks !== -1 && product.stocks < quantity) {
            return res.status(400).json({ error: `Only ${product.stocks} item(s) in stock.` });
        }

        // Recalculate unit price
        let unitPrice;
        if (item.selectedOption?.groupId) {
            const group = product.options?.id(item.selectedOption.groupId);
            const val = group?.values?.id(item.selectedOption.valueId);
            unitPrice = val?.price || 0;
            if (item.configurations?.length > 0) {
                for (const chosen of item.configurations) {
                    const cfgDef = product.configurations?.find(c => c.name === chosen.name);
                    const opt = cfgDef?.options?.find(o => o.value === chosen.selected);
                    if (opt?.priceModifier > 0) unitPrice += opt.priceModifier;
                }
            }
        } else if (kitId) {
            const kit = product.kits?.id(kitId);
            unitPrice = kit?.price || 0;
        } else {
            unitPrice = product.price;
            if (item.configurations?.length > 0) {
                for (const chosen of item.configurations) {
                    const cfgDef = product.configurations?.find(c => c.name === chosen.name);
                    const opt = cfgDef?.options?.find(o => o.value === chosen.selected);
                    if (opt?.priceModifier > 0) unitPrice += opt.priceModifier;
                }
            }
        }

        item.quantity = quantity;
        item.subtotal = unitPrice * quantity;
        cart.totalPrice = recalcTotal(cart.cartItems);

        await cart.save();
        return res.status(200).json({ message: 'Cart updated.', cart });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── PATCH /cart/:productId/remove-from-cart ─────────────────────────────────
// Query param ?kitId=xxx or ?optionValueId=xxx to target a specific item
module.exports.removeFromCart = async (req, res) => {
    try {
        const { productId } = req.params;
        const kitId = req.query.kitId || null;
        const optionValueId = req.query.optionValueId || null;

        const cart = await Cart.findOne({ userId: req.user.id });
        if (!cart) return res.status(404).json({ error: 'Cart not found.' });

        const initialLength = cart.cartItems.length;
        cart.cartItems = cart.cartItems.filter(item => {
            if (item.productId.toString() !== productId) return true;
            if (optionValueId) return item.selectedOption?.valueId?.toString() !== optionValueId;
            if (kitId) return item.kitId?.toString() !== kitId;
            // Remove base product item (no kit, no option)
            return item.kitId != null || item.selectedOption?.valueId != null;
        });

        if (cart.cartItems.length === initialLength) {
            return res.status(404).json({ error: 'Item not found in cart.' });
        }

        cart.totalPrice = recalcTotal(cart.cartItems);
        await cart.save();

        return res.status(200).json({ message: 'Item removed from cart.', cart });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── PUT /cart/clear-cart ─────────────────────────────────────────────────────
module.exports.clearCart = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user.id });
        if (!cart) return res.status(404).json({ error: 'Cart not found.' });

        cart.cartItems = [];
        cart.totalPrice = 0;
        await cart.save();

        return res.status(200).json({ message: 'Cart cleared.' });
    } catch (error) {
        errorHandler(error, req, res);
    }
};


// ─── POST /cart/add-group-buy-to-cart ─────────────────────────────────────────
module.exports.addGroupBuyToCart = async (req, res) => {
    try {
        const { groupBuyId, quantity, optionGroupId, optionValueId, configurations } = req.body;

        if (!groupBuyId || !quantity || quantity < 1) {
            return res.status(400).json({ error: 'groupBuyId and a valid quantity are required.' });
        }

        const gb = await GroupBuy.findById(groupBuyId);
        if (!gb) return res.status(404).json({ error: 'Group buy not found.' });
        if (gb.status !== 'open' && gb.status !== 'closing-soon') {
            return res.status(400).json({ error: 'This group buy is not accepting orders.' });
        }
        if (gb.maxOrders > 0 && gb.orderCount >= gb.maxOrders) {
            return res.status(400).json({ error: 'Maximum orders reached for this group buy.' });
        }

        // Calculate unit price
        let unitPrice = gb.basePrice;
        let selectedOption = null;

        if (optionGroupId && optionValueId && gb.options?.length > 0) {
            const optGroup = gb.options.id(optionGroupId);
            if (!optGroup) return res.status(400).json({ error: 'Invalid option group.' });
            const optVal = optGroup.values.id(optionValueId);
            if (!optVal) return res.status(400).json({ error: 'Invalid option value.' });
            if (!optVal.available) return res.status(400).json({ error: 'Selected option is not available.' });

            // Check option value stock
            if (optVal.stocks >= 0 && optVal.stocks < quantity) {
                return res.status(400).json({
                    error: `Only ${optVal.stocks} "${optVal.value}" available.`
                });
            }

            // Check config availability rules
            if (configurations?.length > 0 && gb.availabilityRules?.length > 0) {
                for (const chosen of configurations) {
                    const rule = gb.availabilityRules.find(
                        r => r.optionValueId.toString() === optionValueId && r.configName === chosen.name
                    );
                    if (rule && !rule.availableValues.includes(chosen.selected)) {
                        return res.status(400).json({
                            error: `"${chosen.selected}" for ${chosen.name} is not available with "${optVal.value}".`
                        });
                    }
                }
            }

            unitPrice = optVal.price;
            selectedOption = {
                groupId: optGroup._id,
                groupName: optGroup.name,
                valueId: optVal._id,
                value: optVal.value
            };
        } else if (gb.options?.length > 0) {
            return res.status(400).json({ error: 'Please select an option.' });
        }

        // Add config modifiers
        if (configurations?.length > 0) {
            for (const chosen of configurations) {
                const cfgDef = gb.configurations?.find(c => c.name === chosen.name);
                const opt = cfgDef?.options?.find(o => o.value === chosen.selected);
                if (opt?.priceModifier > 0) unitPrice += opt.priceModifier;
            }
        }

        const subtotal = unitPrice * quantity;

        // Check if user has an existing cart
        let cart = await Cart.findOne({ userId: req.user.id });

        if (cart && cart.cartItems.length > 0 && cart.cartType !== 'groupbuy') {
            return res.status(400).json({
                error: 'Your cart contains regular items. Please clear your cart or checkout first before adding group buy items.'
            });
        }

        if (!cart) {
            cart = new Cart({
                userId: req.user.id,
                cartType: 'groupbuy',
                cartItems: [{
                    productId: groupBuyId,
                    groupBuyId: groupBuyId,
                    groupBuyName: gb.name,
                    selectedOption: selectedOption || undefined,
                    configurations: configurations || [],
                    quantity,
                    subtotal
                }],
                totalPrice: subtotal
            });
        } else {
            cart.cartType = 'groupbuy';
            cart.cartItems.push({
                productId: groupBuyId,
                groupBuyId: groupBuyId,
                groupBuyName: gb.name,
                selectedOption: selectedOption || undefined,
                configurations: configurations || [],
                quantity,
                subtotal
            });
            cart.totalPrice = recalcTotal(cart.cartItems);
        }

        await cart.save();
        return res.status(200).json({ message: 'Added to cart.', cart });
    } catch (error) {
        errorHandler(error, req, res);
    }
};
