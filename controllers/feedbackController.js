const Feedback = require("../models/feedbackModel");
const sendEmail = require("../utils/sendEmail");

const submitFeedback = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const name = req.user?.name || "Anonymous";
    const email = req.user?.email || "No email";

    const feedback = await Feedback.create({
      name,
      email,
      message,
    });

    // 🔥 Send email (non-blocking safe)
    try {
      await sendEmail(
        process.env.EMAIL_USER,
        "New Feedback from BiteTrack",
        `
          <h2>New Feedback Received</h2>
          <p><b>Name:</b> ${name}</p>
          <p><b>Email:</b> ${email}</p>
          <p><b>Message:</b> ${message}</p>
        `
      );
    } catch (err) {
      console.error("Email failed:", err);
    }

    return res.status(201).json({
      success: true,
      message: "Feedback submitted successfully",
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = { submitFeedback };