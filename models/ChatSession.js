const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { _id: true });

const ChatSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New Chat' },
  messages: [MessageSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

ChatSessionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  if (this.title === 'New Chat' && this.messages.length > 0) {
    const firstMsg = this.messages.find(m => m.role === 'user');
    if (firstMsg) {
      this.title = firstMsg.text.substring(0, 30) + (firstMsg.text.length > 30 ? '...' : '');
    }
  }
  next();
});

module.exports = mongoose.model('ChatSession', ChatSessionSchema);
