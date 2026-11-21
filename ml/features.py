"""Model inputs from heat-detector histories: the reference definitions of ml/model/contract.json.

Mirrors app/src/ml/features.ts line for line (same loops, same float64 arithmetic). The parity of the two is tested on
ml/model/golden-features.json (written by make_dummy.py, read by app/src/ml/features.test.ts). Training code may use a
vectorised version, as long as it is tested against this one.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

CONTRACT = json.loads((Path(__file__).parent / "model" / "contract.json").read_text(encoding="utf-8"))
FEATURE_NAMES: list[str] = [f["name"] for f in CONTRACT["features"]]
WINDOW_S: float = CONTRACT["windowS"]
SLOPES_S: list[float] = CONTRACT["slopeWindowsS"]
SLOPE_AT_FAIL_S: float = CONTRACT["slopeAtFailWindowS"]
NAN = float("nan")


def signal_at(readings: list[list[float]], k: int) -> float:
    """Max of the valid readings at sample k; NaN when every detector has failed."""
    best = NAN
    for d in readings:
        v = d[k]
        if not math.isnan(v) and (math.isnan(best) or v > best):
            best = v
    return best


def slope_between(t: list[float], readings: list[list[float]], frm: float, to: float, strict_end: bool = False) -> float:
    """Least-squares slope of the valid room signal for samples with frm <= t <= to; NaN with fewer than 2 points."""
    ts: list[float] = []
    ys: list[float] = []
    for k, tk in enumerate(t):
        if tk < frm or tk > to or (strict_end and tk >= to):
            continue
        y = signal_at(readings, k)
        if math.isnan(y):
            continue
        ts.append(tk)
        ys.append(y)
    if len(ts) < 2:
        return NAN
    mt = 0.0
    my = 0.0
    for i in range(len(ts)):
        mt += ts[i]
        my += ys[i]
    mt /= len(ts)
    my /= len(ts)
    num = 0.0
    den = 0.0
    for i in range(len(ts)):
        num += (ts[i] - mt) * (ys[i] - my)
        den += (ts[i] - mt) * (ts[i] - mt)
    return num / den if den > 0 else NAN


def room_stats(t: list[float], readings: list[list[float]], t_now: float) -> dict[str, float]:
    """Statistics of one room at time t_now (the last sample at or before t_now is "now")."""
    last = -1
    for k, tk in enumerate(t):
        if tk > t_now:
            break
        last = k
    n_det = len(readings)
    if last < 0 or n_det == 0:
        return dict(t_last=NAN, slope10=NAN, slope30=NAN, slope60=NAN, t_max60=NAN, frac_failed=0.0, s_since_fail=NAN, slope_at_fail=NAN)
    t_max = NAN
    for k in range(last + 1):
        if t[k] < t_now - WINDOW_S:
            continue
        y = signal_at(readings, k)
        if not math.isnan(y) and (math.isnan(t_max) or y > t_max):
            t_max = y
    failed = 0
    first_fail = math.inf
    for d in readings:
        if math.isnan(d[last]):
            failed += 1
        for k in range(last + 1):
            if math.isnan(d[k]):
                if t[k] < first_fail:
                    first_fail = t[k]
                break
    has_fail = math.isfinite(first_fail)
    w10, w30, w60 = SLOPES_S
    return dict(
        t_last=signal_at(readings, last),
        slope10=slope_between(t, readings, t_now - w10, t_now),
        slope30=slope_between(t, readings, t_now - w30, t_now),
        slope60=slope_between(t, readings, t_now - w60, t_now),
        t_max60=t_max,
        frac_failed=failed / n_det,
        s_since_fail=t_now - first_fail if has_fail else NAN,
        slope_at_fail=slope_between(t, readings, first_fail - SLOPE_AT_FAIL_S, first_fail, True) if has_fail else NAN,
    )


def nan_max(values: list[float]) -> float:
    best = NAN
    for v in values:
        if not math.isnan(v) and (math.isnan(best) or v > best):
            best = v
    return best


def feature_vector(self: dict[str, float], neighbours: list[dict[str, float]]) -> list[float]:
    """The model's input row for one room, in contract order."""
    return [
        self["t_last"],
        self["slope10"],
        self["slope30"],
        self["slope60"],
        self["t_max60"],
        self["frac_failed"],
        self["s_since_fail"],
        self["slope_at_fail"],
        nan_max([n["t_last"] for n in neighbours]),
        nan_max([n["slope30"] for n in neighbours]),
        max([n["frac_failed"] for n in neighbours]) if neighbours else 0.0,
        nan_max([n["s_since_fail"] for n in neighbours]),
        nan_max([n["slope_at_fail"] for n in neighbours]),
    ]
