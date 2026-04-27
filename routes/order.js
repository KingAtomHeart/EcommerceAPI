const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.js');
const { verify, verifyAdmin } = require('../auth.js');

router.post('/create-payment', verify, orderController.createPaymentSession);
router.post('/webhook', orderController.handleWebhook);
router.get('/payment-status/:orderId', verify, orderController.getPaymentStatus);
router.post('/checkout', verify, orderController.createOrder);
router.post('/checkout-group-buy', verify, orderController.createOrder); // deprecated alias
router.get('/my-orders', verify, orderController.retrieveUserOrders);
router.get('/all-orders', verify, verifyAdmin, orderController.retrieveAllOrders);
router.get('/admin/search', verify, verifyAdmin, orderController.searchOrders);
router.post('/admin/add-link', verify, verifyAdmin, orderController.generateAddOrderLink);
router.get('/add-link/:token', verify, orderController.validateAddOrderToken);
router.patch('/:orderId/status', verify, verifyAdmin, orderController.updateOrderStatus);
router.patch('/:orderId/items/:itemId/status', verify, verifyAdmin, orderController.updateOrderItemStatus);
router.post('/:orderId/items', verify, verifyAdmin, orderController.addItemToOrder);

module.exports = router;
