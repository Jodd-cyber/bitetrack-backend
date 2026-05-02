const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const { submitFeedback } = require("../controllers/feedbackController");


router.post("/", auth, submitFeedback);

module.exports = router;