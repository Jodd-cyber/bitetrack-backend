const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, default: 1 }
}, { _id: false });

const FoodLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: { type: [ItemSchema], default: [] },
  amount: { type: Number, default: 0 },
  notes: { type: String, trim: true },
  restaurant: { type: String, required: true, trim: true },

  mealType: { type: String, default: "Lunch" },
  date: { type: Date, required: true },
  time: { type: String },
  rating: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now }
});

// optional index for faster per-user queries
FoodLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('FoodLog', FoodLogSchema);
