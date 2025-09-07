const express = require('express');
const router = express.Router();
const { registerUser, loginUser, storeInstaUsername } = require('../controller/usercontrollers');
// const auth = require('../middleware/auth');

router.post('/register', registerUser);
router.post('/login', loginUser);
// router.post('/username', auth, storeInstaUsername);
router.post('/username', storeInstaUsername);
module.exports = router;