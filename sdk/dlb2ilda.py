#!/usr/bin/env python3
"""
dlb2ilda.py - Convert Damei DLB (DMOSDLB) laser files to standard ILDA format.

Format structure (per frame):
  [2-byte point count] [2-byte unused]
  [N x 8-byte point records]
  
Point record: X(uint16 LE) Y(uint16 LE) Status(uint8) R(uint8) G(uint8) B(uint8)
  Status 0 = lit/draw, non-zero = blanked/mover

XOR obfuscation: each byte XOR'd with (sum(name_field) & 0xFF)
where name_field is bytes 8-15 of the file header.

Usage:
  python dlb2ilda.py input.dlb [output.ild] [--frame N] [--svg]
  python dlb2ilda.py input_folder [--frame N] [--svg]
  
  Default: exports all frames to ILDA.
  --frame N: export only frame N instead of all frames.
  --svg:     also export an SVG preview of the first frame.
"""

import struct, os, sys, argparse
from typing import List, Tuple

# ─── DLB Decoder ───

def get_xor_key(filepath: str) -> int:
    with open(filepath, "rb") as f:
        name = f.read(16)[8:16]
    return sum(name) & 0xFF

def ilda_coord(val: int) -> int:
    """Convert DLB 12-bit DAC value (0-4095) to ILDA int16 (-32768..32767)."""
    return max(-32768, min(32767, (val - 2048) * 16))


def decode_frame(raw: bytes, key: int) -> Tuple[int, List[Tuple[int, int, int, int, int, int]]]:
    """
    Decode a single frame from raw DLB data.
    Returns (point_count, list of (x_ilda, y_ilda, r, g, b, blanked)).
    blanked is 1 for blanked/mover points, 0 for lit points.
    """
    decoded = bytes(b ^ key for b in raw)
    point_count = struct.unpack_from("<H", decoded, 0)[0]
    if point_count > 2500:
        point_count = 2500
    
    points = []
    for i in range(point_count):
        offset = 4 + i * 8
        pt = decoded[offset:offset+8]
        x_file, y_file = struct.unpack_from("<hh", pt, 0)
        status, r, g, b = pt[4], pt[5], pt[6], pt[7]
        blanked = 0 if status == 0 else 1  # status 0 = lit, non-zero = blanked/mover
        points.append((ilda_coord(x_file), ilda_coord(y_file), r, g, b, blanked))
    
    return point_count, points

def decode_dlb_file(filepath: str, key: int = None) -> List[List[Tuple[int, int, int, int, int, int]]]:
    """Decode all frames from a DLB file."""
    if key is None:
        key = get_xor_key(filepath)
    
    with open(filepath, "rb") as f:
        raw = f.read()
    
    if raw[:8] != b'DMOSDLB\x00':
        raise ValueError("Not a valid DLB file (missing DMOSDLB magic)")
    
    frame_size = 20004
    frame_count = (len(raw) - 32) // frame_size
    
    all_frames = []
    for fi in range(frame_count):
        offset = 32 + fi * frame_size
        hdr, pts = decode_frame(raw[offset:offset + frame_size], key)
        all_frames.append(pts)
    
    return all_frames

# ─── ILDA Writer ───

ILDA_MAGIC = b'ILDA'

def write_ilda(frames: List[List[Tuple[int, int, int, int, int, int]]], 
               output_path: str, 
               company: str = "DLB2ILDA",
               prefix: str = "FRAME") -> None:
    """Write frames to ILDA format 5 (2D true color).
    
    Each point tuple: (x, y, r, g, b, blanked) where blanked=1 for mover points.
    """
    total = len(frames)
    with open(output_path, "wb") as f:
        for fi, pts in enumerate(frames):
            n = len(pts)
            f.write(struct.pack(
                ">4s3sB8s8sHHHBB",
                ILDA_MAGIC, b"\x00\x00\x00", 5,
                prefix.encode('ascii')[:8].ljust(8, b'\x00'),
                company.encode('ascii')[:8].ljust(8, b'\x00'),
                n, fi, total, 0, 0,
            ))
            for i, (x, y, r, g, b, blanked) in enumerate(pts):
                blank = 0x40 if blanked else 0
                last = 0x80 if i == n - 1 else 0
                ilda_status = blank | last
                f.write(struct.pack(">hhBBBB", x, y, ilda_status, b, g, r))

def write_ilda_single(pts: List[Tuple[int, int, int, int, int, int]], 
                      output_path: str,
                      company: str = "DLB2ILDA",
                      name: str = "FRAME") -> None:
    """Write a single frame as ILDA format 5."""
    write_ilda([pts], output_path, company, name)

# ─── SVG Export ───

def export_svg(frames: List[List[Tuple]], output_path: str, fi: int = 0):
    """Export frame to SVG for visual verification."""
    pts = frames[fi]
    if not pts:
        return
    
    # Scale coordinates to fit in 800x800 box
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    
    def scale(val, lo, hi):
        return 20 + (val - lo) / max(hi - lo, 1) * 800
    
    from collections import defaultdict
    groups = defaultdict(list)
    for pt in pts:
        x, y, r, g, b = pt[:5]
        groups[(r, g, b)].append((x, y))
    
    lines = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 840">']
    lines.append(f'<rect x="0" y="0" width="840" height="840" fill="#111"/>')
    lines.append(f'<text x="10" y="20" fill="#aaa" font-family="monospace" font-size="12">Frame {fi} ({len(pts)} pts)</text>')
    
    for color, coords in groups.items():
        r, g, b = color
        pts_str = " ".join(f"{scale(x, min_x, max_x)},{scale(y, min_y, max_y)}" for x, y in coords)
        lines.append(f'<polyline points="{pts_str}" fill="none" stroke="rgb({r},{g},{b})" stroke-width="1"/>')
    
    lines.append("</svg>")
    
    with open(output_path, "w") as f:
        f.write("\n".join(lines))

# ─── CLI ───

def convert_file(filepath, outpath=None, frame=None, company="DLB2ILDA", prefix="FRAME", with_svg=False):
    """Convert a single DLB file to ILDA."""
    if outpath is None:
        outpath = os.path.splitext(filepath)[0] + ".ild"
    key = get_xor_key(filepath)
    basename = os.path.basename(filepath)
    print(f"[{basename}] XOR key: 0x{key:02X}")
    frames = decode_dlb_file(filepath, key)
    if frame is not None:
        fi = min(frame, len(frames) - 1)
        pts = frames[fi]
        print(f"[{basename}] Frame {fi}: {len(pts)} points -> {outpath}")
        write_ilda_single(pts, outpath, company, f"{prefix}{fi:04d}")
        if with_svg:
            svg_path = os.path.splitext(outpath)[0] + ".svg"
            export_svg(frames, svg_path, fi)
            print(f"[{basename}] SVG: {svg_path}")
    else:
        print(f"[{basename}] Frames: {len(frames)}, writing all -> {outpath}")
        write_ilda(frames, outpath, company, prefix)
        if with_svg:
            svg_path = os.path.splitext(outpath)[0] + ".svg"
            export_svg(frames, svg_path, 0)
            print(f"[{basename}] SVG: {svg_path}")


def main():
    ap = argparse.ArgumentParser(description="Convert Damei DLB files to ILDA format")
    ap.add_argument("input", help="Input DLB file or folder (all .dlb files in folder)")
    ap.add_argument("output", nargs="?", help="Output ILD file (default: input.ild; ignored for folders)")
    ap.add_argument("--frame", type=int, help="Export only this frame index instead of all frames")
    ap.add_argument("--svg", action="store_true", help="Also export SVG preview of first frame")
    ap.add_argument("--company", default="DLB2ILDA")
    ap.add_argument("--prefix", default="FRAME")
    args = ap.parse_args()
    
    if not os.path.exists(args.input):
        ap.error(f"Input not found: {args.input}")
    
    if os.path.isdir(args.input):
        dlb_files = sorted(f for f in os.listdir(args.input) if f.lower().endswith('.dlb'))
        if not dlb_files:
            print(f"No .dlb files found in {args.input}")
            return
        print(f"Found {len(dlb_files)} .dlb file(s) in {args.input}")
        for fname in dlb_files:
            filepath = os.path.join(args.input, fname)
            convert_file(filepath, frame=args.frame,
                         company=args.company, prefix=args.prefix,
                         with_svg=args.svg)
    else:
        convert_file(args.input, args.output, frame=args.frame,
                     company=args.company, prefix=args.prefix,
                     with_svg=args.svg)
    
    print("Done!")


if __name__ == "__main__":
    main()