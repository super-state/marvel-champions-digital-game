"""Builds the 3D table's sound effects (packages/client/src/battle-table/sfx/) from Kenney's CC0 audio packs.

    py -3 scripts/battle-sfx/build.py <folder holding the unzipped Kenney packs>

The folder holds one subfolder per pack, named as on kenney.nl: casino-audio, impact-sounds, interface-sounds,
sci-fi-sounds, digital-audio, music-jingles (each pack's zip unzipped into it). Every sound is trimmed to start within
about 10 ms, given a short fade at its end, brought to one loudness per family so the set sits together, and written
as a mono MP3. The swooshes are made here (Kenney has none): filtered noise swept up and down.

Needs ffmpeg on PATH and numpy.
"""

import glob
import os
import subprocess
import sys

import numpy as np

RATE = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "client", "src", "battle-table", "sfx")

# name -> (target loudness dBFS RMS of the sounding part, [variants]); a variant is a list of layers
# (file glob relative to the packs folder, gain dB, offset seconds).
CARD = -20
HIT = -14
UI = -24
STING = -17


def one(path, gain=0.0, at=0.0):
    return [(path, gain, at)]


RECIPE = {
    "draw": (CARD, [one(f"casino-audio/Audio/card-slide-{n}.ogg") for n in (1, 2, 4, 5)]),
    "deal": (CARD - 2, [one(f"casino-audio/Audio/card-slide-{n}.ogg") for n in (3, 6, 7)]),
    "place": (CARD, [one(f"casino-audio/Audio/card-place-{n}.ogg") for n in (1, 2, 4)]),
    "play": (CARD + 1, [one(f"casino-audio/Audio/card-shove-{n}.ogg") for n in (1, 3, 4)]),
    "flip": (CARD, [one("casino-audio/Audio/card-fan-1.ogg")]),
    "turn": (CARD - 4, [one(f"casino-audio/Audio/card-slide-{n}.ogg") for n in (6, 7, 8)]),
    "discard": (CARD - 3, [one(f"casino-audio/Audio/card-slide-{n}.ogg") for n in (4, 5)]),
    "shuffle": (CARD - 2, [one("casino-audio/Audio/card-shuffle.ogg")]),
    "hit": (HIT, [one(f"impact-sounds/Audio/impactPunch_medium_00{n}.ogg") for n in range(5)]),
    "hit-heavy": (
        HIT + 1,
        [
            [(f"impact-sounds/Audio/impactPunch_heavy_00{n}.ogg", 0, 0), ("sci-fi-sounds/Audio/lowFrequency_explosion_001.ogg", -7, 0)]
            for n in range(5)
        ],
    ),
    "block": (HIT - 4, [one(f"sci-fi-sounds/Audio/forceField_00{n}.ogg") for n in (0, 2, 4)]),
    "threat": (CARD + 1, [one(f"casino-audio/Audio/chips-stack-{n}.ogg") for n in (2, 3, 4, 5)]),
    "thwart": (CARD + 1, [one(f"casino-audio/Audio/chips-collide-{n}.ogg") for n in (1, 2, 4)]),
    "heal": (STING - 2, [one("digital-audio/Audio/powerUp7.ogg"), one("digital-audio/Audio/powerUp11.ogg")]),
    "status": (STING, [one("impact-sounds/Audio/impactBell_heavy_004.ogg"), one("impact-sounds/Audio/impactBell_heavy_002.ogg")]),
    "defeat": (HIT - 1, [one("sci-fi-sounds/Audio/explosionCrunch_000.ogg")]),
    "boom": (
        HIT,
        [[("sci-fi-sounds/Audio/lowFrequency_explosion_000.ogg", 0, 0), ("sci-fi-sounds/Audio/explosionCrunch_001.ogg", -5, 0.02)]],
    ),
    "surge": (STING, [one("digital-audio/Audio/phaserUp3.ogg")]),
    "boost": (STING - 2, [one("interface-sounds/Audio/maximize_006.ogg")]),
    "phase-hero": (STING + 1, [one("music-jingles/Audio/Hit jingles/jingles_HIT10.ogg")]),
    "phase-villain": (STING + 1, [one("music-jingles/Audio/Hit jingles/jingles_HIT05.ogg")]),
    "win": (STING + 2, [one("music-jingles/Audio/Hit jingles/jingles_HIT11.ogg")]),
    "lose": (STING + 2, [one("music-jingles/Audio/Hit jingles/jingles_HIT09.ogg")]),
    "select": (UI, [one(f"interface-sounds/Audio/select_00{n}.ogg") for n in (1, 2)]),
    "confirm": (UI + 2, [one("interface-sounds/Audio/confirmation_001.ogg")]),
    "error": (UI + 2, [one("interface-sounds/Audio/error_006.ogg")]),
}

# Made here: (length s, centre sweep Hz start, peak, end, target dBFS).
WHOOSHES = {
    "whoosh": [(0.34, 350, 2600, 700, -19), (0.40, 300, 2200, 600, -19), (0.30, 420, 3000, 800, -19)],
    "whoosh-big": [(0.85, 180, 1400, 260, -20)],
}


def load(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def trim(a):
    """Starts 10 ms before the sound does, ends 40 ms after it has died away (1% of peak), with a 30 ms fade."""
    peak = np.abs(a).max() or 1.0
    loud = np.where(np.abs(a) > peak * 0.05)[0]
    quiet = np.where(np.abs(a) > peak * 0.01)[0]
    start = max(0, loud[0] - int(0.010 * RATE))
    end = min(len(a), quiet[-1] + int(0.040 * RATE))
    a = a[start:end].copy()
    fade = min(len(a), int(0.030 * RATE))
    a[-fade:] *= np.linspace(1, 0, fade)
    a[: int(0.002 * RATE)] *= np.linspace(0, 1, int(0.002 * RATE))
    return a


def loudness(a):
    peak = np.abs(a).max() or 1.0
    sounding = a[np.abs(a) > peak * 0.05]
    return 20 * np.log10(np.sqrt(np.mean(sounding**2)) + 1e-12)


def level(a, target):
    a = a * 10 ** ((target - loudness(a)) / 20)
    peak = np.abs(a).max()
    if peak > 0.89:  # -1 dBFS ceiling: loudness gives way rather than clip.
        a *= 0.89 / peak
    return a


def mix(packs, layers):
    parts = []
    for pattern, gain, at in layers:
        found = sorted(glob.glob(os.path.join(packs, pattern)))
        if not found:
            sys.exit(f"missing {pattern}")
        parts.append((trim(load(found[0])) * 10 ** (gain / 20), int(at * RATE)))
    out = np.zeros(max(len(p) + o for p, o in parts))
    for p, o in parts:
        out[o : o + len(p)] += p
    return out


def whoosh(length, f0, f1, f2, seed):
    """Noise through a band-pass whose centre rises to its peak at 60% and falls back: air past the ear."""
    rng = np.random.default_rng(seed)
    n = int(length * RATE)
    noise = rng.standard_normal(n)
    t = np.linspace(0, 1, n)
    rise = t < 0.6
    centre = np.where(rise, f0 * (f1 / f0) ** (t / 0.6), f1 * (f2 / f1) ** ((t - 0.6) / 0.4))
    out = np.zeros(n)
    y1 = y2 = x1 = x2 = 0.0
    q = 1.4
    for i in range(n):
        w = 2 * np.pi * centre[i] / RATE
        alpha = np.sin(w) / (2 * q)
        b0, b2, a0, a1, a2 = alpha, -alpha, 1 + alpha, -2 * np.cos(w), 1 - alpha
        x = noise[i]
        y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1, y2, y1 = x1, x, y1, y
        out[i] = y
    envelope = np.where(rise, (t / 0.6) ** 2, ((1 - t) / 0.4) ** 1.5)
    return out * envelope


def write(a, name):
    path = os.path.join(OUT, name + ".mp3")
    pcm = (np.clip(a, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "-", "-b:a", "96k", path],
        input=pcm,
        check=True,
    )


def main():
    packs = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, "*.mp3")):
        os.remove(old)
    for name, (target, variants) in RECIPE.items():
        for index, layers in enumerate(variants, 1):
            write(level(mix(packs, layers), target), f"{name}-{index}")
    for name, variants in WHOOSHES.items():
        for index, (length, f0, f1, f2, target) in enumerate(variants, 1):
            write(level(whoosh(length, f0, f1, f2, index), target), f"{name}-{index}")
    print(len(glob.glob(os.path.join(OUT, "*.mp3"))), "files in", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
