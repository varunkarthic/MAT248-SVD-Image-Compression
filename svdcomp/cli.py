"""Command-line interface: ``svdcomp compress | info | benchmark``."""

import argparse
import csv
import sys
import time

import numpy as np

from .compress import METHODS, compress, compress_blocks, decompose, rank_for_energy, result_for_rank
from .formats import read_image, write_image


def _summary(result):
    m = result.metrics
    k = result.k if np.isscalar(result.k) else f"adaptive (mean {m['mean_rank']:.1f})"
    return (f"rank k        : {k}\n"
            f"stored values : {result.stored_values:,} / {result.original_values:,} "
            f"(ratio {result.ratio:.2f}x)\n"
            f"energy kept   : {100 * m['energy']:.3f} %\n"
            f"PSNR          : {m['psnr']:.2f} dB\n"
            f"SSIM          : {m['ssim']:.4f}\n"
            f"rel. error    : {m['relative_error']:.4f}")


def cmd_compress(args):
    img = read_image(args.input)
    start = time.perf_counter()
    if args.blocks:
        result = compress_blocks(img, block=args.blocks, energy=args.energy or 0.95)
    else:
        result = compress(img, k=args.k, energy=None if args.k else (args.energy or 0.95),
                          method=args.method, seed=args.seed)
    elapsed = time.perf_counter() - start
    write_image(args.output, result.image)
    print(_summary(result))
    print(f"time          : {elapsed:.2f} s\nwritten       : {args.output}")


def cmd_info(args):
    img = read_image(args.input)
    factors = decompose(img, args.method, rank=args.rank, seed=args.seed)
    m, n = factors.shape
    print(f"size          : {n} x {m} px, {factors.channels} channel(s)")
    print(f"singular vals : {factors.max_rank} per channel"
          + (" (randomized, leading only)" if args.method == "randomized" else ""))
    print("top sigma     : " + ", ".join(f"{v:.1f}" for v in factors.s[0, :8]))
    for level in (0.90, 0.95, 0.99, 0.999):
        k = rank_for_energy(factors.s, level, factors.energy_total)
        print(f"k for {100 * level:6.2f} % energy: {k}")
    if args.sigma_csv:
        with open(args.sigma_csv, "w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["i"] + [f"sigma_ch{c}" for c in range(factors.channels)])
            for i in range(factors.max_rank):
                writer.writerow([i + 1] + [f"{v:.6g}" for v in factors.s[:, i]])
        print(f"wrote {args.sigma_csv}")


def cmd_benchmark(args):
    img = read_image(args.input)
    ks = sorted({int(k) for k in args.ks.split(",")})
    start = time.perf_counter()
    factors = decompose(img, args.method, rank=max(ks) if args.method == "randomized" else None, seed=args.seed)
    svd_time = time.perf_counter() - start
    fields = ["k", "stored_values", "ratio", "energy", "psnr", "ssim", "relative_error"]
    out = open(args.csv, "w", newline="") if args.csv else sys.stdout
    try:
        writer = csv.writer(out)
        writer.writerow(fields)
        for k in ks:
            r = result_for_rank(img, factors, k)
            writer.writerow([r.k, r.stored_values, f"{r.ratio:.4f}", f"{r.metrics['energy']:.6f}",
                             f"{r.metrics['psnr']:.3f}", f"{r.metrics['ssim']:.5f}",
                             f"{r.metrics['relative_error']:.5f}"])
    finally:
        if args.csv:
            out.close()
    print(f"# SVD ({args.method}) took {svd_time:.2f} s", file=sys.stderr)


def build_parser():
    parser = argparse.ArgumentParser(prog="svdcomp", description="Image compression with a from-scratch SVD.")
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p):
        p.add_argument("input", help="PNG, BMP, PGM or PPM image")
        p.add_argument("--method", choices=METHODS, default="exact", help="SVD algorithm (default: exact Jacobi)")
        p.add_argument("--seed", type=int, default=0, help="seed for the randomized SVD")

    p = sub.add_parser("compress", help="write the rank-k approximation of an image")
    common(p)
    p.add_argument("output", help="output file (.png, .bmp, .pgm, .ppm)")
    group = p.add_mutually_exclusive_group()
    group.add_argument("-k", type=int, help="number of singular values to keep")
    group.add_argument("--blocks", type=int, metavar="SIZE", help="adaptive block-wise SVD with SIZE x SIZE tiles")
    p.add_argument("--energy", type=float, help="keep this fraction of spectral energy (default 0.95)")
    p.set_defaults(func=cmd_compress)

    p = sub.add_parser("info", help="singular value summary and ranks for energy levels")
    common(p)
    p.add_argument("--rank", type=int, help="triplets to compute with --method randomized")
    p.add_argument("--sigma-csv", help="write all singular values to this CSV file")
    p.set_defaults(func=cmd_info)

    p = sub.add_parser("benchmark", help="quality and size for several ranks (CSV)")
    common(p)
    p.add_argument("--ks", default="1,5,10,20,50,100", help="comma-separated ranks")
    p.add_argument("--csv", help="write to this file instead of stdout")
    p.set_defaults(func=cmd_benchmark)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if getattr(args, "k", None) is not None and args.energy is not None:
        build_parser().error("-k and --energy are mutually exclusive")
    try:
        args.func(args)
    except (ValueError, OSError) as exc:
        print(f"svdcomp: error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
