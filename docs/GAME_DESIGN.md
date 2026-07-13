# LOOSE CABLES 3D — Full Game Design Document

> **Version:** 1.0 · **Target platform:** Reddit (Devvit Web) · **Engine:** three.js + cannon-es
> **Document owners:** Creative Direction, Game Design, Level Design, Systems Design, Art, Audio, UX, Engineering, QA, Live Ops
> This document transforms the current prototype (difficulty menu + endless procedural levels) into a polished, retention-driven Reddit game with a road-map campaign, themed worlds, UGC tools, and a complete audio/visual identity.

---

## Table of Contents

1. [Creative Director — Vision & Pillars](#1-vision--pillars)
2. [Game Designer — Core Loop, Hook & Mechanics](#2-core-loop-hook--mechanics)
3. [Systems Designer — Progression, Economy & Retention](#3-progression-economy--retention)
4. [Level Designer — World Map, Worlds & Level Design](#4-world-map-worlds--level-design)
5. [Level Design Tools & UGC](#5-level-design-tools--ugc)
6. [Art Director — Visual Design](#6-visual-design)
7. [Audio Designer — Complete SFX & Music Spec](#7-audio-design-sfx--music)
8. [UX Designer — Screens, Flows & HUD](#8-ux-screens--flows)
9. [Reddit / Devvit Integration & Live Ops](#9-reddit--devvit-integration)
10. [Engineering — Technical Architecture](#10-technical-architecture)
11. [QA Lead — Test Plan](#11-qa-plan)
12. [Production — Roadmap & Milestones](#12-roadmap)

---

# 1. Vision & Pillars

**(Creative Director)**

## 1.1 One-liner

> *"Every desk hides a nightmare. Untangle it."* — A tactile 3D cable-untangling puzzler where real physics makes every knot feel like YOUR knot, and every clean desk feels earned.

## 1.2 The Fantasy

You are the one person in the office / server room / gaming den who can look at a horrifying nest of cables and calmly make it beautiful. The game sells **the satisfaction of restoring order** — the same itch as power-washing games, cable-management subreddits (r/cableporn has 1M+ members — this IS our audience), and zen organizing sims.

## 1.3 Design Pillars

| # | Pillar | What it means | What it kills |
|---|--------|---------------|---------------|
| P1 | **Tactile Satisfaction** | Physics cables that sag, drape, knot and *snap free* with juicy feedback. Every interaction must feel physical. | Abstract line-puzzle visuals, instant teleports, dry UI |
| P2 | **One More Socket** | Sessions are 60–180 seconds. The auto-resolve cascade is our dopamine engine — clearing one cable frees another, which frees two more. | Levels longer than 4 minutes, mandatory grinding |
| P3 | **Climb the Cabinet** | Progress is spatial and visible: a vertical road map you literally climb, from a tidy desk drawer to the Nightmare Datacenter. | Flat difficulty menus, invisible progression |
| P4 | **Reddit is the Meta-game** | Daily puzzles, community levels, sabotage remixes and leaderboards live in Reddit posts and comments. The subreddit IS the game lobby. | Features that ignore the host platform |

## 1.4 Audience

- **Primary:** Reddit puzzle players (r/puzzlevideogames, r/WebGames), cable-porn/organization enthusiasts, short-session mobile-style players browsing on desktop or the Reddit app.
- **Secondary:** Competitive speedrunners (daily leaderboard), creators (level editor), casual scrollers who tap a shiny embedded post.

## 1.5 Tone & Personality

Warm, wry, workplace-comedy flavored. Level names and flavor text lean into IT-life humor ("The intern did this", "Nobody has touched this switch since 2011"). Never cynical, never punishing in tone — failure text is sympathetic and funny.

---

# 2. Core Loop, Hook & Mechanics

**(Game Designer)**

## 2.1 The Hook (first 30 seconds)

The current build opens on a menu. **This is the first thing we kill.** New flow:

1. Post loads → the closed cabinet door fills the screen (existing intro asset).
2. Door swings open (existing animation) revealing a **deliberately trivial 2-cable tangle** with one cable already pulsing "grab me".
3. Player drags one plug → cable clears with the full celebration stack (retract animation, burst ring, SFX, screen-settle) → second cable auto-cascades → **WIN inside 20 seconds.**
4. Win screen shows the **Road Map teaser**: "Level 1 ✓ — 34 levels above you" with the camera tilting up the map.

> **Design rule:** the player must experience a full win-celebration before seeing any menu, ever.

## 2.2 The Core Loop (moment-to-moment)

```
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │
   SCAN the tangle ──► PLAN which cable is on top ──► DRAG plug to
   (readable 3D pile)   (z-order readability)         empty socket
        ▲                                              │
        │                                              ▼
   CELEBRATE ◄── CASCADE (freed cables ◄── RESOLVE (cable has no
   (burst, SFX,   auto-clear in chain)     crossings → retracts)
    star tick)
```

**The dopamine engine is the cascade.** Level design must engineer moments where one smart move triggers 2–4 chain resolves. (The engine's `resolveCascade` already supports this — level design must *exploit* it, see §4.6.)

## 2.3 The Session Loop (per play session)

```
Open post → Daily ribbon ("Today's Tangle in 3h 12m") 
     → Continue campaign at map position
     → Play 2–5 levels (60–180s each)
     → Hit a wall OR clear a world gate
     → Spend/earn Zip Ties (hint currency, §3.4)
     → See rank change on friends/leaderboard
     → Exit with a visible "next goal" (next star gate, tomorrow's daily)
```

## 2.4 Mechanics Inventory

### Existing (keep & polish)

| Mechanic | Status | Polish needed |
|----------|--------|---------------|
| Drag plug → empty socket | ✅ solid | Add magnetic snap radius + ghost preview of target socket |
| Auto-resolve cascade | ✅ solid | Stagger cascade animations 150ms apart so chains READ as chains |
| Physics draping/knotting | ✅ solid | Cap knot chaos on early worlds (shorter slack) |
| Locked (bolted) ends | ✅ in engine | Needs strong visual: metal bracket + red bolt heads + "clank" SFX on grab attempt |
| Z-order trapping (`isCableLocked`) | ⚠ engine-only | Surface it: trapped cables get a darkened jacket + struggle wiggle on grab |
| Undo | ⚠ engine counts it, no UI | Add undo button, 3 free per level, extra via Zip Ties |

### New mechanics (world unlock cadence — one new mechanic every world, §4)

| # | Mechanic | Rule | Introduced |
|---|----------|------|-----------|
| M1 | **Power Cables** | Yellow PWR cables spark while crossed; clearing one triggers a satisfying power-down of its device LED | World 1 (flavor only) |
| M2 | **Bolted Ends** | Existing `lockA/lockB` — end cannot be moved | World 2 |
| M3 | **Cable Ties** | Two cables zip-tied together mid-span: they move as a pair; cutting the tie costs 1 move (tap the tie) | World 3 |
| M4 | **Timed Surge** | A surge timer on ONE marked cable: clear it within N moves or it "shorts" and re-scrambles its two neighbors (never fails the level — pressure, not punishment) | World 4 |
| M5 | **Splitters** | A 3-ended cable (Y-split). All three plugs must be crossing-free simultaneously to resolve | World 5 |
| M6 | **Dust Bunnies** | A port blocked by a dust ball; hover-hold 1s to vacuum it before the port is usable | World 5 |
| M7 | **Rats' Nest** | Boss levels: one cable is triple-length with huge slack, physically burying others — must be cleared LAST but blocks everything (pure physics readability challenge) | World bosses |

> **Rule of one:** each world introduces exactly ONE new mechanic, teaches it in isolation on its first level, combines it on levels 2–9, and stress-tests it on the boss level.

## 2.5 Scoring & Stars (per level)

The existing `scoring.ts` (time × efficiency, undo penalty) stays for leaderboards. For the campaign we add a friendlier **3-star** layer:

| Stars | Condition |
|-------|-----------|
| ★ | Clear the level (always) |
| ★★ | Clear within `optimalMoves + ceil(optimalMoves/2)` moves |
| ★★★ | Clear at `optimalMoves` (par) with 0 undos |

Stars gate world doors (§3.2). Time NEVER gates stars in campaign — time pressure is quarantined to Daily/leaderboard modes so casual players never feel rushed.

## 2.6 Failure & Frustration Safety Valves

- **No fail state in campaign.** You can always keep moving plugs.
- **Stuck detection:** if 60s pass with no crossing-count improvement, the hint button glows ("Psst — try the blue one").
- **Hint (costs 1 Zip Tie):** highlights the next move from a fresh bounded solve (`solve()` already exists server-side).
- **Shuffle of shame (free, once per level):** re-scrambles remaining cables with the same solvability guarantee — resets move count to par + 3.

---

# 3. Progression, Economy & Retention

**(Systems Designer)**

## 3.1 Retention Framework Overview

```
D0 hook        → 20-second first win + map reveal (§2.1)
D1 return      → Daily Tangle + streak flame + "your rank slipped" 
D7 habit       → Streak milestones, weekly world release cadence, weekly tournament
D30 investment → Level editor unlock, creator stats, subreddit flair badges
Social gravity → Leaderboards in comments, sabotage remixes, UGC browsing
```

## 3.2 Campaign Progression — The Cable Tower

Campaign = **6 worlds × 10 levels + boss = 66 levels** at launch (see §4). Progression currency is **stars**.

- Levels unlock linearly within a world.
- **World gates** require star totals: World 2 needs 12★, W3 needs 26★, W4 needs 42★, W5 needs 60★, W6 needs 80★ (of 99 earnable at each point — always achievable without 3-starring everything, but encourages replay).
- Replay any cleared level anytime to improve stars (replays regenerate the SAME seed — deterministic, fair).

## 3.3 Daily Systems (the D1 driver)

| System | Design |
|--------|--------|
| **Daily Tangle** | Already in engine (`generateDailyPuzzle`, weekday difficulty rotation, themed titles). Auto-posted to the subreddit at 00:00 UTC as its own post. One attempt counts for leaderboard; unlimited practice after submitting. |
| **Streak** | Consecutive daily completions. Flame icon on splash + user flair (`🔥 12`). Milestones at 3/7/14/30/100 award cosmetics (§3.5). One "Streak Freeze" earned per 7-day streak (auto-consumed on a missed day). |
| **Daily leaderboard** | Score = existing `computeScore` (time × efficiency). Top 10 pinned in the daily post's sticky comment. Percentile shown to everyone ("Top 23% today"). |

## 3.4 Soft Currency — Zip Ties

Single currency, deliberately simple. **No real-money anything** (Devvit gold/payments can be evaluated post-launch; design works without it).

| Earn | Amount |
|------|--------|
| First clear of a campaign level | 2 |
| 3-star a level | +1 |
| Daily Tangle completion | 3 |
| Streak milestone | 5–25 |
| Your UGC level gets 10 unique clears | 5 |

| Spend | Cost |
|-------|------|
| Hint (show next move) | 1 |
| Extra undo pack (+3) | 1 |
| Cosmetic cable skins (§3.5) | 10–50 |
| Boost your UGC level into the "Fresh Tangles" rotation | 15 |

## 3.5 Cosmetics (identity investment, zero power)

- **Cable skins:** braided paracord, RGB gamer, tangled fairy-lights (glow), carbon fiber, gold-plated, "Ethernet Blue Special".
- **Plug trails:** particle trail while dragging (sparks, bubbles, confetti).
- **Win bursts:** custom clear-celebration ring styles.
- **Board themes:** unlocked per world completion (replay any level in any unlocked theme).
- Cosmetics surface on your **UGC levels too** — creators' levels display their equipped skin, making cosmetics socially visible.

## 3.6 Achievements → Reddit Flair

Achievements grant equippable subreddit flair (Devvit can set user flair):

| Flair | Condition |
|-------|-----------|
| `Untangler` | Complete World 1 |
| `IT Department` | Complete World 4 |
| `Cable Whisperer` | 3-star an entire world |
| `The Architect` | Published UGC level with 50 clears |
| `Nightmare Fuel` | Beat World 6 boss |
| `🔥 N` | Current daily streak |

## 3.7 Anti-frustration economics

- Zip Ties income is tuned so a player who clears levels at ★★ average can afford a hint every ~2 levels. Hints must never feel scarce enough to quit over, nor common enough to trivialize.
- All numbers above ship behind a server-side config (Redis hash `config:economy`) so live-tuning needs no redeploy.

---

# 4. World Map, Worlds & Level Design

**(Level Designer)**

## 4.1 The Road Map — "The Cable Tower"

Replace the difficulty menu with a **vertical scrolling map**: a cutaway of a building you climb, one room per world. Difficulty literally increases with altitude. Rendered as a lightweight 3D scene (same renderer) with parallax; nodes are glowing sockets connected by — of course — a cable that plugs itself upward as you progress.

```
                        ☁️  ☁️
   ┌─────────────────────────────────┐
   │ W6  THE NIGHTMARE DATACENTER    │  🏆 roof: trophy antenna
   │     (13)(14)…(B) ⚡ dark, red    │
   ├─────────────────────────────────┤
   │ W5  SERVER ROOM                 │  cold blue, blinking racks
   │     (1)(2)(3)…(10)(B)           │
   ├─────────────────────────────────┤
   │ W4  THE STREAMER'S DEN          │  RGB chaos, neon
   │     (1)(2)(3)…(10)(B)           │
   ├─────────────────────────────────┤
   │ W3  OPEN-PLAN OFFICE            │  fluorescent, beige-tech
   │     (1)(2)(3)…(10)(B)           │
   ├─────────────────────────────────┤
   │ W2  HOME ENTERTAINMENT WALL     │  warm living room dusk
   │     (1)(2)(3)…(10)(B)           │
   ├─────────────────────────────────┤
   │ W1  THE JUNK DRAWER             │  cozy desk-lamp warmth
   │  ►  (1)(2)(3)…(10)(B)           │  ► = you are here
   └─────────────────────────────────┘
        Each (n) node = one level socket
        (B) = boss level, bigger socket with hazard stripes
```

**Map interactions:**
- Current level node pulses; completed nodes show 1–3 star pips; locked worlds show a padlocked breaker panel with "Requires N★".
- The connecting cable visually plugs into each cleared node — your progress IS a cable being routed up the building.
- Tapping a cleared node → replay panel (best stars, best moves, "Improve" button).
- World header shows collective subreddit stat: "r/LooseCables has cleared this room 48,203 times."

## 4.2 World Overview Table

| World | Theme | Grid | Cables | New mechanic | Palette anchor | Scene props |
|-------|-------|------|--------|--------------|----------------|-------------|
| W1 | The Junk Drawer | 4×4 | 3–5 | Basics + Power flavor (M1) | Warm amber lamp light | Pencils, batteries, old phone, tape roll |
| W2 | Home Entertainment Wall | 4×5 | 5–7 | Bolted ends (M2) | Dusk orange + TV glow | TV, soundbar, console, router with blinking LED |
| W3 | Open-Plan Office | 5×5 | 7–9 | Cable ties (M3) | Fluorescent white + beige | Monitors, desk phone, sad plant, coffee mug |
| W4 | The Streamer's Den | 5×6 | 9–11 | Timed surge (M4) | Neon magenta/cyan RGB | Ring light, mic arm, LED strips, GPU tower |
| W5 | Server Room | 6×6 | 11–13 | Splitters (M5) + Dust (M6) | Cold blue + status LEDs | Rack units, patch panels, AC vent fog |
| W6 | Nightmare Datacenter | 7×7 | 13–16 | ALL mechanics combined | Near-black + emergency red | Endless racks, warning strobes, fog floor |

## 4.3 Difficulty Curve (replaces flat easy→nightmare)

Difficulty is now a **per-level tuned vector**, not a preset. The generator's knobs (`gridWidth/Height, cableCount, minCrossings, lockedEnds, emptyPorts` + new: `tieCount, surgeCount, splitterCount, slackMultiplier`) are specified per level in a data table (`src/shared/levels/campaign.ts`).

Intensity curve within each world (sawtooth with relief valleys):

```
difficulty
   ▲                                    ██ B
   │                          ██   ██   ██
   │                ██   ██   ██   ██   ██
   │      ██   ▁▁   ██   ██   ██   ▁▁   ██
   │ ██   ██   ██   ██   ██   ██   ██   ██
   └──────────────────────────────────────► level
     1    2    3    4    5    6    7 8 9 10 B
     teach ramp BREATHER ramp ramp peak BREATHER boss
```

- **Level 1 of each world:** the new mechanic in isolation, 3–4 cables, near-impossible to fail.
- **Levels 3 & 8:** deliberate "breathers" — low cable count, big cascade payoff (engineered 3+ chain resolves). These are the levels players screenshot.
- **Boss (B):** biggest grid of the world, Rats' Nest mechanic (M7), unique intro camera move, unique music sting.

## 4.4 Handcrafted vs. Procedural

- **Campaign levels are handcrafted seeds:** designers run the generator, audition seeds in the Level Lab (§5), tweak with manual overrides, and pin `(seed, difficultyVector, overrides)` into `campaign.ts`. Deterministic — every player gets the identical level, enabling fair leaderboards and shared "how did you solve 4-7?!" comment threads.
- **Endless Mode** (post-campaign, unlocked after W3): the current procedural ramp survives here, rebranded "Overtime Shift", with weekly-seeded runs for its own leaderboard.

## 4.5 Level Design Vocabulary (the pattern library)

Named tangle patterns designers compose. Each has a readability rating and a cascade potential:

| Pattern | Description | Teaches |
|---------|-------------|---------|
| **The Braid** | 3 parallel cables crossing in sequence — solved outside-in | Z-order reading |
| **The Star** | All cables cross one central hub cable — clear the hub last | Cascade planning (hub clear = full cascade) |
| **The Zipper** | Interleaved short cables — alternate ends free each other | Rhythm, quick wins |
| **The Trap** | One short cable pinned under 3 long ones | `isCableLocked` mechanic |
| **The Bridge** | One bolted cable spans the board; everything routes around it | Working with constraints |
| **The Fuse** | Surge cable buried at depth 2 — must dig then defuse | Prioritization under pressure |
| **The Hydra** | Splitter with each head in a separate sub-tangle | Multi-front planning |

**Boss levels are compositions**: W6 boss = Star(hub=Rats' Nest) + two Hydras + Fuse, on 7×7.

## 4.6 Cascade Engineering Rule

Every level MUST contain at least one **planned cascade of ≥2** (verified in Level Lab by the solver: the optimal line must include a move that resolves 2+ cables). Breather levels require a cascade of ≥3. *This is the single most important level-design KPI — the cascade is the product.*

---

# 5. Level Design Tools & UGC

**(Tools Engineer + Level Designer)**

## 5.1 Two tools, one core

Both the internal designer tool and the player-facing editor are the same component with feature flags — building one codebase, shipping two experiences.

### 5.1.1 The Level Lab (internal, dev-only route)

A browser tool (behind `?lab=1` in playtest) for campaign authoring:

- **Seed auditioner:** enter difficulty vector → generate 12 seed thumbnails side by side → click to play-test instantly.
- **Solver overlay:** shows `optimalMoves`, the optimal line as ghost arrows, crossing count heat, cascade sizes per optimal move.
- **Override editor:** drag ports, add/remove cables, toggle locks/ties/surges on the generated base; re-validates via `validatePuzzle` live.
- **Difficulty score:** composite metric = f(optimalMoves, crossings, locked count, trap depth, solver branching factor). Displayed as a 0–100 gauge with target bands per world.
- **Export:** writes the level entry JSON for `campaign.ts`.

### 5.1.2 The Workbench (player-facing UGC editor)

Unlocked after completing World 2 (ensures creators understand mechanics). Deliberately simpler:

```
┌────────────────────────────────────────────┐
│  THE WORKBENCH                    [?] [✕]  │
│ ┌────────────────────────┐  ┌────────────┐ │
│ │                        │  │ PALETTE    │ │
│ │      3D board          │  │ ◉ Add cable│ │
│ │   (same renderer,      │  │ ⊞ Grid 4-7 │ │
│ │    top-down cam,       │  │ 🔒 Bolt end│ │
│ │    drag to place)      │  │ 🔗 Zip tie │ │
│ │                        │  │ 🎨 Theme   │ │
│ └────────────────────────┘  └────────────┘ │
│  Crossings: 7   Solvable: ✓ (par 5)        │
│  [ ▶ TEST ]  [ 📤 PUBLISH (must beat it) ] │
└────────────────────────────────────────────┘
```

**Workbench rules (abuse-proof by design):**
1. Grid 4×4 → 7×7, 3–16 cables, max 4 locks, max 3 ties, max 1 splitter.
2. Live validation: `validatePuzzle` runs on every edit; unsolvable states show a red banner (publish disabled).
3. **Solve-to-submit:** you must beat your own level (this also records the human par and proves solvability beyond solver budget — the engine comment already anticipates this).
4. Title auto-moderated + max 40 chars; levels are published as **new Reddit posts** by the app account with creator credit.

## 5.2 UGC Surfaces & Loops

| Surface | Design |
|---------|--------|
| **Fresh Tangles feed** | In-game browser tab listing recent UGC posts (Redis sorted set), sorted by Wilson-score of (clears / attempts) + recency |
| **Sabotage (killer feature)** | On ANY beaten level: "Make It Worse" button — uses existing `makeItWorse()` to add one cable, then posts the remix as a reply-post crediting both users. Chains display generation depth: "Gen 4 sabotage of u/alice's 'Monday Hell'". This creates comment-thread arms races. |
| **Creator stats** | Plays, clears, average moves vs. your par, sabotage descendants count |
| **Weekly Tangle Contest** | Pinned theme post ("This week: maximum cascade!") — mods feature a winner, flair reward `Featured Architect` |

## 5.3 Moderation

- All UGC goes through Devvit's standard post pipeline (subreddit mods can remove).
- Titles filtered against a blocklist server-side before post creation.
- Report button in-level → increments Redis counter → auto-unlists from Fresh Tangles at threshold (mods notified via modmail).

---

# 6. Visual Design

**(Art Director)**

## 6.1 Art Direction Statement

**"Miniature dioramas of relatable tech chaos."** Every level is a warm, toy-like cutaway scene — think tilt-shift photography of real desks. The cables are the heroes: thick, glossy, saturated jackets against desaturated environments. If a screenshot doesn't make a r/cableporn user twitch, it's not done.

## 6.2 Color System (per design pillar P1/P3)

**Global UI palette (max 5):**

| Token | Hex | Role |
|-------|-----|------|
| `--bg-deep` | `#12101a` | App background, map night sky |
| `--surface` | `#1e1b2a` | Panels, cards |
| `--text` | `#f2f0f7` | Primary text |
| `--accent` | `#ffb02e` | Primary action, stars, Zip Ties (warm amber = "job done" energy) |
| `--accent-cool` | `#4dd8c0` | Success, resolved cables, positive deltas |

**Cable jackets** keep the existing 10-device color set (they're the gameplay-readability layer and already well-spaced in hue). Environments per world stay desaturated (≤30% saturation) so cables always pop.

## 6.3 Scene Design per World

Each world's board sits inside a diorama frame. Composition recipe: *board (playfield) + backdrop (parallax décor) + hero prop (one big readable silhouette) + life detail (one animated element)*.

| World | Hero prop | Animated life detail | Lighting |
|-------|-----------|----------------------|----------|
| W1 Junk Drawer | Giant desk lamp arcing overhead | Dust motes in the lamp beam | Single warm key light, soft shadows |
| W2 Entertainment Wall | 65" TV playing static-y colorbars | Router LED blink pattern | Cool TV glow + warm sunset rim |
| W3 Office | Dual monitors with spreadsheet glow | Screensaver bounce; plant leaf sway | Flat fluorescent + monitor fill |
| W4 Streamer Den | RGB tower PC, fans spinning | LED strip color cycle (slow!) | Neon magenta/cyan, high contrast |
| W5 Server Room | Full rack with patch panel | Rack LEDs random blink; AC fog drift | Cold blue top-light, volumetric haze |
| W6 Datacenter | Rack corridor to vanishing point | Red emergency strobe (2s period) | Near-dark, red key, deep fog (existing fog system) |

## 6.4 The Cables (hero asset polish)

- **Materials:** existing `MeshStandardMaterial` + twist texture is good. Add per-skin variants: clearcoat sheen (RGB skin uses emissive UV scroll), fabric braid normal map for paracord.
- **Plug readability:** plugs get 20% scale-up + device glyph decal on top face (the `DEVICE_SPECS.glyph` already exists — render it).
- **State language (critical for gameplay clarity):**

| State | Visual |
|-------|--------|
| Idle | Full color, subtle sheen |
| Grabbable (hover) | Plug lifts 0.1u, rim-light pulse, cursor = grab |
| Dragging | Plug lifted (existing), target sockets glow `--accent-cool`, invalid sockets dim |
| Trapped (locked under) | Jacket darkened 40%, struggle-wiggle + "thump" SFX on grab attempt |
| Bolted end | Metal bracket + 2 red bolt heads, camera-shake 2px on grab attempt |
| Crossing-free (about to resolve) | 300ms white-hot flash along the tube (anticipation!) then retract |
| Surge cable | Yellow-black hazard band, spark particles at crossing points, tick pulse |

## 6.5 Celebration Stack (the juice budget)

On cable resolve, in order: ① tube flash → ② retract (existing) with elastic ease → ③ burst ring (existing) + 8 spark particles → ④ socket pops closed with a tiny bounce → ⑤ device LED on the backdrop turns green → ⑥ star-progress ticker bumps. On level win: confetti of tiny plugs, camera pull-back to show the clean board for 1.5s ("admire the cableporn" beat), THEN the win panel slides in.

## 6.6 Typography & UI Chrome

- Two fonts max: a rounded geometric sans for headings/numbers (chunky, toy-like — matches diorama feel) and a clean sans for body. All UI on `--surface` cards with 16px radius, soft 1px `--text`/10% borders.
- Numbers always tabular-lining (timers, move counts must not jitter).
- HUD is diegetic where possible: move counter styled as a label-maker strip; star progress as LED pips on a power strip.

---

# 7. Audio Design (SFX & Music)

**(Audio Designer)**

> Every SFX below is **labeled for manual sourcing** — search the *Search terms* column on freesound.org / soundly / zapsplat. Target format: OGG, ≤100KB each, 44.1kHz. All gameplay SFX pitch-randomized ±4% at runtime to avoid fatigue.

## 7.1 Core Gameplay SFX

| ID | Trigger | Character | Search terms |
|----|---------|-----------|--------------|
| `sfx_plug_grab` | Pick up a plug | Soft plastic click + slight cable slide | "plastic connector click", "cable pickup foley" |
| `sfx_cable_drag_loop` | While dragging (looped, volume ∝ velocity) | Nylon rope slide over wood | "rope drag loop", "cable slide foley loop" |
| `sfx_plug_snap` | Plug seats into socket | Satisfying two-stage click-CLUNK (the game's signature sound — spend the most time here) | "connector snap click satisfying", "seatbelt buckle click" |
| `sfx_plug_deny` | Grab attempt on locked/bolted | Dull thump + metal rattle | "dull thud metal rattle short" |
| `sfx_cable_resolve` | Cable begins retract | Rising zip/whip pull-through | "zipper fast whoosh", "rope whip pull" |
| `sfx_resolve_pop` | Retract completes | Cork-pop + tiny chime | "cork pop light chime" |
| `sfx_cascade_2` | 2nd resolve in a chain | Same pop, pitched +2 semitones | (runtime pitch of `sfx_resolve_pop`) |
| `sfx_cascade_3plus` | 3rd+ chain resolve | Pop + ascending arpeggio note per link | "marimba ascending notes single" |
| `sfx_socket_close` | Socket cover flips shut | Tic-tac plastic flip | "plastic flip clack small" |
| `sfx_undo` | Undo pressed | Tape-rewind squeak, very short | "tape rewind short squeak" |
| `sfx_tie_cut` | Cutting a zip tie (M3) | Scissor snip + tie ping | "scissors snip zip tie" |
| `sfx_surge_tick` | Surge cable pulse (M4) | Electrical tick, soft | "electric tick spark small" |
| `sfx_surge_short` | Surge fires | Zap + breaker trip | "electric zap circuit breaker" |
| `sfx_dust_vacuum` | Dust bunny hoovered (M6) | 1s vacuum slurp | "vacuum cleaner short suck" |
| `sfx_splitter_arm` | Splitter head clears (M5) | Single relay click | "relay click electronic" |

## 7.2 Meta / UI SFX

| ID | Trigger | Search terms |
|----|---------|--------------|
| `sfx_ui_tap` | Any button | "soft ui tap pop" |
| `sfx_ui_panel_in/out` | Panels slide | "ui whoosh soft short" |
| `sfx_star_award` | Each star on win screen (staggered ×3) | "star ding sparkle short" |
| `sfx_level_win` | Win jingle | "success jingle short warm" (2s max) |
| `sfx_world_unlock` | World gate opens | "heavy switch breaker room lights on" |
| `sfx_map_plug_advance` | Map cable plugs into next node | reuse `sfx_plug_snap` + low sub thump: "sub bass hit soft" |
| `sfx_ziptie_earn` | Currency awarded | "coin tick plastic" |
| `sfx_streak_flame` | Streak milestone | "whoosh flame ignite small" |
| `sfx_leaderboard_up` | Rank improved | "ascending whistle short" |
| `sfx_door_open` | Level intro door swing (existing anim) | "cabinet door creak open short" |

## 7.3 Ambience Beds (looped, −18 LUFS under everything)

| World | Bed | Search terms |
|-------|-----|--------------|
| W1 | Room tone + clock tick | "quiet room tone clock ticking" |
| W2 | Distant TV murmur + evening crickets | "living room tv muffled ambience" |
| W3 | Office hum, distant keyboard, HVAC | "office ambience air conditioning keyboards" |
| W4 | PC fan whir + faint lo-fi beat bleed | "computer fan hum room" |
| W5 | Server room fan wall | "server room ambience fans" |
| W6 | Deep rumble + occasional alarm chirp | "dark industrial drone alarm distant" |

## 7.4 Music

- **Map & menus:** one chill-hop / marimba-forward loop (90s, seamless). Search: "lofi puzzle game music loop light marimba".
- **In-level:** NO music by default (ambience carries it; keeps 60s sessions fresh) EXCEPT boss levels: tense-but-playful pizzicato loop, search "quirky tension pizzicato loop".
- **Adaptive layer:** when ≤2 cables remain, a soft shaker+bass layer fades in (endgame excitement). Implemented as a second synced loop with volume automation.
- Master ducking: music −6dB during celebration stack.

## 7.5 Mix Rules

- Buses: `ui`, `gameplay`, `ambience`, `music` with independent user sliders (persisted in Redis user prefs).
- `sfx_plug_snap` is the loudest gameplay sound (−8 LUFS-S); everything else sits under it.
- Mobile check: full mix must survive phone speakers — no information carried below 200Hz only.

---

# 8. UX — Screens & Flows

**(UX Designer)**

## 8.1 Screen Map

```
Reddit feed post (splash entry)
   │  [PLAY]
   ▼
FIRST SESSION: straight into Level 1 (§2.1)
RETURNING:     Cable Tower map (home)
   │
   ├─► Level (HUD: moves/par · undo · hint · pause)
   │      └─► Win panel ─► [Next ▶] [Improve ↺] [Map]
   │                        └ every 5 levels: [Share brag comment?]
   ├─► Daily Tangle ribbon ─► Daily level ─► score + percentile + leaderboard
   ├─► Fresh Tangles (UGC browser) ─► play ─► [👍 upvote prompt] [Sabotage 😈]
   ├─► Workbench (editor, post-W2)
   └─► Locker (cosmetics · achievements · stats · settings)
```

## 8.2 Splash Post (first impression in the feed)

The static splash becomes a **live tease**: rendered screenshot of today's daily tangle (server-generated thumbnail) + "1,204 redditors untangled today's mess. Can you?" + streak flame if returning. CTA button: **UNTANGLE**.

## 8.3 In-Level HUD (minimal, corners only)

```
┌─────────────────────────────────────────┐
│ ⏸  W3-7 "Reply All"          Moves 4/6  │ ← label-maker strip style
│                                         │
│                                         │
│              (3D BOARD)                 │
│                                         │
│                                         │
│ ↩ Undo ×3                    💡 Hint ×2 │
└─────────────────────────────────────────┘
```

- No timer visible in campaign (tracked silently for stats). Daily mode shows it.
- Move counter turns amber at par, red past ★★ threshold — gentle, never blocking.

## 8.4 Win Panel

```
┌───────────────────────────────┐
│         LEVEL CLEAR!          │
│         ★  ★  ☆              │  ← staggered pop-in + sfx each
│   6 moves · par 5 · 0 undos   │
│   +2 🔗 Zip Ties               │
│  ─────────────────────────    │
│  "One more socket freed."     │  ← rotating flavor line
│  [ ↺ Improve ]  [ NEXT ▶ ]    │
└───────────────────────────────┘
```

## 8.5 Accessibility

- **Colorblind:** cable identity never relies on color alone — device glyph decals on plugs + distinct connector silhouettes (`PlugShape` already exists). Optional pattern overlay mode (stripes/dots per device type).
- **Input:** full one-finger play; drag tolerance ≥44px targets; no double-tap or long-press REQUIRED anywhere (dust vacuum hold gets a tap-alternative toggle).
- **Motion:** "reduce motion" setting kills camera shake, confetti, and door intro (straight cut).
- **Text:** min 14px, all flavor text skippable.

---

# 9. Reddit / Devvit Integration & Live Ops

**(Live Ops + Community)**

## 9.1 Post Types

| Post | Created by | Content |
|------|-----------|---------|
| **Pinned campaign post** | Install trigger | The main game (map + campaign). One per subreddit. |
| **Daily Tangle post** | Scheduler (00:00 UTC) | That day's puzzle only + leaderboard sticky comment |
| **UGC level post** | Player publish | The level + creator credit + Sabotage button |
| **Weekly Contest post** | Scheduler (Mondays) | Theme brief + submission window |

## 9.2 Comment Integrations

- Win-share (opt-in, max once per 5 levels): posts a spoiler-safe brag comment — `Cleared "Reply All" in 6 moves ★★ — can you beat par?` with deep-link.
- Daily leaderboard sticky comment auto-updates top-10 hourly.
- Sabotage chains form actual reply threads — the comment tree mirrors the remix tree.

## 9.3 Scheduler Jobs

| Job | Cadence | Action |
|-----|---------|--------|
| `daily-post` | 00:00 UTC | Generate daily (existing fn), create post, reset daily board |
| `leaderboard-refresh` | hourly | Update sticky comments |
| `streak-sweep` | 00:05 UTC | Apply streak freezes, reset broken streaks |
| `fresh-tangles-rank` | 6h | Recompute UGC feed ranking |
| `weekly-contest` | Mon 00:00 | Post contest, archive last week's |

## 9.4 Redis Data Model (sketch)

```
user:{id}                 hash  {stars, zipties, streak, freezes, cosmetics, prefs}
progress:{id}             hash  {levelId: "stars,bestMoves,bestTimeMs"}
daily:{yyyy-mm-dd}:board  zset  score → userId          (leaderboard)
daily:{yyyy-mm-dd}:solves hash  userId → solveJson      (anti-cheat replay)
ugc:index                 zset  rankScore → postId
ugc:{postId}              hash  {defJson, author, plays, clears, parHuman, reports}
config:economy            hash  live-tunable numbers (§3.7)
```

## 9.5 Anti-cheat

- Client submits the **move list**, not the score. Server replays moves through the shared `PuzzleEngine` (identical code!) and computes the score itself via `computeScore`. Impossible moves → rejected. This is the payoff of the pure-engine architecture.
- Daily: server timestamps first-open and submit; elapsed sanity-checked (min human time floor per difficulty).

---

# 10. Technical Architecture

**(Lead Engineer)**

## 10.1 What we keep (it's good)

- Pure shared `PuzzleEngine` + deterministic `LevelGenerator` + seeded RNG — this is the foundation for fair leaderboards, server validation, and UGC. **No changes to core solve/generate logic.**
- `CableGame.ts` physics/render stack (tube meshes, drag constraints, velocity capping, retract/burst systems).
- Hono server structure, Devvit Web config with splash/game entrypoints.

## 10.2 New modules

```
src/shared/levels/campaign.ts     — handcrafted level table (seed + vector + overrides)
src/shared/engine/mechanics/      — ties, surge, splitter, dust (pure rules extensions)
src/client/scenes/MapScene.ts     — Cable Tower map renderer
src/client/scenes/dioramas/       — per-world backdrop builders (W1–W6)
src/client/audio/AudioBus.ts      — SFX/music buses, pitch-random, ducking
src/client/ui/                    — HUD, win panel, locker, UGC browser (DOM overlay, not WebGL)
src/client/editor/Workbench.ts    — UGC editor (+ Lab flags)
src/server/routes/progress.ts     — save/load, star awards, economy
src/server/routes/daily.ts        — daily board, submit (replay validation)
src/server/routes/ugc.ts          — publish, feed, sabotage, reports
src/server/jobs/                  — scheduler handlers (§9.3)
```

## 10.3 Engine extensions (pure, testable)

- `Cable` gains optional `tieGroup?: string`, `surge?: {movesAllowed: number}`, splitter modeled as a 3-port cable variant `portC?: number`. `PuzzleEngine` updated: `canMove` respects ties, `resolveCascade` requires all splitter arms clear. Solver updated symmetrically (bounded BFS still fine at our sizes; splitters capped at 1/level to control branching).
- All new mechanics land with unit tests BEFORE renderer work (see §11).

## 10.4 Performance budgets

- 60fps on mid-range phone in Reddit's webview; physics stays at 1/120 fixed step with existing accumulator.
- ≤ 300 draw calls per level (merge socket meshes, instanced bolt heads); tube geometry rebuild only for moving cable (already the pattern).
- Total bundle ≤ 2.5MB gzip incl. audio (OGG budget: 30 SFX × ~40KB + 3 music loops × ~300KB).
- Diorama props are low-poly primitives + baked-gradient textures, no external model loads.

---

# 11. QA Plan

**(QA Lead)**

## 11.1 Automated (CI on every PR)

- **Engine unit tests:** move legality, cascade order, tie/surge/splitter rules, `isCableLocked` truth table, scoring math, RNG determinism (same seed = same puzzle, cross-platform).
- **Generator property tests:** 1,000 random seeds per difficulty vector → assert solvable, minCrossings met, no port collisions, optimalMoves ≥ 1.
- **Campaign gate test:** every level in `campaign.ts` must (a) validate, (b) contain a planned cascade ≥2 per §4.6, (c) sit inside its world's difficulty band.
- **Server replay tests:** valid move lists accepted, tampered lists rejected, score matches client calculation.

## 11.2 Manual test matrix (per release)

| Area | Cases |
|------|-------|
| Input | Mouse drag, touch drag, drag off-screen, two rapid grabs, grab during cascade, grab during retract |
| Physics | Yank at max speed (no tunneling — MAX_BODY_SPEED guard), knot pile of 16 cables settles < 3s, no NaN explosions after 10min idle |
| Devvit envs | Reddit iOS app webview, Android app webview, desktop new/old Reddit, dark & light Reddit themes |
| Resume | Kill webview mid-level → reopen → state restored; daily submitted flag survives |
| Economy | Zip Tie earn/spend paths, hint with 0 balance, streak freeze consumption at midnight boundary |
| UGC | Publish unsolvable (blocked), publish without beating (blocked), report flow, sabotage of a sabotage |
| A11y | Colorblind overlay on all 10 device types, reduce-motion honors every animation, 44px targets audit |
| Audio | Mute persistence, duck timing, 20-cable cascade doesn't clip the master bus |

## 11.3 Playtest protocol (pre-launch)

- 10-person moderated FTUE test: **KPI = 100% reach first win < 60s, 80% start level 2 unprompted.**
- Difficulty calibration: telemetry on moves-over-par and hint usage per level; any level with >30% hint rate or >2.2× par average gets redesigned.
- Soak: 2h continuous play session watching for memory growth (dispose paths for meshes/bodies verified via renderer.info).

## 11.4 Live telemetry (post-launch)

Events: level_start/win/abandon (with move count, hints, duration), daily_submit, ugc_publish/play, sabotage_created, session_length. Weekly dashboard: D1/D7 retention, funnel by world, level-level abandon heatmap → feeds directly back into §4.3 tuning.

---

# 12. Roadmap

**(Producer)**

| Milestone | Contents | Exit criteria |
|-----------|----------|--------------|
| **M1 — Foundation** | Progress persistence (Redis), real API routes replacing counter template, star system, undo UI, celebration stack v1, audio bus + core 15 SFX | Campaign state survives reload; win feels 2× juicier (playtest verdict) |
| **M2 — The Tower** | Map scene, Worlds 1–3 (33 handcrafted levels), diorama backdrops W1–W3, mechanics M1–M3, FTUE flow (§2.1) | FTUE KPI met; W1–W3 difficulty bands verified |
| **M3 — Daily & Compete** | Daily post scheduler, leaderboard + sticky comments, streaks, server replay anti-cheat, share comments | First public daily runs 7 days without manual intervention |
| **M4 — Worlds 4–6** | Mechanics M4–M7, boss levels, remaining dioramas, adaptive music, Endless "Overtime Shift" | Full 66-level campaign clearable; boss levels hit "screenshot moment" bar |
| **M5 — UGC** | Workbench editor, publish pipeline, Fresh Tangles feed, Sabotage chains, moderation tools, Weekly Contest | 95% of published levels solvable-by-others in beta cohort |
| **M6 — Launch polish** | Cosmetics + Locker, flair achievements, a11y pass, perf pass, full QA matrix | All §11 gates green; bundle < 2.5MB |

**Post-launch cadence:** 1 new world per month (community-voted theme), weekly contests, seasonal cosmetic drops (Cable Management Awareness Week is real and it's ours).

---

## Appendix A — Design KPI Summary

| KPI | Target |
|-----|--------|
| Time to first win (new player) | < 60s |
| Median campaign level duration | 60–180s |
| D1 retention | > 35% |
| Hint usage per level | < 30% of players |
| Cascade ≥2 per level | 100% of levels |
| UGC levels beatable by others | > 95% |

## Appendix B — Glossary

- **Cascade:** chain of auto-resolves triggered by one move (the core dopamine event).
- **Par:** `optimalMoves` from generation (scramble length upper bound).
- **Sabotage:** UGC remix adding one cable via `makeItWorse()`.
- **Zip Ties:** the single soft currency.
- **The Tower:** the vertical world map.
