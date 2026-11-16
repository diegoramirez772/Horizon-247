# HORI — the model

HORI is HORIZON 247's statistical engine. It is **not generative AI**: it does not write text or invent data. It reads
measurements and returns evidence.

## What it answers

For each place (a grid cell or a region) and a time series of a variable — temperature, rain, dust on Mars… — HORI
answers:

1. **Is there a real change?** It requires several independent lines of evidence to agree, and it accounts for the fact
   that thousands of places are tested at once.
2. **How big is it?** The change per decade and its range of uncertainty.
3. **Could this record detect it?** The smallest change the record could reveal, and — when the answer is "not yet" — an
   estimate of how many more years of data are needed.
4. **Since when is it known?** The year from which the change could already be stated.

## What it returns

For every place: a **verdict** (change detected · possible change · not knowable yet · no large change · not enough data),
the size of the change, its range, quality flags (short record, coarse resolution, gaps…) and the provenance needed to
reproduce it.

## Properties

- Deterministic: the same input gives the same output.
- Independent: HORI knows nothing about files, maps, servers or the web; it only exchanges data with ZON.
- Light: it runs on a laptop; the whole planet takes minutes.
- Calibrated: its error rates were measured on simulated data before being trusted on real data.

## HORI 1.2 — a second, independent check before saying «detected»

Up to 1.0 a change was «detected» when three different tests agreed and the claim survived the usual check over the
whole map. That check assumes neighbouring places behave in a friendly way, and the tests assume noise that forgets
fast. Climate also wanders slowly, and a slow wander looks like a trend.

HORI 1.2 asks for one more thing: the change must also be found by **e-BH** (Wang & Ramdas 2022), a check built on
e-values whose error guarantee holds under any dependence between places and between tests. Mann–Kendall is also
corrected for repeated values (snow, ice, dry months), and the «how many more years» table is measured again for the
new rule, up to 45 years.

Measured on the planet's own noise — NASA POWER air temperature 1981–2025 with the trend destroyed and a known one
injected, 52,128 cells, the same 12 realizations for every row (`sim/null_planet.py`, `sim/results_null_planet_*`):

| Share of «detected» that is false (target: 10 %) | Slow wander removed | Slow wander kept |
| --- | --- | --- |
| Plain regression, no check over the map (false marks per cell) | 9 % | 38 % |
| HORI 1.0 | 5.6 % | 23.1 % |
| **HORI 1.2** | **1.0 %** | **6.9 %** |

- It costs sensitivity: real changes of the size of interest found, 72 % → 59 % and 62 % → 51 %. What 1.2 no longer
  calls «detected» stays visible as «possible change».
- Where HORI says a change of that size «would already be visible», it was found 93 % and 91 % of the time (the promise is 80 %).
- The range of the change is honest in both cases: it contains the true value 90 % to 99.7 % of the time (1.0: 78 % to 95 %).
  It is 30–50 % wider (`sim/ci_coverage_v12.py`).
- A sudden 3-sigma jump read as a trend: 54 % → 10 % of the cells of a test map; a random walk: 12 % → 6 %.
- Limits: one variable, one period, 12 realizations; a single map can be worse than the average (worst: 23 %). The
  truth lies between the two columns; neither is the real planet.

`Config(require_ebh=False, ci_hurst=None)` reproduces 1.0 exactly.

## HORI 1.3 — significant regions

A second kind of answer, next to the verdict of each place: **which regions, as a whole, are changing**
(`significant_regions`, `hori/clusters.py`). Neighbouring places that move together in the same direction are tested
as one region against the largest region that this map's own noise produces (cluster-mass test with same-phase
surrogates). The error is controlled over the whole map: the chance of any false region is 5 %.

Measured on the planet's own noise (13,104 cells, 12 maps per noise model, `sim/results_cluster_search_v13_*`):
175 regions declared, **none** without real change inside. It is a statement about the region, not about each
place in it: 1 % to 9 % of the cells inside a region had no change, and a region covers fewer places than the
per-place verdict (47 % and 18 % of the places with real change, against 54 % and 41 %). The per-place verdict of
1.2 is unchanged; a region does not turn a «possible change» into «detected».

## What it does not do

Forecasts, attribution of causes, alerts about hazards or advice to people.
