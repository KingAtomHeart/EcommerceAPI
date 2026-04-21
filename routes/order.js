const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.js');
const { verify, verifyAdmin } = require('../auth.js');

router.post('/create-payment', verify, orderController.createPaymentSession);
router.post('/webhook', orderController.handleWebhook);
router.get('/payment-status/:orderId', verify, orderController.getPaymentStatus);
router.post('/checkout', verify, orderController.createOrder);
router.post('/checkout-group-buy', verify, orderController.checkoutGroupBuy);
router.get('/my-orders', verify, orderController.retrieveUserOrders);
router.get('/all-orders', verify, verifyAdmin, orderController.retrieveAllOrders);
router.patch('/:orderId/status', verify, verifyAdmin, orderController.updateOrderStatus);

module.exports = router;
