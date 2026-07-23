#!/usr/bin/env python3
"""DLB laser animation viewer/player for DMOSDLB format.

Format (per frame, 20004 bytes):
  [2-byte point count] [2-byte unused]
  [N x 8-byte point records]
  
Point record: X(uint16 LE) Y(uint16 LE) Status(uint8) R(uint8) G(uint8) B(uint8)
  Status 0 = lit/draw, non-zero = blanked/mover

XOR obfuscation: each byte XOR'd with (sum(name_field) & 0xFF)
where name_field is bytes 8-15 of the file header.

Usage:
    py dlb_viewer.py file.dlb
    py dlb_viewer.py file.dlb --scale 2
    py dlb_viewer.py file.dlb --export-ilda output.ild
"""

import argparse
import struct
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, Menu
from pathlib import Path

FRAME_SIZE = 20004
HEADER_SIZE = 4
POINT_SIZE = 8
POINTS_PER_FRAME = (FRAME_SIZE - HEADER_SIZE) // POINT_SIZE  # 2500


class DLBReader:
    def __init__(self, path):
        self.path = path
        self.name = ""
        self.xor_key = 0
        self.n_frames = 0
        self.raw_frames = []
        self._load(path)

    def _load(self, path):
        with open(path, "rb") as f:
            data = f.read()
        if data[:8] != b"DMOSDLB\x00":
            raise ValueError(f"Not a DMOSDLB v2.0 file: {path}")
        name_field = data[8:16]
        self.name = name_field.rstrip(b"\x00").decode("ascii", errors="replace")
        self.xor_key = sum(name_field) & 0xFF
        self.n_frames = max(1, (len(data) - 32) // FRAME_SIZE)
        self.raw_frames = []
        for f_idx in range(self.n_frames):
            start = 32 + f_idx * FRAME_SIZE
            self.raw_frames.append(data[start:start + FRAME_SIZE])

    def decode_frame(self, f_idx):
        """Decode a frame using XOR key. Returns list of point dicts."""
        raw = self.raw_frames[f_idx]
        decoded = bytes(b ^ self.xor_key for b in raw)

        point_count = struct.unpack_from("<H", decoded, 0)[0]
        point_count = min(point_count, POINTS_PER_FRAME)

        pts = []
        for i in range(point_count):
            offset = HEADER_SIZE + i * POINT_SIZE
            pt = decoded[offset:offset + POINT_SIZE]
            x_file, y_file = struct.unpack_from("<hh", pt, 0)
            status, r, g, b = pt[4], pt[5], pt[6], pt[7]

            draw = (status == 0)
            pts.append({
                "x": x_file,
                "y": y_file,
                "draw": draw,
                "r": r,
                "g": g,
                "b": b,
                "status": status,
            })

        return pts

    def get_frame(self, f_idx):
        return self.decode_frame(f_idx)


def ilda_coord(val):
    """Convert DLB 12-bit DAC value (0-4095) to ILDA int16 (-32768..32767)."""
    return max(-32768, min(32767, (int(val) - 2048) * 16))


def export_ilda(frames, name, outpath):
    """Export decoded frames to ILDA format 5 (2D true color).
    
    ILDA uses big-endian byte order.
    ILDA coordinates are int16 (-32768..32767).
    DLB coordinates are 12-bit DAC values (0-4095), centered at 2048.
    Status byte: bit 6 = blank (1=blank), bit 7 = last point (1=last).
    Color order: B, G, R.
    """
    nf = len(frames)
    with open(outpath, "wb") as f:
        for fi, frame in enumerate(frames):
            npts = min(len(frame), 65535)
            f.write(struct.pack(
                ">4s3sB8s8sHHHBB",
                b"ILDA", b"\x00\x00\x00", 5,
                name.encode("ascii")[:8].ljust(8, b"\x00"),
                b"DLB2ILDA",
                npts, fi, nf, 0, 0,
            ))
            for i, pt in enumerate(frame):
                blank = 0x40 if not pt["draw"] else 0
                last = 0x80 if i == npts - 1 else 0
                status = blank | last
                x = ilda_coord(pt["x"])
                y = ilda_coord(pt["y"])
                f.write(struct.pack(">hhBBBB", x, y, status,
                                    pt["b"], pt["g"], pt["r"]))


class DLBViewer:
    def __init__(self, master, dlb_path, scale=1.0):
        self.master = master
        self.scale = scale
        self.playing = False
        self.frame_idx = 0
        self.speed = 50

        master.title("DLB Viewer")
        master.protocol("WM_DELETE_WINDOW", self._quit)

        self._build_ui()

        if dlb_path:
            try:
                self.dlb = DLBReader(dlb_path)
                master.title(f"DLB Viewer - {Path(dlb_path).name} ({self.dlb.name})")
                self.frame_spin.config(to=self.dlb.n_frames - 1)
                self.frames_label.config(text=f"Frames: {self.dlb.n_frames}")
                self.max_frame_label.config(text=f"/ {self.dlb.n_frames - 1}")
                self.draw_frame(0)
            except ValueError:
                self.dlb = None
        else:
            self.dlb = None

    def _build_ui(self):
        menubar = Menu(self.master)
        self.master.config(menu=menubar)

        file_menu = Menu(menubar, tearoff=0)
        file_menu.add_command(label="Open...", command=self._open_file, accelerator="Ctrl+O")
        file_menu.add_separator()
        export_menu = Menu(file_menu, tearoff=0)
        export_menu.add_command(label="ILDA (all frames)...", command=self._export_ilda_all)
        export_menu.add_command(label="ILDA (current frame)...", command=self._export_ilda_one)
        export_menu.add_command(label="SVG (current frame)...", command=self._export_svg)
        file_menu.add_cascade(label="Export", menu=export_menu)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self._quit)
        menubar.add_cascade(label="File", menu=file_menu)

        self.master.bind("<Control-o>", lambda e: self._open_file())

        ctrl_frame = ttk.Frame(self.master, padding=5)
        ctrl_frame.pack(fill=tk.X)

        self.frames_label = ttk.Label(ctrl_frame, text="Frames: 0")
        self.frames_label.pack(side=tk.LEFT, padx=5)

        self.frame_var = tk.StringVar(value="0")
        ttk.Label(ctrl_frame, text="Frame:").pack(side=tk.LEFT, padx=(10, 2))
        self.frame_spin = ttk.Spinbox(ctrl_frame, from_=0, to=0,
                                       width=5, textvariable=self.frame_var,
                                       command=self._on_spin)
        self.frame_spin.pack(side=tk.LEFT, padx=2)
        self.max_frame_label = ttk.Label(ctrl_frame, text="/ 0")
        self.max_frame_label.pack(side=tk.LEFT)

        self.play_btn = ttk.Button(ctrl_frame, text="Play", command=self._toggle_play)
        self.play_btn.pack(side=tk.LEFT, padx=10)

        ttk.Label(ctrl_frame, text="Speed:").pack(side=tk.LEFT, padx=(10, 2))
        self.speed_scale = ttk.Scale(ctrl_frame, from_=1, to=100, value=50,
                                      command=self._on_speed)
        self.speed_scale.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2)

        self.blanked_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(ctrl_frame, text="Show blanked",
                        variable=self.blanked_var,
                        command=self._redraw).pack(side=tk.RIGHT, padx=5)

        info_frame = ttk.Frame(self.master, padding=5)
        info_frame.pack(fill=tk.X)
        self.info_var = tk.StringVar()
        ttk.Label(info_frame, textvariable=self.info_var).pack(side=tk.LEFT)

        canvas_frame = ttk.Frame(self.master, padding=5)
        canvas_frame.pack(fill=tk.BOTH, expand=True)

        self.canvas = tk.Canvas(canvas_frame, bg="black", highlightthickness=0)
        vbar = ttk.Scrollbar(canvas_frame, orient=tk.VERTICAL, command=self.canvas.yview)
        hbar = ttk.Scrollbar(canvas_frame, orient=tk.HORIZONTAL, command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=vbar.set, xscrollcommand=hbar.set)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        vbar.grid(row=0, column=1, sticky="ns")
        hbar.grid(row=1, column=0, sticky="ew")
        canvas_frame.grid_rowconfigure(0, weight=1)
        canvas_frame.grid_columnconfigure(0, weight=1)

        canvas_frame.bind("<Configure>", self._on_resize)

    def _on_spin(self):
        if self.dlb is None:
            return
        try:
            f = int(self.frame_var.get())
            self.frame_idx = max(0, min(f, self.dlb.n_frames - 1))
            self.draw_frame(self.frame_idx)
        except ValueError:
            pass

    def _toggle_play(self):
        if self.dlb is None or self.dlb.n_frames < 2:
            return
        self.playing = not self.playing
        self.play_btn.config(text="Stop" if self.playing else "Play")
        if self.playing:
            self._play_loop()

    def _play_loop(self):
        if not self.playing:
            return
        self.draw_frame(self.frame_idx)
        self.frame_idx = (self.frame_idx + 1) % self.dlb.n_frames
        self.frame_var.set(str(self.frame_idx))
        delay = max(10, int(100 - self.speed))
        self.master.after(delay, self._play_loop)

    def _on_speed(self, val):
        self.speed = float(val)

    def _on_resize(self, event):
        self.draw_frame(self.frame_idx)

    def _redraw(self):
        self.draw_frame(self.frame_idx)

    def draw_frame(self, f_idx):
        self.canvas.delete("all")
        if self.dlb is None:
            return
        w = self.canvas.winfo_width() or 800
        h = self.canvas.winfo_height() or 600
        self.canvas.configure(scrollregion=(0, 0, w, h))

        pts = self.dlb.decode_frame(f_idx)
        if not pts:
            self.info_var.set(f"Frame {f_idx}: 0 pt (empty)")
            return

        show_blanked = self.blanked_var.get()
        visible = [i for i, p in enumerate(pts) if p["draw"] or show_blanked]

        # Use lit points for bounding box (blanked movers at edges distort scale)
        draw_pts = [p for p in pts if p["draw"]]
        if draw_pts:
            min_x = min(p["x"] for p in draw_pts)
            max_x = max(p["x"] for p in draw_pts)
            min_y = min(p["y"] for p in draw_pts)
            max_y = max(p["y"] for p in draw_pts)
        else:
            min_x = max_x = min_y = max_y = 0

        pad = 20
        draw_w = w - 2 * pad
        draw_h = h - 2 * pad
        x_range = max(max_x - min_x, 1)
        y_range = max(max_y - min_y, 1)

        def to_canvas(x, y):
            cx = pad + (x - min_x) / x_range * draw_w
            cy = pad + (y - min_y) / y_range * draw_h
            return cx, h - cy

        for i in visible:
            p = pts[i]
            cx, cy = to_canvas(p["x"], p["y"])
            r, g, b = p["r"], p["g"], p["b"]
            col = f"#{r:02x}{g:02x}{b:02x}"
            sz = max(1, int(3 * self.scale))
            outline = col if p["draw"] else "#333333"
            self.canvas.create_oval(cx - sz, cy - sz, cx + sz, cy + sz,
                                    fill=outline, outline=outline)

        draw_idxs = [i for i in range(len(pts)) if pts[i]["draw"]]
        for i in range(len(draw_idxs) - 1):
            i1 = draw_idxs[i]
            i2 = draw_idxs[i + 1]
            if i2 != i1 + 1:
                continue
            p1, p2 = pts[i1], pts[i2]
            cx1, cy1 = to_canvas(p1["x"], p1["y"])
            cx2, cy2 = to_canvas(p2["x"], p2["y"])
            col = f"#{p1['r']:02x}{p1['g']:02x}{p1['b']:02x}"
            self.canvas.create_line(cx1, cy1, cx2, cy2, fill=col, width=1)

        n_vis = len(visible)
        n_total = len(pts)
        info = f"Frame {f_idx}: {n_total} pt ({n_vis} shown) | " \
               f"X=[{min_x}..{max_x}] Y=[{min_y}..{max_y}] | " \
               f"name={self.dlb.name}"
        self.info_var.set(info)

    def _load_dlb(self, path):
        self.playing = False
        self.dlb = DLBReader(path)
        self.frame_idx = 0
        self.frame_var.set("0")
        self.frame_spin.config(to=self.dlb.n_frames - 1)
        self.frames_label.config(text=f"Frames: {self.dlb.n_frames}")
        self.max_frame_label.config(text=f"/ {self.dlb.n_frames - 1}")
        self.master.title(f"DLB Viewer - {Path(path).name} ({self.dlb.name})")
        self.canvas.delete("all")
        self.draw_frame(0)

    def _open_file(self):
        path = filedialog.askopenfilename(
            title="Open DLB file",
            filetypes=[("DLB files", "*.dlb"), ("All files", "*.*")]
        )
        if not path:
            return
        try:
            self._load_dlb(path)
        except (ValueError, OSError) as e:
            messagebox.showerror("Error", str(e))

    def _export_ilda_all(self):
        if self.dlb is None:
            return
        path = filedialog.asksaveasfilename(
            title="Export all frames as ILDA",
            defaultextension=".ild",
            filetypes=[("ILDA files", "*.ild"), ("All files", "*.*")]
        )
        if not path:
            return
        frames = [self.dlb.decode_frame(i) for i in range(self.dlb.n_frames)]
        export_ilda(frames, self.dlb.name, path)
        messagebox.showinfo("Export", f"Exported {self.dlb.n_frames} frames to\n{path}")

    def _export_ilda_one(self):
        if self.dlb is None:
            return
        path = filedialog.asksaveasfilename(
            title="Export current frame as ILDA",
            defaultextension=".ild",
            filetypes=[("ILDA files", "*.ild"), ("All files", "*.*")]
        )
        if not path:
            return
        frames = [self.dlb.decode_frame(self.frame_idx)]
        export_ilda(frames, self.dlb.name, path)
        messagebox.showinfo("Export", f"Exported frame {self.frame_idx} to\n{path}")

    def _export_svg(self):
        if self.dlb is None:
            return
        path = filedialog.asksaveasfilename(
            title="Export current frame as SVG",
            defaultextension=".svg",
            filetypes=[("SVG files", "*.svg"), ("All files", "*.*")]
        )
        if not path:
            return
        pts = self.dlb.decode_frame(self.frame_idx)
        draw_pts = [p for p in pts if p["draw"]]
        if not draw_pts:
            messagebox.showwarning("Export", "No lit points to export")
            return
        xs = [p["x"] for p in draw_pts]
        ys = [p["y"] for p in draw_pts]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)

        def sval(val, lo, hi):
            return 20 + (val - lo) / max(hi - lo, 1) * 800

        from collections import defaultdict
        groups = defaultdict(list)
        for p in draw_pts:
            groups[(p["r"], p["g"], p["b"])].append((p["x"], p["y"]))

        lines = [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 840">',
            f'<rect x="0" y="0" width="840" height="840" fill="#111"/>',
            f'<text x="10" y="20" fill="#aaa" font-family="monospace" font-size="12">'
            f'Frame {self.frame_idx} ({len(draw_pts)} pts)</text>',
        ]
        for (r, g, b), coords in groups.items():
            pts_str = " ".join(
                f"{sval(x, min_x, max_x)},{sval(y, min_y, max_y)}"
                for x, y in coords
            )
            lines.append(
                f'<polyline points="{pts_str}" fill="none" '
                f'stroke="rgb({r},{g},{b})" stroke-width="1"/>'
            )
        lines.append("</svg>")

        with open(path, "w") as f:
            f.write("\n".join(lines))
        messagebox.showinfo("Export", f"Exported frame {self.frame_idx} SVG to\n{path}")

    def _quit(self):
        self.playing = False
        self.master.destroy()


def main():
    parser = argparse.ArgumentParser(
        description="DLB laser animation viewer for DMOSDLB v2.0 format"
    )
    parser.add_argument("dlb_file", nargs="?", help="Input .dlb file")
    parser.add_argument("--scale", type=float, default=1.0, help="Point size scale")
    parser.add_argument("--export-ilda", metavar="OUTPUT.ILD",
                        help="Export all frames to ILDA format and exit")
    args = parser.parse_args()

    if args.dlb_file and args.export_ilda:
        reader = DLBReader(args.dlb_file)
        frames = [reader.decode_frame(i) for i in range(reader.n_frames)]
        export_ilda(frames, reader.name, args.export_ilda)
        print(f"Exported {reader.n_frames} frames to {args.export_ilda}")
        return

    root = tk.Tk()
    root.geometry("1000x700")

    if args.dlb_file:
        viewer = DLBViewer(root, args.dlb_file, scale=args.scale)
    else:
        viewer = DLBViewer(root, "", scale=args.scale)
        viewer._open_file()

    root.mainloop()


if __name__ == "__main__":
    main()
