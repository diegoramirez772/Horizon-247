.PHONY: test hori-test zon-test bundles extract
test: hori-test zon-test
hori-test:
	python3 packages/hori/tests/test_independence.py
	-python3 -m pytest packages/hori/tests -q
# make extract PKG=hori  → creates branch export/<pkg> with that package's own history
extract:
	bash scripts/extract_package.sh $(PKG)
zon-test:
	cd packages/zon && python3 -m pytest tests -q
# real NASA layers for the web (downloads GISTEMP once; see packages/zon/README.md)
bundles:
	cd packages/zon && PYTHONPATH=src:../hori/src python3 -m zon build temp_gistemp_2001-2024 temp_gistemp_1980-2024 precip_gpcp_2001-2024 precip_gpcp_1980-2024
