.PHONY: test hori-test extract
test: hori-test
hori-test:
	python3 packages/hori/tests/test_independence.py
	-python3 -m pytest packages/hori/tests -q
# make extract PKG=hori  → creates branch export/<pkg> with that package's own history
extract:
	bash scripts/extract_package.sh $(PKG)
