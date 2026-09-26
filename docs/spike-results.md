# Git-signal spike results (Fri 25 Sep 2026)

> This is the gate from `docs/plan.md` §7 and Prompt 01a Step 0. It was run wider than planned: we screened 47 repos and spiked 13.
> **Result: switch the demo target from PX4 to ArduPilot** (`libraries/AP_InertialSensor`). RTEMS SPARC/LEON is the fallback and a pitch anecdote.
> All SHAs, lines and PRs below were checked with `git show` / `git blame` / `gh` at ArduPilot `master` = `9f648ccabcf25a421192dc5b57491ce981506872`.

## Recommendation

| | Repo | Deep scope | Why |
|---|---|---|---|
| **Primary** | [ArduPilot/ardupilot](https://github.com/ArduPilot/ardupilot) (GPL-3.0, since 2010, 74k commits, 1.4k contributors) | `libraries/AP_InertialSensor` (59 files, 21.8k LOC). Smaller alternative: `libraries/AP_Baro` (51 files, 9.1k LOC) | It has a **real, documented case of exactly SAAB's warning**: a redundant-looking sanity check was removed, the PR was merged, and 10 days later it was reverted because it caused bad IMU data (see below). Stable paths since 2011, so blame and introduced-by work. Commit messages state HW rationale explicitly, and some admit the root cause is unknown, which is a perfect showcase for Verified vs Unknown. |
| Fallback | [RTEMS/rtems](https://github.com/RTEMS/rtems), SPARC/LEON BSPs | `bsps/sparc/leon3` (30 files, 5.4k LOC) | Space-grade (ESA LEON3FT / GR712RC / UT699 rad-hard CPUs), with errata workarounds tied to public Gaisler technical notes. But the best workarounds are in `.S` assembly, which our tree-sitter C/C++ pipeline doesn't parse, and paths moved in 2017. |

## Demo line for the STOP PR

**File:** `libraries/AP_InertialSensor/AP_InertialSensor_Invensense.cpp`
**Lines:** 618–630 (the FIFO sample path), plus the same pattern at 668–680. The check itself is `_check_raw_temp()` at 860–874.

```cpp
int16_t t2 = int16_val(data, 3);
if (!_check_raw_temp(t2)) {          // <- "why does an IMU driver compare temperatures to reset its FIFO?"
    if (_enable_fast_fifo_reset) {
        _fast_fifo_reset();
        return false;
    } else {
        ...
        _fifo_reset(true);
        return false;
    }
}
```

It looks redundant: the driver reads temperature from the FIFO packet, and if the value jumps it throws the whole sample away and resets the FIFO. It's really a side-channel integrity check for FIFO misalignment.

**The history** (every step verified):

| Date | Commit / PR | Who | What the message says |
|---|---|---|---|
| 2016-11-09 | `d2f6a514b9` | Andrew Tridgell | "AP_InertialSensor: catch FIFO alignment errors using temperature reading. Two cases of what seems to be FIFO alignment errors have been seen on a Pixracer-beta board with a ICM-20608. At a cost of 2 extra bytes per transfer we can catch these by looking for sudden temperature changes caused by bad data in the temperature registers." |
| 2016-11-09 | `46785e8ecf` | Andrew Tridgell | "improved method for FIFO integrity checking: check temperature every 255 samples against FIFO data" |
| 2022-10-12 | `05f8e3c18d`, [PR #21937](https://github.com/ArduPilot/ardupilot/pull/21937) | bugobliterator | **Disables the check on ICM20602.** PR body: "numerous reports of ICM20602 showing temp reset… although the Temperature data is invalid, the rest of the data in FIFO is valid." **Merged.** |
| 2022-10-22 | `9fa3a433f5`, [PR #22034](https://github.com/ArduPilot/ardupilot/pull/22034) | Andrew Tridgell | **Revert.** "this leads to bad IMU data on ICM20602" |
| 2022-10-22 | `5096023eef` | bugobliterator | Proper fix: "add fast reset for ICM20602 instead of full reset on bad temp sample" |

**What the demo shows:** we re-open PR #21937's change in our fork. The tool should flag STOP or DANGEROUS by rule floor, for these reasons:
- the line was introduced by a commit whose message states a HW anomaly (FIFO alignment errors on ICM-20608);
- `git blame` line 619 points to a **Revert** commit;
- it's on the IMU sample path, which is flight-critical;
- **no related test was found**: there are no unit tests for the Invensense driver, only `Tools/renode/tests/KakuteF4-invensense-i2c.hwdef`.

Pitch line: *"This exact PR was merged in real life. It was reverted 10 days later because the IMU produced bad data. Our tool would have stopped it before merge."*

**Labels the chat should produce:**
- **Verified:** "the check exists to catch FIFO alignment errors" (commit `d2f6a514b9` states it) and "disabling it caused bad IMU data on ICM20602" (`9fa3a433f5`).
- **Inferred:** the ICM20602 still has occasional invalid temperature words (from the PR #21937 body; a single observation).
- **Unknown:** the silicon root cause. Nobody in the history states it.
- **Ask the author:** Andrew Tridgell (`andrew@tridgell.net`, GitHub `tridge`).

**Note on blame:** blame follows the rename `AP_InertialSensor_MPU6000.cpp` → `AP_InertialSensor_Invensense.cpp`, so lines from 2015–2016 still resolve to their original commits.

### Backup STOP lines (same repo, single explicit commits)

- `libraries/AP_Baro/AP_Baro_DPS280.cpp:168-172`: `set_chip_select(true); set_chip_select(false);` toggles CS and does nothing else. It looks like dead code.
  - Commit `46f35a6910` (Tridgell, 2021-03-31, [PR #17054](https://github.com/ArduPilot/ardupilot/pull/17054)): "fixes an issue with bad read of WHOAMI on a mRoPixracerPro. **We don't know how the sensor gets in a state where WHOAMI can't be read**, but toggling CS does fix it."
  - This is the ideal Verified (the fix) plus Unknown (the cause) example.
- `libraries/AP_Compass/AP_Compass_IST8310.cpp:129-130`: soft reset plus `delay(10)` before the WHOAMI probe.
  - Commit `68b58d5435` (2024-04-30): the WAI register is **writeable and persists across power cycles**, so it has to be reset first.

### SAFE PR

Change only a comment or a `debug(...)` string in the same file, for example line 625. The change-class rule (plan §5, Tab 4) makes it SAFE.

## Spike numbers

These are per deep-scope candidate, from `git log --no-merges -- <path>` on blobless clones. "Rationale" is the share of commits whose messages match `errata|silicon|workaround|quirk|revision|glitch|spurious|race|timing|timeout|delay|reset|retry|hang|datasheet`. Comment markers count `errata|workaround|quirk|hack|datasheet|do not|XXX|FIXME`.

| Repo / path | Commits | Rationale | Reverts | Authors | History span* | Files | LOC | Comment markers | Signals |
|---|---|---|---|---|---|---|---|---|---|
| **ArduPilot `AP_InertialSensor`** | 1355 | 163 (12%) | 4 | 101 | 2011–2026 | 59 | 21.8k | 49 | 128 |
| **ArduPilot `AP_Baro`** | 689 | 80 (11%) | 2 | 96 | 2011–2026 | 51 | 9.1k | 20 | 64 |
| PX4 `barometer/ms5611` | 50 | 3 (6%) | 0 | 12 | 2018–2026 | 6 | 1.4k | 4 | 8 |
| PX4 `barometer/bmp388` | 33 | 5 (15%) | 0 | 13 | 2019–2026 | 3 | 0.7k | 0 | 14 |
| PX4 `barometer/dps310` | 20 | 0 | 0 | 12 | 2019–2026 | 6 | 0.9k | 0 | 2 |
| PX4 `imu/invensense/icm20602` | 39 | 7 (17%) | 0 | 6 | 2019–2026 | 4 | 1.2k | 0 | 12 |
| PX4 `imu/invensense/icm42688p` | 49 | 11 (22%) | 0 | 12 | 2020–2026 | 4 | 1.6k | 0 | 13 |
| RTEMS `bsps/sparc/leon3` | 167 | 8 (4%) | 0 | 19 | 2017–2026 | 30 | 5.4k | 9 | 153 |
| NASA cFE `modules/es` | 139 | 12 (8%) | 2 | 17 | 2021–2026 | 65 | 28.5k | 26 | 27 |

\*History span without `--follow`. PX4 (2018/19), RTEMS (2017) and cFE (2021) all reorganised directories. With `--follow`, PX4 `ms5611.cpp` reaches back to 2012.
**Implication for Prompt 01a:** git mining must use `git log --follow` per file, not per directory. Otherwise pre-move history silently disappears.

**Strict HW-anomaly commits repo-wide** (`errat|silicon|workaround|quirk|chip rev|hw bug|hardware bug|anomal|glitch|spurious`):

| Repo | Count |
|---|---|
| ArduPilot | 286 / 73.9k |
| RTEMS | 269 / 38.4k |
| PX4 | 205 / 47.7k, but only ~28 touch `src/drivers`, mostly generic |
| LibrePilot | 89 |
| UHD | 61 |
| INAV | 58 |
| bladeRF | 30 |
| Paparazzi | 30 |
| HackRF | 21 |
| dump1090 (FlightAware) | 15 |
| panda | 10 |
| cFE | 3 |
| PSP | 1 |

## Why not PX4 (the previous primary)

- The barometer and IMU drivers were rewritten around 2019. Their history is short (20–50 commits), and there are almost no rationale comments (0–4 markers).
- We found no workaround line whose commit explicitly states the HW reason.
- The PX4 Silicon Errata page covers STM32/board issues, not these sensor drivers, so it wouldn't back up a driver-level demo.

## RTEMS: fallback and pitch anecdote

- It carries real rad-hard CPU errata workarounds with public ground truth. Examples:
  - `b2da982c87` "work around GRLIB-TN-0018 errata", triggered only when radiation-induced ECC corrections hit ([TN-0018 PDF](https://download.gaisler.com/technical_notes/GRLIB-TN-0018.pdf), [RTEMS #4155](https://devel.rtems.org/ticket/4155));
  - `bdcc814343` GRLIB-TN-0011;
  - `26b11e3830` GR712RC power-down errata;
  - `ddc95ab04b`, a C-level L2 cache scrubber workaround citing the GR740 UM §43.2.30. The file now lives at `bsps/shared/grlib/l2c/l2c.c`.
- **Local angle for the pitch:** early SPARC BSP patches came from **Jiri Gaisler <jgais@ce.chalmers.se>** (1999, Chalmers). Gaisler, now Frontgrade Gaisler, is the Gothenburg company behind ESA's LEON processors.
- Downsides:
  - most errata fixes are in `.S` files, which tree-sitter C/C++ doesn't parse;
  - only 4% of commits touching `leon3` carry rationale keywords;
  - pre-2017 history sits under `c/src/lib/libbsp`.

## Screened out

The screening data is `gh api` repo metadata for 47 repos, grouped by SAAB business area (aero, space, radar/SDR/ATC, automotive safety, industrial, RTOS).

- **Too small or immature** (< ~1k commits, or no licence): multiwii, antirez/dump1090, mutability/dump1090, osmocom/rtl-sdr, OpenSatKit, pok, CANopenNode, grbl, libmodbus.
- **Spiked, but thin HW-rationale signal:**
  - panda (10 strict commits), HackRF (21), FlightAware dump1090 (15), bladeRF (30), Paparazzi (30 of 15.7k);
  - NASA cFE and PSP (3 and 1; a software framework with no HW quirks);
  - UHD (61 of 11k, spread thin);
  - LibrePilot (the signal is mostly in the Qt ground station);
  - INAV (decent, but ArduPilot has the same domain with a richer history).
- **Not spiked:** Zephyr, NuttX, u-boot, Marlin, Klipper, Betaflight, rusefi. They're either generic RTOS / hobby domains or much larger clones (rusefi is 1.6 GB), and ArduPilot already covers the aerospace sensor-driver story.

## Practical notes for the build

- `git clone --filter=blob:none` of ArduPilot takes about 20 s and 66 MB, and history, log and blame all work. Use `git sparse-checkout` for the deep scope.
  - `git grep` and `git log -S` over a blobless clone fetch blobs lazily and are slow, so avoid them over the whole history.
- `blame` on the demo lines runs in about 1 s.
- Fork `ArduPilot/ardupilot` into the team org and open two PRs there:
  - **STOP:** re-apply `05f8e3c18d`. Update: this isn't needed; the reviewer takes upstream PR #21937 directly (see below).
  - **SAFE:** a comment or debug-string-only change. This is still to do (`docs/status.md`).

## Reproduced by the product (Fri 25 Sep, 23:45)

The built pipeline confirms the spike on the same commit (`9f648ccabc`):

- **Clone and history.**
  - A blobless clone takes ~6 s, not 20 s.
  - Every historical blob of the deep scope (2,934 blobs) comes in one `fetch --stdin` in ~1 s. After that, blame and `git log -L` run fully offline (a blame of the Invensense driver takes 0.8 s).
  - `git sparse-checkout` isn't needed: the scan reads blobs straight from the bare clone.
- **PR #21937 → STOP.**
  - Blame alone would have missed it. At the merge base (`c801f12a78`), the changed line `if (!_check_raw_temp(t2)) {` is blamed on `771cedca3d` "reduced number of SPI transfers", a refactor.
  - Its `git log -L` history reaches `46785e8ecf` ("FIFO integrity checking") and `d2f6a514b9` ("catch FIFO alignment errors…"), which the reviewer cites as the key commit.
- **Line 619 at master** is blamed on the revert `9fa3a433f5`, which the stage 2 git mining links to the reverted `05f8e3c18d`.
- **Comment-only commits are SAFE:** `e25a391a8f`, `12c10dce32`, `3ad346a3af`.
- **New finding:** `AP_InertialSensor_Invensense_registers.h` is also included by the barometer driver `AP_Baro_ICM20789.cpp`. That is a cross-driver coupling found by the whole-repo reference index.
