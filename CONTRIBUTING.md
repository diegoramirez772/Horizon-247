# Contributing

**External contributions are not accepted during the hackathon.** The project is private, and
the team intends to open it after the event.

## Team workflow (para el equipo)
* One branch per person: `diego/hori-zon`, `william/web`, `estela/diseno-marca`, `carolina/contexto-negocio`.
* Work only in your own folders (table below). Merge to `main` through a pull request reviewed by Diego.
* The contract (`contract/`) changes **only additively**, and the author tells the others.
* No secrets in the repo (Earthdata credentials go in environment variables or `~/.netrc`).
* Data and simulated data are always labeled.

| Area | Owner | Folders |
|---|---|---|
| Model + runtime + integration | Diego | `packages/hori`, `packages/zon`, `contract`, `sim` |
| Web | William | `apps/web` |
| Design, brand, pitch | Estela | `design`, `brand`, `pitch` |
| Context, business, content | Carolina | `content` |

Estela and Carolina work in a shared Drive folder; Diego or William commit their files here.
