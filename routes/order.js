const express = require("express");
const orderController = require("../controllers/order.js");
const { verify, verifyAdmin } = require("../auth.js");
const router = express.Router();



router.post("/checkout", verify, orderController.createOrder);

router.get("/my-orders", verify, orderController.retrieveUserOrders);

router.get("/all-orders", verify, verifyAdmin, orderController.retrieveAllOrders);



module.exports = router;