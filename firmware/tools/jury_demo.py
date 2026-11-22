#!/usr/bin/env python3
"""Démo jury au terminal : le scénario PNR joué sur les deux cartes du banc. Le récit est minuté ; les deux gestes du juré sont
détectés par les capteurs eux-mêmes : le briquet par le drone (hausse de température), la main par le capteur IR (MAYDAY).

    C:\\dev\\pnr-venv\\Scripts\\python.exe firmware\\tools\\jury_demo.py          (ports trouvés seuls : ESP32 CP210x, Nucleo ST-Link)
    C:\\dev\\pnr-venv\\Scripts\\python.exe firmware\\tools\\jury_demo.py --drone COM3 --hud COM4

Touches : ESPACE (secours, si un capteur ne réagit pas : l'étape est alors affichée « déclenchée à la main ») · R recommencer ·
Q quitter. --rise : hausse qui déclenche le feu (2 °C par défaut). --auto S : répétition minutée. Seule dépendance : pyserial.

The story steps run on timers. The fire step waits for the drone's real reading to rise (--rise above the room temperature, or
the configured threshold), the MAYDAY step for the board's real MAYDAY packet; ESPACE is only a fallback, and a step it
triggers says so on screen. What the boards send is shown live and labelled OBSERVED; no scaled or invented value is shown
(CLAUDE.md §4, R3). The HUD gets short words only (R2); « Décision : COS » is on this terminal, which plays the COS's PC. The
threshold and the whistle pressure come from data/config.json (R4). The board firmware is in firmware/drone_payload and
firmware/binome_hud; the free-text screen command {"cmd":"lcd",...} is the binome_hud one.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import threading
import time
import unicodedata
from collections import deque
from pathlib import Path

try:
    import serial
    from serial.tools import list_ports
except ImportError:  # pragma: no cover - the one dependency
    sys.exit("pyserial manque : C:\\dev\\pnr-venv\\Scripts\\python.exe -m pip install pyserial")

ROOT = Path(__file__).resolve().parents[2]
CFG = json.loads((ROOT / "data" / "config.json").read_text(encoding="utf-8"))["hypotheses"]
BAUD = CFG["hardware"]["baudRate"]["value"]
THRESHOLD_C = CFG["hardware"]["triggerThresholdC"]["value"]
STALE_S = CFG["hardware"]["staleAfterS"]["value"]
WHISTLE_BAR = CFG["ari"]["whistleBar"]["value"]

DRONE_VIDS = {0x10C4, 0x1A86}  # CP210x, CH340: the ESP32 DevKit bridges
HUD_VIDS = {0x0483}            # ST-Link virtual COM port of the Nucleo

RED, GREEN, YELLOW, CYAN, DIM, BOLD, RESET = "\033[91m", "\033[92m", "\033[93m", "\033[96m", "\033[2m", "\033[1m", "\033[0m"


# ----------------------------------------------------------------------------------------------------------------- boards
class Board(threading.Thread):
    """Reads one board's newline-delimited JSON packets; anything that is not a packet (boot text) is ignored, like the app."""

    def __init__(self, name: str, port: str | None, live: "Live"):
        super().__init__(daemon=True)
        self.name, self.port, self.live = name, port, live
        self.ser: serial.Serial | None = None
        self.error = ""
        if port:
            try:
                s = serial.Serial()
                s.port, s.baudrate, s.timeout = port, BAUD, 0.1
                s.dtr = False  # never reset the ESP32 by opening its port
                s.rts = False
                s.open()
                self.ser = s
            except serial.SerialException as e:
                self.error = str(e)

    def run(self) -> None:
        buf = b""
        while self.ser:
            try:
                buf += self.ser.read(512)
            except serial.SerialException as e:
                self.error, self.ser = str(e), None
                return
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("utf-8", "replace").strip()
                if line.startswith("{"):
                    try:
                        self.live.packet(json.loads(line))
                    except (ValueError, TypeError):
                        pass

    def send(self, obj: dict) -> None:
        if self.ser:
            try:
                self.ser.write((json.dumps(obj, ensure_ascii=True) + "\n").encode("ascii"))
            except serial.SerialException as e:
                self.error = str(e)


class Live:
    """The latest values the boards sent (OBSERVED), shared with the reader threads."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.temps: deque[float] = deque(maxlen=40)
        self.temp = self.alt = self.bar = None
        self.room = ""
        self.last_seen = {"drone-payload": 0.0, "binome-hud": 0.0}
        self.maydays: list[tuple[float, int]] = []  # (wall time, seq)
        self.baseline: float | None = None
        self.peak: float | None = None

    def packet(self, p: dict) -> None:
        sensor, value = p.get("sensor"), p.get("value")
        if not isinstance(value, (int, float)):
            return
        with self.lock:
            src = p.get("source", "")
            if src in self.last_seen:
                self.last_seen[src] = time.time()
            if sensor == "temp_bmp280":
                self.temp = float(value)
                self.temps.append(self.temp)
                self.room = p.get("room", self.room)
                if self.baseline is not None:
                    self.peak = self.temp if self.peak is None else max(self.peak, self.temp)
            elif sensor == "alt_bmp280":
                self.alt = float(value)
            elif sensor == "ari_bar":
                self.bar = float(value)
            elif sensor == "mayday" and value:
                self.maydays.append((time.time(), int(p.get("seq", -1))))

    def take_baseline(self) -> None:
        """The room temperature before the lighter: median of the last readings; the peak is measured from here."""
        with self.lock:
            recent = list(self.temps)[-6:]
            self.baseline = statistics.median(recent) if recent else None
            self.peak = None

    def silent(self, source: str) -> bool:
        return time.time() - self.last_seen[source] > STALE_S


# ----------------------------------------------------------------------------------------------------------------- helpers
def lcd_text(s: str) -> str:
    """16 columns of plain ASCII: the HD44780 has no accents."""
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")[:16]


def fmt(x: float | None, nd: int = 1) -> str:
    return "—" if x is None else f"{x:.{nd}f}".replace(".", ",")


def temp_lines(live: Live) -> list[str]:
    with live.lock:
        t, base, peak = live.temp, live.baseline, live.peak
    if t is None:
        return [f"{YELLOW}Aucun relevé du drone : vérifier la carte ESP32.{RESET}"]
    hot = peak if peak is not None else t
    line = f"Relevé du drone : {BOLD}{fmt(t)} °C{RESET} (OBSERVED)"
    if base is not None:
        line += f" · départ {fmt(base)} °C · {BOLD}hausse {'+' if hot - base >= 0 else ''}{fmt(hot - base)} °C{RESET}"
    return [line]


def temp_now_lines(live: Live) -> list[str]:
    """Before the fire: the reading only (the demo factor appears with the fire, not at room temperature)."""
    with live.lock:
        t = live.temp
    if t is None:
        return [f"{YELLOW}Aucun relevé du drone : vérifier la carte ESP32.{RESET}"]
    return [f"Relevé du drone : {BOLD}{fmt(t)} °C{RESET} (OBSERVED)"]


def air_lines(live: Live) -> list[str]:
    with live.lock:
        bar = live.bar
    if bar is None:
        return [f"{YELLOW}Aucune pression du HUD : vérifier la carte STM32.{RESET}"]
    side = f"{GREEN}au-dessus du sifflet{RESET}" if bar > WHISTLE_BAR else f"{RED}sous le sifflet{RESET}"
    return [f"Bouteille du chef de binôme : {BOLD}{fmt(bar, 0)} bar{RESET} (OBSERVED), {side} ({WHISTLE_BAR} bar)"]


def mayday_lines(live: Live) -> list[str]:
    with live.lock:
        last = live.maydays[-1] if live.maydays else None
    if not last:
        return [f"{DIM}Aucun MAYDAY reçu de la carte pour l'instant (le capteur IR envoie le sien au passage de la main).{RESET}"]
    return [f"{RED}MAYDAY reçu du HUD{RESET} (OBSERVED, seq {last[1]}, il y a {int(time.time() - last[0])} s)"]


def air_lcd(live: Live) -> tuple[str, str]:
    with live.lock:
        bar = live.bar
    return ("RETOUR SORTIE", "AIR --- bar" if bar is None else f"AIR {int(bar + 0.5):3d} bar")


# ----------------------------------------------------------------------------------------------------------------- scenario
# Each step: title, what the PC says, the live values to show, the HUD screen ("GO"/"NO-GO" = the normal screen with that alert,
# a pair = free text, a function = free text with a live value), the verdict on the PC, and what to do before the next ESPACE.
STEPS = [
    dict(title="Banc prêt",
         text="Le PC du COS reçoit les deux cartes en direct. Le drone de reconnaissance survole le stockage solvants ; le binôme 1 attend au sas d'entrée.",
         show=[temp_now_lines, air_lines], hud="GO", verdict="GO",
         wait=4, next="Le COS engage le binôme…"),
    dict(title="Engagement",
         text="Le COS engage le binôme 1 vers la victime, dans le stockage solvants : itinéraire, air et point de non-retour en direct.",
         show=[air_lines], hud=("BINOME ENGAGE", "GO > VICTIME"), verdict="GO", baseline=True,
         wait=None, trigger="heat", next="JURÉ : allumez le briquet à environ 10 cm sous le capteur du drone, jamais au contact."),
    dict(title="Départ de feu",
         text="Départ de feu dans le stockage solvants : la charge utile du drone relève une hausse de chaleur.",
         show=[temp_lines], hud=("! FEU DETECTE !", "STOCKAGE SOLV."), verdict="GO",
         wait=6, next="PNR réagit…"),
    dict(title="NO-GO",
         text="Chaleur anormale relevée par la charge utile dans le stockage solvants : le local devient critique et le verdict passe "
              "à NO-GO, verrouillé. Le binôme est rappelé par la sortie Ouest.",
         show=[temp_lines], hud=("!!! NO-GO !!!", "SORTIE OUEST <"), verdict="NO-GO",
         wait=7, next="JURÉ : tournez la vanne de la bouteille (le potentiomètre) vers le bas, maintenant."),
    dict(title="Air de la bouteille",
         text="La pression de la bouteille du chef de binôme alimente le point de non-retour : PNR recalcule le retour par la sortie Ouest.",
         show=[air_lines], hud=air_lcd, verdict="NO-GO",
         wait=None, trigger="mayday", live_hud=True, next="JURÉ : passez la main à environ 5 cm du capteur infrarouge (MAYDAY)."),
    dict(title="MAYDAY",
         text="MAYDAY du chef de binôme : le COS est alerté et l'équipe de secours est engagée.",
         show=[mayday_lines, air_lines], hud=("!!! MAYDAY !!!", "SECOURS ENGAGES"), verdict="NO-GO",
         wait=8, next="Le binôme sort…"),
    dict(title="Binôme sorti",
         text="Binôme sorti, air au-dessus du sifflet. Le NO-GO reste verrouillé : seul le COS peut ré-engager.",
         show=[air_lines], hud=("BINOME SORTI", "NO-GO VERROUILLE"), verdict="NO-GO",
         wait=5, next="Le COS décide : « Ré-engager (Décision : COS) »…"),
    dict(title="Ré-engagement",
         text="Ré-engager (Décision : COS) : l'objectif est retiré et le nouvel itinéraire part au HUD.",
         show=[air_lines], hud="GO", verdict="GO",
         wait=5, next="Fin de la démonstration…"),
    dict(title="Fin",
         text="Fin de la démonstration. Le verdict est une aide : la décision appartient au COS.",
         show=[], hud=("FIN DEMO PNR", "MERCI"), verdict=None,
         wait=None, next="R : recommencer · Q : quitter."),
]


def apply_hud(hud: Board, step: dict, live: Live) -> tuple[str, str] | str:
    h = step["hud"]
    if callable(h):
        h = h(live)
    if isinstance(h, str):
        hud.send({"cmd": "alert", "level": h})
        return h
    l1, l2 = lcd_text(h[0]), lcd_text(h[1])
    hud.send({"cmd": "lcd", "l1": l1, "l2": l2})
    return (l1, l2)


def draw(i: int, live: Live, drone: Board, hud: Board, screen, manual: bool = False) -> None:
    s = STEPS[i]
    out = ["\033[2J\033[H",
           f"{BOLD}PNR · démonstration sur le banc matériel{RESET}",
           f"{CYAN}{'█' * (i + 1)}{DIM}{'░' * (len(STEPS) - i - 1)}{RESET}  étape {i} / {len(STEPS) - 1} · {BOLD}{s['title'].upper()}{RESET}",
           "", s["text"], ""]
    if manual:  # the sensor did not trigger this step: the operator did, and the screen says so
        out.insert(5, f"{DIM}(étape déclenchée à la main){RESET}")
    for f in s["show"]:
        out += f(live)
    if s["verdict"]:
        col = GREEN if s["verdict"] == "GO" else RED
        out += ["", f"Verdict : {col}{BOLD}{s['verdict']}{RESET} — Décision : COS"]
    shown = f"écran normal, alerte {screen}" if isinstance(screen, str) else f"« {screen[0].strip()} » / « {screen[1].strip()} »"
    out += [f"HUD (écran du masque) : {shown}", "", f"{YELLOW}➜ {s['next']}{RESET}", ""]
    for b in (drone, hud):
        if b.error:
            out.append(f"{RED}{b.name} : {b.error}{RESET}")
    sys.stdout.write("\n".join(out) + "\n")
    sys.stdout.flush()


def status(live: Live) -> str:
    with live.lock:
        t, alt, bar, room = live.temp, live.alt, live.bar, live.room
    d = f"{DIM}drone silencieux{RESET}" if live.silent("drone-payload") else f"drone {fmt(t)} °C · alt {fmt(alt, 2)} m · {room}"
    h = f"{DIM}HUD silencieux{RESET}" if live.silent("binome-hud") else f"HUD {fmt(bar, 0)} bar"
    return f"\r\033[K{DIM}en direct (OBSERVED) :{RESET} {d}  |  {h}"


# ----------------------------------------------------------------------------------------------------------------- keys
def read_key() -> str | None:
    """One key press, or None if none is waiting (Windows: msvcrt; elsewhere: the terminal in cbreak mode, set in main)."""
    if os.name == "nt":
        import msvcrt
        if msvcrt.kbhit():
            k = msvcrt.getwch()
            if k in ("\x00", "\xe0"):  # arrow and function keys come as two characters
                msvcrt.getwch()
                return None
            return k
        return None
    import select
    if select.select([sys.stdin], [], [], 0)[0]:
        return sys.stdin.read(1)
    return None


def find_port(vids: set[int]) -> str | None:
    for p in list_ports.comports():
        if p.vid in vids:
            return p.device
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--drone", help="port du drone ESP32 (par défaut : trouvé par la puce USB)")
    ap.add_argument("--hud", help="port du HUD STM32 (par défaut : trouvé par la puce USB)")
    ap.add_argument("--rise", type=float, default=2.0, metavar="C",
                    help="hausse du relevé du drone au-dessus de son départ qui déclenche l'étape feu (défaut 2 °C ; le seuil de config.json aussi)")
    ap.add_argument("--auto", type=float, metavar="S", help="répétition à blanc : avance seule toutes les S secondes, puis quitte")
    a = ap.parse_args()
    if os.name == "nt":
        os.system("")  # turns on the ANSI colours of the Windows console
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        except (AttributeError, OSError):
            pass
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    live = Live()
    drone = Board("Drone (ESP32)", a.drone or find_port(DRONE_VIDS), live)
    hud = Board("HUD (STM32)", a.hud or find_port(HUD_VIDS), live)
    for b in (drone, hud):
        if not b.port:
            print(f"{YELLOW}{b.name} : aucune carte trouvée (préciser le port avec --drone / --hud).{RESET}")
        b.start()
    print(f"Drone : {drone.port or '—'} · HUD : {hud.port or '—'}. Lecture des capteurs…")
    time.sleep(2.0)

    old = None
    if os.name != "nt":
        import termios
        import tty
        old = termios.tcgetattr(sys.stdin)
        tty.setcbreak(sys.stdin.fileno())
    i, seen_maydays, manual = 0, 0, False
    try:
        while True:
            step = STEPS[i]
            if step.get("baseline"):
                live.take_baseline()
            screen = apply_hud(hud, step, live)
            draw(i, live, drone, hud, screen, manual)
            manual = False
            shown_at = last_hud = time.time()
            with live.lock:
                maydays_at_start = len(live.maydays)
            # The story steps run on their timer. A step with a trigger waits for the sensor: the drone's temperature rising
            # (heat) or the board's MAYDAY packet (mayday). --auto times every step, the triggered ones as « à la main ».
            wait = a.auto if a.auto else step["wait"]
            trigger = step.get("trigger")
            while True:
                now = time.time()
                if wait is not None and now - shown_at >= wait:
                    if i == len(STEPS) - 1:
                        return 0
                    manual = trigger is not None
                    i += 1
                    break
                fired = False
                with live.lock:
                    if trigger == "heat" and live.baseline is not None and live.peak is not None:
                        fired = live.peak - live.baseline >= a.rise or live.peak >= THRESHOLD_C
                    elif trigger == "mayday":
                        fired = len(live.maydays) > maydays_at_start
                if fired:
                    i += 1
                    break
                if step.get("live_hud") and now - last_hud >= 1.0:  # the bottle's pressure on the HUD as the juror turns it
                    screen, last_hud = apply_hud(hud, step, live), now
                with live.lock:
                    n = len(live.maydays)
                if n > seen_maydays:  # the board's own MAYDAY, the moment it arrives
                    seen_maydays = n
                    sys.stdout.write(f"\r\033[K{RED}{BOLD}MAYDAY reçu du HUD (OBSERVED){RESET}\n")
                sys.stdout.write(status(live))
                sys.stdout.flush()
                k = read_key()
                if k is None:
                    time.sleep(0.2)
                    continue
                k = k.lower()
                if k == " " and trigger is not None:  # fallback when a sensor does not react: shown as « à la main »
                    manual = True
                    i += 1
                    break
                if k == "r":
                    i = 0
                    break
                if k == "q":
                    return 0
    except KeyboardInterrupt:
        return 0
    finally:
        hud.send({"cmd": "alert", "level": "GO"})  # leave the HUD on its normal screen
        time.sleep(0.2)
        if old is not None:
            import termios
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old)
        sys.stdout.write(f"\n{RESET}")


if __name__ == "__main__":
    sys.exit(main())
