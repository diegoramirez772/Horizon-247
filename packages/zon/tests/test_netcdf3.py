"""NetCDF classic reader + GISTEMP connector, on a tiny file written here by hand (no network)."""
import gzip
import shutil
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np

from zon.netcdf3 import NetCDFError, read


def _name(s):
    b = s.encode()
    return struct.pack(">I", len(b)) + b + b"\0" * ((4 - len(b) % 4) % 4)


def _att(name, t, vals):
    if t == 2:
        raw = vals.encode()
        n = len(raw)
    else:
        a = np.asarray(vals, dtype={3: ">i2", 4: ">i4", 5: ">f4", 6: ">f8"}[t]).ravel()
        raw, n = a.tobytes(), a.size
    return _name(name) + struct.pack(">II", t, n) + raw + b"\0" * ((4 - len(raw) % 4) % 4)


def write_cdf1(dims, gatts, variables, numrecs=0):
    """variables: [(name, dim_ids, atts[(name, type, vals)], nc_type, ndarray)] — fixed-size only, in order."""
    dim_b = struct.pack(">II", 0x0A, len(dims)) + b"".join(_name(n) + struct.pack(">I", l) for n, l in dims)
    att_b = (struct.pack(">II", 0x0C, len(gatts)) + b"".join(_att(*a) for a in gatts)) if gatts else struct.pack(">II", 0, 0)
    def var_hdr(begins):
        out = struct.pack(">II", 0x0B, len(variables))
        for (nm, ids, atts, t, data), b in zip(variables, begins):
            vb = struct.pack(">II", 0x0C, len(atts)) + b"".join(_att(*a) for a in atts) if atts else struct.pack(">II", 0, 0)
            size = data.nbytes + ((4 - data.nbytes % 4) % 4)
            out += _name(nm) + struct.pack(">I", len(ids)) + b"".join(struct.pack(">I", i) for i in ids) + vb + \
                struct.pack(">III", t, size, b)
        return out
    head_len = len(b"CDF\x01" + struct.pack(">I", numrecs) + dim_b + att_b + var_hdr([0] * len(variables)))
    begins, pos, body = [], head_len, b""
    for *_, data in variables:
        begins.append(pos)
        raw = data.tobytes()
        raw += b"\0" * ((4 - len(raw) % 4) % 4)
        body += raw
        pos += len(raw)
    return b"CDF\x01" + struct.pack(">I", numrecs) + dim_b + att_b + var_hdr(begins) + body


def gistemp_like():
    lat = np.array([-1.0, 1.0], ">f4")
    lon = np.array([-1.0, 1.0, 3.0], ">f4")
    days = np.array([(np.datetime64(f"{2000 + k // 12}-{k % 12 + 1:02d}-15") - np.datetime64("1800-01-01")).astype(int)
                     for k in range(24)], ">i4")
    ta = (np.arange(24 * 2 * 3).reshape(24, 2, 3) % 300).astype(">i2")
    ta[0, 0, 0] = 32767                                                  # fill
    return write_cdf1([("lat", 2), ("lon", 3), ("time", 24)], [("title", 2, "GISTEMP-like")], [
        ("lat", [0], [], 5, lat), ("lon", [1], [], 5, lon),
        ("time", [2], [("units", 2, "days since 1800-01-01 00:00:00")], 4, days),
        ("tempanomaly", [2, 0, 1], [("units", 2, "K"), ("long_name", 2, "Surface temperature anomaly"),
                                    ("scale_factor", 5, [0.01]), ("_FillValue", 3, [32767])], 3, ta)]), ta


class TestNetCDF3(unittest.TestCase):
    def test_header_values_and_cf_decoding(self):
        buf, ta = gistemp_like()
        d = read(buf)
        self.assertEqual(d.dims, {"lat": 2, "lon": 3, "time": 24})
        self.assertEqual(d.attrs["title"], "GISTEMP-like")
        x = d.get("tempanomaly")
        self.assertTrue(np.isnan(x[0, 0, 0]))
        self.assertAlmostEqual(float(x[1, 1, 2]), float(ta[1, 1, 2]) * 0.01, places=6)
        self.assertEqual(d.get("lon").tolist(), [-1.0, 1.0, 3.0])

    def test_refuses_hdf5_and_garbage(self):
        with self.assertRaises(NetCDFError):
            read(b"\x89HDF\r\n\x1a\n" + b"\0" * 64)
        with self.assertRaises(NetCDFError):
            read(b"NOPE" + b"\0" * 64)


class TestGistemp(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        buf, self.ta = gistemp_like()
        self.f = self.tmp / "g.nc.gz"
        self.f.write_bytes(gzip.compress(buf))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_region_cube_orientation_window_and_provenance(self):
        from zon.fetch.gistemp import Gistemp
        g = Gistemp(self.tmp / "cache", local_file=self.f)
        c = g.region_cube((-2, 0, 2, 4), 2001, 2001)
        self.assertEqual(c.values.shape, (12, 2, 2))                     # 2001 only; lon 1 and 3
        self.assertEqual(c.lat.tolist(), [1.0, -1.0])                    # north -> south
        self.assertAlmostEqual(float(c.values[0, 0, 0]), float(self.ta[12, 1, 1]) * 0.01, places=5)
        self.assertEqual(c.time[0], "2001-01-01")
        self.assertEqual(len(c.meta["dataset"]["sha256"]), 64)
        self.assertEqual(c.meta["dataset"]["kind"], "analysis")
        tiny = g.region_cube((0.1, 0.1, 0.2, 0.2), 2000, 2001)           # smaller than a cell: the containing one
        self.assertEqual(tiny.values.shape[1:], (1, 1))


if __name__ == "__main__":
    unittest.main()
