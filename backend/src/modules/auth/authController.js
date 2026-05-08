const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../../utils/prisma");
const config = require("../../utils/config");
const { writeAuditLog } = require("../../utils/audit");

exports.register = async (req, res) => {
  try {
    const { name, email, password, roleId, branchId, language } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, roleId: Number(roleId), branchId: Number(branchId), language: language || "en" },
    });
    await writeAuditLog({ action: "USER_REGISTER", entity: "User", entityId: user.id, payload: { email } });
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: true } },
          },
        },
      },
    });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { userId: user.id, branchId: user.branchId, roleId: user.roleId },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    const permissions = user.role.rolePermissions.map((rp) => rp.permission.code);
    res.json({ token, user, permissions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.me = async (req, res) => {
  const permissions = req.user.role.rolePermissions.map((rp) => rp.permission.code);
  res.json({ user: req.user, permissions });
};
