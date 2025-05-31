const Cart = require("../models/Cart.js");
const Product = require("../models/Product.js");
const { errorHandler } = require("../auth.js");



// Get User's Cart
module.exports.retrieveUserCart = (req, res) => {
    return Cart.findOne({ userId: req.user.id })
        .populate('cartItems.productId', 'name price') 
        .then(cart => {
            if (cart) {
                return res.status(200).send({
                    cart: {  
                        userId: cart.userId,
                        cartItems: cart.cartItems.map(item => ({
                            productId: item.productId._id,  
                            productName: item.productId.name,
                            price: item.productId.price,  // Add price
                            quantity: item.quantity,
                            subtotal: item.subtotal,
                            _id: item._id
                        })),
                        totalPrice: cart.totalPrice
                    }
                });
            }
            return res.status(404).send({
                message: 'No cart found'
            });
        })
        .catch(error => errorHandler(error, req, res));
};


// Add to Cart
// module.exports.addToCart = (req, res) => {
//     const userId = req.user.id; 
//     const { productId, quantity } = req.body;


//     if (!productId || !quantity || quantity <= 0) {
//         return res.status(400).send({ error: 'Invalid product ID or quantity' });
//     }

//     Cart.findOne({ userId })
//         .then(cart => {
//             if (!cart) {
//                 Product.findById(productId)
//                     .then(product => {
//                         if (!product) {
//                             return res.status(404).send({ error: 'Product not found' });
//                         }
//                         const newCart = new Cart({
//                             userId,
//                             cartItems: [{
//                                 productId,
//                                 quantity,
//                                 subtotal: product.price * quantity
//                             }],
//                             totalPrice: product.price * quantity
//                         });
//                         return newCart.save().then(savedCart => {
//                             return res.status(201).send({
//                                 message: 'Cart created and item added',
//                                 cart: savedCart
//                             });
//                         });
//                     })
//                     .catch(error => errorHandler(error, req, res));
//             } else {
//                 const itemIndex = cart.cartItems.findIndex(
//                     item => item.productId.toString() === productId.toString()
//                 );
//                 if (itemIndex > -1) {                    
//                     const cartItem = cart.cartItems[itemIndex];
//                     cartItem.quantity += quantity;
//                     Product.findById(cartItem.productId)
//                         .then(product => {
//                             if (!product) {
//                                 return res.status(404).send({ error: 'Product not found' });
//                             }
//                             cartItem.subtotal = product.price * cartItem.quantity;
//                             cart.totalPrice = cart.cartItems.reduce((acc, item) => acc + item.subtotal, 0);
                          
//                             return cart.save().then(updatedCart => {
//                                 return res.status(200).send({
//                                     message: 'Item quantity updated in cart',
//                                     cart: updatedCart
//                                 });
//                             });
//                         })
//                         .catch(error => errorHandler(error, req, res));
//                 } else {
                    
//                     Product.findById(productId)
//                         .then(product => {
//                             if (!product) {
//                                 return res.status(404).send({ error: 'Product not found' });
//                             }

//                             cart.cartItems.push({
//                                 productId,
//                                 quantity,
//                                 subtotal: product.price * quantity
//                             });

//                             cart.totalPrice += product.price * quantity;

                            
//                             return cart.save().then(updatedCart => {
//                                 return res.status(200).send({
//                                     message: 'Item added to cart',
//                                     cart: updatedCart
//                                 });
//                             });
//                         })
//                         .catch(error => errorHandler(error, req, res));
//                 }
//             }
//         })
//         .catch(error => {
//             errorHandler(error, req, res);
//         });
// };

// Add to cart
// exports.addToCart = async (req, res) => {
//     try {
//         const userId = req.user.id;
//         const { productId, quantity, subtotal } = req.body;

//         // Fetch product details
//         const product = await Product.findById(productId);

//         if (!product) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Product not found'
//             });
//         }

//         if (!product.isActive) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Product is not available'
//             });
//         }

//         const productName = product.name.trim(); // Trim whitespace
//         const price = product.price;

//         let cart = await Cart.findOne({ userId });

//         if (!cart) {
//             cart = new Cart({
//                 userId,
//                 cartItems: [{
//                     productId,
//                     productName,
//                     price,
//                     quantity,
//                     subtotal
//                 }],
//                 totalPrice: subtotal
//             });
//         } else {
//             const existingItemIndex = cart.cartItems.findIndex(item => item.productId.toString() === productId);

//             if (existingItemIndex >= 0) {
//                 cart.cartItems[existingItemIndex].quantity += quantity;
//                 cart.cartItems[existingItemIndex].subtotal += subtotal;
//             } else {
//                 cart.cartItems.push({
//                     productId,
//                     productName,
//                     price,
//                     quantity,
//                     subtotal
//                 });
//             }

//             cart.totalPrice += subtotal;
//         }

//         await cart.save();

//         res.status(200).json({
//             message: 'Item added to your cart!',
//             cart
//         });
//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: 'An error occurred while adding to the cart',
//             error: error.message
//         });
//     }
// };


exports.addToCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId, quantity, subtotal } = req.body;

        // Fetch product details
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        if (!product.isActive) {
            return res.status(400).json({
                success: false,
                message: 'Product is not available'
            });
        }

        const productName = product.name.trim(); // Trim whitespace
        const price = product.price;

        let cart = await Cart.findOne({ userId });

        if (!cart) {
            cart = new Cart({
                userId,
                cartItems: [{
                    productId,
                    productName,
                    price,
                    quantity,
                    subtotal
                }],
                totalPrice: subtotal
            });
        } else {
            const existingItemIndex = cart.cartItems.findIndex(item => item.productId.toString() === productId);

            if (existingItemIndex >= 0) {
                cart.cartItems[existingItemIndex].quantity += quantity;
                cart.cartItems[existingItemIndex].subtotal += subtotal;
            } else {
                cart.cartItems.push({
                    productId,
                    productName,
                    price,
                    quantity,
                    subtotal
                });
            }

            cart.totalPrice += subtotal;
        }

        await cart.save();

        res.status(200).json({
            message: 'Item added to cart successfully',  // Update message
            cart
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'An error occurred while adding to the cart',
            error: error.message
        });
    }
};




// Change Product Quantities
module.exports.updateCartQuantity = (req, res) => {
    const { productId, newQuantity } = req.body;
    const userId = req.user.id;

    Cart.findOne({ userId })
        .then(cart => {
            if (!cart) {
                return res.status(404).send({ error: 'Cart not found' });
            }

            const itemIndex = cart.cartItems.findIndex(item => item.productId.toString() === productId.toString());

            if (itemIndex > -1) {
                const cartItem = cart.cartItems[itemIndex];
                cartItem.quantity = newQuantity;

                return Product.findById(cartItem.productId).then(product => {
                    if (!product) {
                        return res.status(404).send({ error: 'Product not found' });
                    }

                    cartItem.subtotal = product.price * newQuantity;
                    cart.totalPrice = cart.cartItems.reduce((acc, item) => acc + item.subtotal, 0);

                    return cart.save().then(() => {
                        // Re-fetch cart with populated productId fields
                        return Cart.findOne({ userId })
                            .populate('cartItems.productId', 'name price') 
                            .then(updatedCart => {
                                if (!updatedCart) {
                                    return res.status(404).send({ error: 'Updated cart not found' });
                                }

                                res.status(200).send({
                                    message: 'Item quantity updated successfully',
                                    updatedCart: {
                                        _id: updatedCart._id,  
                                        userId: updatedCart.userId,
                                        cartItems: updatedCart.cartItems.map(item => {
                                            // Ensure productId is populated and accessible
                                            if (!item.productId || !item.productId._id) {
                                                return res.status(500).send({ error: 'Product details missing in cart' });
                                            }

                                            return {
                                                productId: item.productId._id,  
                                                productName: item.productId.name,
                                                price: item.productId.price,  
                                                quantity: item.quantity,
                                                subtotal: item.subtotal,
                                                _id: item._id
                                            };
                                        }),
                                        totalPrice: updatedCart.totalPrice,
                                        __v: updatedCart.__v 
                                    }
                                });
                            });
                    });
                });
            } else {
                return res.status(404).send({ error: 'Item not found in cart' });
            }
        })
        .catch(error => errorHandler(error, req, res));
};



// Remove products from cart
module.exports.removeFromCart = (req, res) => {
    const { productId } = req.params;  
    const userId = req.user.id;       

    Cart.findOne({ userId })
        .then(cart => {
            if (!cart) {
                return res.status(404).send({ error: 'Cart not found' });
            }

            const itemIndex = cart.cartItems.findIndex(item => item.productId.toString() === productId.toString());

            if (itemIndex !== -1) {

                const removedItem = cart.cartItems.splice(itemIndex, 1);


                cart.totalPrice = cart.cartItems.reduce((acc, item) => acc + item.subtotal, 0);


                return cart.save().then(updatedCart => {
                    res.status(200).send({
                        message: 'Item removed from your cart successfully',
                        updatedCart: {
                            _id: updatedCart._id,
                            userId: updatedCart.userId,
                            cartItems: updatedCart.cartItems,
                            totalPrice: updatedCart.totalPrice,
                            __v: updatedCart.__v
                        }
                    });
                });
            } else {
                return res.status(404).send({ error: 'Item is not found in your cart' });
            }
        })
        .catch(error => errorHandler(error, req, res));
};


// Clear Cart
module.exports.clearCart = (req, res) => {
    const userId = req.user.id; 

    Cart.findOne({ userId })
        .then(cart => {
            if (!cart) {
                return res.status(400).send({ error: 'Cart not found' });
            }

            cart.cartItems = [];
            cart.totalPrice = 0;

            return cart.save().then(updatedCart => {
                res.status(200).send({
                    message: 'Cart cleared successfully',
                    updatedCart: {
                        _id: updatedCart._id,
                        userId: updatedCart.userId,
                        cartItems: updatedCart.cartItems,
                        totalPrice: updatedCart.totalPrice,
                        __v: updatedCart.__v
                    }
                });
            });
        })
        .catch(error => errorHandler(error, req, res));
};


