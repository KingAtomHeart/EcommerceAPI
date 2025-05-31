const Cart = require("../models/Cart.js");
const Order = require("../models/Order.js");
const { errorHandler } = require("../auth.js");


// Non Admin user checkout (Create order)
module.exports.createOrder = async (req, res) => {
    const userId = req.user.id;

    Cart.findOne({ userId })
        .then(cart => {
            if (!cart || cart.cartItems.length === 0) {
                return res.status(400).json({ error: "No Items to Checkout" });
            }

            const order = new Order({
                userId,
                productsOrdered: cart.cartItems,
                totalPrice: cart.totalPrice
            });

            return order.save()
                .then(savedOrder => {  
                    return Cart.deleteOne({ userId })
                        .then(() => res.status(201).json({ 
                            message: "Ordered Successfully", 
                            orderId: savedOrder._id 
                        }));
                });
        })
        .catch(error => errorHandler(error, req, res));
};



// Retrieve authenticated user orders
module.exports.retrieveUserOrders = (req, res) => {
    const userId = req.user.id;

    Order.find({ userId })
        .populate('productsOrdered.productId', 'name')
        .then(orders => {
            if (orders.length === 0) {
                return res.status(404).json({ message: "No orders found" });
            }

            const formattedOrders = orders.map(order => ({
                _id: order._id,
                totalPrice: order.totalPrice,
                orderedOn: order.orderedOn,
                status: order.status,
                productsOrdered: order.productsOrdered.map(item => ({
                    productId: item.productId._id,
                    productName: item.productId.name, // Include product name
                    quantity: item.quantity,
                    subtotal: item.subtotal
                }))
            }));

            return res.status(200).json({ orders: formattedOrders });
        })
        .catch(error => errorHandler(error, req, res));
};


// Retrieve all orders (Admin only)
module.exports.retrieveAllOrders = (req, res) => {
    if (!req.user.isAdmin) {
        return res.status(403).json({ error: "Access denied. Admins only." });
    }

    Order.find({})
        .then(orders => {
            return res.status(200).json({ orders });
        })
        .catch(error => errorHandler(error, req, res));
};

