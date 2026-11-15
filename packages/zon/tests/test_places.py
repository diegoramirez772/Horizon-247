"""Z8: shapefile reader, polygon -> cells (holes, tiny places), cos(lat)-weighted regional series, name search."""
import shutil
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np

from zon.places import Place, PlaceIndex, cell_mask, norm, points_in_rings, read_dbf, read_shp, regional_series

SQUARE = np.array([[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], float)          # lon, lat (clockwise, as in ESRI)
HOLE = np.array([[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]], float)


def write_shapefile(base: Path, polys, rows):
    """Test-only ESRI writer: Polygon records + a UTF-8 dbf with character fields."""
    recs = bytearray()
    for k, rings in enumerate(polys, 1):
        pts = np.concatenate(rings)
        parts = np.cumsum([0] + [len(r) for r in rings[:-1]])
        content = struct.pack("<i4d2i", 5, pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max(),
                              len(rings), len(pts)) + struct.pack(f"<{len(rings)}i", *parts) + pts.astype("<f8").tobytes()
        recs += struct.pack(">2i", k, len(content) // 2) + content
    head = struct.pack(">7i", 9994, 0, 0, 0, 0, 0, (100 + len(recs)) // 2) + struct.pack("<2i4d4d", 1000, 5, 0, 0, 0, 0, 0, 0, 0, 0)
    base.with_suffix(".shp").write_bytes(head + recs)
    names = list(rows[0])
    width = 40
    hlen = 32 + 32 * len(names) + 1
    hdr = struct.pack("<4BIHH20x", 3, 126, 1, 1, len(rows), hlen, 1 + width * len(names))
    for n in names:
        hdr += n.encode().ljust(11, b"\0") + b"C" + b"\0" * 4 + bytes([width, 0]) + b"\0" * 14
    body = b"".join(b" " + b"".join(r[n].encode().ljust(width) for n in names) for r in rows)
    base.with_suffix(".dbf").write_bytes(hdr + b"\x0d" + body + b"\x1a")


class TestGeometry(unittest.TestCase):
    def test_point_in_polygon_with_hole(self):
        lon = np.array([5.0, 2.0, 11.0, 9.9, 5.0])
        lat = np.array([5.0, 2.0, 5.0, 9.9, 3.0])
        self.assertEqual(points_in_rings([SQUARE, HOLE], lon, lat).tolist(), [False, True, False, True, True])

    def test_cell_mask_and_tiny_place(self):
        lat, lon = np.arange(-1.0, 12.0, 1.0), np.arange(-1.0, 12.0, 1.0)
        m, notes = cell_mask([SQUARE], lat, lon)
        inner = (lat[:, None] > 0) & (lat[:, None] < 10) & (lon[None, :] > 0) & (lon[None, :] < 10)
        outer = (lat[:, None] < 0) | (lat[:, None] > 10) | (lon[None, :] < 0) | (lon[None, :] > 10)
        self.assertTrue(m[inner].all() and not m[outer].any())        # centers on the border may go either way
        self.assertTrue(m[np.searchsorted(lat, 5.0), np.searchsorted(lon, 5.0)] and not notes)
        tiny = np.array([[3.2, 3.2], [3.2, 3.4], [3.4, 3.4], [3.4, 3.2], [3.2, 3.2]])
        m2, notes2 = cell_mask([tiny], lat, lon)
        self.assertEqual((int(m2.sum()), notes2), (1, ["menor_que_una_celda"]))

    def test_regional_series_is_area_weighted(self):
        lat = np.array([0.0, 60.0])                                       # cos = 1 and 0.5
        mask = np.ones((2, 1), bool)
        v = np.zeros((3, 2, 1)); v[:, 0, 0], v[:, 1, 0] = 1.0, 4.0
        s, info = regional_series(v, lat, mask)
        self.assertTrue(np.allclose(s, (1 * 1 + 4 * 0.5) / 1.5))         # not the plain mean 2.5
        v[1, 0, 0] = np.nan                                               # 2/3 of the weight missing -> NaN
        s2, _ = regional_series(v, lat, mask)
        self.assertTrue(np.isnan(s2[1]) and np.isfinite(s2[0]))
        self.assertEqual(info["n_cells"], 2)


class TestShapefileAndSearch(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_roundtrip_and_search(self):
        base = self.tmp / "admin1"
        write_shapefile(base, [[SQUARE, HOLE], [SQUARE + 20]],
                        [{"name": "Durango", "name_en": "Durango", "name_es": "Durango", "admin": "Mexico", "iso_3166_2": "MX-DUR"},
                         {"name": "Chihuahua", "name_en": "Chihuahua", "name_es": "Chihuahua", "admin": "Mexico", "iso_3166_2": "MX-CHH"}])
        geoms, rows = read_shp(base.with_suffix(".shp")), read_dbf(base.with_suffix(".dbf"))
        self.assertEqual(len(geoms[0]), 2)
        self.assertTrue(np.array_equal(geoms[1][0], SQUARE + 20))
        self.assertEqual(rows[1]["name"], "Chihuahua")
        cities = self.tmp / "cities.tsv"
        cities.write_text("\t".join(["1", "Durango", "Durango", "", "24.02", "-104.65", "P", "PPLA", "MX", "", "", "", "", "",
                                     "654876"]) + "\n", encoding="utf-8")
        idx = PlaceIndex.from_natural_earth(admin1_shp=base.with_suffix(".shp"), cities_tsv=cities)
        hits = idx.search("durango")
        self.assertEqual([h.kind for h in hits], ["admin1", "city"])       # the state wins, the city stays as an option
        self.assertEqual(idx.search("CHIHUÁHUA")[0].name["en"], "Chihuahua")
        self.assertEqual(idx.search("chih")[0].name["en"], "Chihuahua")    # prefix
        self.assertEqual(idx.search("atlantis"), [])
        ep = hits[0].to_entity_place()
        self.assertEqual(ep["relations"][0]["target"], "earth-mexico")
        self.assertEqual(norm("  São Paulo! "), "sao paulo")


if __name__ == "__main__":
    unittest.main()
