"""Downloads the public training and validation data into ml/data/raw/ (git-ignored: no raw data in the public repo).

  NIST mds2-2258  P-Flash synthetic detector data, 1 000 CFAST runs, three rooms        (MODELED)
  NIST mds2-2479  P-Flash range-house data, 20 000 CFAST runs, six rooms, doors          (MODELED)
  UL FSRI         fsri-compartments-2018, full-scale compartment fire experiments        (OBSERVED)
  UL FSRI         fsri-residential-gasburner-2016, gas burner in two houses (13 runs)    (OBSERVED)
  UL FSRI         fsri-hvac-gasburner-2019, gas burner in a house with basement (29 runs) (OBSERVED)

Standard library only, so it runs before the ML environment exists. Resumes partial files (HTTP Range), retries with
exponential backoff until a deadline, checks each NIST file against its published .sha256. Run the sets in separate
processes so a slow NIST server does not hold up FSRI:

  python ml/download.py fsri
  python ml/download.py fsri2016 fsri2019 --until never
  python ml/download.py nist2258 nist2479 --parts 1 --until 21:00
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAW = Path(__file__).parent / "data" / "raw"
LOG = RAW / "download.log"
UA = "pnr-hackathon-downloader/1.0"

NIST = {
    "nist2258": ("https://data.nist.gov/od/ds/mds2-2258/", ["P-Flash all data 2020-6-26.xlsx"]),
    "nist2479": (
        "https://data.nist.gov/od/ds/mds2-2479/",
        ["P-Flash_RangeHouse_SixCompartments_AllData_2021-1-9.xlsx"]
        + [f"RangeHouseData{a}-{a + 1999}.xlsx" for a in range(1, 20000, 2000)],
    ),
}
FSRI_REPO = "https://github.com/ulfsri/fsri-compartments-2018"
# Real multi-room experiments for the v4 model (OBSERVED): gas burners in houses, negatives for the neighbour features.
REPOS = {
    "fsri2016": ("https://github.com/ulfsri/fsri-residential-gasburner-2016", "02_Info"),
    "fsri2019": ("https://github.com/ulfsri/fsri-hvac-gasburner-2019", "02_Info"),
}


def log(msg: str) -> None:
    line = f"{dt.datetime.now():%H:%M:%S} {msg}"
    print(line, flush=True)
    RAW.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def deadline_passed(until: dt.datetime | None) -> bool:
    return until is not None and dt.datetime.now() >= until


def fetch(url: str, dest: Path, timeout: float) -> None:
    """One attempt: download url into dest, resuming from dest.part when the server allows ranges."""
    part = dest.with_name(dest.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    req = urllib.request.Request(url, headers={"User-Agent": UA, **({"Range": f"bytes={have}-"} if have else {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = resp.status
        if have and status != 206:
            have = 0  # the server ignored the range: start over
        mode = "ab" if have else "wb"
        total = resp.headers.get("Content-Length")
        log(f"  HTTP {status}, resuming at {have} B, {total or '?'} B to go: {dest.name}")
        with part.open(mode) as f:
            shutil.copyfileobj(resp, f, length=1 << 20)
    part.replace(dest)


def expected_sha(url: str, timeout: float) -> str | None:
    """The published digest (first 64-hex token of <url>.sha256), or None when it cannot be read."""
    try:
        req = urllib.request.Request(url + ".sha256", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", "replace")
        for tok in text.split():
            if len(tok) == 64 and all(c in "0123456789abcdefABCDEF" for c in tok):
                return tok.lower()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        log(f"  no checksum for {url.rsplit('/', 1)[-1]}: {e}")
    return None


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def download(url: str, dest: Path, until: dt.datetime | None, timeout: float) -> bool:
    ok_marker = dest.with_name(dest.name + ".ok")
    if dest.exists() and ok_marker.exists():
        log(f"already verified: {dest.name}")
        return True
    delay = 30.0
    attempt = 0
    while not deadline_passed(until):
        attempt += 1
        try:
            log(f"try {attempt}: {url}")
            fetch(url, dest, timeout)
            want = expected_sha(url, timeout)
            got = sha256(dest)
            if want and want != got:
                log(f"  checksum MISMATCH for {dest.name}: want {want}, got {got}; deleting")
                dest.unlink()
            else:
                ok_marker.write_text(f"{got}\n{'verified' if want else 'no published checksum'}\n", encoding="utf-8")
                log(f"  OK {dest.name} {dest.stat().st_size} B sha256 {got[:12]}… ({'verified' if want else 'unverified'})")
                return True
        except urllib.error.HTTPError as e:
            log(f"  HTTP {e.code} {e.reason}")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            log(f"  error: {e}")
        log(f"  retry in {int(delay)} s")
        time.sleep(delay)
        delay = min(delay * 1.6, 300.0)
    log(f"deadline reached, giving up on {dest.name}")
    return False


def clone_fsri(until: dt.datetime | None) -> bool:
    dest = RAW / "fsri-compartments-2018"
    if (dest / ".git").exists() and (dest / "02_Info").exists():
        log("FSRI already cloned")
        return True
    delay = 30.0
    while not deadline_passed(until):
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        log(f"git clone --depth 1 {FSRI_REPO}")
        r = subprocess.run(["git", "clone", "--depth", "1", FSRI_REPO, str(dest)], capture_output=True, text=True)
        if r.returncode == 0:
            log("FSRI cloned")
            return True
        log(f"  clone failed: {r.stderr.strip()[-300:]}; retry in {int(delay)} s")
        time.sleep(delay)
        delay = min(delay * 1.6, 300.0)
    return False


def clone_repo(key: str, until: dt.datetime | None) -> bool:
    """git clone --depth 1 of one of REPOS into ml/data/raw/<repo name>, retried until the deadline."""
    url, marker = REPOS[key]
    dest = RAW / url.rsplit("/", 1)[-1]
    if (dest / ".git").exists() and (dest / marker).exists():
        log(f"{dest.name} already cloned")
        return True
    delay = 30.0
    while not deadline_passed(until):
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        log(f"git clone --depth 1 {url}")
        r = subprocess.run(["git", "clone", "--depth", "1", url, str(dest)], capture_output=True, text=True)
        if r.returncode == 0:
            log(f"{dest.name} cloned")
            return True
        log(f"  clone failed: {r.stderr.strip()[-300:]}; retry in {int(delay)} s")
        time.sleep(delay)
        delay = min(delay * 1.6, 300.0)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sets", nargs="+", choices=["nist2258", "nist2479", "fsri", *REPOS])
    ap.add_argument("--parts", type=int, default=1, help="mds2-2479: how many 2 000-run data files after the summary file")
    ap.add_argument("--until", default="21:00", help="stop retrying at this local time (HH:MM), or 'never'")
    ap.add_argument("--timeout", type=float, default=180.0, help="socket timeout per request, s")
    args = ap.parse_args()
    until = None
    if args.until != "never":
        hh, mm = (int(x) for x in args.until.split(":"))
        until = dt.datetime.now().replace(hour=hh, minute=mm, second=0, microsecond=0)
    ok = True
    for s in args.sets:
        if s == "fsri":
            ok &= clone_fsri(until)
            continue
        if s in REPOS:
            ok &= clone_repo(s, until)
            continue
        base, files = NIST[s]
        if s == "nist2479":
            files = files[: 1 + args.parts]
        for name in files:
            ok &= download(base + urllib.parse.quote(name), RAW / s / name, until, args.timeout)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
