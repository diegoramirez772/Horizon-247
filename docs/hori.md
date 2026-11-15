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

## What it does not do

Forecasts, attribution of causes, alerts about hazards or advice to people.
