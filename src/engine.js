/*!
 * arijit.js - a little sprite companion for any web page.
 *
 *   <script src="https://YOUR-HOST/arijit.js"></script>        (in <head> or <body>)
 *
 * Optional attributes on the <script> tag:
 *   data-size="96"        standing height in px            data-speed="1"       movement speed multiplier
 *   data-follow="false"   don't chase the cursor           data-perch="false"   don't climb page elements
 *   data-interact="false" can't be poked / dragged         data-persist="false" don't remember position
 *   data-selector="..."   CSS selector of climbable things data-atlas="url"     use a different atlas image
 *   data-entrance="false" no door entrance on first visit  data-dog="visit|follow|false"  dog mode (default visit)
 *   data-sound="true"     tiny synth sound effects         data-button="true"   show a small on/off button
 *   Hide/show: Alt+Shift+A.  Tips: put data-arijit-say="text" on any element.
 *
 * Opt an element out with data-arijit="ignore".  Opt extra elements in with data-arijit-perch.
 * Console / JS API: window.arijit  (say, goTo, perchOn, throwAt, pose, sleep, wake, play, dog, setSize, destroy)
 */
(function () {
  'use strict';
  if (window.__arijitLoaded) return;
  window.__arijitLoaded = true;

  /* ---- injected by build.py ------------------------------------------------ */
  var ATLAS = __ATLAS__;
  var ATLAS_URL = __ATLAS_URL__;
  var ANIMS = __ANIMS__;
  /* -------------------------------------------------------------------------- */

  var script = document.currentScript;
  var ds = (script && script.dataset) || {};
  var bool = function (v, d) { return v === undefined ? d : !(v === 'false' || v === '0'); };
  var CFG = {
    size: +ds.size || 96,
    speed: +ds.speed || 1,
    follow: bool(ds.follow, true),
    perch: bool(ds.perch, true),
    interact: bool(ds.interact, true),
    persist: bool(ds.persist, true),
    entrance: bool(ds.entrance, true),
    dog: ds.dog === undefined ? 'visit' : (ds.dog === 'false' || ds.dog === '0' ? 'off' : ds.dog),
    sound: bool(ds.sound, false),
    button: bool(ds.button, false),
    selector: ds.selector ||
      'img, video, canvas, button, input, textarea, select, h1, h2, h3, nav, header, footer, aside, figure, table, pre, ' +
      '.card, .btn, [class*="card"], [class*="button"], [data-arijit-perch]',
    atlas: ds.atlas || ATLAS_URL
  };
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var STORE = 'arijit:v1', ENTERED = 'arijit:entered';

  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var clock = function () { return performance.now() / 1000; };
  var sc = function () { return CFG.size / ATLAS.target_h; };

  /* ======================================================================== */
  /*  Poses: what he can do while standing around. Add a row = add a behaviour */
  /*   anim: animation name   dur: [min,max] secs   say / sayList+sayEvery     */
  /*   w: {g: weight on ground, p: weight on a ledge}   minQuiet: secs without */
  /*   mouse movement required                                                 */
  /* ======================================================================== */
  var POSES = {
    stand:   { w: { g: 0.22, p: 0.18 } },
    sit:     { dur: [7, 14], w: { g: 0.20, p: 0.22 } },
    phone:   { anim: 'phone', dur: [4, 7], say: '…', w: { g: 0.08, p: 0.10 } },
    guitar:  { anim: 'guitar', dur: [8, 14], sayList: ['♪', '♫'], sayEvery: 1.9, w: { g: 0.09, p: 0.08 }, minQuiet: 4 },
    scout:   { anim: 'scout', dur: [4, 6], say: '?', w: { g: 0.06, p: 0.08 } },
    map:     { anim: 'map', dur: [5, 8], say: '…', w: { g: 0.05, p: 0.05 } },
    books:   { anim: 'books', dur: [5, 8], w: { g: 0.04, p: 0.04 } },
    sword:   { anim: 'sword', dur: [2.5, 4], sayList: ['hyah!', '!'], sayEvery: 1.3, w: { g: 0.04, p: 0.03 } },
    laptop:  { anim: 'laptop', dur: [6, 10], say: '…', w: { g: 0.04, p: 0.04 } },
    cheer:   { anim: 'cheer', dur: [1.2, 1.2], say: '♥' },
    yell:    { anim: 'yell', dur: [1.4, 1.4], say: 'yay!' },
    throw:   { anim: 'throw', dur: [0.95, 0.95] },
    hide:    { anim: 'crouch', dur: [2, 3], face: 'face_scared' },
    dizzy:   { anim: 'sit_c', dur: [3, 3.5], face: 'face_shock' },
    worried: { anim: 'sit_c', dur: [2.4, 2.4], face: 'face_sad' },
    sad:     { anim: 'sit_c', dur: [2.6, 2.6], face: 'face_sad' },
    angry:   { anim: 'yell', dur: [1.5, 1.5], face: 'face_angry' },
    laugh:   { anim: 'cheer', dur: [1.4, 1.4], face: 'face_laugh' },
    point:   { anim: 'point', dur: [1.3, 1.3], say: '!' },
    cosplay: { dur: [3.4, 3.4], say: 'ta-da!', w: { g: 0.03, p: 0.03 } },
    peek:    { anim: 'peek', dur: [3, 5], w: { g: 0.03, p: 0 } }
  };

  /* ======================================================================== */
  /*  State                                                                    */
  /* ======================================================================== */
  var P = {
    x: 0, y: 0, z: 0,            // feet position (viewport px), z = hop height
    face: 1, dir: 'down',
    mode: 'idle',                // idle | alert | move | goto | climb | perched | jump | held | enter
    t: 0, hide: false,
    pose: 'stand', poseT: 0, poseDur: 3, sitAnim: 'sit_a', lastSay: 0, sleepAnim: 'sleep',
    anim: 'idle', animT: 0,
    idleT: 0, running: false, carry: false, sneak: false, push: false, pushAnim: 'push_box', costumeAnim: 'idle', hideCool: 0, reactCool: 0, game: null, stepT: 0, snoreT: 0,
    perch: null,                 // {el,u,t0}
    goal: null, jump: null, held: null, shot: null,
    travelMark: 0, stroll: null, lastHover: null
  };
  var mouse = { x: 0, y: 0, has: false, lastMove: -99, travel: 0, hover: null, speed: 0 };
var HID = false, NIGHT = false, pokes = [], tipEl = null, tipTimer = 0, awayAt = 0, scr = { y: 0, t: 0, acc: 0, cool: 0 }, btnEl = null;
var COSTUMES = Object.keys(ANIMS).filter(function (k) { return k.indexOf('cos_') === 0; });
  var door = null, dog = { on: false, x: 0, y: 0, dir: 1, t: 0, near: false, next: 0 };
  var pebble = null;
  var raf = 0, last = 0, alive = true;
  var root, spriteEl, shadowEl, bubEl, doorEl, dogEl, pebEl, bubT = 0;

  /* ======================================================================== */
  /*  DOM                                                                      */
  /* ======================================================================== */
  function layer(css) {
    var d = document.createElement('div');
    d.className = 'arijit-atlas';
    d.style.cssText = 'position:absolute;left:0;top:0;background-repeat:no-repeat;will-change:transform;display:none;' + (css || '');
    return d;
  }
  function build() {
    var st = document.createElement('style');
    st.id = 'arijit-style';
    st.textContent =
      '@keyframes arijitpop{0%{transform:translate(-50%,-100%) scale(.3)}60%{transform:translate(-50%,-100%) scale(1.15)}100%{transform:translate(-50%,-100%) scale(1)}}' +
      '@keyframes arijitring{0%{transform:translate(-50%,-50%) scale(.2);opacity:.9}100%{transform:translate(-50%,-50%) scale(1.6);opacity:0}}' +
      '.arijit-atlas{background-image:url("' + CFG.atlas + '")}' +
      '#arijit-root,#arijit-root *{box-sizing:border-box}';
    document.documentElement.appendChild(st);

    root = document.createElement('div');
    root.id = 'arijit-root';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;overflow:visible;';

    shadowEl = document.createElement('div');
    shadowEl.style.cssText = 'position:absolute;left:0;top:0;border-radius:50%;background:radial-gradient(ellipse at center,rgba(0,0,0,.28),rgba(0,0,0,0) 70%);will-change:transform;';
    doorEl = layer(); spriteEl = layer(); dogEl = layer();
    spriteEl.style.display = 'block';
    pebEl = document.createElement('div');
    pebEl.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;display:none;' +
      'background:radial-gradient(circle at 35% 30%,#b9a6ff,#6b4fd1 60%,#3d2a8f);box-shadow:0 0 6px rgba(107,79,209,.7);will-change:transform;';
    bubEl = document.createElement('div');
    bubEl.style.cssText = 'position:absolute;left:0;top:0;display:none;background:#fff;color:#2b2233;border:2px solid #2b2233;' +
      'border-radius:9px;padding:1px 8px 3px;font:700 14px/1.25 ui-monospace,Menlo,Consolas,monospace;white-space:nowrap;' +
      'box-shadow:0 2px 0 rgba(0,0,0,.25);transform:translate(-50%,-100%);';
    var tail = document.createElement('div');
    tail.style.cssText = 'position:absolute;left:50%;bottom:-6px;width:8px;height:8px;background:#fff;border:2px solid #2b2233;' +
      'border-top:none;border-left:none;transform:translateX(-50%) rotate(45deg);';
    bubEl.appendChild(tail);
    root.appendChild(shadowEl); root.appendChild(doorEl); root.appendChild(spriteEl);
    root.appendChild(dogEl); root.appendChild(pebEl); root.appendChild(bubEl);
    document.documentElement.appendChild(root);
  }

  function frameOf(animName, t) {
    var a = ANIMS[animName] || ANIMS.idle, names = a.frames, n = names.length;
    var i = Math.floor(t * a.fps);
    i = a.loop === false ? Math.min(i, n - 1) : i % n;
    return ATLAS.frames[names[i]] || ATLAS.frames[ANIMS.idle.frames[0]];
  }
  function bobOf(animName, t) {
    var a = ANIMS[animName];
    return a && a.bob ? Math.abs(Math.sin(t * (a.bobHz || 6))) * a.bob * CFG.size : 0;
  }
  function frameNow() { return frameOf(P.anim, P.animT); }

  // paint one atlas frame into a layer, feet anchored at (x,y)
  function draw(el, f, x, y, face, lift) {
    var s = sc(), w = f.w * s, h = f.h * s, ax = f.ax * s;
    var cs = el.style;
    cs.display = 'block';
    cs.width = w + 'px'; cs.height = h + 'px';
    cs.backgroundSize = (ATLAS.w * s) + 'px ' + (ATLAS.h * s) + 'px';
    cs.backgroundPosition = (-f.x * s) + 'px ' + (-f.y * s) + 'px';
    cs.transformOrigin = ax + 'px 0';
    cs.transform = 'translate(' + (x - ax) + 'px,' + (y - (lift || 0) - h) + 'px) scaleX(' + face + ')';
    return h;
  }

  function render() {
    var f = frameNow(), h;
    var lift = P.z + bobOf(P.anim, P.animT);
    if (P.hide) { spriteEl.style.display = 'none'; shadowEl.style.display = 'none'; h = f.h * sc(); }
    else {
      shadowEl.style.display = 'block';
      h = draw(spriteEl, f, P.x, P.y, P.face, lift);
      var sw = CFG.size * 0.55 * (1 - Math.min(P.z / (CFG.size * 1.2), 0.5));
      shadowEl.style.width = sw + 'px';
      shadowEl.style.height = Math.max(6, CFG.size * 0.1) + 'px';
      shadowEl.style.transform = 'translate(' + (P.x - sw / 2) + 'px,' + (P.y - CFG.size * 0.05) + 'px)';
    }
    // door prop (entrance)
    if (door) {
      var df = ATLAS.frames.prop_door;
      if (df) { draw(doorEl, df, door.x, door.y, 1, 0); doorEl.style.opacity = door.a; }
    } else doorEl.style.display = 'none';
    // dog visitor
    if (dog.on) {
      var dfr = frameOf('dog', dog.t);
      draw(dogEl, dfr, dog.x, dog.y, dog.dir, dog.moving === false ? 0 : bobOf('dog', dog.t));
    } else dogEl.style.display = 'none';
    // pebble
    if (pebble) {
      pebEl.style.display = 'block';
      pebEl.style.transform = 'translate(' + pebble.px + 'px,' + pebble.py + 'px)';
    } else pebEl.style.display = 'none';
    // speech bubble
    if (bubT > 0 && !P.hide) {
      bubEl.style.display = 'block';
      bubEl.style.left = P.x + 'px';
      bubEl.style.top = (P.y - lift - h - 4) + 'px';
    } else bubEl.style.display = 'none';
  }

  function say(text, secs) {
    bubT = secs || 1.6;
    while (bubEl.childNodes.length > 1) bubEl.removeChild(bubEl.lastChild);
    var long = text.length > 22;
    bubEl.style.padding = '1px 8px 3px';
    bubEl.style.whiteSpace = long ? 'normal' : 'nowrap';
    bubEl.style.width = long ? '210px' : 'auto';
    bubEl.style.textAlign = 'center';
    bubEl.appendChild(document.createTextNode(text));
    bubEl.style.animation = 'none'; void bubEl.offsetWidth; bubEl.style.animation = 'arijitpop .22s ease-out';
    sfx('pop');
  }
  // show one of his own faces from the sheets in the bubble
  function emote(name, secs) {
    var f = ATLAS.frames[name];
    if (!f) { say('!', secs); return; }
    bubT = secs || 1.6;
    while (bubEl.childNodes.length > 1) bubEl.removeChild(bubEl.lastChild);
    var s = sc(), fd = document.createElement('div');
    fd.className = 'arijit-atlas';
    fd.style.cssText = 'width:' + f.w * s + 'px;height:' + f.h * s + 'px;background-repeat:no-repeat;' +
      'background-size:' + ATLAS.w * s + 'px ' + ATLAS.h * s + 'px;background-position:' + (-f.x * s) + 'px ' + (-f.y * s) + 'px;';
    bubEl.style.padding = '3px'; bubEl.style.width = 'auto'; bubEl.style.whiteSpace = 'nowrap';
    bubEl.appendChild(fd);
    bubEl.style.animation = 'none'; void bubEl.offsetWidth; bubEl.style.animation = 'arijitpop .22s ease-out';
    sfx('pop');
  }

  /* ---- tiny synth sound (off unless data-sound="true") -------------------- */
  var AC = null;
  function audio(create) {
    if (!AC && create) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(f, d, type, vol, slide) {
    if (!CFG.sound || HID) return;
    var c = audio(false); if (!c || c.state !== 'running') return;
    var o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d);
  }
  function sfx(n) {
    if (!CFG.sound) return;
    switch (n) {
      case 'step': tone(130 + Math.random() * 40, 0.05, 'triangle', 0.03); break;
      case 'pop': tone(520, 0.08, 'sine', 0.05, 820); break;
      case 'note': tone(pick([262, 294, 330, 392, 440, 523]), 0.4, 'triangle', 0.05); break;
      case 'snore': tone(110, 0.8, 'sine', 0.035, 70); break;
      case 'jump': tone(220, 0.18, 'square', 0.03, 440); break;
      case 'land': tone(120, 0.08, 'triangle', 0.04); break;
      case 'throw': tone(600, 0.15, 'sawtooth', 0.02, 200); break;
      case 'hit': tone(180, 0.12, 'square', 0.04, 90); break;
    }
  }
  function ring(x, y) {
    var r = document.createElement('div');
    r.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + CFG.size * 0.7 + 'px;height:' + CFG.size * 0.7 + 'px;' +
      'border:3px solid #6b4fd1;border-radius:50%;animation:arijitring .5s ease-out forwards;';
    root.appendChild(r);
    setTimeout(function () { r.remove(); }, 600);
    sfx('hit');
  }

  /* ======================================================================== */
  /*  Helpers                                                                  */
  /* ======================================================================== */
  function setAnim(name) { if (P.anim !== name) { P.anim = name; P.animT = 0; } }
  function bounds() {
    return { minX: CFG.size * 0.3, maxX: innerWidth - CFG.size * 0.3, minY: CFG.size * 1.0, maxY: innerHeight - 2 };
  }
  function clampPos() {
    var b = bounds();
    P.x = clamp(P.x, b.minX, b.maxX); P.y = clamp(P.y, b.minY, b.maxY);
  }
  function mdist() { return mouse.has ? Math.hypot(mouse.x - P.x, mouse.y - P.y) : Infinity; }
  function faceMouse() { if (mouse.has && Math.abs(mouse.x - P.x) > 8) P.face = mouse.x >= P.x ? 1 : -1; }
  var STOP_R = function () { return CFG.size * 0.7; };
  var asleep = function () { return P.pose === 'sleep' || P.pose === 'sitsleepy'; };

  function steer(tx, ty, dt, allowRun) {
    var dx = tx - P.x, dy = ty - P.y, d = Math.hypot(dx, dy);
    if (d < 0.5) return 0;
    var ax = Math.abs(dx), ay = Math.abs(dy);
    var bias = P.dir === 'side' ? 1.4 : 0.7;
    P.dir = ax * bias > ay ? 'side' : (dy > 0 ? 'down' : 'up');
    if (P.dir === 'side') P.face = dx >= 0 ? 1 : -1; else P.face = 1;
    var canRun = allowRun && !P.carry && !P.sneak && !P.push;
    if (canRun) {
      if (!P.running && d > CFG.size * 2.8) P.running = true;
      if (P.running && d < CFG.size * 1.6) P.running = false;
    } else P.running = false;
    var speed = (P.running ? CFG.size * 2.7 : (P.sneak ? CFG.size * 0.55 : (P.push ? CFG.size * 0.6 : CFG.size * 1.15))) * CFG.speed;
    var step = Math.min(speed * dt, d);
    P.x += dx / d * step; P.y += dy / d * step;
    if (P.carry) setAnim(P.dir === 'side' ? 'carry_side' : 'carry_down');
    else if (P.sneak) setAnim(P.dir === 'side' ? 'crawl_side' : 'crawl_slow');
    else if (P.push) setAnim(P.pushAnim);
    else {
      var kind = P.dir === 'side' ? (P.running && dy > 0 && ay > ax * 0.45 ? 'diag' : 'side') : P.dir;
      setAnim((P.running ? 'run_' : 'walk_') + kind);
    }
    return d - step;
  }

  function toIdle() {
    P.mode = 'idle'; P.pose = 'stand'; P.poseT = 0; P.poseDur = rnd(2.5, 5); P.idleT = 0;
    P.perch = null; P.goal = null; P.running = false; P.z = 0; P.carry = false; P.sneak = false; P.push = false; P.hide = false;
    P.travelMark = mouse.travel;
    faceMouse();
  }

  /* ---- finding things to stand on ---------------------------------------- */
  function candidates() {
    var out = [], els, vw = innerWidth, vh = innerHeight, minTop = CFG.size * 1.15;
    try { els = document.querySelectorAll(CFG.selector); } catch (e) { return out; }
    for (var i = 0; i < els.length && out.length < 80; i++) {
      var el = els[i];
      if (root.contains(el) || el.closest('[data-arijit="ignore"]')) continue;
      var r = el.getBoundingClientRect();
      if (r.width < CFG.size * 0.8 || r.height < 24) continue;
      if (r.top < minTop || r.top > vh - 30 || r.left > vw - 20 || r.right < 20) continue;
      if (r.height > vh * 0.75) continue;
      var cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.2) continue;
      out.push({ el: el, r: r });
    }
    return out;
  }
  function perchOk(el) {
    if (!el || !el.isConnected) return null;
    var r = el.getBoundingClientRect();
    if (r.top < CFG.size * 0.8 || r.top > innerHeight - 8 || r.width < CFG.size * 0.5) return null;
    return r;
  }

  /* ---- high-level actions ------------------------------------------------- */
  function startPerchTrip(c) {
    if (!c) { var list = candidates(); if (!list.length) return false; c = pick(list); }
    var el = c.el || c, r = c.r || el.getBoundingClientRect();
    var left = r.left - 6, right = r.right + 6;
    var useLeft = P.x < r.left + r.width / 2;
    if (useLeft && left < CFG.size * 0.35) useLeft = false;
    if (!useLeft && right > innerWidth - CFG.size * 0.35) useLeft = true;
    P.goal = { type: 'perch', el: el, side: useLeft ? -1 : 1 };
    P.mode = 'goto'; P.t = 0; P.perch = null;
    P.carry = Math.random() < 0.2; P.sneak = false; P.push = false;
    return true;
  }
  function startWander() {
    var b = bounds();
    P.goal = { type: 'point', x: clamp(P.x + rnd(-1, 1) * CFG.size * 3, b.minX, b.maxX), y: clamp(P.y + rnd(-1, 1) * CFG.size * 1.5, b.minY, b.maxY) };
    P.mode = 'goto'; P.t = 0;
    var r = Math.random();
    P.carry = r < 0.2; P.sneak = !P.carry && r < 0.35; P.push = !P.carry && !P.sneak && r < 0.5;
    if (P.push) {
      P.pushAnim = pick(['push_box', 'push_gray']);
      P.goal.y = P.y; P.goal.x = clamp(P.x + (Math.random() < 0.5 ? -1 : 1) * CFG.size * rnd(1.5, 3), b.minX, b.maxX);
    }
  }
  function beginFollow(force) {
    var long = P.idleT > 4 || P.pose === 'sit' || asleep();
    P.perch = null; P.carry = false; P.sneak = false; P.push = false;
    if (long && !force) {
      P.mode = 'alert'; P.t = 0; setAnim('look'); faceMouse(); say('!', 0.7);
    } else { P.mode = 'move'; P.t = 0; }
  }
  function jumpTo(tx, ty, opts) {
    opts = opts || {};
    P.afterJump = null; P.carry = false; P.sneak = false; P.push = false;
    var dist = Math.hypot(tx - P.x, ty - P.y);
    P.jump = { x0: P.x, y0: P.y, tx: tx, ty: ty, t: 0, dur: clamp(0.35 + dist / (CFG.size * 5), 0.4, 0.9),
      h: opts.h != null ? opts.h : CFG.size * 0.45, perch: opts.perch || null };
    P.mode = 'jump'; P.perch = null; setAnim('jump'); sfx('jump');
    P.face = tx >= P.x ? 1 : -1;
  }
  function leavePerch() {
    var tx, ty;
    if (mouse.has && clock() - mouse.lastMove < 4) {
      var ang = Math.atan2(mouse.y - P.y, mouse.x - P.x);
      tx = P.x + Math.cos(ang) * CFG.size * 1.2; ty = clamp(mouse.y, P.y + CFG.size * 0.6, innerHeight - 4);
    } else { tx = P.x + rnd(-1, 1) * CFG.size; ty = Math.min(innerHeight - 4, P.y + CFG.size * rnd(1.0, 1.8)); }
    tx = clamp(tx, CFG.size * 0.4, innerWidth - CFG.size * 0.4);
    P.perch = null;
    jumpTo(tx, ty, { h: CFG.size * 0.35 });
    P.afterJump = function () { if (mouse.has && clock() - mouse.lastMove < 5 && mdist() > STOP_R()) beginFollow(true); else toIdle(); };
  }
  function throwAt(tx, ty) {
    if (P.mode === 'held' || P.mode === 'jump' || P.mode === 'climb' || P.mode === 'enter') return;
    if (P.mode !== 'idle' && P.mode !== 'perched') { var pp = P.perch; toIdle(); if (pp) P.perch = null; }
    P.face = tx >= P.x ? 1 : -1;
    P.shot = { tx: tx, ty: ty, fired: false };
    startPose('throw', 0.95);
  }

  /* ---- pose logic shared by ground + perch -------------------------------- */
  function startPose(name, dur) {
    var def = POSES[name] || {};
    P.pose = name; P.poseT = 0; P.lastSay = 0;
    P.poseDur = dur != null ? dur : (def.dur ? rnd(def.dur[0], def.dur[1]) : rnd(3, 6));
    if (name === 'sit') P.sitAnim = P.perch ? 'sit_side' : pick(['sit_a', 'sit_b', 'sit_c', 'sit_d', 'sit_e', 'sit_f', 'sit_g']);
    if (name === 'cosplay') P.costumeAnim = COSTUMES.length ? pick(COSTUMES) : 'idle';
    if (def.face) emote(def.face, Math.min(P.poseDur, 2.2));
    else if (def.say) say(def.say, Math.min(P.poseDur, 2.2)); else bubT = 0;
    P.travelMark = mouse.travel;
  }
  function pickPose(onPerch, quiet) {
    var names = [], total = 0;
    for (var n in POSES) {
      var d = POSES[n]; if (!d.w) continue;
      if (d.minQuiet && quiet < d.minQuiet) continue;
      var w = onPerch ? d.w.p : d.w.g;
      if (w > 0) { names.push([n, w]); total += w; }
    }
    var r = Math.random() * total;
    for (var i = 0; i < names.length; i++) { r -= names[i][1]; if (r <= 0) return names[i][0]; }
    return 'stand';
  }
  function wakeAndFollow() {
    if (P.perch) { say('!', 0.7); leavePerch(); return; }
    beginFollow();
  }
  function posesTick(dt) {
    P.poseT += dt; P.idleT += dt;
    var quiet = clock() - mouse.lastMove;
    var onPerch = !!P.perch, d = mdist();

    // cursor woke us up?
    if (CFG.follow && mouse.has) {
      var moved = mouse.travel - P.travelMark;
      var need = asleep() ? 140 : 40;
      var far = onPerch ? d > CFG.size * 2.5 : d > STOP_R() * 1.5;
      var thresh = onPerch ? Math.max(need, 320) : need;
      if (far && moved > thresh && quiet < 1.5) { wakeAndFollow(); return; }
    }

    var def = POSES[P.pose];
    switch (P.pose) {
      case 'stand':
        if (d < CFG.size * 4 && d !== Infinity) { faceMouse(); setAnim(Math.abs(mouse.x - P.x) > 14 ? 'look' : 'idle'); }
        else setAnim('idle');
        break;
      case 'sit': setAnim(P.sitAnim); break;
      case 'sitsleepy': setAnim('sit_sleepy'); break;
      case 'sleep': setAnim(P.sleepAnim); P.snoreT += dt; if (P.snoreT > 2.8) { P.snoreT = 0; sfx('snore'); } break;
      case 'custom': break;
      case 'cosplay': setAnim(P.costumeAnim); break;
      case 'stroll': {
        var r = P.perch && perchOk(P.perch.el);
        if (!r) break;
        var tu = P.stroll, cur = P.perch.u, spd = CFG.size * 0.9 * CFG.speed / r.width * dt;
        if (Math.abs(tu - cur) <= spd) { P.perch.u = tu; startPose('stand', rnd(2, 5)); }
        else { P.perch.u += Math.sign(tu - cur) * spd; P.face = tu > cur ? 1 : -1; setAnim('walk_side'); }
        return;
      }
      default:
        if (def && def.anim) setAnim(def.anim);
        if (def && def.sayList && P.poseT - P.lastSay > def.sayEvery) { P.lastSay = P.poseT; say(pick(def.sayList), 1.3); if (P.pose === 'guitar') sfx('note'); }
    }

    if (P.pose === 'throw' && P.shot && !P.shot.fired && P.poseT > 0.4) {
      var S = P.shot; S.fired = true;
      var sx = P.x + P.face * CFG.size * 0.35, sy = P.y - CFG.size * 0.62;
      var dist = Math.hypot(S.tx - sx, S.ty - sy);
      sfx('throw');
      pebble = { x0: sx, y0: sy, tx: S.tx, ty: S.ty, t: 0, dur: clamp(dist / (CFG.size * 9), 0.3, 0.9), arc: Math.min(dist * 0.25, CFG.size * 1.4), px: sx, py: sy };
    }

    if (P.poseT < P.poseDur && P.pose !== 'stroll') return;
    P.shot = null;

    // choose what to do next
    if (P.pose === 'sleep') { P.poseDur = 999; return; }
    if (P.pose === 'sitsleepy') {
      P.sleepAnim = pick(['sleep', 'sleep_b', 'sleep_curl', 'sleep_pillow']);
      startPose('sleep', 999); return;
    }
    if (P.idleT > (NIGHT ? 10 : 22) && quiet > (NIGHT ? 8 : 18)) { startPose('sitsleepy', 3.5); return; }

    var roll = Math.random();
    if (P.pose !== 'stand') { startPose('stand', rnd(2.5, 6)); return; }
    if (onPerch) {
      var r2 = perchOk(P.perch.el);
      if (!r2 || (clock() - P.perch.t0 > 70)) { leavePerch(); return; }
      if (roll < 0.28) { P.stroll = rnd(0.1, 0.9); P.pose = 'stroll'; P.poseT = 0; }
      else if (roll < 0.36 && quiet > 6) leavePerch();
      else startPose(pickPose(true, quiet));
    } else {
      if (roll < 0.12 && !REDUCED) startWander();
      else if (roll < 0.30 && CFG.perch && quiet > 3.5) { if (!startPerchTrip()) startPose('stand', rnd(3, 6)); }
      else startPose(pickPose(false, quiet));
    }
  }

  function startTag(secs) {
    if (!mouse.has || REDUCED) return;
    P.perch = null; P.carry = false; P.sneak = false; P.push = false; P.jump = null; P.z = 0; P.hide = false;
    P.mode = 'flee'; P.game = { t: 0, dur: secs || 14, caught: 0, cool: 0, stun: 0 };
    say('catch me!', 1.6);
  }
  function updateFlee(dt) {
    var G = P.game;
    G.t += dt; G.cool -= dt;
    if (G.t > G.dur || !mouse.has) {
      var n = G.caught; P.game = null; toIdle();
      startPose('laugh'); say(n > 0 ? 'caught ' + n + 'x!' : 'too slow!', 2.6); return;
    }
    if (G.stun > 0) { G.stun -= dt; setAnim('cheer'); return; }
    var dx = P.x - mouse.x, dy = P.y - mouse.y, d = Math.hypot(dx, dy) || 1;
    if (d < CFG.size * 0.65 && G.cool <= 0) { G.caught++; G.cool = 1.4; G.stun = 0.7; say('caught!', 1); return; }
    var b = bounds(), fx = dx / d, fy = dy / d;
    if (P.x < b.minX + CFG.size) fx += 1.4; if (P.x > b.maxX - CFG.size) fx -= 1.4;
    if (P.y < b.minY + CFG.size * 0.4) fy += 1.4; if (P.y > b.maxY - CFG.size * 0.3) fy -= 1.4;
    var l = Math.hypot(fx, fy) || 1;
    if (d < CFG.size * 4.5) steer(P.x + fx / l * 420, P.y + fy / l * 420, dt, true);
    else { faceMouse(); setAnim('look'); }
    clampPos();
  }

  /* ---- visitors ------------------------------------------------------------ */
  function startDog() {
    dog.on = true; dog.moving = true; dog.dir = Math.random() < 0.5 ? 1 : -1; dog.t = 0; dog.near = false;
    dog.x = dog.dir > 0 ? -CFG.size : innerWidth + CFG.size; dog.y = innerHeight - 4;
  }
  function updateDog(dt) {
    if (CFG.dog === 'follow') {
      if (P.hide) { dog.on = false; return; }
      if (!dog.on) { dog.on = true; dog.x = P.x - CFG.size; dog.y = P.y; dog.dir = 1; dog.t = 0; }
      var ox = dog.x, oy = dog.y, k = Math.min(1, dt * 2.2);
      dog.x += (P.x - P.face * CFG.size * 0.9 - dog.x) * k; dog.y += (P.y - dog.y) * k;
      dog.moving = Math.hypot(dog.x - ox, dog.y - oy) / Math.max(dt, 0.001) > 25;
      if (dog.moving) { dog.dir = dog.x >= ox ? 1 : -1; dog.t += dt; } else dog.dir = P.x >= dog.x ? 1 : -1;
      return;
    }
    if (CFG.dog !== 'visit') return;
    if (!dog.on) {
      if (CFG.dog === 'visit' && clock() > dog.next && (P.mode === 'idle' || P.mode === 'perched') && !asleep()) startDog();
      return;
    }
    dog.t += dt; dog.x += dog.dir * CFG.size * 3.6 * dt;
    if (!dog.near && Math.abs(dog.x - P.x) < CFG.size * 2.2 && (P.mode === 'idle' || P.mode === 'perched') && !asleep()) {
      dog.near = true; P.face = dog.x >= P.x ? 1 : -1; (Math.random() < 0.5 ? say(pick(['!', 'woof?']), 1.4) : emote('face_laugh', 1.4));
    }
    if ((dog.dir > 0 && dog.x > innerWidth + CFG.size) || (dog.dir < 0 && dog.x < -CFG.size)) {
      dog.on = false; dog.next = clock() + rnd(70, 160);
    }
  }

  function greeting() {
    var h = new Date().getHours();
    return h >= 5 && h < 12 ? 'good morning!' : h >= 12 && h < 17 ? 'hi there!' : h >= 17 && h < 22 ? 'good evening!' : 'still up?';
  }
  // reads the text of the thing he just climbed (or its data-arijit-say tip)
  function readPerch(el) {
    if (!el) return;
    var txt = el.getAttribute('data-arijit-say') || el.getAttribute('aria-label') || el.getAttribute('alt') || '';
    if (!txt) { var it = (el.innerText || el.value || el.placeholder || '').split('\n'); for (var i = 0; i < it.length; i++) { if (it[i].trim()) { txt = it[i].trim(); break; } } }
    txt = txt.replace(/\s+/g, ' ').trim();
    if (txt.length < 2) return;
    if (!el.hasAttribute('data-arijit-say') && Math.random() < 0.4) return;
    say(txt.length > 46 ? txt.slice(0, 44) + '…' : txt, 3);
  }

  /* ======================================================================== */
  /*  Main update                                                              */
  /* ======================================================================== */
  function update(dt) {
    P.t += dt; P.animT += dt;
    if (bubT > 0) bubT -= dt;
    if (clock() - mouse.lastMove > 0.12) mouse.speed = 0;

    // footsteps
    if (CFG.sound && (P.mode === 'move' || P.mode === 'goto' || P.mode === 'flee') && /^(walk|run|carry|crawl|push)/.test(P.anim)) {
      P.stepT += dt;
      if (P.stepT > (P.running ? 0.17 : 0.3)) { P.stepT = 0; sfx('step'); }
    }
    // flinch when the cursor lunges at him
    if ((P.mode === 'idle' || P.mode === 'perched') && !asleep() && P.pose !== 'hide' && P.pose !== 'cheer' && P.pose !== 'throw' &&
        mouse.speed > 2200 && mdist() < CFG.size * 2.2 && clock() > P.hideCool) { P.hideCool = clock() + 6; startPose('hide'); }

    // projectile
    if (pebble) {
      pebble.t += dt / pebble.dur;
      var k = Math.min(pebble.t, 1);
      pebble.px = pebble.x0 + (pebble.tx - pebble.x0) * k;
      pebble.py = pebble.y0 + (pebble.ty - pebble.y0) * k - Math.sin(Math.PI * k) * pebble.arc;
      if (pebble.t >= 1) { ring(pebble.tx, pebble.ty); pebble = null; }
    }
    // door prop
    if (door) {
      door.t += dt;
      door.a = door.t < 0.4 ? door.t / 0.4 : (door.t < door.fadeAt ? 1 : Math.max(0, 1 - (door.t - door.fadeAt) / 0.6));
      if (door.t > door.fadeAt && door.a <= 0) door = null;
    }
    updateDog(dt);

    // reacting to hovering things
    if (mouse.hover !== P.lastHover) {
      P.lastHover = mouse.hover;
      if (mouse.hover && (P.mode === 'idle' || P.mode === 'perched') && !asleep() && Math.random() < 0.45 && mdist() < CFG.size * 5) { if (Math.random() < 0.5) say('?', 1.2); else emote('face_skeptic', 1.4); }
    }

    switch (P.mode) {

      case 'enter': {            // walk out of the door
        P.hide = P.t < 0.8;
        if (P.t >= 0.8 && P.t < 1.6) { P.dir = 'down'; P.face = 1; P.y += CFG.size * 0.8 * dt; setAnim('walk_down'); }
        if (P.t >= 1.6) { if (door) door.fadeAt = door.t; toIdle(); startPose('cheer'); say(greeting(), 2.8); }
        break;
      }

      case 'idle':
        if (CFG.follow && mouse.has && mdist() > STOP_R() * 1.5 && clock() - mouse.lastMove < 4 &&
            !asleep() && P.pose !== 'cheer' && P.pose !== 'yell' && P.pose !== 'throw') { beginFollow(); break; }
        posesTick(dt);
        if (P.mode === 'idle') clampPos();
        break;

      case 'flee': updateFlee(dt); break;

      case 'alert':
        faceMouse();
        if (P.t > 0.45) { P.mode = 'move'; P.t = 0; }
        break;

      case 'move': {
        if (!mouse.has) { toIdle(); break; }
        if (mdist() <= STOP_R()) { toIdle(); break; }
        steer(mouse.x, mouse.y, dt, true);
        clampPos();
        break;
      }

      case 'goto': {
        var g = P.goal, tx, ty;
        if (!g) { toIdle(); break; }
        if (g.type === 'perch') {
          var r = perchOk(g.el);
          if (!r) { toIdle(); break; }
          tx = g.side < 0 ? r.left - 6 : r.right + 6;
          ty = Math.min(r.bottom, innerHeight - 4);
          tx = clamp(tx, CFG.size * 0.3, innerWidth - CFG.size * 0.3);
          var rem = steer(tx, ty, dt, true);
          if (rem < 3) {
            var h = ty - r.top;
            if (h < CFG.size * 0.9) {
              var u = g.side < 0 ? 0.12 : 0.88;
              jumpTo(r.left + u * r.width, r.top, { perch: { el: g.el, u: u }, h: Math.max(h * 0.5, CFG.size * 0.3) });
            } else {
              P.carry = false; P.sneak = false; P.push = false; emote('face_determined', 1.2);
              P.mode = 'climb'; P.t = 0; P.climb = { el: g.el, side: g.side, rel: h };
            }
          }
        } else {
          var rem2 = steer(g.x, g.y, dt, false);
          if (rem2 < 3) toIdle();
        }
        if (g.type === 'point' && CFG.follow && mouse.has && clock() - mouse.lastMove < 0.6 && mdist() > STOP_R() * 2) beginFollow(true);
        clampPos();
        break;
      }

      case 'climb': {
        var c = P.climb, rc = perchOk(c.el);
        if (!rc) { P.perch = null; jumpTo(P.x, Math.min(innerHeight - 4, P.y + CFG.size * 0.8), { h: 6 }); P.afterJump = toIdle; break; }
        c.rel -= CFG.size * 0.75 * CFG.speed * dt;
        P.x = c.side < 0 ? rc.left - 4 : rc.right + 4;
        P.y = rc.top + Math.max(c.rel, 0);
        P.face = 1; setAnim('climb');
        if (c.rel <= 0) {
          P.perch = { el: c.el, u: clamp((P.x - rc.left) / rc.width, 0.05, 0.95), t0: clock() };
          P.mode = 'perched'; P.idleT = 0; P.running = false;
          startPose('cheer'); readPerch(c.el);
        }
        break;
      }

      case 'perched': {
        var rp = perchOk(P.perch.el);
        if (!rp) { P.perch = null; jumpTo(P.x, Math.min(innerHeight - 4, P.y + CFG.size * 1.4), { h: CFG.size * 0.2 }); P.afterJump = toIdle; break; }
        P.x = rp.left + P.perch.u * rp.width; P.y = rp.top;
        P.x = clamp(P.x, rp.left + 4, rp.right - 4);
        posesTick(dt);
        break;
      }

      case 'jump': {
        var J = P.jump;
        J.t += dt / J.dur;
        var ttx = J.tx, tty = J.ty;
        if (J.perch) { var rj = perchOk(J.perch.el); if (rj) { ttx = rj.left + J.perch.u * rj.width; tty = rj.top; } }
        var kk = Math.min(J.t, 1), e = kk * kk * (3 - 2 * kk);
        P.x = J.x0 + (ttx - J.x0) * e; P.y = J.y0 + (tty - J.y0) * kk;
        P.z = Math.sin(Math.PI * kk) * J.h;
        P.face = ttx >= J.x0 + 1 ? 1 : (ttx <= J.x0 - 1 ? -1 : P.face);
        setAnim('jump');
        if (J.t >= 1) {
          P.z = 0; P.jump = null;
          if (J.perch && perchOk(J.perch.el)) {
            P.perch = { el: J.perch.el, u: J.perch.u, t0: clock() };
            P.mode = 'perched'; P.idleT = 0; startPose('cheer'); readPerch(J.perch.el);
          } else {
            var cb = P.afterJump; P.afterJump = null;
            clampPos();
            if (cb) cb(); else toIdle();
          }
        }
        break;
      }

      case 'held': {
        P.x = mouse.x; P.y = mouse.y + CFG.size * 0.85; clampPos();
        P.z = 0; setAnim('cheer');
        break;
      }
    }
  }

  /* ======================================================================== */
  /*  Input                                                                    */
  /* ======================================================================== */
  function setMouse(e) {
    var x = e.clientX, y = e.clientY;
    if (mouse.has) {
      var dd = Math.hypot(x - mouse.x, y - mouse.y), dtm = Math.max(0.008, clock() - mouse.lastMove);
      mouse.travel += dd; mouse.speed = 0.6 * mouse.speed + 0.4 * (dd / dtm);
    }
    mouse.x = x; mouse.y = y; mouse.has = true; mouse.lastMove = clock();
  }
  function hitPet(x, y) {
    var f = frameNow(), s = sc(), w = f.w * s, h = f.h * s;
    return !P.hide && Math.abs(x - P.x) < Math.max(w, CFG.size * 0.5) * 0.5 && y < P.y && y > P.y - Math.max(h, CFG.size * 0.5);
  }
  function onDown(e) {
    setMouse(e);
    if (!CFG.interact || e.button !== 0 || REDUCED) return;
    if (P.mode === 'enter' || !hitPet(e.clientX, e.clientY)) return;
    if (P.mode === 'held') return;
    P.held = { t0: clock(), x0: e.clientX, y0: e.clientY, prevPerch: P.perch, moved: false, ground: { x: P.x, y: P.y } };
    P.mode = 'held'; P.perch = null; P.jump = null; P.z = 0; P.carry = false; P.sneak = false; P.push = false;
    e.preventDefault();
    e.stopPropagation();
  }
  function onMove(e) {
    setMouse(e);
    if (P.mode === 'held' && P.held && Math.hypot(e.clientX - P.held.x0, e.clientY - P.held.y0) > 6) P.held.moved = true;
  }
  function onUp() {
    if (P.mode !== 'held' || !P.held) return;
    var H = P.held; P.held = null;
    if (!H.moved) {          // a poke
      var pr = H.prevPerch && perchOk(H.prevPerch.el);
      if (pr) { P.perch = H.prevPerch; P.mode = 'perched'; P.x = pr.left + P.perch.u * pr.width; P.y = pr.top; }
      else { P.x = H.ground.x; P.y = H.ground.y; toIdle(); }
      P.idleT = 0; startPose(Math.random() < 0.4 ? 'yell' : 'cheer');
      var nowp = clock(); pokes = pokes.filter(function (t) { return nowp - t < 2.5; }); pokes.push(nowp);
      if (pokes.length >= 3) { pokes = []; emote('face_angry', 1.2); startTag(14); }
      return;
    }
    var list = CFG.perch ? candidates() : [], best = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].r;
      if (P.x > r.left + 6 && P.x < r.right - 6 && Math.abs(P.y - r.top) < CFG.size * 0.6) { best = list[i]; break; }
    }
    if (best) {
      var u = clamp((P.x - best.r.left) / best.r.width, 0.08, 0.92);
      jumpTo(best.r.left + u * best.r.width, best.r.top, { perch: { el: best.el, u: u }, h: CFG.size * 0.2 });
    } else {
      jumpTo(P.x, Math.min(innerHeight - 4, P.y + CFG.size * 0.35), { h: CFG.size * 0.25 });
      P.afterJump = function () { toIdle(); say('!', 0.8); };
    }
  }
  function onKey(e) {
    if (e.altKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) { setHidden(!HID); return; }
    if (HID || REDUCED || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'CapsLock') return;
    if (P.mode !== 'idle' && P.mode !== 'perched') return;
    if (asleep()) { startPose('stand', 3); say('!', 0.8); return; }
    if (P.pose === 'laptop') { P.poseT = 0; return; }
    if (P.pose === 'cheer' || P.pose === 'yell' || P.pose === 'throw') return;
    P.idleT = 0; startPose('laptop', 6);
  }
  function onDbl(e) {
    if (REDUCED || !CFG.interact || hitPet(e.clientX, e.clientY)) return;
    if (asleep()) { startPose('stand', 2); say('!', 0.8); return; }
    throwAt(e.clientX, e.clientY);
  }
  function onOver(e) {
    var t = e.target && e.target.closest ? e.target : null;
    mouse.hover = t && t.closest('a,button,[role=button],input,textarea,select,summary,[data-arijit-hover]');
    var tip = t && t.closest('[data-arijit-say]');
    if (tip !== tipEl) {
      clearTimeout(tipTimer); tipEl = tip;
      if (tip && !HID) tipTimer = setTimeout(function () { if (P.mode !== 'held' && P.mode !== 'enter') say(tip.getAttribute('data-arijit-say'), 3.6); }, 350);
    }
  }
  function onClick(e) {
    if (REDUCED || HID || (P.mode !== 'idle' && P.mode !== 'perched') || asleep() || hitPet(e.clientX, e.clientY)) return;
    var t = e.target; if (!t || !t.closest) return;
    if (t.closest('a[href]')) startPose('laugh');
    else if (t.closest('button,[role=button],input[type=submit],input[type=button]')) {
      var bt = t.closest('button,[role=button],input[type=submit],input[type=button]');
      if (bt.form) return;   // submit / invalid handlers react to forms
      if (P.mode === 'idle' && P.pose !== 'cheer') {
        var f = P.face; jumpTo(P.x, P.y, { h: CFG.size * 0.35 }); P.face = f;
        P.afterJump = function () { toIdle(); startPose('cheer'); };
      } else startPose('cheer');
    }
  }
  function react(name) {
    var n = clock();
    if (HID || REDUCED || n < P.reactCool || (P.mode !== 'idle' && P.mode !== 'perched') || asleep()) return;
    P.reactCool = n + 1.5; startPose(name);
  }
  function onSubmit() { react('yell'); }
  function onInvalid() { react('worried'); }
  function onScroll() {
    var n = clock(), y = window.scrollY || 0;
    scr.acc = scr.acc * Math.exp(-(n - scr.t) / 0.8) + Math.abs(y - scr.y); scr.y = y; scr.t = n;
    if (scr.acc > 2600 && n > scr.cool && !HID && (P.mode === 'idle' || P.mode === 'perched') && !asleep()) { scr.cool = n + 10; scr.acc = 0; startPose('dizzy'); }
  }
  function setHidden(v) {
    HID = !!v;
    if (root) root.style.display = HID ? 'none' : '';
    try { localStorage.setItem('arijit:hidden', HID ? '1' : '0'); } catch (e) {}
    if (btnEl) btnEl.style.opacity = HID ? '0.45' : '1';
    if (!HID) last = performance.now();
  }
  function makeButton() {
    btnEl = document.createElement('button');
    btnEl.type = 'button'; btnEl.textContent = '☺'; btnEl.title = 'Show / hide the companion (Alt+Shift+A)';
    btnEl.setAttribute('aria-label', 'Show or hide the companion');
    btnEl.style.cssText = 'position:fixed;right:10px;bottom:10px;width:28px;height:28px;border-radius:50%;border:2px solid #2b2233;background:#ffd24a;color:#2b2233;' +
      'font:700 15px/1 system-ui,sans-serif;cursor:pointer;z-index:2147483646;padding:0;box-shadow:0 2px 0 rgba(0,0,0,.25);';
    btnEl.addEventListener('click', function () { setHidden(!HID); });
    document.documentElement.appendChild(btnEl);
  }
  function onOut() { mouse.hover = null; }
  function onResize() { clampPos(); }
  function save() {
    if (!CFG.persist) return;
    try { localStorage.setItem(STORE, JSON.stringify({ x: P.x / innerWidth, y: P.y / innerHeight })); } catch (e) {}
  }

  /* ======================================================================== */
  /*  Loop + boot                                                              */
  /* ======================================================================== */
  function loop(now) {
    if (!alive) return;
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!HID) { update(dt); render(); }
    raf = requestAnimationFrame(loop);
  }

  function boot() {
    build();
    var saved = null;
    if (CFG.persist) { try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (e) {} }
    var entered = false;
    try { entered = !!sessionStorage.getItem(ENTERED); sessionStorage.setItem(ENTERED, '1'); } catch (e) {}

    if (saved && isFinite(saved.x) && isFinite(saved.y)) { P.x = saved.x * innerWidth; P.y = saved.y * innerHeight; }
    else { P.x = Math.min(innerWidth - CFG.size, CFG.size * 1.8); P.y = innerHeight - CFG.size * 0.8 - 8; }
    clampPos();
    P.travelMark = 0;

    if (REDUCED) { P.anim = 'idle'; render(); return; }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('keydown', onKey, { passive: true });
    window.addEventListener('click', onClick, { passive: true, capture: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('invalid', onInvalid, true);
    var unlock = function () { if (CFG.sound) audio(true); }; window.addEventListener('pointerdown', unlock, { passive: true }); window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('dblclick', onDbl, { passive: true });
    document.addEventListener('mouseover', onOver, { passive: true });
    document.addEventListener('mouseout', onOut, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { save(); awayAt = clock(); }
      else {
        last = performance.now();
        if (awayAt && clock() - awayAt > 25 && !HID && (P.mode === 'idle' || P.mode === 'perched')) { if (asleep()) startPose('stand', 2); startPose('sad'); }
        awayAt = 0;
      }
    });
    var hr = new Date().getHours(), dark = false;
    try { dark = matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
    NIGHT = hr >= 23 || hr < 5 || (dark && hr >= 20);
    scr.y = window.scrollY || 0; scr.t = clock();
    if (CFG.button) makeButton();
    try { if (localStorage.getItem('arijit:hidden') === '1') setHidden(true); } catch (e) {}

    dog.next = clock() + rnd(40, 90);
    if (!saved && !entered && CFG.entrance && ATLAS.frames.prop_door) {
      door = { x: P.x, y: P.y + CFG.size * 0.06, t: 0, a: 0, fadeAt: Infinity };
      P.mode = 'enter'; P.t = 0; P.hide = true;
    } else startPose('cheer', 1.2);
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  /* ---- public API ---------------------------------------------------------- */
  window.arijit = {
    say: function (t, s) { say(String(t), s); },
    goTo: function (x, y) { P.goal = { type: 'point', x: x, y: y }; P.mode = 'goto'; P.perch = null; P.carry = false; P.sneak = false; P.push = false; },
    perchOn: function (target) {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (el) startPerchTrip({ el: el });
    },
    throwAt: throwAt,
    pose: function (name, secs) { if (POSES[name]) { if (P.mode !== 'idle' && P.mode !== 'perched') toIdle(); startPose(name, secs); } },
    sleep: function () { toIdle(); P.sleepAnim = pick(['sleep', 'sleep_b', 'sleep_curl', 'sleep_pillow']); startPose('sleep', 999); },
    wake: function () { if (P.mode === 'idle' || P.mode === 'perched') { startPose('stand', 3); say('!', 0.8); } },
    play: function (anim, secs) { if (ANIMS[anim]) { toIdle(); P.pose = 'custom'; P.poseDur = secs || 2; P.poseT = 0; setAnim(anim); } },
    dog: function () { if (CFG.dog === 'visit' && !dog.on) startDog(); },
    emote: function (n, s) { emote(n.indexOf('face_') === 0 ? n : 'face_' + n, s); },
    tag: function (secs) { startTag(secs); },
    hide: function () { setHidden(true); },
    show: function () { setHidden(false); },
    setSize: function (px) { CFG.size = px; },
    poses: function () { return Object.keys(POSES); },
    animations: function () { return Object.keys(ANIMS); },
    state: P,
    config: CFG,
    destroy: function () {
      alive = false; cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('keydown', onKey); window.removeEventListener('dblclick', onDbl);
      window.removeEventListener('click', onClick, true); window.removeEventListener('scroll', onScroll);
      document.removeEventListener('submit', onSubmit, true); document.removeEventListener('invalid', onInvalid, true);
      if (btnEl) btnEl.remove();
      document.removeEventListener('mouseover', onOver); document.removeEventListener('mouseout', onOut);
      window.removeEventListener('resize', onResize); window.removeEventListener('pagehide', save);
      if (root) root.remove();
      var s = document.getElementById('arijit-style'); if (s) s.remove();
      window.__arijitLoaded = false; delete window.arijit;
    }
  };

  function start() {
    var img = new Image();
    img.onload = boot;
    img.onerror = function () { console.warn('[arijit] could not load sprite atlas:', CFG.atlas); };
    img.src = CFG.atlas;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
