const express = require("express");
const router = express.Router();
const Group = require("../models/Group");
const FoodLog = require("../models/FoodLog");
const Settlement = require("../models/Settlement");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");

// Helper to generate a unique random 6-character code
function generateInviteCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let randomPart = "";
  for (let i = 0; i < 6; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BITE-${randomPart}`;
}

async function getUniqueInviteCode() {
  let code = generateInviteCode();
  let exists = await Group.findOne({ inviteCode: code });
  while (exists) {
    code = generateInviteCode();
    exists = await Group.findOne({ inviteCode: code });
  }
  return code;
}

// 1. CREATE GROUP
router.post("/", protect, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Group name is required" });
    }

    const inviteCode = await getUniqueInviteCode();
    const group = await Group.create({
      name: name.trim(),
      inviteCode,
      members: [req.user.id],
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, data: group });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 2. JOIN GROUP BY CODE
router.post("/join", protect, async (req, res) => {
  try {
    const { inviteCode } = req.body;
    if (!inviteCode) {
      return res.status(400).json({ message: "Invite code is required" });
    }

    const cleanCode = inviteCode.trim().toUpperCase();
    const group = await Group.findOne({ inviteCode: cleanCode });
    if (!group) {
      return res.status(404).json({ message: "Group not found with this code" });
    }

    // Check if user is already a member
    if (group.members.some(m => m.toString() === req.user.id.toString())) {
      return res.json({ success: true, message: "Already a member", data: group });
    }

    group.members.push(req.user.id);
    await group.save();

    res.json({ success: true, message: "Joined group successfully", data: group });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Helper function to calculate net balances for a group
async function calculateGroupBalances(groupId, members) {
  // Initialize debt map: debts[debtorId][payerId] = amount
  const debts = {};
  members.forEach(m => {
    debts[m._id.toString()] = {};
    members.forEach(p => {
      if (m._id.toString() !== p._id.toString()) {
        debts[m._id.toString()][p._id.toString()] = 0;
      }
    });
  });

  // Find all split logs
  const logs = await FoodLog.find({ "splitInfo.groupId": groupId, "splitInfo.isSplit": true });
  logs.forEach(log => {
    const payer = log.splitInfo.paidBy?.toString();
    if (!payer) return;

    log.splitInfo.shares.forEach(share => {
      const debtor = share.user?.toString();
      const amount = share.amount || 0;
      if (debtor && payer && debtor !== payer && debts[debtor] && debts[debtor][payer] !== undefined) {
        debts[debtor][payer] += amount;
      }
    });
  });

  // Find all completed settlements
  const settlements = await Settlement.find({ groupId, status: 'completed' });
  settlements.forEach(setl => {
    const fromUser = setl.fromUser.toString();
    const toUser = setl.toUser.toString();
    const amount = setl.amount || 0;

    if (debts[fromUser] && debts[fromUser][toUser] !== undefined) {
      debts[fromUser][toUser] -= amount;
    }
  });

  // Net out debts pairwise: X owes Y, Y owes X
  members.forEach(m => {
    const u1 = m._id.toString();
    members.forEach(p => {
      const u2 = p._id.toString();
      if (u1 !== u2 && debts[u1] && debts[u2] && debts[u1][u2] > 0 && debts[u2][u1] > 0) {
        const d1 = debts[u1][u2];
        const d2 = debts[u2][u1];
        if (d1 >= d2) {
          debts[u1][u2] = d1 - d2;
          debts[u2][u1] = 0;
        } else {
          debts[u2][u1] = d2 - d1;
          debts[u1][u2] = 0;
        }
      }
    });
  });

  // Calculate overall net balance for each member
  const netBalances = {};
  members.forEach(m => {
    netBalances[m._id.toString()] = 0;
  });

  members.forEach(m => {
    const u1 = m._id.toString();
    members.forEach(p => {
      const u2 = p._id.toString();
      if (u1 !== u2 && debts[u1] && debts[u1][u2] > 0) {
        const amt = debts[u1][u2];
        netBalances[u1] -= amt;
        netBalances[u2] += amt;
      }
    });
  });

  // Format simplified debts list
  const formattedDebts = [];
  members.forEach(m => {
    const u1 = m._id.toString();
    members.forEach(p => {
      const u2 = p._id.toString();
      if (u1 !== u2 && debts[u1] && debts[u1][u2] > 0.01) {
        formattedDebts.push({
          fromUser: u1,
          fromUserName: m.name,
          toUser: u2,
          toUserName: p.name,
          amount: Math.round(debts[u1][u2] * 100) / 100
        });
      }
    });
  });

  return { netBalances, debts: formattedDebts };
}

// 3. LIST GROUPS CURRENT USER IS IN (Including individual net balances)
router.get("/", protect, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user.id }).populate("members", "name email");
    
    const formattedGroups = await Promise.all(
      groups.map(async (group) => {
        const { netBalances } = await calculateGroupBalances(group._id, group.members);
        return {
          _id: group._id,
          name: group.name,
          inviteCode: group.inviteCode,
          membersCount: group.members.length,
          members: group.members,
          userNetBalance: Math.round((netBalances[req.user.id] || 0) * 100) / 100,
          createdAt: group.createdAt
        };
      })
    );

    res.json({ success: true, data: formattedGroups });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 4. GET GROUP DETAILS (Logs, Members, Net Balances, Debts)
router.get("/:id", protect, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id).populate("members", "name email");
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!group.members.some(m => m._id.toString() === req.user.id)) {
      return res.status(403).json({ message: "Not authorized to view this group" });
    }

    // Fetch food logs and settlements
    const logs = await FoodLog.find({ "splitInfo.groupId": group._id })
      .populate("user", "name")
      .populate("splitInfo.paidBy", "name")
      .populate("splitInfo.shares.user", "name")
      .sort({ date: -1, createdAt: -1 });

    const settlements = await Settlement.find({ groupId: group._id })
      .populate("fromUser", "name")
      .populate("toUser", "name")
      .sort({ date: -1 });

    const { netBalances, debts } = await calculateGroupBalances(group._id, group.members);

    res.json({
      success: true,
      data: {
        group: {
          _id: group._id,
          name: group.name,
          inviteCode: group.inviteCode,
          members: group.members,
          createdBy: group.createdBy,
          createdAt: group.createdAt
        },
        logs,
        settlements,
        netBalances,
        debts,
        userNetBalance: Math.round((netBalances[req.user.id] || 0) * 100) / 100
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 5. POST SETTLEMENT IN A GROUP
router.post("/:id/settlements", protect, async (req, res) => {
  try {
    const { toUser, amount } = req.body;
    const groupId = req.params.id;

    if (!toUser || !amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid parameters" });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const isFromMember = group.members.some(m => m.toString() === req.user.id.toString());
    const isToMember = group.members.some(m => m.toString() === toUser.toString());
    if (!isFromMember || !isToMember) {
      return res.status(403).json({ message: "Users must be members of the group" });
    }

    const settlement = await Settlement.create({
      groupId,
      fromUser: req.user.id,
      toUser,
      amount: Number(amount),
      status: 'pending', // Set status to pending initially
    });

    res.status(201).json({ success: true, data: settlement });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 6. LEAVE/EXIT GROUP
router.post("/:id/leave", protect, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!group.members.some(m => m.toString() === req.user.id.toString())) {
      return res.status(400).json({ message: "You are not a member of this group" });
    }

    // Remove user from group members
    group.members = group.members.filter(m => m.toString() !== req.user.id.toString());
    await group.save();

    res.json({ success: true, message: "Left group successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 7. DELETE GROUP (Only creator can delete)
router.delete("/:id", protect, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (group.createdBy.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: "Only the group creator can delete this group" });
    }

    // Delete the group
    await Group.findByIdAndDelete(req.params.id);
    // Delete settlements associated with this group
    await Settlement.deleteMany({ groupId: group._id });

    res.json({ success: true, message: "Group deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 8. DELETE SETTLEMENT IN A GROUP
router.delete("/:groupId/settlements/:settlementId", protect, async (req, res) => {
  try {
    const { groupId, settlementId } = req.params;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!group.members.includes(req.user.id)) {
      return res.status(403).json({ message: "Not authorized to access this group" });
    }

    const settlement = await Settlement.findById(settlementId);
    if (!settlement) {
      return res.status(404).json({ message: "Settlement transaction not found" });
    }

    // Allow sender, recipient or group creator to delete
    const isPayer = settlement.fromUser.toString() === req.user.id.toString();
    const isRecipient = settlement.toUser.toString() === req.user.id.toString();
    const isCreator = group.createdBy.toString() === req.user.id.toString();

    if (!isPayer && !isRecipient && !isCreator) {
      return res.status(403).json({ message: "Only the participants or group creator can delete this settlement" });
    }

    await Settlement.findByIdAndDelete(settlementId);

    res.json({ success: true, message: "Settlement transaction deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 9. ACCEPT SETTLEMENT IN A GROUP (Only recipient can accept)
router.post("/:groupId/settlements/:settlementId/accept", protect, async (req, res) => {
  try {
    const { groupId, settlementId } = req.params;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!group.members.some(m => m.toString() === req.user.id.toString())) {
      return res.status(403).json({ message: "Not authorized to access this group" });
    }

    const settlement = await Settlement.findById(settlementId);
    if (!settlement) {
      return res.status(404).json({ message: "Settlement transaction not found" });
    }

    // Only the recipient (toUser) can approve the settlement
    if (settlement.toUser.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: "Only the recipient can accept this settlement" });
    }

    settlement.status = "completed";
    await settlement.save();

    res.json({ success: true, message: "Settlement transaction marked as completed", data: settlement });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
