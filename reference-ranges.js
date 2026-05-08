// reference-ranges.js — Demographic-aware reference range resolution.
//
// `pickReferenceRange(test, ctx)` — one place that decides which range a result
// is compared against. Result writers (instrument simulator, manual entry) call
// this and snapshot the picked range onto the result so historical results
// don't drift when the test catalog is later edited.
//
//   pickReferenceRange(test, { patient, asOf, method })
//     → { low, high, units, source, matchedRange | null }
//
//   - test:    a record from the `tests` collection
//   - patient: { sex, dob } — sex 'M'|'F'|'X'; dob ISO string or epoch ms
//   - asOf:    epoch ms (defaults to Date.now()); used for effective dating
//   - method:  optional method/instrument scope; falls back to "" (any method)
//
// Resolution: filter `test.referenceRanges` to the entries whose sex/age/method/
// effective-window match, then pick the most specific. Specificity is the count
// of non-wildcard fields (explicit sex/age/method/window each count 1). Ties
// broken by most-recently-edited.
//
// If no entries match, fall back to the test's scalar `refRangeLow/refRangeHigh`
// with `source: 'default'`. If the test has neither, return nulls with
// `source: 'none'`.

(function () {

  const __ageYears = (dob, asOf) => {
    if (!dob) return null;
    const birth = (typeof dob === 'number') ? new Date(dob) : new Date(dob);
    if (isNaN(birth.getTime())) return null;
    const now = new Date(asOf || Date.now());
    let years = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
    return years;
  };

  const __matches = (rr, ctx) => {
    // Sex — defensive: a sex-constrained range only matches when the patient's
    // sex is known. Missing patient.sex skips the range (same policy as DOB).
    if (rr.sex && rr.sex !== 'any') {
      if (!ctx.patient || !ctx.patient.sex) return false;
      if (rr.sex !== ctx.patient.sex) return false;
    }
    // Age (inclusive lower, exclusive upper — so "0..18" and "18..150" don't overlap on the boundary)
    if ((rr.ageMinYears != null || rr.ageMaxYears != null)) {
      const yrs = __ageYears(ctx.patient && ctx.patient.dob, ctx.asOf);
      if (yrs == null) {
        // Unknown age + age-bounded range → don't match (defensive: don't apply
        // a pediatric range to a patient whose DOB is missing).
        return false;
      }
      if (rr.ageMinYears != null && yrs < rr.ageMinYears) return false;
      if (rr.ageMaxYears != null && yrs >= rr.ageMaxYears) return false;
    }
    // Method
    if (rr.method) {
      if (!ctx.method || rr.method !== ctx.method) return false;
    }
    // Effective window
    const asOf = ctx.asOf || Date.now();
    if (rr.effectiveFrom != null && asOf < rr.effectiveFrom) return false;
    if (rr.effectiveTo   != null && asOf >= rr.effectiveTo)  return false;
    return true;
  };

  const __specificity = (rr) => {
    let s = 0;
    if (rr.sex && rr.sex !== 'any') s++;
    if (rr.ageMinYears != null || rr.ageMaxYears != null) s++;
    if (rr.method) s++;
    if (rr.effectiveFrom != null || rr.effectiveTo != null) s++;
    return s;
  };

  const pickReferenceRange = (test, ctx = {}) => {
    if (!test) return { low: null, high: null, units: '', source: 'none', matchedRange: null };
    const ranges = Array.isArray(test.referenceRanges) ? test.referenceRanges : [];
    const candidates = ranges
      .filter(rr => rr && (rr.low != null || rr.high != null))
      .filter(rr => __matches(rr, ctx))
      .sort((a, b) => {
        const sa = __specificity(a), sb = __specificity(b);
        if (sa !== sb) return sb - sa;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });

    if (candidates.length > 0) {
      const r = candidates[0];
      return {
        low:  r.low,
        high: r.high,
        units: r.units || test.units || '',
        source: 'matched',
        matchedRange: r,
      };
    }
    if (test.refRangeLow != null || test.refRangeHigh != null) {
      return {
        low:  test.refRangeLow,
        high: test.refRangeHigh,
        units: test.units || '',
        source: 'default',
        matchedRange: null,
      };
    }
    return { low: null, high: null, units: test.units || '', source: 'none', matchedRange: null };
  };

  // Pure helper exposed for the editor to label a range with its filter scope.
  const describeRange = (rr) => {
    if (!rr) return '';
    const parts = [];
    if (rr.sex && rr.sex !== 'any') parts.push(rr.sex);
    if (rr.ageMinYears != null || rr.ageMaxYears != null) {
      const lo = rr.ageMinYears != null ? rr.ageMinYears : '–∞';
      const hi = rr.ageMaxYears != null ? rr.ageMaxYears : '∞';
      parts.push(`${lo}–${hi} yr`);
    }
    if (rr.method) parts.push(rr.method);
    if (rr.effectiveFrom != null || rr.effectiveTo != null) {
      const fmt = (t) => t == null ? '∞' : new Date(t).toISOString().slice(0,10);
      parts.push(`${fmt(rr.effectiveFrom)} → ${fmt(rr.effectiveTo)}`);
    }
    return parts.length === 0 ? 'any patient' : parts.join(' · ');
  };

  window.referenceRanges = {
    pick: pickReferenceRange,
    describe: describeRange,
    ageYears: __ageYears,
  };

})();
