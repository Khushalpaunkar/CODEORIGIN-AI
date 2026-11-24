const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const analysisController = require('../controllers/analysisController');

const router = express.Router();

router.post('/api/analyze', requireAuth, analysisController.startAnalysis);
router.get('/api/analysis/:analysisId/file', requireAuth, analysisController.getFileContent);
router.get('/analysis/:analysisId', requireAuth, analysisController.getAnalysis);

module.exports = router;
