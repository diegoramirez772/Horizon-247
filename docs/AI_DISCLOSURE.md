# Use of AI — disclosure

*Team AETHRA · HORIZON 247 · NASA Space Apps Challenge 2026 · Challenge: "Be an Earth System Trend Detective!"*

## When it was built

HORIZON 247 was built during the hackathon weekend, **Saturday 14 and Sunday 15 November 2026**. The repository history
starts on **14 Nov 2026, 14:17 (UTC−6)** with the empty scaffold; every line of code, data bundle and document in it was
produced after that moment. The history is public evidence of this and is kept intact.

## Where the idea came from

The concept — an "Earth-system trend detective" that answers *what is changing, where, how much, and whether it is
significant*, and says honestly when it **cannot be known yet** — was created by the team through **brainstorming
sessions**, not by an AI tool. The team also decided:

- the three-part architecture (HORI model, ZON runtime, web);
- the scientific choices (which NASA data, what counts as a confirmed change, how uncertainty is shown);
- the product principles (no forecasts, no advice, every value labelled real / estimated / simulated / example);
- the user experience (assistant first, three reading levels, monitoring, 3D views, the swarm of reports);
- the demo case (Durango, Mexico).

## How AI tools were used while building

| Area | AI assistance | Human role |
| --- | --- | --- |
| Software implementation | An AI coding assistant (Anthropic Claude, through Claude Code) helped write and refactor code, tests and integration between parts. | The team specified every feature, reviewed the results, ran the app and decided what was kept or changed. |
| Documentation | Drafting and editing of README and docs. | Content, claims and limits decided and reviewed by the team. |
| Debugging | Help diagnosing errors and verifying fixes. | Final checks by the team. |

Each team member may have used other assistants in their own work; they are listed by the members themselves when
submitting.

## What is NOT AI in the product

- **HORI, the model, is a statistical engine, not generative AI.** It does not write text or invent data; it computes
  evidence from NASA measurements. Its error rates were measured on simulated data before being used on real data.
- **The assistant does not use any language model.** Its sentences are built by rules from HORI's numbers: the same
  question always gives the same answer and every figure can be traced to its source.
- **No data is generated and presented as real.** The generated 3D scenes and the astronaut panel are always labelled
  as generated / simulated.

The only machine-learning model running in the app is Google's open-source MediaPipe hand-landmark detector (Apache-2.0),
used on the user's device — only when they turn camera gestures on — to recognise hand gestures. Images never leave the
device.

## Data

All findings come from NASA data (NASA POWER / MERRA-2, NASA GIBS, NASA EONET) and open scientific datasets credited in
[NOTICE](../NOTICE) and [LICENSE-DATA](../LICENSE-DATA).
