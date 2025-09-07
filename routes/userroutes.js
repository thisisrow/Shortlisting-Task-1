const express = require('express');
const { registerUser, loginUser, forgetPassword ,resetPassword} = require('../controller/usercontrollers');
const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);

module.exports = router;
