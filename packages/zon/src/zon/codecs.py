"""Zarr v2 codecs with the standard library only (Python >= 3.14 for zstd): Blosc1 frames + fixedscaleoffset.

Supported, because NASA POWER's ARD store uses them: Blosc1 with zstd (variables), lz4 (coordinates) or zlib,
with no shuffle or byte shuffle. Anything else (bitshuffle, blosclz, snappy, other filters) raises
UnsupportedCodec: we never guess bytes.
"""
from __future__ import annotations

import math
import struct
import zlib

import numpy as np

try:
    from compression import zstd as _zstd                      # Python 3.14+
except ImportError:                                            # pragma: no cover - older Python
    _zstd = None

BLOSC_SHUFFLE, BLOSC_MEMCPYED, BLOSC_BITSHUFFLE, BLOSC_DONT_SPLIT = 0x01, 0x02, 0x04, 0x10
_COMPCODES = {0: "blosclz", 1: "lz4", 2: "snappy", 3: "zlib", 4: "zstd"}
_MAX_SPLITS, _MIN_BUFFERSIZE = 16, 128


class UnsupportedCodec(ValueError):
    pass


class CorruptChunk(ValueError):
    pass


def lz4_block_decode(src: bytes, out_size: int) -> bytes:
    """Raw LZ4 *block* format (what Blosc stores), per the LZ4 block specification."""
    dst = bytearray()
    i, n = 0, len(src)
    while i < n:
        token = src[i]
        i += 1
        lit = token >> 4
        if lit == 15:
            while True:
                b = src[i]
                i += 1
                lit += b
                if b != 255:
                    break
        dst += src[i:i + lit]
        i += lit
        if i >= n:                                             # last sequence has literals only
            break
        off = src[i] | (src[i + 1] << 8)
        i += 2
        if off == 0 or off > len(dst):
            raise CorruptChunk("lz4: bad match offset")
        ml = token & 15
        if ml == 15:
            while True:
                b = src[i]
                i += 1
                ml += b
                if b != 255:
                    break
        ml += 4
        start = len(dst) - off
        if off >= ml:
            dst += dst[start:start + ml]
        else:                                                  # overlapping copy = repeat the last `off` bytes
            pat = bytes(dst[start:])
            dst += (pat * (ml // off + 1))[:ml]
    if len(dst) != out_size:
        raise CorruptChunk(f"lz4: decoded {len(dst)} bytes, expected {out_size}")
    return bytes(dst)


def _decompress(name: str, raw: bytes, size: int) -> bytes:
    if name == "zstd":
        if _zstd is None:
            raise UnsupportedCodec("zstd needs Python >= 3.14 (compression.zstd)")
        out = _zstd.decompress(raw)
    elif name == "lz4":
        out = lz4_block_decode(raw, size)
    elif name == "zlib":
        out = zlib.decompress(raw)
    else:
        raise UnsupportedCodec(f"blosc compressor {name!r} is not supported")
    if len(out) != size:
        raise CorruptChunk(f"{name}: decoded {len(out)} bytes, expected {size}")
    return out


def blosc_decode(buf: bytes) -> bytes:
    """Decode one Blosc1 frame (c-blosc 1.x layout: 16-byte header, block starts, split streams)."""
    if len(buf) < 16:
        raise CorruptChunk("blosc: frame shorter than its header")
    version, flags, typesize = buf[0], buf[2], buf[3]
    nbytes, blocksize, cbytes = struct.unpack_from("<III", buf, 4)
    if version not in (1, 2):
        raise UnsupportedCodec(f"blosc format version {version} (only Blosc1 frames)")
    if cbytes != len(buf):
        raise CorruptChunk(f"blosc: header says {cbytes} bytes, frame has {len(buf)}")
    if flags & BLOSC_MEMCPYED:
        return bytes(buf[16:16 + nbytes])
    if flags & BLOSC_BITSHUFFLE:
        raise UnsupportedCodec("blosc bitshuffle is not supported")
    name = _COMPCODES.get(flags >> 5, f"code{flags >> 5}")
    nblocks = -(-nbytes // blocksize) if nbytes else 0
    starts = struct.unpack_from(f"<{nblocks}i", buf, 16)
    out = bytearray(nbytes)
    for b in range(nblocks):
        bsize = min(blocksize, nbytes - b * blocksize)
        split = (not flags & BLOSC_DONT_SPLIT) and typesize <= _MAX_SPLITS and bsize // typesize >= _MIN_BUFFERSIZE \
            and bsize % typesize == 0
        nsplits = typesize if split else 1
        neb = bsize // nsplits
        pos, parts = starts[b], []
        for _ in range(nsplits):
            (cs,) = struct.unpack_from("<i", buf, pos)
            pos += 4
            raw = bytes(buf[pos:pos + cs])
            pos += cs
            parts.append(raw if cs == neb else _decompress(name, raw, neb))
        blk = b"".join(parts)
        if flags & BLOSC_SHUFFLE and typesize > 1:
            m = bsize // typesize
            blk = np.frombuffer(blk[:m * typesize], np.uint8).reshape(typesize, m).T.tobytes() + blk[m * typesize:]
        out[b * blocksize:b * blocksize + bsize] = blk
    return bytes(out)


def decode_chunk(buf: bytes, zarray: dict) -> np.ndarray:
    """Bytes of one Zarr v2 chunk -> array of the full chunk shape, filters undone. Edge chunks keep their padding."""
    comp = zarray.get("compressor")
    if comp is None:
        data = buf
    elif comp.get("id") == "blosc":
        data = blosc_decode(buf)
    else:
        raise UnsupportedCodec(f"compressor {comp.get('id')!r} is not supported")
    if zarray.get("order", "C") != "C":
        raise UnsupportedCodec("only C-order chunks")
    filters = zarray.get("filters") or []
    stored = np.dtype(filters[-1].get("astype", zarray["dtype"]) if filters else zarray["dtype"])
    arr = np.frombuffer(data, dtype=stored)
    for f in reversed(filters):
        if f.get("id") != "fixedscaleoffset":
            raise UnsupportedCodec(f"filter {f.get('id')!r} is not supported")
        # The encoder stored round((x - offset) * scale). Undo it in float64 and snap to the 1/scale grid: in float32,
        # raw/100 + 1000 is off by up to ~3e-5 (6.0300293 instead of 6.03). Snapped, it equals the POWER API exactly.
        x = arr.astype(np.float64) / float(f["scale"]) + float(f["offset"])
        dec = math.log10(float(f["scale"]))
        arr = (np.round(x, int(round(dec))) if abs(dec - round(dec)) < 1e-12 else x).astype(f["dtype"])
    shape = tuple(zarray["chunks"])
    if arr.size != int(np.prod(shape)):
        raise CorruptChunk(f"chunk has {arr.size} values, expected {int(np.prod(shape))}")
    return arr.astype(np.dtype(zarray["dtype"]), copy=False).reshape(shape)
