<div align="center">

# HORIZON 247

**Universal Monitoring & Entity Intelligence**

*Identify. Observe. Detect.*

### From Earth observations to evidence of change.

Built by **AETHRA** for NASA Space Apps Challenge 2026

Challenge: *Be an Earth System Trend Detective!*

[What you can do](#what-you-can-do-in-the-web) · [Real-data example](#a-real-data-example) · [Quick start](#quick-start) · [Architecture](#architecture) · [Scientific evidence](#evidence-and-limitations) · [Contribute](#license-and-contributing)

</div>

---

**HORIZON 247 analyzes Earth observation records to identify trends, quantify their magnitude, and explain when the available evidence is still inconclusive.**

For every location and time window, it asks three questions:

1. **Is there evidence of a trend?** Compare multiple statistical methods and account for testing many locations.
2. **How much is changing?** Report an estimated effect, uncertainty, and the quality of the underlying record.
3. **Could this record detect the change we care about?** Make sensitivity explicit, including an estimate of how much longer the observation record would need to be.

The result is a portable evidence bundle: numerical findings, quality flags, and provenance that can be inspected independently of the interface.

> **Source-available, non-commercial.** Read it, run it for non-commercial purposes and contribute to it; monetizing it or republishing copies is not allowed ([LICENSE](LICENSE)). Contributions are welcome ([CONTRIBUTING.md](CONTRIBUTING.md)).

## What you can do in the web

| | |
| --- | --- |
| **Ask the assistant** | Natural-language answers **without an LLM**: a deterministic generator turns HORI's numbers into sentences («la temperatura sube medio grado cada diez años, unas dos veces más rápido que el planeta»). Three reading levels (Simple · Normal · Experto) chosen inside the question box; follow-ups keep the context («¿y en Chihuahua?», «¿y la lluvia?»). |
| **Generated components** | The answer brings what its topic needs: latest NASA POWER conditions, livestock heat stress (THI), NASA EONET events, Mars dust from HORI, planets, simulated astronaut vitals (always labelled), trend charts with HORI's line and interval. |
| **Monitoring** | 3D globe or flat map of HORI's verdicts; NASA imagery under the data (Blue Marble, **live infrared every 10 minutes** from GOES-East/West and Himawari, daily layers) with a sharper patch as you zoom; «La evolución de la Tierra» plays 1981→2025. |
| **3D scenes** | A diorama of any place generated from **real NASA POWER data**, with a timeline by day (POWER) or by year (HORI's series); open it from a zone on the map, from the assistant («Durango en 3D con línea de tiempo») or for Mars and the Moon. Generated, never presented as a photo. |
| **Swarm (red enjambre)** | Signed-in people send reports («el arroyo se secó») to a separate public team in the database; they stay *unverified* until a reviewer decides. |
| **Voice, gestures, keys** | Microphone, hands-free, numbered targets, camera gestures (pinch, palm, thumbs up, fist), gamepad and keyboard. |
| **PWA** | Installable; works offline with what you already saw. |

## Start here

| Your goal | Best starting point |
| --- | --- |
| Understand the project | Read the [real-data example](#a-real-data-example) below. |
| Try the analysis | Run the [offline quick start](#quick-start) using a committed NASA POWER cube. |
| Evaluate the science | Review the [model card](docs/MODEL_CARD.md), [method specification](packages/hori/docs/SPEC.md), and [calibration studies](sim/). |
| Build an integration | Inspect the [public Python API](packages/hori/src/hori/api.py) and [data contracts](contract/). |

## What HORIZON 247 delivers

For a variable, location, and observation window, the analysis produces:

- **Magnitude and uncertainty** — an estimated trend per decade and its interval.
- **Evidence across methods** — agreement among three trend tests and a multiple-testing adjustment across the analysis family.
- **Detectability** — the minimum detectable effect, an explicit effect-of-interest threshold, and an estimate of additional observation years when the record is inconclusive.
- **Quality context** — flags for conditions such as incomplete coverage, high autocorrelation, coarse resolution, reconstruction, and possible structural breaks.
- **Traceability** — source metadata, configuration, hashes, and build information carried with the result.

## A real-data example

The committed examples analyze **NASA POWER / MERRA-2** records over an approximate Durango bounding box: **72 grid cells, 24 years, 2001–2024**. Temperature and precipitation produce different evidence profiles under the same decision framework.

| Finding | Air temperature (`T2M`) | Precipitation (`PRECTOTCORR`) |
| --- | ---: | ---: |
| Supported trend | 66 cells | 2 cells |
| Candidate | 1 cell | 23 cells |
| Inconclusive | 5 cells | 47 cells |
| No detectable change at the chosen threshold | 0 cells | 0 cells |
| Insufficient data | 0 cells | 0 cells |

Counts come directly from the committed [temperature manifest](contract/examples/earth/power_t2m_dgo_2001-2024/manifest.json) and [precipitation manifest](contract/examples/earth/power_prectotcorr_dgo_2001-2024/manifest.json). The effect-of-interest thresholds are **0.3 °C/decade** and **0.2 (mm/day)/decade**, respectively.

For precipitation, 47 cells remain inconclusive: the record cannot yet resolve the chosen effect threshold under the model. That uncertainty is an explicit result. Cell counts describe this analysis window and bounding box; they are not a region-wide verdict or a count of independent observations.

The [input cubes and output arrays](contract/examples/) are included for inspection and regression testing. These examples use real data; synthetic calibration experiments are kept separately in [`sim/`](sim/).

## Reading a result

The verdict travels with the effect size, sensitivity, and quality flags. These five states keep a supported trend, an unresolved signal, and an inadequate record distinguishable.

<details>
<summary><strong>Verdict definitions and contract codes</strong></summary>


| State | What it means |
| --- | --- |
| **Supported trend** (`PROBADO`) | All configured voting methods are significant and the consensus survives the multiple-testing correction. |
| **Candidate** (`CANDIDATA`) | At least one method is significant, but the full decision rule is not satisfied. |
| **Inconclusive** (`NO_CONCLUYENTE`) | No method is significant, and the record is not sensitive enough to assess the chosen effect threshold. |
| **No detectable change at the chosen threshold** (`SIN_CAMBIO_MAYOR_QUE_DELTA`) | No method is significant, and modeled sensitivity reaches the chosen threshold. This is conditional on the noise model. |
| **Insufficient data** (`INSUFICIENTE`) | The record does not meet the analysis requirements. |

A trend finding describes statistical evidence under the method's assumptions. The estimated extra years describe detectability under those assumptions; they are not a forecast of future observations. See the [bundle contract](contract/SPEC.md) for exact codes, flags, and presentation rules.

</details>

## Architecture

Three independently structured components communicate through explicit data contracts.

```mermaid
flowchart LR
    S[Observation sources] --> Z[ZON · Data runtime]
    Z -->|Cube| H[HORI · Statistical engine]
    H -->|Analysis result| Z
    Z -->|Static bundle| W[Web · Presentation]
    Z -->|Light rows| D[(Supabase · catalog, runs, findings, monitors, reports)]
    D -->|RLS · publishable key| W
    N[NASA POWER · GIBS · EONET] -->|live, in the browser| W
```

| Component | Responsibility | Boundary |
| --- | --- | --- |
| **[ZON](packages/zon/)** | Fetch, cache, normalize, preserve provenance, orchestrate analysis, and assemble bundles. | Calls HORI through its public `hori.api` interface. |
| **[HORI](packages/hori/)** | Estimate trends, combine evidence, assess detectability, and assign verdicts. | Depends on NumPy; imports neither ZON nor the web. |
| **[Web](apps/web/)** | Assistant, monitoring (globe/map), 3D scenes, swarm reports, PWA. | Next.js static export; reads bundles as files, live NASA services from the browser, the database only through RLS. |
| **[Database](supabase/)** | Catalog, analysis runs, selected findings, monitors, context cards, swarm reports, feedback. | Supabase (free tier): only light rows; arrays stay in files. `python -m zon db-push` fills it idempotently. |
| **[Contract](contract/)** | Define the cube input, bundle output, and shared TypeScript types. | Keeps data acquisition, inference, and presentation separable. |

A bundle contains a JSON manifest and typed binary arrays. Analysis runs in Python; the intended browser interface consumes the resulting files. Each Python package has its own packaging and tests. See [modularity rules](docs/MODULARITY.md).

## The method, at a glance

HORI is a **non-generative statistical engine**. Its findings come from numerical analysis, with NumPy as its only third-party runtime dependency.

1. **Prepare the record.** Aggregate monthly observations into annual series, subject to coverage and gap rules.
2. **Estimate the trend.** Compute a Sen slope and evaluate three methods: variance-corrected Mann–Kendall, trend-free prewhitening with the Wang–Swail procedure, and OLS with AR(1)-adjusted variance.
3. **Require agreement.** Form consensus evidence from the tests and apply Benjamini–Hochberg correction across the analysis family.
4. **Assess sensitivity.** Compare the minimum detectable effect with the configured effect of interest.
5. **Package the finding.** Emit verdicts, uncertainty, quality flags, and provenance together.

The code also includes parallel e-value evidence, multi-source comparison, and retrospective timeline analysis. These extensions have their own assumptions and validation status; e-value results do not replace the primary Benjamini–Hochberg verdict.

Read the [method specification](packages/hori/docs/SPEC.md) and [model card](docs/MODEL_CARD.md) for parameters, measured calibration, and limitations.

## Quick start

Run the commands below from the repository root unless a step changes directories. Python packages require **Python 3.10+**.

### 1. Set up the Python pipeline

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e ./packages/hori -e ./packages/zon
```

### 2. Analyze a real-data example offline

This uses a committed NASA POWER temperature cube. It requires no download or NASA credentials and writes a fresh bundle under `data/`.

```bash
python - <<'PY'
from hori.api import Cube, run_layer, write_bundle

cube = Cube.from_npz(
    "contract/examples/cubes/power_T2M_monthly_2001-2024.npz"
)
result = run_layer(cube, profile="auto")
output = write_bundle(result, "data/bundles/earth/durango_temperature")

print("Bundle:", output)
print("Summary:", result.manifest["summary"])
PY
```

**Expected core summary for the temperature example:** 66 supported trends, 1 candidate, and 5 inconclusive cells, out of 72 valid cells. Additional diagnostic fields may appear as the engine evolves.

The output directory contains the evidence needed to inspect the result:

```text
durango_temperature/
├── manifest.json         Source, parameters, verdict counts, and array metadata
├── effect.f32            Estimated change per decade
├── ci_lo.f32 / ci_hi.f32 Interval bounds
├── verdict.u8            Per-cell decision codes
├── flags.u8              Per-cell quality flags
├── mde.f32               Minimum detectable effect
└── …                     Further diagnostics and annual series
```

See the [bundle specification](contract/SPEC.md) for all fields, binary encoding, and cell order. The [committed reference bundles](contract/examples/) provide outputs used by regression tests.

<details>
<summary><strong>Optional: build a fresh bundle from NASA POWER</strong></summary>

### Build from NASA POWER

This optional step uses the network. The bounding-box order is **south, west, north, east**; the box below approximates Durango and is not an administrative polygon.

```bash
python -m zon build-power \
  --bbox 22.3 -107.2 26.8 -102.5 \
  --param T2M --start 2001 --end 2024 \
  --region durango --out data
```

ZON caches requests and writes cubes and bundles beneath the output directory. Add `--offline` to reuse a populated cache without network access. Run `python -m zon --help` for the current CLI.

</details>

<details>
<summary><strong>Optional: run the web scaffold</strong></summary>

### Start the web scaffold

```bash
cd apps/web
npm install
npm run dev
```

Open `http://localhost:3000`. Copy `apps/web/.env.example` to `apps/web/.env.local` to connect the database (publishable key only); without it the web still works from the bundles and live NASA services. The static build uses `npm run build` and writes to `out/`. See the [web guide](apps/web/README.md) for contract synchronization and frontend conventions.

</details>

## Evidence and limitations

The repository contains synthetic calibration studies, adversarial cases, package-boundary checks, and real-data regression fixtures. The [model card](docs/MODEL_CARD.md) records measured results and the conditions under which they were obtained.

The current evidence has practical limits:

- **Noise assumptions matter.** Calibration centers on Gaussian AR(1) processes. Long-memory behavior can undermine the primary trend decision; sensitivity analysis does not establish universal calibration.
- **A step can resemble a trend.** Large artificial discontinuities can trigger a finding. Structural-break flags catch only some of these cases.
- **Multiple-testing control is conditional.** The configured false discovery rate is a target under statistical assumptions, not a guaranteed error rate for every real-world field.
- **Source and scale matter.** The model card documents regional differences between POWER/MERRA-2 and GISTEMP, including an Arctic discrepancy. Native resolution and reconstruction affect interpretation.
- **Effect thresholds require judgment.** Physical-class thresholds are working choices by the team. They are not universal definitions of meaningful change.

The implemented trend method targets monotonic change. Forecasting, causal attribution, hazard alerts, and individual advice are outside its intended scope. For implementation details, start with the [current public API](packages/hori/src/hori/api.py), tests, contract, and model card.

## Development and verification

From the repository root, with the Python environment activated:

```bash
python -m pip install -e './packages/hori[dev]' -e './packages/zon[dev]'
python packages/hori/tests/test_independence.py
python -m pytest packages/hori/tests packages/zon/tests -q
```

The golden tests compare generated binary arrays against the committed real-data examples. Controlled build timestamps are supported through `SOURCE_DATE_EPOCH`; reproducible artifacts also require matching inputs, configuration, and software versions.

## Repository guide

| Path | Contents |
| --- | --- |
| [`packages/hori/`](packages/hori/) | Statistical engine, public API, method specification, and tests. |
| [`packages/zon/`](packages/zon/) | Data connectors, cache, cube handling, orchestration, and CLI. |
| [`contract/`](contract/) | [Cube specification](contract/CUBE.md), [bundle specification](contract/SPEC.md), [TypeScript types](contract/types.ts), and real-data examples. |
| [`apps/web/`](apps/web/) | Next.js application scaffold and frontend toolchain. |
| [`sim/`](sim/) | Calibration, diagnostic, and validation experiments. |
| [`docs/`](docs/) | Model card and architecture documentation. |
| [`content/`](content/) · [`design/`](design/) · [`brand/`](brand/) · [`pitch/`](pitch/) | Project narrative, design, identity, and presentation materials. |
| `data/` | Local downloads, caches, and generated artifacts; generally excluded from version control. |

## Data, attribution, and license

Real observations, analyses, reconstructions, and simulations must remain distinguishable. Findings carry their source context; simulated studies are labeled as simulations. Dataset attribution and reuse terms travel with the data and are separate from the source-code license — see [LICENSE-DATA](LICENSE-DATA) and [NOTICE](NOTICE).

## License and contributing

HORIZON 247 is built by **team AETHRA** ([AUTHORS](AUTHORS)) and released under the **[HORIZON 247 Source-Available License, No Commercial Use](LICENSE)**:

| Allowed | Not allowed (without written permission) |
| --- | --- |
| Read, study and cite the code | Selling it, or offering it as a paid or ad-supported service |
| Run it for personal, educational, research or evaluation use | Republishing or re-hosting copies or derived projects |
| Fork it **to send contributions** back to this repository | Using the names or logos for other projects |

This is *source-available*, not OSI open source. **Contributions are welcome**: read [CONTRIBUTING.md](CONTRIBUTING.md), sign off your commits (`git commit -s`) and open a pull request.
