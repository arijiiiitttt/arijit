# arijit

A sprite companion for any website. One file (`arijit.js`), no dependencies, all sprites baked in.

## Use it in any project
Put this in the `<head>` of the page (after you've deployed, see below):

    <script src="https://YOUR-LINK/arijit.js"></script>

## Deploy it as a link (pick one, ~2 minutes)

**A. GitHub + jsDelivr (recommended, free, fast CDN)**
1. Create a new GitHub repo named `arijit` and upload everything in this folder (or `git push` it).
2. Your link is immediately:
   `https://cdn.jsdelivr.net/gh/YOUR_GITHUB_USERNAME/arijit@main/arijit.js`
   - jsDelivr caches `@main` for up to 12h after you push changes. For instant updates make a release tag (e.g. `v1`)
     and use `.../arijit@v1/arijit.js`, or purge at `https://purge.jsdelivr.net/gh/YOUR_GITHUB_USERNAME/arijit@main/arijit.js`.
3. Optional: repo Settings -> Pages -> deploy from `main` / root gives the demo at `https://YOUR_GITHUB_USERNAME.github.io/arijit/`
   and the script at `https://YOUR_GITHUB_USERNAME.github.io/arijit/arijit.js`.

**B. Netlify Drop (no account setup needed beyond a login)**
Go to https://app.netlify.com/drop and drag this whole folder in. Link: `https://<your-site>.netlify.app/arijit.js`.
You can rename the site to `arijit` in Site settings.

## What he does
**Follows & explores**
- Chases the cursor (walks close, runs far, 4 directions + diagonal run) and stops beside it.
- Climbs cards/images/buttons/headings, stands on the top edge, reads its text aloud in a bubble, strolls, sits, naps,
  rides along when the page scrolls, jumps down when you move again.
- Wanders: carries a box, sneaks on all fours, or pushes a box across the floor.

**Idle life** (all random): 7 sitting poses, phone, guitar (notes), binoculars, map, books, sword practice, laptop,
trying on costumes (knight, wizard, astronaut, ninja, suit...), peeking out from a door, 4 sleep styles (one with a pillow).

**Reacts to you**
| you do | he does |
|---|---|
| move the cursor | follows; "!" if he was asleep |
| lunge the cursor at him fast | ducks, scared face |
| hover a link/button/input | "?" or a skeptical face |
| hover something with `data-arijit-say="..."` | says that text (your own tips) |
| click a link | laughs |
| click a button | hops and cheers |
| submit a form / invalid field | "yay!" / worried face |
| type | takes out a laptop; a keypress wakes him |
| double-click anywhere | throws a pebble there |
| scroll very fast | gets dizzy |
| click him | hearts / "yay!" |
| click him 3 times fast | angry face, then a 14s game of tag ("catch me!") - touch him with the cursor to score |
| drag him | dangles; drop him on any element or the floor |
| leave the tab for 25s+ and come back | sad face |
| a long time with no mouse (sooner at night / on dark pages) | falls asleep |

**Extras**: walks out of a door on your first visit with a time-of-day greeting; a dog runs across the bottom
(or follows him with `data-dog="follow"`); optional tiny synth sounds (`data-sound="true"`);
hide/show with **Alt+Shift+A** or a small button (`data-button="true"`).

## Options (attributes on the script tag)
| attribute | default | |
|---|---|---|
| data-size | 96 | standing height in px |
| data-speed | 1 | movement multiplier |
| data-follow | true | false = ignore cursor, just wander |
| data-perch | true | false = never climb page elements |
| data-interact | true | false = no poke/drag/double-click throw |
| data-persist | true | remember position between pages |
| data-entrance | true | false = no door entrance |
| data-dog | visit | `visit` (runs by now and then), `follow` (trails him), `false` |
| data-sound | false | `true` = footsteps, guitar notes, snoring, pops |
| data-button | false | `true` = small on/off button, bottom-right |
| data-selector | img, button, h1... | CSS selector of climbable elements |

Per element: `data-arijit="ignore"` to exclude, `data-arijit-perch` to force-include, `data-arijit-say="tip"` for a tip.
Console API: `arijit.say("hi")`, `arijit.goTo(x,y)`, `arijit.perchOn("#id")`, `arijit.throwAt(x,y)`, `arijit.pose("guitar")`,
`arijit.emote("angry")` (scared, angry, cry, laugh, sad, determined, skeptic, shock, think), `arijit.tag()`, `arijit.hide()` / `arijit.show()`,
`arijit.sleep()`, `arijit.dog()`, `arijit.poses()`, `arijit.animations()`.

## Adding more sprites later
1. Drop the new sheet in `sheets/` (sprites should face RIGHT; the engine mirrors for left).
2. `python3 tools/segment.py sheets/sheet13.png` (add `--gap 1` for dense sheets) -> `frames/sheet13/_contact.png`
   shows every cut frame with its number.
3. `atlas.json`: add `"my_frame": ["sheet13", 42]` (+ the sheet's `ref_h`, the pixel height of a standing character).
4. `src/animations.json`: add `"wave": {"frames": ["my_frame_a","my_frame_b"], "fps": 4}` (optional `bob`, `loop`).
5. To make it a behaviour: add a row to the `POSES` table at the top of `src/engine.js`
   (`anim`, `dur`, `say`, weights `w:{g,p}`). That's all, he'll start doing it on his own.
6. `python3 tools/build_atlas.py && python3 build.py` -> new `arijit.js`. Commit + push.

Not wired (these frames have a baked-in background, so they can't sit on a web page): swimming, sliding, ladder, wall-jump, fishing, digging.
The costumes only exist as single frames, so he "tries them on" as a pose instead of wearing them while walking.
