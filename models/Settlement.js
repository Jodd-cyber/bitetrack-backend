const mongoose = require('mongoose');

const SettlementSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  status: { type: String, default: 'completed' } // 'completed', 'pending'
});

SettlementSchema.index({ groupId: 1 });

module.exports = mongoose.model('Settlement', SettlementSchema);
