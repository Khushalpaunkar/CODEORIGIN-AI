const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const {
    requireAuth,
    redirectIfAuthenticated,
} = require('../middleware/authMiddleware');

router.get('/login', redirectIfAuthenticated, authController.getLogin);
router.post('/login', authController.postLogin);

router.get('/register', redirectIfAuthenticated, authController.getRegister);
router.post('/register', authController.postRegister);

router.post('/logout', requireAuth, authController.postLogout);

module.exports = router;