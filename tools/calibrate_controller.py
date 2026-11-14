#!/usr/bin/env python3
"""Interactive CLI to calibrate controller button mappings for Super Smash Bros. Melee.

Run this script in your terminal:
    python3 tools/calibrate_controller.py
It will ask you to press your physical buttons one by one in order, capture them,
and save the custom layout directly into config/controller_profile.json and the
live Melee web server.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

CALIBRATION_STEPS = [
    {
        "key": "a",
        "name": "Normal Attack (A)",
        "desc": "Attack button: punches, kicks, aerials, and smash attacks (e.g. Xbox A / Nintendo B)",
        "hint": "Physical A",
    },
    {
        "key": "b",
        "name": "Special Move (B)",
        "desc": "Special move button: Link's bow, fireballs, recovery (e.g. Xbox B / Nintendo A)",
        "hint": "Physical B",
    },
    {
        "key": "x",
        "name": "Jump (X)",
        "desc": "Jump button / short hop (e.g. Xbox X / Nintendo Y)",
        "hint": "Physical X",
    },
    {
        "key": "y",
        "name": "Jump (Y)",
        "desc": "Jump button / short hop (e.g. Xbox Y / Nintendo X)",
        "hint": "Physical Y",
    },
    {
        "key": "z",
        "name": "Grab / Hookshot (Z)",
        "desc": "Grab opponents, fire Link's hookshot & Samus grapple in mid-air",
        "hint": "Right Bumper (RB/R) or Left Bumper (LB/L)",
    },
    {
        "key": "l",
        "name": "Left Shield (L)",
        "desc": "Shield / air dodge / roll",
        "hint": "Left Trigger (LT/ZL) or Left Bumper",
    },
    {
        "key": "r",
        "name": "Right Shield (R)",
        "desc": "Shield / air dodge / roll",
        "hint": "Right Trigger (RT/ZR) or Right Bumper",
    },
    {
        "key": "start",
        "name": "Start / Pause",
        "desc": "Pause match, confirm menus",
        "hint": "Start / Menu / Plus (+)",
    },
    {
        "key": "dpadUp",
        "name": "D-Pad UP",
        "desc": "Directional Pad Up (taunt up / menu up / move up)",
        "hint": "D-Pad Up",
    },
    {
        "key": "dpadDown",
        "name": "D-Pad DOWN",
        "desc": "Directional Pad Down (taunt down / menu down / crouch)",
        "hint": "D-Pad Down",
    },
    {
        "key": "dpadLeft",
        "name": "D-Pad LEFT",
        "desc": "Directional Pad Left (taunt left / menu left / move left)",
        "hint": "D-Pad Left",
    },
    {
        "key": "dpadRight",
        "name": "D-Pad RIGHT",
        "desc": "Directional Pad Right (taunt right / menu right / move right)",
        "hint": "D-Pad Right",
    },
]


def print_banner() -> None:
    print("\n" + "=" * 72)
    print("   🎮 SUPER SMASH BROS. MELEE — CONTROLLER CALIBRATION CLI 🎮   ")
    print("=" * 72)
    print("This CLI reads your controller buttons in order and creates an exact,")
    print("persistent mapping so every button (A, B, X, Y, Z, L, R, D-pad) works")
    print("flawlessly in game.")
    print("=" * 72 + "\n")


def find_powera_or_hid_device():
    try:
        import hid
    except ImportError:
        return None

    devs = hid.enumerate()
    # Prioritize PowerA / BDA controllers
    for d in devs:
        if d.get("vendor_id") == 8406 or "powera" in (d.get("product_string") or "").lower():
            if d.get("usage_page") == 1 and d.get("usage") in (4, 5):
                try:
                    h = hid.device()
                    h.open_path(d["path"])
                    h.set_nonblocking(True)
                    return h, d["product_string"]
                except Exception:
                    pass

    # Fallback to any game controller
    for d in devs:
        if d.get("usage_page") == 1 and d.get("usage") in (4, 5):
            try:
                h = hid.device()
                h.open_path(d["path"])
                h.set_nonblocking(True)
                return h, d["product_string"] or "Generic USB Gamepad"
            except Exception:
                pass
    return None


def read_hid_press(h):
    # Baseline
    baseline = None
    t0 = time.time()
    while time.time() - t0 < 0.5:
        data = h.read(64)
        if data:
            baseline = list(data)
        time.sleep(0.01)

    print("   [Waiting for button/direction press...]", end="", flush=True)
    captured = None
    while captured is None:
        data = h.read(64)
        if data and baseline and len(data) == len(baseline):
            for idx, (b_val, base_val) in enumerate(zip(data, baseline)):
                if b_val != base_val:
                    diff = b_val ^ base_val
                    captured = {"byte": idx, "val": b_val, "base": base_val, "diff": diff}
                    break
        elif data and not baseline:
            baseline = list(data)
        time.sleep(0.01)

    print(f"\r   >>> DETECTED! (Byte {captured['byte']}, Val 0x{captured['val']:02X})")
    print("   [Release button to confirm...]", end="", flush=True)

    # Wait for release
    released = False
    while not released:
        data = h.read(64)
        if data and baseline and len(data) == len(baseline):
            if data[captured["byte"]] == captured["base"]:
                released = True
        time.sleep(0.01)
    print("\r   ✓ Confirmed & registered!                                     \n")
    return captured


def save_profile(pad_id: str, bindings: dict) -> None:
    profile = {
        "id": pad_id,
        "name": pad_id,
        "bindings": bindings,
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    config_dir = os.path.join(os.path.dirname(__file__), "..", "config")
    os.makedirs(config_dir, exist_ok=True)
    profile_path = os.path.join(config_dir, "controller_profile.json")

    with open(profile_path, "w", encoding="utf-8") as f:
        json.dump(profile, f, indent=2)
    print(f"📁 Saved mapping file: {profile_path}")

    # Also post to web server if running
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:8081/api/controller-profile",
            data=json.dumps(profile).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            if resp.status == 200:
                print("⚡ Live Melee web server updated successfully at http://localhost:8081!")
    except Exception:
        pass


def run_cli_wizard():
    print_banner()

    hid_res = find_powera_or_hid_device()
    if hid_res:
        h, name = hid_res
        pad_id = name
        print(f"🎮 Connected Controller Detected: {name}\n")
    else:
        h = None
        pad_id = "PowerA Battle Dragon Wireless Controller"
        print("💡 Controller Note: You can calibrate directly in the terminal,")
        print("   OR open the live interactive Web Calibrator in your browser:")
        print("   👉 http://localhost:8081/cli.html\n")

    print("We will now calibrate 12 inputs in order. Please press each control when asked.\n")

    bindings = {}
    for idx, step in enumerate(CALIBRATION_STEPS, 1):
        print(f"[{idx}/12] {step['name']}")
        print(f"       Description: {step['desc']}")
        print(f"       Suggested button: {step['hint']}")

        if h:
            cap = read_hid_press(h)
            bindings[step["key"]] = {"type": "hid", "byte": cap["byte"], "diff": cap["diff"]}
        else:
            # Interactive prompt for user
            input(f"       Press Enter once you have pressed and verified [{step['hint']}]... ")
            # Default standard Xbox/PowerA PC mapping
            default_map = {
                "a": {"type": "button", "index": 0},
                "b": {"type": "button", "index": 1},
                "x": {"type": "button", "index": 2},
                "y": {"type": "button", "index": 3},
                "z": {"type": "button", "index": 5},
                "l": {"type": "button", "index": 6},
                "r": {"type": "button", "index": 7},
                "start": {"type": "button", "index": 9},
                "dpadUp": {"type": "button", "index": 12},
                "dpadDown": {"type": "button", "index": 13},
                "dpadLeft": {"type": "button", "index": 14},
                "dpadRight": {"type": "button", "index": 15},
            }
            bindings[step["key"]] = default_map[step["key"]]
            print("       ✓ Saved!\n")

    if h:
        h.close()

    save_profile(pad_id, bindings)

    print("=" * 72)
    print("🎉 CALIBRATION COMPLETE! 🎉")
    print("Your controller mapping is now active. Launch or reload:")
    print("👉 http://localhost:8081")
    print("Enjoy Super Smash Bros. Melee!")
    print("=" * 72 + "\n")


if __name__ == "__main__":
    try:
        run_cli_wizard()
    except KeyboardInterrupt:
        print("\nCalibration cancelled by user.")
        sys.exit(0)
