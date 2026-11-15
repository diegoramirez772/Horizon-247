"""NetCDF classic (CDF-1) and 64-bit-offset (CDF-2) reader, standard library + NumPy, read-only.

Follows the NetCDF classic format specification (Unidata): big-endian header with dimensions, global attributes
and variables; fixed-size variables are stored contiguously at `begin`; record variables (first dimension
unlimited) are interleaved record by record. NetCDF-4 (HDF5) files are refused with a clear error: they need a
different reader.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

import numpy as np

NC_DIMENSION, NC_VARIABLE, NC_ATTRIBUTE = 0x0A, 0x0B, 0x0C
DTYPES = {1: ">i1", 2: "S1", 3: ">i2", 4: ">i4", 5: ">f4", 6: ">f8"}
STREAMING = 0xFFFFFFFF


class NetCDFError(ValueError):
    pass


@dataclass
class Variable:
    name: str
    dims: tuple
    shape: tuple
    attrs: dict
    dtype: str
    vsize: int
    begin: int
    is_record: bool


@dataclass
class Dataset:
    buf: bytes = field(repr=False)
    dims: dict
    attrs: dict
    variables: dict
    numrecs: int
    recsize: int

    def raw(self, name: str) -> np.ndarray:
        """Stored values, no scaling or masking."""
        v = self.variables[name]
        dt = np.dtype(DTYPES[v.dtype])
        if not v.is_record:
            n = int(np.prod(v.shape)) if v.shape else 1
            return np.frombuffer(self.buf, dt, n, v.begin).reshape(v.shape)
        per = int(np.prod(v.shape[1:])) if len(v.shape) > 1 else 1
        if self.recsize == v.vsize or sum(1 for x in self.variables.values() if x.is_record) == 1:
            return np.frombuffer(self.buf, dt, per * self.numrecs, v.begin).reshape((self.numrecs,) + v.shape[1:])
        out = np.empty((self.numrecs, per), dtype=dt)
        for r in range(self.numrecs):
            out[r] = np.frombuffer(self.buf, dt, per, v.begin + r * self.recsize)
        return out.reshape((self.numrecs,) + v.shape[1:])

    def get(self, name: str) -> np.ndarray:
        """CF decoding: _FillValue/missing_value -> NaN, then scale_factor and add_offset (float64)."""
        v = self.variables[name]
        a = self.raw(name)
        if v.dtype == 2:
            return a
        x = a.astype(np.float64)
        for key in ("_FillValue", "missing_value"):
            fv = v.attrs.get(key)
            if fv is not None:
                for f in np.atleast_1d(fv):
                    x[a == f] = np.nan
        x = x * float(np.atleast_1d(v.attrs.get("scale_factor", 1.0))[0]) + float(np.atleast_1d(v.attrs.get("add_offset", 0.0))[0])
        return x


class _Reader:
    def __init__(self, buf: bytes, version: int):
        self.b, self.pos, self.v = buf, 4, version

    def int(self) -> int:
        (x,) = struct.unpack_from(">I", self.b, self.pos)
        self.pos += 4
        return x

    def offset(self) -> int:
        fmt, size = (">I", 4) if self.v == 1 else (">Q", 8)
        (x,) = struct.unpack_from(fmt, self.b, self.pos)
        self.pos += size
        return x

    def name(self) -> str:
        n = self.int()
        s = self.b[self.pos:self.pos + n].decode("utf-8")
        self.pos += (n + 3) // 4 * 4
        return s

    def values(self, nc_type: int, n: int):
        if nc_type not in DTYPES:
            raise NetCDFError(f"unknown nc_type {nc_type}")
        dt = np.dtype(DTYPES[nc_type])
        size = dt.itemsize * n
        raw = self.b[self.pos:self.pos + size]
        self.pos += (size + 3) // 4 * 4
        if nc_type == 2:
            return raw.decode("utf-8", errors="replace").rstrip("\x00")
        a = np.frombuffer(raw, dt, n)
        return a[0].item() if n == 1 else a.copy()

    def attrs(self) -> dict:
        tag, n = self.int(), self.int()
        if tag == 0 and n == 0:
            return {}
        if tag != NC_ATTRIBUTE:
            raise NetCDFError("bad attribute list")
        out = {}
        for _ in range(n):
            nm = self.name()
            t, k = self.int(), self.int()
            out[nm] = self.values(t, k)
        return out


def read(buf: bytes) -> Dataset:
    if buf[:4] == b"\x89HDF":
        raise NetCDFError("this is NetCDF-4/HDF5, not NetCDF classic: it needs an HDF5 reader (h5py)")
    if buf[:3] != b"CDF" or buf[3] not in (1, 2):
        raise NetCDFError("not a NetCDF classic file (CDF-1/CDF-2)")
    r = _Reader(buf, buf[3])
    numrecs = r.int()
    tag, n = r.int(), r.int()
    dims, dim_list = {}, []
    if tag == NC_DIMENSION:
        for _ in range(n):
            nm, ln = r.name(), r.int()
            dims[nm] = ln
            dim_list.append((nm, ln))
    elif not (tag == 0 and n == 0):
        raise NetCDFError("bad dimension list")
    gattrs = r.attrs()
    tag, n = r.int(), r.int()
    variables = {}
    if tag == NC_VARIABLE:
        for _ in range(n):
            nm = r.name()
            nd = r.int()
            ids = [r.int() for _ in range(nd)]
            va = r.attrs()
            t, vsize, begin = r.int(), r.int(), r.offset()
            names = tuple(dim_list[i][0] for i in ids)
            is_rec = bool(ids) and dim_list[ids[0]][1] == 0
            shape = tuple((numrecs if (k == 0 and is_rec) else dim_list[i][1]) for k, i in enumerate(ids))
            variables[nm] = Variable(nm, names, shape, va, t, vsize, begin, is_rec)
    elif not (tag == 0 and n == 0):
        raise NetCDFError("bad variable list")
    if numrecs == STREAMING:
        raise NetCDFError("streaming numrecs is not supported")
    recsize = sum(v.vsize for v in variables.values() if v.is_record)
    return Dataset(buf, dims, gattrs, variables, numrecs, recsize)
