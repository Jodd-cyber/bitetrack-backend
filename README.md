# BiteTrack Backend

BiteTrack Backend is the server-side API for the BiteTrack application. It handles authentication, food expense tracking, user profiles, budgets, AI assistant features, receipt scanning, Gmail food-order sync, and feedback submission.

## Features

- User signup and login with JWT authentication
- Google OAuth and GitHub OAuth login support
- Forgot password and reset password flow using email
- Protected user profile APIs
- Food log CRUD APIs
- Monthly budget create, fetch, update, and delete APIs
- AI assistant powered by Google Gemini
- Receipt image scanning using Gemini Vision
- Gmail integration to sync Swiggy and Zomato food orders
- Feedback submission with email notification
- MongoDB database integration using Mongoose
- Health check endpoint for deployment monitoring

## Tech Stack

- Node.js
- Express.js
- MongoDB
- Mongoose
- JWT
- Passport.js
- Google OAuth
- GitHub OAuth
- Google Gemini API
- Gmail API
- Nodemailer
- bcryptjs
- CORS
- dotenv

## Project Structure

```txt
backend/
├── config/
│   └── passport.js
├── controllers/
│   └── feedbackController.js
├── middleware/
│   ├── auth.js
│   └── authMiddleware.js
├── models/
│   ├── Budget.js
│   ├── ChatSession.js
│   ├── FoodLog.js
│   ├── User.js
│   └── feedbackModel.js
├── routes/
│   ├── ai.js
│   ├── auth.js
│   ├── budget.js
│   ├── feedbackRoutes.js
│   ├── foodlogs.js
│   ├── integrations.js
│   └── user.js
├── utils/
│   └── sendEmail.js
├── server.js
├── package.json
└── README.md
