const express = require('express');
const { registerUser, loginUser, forgetPassword ,resetPassword} = require('../controller/usercontrollers');
const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/forget-password', forgetPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
