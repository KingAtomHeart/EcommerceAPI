const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.js');
const { verify, verifyAdmin } = require('../auth.js');

router.post('/register', userController.registerUser);
router.post('/login', userController.loginUser);
router.post('/google-login', userController.googleLogin);
router.get('/details', verify, userController.getProfile);
router.patch('/update-password', verify, userController.updatePassword);
router.patch('/update-mobile', verify, userController.updateMobile);
router.patch('/update-profile-picture', verify, userController.updateProfilePicture);
router.post('/addresses', verify, userController.addAddress);
router.patch('/addresses/:addressId', verify, userController.updateAddress);
router.delete('/addresses/:addressId', verify, userController.deleteAddress);
router.patch('/addresses/:addressId/default', verify, userController.setDefaultAddress);
router.patch('/:id/set-as-admin', verify, verifyAdmin, userController.updateUserAsAdmin);

module.exports = router;
