"""Natural-language time reference resolution.

Converts phrases like "last quarter", "Q2 2023-24", "since the scheme started"
into explicit [start, end) date ranges. Also knows the prototype's TMS data
window (FY2025-26) and flags requests that fall outside it.

Dates are resolved relative to a supplied `today` (defaults to the real current
date) so the module is deterministic in tests.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

# AB PM-JAY national launch date.
SCHEME_START = date(2018, 9, 23)
# Prototype TMS data window.
TMS_WINDOW_START = date(2025, 4, 1)
TMS_WINDOW_END = date(2026, 4, 1)  # exclusive upper bound


@dataclass
class TimeResolution:
    status: str  # "resolved" | "none"
    start: date | None = None
    end: date | None = None  # exclusive
    label: str | None = None
    outside_tms_window: bool = False
    note: str | None = None


def _fy_range(fy_start_year: int) -> tuple[date, date]:
    """Indian financial year: 1 Apr Y -> 1 Apr Y+1 (exclusive)."""
    return date(fy_start_year, 4, 1), date(fy_start_year + 1, 4, 1)


def _quarter_range(fy_start_year: int, q: int) -> tuple[date, date]:
    # Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar
    starts = {
        1: date(fy_start_year, 4, 1),
        2: date(fy_start_year, 7, 1),
        3: date(fy_start_year, 10, 1),
        4: date(fy_start_year + 1, 1, 1),
    }
    ends = {
        1: date(fy_start_year, 7, 1),
        2: date(fy_start_year, 10, 1),
        3: date(fy_start_year + 1, 1, 1),
        4: date(fy_start_year + 1, 4, 1),
    }
    return starts[q], ends[q]


class TimeResolver:
    def resolve(self, text: str, today: date | None = None) -> TimeResolution:
        today = today or date.today()
        t = text.lower()

        # Q2 2023-24 / Q2 FY2023-24 / quarter 2 2023-24
        m = re.search(r"q(?:uarter)?\s*([1-4]).*?(20\d{2})\s*[-/]\s*(\d{2,4})", t)
        if m:
            q = int(m.group(1))
            fy_start = int(m.group(2))
            start, end = _quarter_range(fy_start, q)
            return self._finalize(start, end, f"Q{q} {fy_start}-{str(fy_start + 1)[-2:]}")

        # FY2023-24 / 2023-24 / financial year 2023-24
        m = re.search(r"(?:fy\s*)?(20\d{2})\s*[-/]\s*(\d{2,4})", t)
        if m:
            fy_start = int(m.group(1))
            start, end = _fy_range(fy_start)
            return self._finalize(start, end, f"FY{fy_start}-{str(fy_start + 1)[-2:]}")

        # single calendar year, e.g. "in 2025"
        m = re.search(r"\b(20\d{2})\b", t)
        if m and "quarter" not in t and "q" not in t:
            y = int(m.group(1))
            return self._finalize(date(y, 1, 1), date(y + 1, 1, 1), str(y))

        if "since the scheme" in t or "scheme started" in t or "scheme launch" in t:
            return self._finalize(SCHEME_START, date(today.year + 1, 1, 1),
                                  "since scheme launch (2018-09-23)")

        if "last year" in t or "previous year" in t:
            start, end = _fy_range(today.year - 1 if today.month >= 4 else today.year - 2)
            return self._finalize(start, end, "last financial year")

        if "this year" in t or "current year" in t:
            start, end = _fy_range(today.year if today.month >= 4 else today.year - 1)
            return self._finalize(start, end, "this financial year")

        if "last quarter" in t or "previous quarter" in t:
            fy_start = today.year if today.month >= 4 else today.year - 1
            cur_q = ((today.month - 4) % 12) // 3 + 1
            q = cur_q - 1 if cur_q > 1 else 4
            if cur_q == 1:
                fy_start -= 1
            start, end = _quarter_range(fy_start, q)
            return self._finalize(start, end, f"last quarter (Q{q})")

        if "last month" in t or "previous month" in t:
            y, mo = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
            end_y, end_mo = (y, mo + 1) if mo < 12 else (y + 1, 1)
            return self._finalize(date(y, mo, 1), date(end_y, end_mo, 1), "last month")

        return TimeResolution(status="none")

    def _finalize(self, start: date, end: date, label: str) -> TimeResolution:
        # Overlap check against the TMS window.
        outside = end <= TMS_WINDOW_START or start >= TMS_WINDOW_END
        note = None
        if outside:
            note = (
                f"The requested period ({label}) is outside the prototype TMS data "
                f"window (FY2025-26). Claims data is only available for "
                f"1 Apr 2025 – 31 Mar 2026."
            )
        return TimeResolution(
            status="resolved",
            start=start,
            end=end,
            label=label,
            outside_tms_window=outside,
            note=note,
        )


_resolver: TimeResolver | None = None


def get_time_resolver() -> TimeResolver:
    global _resolver
    if _resolver is None:
        _resolver = TimeResolver()
    return _resolver
