// Shared state that more than one module reassigns. An imported binding is read-only, so a
// value written from several files lives on S. A value only its own module writes stays a plain
// export there: importers still see every change, they just can't make one.

import { getISOWeek } from "./dates.js";

export const S = {};

// ---------- state ----------
const now = new Date();
S.entries = [];
S.view = "week";
S.wk = getISOWeek(now);
S.mo = { year: now.getFullYear(), month: now.getMonth() };
export const currentWk = getISOWeek(now);
S.compactView = false; // pinch out on the list -> long entries collapse to summaries
