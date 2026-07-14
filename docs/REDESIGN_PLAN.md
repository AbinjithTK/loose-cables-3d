# Loose Cables 3D — Redesign & Level Maker Plan

Research-backed plan for three workstreams. Built on verified Devvit APIs
(`reddit.submitCustomPost({ title, entry, postData })`, Redis, triggers).

## 1. Bug fixes
- **Stray gold trophy over the board** = the achievement toast is never cleared
  on level transitions and its reward text is gold-on-gold (invisible). Fix:
  clear + hide the toast (and queue) on every `launchPuzzle`/screen change,
  redesign it as a slim top banner with readable text, guarantee auto-hide.

## 2. Gameplay visual redesign (game feel)
Goal: brighter, colorful, pleasant, "plugged-in" plugs, distinct locked ends,
juicy animation.
- **Lighting/color:** raise ambient, add a hemisphere fill light, warmer key,
  stronger colored rim lights; lighten the board panel; emissive socket rings so
  the board glows instead of reading as a black hole.
- **Plugged-in plugs:** seat the connector down into the socket with a colored
  collar ring that fills the port (reads as inserted, not laid on top). Snap-in
  scale-pop animation when an end seats.
- **Locked ends:** steel housing + red bolt heads + red warning ring + a padlock
  decal and a faint red emissive — unmistakably different from live plugs.
- **Feedback anims:** grabbable-plug hover glow, seat bounce, socket pulse.

## 3. Level Maker (UGC) — postable to Reddit
- **Editor screen:** pick grid size, tap two ports to lay a cable (auto device
  type/color), toggle a bolted end, delete, "Test" (must solve), "Publish".
- **Validation:** reuse the engine solvability check; require solve-to-publish.
- **Publish flow (server):** `POST /api/publish-level` → validate → store puzzle
  JSON in Redis under a key → `reddit.submitCustomPost({ title, entry:'default',
  postData:{ kind:'ugc', key } })` → also map `ugc:post:{postId}` → key → return
  the new post URL.
- **Load flow:** `/api/init` checks if `context.postId` maps to a UGC puzzle; if
  so returns it and the client boots straight into that puzzle (bypassing the
  campaign map), with attribution to the creator.
- **Entry point:** "Create" button on the home menu.

## Sequencing
Fixes → visual redesign → level maker. Each ships type-checked + built.
