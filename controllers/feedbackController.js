
const Feedback = require("../models/feedbackModel");
const sendEmail = require("../utils/sendEmail");


const submitFeedback = async (req, res) => {
  try {
    const { message } = req.body;
console.log("USER FROM TOKEN:", req.user);
// get user from token
const user = req.user || {};
const name = user.name || "Anonymous";
const email = user.email || "";

    const feedback = await Feedback.create({
  name,
  email,
  message,
});

    // 🔥 Send email here
    await sendEmail(
  process.env.EMAIL_USER, // YOU receive feedback
  "New Feedback from BiteTrack",
  `
    <h2>New Feedback Received</h2>
    <p><b>Name:</b> ${name}</p>
    <p><b>Email:</b> ${email}</p>
    <p><b>Message:</b> ${message}</p>
  `
);
    res.status(201).json({
      success: true,
      message: "Feedback saved + email sent",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error",
    });
  }
};

module.exports = { submitFeedback };