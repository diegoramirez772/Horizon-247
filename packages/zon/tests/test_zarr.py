"""Z0: stdlib Zarr/Blosc decoding and the POWER store reader, offline (a fake store pre-seeded in the cache)."""
import json
import math
import shutil
import struct
import tempfile
import unittest
import zlib

import numpy as np

from zon.codecs import CorruptChunk, UnsupportedCodec, blosc_decode, decode_chunk, lz4_block_decode

try:
    from compression import zstd
except ImportError:                                                  # pragma: no cover
    zstd = None


def lz4_literals(data: bytes) -> bytes:
    """A valid LZ4 block made only of literals (enough to exercise the decoder's literal path)."""
    n = len(data)
    if n < 15:
        return bytes([n << 4]) + data
    rest, ext = n - 15, bytearray()
    while rest >= 255:
        ext.append(255)
        rest -= 255
    ext.append(rest)
    return bytes([0xF0]) + bytes(ext) + data


def blosc_encode(data: bytes, typesize: int, cname: str = "zstd", shuffle: bool = True, blocksize: int = 4096,
                 dont_split: bool = False) -> bytes:
    """Test-only Blosc1 writer (mirrors c-blosc 1.x layout) so the decoder can be checked by round trip."""
    comp = {"zstd": (4, lambda b: zstd.compress(b)), "zlib": (3, zlib.compress), "lz4": (1, lz4_literals)}[cname]
    flags = (comp[0] << 5) | (0x01 if shuffle else 0) | (0x10 if dont_split else 0)
    nbytes = len(data)
    nblocks = -(-nbytes // blocksize)
    body, starts = bytearray(), []
    head = 16 + 4 * nblocks
    for b in range(nblocks):
        blk = data[b * blocksize:(b + 1) * blocksize]
        bsize = len(blk)
        if shuffle and typesize > 1:
            m = bsize // typesize
            blk = np.frombuffer(blk[:m * typesize], np.uint8).reshape(m, typesize).T.tobytes() + blk[m * typesize:]
        split = not dont_split and typesize <= 16 and bsize // typesize >= 128 and bsize % typesize == 0
        ns = typesize if split else 1
        neb = bsize // ns
        starts.append(head + len(body))
        for k in range(ns):
            part = blk[k * neb:(k + 1) * neb]
            c = comp[1](part)
            if len(c) >= neb:                                         # incompressible: stored raw
                c = part
            body += struct.pack("<i", len(c)) + c
    total = head + len(body)
    return bytes([2, 1, flags, typesize]) + struct.pack("<III", nbytes, blocksize, total) + \
        struct.pack(f"<{nblocks}i", *starts) + bytes(body)


@unittest.skipIf(zstd is None, "needs Python 3.14 compression.zstd")
class TestCodecs(unittest.TestCase):
    def test_lz4_literals_and_overlapping_match(self):
        self.assertEqual(lz4_block_decode(lz4_literals(b"hello world, hello!"), 19), b"hello world, hello!")
        # token: 1 literal 'a', then match offset 1 length 4+6=10 -> 'a' * 11; final sequence: 2 literals 'bc'
        blk = bytes([0x16]) + b"a" + struct.pack("<H", 1) + bytes([0x20]) + b"bc"
        self.assertEqual(lz4_block_decode(blk, 13), b"a" * 11 + b"bc")
        with self.assertRaises(CorruptChunk):
            lz4_block_decode(blk, 14)

    def test_blosc_round_trips(self):
        rng = np.random.default_rng(0)
        data = (np.round(rng.normal(20, 5, 5000), 2)).astype("<f4").tobytes() + b"xyz"   # odd tail, many blocks
        for cname in ("zstd", "zlib", "lz4"):
            for shuffle in (True, False):
                for dont_split in (True, False):
                    enc = blosc_encode(data, 4, cname, shuffle, 4096, dont_split)
                    self.assertEqual(blosc_decode(enc), data, (cname, shuffle, dont_split))

    def test_unsupported_and_corrupt_frames_fail_loudly(self):
        enc = bytearray(blosc_encode(b"\0" * 4096, 4))
        bad = bytearray(enc); bad[2] |= 0x04                          # bitshuffle
        with self.assertRaises(UnsupportedCodec):
            blosc_decode(bytes(bad))
        bad = bytearray(enc); bad[2] = (bad[2] & 0x1F) | (2 << 5)     # snappy
        with self.assertRaises(UnsupportedCodec):
            blosc_decode(bytes(bad))
        with self.assertRaises(CorruptChunk):
            blosc_decode(bytes(enc[:-3]))                             # truncated
        with self.assertRaises(UnsupportedCodec):
            decode_chunk(bytes(enc), {"compressor": {"id": "zfp"}, "dtype": "<f4", "chunks": [1024]})

    def test_fixedscaleoffset_is_exact_to_the_hundredth(self):
        x = np.array([6.03, -40.17, 0.15, 35.36, np.nan], dtype="<f4")
        raw = np.round((x.astype(np.float64) - 1000) * 100).astype("<f4")
        za = {"compressor": {"id": "blosc"}, "dtype": "<f4", "chunks": [5], "order": "C",
              "filters": [{"id": "fixedscaleoffset", "scale": 100, "offset": 1000, "dtype": "<f4", "astype": "<f4"}]}
        out = decode_chunk(blosc_encode(raw.tobytes(), 4, blocksize=64), za)
        self.assertTrue(np.array_equal(out[:4], x[:4]))               # bit-identical to float32(6.03), not 6.0300293
        self.assertTrue(np.isnan(out[4]))


def make_store(root, months=24, valid_months=20, chunk=4, ny=9, nx=10):
    """A tiny POWER-like Zarr store (lat -2..2 by 0.5, lon 0..5.625 by 0.625) seeded straight into the cache."""
    from zon.cache import ContentCache
    from zon.fetch.power_zarr import BUCKET_URL, SOURCE, STORE
    cache = ContentCache(root)
    url = f"{BUCKET_URL}/{STORE}"
    lat = -2.0 + 0.5 * np.arange(ny)
    lon = 0.625 * np.arange(nx)
    days = np.array([(np.datetime64(f"{1981 + k // 12}-{k % 12 + 1:02d}-15") - np.datetime64("1981-01-31")).astype(int)
                     for k in range(months)], dtype="<i8")
    t = np.arange(months)
    truth = (10 + 0.01 * t[:, None, None] + 0.1 * lat[None, :, None] + 0.01 * lon[None, None, :]).astype("<f8")
    truth = np.round(truth, 2)
    truth[valid_months:] = np.nan
    fso = [{"id": "fixedscaleoffset", "scale": 100, "offset": 1000, "dtype": "<f4", "astype": "<f4"}]
    blosc = {"id": "blosc", "cname": "zstd", "clevel": 3, "shuffle": 1, "blocksize": 0}
    coord = lambda n, dt_: {"shape": [n], "chunks": [n], "dtype": dt_, "fill_value": None, "order": "C", "filters": None,
                            "compressor": {**blosc, "cname": "lz4"}, "zarr_format": 2}
    meta = {"metadata": {
        ".zattrs": {"comment": "fake store"},
        "T2M/.zarray": {"shape": [months, ny, nx], "chunks": [months, chunk, chunk], "dtype": "<f4", "fill_value": "NaN",
                        "order": "C", "filters": fso, "compressor": blosc, "zarr_format": 2},
        "T2M/.zattrs": {"units": "C", "long_name": "Temperature at 2 Meters", "valid_min": -125.0, "valid_max": 80.0},
        "time/.zarray": coord(months, "<i8"), "time/.zattrs": {"units": "days since 1981-01-31 00:00:00"},
        "lat/.zarray": coord(ny, "<f8"), "lon/.zarray": coord(nx, "<f8")}}
    cache.put(SOURCE, f"{url}/.zmetadata", json.dumps(meta).encode())
    for name, arr in (("time", days), ("lat", lat.astype("<f8")), ("lon", lon.astype("<f8"))):
        cache.put(SOURCE, f"{url}/{name}/0", blosc_encode(arr.tobytes(), 8, "lz4", blocksize=1 << 16))
    raw = np.round((truth - 1000) * 100)
    for r in range(math.ceil(ny / chunk)):
        for c in range(math.ceil(nx / chunk)):
            blk = np.full((months, chunk, chunk), np.nan)
            part = raw[:, r * chunk:(r + 1) * chunk, c * chunk:(c + 1) * chunk]
            blk[:, :part.shape[1], :part.shape[2]] = part                 # edge chunks are padded, as in Zarr
            cache.put(SOURCE, f"{url}/T2M/0.{r}.{c}", blosc_encode(blk.astype("<f4").tobytes(), 4, blocksize=256))
    return truth.astype("<f4"), lat, lon


@unittest.skipIf(zstd is None, "needs Python 3.14 compression.zstd")
class TestPowerZarr(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.truth, self.lat, self.lon = make_store(self.tmp)
        from zon.fetch.power_zarr import PowerZarr
        self.z = PowerZarr(self.tmp, offline=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_axes_come_from_the_store(self):
        months, lat, lon = self.z.axes
        self.assertEqual((months[0], months[-1], len(months)), ("1981-01", "1982-12", 24))
        self.assertTrue(np.allclose(lat, self.lat) and np.allclose(lon, self.lon))
        self.assertEqual(self.z.n_chunks("T2M"), (3, 3))

    def test_edge_block_is_trimmed_to_grid_and_valid_months(self):
        b = self.z.read_block("T2M", 2, 2)                            # last row/col: 1 x 2 real cells
        self.assertEqual(b.values.shape, (20, 1, 2))
        self.assertEqual(b.months[-1], "1982-08")
        self.assertTrue(np.array_equal(b.values, self.truth[:20, 8:9, 8:10]))
        self.assertEqual(self.z.latest_month("T2M", probe=(0.0, 1.0)), "1982-08")

    def test_region_cube_spans_chunks_flips_lat_and_matches_truth(self):
        c = self.z.region_cube("T2M", (-1.0, 1.0, 1.5, 4.0), 1981, 1982)   # crosses chunk rows and columns
        self.assertTrue(np.all(np.diff(c.lat) < 0) and np.all(np.diff(c.lon) > 0))   # north -> south, west -> east
        iy = [int(np.argmin(abs(self.lat - v))) for v in c.lat]
        ix = [int(np.argmin(abs(self.lon - v))) for v in c.lon]
        self.assertTrue(np.array_equal(c.values[:20], self.truth[:20][:, iy][:, :, ix]))
        self.assertTrue(np.isnan(c.values[20:]).all())                 # future months stay missing, never invented
        self.assertGreater(len(c.meta["chunks"]), 1)
        self.assertEqual((c.meta["variable"]["unit"], c.meta["dataset"]["time_standard"]), ("C", "LST"))

    def test_unknown_variable_and_offline_miss_fail_clearly(self):
        from zon.cache import CacheMiss
        from zon.fetch.power_zarr import ZarrError
        with self.assertRaises(ZarrError):
            self.z.zarray("NOPE")
        with self.assertRaises(CacheMiss):
            self.z.read_block("T2M", 5, 5)

    def test_cube_runs_through_hori(self):
        try:
            from hori.api import Cube, run_layer
        except ImportError:
            self.skipTest("hori not on PYTHONPATH")
        c = self.z.region_cube("T2M", (-2.0, 0.0, 2.0, 5.625), 1981, 1982)
        res = run_layer(Cube(c.values, c.valid, np.array(c.time), c.lat, c.lon, c.meta))
        self.assertEqual(res.manifest["entity"]["count"], 90)


if __name__ == "__main__":
    unittest.main()


@unittest.skipIf(zstd is None, "needs Python 3.14 compression.zstd")
class TestQueryPlace(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        make_store(self.tmp, months=144, valid_months=144)                  # 12 years so HORI can test
        from zon.fetch.power_zarr import PowerZarr
        self.z = PowerZarr(self.tmp, offline=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_text_to_cells_and_regional_verdict(self):
        try:
            import hori.api  # noqa: F401
        except ImportError:
            self.skipTest("hori not on PYTHONPATH")
        from zon.places import Place, PlaceIndex
        from zon.query import query_place
        poly = np.array([[0.9, -1.1], [0.9, 1.1], [3.2, 1.1], [3.2, -1.1], [0.9, -1.1]])
        idx = PlaceIndex([Place("xx-test", "admin1", {"es": "Tierra de Prueba", "en": "Test Land"}, "Nowhere", [poly]),
                          Place("gn-1", "city", {"es": "Prueba", "en": "Prueba"}, "XX", point=(0.0, 1.25), population=20000)])
        r = query_place("tierra de prueba", "T2M", 1981, 1992, index=idx, store=self.z)
        self.assertEqual(int(r["mask"].sum()), 5 * 4)                       # lat -1..1 (5) x lon 1.25..3.125 (4)
        self.assertEqual(r["regional"].verdict.shape, (1,))
        self.assertEqual(r["regional"].manifest["entity"]["kind"], "region_mean")
        self.assertEqual(r["cells"].manifest["entity"]["id"], "earth-xx-test")
        self.assertEqual(r["regional"].verdict[0], 1)                       # the fake store has a clean +0.01/month trend
        city = query_place("prueba", "T2M", 1981, 1992, index=idx, store=self.z)
        self.assertEqual(city["place"].kind, "city")
        self.assertEqual(int(city["mask"].sum()), 1)
