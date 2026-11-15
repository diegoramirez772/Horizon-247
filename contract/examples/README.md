Example bundles (real NASA POWER data for the approximate Durango box unless labeled `simulated`).
A bundle is: `manifest.json` + binary arrays (see ../SPEC.md sections 1–2 and 10). Layout mirrors `bundles/`:
`index.json` + `earth/<bundle>/`.

Regenerate (offline, from the local cache; byte-identical thanks to SOURCE_DATE_EPOCH):
```bash
export PYTHONPATH=packages/zon/src:packages/hori/src SOURCE_DATE_EPOCH=1794700000
python3 -m zon build mx-dgo.t2m.power --out data --offline
python3 -m zon build mx-dgo.prectotcorr.power --out data --offline
cp -r data/bundles/index.json data/bundles/earth contract/examples/
```
Any change in `verdict.u8` must be explained in the commit message (golden bundles).
