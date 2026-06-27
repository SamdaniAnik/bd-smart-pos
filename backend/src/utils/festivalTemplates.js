/** Festival + salary-week promotion kit templates (Phase 3). */

const FESTIVAL_CALENDAR_2026 = {
  festival_eid: { month: 5, day: 7, durationDays: 7 },
  festival_ramadan: { month: 2, day: 18, durationDays: 30 },
  festival_boishakh: { month: 3, day: 14, durationDays: 3 },
  festival_puja: { month: 9, day: 20, durationDays: 5 },
  salary_week: { month: null, day: null, durationDays: 7, salaryWeek: true },
};

function salaryWeekWindow(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  const start = new Date(year, month - 1, Math.max(1, lastDay - 6));
  const end = new Date(year, month - 1, lastDay, 23, 59, 59);
  return { startsAt: start, endsAt: end };
}

function suggestedDates(templateId, refDate = new Date()) {
  const year = refDate.getFullYear();
  const cal = FESTIVAL_CALENDAR_2026[templateId];
  if (!cal) return { startsAt: null, endsAt: null };
  if (cal.salaryWeek) {
    const nextMonth = refDate.getMonth() + 2;
    const y = nextMonth > 12 ? year + 1 : year;
    const m = nextMonth > 12 ? 1 : nextMonth;
    return salaryWeekWindow(y, m);
  }
  const start = new Date(year, cal.month, cal.day);
  const end = new Date(start);
  end.setDate(end.getDate() + cal.durationDays - 1);
  end.setHours(23, 59, 59, 999);
  if (end < refDate) {
    start.setFullYear(year + 1);
    end.setFullYear(year + 1);
  }
  return { startsAt: start, endsAt: end };
}

const TEMPLATE_DEFS = {
  festival_eid: {
    id: "festival_eid",
    name: "ঈদ অফার — Eid Offer",
    type: "CART_PERCENT",
    discountValue: 10,
    minBasketAmount: 1000,
  },
  festival_ramadan: {
    id: "festival_ramadan",
    name: "রমজান অফার — Ramadan Grocery",
    type: "CATEGORY_PERCENT",
    category: "GROCERY",
    discountValue: 5,
  },
  festival_boishakh: {
    id: "festival_boishakh",
    name: "পহেলা বৈশাখ অফার — Boishakh Offer",
    type: "CART_PERCENT",
    discountValue: 5,
    minBasketAmount: 500,
  },
  festival_puja: {
    id: "festival_puja",
    name: "পূজা অফার — Puja Offer",
    type: "CART_PERCENT",
    discountValue: 8,
  },
  salary_week: {
    id: "salary_week",
    name: "বেতন সপ্তাহ — Salary Week Grocery",
    type: "CART_PERCENT",
    discountValue: 5,
    minBasketAmount: 2000,
  },
};

function listFestivalTemplates(refDate = new Date()) {
  return Object.values(TEMPLATE_DEFS).map((tpl) => {
    const dates = suggestedDates(tpl.id, refDate);
    return {
      ...tpl,
      suggestedStartsAt: dates.startsAt?.toISOString() || null,
      suggestedEndsAt: dates.endsAt?.toISOString() || null,
    };
  });
}

function getFestivalTemplate(templateId) {
  return TEMPLATE_DEFS[String(templateId || "").trim()] || null;
}

module.exports = {
  listFestivalTemplates,
  getFestivalTemplate,
  suggestedDates,
};
