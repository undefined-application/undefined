# Candidate repos to test/demo on

> **Updated Fri 25 Sep 2026 after the git-signal spike.** Full evidence, numbers and exact lines are in `docs/spike-results.md`.
> We screened 47 repos across SAAB-adjacent domains (aero, space, radar/SDR/ATC, automotive safety, industrial, RTOS) and spiked 13 with blobless clones.

## Primary: ArduPilot

https://github.com/ArduPilot/ardupilot

- GPL-3.0, C++. History since 2010, 74k commits, ~1.4k contributors. A real autopilot for planes, copters, subs and rovers: aerospace flavoured and mission-critical, without being SAAB's own code.
- **Deep scope:** `libraries/AP_InertialSensor` (IMU drivers, 59 files). Smaller alternative: `libraries/AP_Baro` (51 files).
  - Paths have been stable since 2011, so blame and introduced-by work.
  - 11–12% of commits in these paths carry HW rationale, and there are many "datasheet" / "undocumented quirk" comments.
- **Killer demo evidence:** the temperature-based FIFO integrity check in `AP_InertialSensor_Invensense.cpp` looks redundant.
  - It was disabled in [PR #21937](https://github.com/ArduPilot/ardupilot/pull/21937) (merged), then reverted 10 days later in [PR #22034](https://github.com/ArduPilot/ardupilot/pull/22034): "this leads to bad IMU data on ICM20602".
  - That's SAAB's "redundant-looking line guards a HW anomaly" playing out in real life. The reviewer takes upstream PR #21937 directly and gives it STOP (verified; see `docs/status.md`), so no fork is needed for the STOP demo.
- Backup fences:
  - the DPS310 chip-select toggle (`46f35a6910`, whose author says "we don't know how the sensor gets in this state", which makes it a great **Unknown** example);
  - the IST8310 writeable-WHOAMI reset (`68b58d5435`).

## Fallback: RTEMS (SPARC / LEON BSPs)

https://github.com/RTEMS/rtems

- A space RTOS with 30+ years of history. `bsps/sparc/leon3` targets rad-hard LEON3FT CPUs (GR712RC, UT699) used in ESA missions.
- Errata workarounds are tied to public Gaisler technical notes. Examples:
  - `b2da982c87`, GRLIB-TN-0018, triggered only by radiation-induced ECC corrections ([PDF](https://download.gaisler.com/technical_notes/GRLIB-TN-0018.pdf)).
- **Pitch anecdote:** early SPARC patches came from Jiri Gaisler at `ce.chalmers.se`. Gaisler (Gothenburg) builds ESA's LEON processors.
- Why it isn't primary:
  - the best workarounds live in `.S` assembly, which our C/C++ scanner doesn't parse;
  - the rationale ratio is low (4%);
  - paths moved in 2017.

## Dropped: PX4-Autopilot (previous primary)

- The sensor drivers were rewritten around 2019. They have short history (20–50 commits per driver) and almost no rationale comments.
- We found no workaround line whose commit states the HW reason.
- The Silicon Errata page covers STM32/board issues, not these drivers.
- Still a fine repo for a second "does it generalise?" scan if time allows.

## Dropped: NASA cFS / cFE

- A software framework with almost no HW-quirk history: 3 strict HW-anomaly commits out of 1.2k in cFE.
- The directory reorganisation in 2021 cut path history.

## Ruled out earlier

- **Saab's own GitHub** (github.com/saab): checked, 11 repos, nothing legacy/embedded/firmware. There's a Lua project, a GraphHopper fork, a C++ template lib, an MPSoC thesis, viser and time-fakes. Safir SDK (Saab's open-source middleware) exists, but it's modern distributed real-time middleware, not a legacy codebase to analyze.
- **legacycoderocks/awesome-legacy-code** list: checked. The entries are vintage/retro-computing curiosities:
  - Apollo-11 AGC assembly;
  - MS-DOS 1.x/2.0;
  - PDP-10 ITS;
  - Prince of Persia for the Apple II;
  - Commodore source;
  - GW-BASIC.

  No modern static-analysis tooling handles raw assembly or ancient BASIC well in a weekend. None of them represent SAAB's actual scenario, a current maintainer facing an unfamiliar industrial embedded codebase.
  **Exception:** the Apollo-11 AGC "DO NOT MODIFY" comment folklore is a good 10-second pitch opener, just not a build target.
- **Screened out in the spike** (details in `docs/spike-results.md`):
  - comma.ai panda, HackRF, dump1090, bladeRF, UHD, Paparazzi, LibrePilot and INAV all had thin or scattered HW-rationale signal;
  - multiwii, rtl-sdr, grbl, CANopenNode, pok and OpenSatKit were too small or immature;
  - Zephyr, NuttX, u-boot, Marlin, Klipper, Betaflight and rusefi were too generic or too big for the story.
