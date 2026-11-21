import math

from features import FEATURE_NAMES, NAN, feature_vector, room_stats


def test_contract_has_thirteen_features():
    assert len(FEATURE_NAMES) == 13
    assert len(set(FEATURE_NAMES)) == 13


def test_linear_rise_gives_its_slope():
    t = [float(s) for s in range(0, 121)]
    s = room_stats(t, [[20.0 + 0.5 * x for x in t]], 120.0)
    assert math.isclose(s["slope10"], 0.5) and math.isclose(s["slope60"], 0.5)
    assert s["t_last"] == 80.0 and s["t_max60"] == 80.0
    assert s["frac_failed"] == 0.0 and math.isnan(s["s_since_fail"]) and math.isnan(s["slope_at_fail"])


def test_failure_masks_the_room_and_keeps_its_history():
    t = [float(s) for s in range(0, 101)]
    det = [20.0 + 2.0 * x if 20.0 + 2.0 * x <= 150.0 else NAN for x in t]  # fails at t = 66 s
    s = room_stats(t, [det], 100.0)
    assert math.isnan(s["t_last"]) and math.isnan(s["slope10"])
    assert s["frac_failed"] == 1.0
    assert s["s_since_fail"] == 34.0
    assert math.isclose(s["slope_at_fail"], 2.0)


def test_neighbours_aggregate_with_nan_ignored():
    hot = dict(t_last=NAN, slope10=NAN, slope30=NAN, slope60=NAN, t_max60=NAN, frac_failed=1.0, s_since_fail=12.0, slope_at_fail=3.0)
    cool = dict(t_last=40.0, slope10=0.1, slope30=0.2, slope60=0.1, t_max60=41.0, frac_failed=0.0, s_since_fail=NAN, slope_at_fail=NAN)
    row = feature_vector(cool, [hot])
    assert len(row) == len(FEATURE_NAMES)
    assert math.isnan(row[8]) and math.isnan(row[9])
    assert row[10:] == [1.0, 12.0, 3.0]
    assert feature_vector(cool, [])[10] == 0.0
