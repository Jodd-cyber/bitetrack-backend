const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  inviteCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

GroupSchema.index({ inviteCode: 1 });

module.exports = mongoose.model('Group', GroupSchema);
