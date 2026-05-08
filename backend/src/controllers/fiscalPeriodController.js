const { getFiscalPeriodGate } = require("../utils/fiscal");

exports.getFiscalPeriodStatusToday = async (req, res) => {
  try {
    const branchId = req.branchId;
    const gate = await getFiscalPeriodGate(branchId);
    if (!gate.ok) {
      return res.json({
        ok: false,
        code: gate.code,
        message: gate.message,
      });
    }
    const p = gate.period;
    return res.json({
      ok: true,
      periodId: p.id,
      startDate: p.startDate,
      endDate: p.endDate,
      isClosed: Boolean(p.isClosed),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
