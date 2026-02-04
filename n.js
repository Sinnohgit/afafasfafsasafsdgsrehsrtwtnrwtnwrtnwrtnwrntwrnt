/*  FREEDOM — Roguelike Top-Down Shooter (single-file JS)
    Inspired by room-based roguelikes (Soul Knight / Isaac vibe).
    - Pure JS UI (no HTML required in this file)
    - Exposes global create() so external launcher can call it
    - Pixel-rendering + procedural rooms + minimap
    - Items, weapons, enemies, elites, shops, bosses
    - Watermark: freegameslist.blog

    Controls:
    P1:
      Move: WASD
      Aim: Mouse
      Shoot: LMB (hold)
      Dash/Roll: Space
      Interact/Buy: E
      Reload: R
      Toggle minimap: Tab
      Pause: Esc
      Fullscreen: F

    Notes:
    - If you load via <script src="..."> from a data:text/html page,
      ensure your host serves the JS file correctly and without redirects.
*/

(function () {
  "use strict";

  // ---------- Cleanup previous instance ----------
  const prev = window.__FREEDOM__;
  if (prev && prev.destroy) { try { prev.destroy(); } catch (_) {} }
  const __F = (window.__FREEDOM__ = { destroy: null });

  // ---------- Utilities ----------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => (a + Math.random() * (b - a + 1)) | 0;
  const chance = (p) => Math.random() < p;
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const len = (x, y) => Math.sqrt(x * x + y * y);
  const norm = (x, y) => { const l = Math.sqrt(x * x + y * y) || 1; return { x: x / l, y: y / l, l }; };
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // ---------- Theme ----------
  const THEME = {
    bg: "#050008",
    uiPanel: "rgba(255,255,255,0.06)",
    uiBorder: "rgba(255,255,255,0.10)",
    text: "#ffffff",
    dim: "rgba(255,255,255,0.78)",
    neonA: "#7c5cff",
    neonB: "#00fff0",
    neonC: "#ff3bd4",
    good: "#62ff76",
    warn: "#ffcc00",
    bad: "#ff3355",
  };

  // ---------- Storage: local leaderboard ----------
  const SCORE_KEY = "freedom_scores_v1";
  function loadScores() {
    try {
      const raw = localStorage.getItem(SCORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x.n === "string" && typeof x.s === "number")
        .sort((a, b) => b.s - a.s)
        .slice(0, 10);
    } catch (_) { return []; }
  }
  function saveScore(name, score) {
    name = (name || "ANON").toString().trim().slice(0, 12).toUpperCase() || "ANON";
    const arr = loadScores();
    arr.push({ n: name, s: score | 0, t: Date.now() });
    arr.sort((a, b) => b.s - a.s);
    const top = arr.slice(0, 10);
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(top)); } catch (_) {}
    return top;
  }

  // ---------- DOM helpers ----------
  function el(tag, props, parent) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === "style") for (const s in props.style) e.style[s] = props.style[s];
        else if (k === "text") e.textContent = props.text;
        else if (k === "html") e.innerHTML = props.html;
        else if (k in e) e[k] = props[k];
        else e.setAttribute(k, props[k]);
      }
    }
    if (parent) parent.appendChild(e);
    return e;
  }

  function injectCSS() {
    const css = `
      html,body{height:100%;margin:0;background:${THEME.bg};color:${THEME.text};}
      body{font:14px system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;overflow:hidden;}
      canvas{display:block;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;}
      .f-wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;}
      .f-shell{width:min(1120px,92vw);border-radius:18px;padding:18px;
        background:linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02));
        border:1px solid rgba(255,255,255,0.10);
        box-shadow:0 30px 90px rgba(0,0,0,0.55);
      }
      .f-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;}
      .f-title{font-size:18px;font-weight:900;letter-spacing:.6px;}
      .f-sub{opacity:.75;font-size:12px;margin-top:2px;}
      .f-row{display:flex;gap:12px;flex-wrap:wrap;}
      .f-card{flex:1;min-width:270px;border-radius:16px;padding:14px;background:rgba(0,0,0,0.22);
        border:1px solid rgba(255,255,255,0.08);}
      .f-card h3{margin:0 0 10px 0;font-size:13px;letter-spacing:.5px;text-transform:uppercase;opacity:.85;}
      .f-btn{appearance:none;border:0;border-radius:12px;padding:10px 14px;font-weight:900;cursor:pointer;
        color:#fff;background:${THEME.neonA};box-shadow:0 10px 30px rgba(124,92,255,0.25);}
      .f-btn.secondary{background:rgba(255,255,255,0.12);font-weight:800;box-shadow:none;}
      .f-btn.ghost{background:transparent;border:1px solid rgba(255,255,255,0.15);font-weight:800;box-shadow:none;}
      .f-btn:active{transform:translateY(1px)}
      .f-kv{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);}
      .f-kv:last-child{border-bottom:0}
      .f-small{font-size:12px;opacity:.8;line-height:1.35}
      .f-hr{height:1px;background:rgba(255,255,255,0.08);margin:12px 0}
      .f-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px;opacity:.8;font-size:12px}
      .f-water{opacity:.35}
      .f-game{position:fixed;inset:0;display:none;background:${THEME.bg};}
      .f-ui{position:fixed;inset:0;pointer-events:none;}
      .f-hud{position:fixed;left:0;right:0;top:0;display:flex;justify-content:space-between;gap:10px;padding:10px;
        font:12px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;pointer-events:none;}
      .f-hud .box{padding:10px 12px;border-radius:14px;background:rgba(0,0,0,0.25);
        border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(8px);}
      .f-center{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
        background:rgba(0,0,0,0.48);border:1px solid rgba(255,255,255,0.12);
        border-radius:18px;padding:16px 18px;min-width:min(560px,92vw);
        backdrop-filter:blur(10px);display:none;pointer-events:auto;}
      .f-center h2{margin:0 0 8px 0;font-size:16px;letter-spacing:.4px;}
      .f-center p{margin:6px 0;opacity:.85;font-size:12px;line-height:1.35}
      .f-input{width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);
        background:rgba(255,255,255,0.06);color:#fff;outline:none;}
      .f-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;
        border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);opacity:.85}
      .f-map{position:fixed;left:12px;bottom:12px;width:210px;height:160px;border-radius:14px;
        background:rgba(0,0,0,0.28);border:1px solid rgba(255,255,255,0.10);
        backdrop-filter:blur(8px);pointer-events:none;display:none;}
    `;
    return el("style", { text: css }, document.head);
  }

  // ---------- Rendering (pixel buffer) ----------
  const VIEW_W = 360;        // low-res width
  const VIEW_H = 216;        // low-res height
  const TILE = 12;           // world tile size (world units)
  const ROOM_TW = 17;        // room tiles width
  const ROOM_TH = 13;        // room tiles height
  const ROOM_W = ROOM_TW * TILE;
  const ROOM_H = ROOM_TH * TILE;

  let canvas, ctx, low, lctx;
  function setSmooth(c, v) {
    c.imageSmoothingEnabled = !!v;
    c.mozImageSmoothingEnabled = !!v;
    c.webkitImageSmoothingEnabled = !!v;
  }

  // ---------- Input ----------
  const keys = Object.create(null);
  const mouse = { x: 0, y: 0, down: false };
  function onKey(e, v) {
    keys[e.code] = v;
    const block = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space","Tab"];
    if (block.includes(e.code)) e.preventDefault();
  }
  function onMouseMove(e) { mouse.x = e.clientX; mouse.y = e.clientY; }
  function onMouseDown() { mouse.down = true; }
  function onMouseUp() { mouse.down = false; }

  // ---------- Game state ----------
  const state = {
    mode: "menu",       // menu | play | pause | gameover
    t: 0,
    dtCap: 0.033,
    floor: 1,
    seed: (Math.random() * 1e9) | 0,
    rngSalt: 0,
    score: 0,
    money: 0,
    keys: 0,
    roomId: "0,0",
    map: null,          // floor map graph
    rooms: null,        // room data dict
    enemies: [],
    bullets: [],
    pickups: [],
    fx: [],
    decals: [],
    cam: { x: 0, y: 0, shake: 0, shakeT: 0 },
    msg: "",
    msgT: 0,
    showMap: false,
    bossAlive: false,
    shopOpen: false,
  };

  // ---------- Player ----------
  function makePlayer() {
    return {
      x: ROOM_W * 0.5,
      y: ROOM_H * 0.65,
      vx: 0, vy: 0,
      r: 5.2,
      hp: 100, hpMax: 100,
      shield: 35, shieldMax: 35,
      shieldDelay: 0,
      invT: 0,
      dashCD: 0,
      dashT: 0,
      rollIframes: 0.12,
      speed: 95,
      friction: 0.82,
      weapon: "starter_pistol",
      weaponObj: null,
      fireCD: 0,
      reloadT: 0,
      ammo: 999,       // reserve
      clip: 10,
      clipMax: 10,
      crit: 0.07,
      luck: 0.0,
      dmgMul: 1.0,
      shotSpeedMul: 1.0,
      rangeMul: 1.0,
      moveMul: 1.0,
      pickupRadius: 20,
      knockResist: 0.0,
      lifeSteal: 0.0,
      thorns: 0.0,
      onHitFreeze: 0.0,
      onHitShock: 0.0,
      homing: 0.0,
      pierce: 0,
      bounce: 0,
      multishot: 0,
      bulletsPerShotAdd: 0,
      spreadMul: 1.0,
      recoil: 0,
      aimX: ROOM_W * 0.5 + 40,
      aimY: ROOM_H * 0.5,
      items: [],        // passive item IDs
      discovered: {},   // for UI flavor if you expand later
    };
  }
  const player = makePlayer();

  // ---------- Weapons ----------
  // Each weapon: rate, dmg, speed, spread, bullets, kick, clip, reload, pelletPattern, special
  const Weapons = {
    starter_pistol: { name:"Starter Pistol", tier:1, rate:0.25, dmg:10, speed:240, spread:0.06, bullets:1, kick:1.1, clip:10, reload:1.1, color:THEME.neonB },
    smg:            { name:"Neon SMG",       tier:2, rate:0.08, dmg:6,  speed:250, spread:0.14, bullets:1, kick:0.6, clip:32, reload:1.25, color:THEME.neonA },
    shotgun:        { name:"Pulse Shotgun",  tier:2, rate:0.70, dmg:5,  speed:215, spread:0.55, bullets:7, kick:2.0, clip:6,  reload:1.45, color:THEME.neonC },
    rail:           { name:"Rail Coil",      tier:3, rate:0.95, dmg:32, speed:380, spread:0.02, bullets:1, kick:2.6, clip:4,  reload:1.75, color:THEME.warn, pierce:2 },
    tesla:          { name:"Tesla Fork",     tier:3, rate:0.38, dmg:11, speed:230, spread:0.10, bullets:1, kick:1.4, clip:14, reload:1.25, color:THEME.neonB, chain:2 },
    bloom:          { name:"Bloom Cannon",   tier:4, rate:0.62, dmg:9,  speed:210, spread:0.22, bullets:3, kick:2.2, clip:9,  reload:1.55, color:THEME.good, burst:3 },
    voidLauncher:   { name:"Void Launcher",  tier:4, rate:1.05, dmg:40, speed:180, spread:0.10, bullets:1, kick:3.0, clip:3,  reload:2.0,  color:"#b18cff", explode:32 },
  };

  function equipWeapon(id) {
    const w = Weapons[id] || Weapons.starter_pistol;
    player.weapon = id;
    player.weaponObj = w;
    player.clipMax = w.clip;
    player.clip = w.clip;
    player.reloadT = 0;
    player.fireCD = 0;
    // reserve ammo limited for high tier (except starter)
    if (id === "starter_pistol") player.ammo = 999;
    else if (w.tier <= 2) player.ammo = 120;
    else if (w.tier === 3) player.ammo = 80;
    else player.ammo = 45;
  }
  equipWeapon("starter_pistol");

  // ---------- Items (passives) ----------
  // “Complex” roguelike flavor: each item changes stats or adds procs.
  const Items = [
    { id:"glass_heart", name:"Glass Heart", tier:2, desc:"+22% dmg, -18 max HP", apply: () => { player.dmgMul *= 1.22; player.hpMax = Math.max(40, (player.hpMax * 0.82)|0); player.hp = Math.min(player.hp, player.hpMax); } },
    { id:"neon_lungs",  name:"Neon Lungs",  tier:1, desc:"+12% move speed", apply: () => { player.moveMul *= 1.12; } },
    { id:"ion_cap",     name:"Ion Cap",     tier:2, desc:"+10 shield max, faster regen", apply: () => { player.shieldMax += 10; player.shield = Math.min(player.shieldMax, player.shield + 10); } },
    { id:"crit_implant",name:"Crit Implant",tier:2, desc:"+8% crit chance", apply: () => { player.crit += 0.08; } },
    { id:"lucky_coin",  name:"Lucky Coin",  tier:1, desc:"+luck (better drops)", apply: () => { player.luck += 0.12; } },
    { id:"mag_coil",    name:"Mag Coil",    tier:2, desc:"+20% shot speed, +10% range", apply: () => { player.shotSpeedMul *= 1.2; player.rangeMul *= 1.10; } },
    { id:"phase_boots", name:"Phase Boots", tier:3, desc:"Dash cooldown reduced, slight i-frames", apply: () => { player.rollIframes += 0.05; } },
    { id:"vamp_wires",  name:"Vamp Wires",  tier:3, desc:"2% lifesteal", apply: () => { player.lifeSteal += 0.02; } },
    { id:"spike_jacket",name:"Spike Jacket",tier:2, desc:"Thorns: reflect small dmg", apply: () => { player.thorns += 0.12; } },
    { id:"cryoshard",   name:"Cryoshard",   tier:3, desc:"Chance to freeze on hit", apply: () => { player.onHitFreeze += 0.15; } },
    { id:"shocknode",   name:"Shock Node",  tier:3, desc:"Chance to shock chain on hit", apply: () => { player.onHitShock += 0.15; } },
    { id:"homing_sig",  name:"Homing Sigil",tier:4, desc:"Bullets lightly home", apply: () => { player.homing += 0.35; } },
    { id:"pierce_pin",  name:"Pierce Pin",  tier:3, desc:"+1 pierce", apply: () => { player.pierce += 1; } },
    { id:"ricochet",    name:"Ricochet Chip",tier:2, desc:"+1 bounce", apply: () => { player.bounce += 1; } },
    { id:"split_core",  name:"Split Core",  tier:4, desc:"Extra projectile per shot", apply: () => { player.bulletsPerShotAdd += 1; player.spreadMul *= 1.15; } },
  ];

  function giveItem(itemId) {
    const it = Items.find(x => x.id === itemId);
    if (!it) return;
    if (player.items.includes(itemId)) return;
    player.items.push(itemId);
    it.apply();
    state.msg = `ITEM: ${it.name}`;
    state.msgT = 1.4;
  }

  // ---------- Rooms / Floor generation ----------
  // Build a small floor graph: start -> branching -> keys -> locked treasure -> shop -> boss
  // The room geometry (walls/obstacles) is generated per room.

  function roomKey(x, y) { return `${x},${y}`; }

  function genFloorGraph() {
    // We generate a connected graph on a 2D grid, then designate special rooms.
    // Layout size grows with floor.
    const radius = clamp(2 + ((state.floor - 1) * 0.5)|0, 2, 4);
    const nodes = new Map();
    const edges = new Map();

    function addNode(x, y) {
      const k = roomKey(x, y);
      if (!nodes.has(k)) nodes.set(k, { x, y, kind:"normal", cleared:false, seen:false, locked:false });
      return nodes.get(k);
    }
    function addEdge(a, b) {
      const ka = roomKey(a.x, a.y), kb = roomKey(b.x, b.y);
      if (!edges.has(ka)) edges.set(ka, new Set());
      if (!edges.has(kb)) edges.set(kb, new Set());
      edges.get(ka).add(kb);
      edges.get(kb).add(ka);
    }

    // Start at (0,0)
    const start = addNode(0,0);
    start.kind = "start";

    // Random walk to create a main path
    let cx = 0, cy = 0;
    const mainLen = 6 + state.floor * 2;
    for (let i = 0; i < mainLen; i++) {
      const dirs = [
        [1,0],[-1,0],[0,1],[0,-1]
      ];
      // bias outward
      dirs.sort(() => Math.random() - 0.5);
      let chosen = null;
      for (const d of dirs) {
        const nx = cx + d[0], ny = cy + d[1];
        if (Math.abs(nx) > radius || Math.abs(ny) > radius) continue;
        chosen = [nx, ny]; break;
      }
      if (!chosen) break;
      const n = addNode(chosen[0], chosen[1]);
      addEdge({x:cx,y:cy}, n);
      cx = chosen[0]; cy = chosen[1];
    }

    // Add branches
    const all = Array.from(nodes.values());
    const branches = 4 + state.floor;
    for (let b = 0; b < branches; b++) {
      const base = all[randi(0, all.length - 1)];
      let bx = base.x, by = base.y;
      const blen = randi(2, 4 + (state.floor>2?1:0));
      for (let i = 0; i < blen; i++) {
        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        dirs.sort(() => Math.random() - 0.5);
        let chosen = null;
        for (const d of dirs) {
          const nx = bx + d[0], ny = by + d[1];
          if (Math.abs(nx) > radius || Math.abs(ny) > radius) continue;
          chosen = [nx, ny]; break;
        }
        if (!chosen) break;
        const n = addNode(chosen[0], chosen[1]);
        addEdge({x:bx,y:by}, n);
        bx = chosen[0]; by = chosen[1];
      }
    }

    // Choose farthest node as boss
    function dMan(n) { return Math.abs(n.x) + Math.abs(n.y); }
    const nodesArr = Array.from(nodes.values());
    let boss = nodesArr[0], best = -1;
    for (const n of nodesArr) {
      if (n.kind === "start") continue;
      const d = dMan(n);
      if (d > best) { best = d; boss = n; }
    }
    boss.kind = "boss";

    // Shop: pick a mid-distance node
    const mids = nodesArr.filter(n => n.kind === "normal" && dMan(n) >= 2);
    if (mids.length) mids[randi(0,mids.length-1)].kind = "shop";

    // Treasure (locked): pick a node near boss but not boss
    const nearBoss = nodesArr.filter(n => n.kind === "normal" && dist2(n.x,n.y,boss.x,boss.y) <= 5);
    if (nearBoss.length) {
      const t = nearBoss[randi(0, nearBoss.length-1)];
      t.kind = "treasure";
      t.locked = true; // needs key
    }

    // Key room: pick another normal node, not adjacent to start
    const keyCandidates = nodesArr.filter(n => n.kind === "normal" && dMan(n) >= 2);
    if (keyCandidates.length) keyCandidates[randi(0,keyCandidates.length-1)].kind = "key";

    // Elite: one room becomes elite combat
    const eliteCandidates = nodesArr.filter(n => n.kind === "normal" && dMan(n) >= 2);
    if (eliteCandidates.length) eliteCandidates[randi(0,eliteCandidates.length-1)].kind = "elite";

    return { nodes, edges, startKey: "0,0" };
  }

  // Room tile types (local to a room):
  // 0 wall, 1 floor, 2 pit, 3 neon puddle (hazard slow + chip), 4 obstacle block, 5 door frame
  function genRoomTiles(kind) {
    const w = ROOM_TW, h = ROOM_TH;
    const g = new Array(w*h).fill(1);

    const at = (x,y) => g[x + y*w];
    const set = (x,y,v) => { g[x + y*w] = v; };

    // walls boundary
    for (let x=0;x<w;x++){ set(x,0,0); set(x,h-1,0); }
    for (let y=0;y<h;y++){ set(0,y,0); set(w-1,y,0); }

    // door gaps: N,S,E,W (actual collision open/closed handled by room state)
    // Put door frames in tiles
    const doors = {
      N: {x:(w/2)|0, y:0},
      S: {x:(w/2)|0, y:h-1},
      W: {x:0, y:(h/2)|0},
      E: {x:w-1, y:(h/2)|0}
    };
    // carve actual gap (floor) but mark frame around it
    function carveDoor(d) {
      if (d==="N") { set(doors.N.x,0,1); set(doors.N.x-1,0,5); set(doors.N.x+1,0,5); }
      if (d==="S") { set(doors.S.x,h-1,1); set(doors.S.x-1,h-1,5); set(doors.S.x+1,h-1,5); }
      if (d==="W") { set(0,doors.W.y,1); set(0,doors.W.y-1,5); set(0,doors.W.y+1,5); }
      if (d==="E") { set(w-1,doors.E.y,1); set(w-1,doors.E.y-1,5); set(w-1,doors.E.y+1,5); }
    }
    // we carve all potential doors; actual open depends on neighbors/locks
    carveDoor("N"); carveDoor("S"); carveDoor("W"); carveDoor("E");

    // obstacles by kind
    const density = kind==="boss" ? 0.10 : kind==="elite" ? 0.18 : kind==="treasure" ? 0.10 : 0.16;
    const pits = kind==="shop" || kind==="treasure" ? 0.05 : 0.10;

    // place blocks
    const tries = 120;
    for (let i=0;i<tries;i++){
      const x=randi(2,w-3), y=randi(2,h-3);
      if (chance(density)) set(x,y,4);
      if (chance(pits)) set(x,y,2);
      if (chance(0.05)) set(x,y,3);
    }

    // ensure center is clear
    for (let y=5;y<8;y++) for (let x=7;x<10;x++) set(x,y,1);

    // special: shop has fewer hazards + more decor
    if (kind==="shop") {
      for (let i=0;i<w*h;i++) if (g[i]===2||g[i]===3) g[i]=1;
      for (let i=0;i<25;i++){
        const x=randi(2,w-3), y=randi(2,h-3);
        if (chance(0.6)) set(x,y,3);
      }
    }

    return g;
  }

  function tileIndex(x,y){ return x + y*ROOM_TW; }
  function tileAtWorld(wx, wy, room) {
    const tx = (wx / TILE) | 0;
    const ty = (wy / TILE) | 0;
    if (tx < 0 || ty < 0 || tx >= ROOM_TW || ty >= ROOM_TH) return 0;
    return room.g[tileIndex(tx,ty)];
  }
  function isWalkable(wx, wy, room) {
    const t = tileAtWorld(wx, wy, room);
    return t === 1 || t === 3 || t === 5; // floor / neon puddle / door frame tile is still floor-ish
  }
  function collideCircle(x,y,r,room) {
    // sample around circle
    const samples = 10;
    for (let i=0;i<samples;i++){
      const a = (i/samples)*TAU;
      const px = x + Math.cos(a)*r;
      const py = y + Math.sin(a)*r;
      const t = tileAtWorld(px,py,room);
      if (t===0 || t===2 || t===4) return true; // wall/pit/block collide
      // door lock collision is handled separately (room.doorsOpen)
      // We'll treat locked doors as walls using a door collider rectangle
    }
    return false;
  }

  // ---------- Entities ----------
  function makeBullet(owner, x,y,vx,vy, dmg, life, opts) {
    return {
      owner, x,y, vx,vy,
      r: 1.8,
      dmg,
      life,
      t: 0,
      pierce: (opts && opts.pierce) || 0,
      bounce: (opts && opts.bounce) || 0,
      homing: (opts && opts.homing) || 0,
      color: (opts && opts.color) || "rgba(255,255,255,0.9)",
      chain: (opts && opts.chain) || 0,
      explode: (opts && opts.explode) || 0,
      slow: (opts && opts.slow) || 0,
      shock: (opts && opts.shock) || 0,
      fromWeapon: (opts && opts.fromWeapon) || "",
    };
  }

  function makePickup(type, x,y, amt, meta) {
    return { type, x,y, r: 6, t:0, amt: amt||1, meta: meta||null };
  }

  function makeFX(kind, x,y, a,b,c) {
    return { kind, x,y, a:a||0, b:b||0, c:c||0, t:0 };
  }

  function makeEnemy(kind, x,y, tier) {
    tier = tier || 1;
    const e = { kind, x,y, vx:0, vy:0, r: 6, hp: 30, hpMax: 30, spd: 48, t:0, alive:true,
      fireCD: rand(0.2,1.0), hitT:0, tier, frozenT:0, shockedT:0, elite:false, knockX:0, knockY:0, knockT:0
    };

    // archetypes
    if (kind==="runner") { e.hp = 26 + tier*6; e.hpMax=e.hp; e.spd=64 + tier*6; e.r=5.6; e.touch=10 + tier*2; e.score=20 + tier*5; e.ai="chase"; }
    if (kind==="shooter"){ e.hp = 22 + tier*7; e.hpMax=e.hp; e.spd=40 + tier*3; e.r=6.0; e.shot=10 + tier*2; e.rate=1.10 - tier*0.04; e.score=26 + tier*7; e.ai="kite"; }
    if (kind==="drone")  { e.hp = 18 + tier*6; e.hpMax=e.hp; e.spd=58 + tier*4; e.r=5.2; e.shot=8 + tier*2; e.rate=0.85 - tier*0.03; e.score=28 + tier*7; e.ai="orbit"; }
    if (kind==="turret") { e.hp = 34 + tier*10;e.hpMax=e.hp; e.spd=0;             e.r=7.2; e.shot=12 + tier*3; e.rate=0.70 - tier*0.02; e.score=35 + tier*10; e.ai="turret"; }
    if (kind==="brute")  { e.hp = 60 + tier*12;e.hpMax=e.hp; e.spd=34 + tier*2;  e.r=8.2; e.touch=18 + tier*3; e.score=50 + tier*14; e.ai="chase"; e.armor=0.20; }
    if (kind==="spitter"){ e.hp = 26 + tier*8; e.hpMax=e.hp; e.spd=38 + tier*2;  e.r=6.2; e.shot=9 + tier*2;  e.rate=0.9 - tier*0.03; e.score=32 + tier*8; e.ai="lob"; }
    if (kind==="boss_proxy"){ e.hp = 520 + tier*140; e.hpMax=e.hp; e.spd=38 + tier*2; e.r=13.0; e.score=500; e.ai="boss"; e.phase=1; e.fireCD=0.8; }

    return e;
  }

  function makeElite(e) {
    e.elite = true;
    e.hpMax = (e.hpMax * 1.75) | 0;
    e.hp = e.hpMax;
    e.spd *= 1.08;
    e.r *= 1.06;
    e.shot = (e.shot || 0) * 1.25;
    e.touch = (e.touch || 0) * 1.25;
    e.score = (e.score * 1.8) | 0;
    return e;
  }

  // ---------- Room data ----------
  function buildRoom(node, neighbors) {
    // neighbors: {N:true,S:true,E:true,W:true}
    const kind = node.kind;
    const room = {
      kind,
      g: genRoomTiles(kind),
      cleared: node.cleared,
      locked: node.locked,
      seen: node.seen,
      neighbors,
      doorsOpen: { N:false,S:false,E:false,W:false }, // open when room cleared or non-combat rooms
      doorsLocked: { N:false,S:false,E:false,W:false }, // used for boss/treasure locks
      spawnDone: false,
      shopItems: [],
      decoSeed: randi(0, 1e9),
    };

    // door lock rules:
    // - boss room doors lock on enter until boss defeated
    // - normal rooms lock until cleared (combat rooms)
    // - treasure locked requires key to open door into treasure (handled at transition)
    // - key/shop rooms are open
    const combat = (kind === "normal" || kind === "elite" || kind === "boss");
    if (!combat || room.cleared) {
      for (const d of ["N","S","E","W"]) room.doorsOpen[d] = !!neighbors[d];
    } else {
      // closed until cleared
      for (const d of ["N","S","E","W"]) room.doorsOpen[d] = false;
    }

    // Boss room: doors lock even if neighbors exist
    if (kind === "boss" && !room.cleared) {
      for (const d of ["N","S","E","W"]) {
        if (neighbors[d]) {
          room.doorsLocked[d] = true;
          room.doorsOpen[d] = false;
        }
      }
    }

    // Shop inventory
    if (kind === "shop") {
      // three offers: weapon or item or heal
      const offers = [];
      offers.push({ type:"heal", price: 18 + state.floor*4, label:"Medkit (+35 HP)" });
      offers.push({ type:"shield", price: 16 + state.floor*4, label:"Shield Cell (+25 SH)" });

      if (chance(0.55)) offers.push({ type:"weapon", weapon: rollWeaponId(2 + (state.floor>2?1:0)), price: 36 + state.floor*8 });
      else offers.push({ type:"item", item: rollItemId(2 + (state.floor>2?1:0)), price: 42 + state.floor*8 });

      offers.push(chance(0.5)
        ? { type:"weapon", weapon: rollWeaponId(2 + (state.floor>3?1:0)), price: 48 + state.floor*10 }
        : { type:"item", item: rollItemId(3 + (state.floor>3?1:0)), price: 56 + state.floor*10 }
      );

      room.shopItems = offers;
      for (const d of ["N","S","E","W"]) room.doorsOpen[d] = !!neighbors[d];
    }

    // Treasure room: open when entered IF you had a key to unlock the connection, room itself isn't combat
    if (kind === "treasure") {
      for (const d of ["N","S","E","W"]) room.doorsOpen[d] = !!neighbors[d];
    }

    // Key room: always open; one key pickup appears
    if (kind === "key") {
      for (const d of ["N","S","E","W"]) room.doorsOpen[d] = !!neighbors[d];
    }

    return room;
  }

  // Rolls
  function rollWeaponId(minTier) {
    const pool = Object.entries(Weapons)
      .filter(([id,w]) => w.tier >= minTier && id !== "starter_pistol")
      .map(([id]) => id);
    if (!pool.length) return "smg";
    return pool[randi(0, pool.length-1)];
  }
  function rollItemId(minTier) {
    const pool = Items.filter(i => i.tier >= minTier).map(i=>i.id);
    if (!pool.length) return Items[randi(0, Items.length-1)].id;
    return pool[randi(0, pool.length-1)];
  }

  // ---------- Floor build / room cache ----------
  function buildFloor() {
    state.map = genFloorGraph();
    state.rooms = new Map();
    state.roomId = state.map.startKey;
    state.enemies.length = 0;
    state.bullets.length = 0;
    state.pickups.length = 0;
    state.fx.length = 0;
    state.decals.length = 0;
    state.bossAlive = false;
    state.shopOpen = false;

    // mark start seen
    const startNode = state.map.nodes.get(state.roomId);
    if (startNode) startNode.seen = true;

    // place player
    player.x = ROOM_W * 0.5;
    player.y = ROOM_H * 0.65;
    player.vx = player.vy = 0;

    state.msg = `FLOOR ${state.floor}`;
    state.msgT = 1.4;
  }

  function getRoomNode(roomId) { return state.map.nodes.get(roomId); }
  function getNeighbors(roomId) {
    const node = getRoomNode(roomId);
    if (!node) return {N:false,S:false,E:false,W:false};
    const edges = state.map.edges.get(roomId);
    const has = (x,y) => edges && edges.has(roomKey(x,y));
    return {
      N: has(node.x, node.y-1),
      S: has(node.x, node.y+1),
      W: has(node.x-1, node.y),
      E: has(node.x+1, node.y),
    };
  }

  function getRoom(roomId) {
    if (state.rooms.has(roomId)) return state.rooms.get(roomId);

    const node = getRoomNode(roomId);
    if (!node) return null;

    const neighbors = getNeighbors(roomId);
    const room = buildRoom(node, neighbors);
    state.rooms.set(roomId, room);
    return room;
  }

  // ---------- Spawning per room ----------
  function spawnRoomContents(roomId) {
    const node = getRoomNode(roomId);
    const room = getRoom(roomId);
    if (!node || !room || room.spawnDone) return;
    room.spawnDone = true;

    // Decorative decals (neon signs)
    const decoN = 8 + randi(0,10);
    for (let i=0;i<decoN;i++) {
      const x = rand(18, ROOM_W-18);
      const y = rand(18, ROOM_H-18);
      if (chance(0.6)) state.decals.push({ x,y, t:0, c: chance(0.5)?THEME.neonA:THEME.neonC });
    }

    // special rooms
    if (node.kind === "key" && !node.cleared) {
      // Place a key pickup
      state.pickups.push(makePickup("key", ROOM_W*0.5, ROOM_H*0.5, 1));
      node.cleared = true;
      room.cleared = true;
      // doors open
      for (const d of ["N","S","E","W"]) room.doorsOpen[d] = !!room.neighbors[d];
      return;
    }

    if (node.kind === "treasure" && !node.cleared) {
      // spawn treasure chest -> after "open" yields item/weapon
      state.pickups.push(makePickup("chest", ROOM_W*0.5, ROOM_H*0.5, 1, { opened:false }));
      // treasure room isn't combat, doors open
      for (const d of ["N","S","E","W"]) room.doorsOpen[d] = !!room.neighbors[d];
      return;
    }

    if (node.kind === "shop" && !node.cleared) {
      // spawn shop terminals as pickups to interact/buy
      // We'll place 3 “shop slots” as interactables
      const baseX = ROOM_W*0.5, baseY = ROOM_H*0.5;
      for (let i=0;i<room.shopItems.length;i++){
        state.pickups.push(makePickup("shop", baseX + (i-1)*44, baseY + 10, 1, { idx:i }));
      }
      // open doors always
      for (const d of ["N","S","E","W"]) room.doorsOpen[d] = !!room.neighbors[d];
      node.cleared = true; room.cleared = true;
      return;
    }

    // combat rooms
    const combat = (node.kind === "normal" || node.kind === "elite" || node.kind === "boss");
    if (!combat || node.cleared) {
      for (const d of ["N","S","E","W"]) room.doorsOpen[d] = !!room.neighbors[d];
      return;
    }

    // lock doors for combat
    for (const d of ["N","S","E","W"]) room.doorsOpen[d] = false;

    const baseTier = 1 + Math.floor((state.floor-1)*0.45);
    const count = node.kind === "boss" ? 1 : (node.kind === "elite" ? (7 + state.floor*2) : (5 + state.floor*2));
    if (node.kind === "boss") {
      const boss = makeEnemy("boss_proxy", ROOM_W*0.5, ROOM_H*0.45, baseTier);
      state.enemies.push(boss);
      state.bossAlive = true;
      state.msg = "BOSS: MIRROR EXECUTOR";
      state.msgT = 1.6;
      return;
    }

    for (let i=0;i<count;i++){
      const x = rand(40, ROOM_W-40);
      const y = rand(30, ROOM_H-30);
      let kinds = ["runner","shooter","drone","spitter","turret"];
      if (state.floor>=2) kinds.push("brute");
      let k = kinds[randi(0,kinds.length-1)];
      const e = makeEnemy(k, x, y, baseTier);
      // elite room => some elites
      if (node.kind==="elite" && chance(0.35)) makeElite(e);
      state.enemies.push(e);
    }

    state.msg = node.kind==="elite" ? "ELITE SECTOR" : "CLEAR THE ROOM";
    state.msgT = 1.2;
  }

  // ---------- Physics helpers ----------
  function moveEntity(ent, dt, room) {
    // apply knockback
    if (ent.knockT > 0) {
      ent.vx += ent.knockX * 240 * dt;
      ent.vy += ent.knockY * 240 * dt;
      ent.knockT -= dt;
    }

    let nx = ent.x + ent.vx * dt;
    let ny = ent.y + ent.vy * dt;

    // door lock collision rectangles
    function doorBlocked(nx, ny) {
      // if door is closed/locked, treat that doorway as wall
      const r = room;
      const doorW = TILE * 1.2;
      const doorH = TILE * 1.2;

      // N door gap centered at top
      if (!r.doorsOpen.N && r.neighbors.N) {
        const cx = ROOM_W*0.5, cy = 0;
        if (Math.abs(nx - cx) < doorW && ny < (TILE*1.3)) return true;
      }
      if (!r.doorsOpen.S && r.neighbors.S) {
        const cx = ROOM_W*0.5, cy = ROOM_H;
        if (Math.abs(nx - cx) < doorW && ny > ROOM_H - (TILE*1.3)) return true;
      }
      if (!r.doorsOpen.W && r.neighbors.W) {
        const cx = 0, cy = ROOM_H*0.5;
        if (Math.abs(ny - cy) < doorH && nx < (TILE*1.3)) return true;
      }
      if (!r.doorsOpen.E && r.neighbors.E) {
        const cx = ROOM_W, cy = ROOM_H*0.5;
        if (Math.abs(ny - cy) < doorH && nx > ROOM_W - (TILE*1.3)) return true;
      }
      return false;
    }

    // axis resolve
    if (!collideCircle(nx, ent.y, ent.r, room) && !doorBlocked(nx, ent.y)) ent.x = nx;
    else ent.vx *= -0.05;

    if (!collideCircle(ent.x, ny, ent.r, room) && !doorBlocked(ent.x, ny)) ent.y = ny;
    else ent.vy *= -0.05;

    // clamp within room bounds
    ent.x = clamp(ent.x, 10, ROOM_W - 10);
    ent.y = clamp(ent.y, 10, ROOM_H - 10);
  }

  // ---------- Combat / damage / status ----------
  function shake(amount, time) {
    state.cam.shake = Math.max(state.cam.shake, amount);
    state.cam.shakeT = Math.max(state.cam.shakeT, time);
  }

  function hitstop(t) {
    // micro hitstop effect via dt clamp in update loop
    // we store a brief slow factor
    state.fx.push(makeFX("hitstop", 0,0, t, 0, 0));
  }

  function damagePlayer(dmg, srcX, srcY) {
    if (player.invT > 0) return;

    // shield first
    let remaining = dmg;
    if (player.shield > 0) {
      const take = Math.min(player.shield, remaining);
      player.shield -= take;
      remaining -= take;
      player.shieldDelay = 1.8;
    }
    if (remaining > 0) {
      player.hp -= remaining;
      player.invT = player.rollIframes;
      player.shieldDelay = 2.2;

      // knockback
      if (srcX != null) {
        const n = norm(player.x - srcX, player.y - srcY);
        player.vx += n.x * 120;
        player.vy += n.y * 120;
      }

      shake(5, 0.12);
      hitstop(0.05);

      // FX
      for (let i=0;i<10;i++) state.fx.push(makeFX("spark", player.x, player.y, rand(-120,120), rand(-120,120), 0.22));
      if (player.hp <= 0) {
        player.hp = 0;
        state.mode = "gameover";
        openGameOver();
      }
    }
  }

  function damageEnemy(e, dmg, fromBullet) {
    if (!e.alive) return;

    const armor = e.armor || 0;
    const finalDmg = dmg * (1 - armor);
    e.hp -= finalDmg;
    e.hitT = 0.12;

    // lifesteal
    if (player.lifeSteal > 0 && finalDmg > 0) {
      const heal = finalDmg * player.lifeSteal;
      player.hp = Math.min(player.hpMax, player.hp + heal);
    }

    // status procs
    if (fromBullet) {
      if (fromBullet.slow > 0) e.frozenT = Math.max(e.frozenT, fromBullet.slow);
      if (fromBullet.shock > 0) e.shockedT = Math.max(e.shockedT, fromBullet.shock);

      // passive proc chance
      if (player.onHitFreeze > 0 && chance(player.onHitFreeze)) e.frozenT = Math.max(e.frozenT, 1.2);
      if (player.onHitShock > 0 && chance(player.onHitShock)) e.shockedT = Math.max(e.shockedT, 1.1);
    }

    // knockback
    if (fromBullet) {
      const n = norm(e.x - fromBullet.x, e.y - fromBullet.y);
      const kb = 0.9 * (1 - (player.knockResist||0));
      e.knockX = n.x * kb;
      e.knockY = n.y * kb;
      e.knockT = 0.10;
    }

    if (e.hp <= 0) {
      e.alive = false;
      // score + drops
      state.score += e.score || 15;
      state.money += randi(2, 6) + (e.elite? 10:0);
      if (chance(0.18 + player.luck*0.10)) state.pickups.push(makePickup("coin", e.x, e.y, randi(4, 10)));
      if (chance(0.10 + player.luck*0.08)) state.pickups.push(makePickup("hp", e.x + rand(-8,8), e.y + rand(-8,8), 18));
      if (chance(0.09 + player.luck*0.06)) state.pickups.push(makePickup("shield", e.x + rand(-8,8), e.y + rand(-8,8), 16));
      if (chance(0.06 + player.luck*0.06)) state.pickups.push(makePickup("ammo", e.x + rand(-8,8), e.y + rand(-8,8), 22));

      // elite/boss drops
      if (e.elite && chance(0.85)) state.pickups.push(makePickup("item", e.x, e.y, 1, { item: rollItemId(2) }));
      if (e.kind === "boss_proxy") {
        // boss defeat -> floor complete
        state.bossAlive = false;
        state.pickups.push(makePickup("portal", ROOM_W*0.5, ROOM_H*0.45, 1));
        state.pickups.push(makePickup("item", e.x, e.y, 1, { item: rollItemId(3) }));
        state.pickups.push(makePickup("weapon", e.x+18, e.y, 1, { weapon: rollWeaponId(3) }));
        shake(10, 0.25);
        hitstop(0.08);
        state.msg = "BOSS DEFEATED — PORTAL OPEN";
        state.msgT = 2.0;
      }

      for (let i=0;i<16;i++) state.fx.push(makeFX("spark", e.x, e.y, rand(-160,160), rand(-160,160), 0.35));
      shake(3.5, 0.10);
    }
  }

  // ---------- Weapon firing ----------
  function fireWeapon(room) {
    const w = player.weaponObj || Weapons.starter_pistol;
    if (player.reloadT > 0 || player.fireCD > 0) return;
    if (player.clip <= 0) { player.reloadT = w.reload; return; }

    // direction to aim point
    const dx = player.aimX - player.x;
    const dy = player.aimY - player.y;
    const n = norm(dx, dy);
    if (n.l < 0.001) return;

    // base stats + passives
    const bullets = w.bullets + player.bulletsPerShotAdd;
    const spread = w.spread * player.spreadMul;
    const baseSpeed = w.speed * player.shotSpeedMul;
    const rangeLife = (1.2 + w.tier*0.12) * player.rangeMul;
    const baseDmg = w.dmg * player.dmgMul;
    const pierce = (w.pierce || 0) + player.pierce;
    const bounce = player.bounce;
    const homing = player.homing;
    const color = w.color || "rgba(255,255,255,0.9)";

    function spawnOne(ang, dmgMul=1.0, extra={}) {
      const vx = Math.cos(ang) * baseSpeed;
      const vy = Math.sin(ang) * baseSpeed;
      let dmg = baseDmg * dmgMul;

      // crit
      if (chance(player.crit)) dmg *= 1.85;

      // status infusion based on items
      const slow = (player.onHitFreeze > 0 ? 0.6 : 0);
      const shock = (player.onHitShock > 0 ? 0.6 : 0);

      const b = makeBullet(
        "p",
        player.x + Math.cos(ang) * (player.r + 2),
        player.y + Math.sin(ang) * (player.r + 2),
        vx, vy,
        dmg,
        rangeLife,
        {
          pierce,
          bounce,
          homing,
          color,
          chain: w.chain || 0,
          explode: w.explode || 0,
          slow: slow,
          shock: shock,
          fromWeapon: player.weapon
        }
      );

      // apply extra overrides
      Object.assign(b, extra);
      state.bullets.push(b);
    }

    // Patterns
    const baseAng = Math.atan2(n.y, n.x);
    if (w.burst) {
      // bloom cannon: burst of 3 quick shots
      for (let i=0;i<w.burst;i++){
        const delay = i * 0.07;
        state.fx.push(makeFX("delayedShot", player.x, player.y, delay, baseAng, 0));
      }
    } else {
      if (bullets === 1) {
        spawnOne(baseAng + rand(-spread, spread), 1.0);
      } else {
        // fan spread
        const fan = spread * 1.2 + 0.22;
        for (let i=0;i<bullets;i++){
          const t = bullets===1 ? 0 : (i/(bullets-1))*2 - 1;
          const ang = baseAng + t * fan * 0.5 + rand(-spread, spread);
          spawnOne(ang, 1.0);
        }
      }
    }

    // recoil + cooldown + ammo
    player.recoil = clamp(player.recoil + w.kick, 0, 10);
    player.fireCD = w.rate;
    player.clip -= 1;

    // muzzle FX
    for (let i=0;i<6;i++) state.fx.push(makeFX("spark", player.x, player.y, rand(-90,90), rand(-90,90), 0.22));
    shake(1.2, 0.05);
  }

  function reloadWeapon() {
    const w = player.weaponObj || Weapons.starter_pistol;
    if (player.reloadT > 0) return;
    if (player.clip >= player.clipMax) return;
    player.reloadT = w.reload;
  }

  // ---------- Enemy AI & firing ----------
  function enemyShoot(e, ang, room, speedMul=1.0, dmgMul=1.0, colorOverride=null) {
    const spd = (200 + e.tier*10) * speedMul;
    const vx = Math.cos(ang) * spd;
    const vy = Math.sin(ang) * spd;
    const dmg = (e.shot || 9) * dmgMul;
    state.bullets.push(makeBullet("e", e.x, e.y, vx, vy, dmg, 1.7, { color: colorOverride || "rgba(255,90,120,0.9)" }));
  }

  // ---------- Pickups / interactions ----------
  function tryInteract(room) {
    // closest interactable pickup
    let best = null, bestD = 1e9, bestIdx = -1;
    for (let i=0;i<state.pickups.length;i++){
      const p = state.pickups[i];
      if (p.type==="chest" || p.type==="shop" || p.type==="portal") {
        const d = dist2(player.x, player.y, p.x, p.y);
        if (d < bestD) { bestD = d; best = p; bestIdx = i; }
      }
    }
    if (!best) return;

    const near = bestD < (18*18);
    if (!near) return;

    if (best.type==="chest") {
      if (best.meta && best.meta.opened) return;
      best.meta = best.meta || {};
      best.meta.opened = true;
      // open chest: item or weapon
      if (chance(0.55 + player.luck*0.10)) {
        const item = rollItemId(2 + (state.floor>2?1:0));
        state.pickups.push(makePickup("item", best.x, best.y - 18, 1, { item }));
      } else {
        const weapon = rollWeaponId(2 + (state.floor>2?1:0));
        state.pickups.push(makePickup("weapon", best.x, best.y - 18, 1, { weapon }));
      }
      state.msg = "CHEST OPENED";
      state.msgT = 1.1;
      shake(2.5, 0.1);
      return;
    }

    if (best.type==="shop") {
      const roomNode = getRoomNode(state.roomId);
      if (!roomNode || roomNode.kind!=="shop") return;
      const offer = room.shopItems[best.meta.idx];
      if (!offer) return;

      const price = offer.price|0;
      if (state.money < price) {
        state.msg = "NOT ENOUGH CREDITS";
        state.msgT = 0.9;
        return;
      }
      state.money -= price;

      if (offer.type==="heal") {
        player.hp = Math.min(player.hpMax, player.hp + 35);
      } else if (offer.type==="shield") {
        player.shield = Math.min(player.shieldMax, player.shield + 25);
      } else if (offer.type==="weapon") {
        equipWeapon(offer.weapon);
      } else if (offer.type==="item") {
        giveItem(offer.item);
      }

      // remove shop slot (bought)
      state.pickups.splice(bestIdx, 1);
      room.shopItems[best.meta.idx] = null;
      state.msg = "PURCHASED";
      state.msgT = 0.9;
      shake(1.5, 0.08);
      return;
    }

    if (best.type==="portal") {
      // advance floor
      state.floor += 1;
      state.score += 250 + state.floor*50;
      state.money += 30 + state.floor*6;
      buildFloor();
      // heal a bit between floors
      player.hp = Math.min(player.hpMax, player.hp + 25);
      player.shield = Math.min(player.shieldMax, player.shield + 15);
      return;
    }
  }

  function pickupCollect(room) {
    for (let i=state.pickups.length-1;i>=0;i--){
      const p = state.pickups[i];
      if (p.type==="shop" || p.type==="chest" || p.type==="portal") continue; // interactables
      const d = dist2(player.x, player.y, p.x, p.y);
      if (d < (player.pickupRadius * player.pickupRadius)) {
        if (p.type==="coin") {
          state.money += p.amt|0;
          state.score += (p.amt|0) * 2;
        } else if (p.type==="hp") {
          player.hp = Math.min(player.hpMax, player.hp + p.amt);
          state.score += 10;
        } else if (p.type==="shield") {
          player.shield = Math.min(player.shieldMax, player.shield + p.amt);
          state.score += 10;
        } else if (p.type==="ammo") {
          if (player.ammo < 999) player.ammo += (p.amt|0) * 2;
          state.score += 6;
        } else if (p.type==="key") {
          state.keys += 1;
          state.score += 35;
          state.msg = "KEY ACQUIRED";
          state.msgT = 1.1;
        } else if (p.type==="item") {
          giveItem(p.meta.item);
          state.score += 60;
        } else if (p.type==="weapon") {
          equipWeapon(p.meta.weapon);
          state.score += 45;
        }

        for (let k=0;k<8;k++) state.fx.push(makeFX("spark", p.x, p.y, rand(-80,80), rand(-80,80), 0.25));
        state.pickups.splice(i,1);
      }
    }
  }

  // ---------- Room transitions ----------
  function tryDoorTransition(room) {
    const node = getRoomNode(state.roomId);
    if (!node) return;

    // Determine if player crosses an open doorway region
    const nearTop = player.y < 8 && Math.abs(player.x - ROOM_W*0.5) < 18;
    const nearBot = player.y > ROOM_H-8 && Math.abs(player.x - ROOM_W*0.5) < 18;
    const nearLeft = player.x < 8 && Math.abs(player.y - ROOM_H*0.5) < 18;
    const nearRight = player.x > ROOM_W-8 && Math.abs(player.y - ROOM_H*0.5) < 18;

    function go(dx,dy,dirFrom) {
      const nx = node.x + dx, ny = node.y + dy;
      const nid = roomKey(nx,ny);
      const nextNode = getRoomNode(nid);
      if (!nextNode) return;

      // If entering treasure room via a locked connection, consume key
      if (nextNode.kind === "treasure" && nextNode.locked && !nextNode.cleared) {
        if (state.keys <= 0) {
          state.msg = "TREASURE LOCKED — NEED KEY";
          state.msgT = 1.0;
          return;
        }
        state.keys -= 1;
        nextNode.locked = false;
        state.msg = "LOCK UNSEALED";
        state.msgT = 1.0;
      }

      state.roomId = nid;
      nextNode.seen = true;

      // reposition player to opposite side
      if (dirFrom==="N") { player.y = ROOM_H - 14; }
      if (dirFrom==="S") { player.y = 14; }
      if (dirFrom==="W") { player.x = ROOM_W - 14; }
      if (dirFrom==="E") { player.x = 14; }

      // clear bullets in transit
      state.bullets.length = 0;

      // spawn
      spawnRoomContents(state.roomId);
    }

    if (nearTop && room.neighbors.N && room.doorsOpen.N) go(0,-1,"N");
    else if (nearBot && room.neighbors.S && room.doorsOpen.S) go(0, 1,"S");
    else if (nearLeft && room.neighbors.W && room.doorsOpen.W) go(-1,0,"W");
    else if (nearRight&& room.neighbors.E && room.doorsOpen.E) go( 1,0,"E");
  }

  // ---------- UI / Screens ----------
  let styleTag, menuWrap, gameWrap, uiWrap, hud, modal, mapBox;
  function buildUI() {
    styleTag = injectCSS();

    // Menu
    const root = el("div", { className:"f-wrap" }, document.body);
    menuWrap = el("div", { className:"f-shell" }, root);

    const top = el("div", { className:"f-top" }, menuWrap);
    const left = el("div", null, top);
    el("div", { className:"f-title", text:"FREEDOM" }, left);
    el("div", { className:"f-sub", text:"Room-based cyberpunk roguelike shooter • procedural floors • items/weapons • freegameslist.blog" }, left);

    const right = el("div", null, top);
    const fs = el("button", { className:"f-btn secondary", text:"Fullscreen (F)" }, right);
    fs.onclick = () => toggleFullscreen();

    const row = el("div", { className:"f-row" }, menuWrap);

    const cardPlay = el("div", { className:"f-card" }, row);
    el("h3", { text:"Play" }, cardPlay);
    const playRow = el("div", { className:"f-row" }, cardPlay);

    const bStart = el("button", { className:"f-btn", text:"Start Run" }, playRow);
    bStart.onclick = () => startGame();

    const bHow = el("button", { className:"f-btn secondary", text:"Controls" }, playRow);
    bHow.onclick = () => showControls();

    const bLb = el("button", { className:"f-btn secondary", text:"Leaderboard" }, playRow);
    bLb.onclick = () => showLeaderboard();

    const cardInfo = el("div", { className:"f-card" }, row);
    el("h3", { text:"How it works" }, cardInfo);
    el("div", { className:"f-small", html:
      "<div class='f-kv'><span>Rooms</span><span class='f-pill'>Clear to open doors</span></div>" +
      "<div class='f-kv'><span>Special</span><span class='f-pill'>Shop / Key / Treasure / Boss</span></div>" +
      "<div class='f-kv'><span>Progress</span><span class='f-pill'>Portal after boss</span></div>" +
      "<div class='f-kv'><span>Build</span><span class='f-pill'>Weapons + passive items</span></div>"
    }, cardInfo);

    el("div", { className:"f-hr" }, menuWrap);

    el("div", { className:"f-small", html:
      "<div><span class='f-pill'>Move</span> WASD &nbsp; <span class='f-pill'>Aim</span> Mouse &nbsp; <span class='f-pill'>Shoot</span> LMB</div>" +
      "<div style='margin-top:6px'><span class='f-pill'>Dash</span> Space &nbsp; <span class='f-pill'>Interact</span> E &nbsp; <span class='f-pill'>Reload</span> R</div>" +
      "<div style='margin-top:6px'><span class='f-pill'>Map</span> Tab &nbsp; <span class='f-pill'>Pause</span> Esc &nbsp; <span class='f-pill'>Fullscreen</span> F</div>" +
      "<div style='margin-top:6px;opacity:.7'>Tip: Key rooms give keys; treasure rooms consume keys; elites drop items.</div>"
    }, menuWrap);

    const foot = el("div", { className:"f-foot" }, menuWrap);
    el("div", { className:"f-water", text:"freegameslist.blog" }, foot);
    el("div", { text:"Name: FREEDOM • Procedural floors • Local score save" }, foot);

    // Game wrapper
    gameWrap = el("div", { className:"f-game" }, document.body);
    canvas = el("canvas", null, gameWrap);
    ctx = canvas.getContext("2d", { alpha:false });

    low = document.createElement("canvas");
    low.width = VIEW_W;
    low.height = VIEW_H;
    lctx = low.getContext("2d", { alpha:false });

    setSmooth(ctx, false);
    setSmooth(lctx, false);

    // UI overlay
    uiWrap = el("div", { className:"f-ui" }, document.body);
    hud = el("div", { className:"f-hud" }, uiWrap);
    modal = el("div", { className:"f-center" }, uiWrap);
    mapBox = el("div", { className:"f-map" }, uiWrap);

    // global references to remove later
    __F._root = root;
  }

  function showModal(title, lines, buttons, withInput) {
    modal.style.display = "block";
    modal.innerHTML = "";
    el("h2", { text:title }, modal);
    (lines||[]).forEach(t => el("p", { text:t }, modal));
    let input = null;
    if (withInput) input = el("input", { className:"f-input", placeholder: withInput.placeholder||"NAME" }, modal);
    const row = el("div", { className:"f-row", style:{ marginTop:"10px"} }, modal);
    (buttons||[]).forEach(b => {
      const btn = el("button", { className:"f-btn " + (b.secondary?"secondary":""), text:b.text }, row);
      btn.onclick = () => b.onClick(input);
    });
    return input;
  }
  function hideModal(){ modal.style.display="none"; }

  function showControls() {
    showModal("Controls", [
      "WASD move • Mouse aim • Hold LMB to shoot",
      "Space dash/roll (brief i-frames) • R reload • E interact/buy/open",
      "Tab minimap • Esc pause • F fullscreen",
      "Clear combat rooms to open doors. Key rooms give keys; treasure rooms require keys; defeat boss to open portal."
    ], [{ text:"Close", secondary:true, onClick:()=>hideModal() }]);
  }

  function showLeaderboard() {
    const s = loadScores();
    const lines = [];
    if (!s.length) lines.push("No scores yet. Get a run on the board.");
    for (let i=0;i<s.length;i++) lines.push(`${i+1}. ${s[i].n} — ${s[i].s}`);
    showModal("Local Leaderboard", lines, [{ text:"Close", secondary:true, onClick:()=>hideModal() }]);
  }

  function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen || function(){})();
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen || function(){})();
      }
    } catch (_) {}
  }

  function openPause() {
    showModal("Paused", [
      "Esc to resume. Tab minimap. F fullscreen.",
      "Tip: Dashing through bullets is often better than backing up."
    ], [
      { text:"Resume", onClick:()=>{ hideModal(); state.mode="play"; } },
      { text:"Restart Run", secondary:true, onClick:()=>{ hideModal(); startGame(); } },
      { text:"Menu", secondary:true, onClick:()=>{ hideModal(); backToMenu(); } },
    ]);
  }

  function openGameOver() {
    state.mode = "gameover";
    const total = state.score|0;
    const input = showModal("Game Over", [
      `Score: ${total}`,
      `Floor reached: ${state.floor}`,
      "Enter a name to save your score locally."
    ], [
      { text:"Save Score", onClick:(inp)=>{ const name = inp ? inp.value : "ANON"; saveScore(name, total); showLeaderboard(); } },
      { text:"Menu", secondary:true, onClick:()=>{ hideModal(); backToMenu(); } }
    ], { placeholder:"YOUR NAME (max 12)" });
    if (input) { input.value="ANON"; input.select(); }
  }

  function backToMenu() {
    state.mode = "menu";
    gameWrap.style.display = "none";
    __F._root.style.display = "flex";
    hideModal();
  }

  // ---------- Resize ----------
  function resize() {
    if (!canvas) return;
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  }

  // ---------- HUD ----------
  function weaponLabel() {
    const w = player.weaponObj || Weapons.starter_pistol;
    return `${w.name} T${w.tier}`;
  }
  function updateHUD() {
    hud.innerHTML = "";
    const left = el("div", { className:"box" }, hud);
    left.innerHTML =
      `<b>HP</b> ${player.hp|0}/${player.hpMax} ` +
      `• <b>SH</b> ${player.shield|0}/${player.shieldMax} ` +
      `• <b>Keys</b> ${state.keys|0} ` +
      `• <b>Credits</b> ${state.money|0}`;

    const mid = el("div", { className:"box" }, hud);
    mid.innerHTML =
      `<b>FLOOR</b> ${state.floor} ` +
      `• <b>SCORE</b> ${state.score|0} ` +
      `• <span style="opacity:.65">freegameslist.blog</span>`;

    const right = el("div", { className:"box" }, hud);
    const w = player.weaponObj || Weapons.starter_pistol;
    right.innerHTML =
      `<b>WEAPON</b> ${weaponLabel()} ` +
      `• <b>CLIP</b> ${player.clip}/${player.clipMax} ` +
      `• <b>AMMO</b> ${player.ammo===999?"∞":(player.ammo|0)}`;
  }

  // ---------- Minimap ----------
  function drawMinimap() {
    if (!state.showMap) { mapBox.style.display="none"; return; }
    mapBox.style.display="block";
    mapBox.innerHTML = ""; // we draw via canvas? keep simple using a tiny canvas
    const c = el("canvas", { width:210, height:160 }, mapBox);
    const g = c.getContext("2d");
    g.fillStyle = "rgba(0,0,0,0)";
    g.clearRect(0,0,c.width,c.height);

    const nodes = Array.from(state.map.nodes.values());
    // center on (0,0)
    const cx = c.width/2, cy = c.height/2;
    const scale = 18;

    // edges
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = 2;
    for (const [k, set] of state.map.edges.entries()) {
      const a = state.map.nodes.get(k);
      if (!a) continue;
      for (const kb of set) {
        const b = state.map.nodes.get(kb);
        if (!b) continue;
        // draw once
        if (k > kb) continue;
        g.beginPath();
        g.moveTo(cx + a.x*scale, cy + a.y*scale);
        g.lineTo(cx + b.x*scale, cy + b.y*scale);
        g.stroke();
      }
    }

    // nodes
    for (const n of nodes) {
      const x = cx + n.x*scale;
      const y = cy + n.y*scale;

      const seen = !!n.seen;
      const isHere = (roomKey(n.x,n.y) === state.roomId);

      let col = "rgba(255,255,255,0.12)";
      if (seen) col = "rgba(255,255,255,0.30)";
      if (n.kind==="start") col = "rgba(0,255,240,0.35)";
      if (n.kind==="shop") col = "rgba(124,92,255,0.40)";
      if (n.kind==="key") col = "rgba(255,204,0,0.45)";
      if (n.kind==="treasure") col = "rgba(255,59,212,0.40)";
      if (n.kind==="elite") col = "rgba(255,90,120,0.45)";
      if (n.kind==="boss") col = "rgba(255,120,0,0.45)";
      if (isHere) col = "rgba(255,255,255,0.85)";

      g.fillStyle = col;
      g.fillRect(x-5,y-5,10,10);

      if (n.locked && n.kind==="treasure") {
        g.fillStyle = "rgba(0,0,0,0.5)";
        g.fillRect(x-2,y-2,4,4);
      }
    }

    // watermark
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.font = "10px ui-monospace,monospace";
    g.fillText("freegameslist.blog", 10, c.height-10);
  }

  // ---------- Rendering: room & entities ----------
  function drawRoom(room) {
    // background
    lctx.fillStyle = "rgb(5,0,8)";
    lctx.fillRect(0,0,VIEW_W,VIEW_H);

    // camera with shake (room local camera)
    let camX = state.cam.x, camY = state.cam.y;
    if (state.cam.shakeT > 0) {
      const s = state.cam.shake;
      camX += rand(-s,s);
      camY += rand(-s,s);
    }

    // Fit room to view (room is larger than view; camera follows player)
    // We'll center camera on player with bounds
    const targetX = player.x - VIEW_W/2;
    const targetY = player.y - VIEW_H/2;
    state.cam.x = clamp(lerp(state.cam.x, targetX, 0.14), 0, ROOM_W - VIEW_W);
    state.cam.y = clamp(lerp(state.cam.y, targetY, 0.14), 0, ROOM_H - VIEW_H);
    camX = state.cam.x; camY = state.cam.y;

    // draw tiles
    const startTx = ((camX / TILE)|0) - 1;
    const startTy = ((camY / TILE)|0) - 1;
    const endTx = (((camX + VIEW_W)/TILE)|0) + 2;
    const endTy = (((camY + VIEW_H)/TILE)|0) + 2;

    for (let ty = startTy; ty < endTy; ty++) {
      for (let tx = startTx; tx < endTx; tx++) {
        if (tx < 0 || ty < 0 || tx >= ROOM_TW || ty >= ROOM_TH) continue;
        const t = room.g[tileIndex(tx,ty)];
        const wx = tx*TILE, wy = ty*TILE;
        const sx = (wx - camX) | 0;
        const sy = (wy - camY) | 0;

        if (t===0) {
          lctx.fillStyle = "rgb(10,0,14)";
          lctx.fillRect(sx,sy,TILE,TILE);
          // wall glow accent
          if (chance(0.002)) {
            lctx.fillStyle = "rgba(124,92,255,0.10)";
            lctx.fillRect(sx+1,sy+1,TILE-2,TILE-2);
          }
        } else {
          lctx.fillStyle = "rgb(7,7,12)";
          lctx.fillRect(sx,sy,TILE,TILE);

          // grid line
          lctx.fillStyle = "rgba(255,255,255,0.03)";
          lctx.fillRect(sx,sy+TILE-1,TILE,1);

          if (t===2) {
            lctx.fillStyle = "rgba(0,0,0,0.55)";
            lctx.fillRect(sx+1,sy+1,TILE-2,TILE-2);
          } else if (t===3) {
            lctx.fillStyle = "rgba(0,255,240,0.08)";
            lctx.fillRect(sx+2,sy+2,TILE-4,TILE-4);
            lctx.fillStyle = "rgba(255,59,212,0.08)";
            lctx.fillRect(sx+4,sy+4,TILE-8,TILE-8);
          } else if (t===4) {
            lctx.fillStyle = "rgba(255,255,255,0.05)";
            lctx.fillRect(sx+1,sy+1,TILE-2,TILE-2);
            lctx.fillStyle = "rgba(124,92,255,0.22)";
            lctx.fillRect(sx+3,sy+3,TILE-6,TILE-6);
          } else if (t===5) {
            lctx.fillStyle = "rgba(255,204,0,0.10)";
            lctx.fillRect(sx,sy,TILE,TILE);
          }
        }
      }
    }

    // decals
    for (const d of state.decals) {
      const sx = (d.x - camX)|0, sy = (d.y - camY)|0;
      lctx.fillStyle = d.c;
      lctx.globalAlpha = 0.10;
      lctx.fillRect(sx-10,sy-2,20,4);
      lctx.globalAlpha = 1;
    }

    // doors indicators
    function doorGlow(dir, open) {
      let x=0,y=0,w=0,h=0;
      if (dir==="N"){ x=VIEW_W/2-18; y=2; w=36; h=6; }
      if (dir==="S"){ x=VIEW_W/2-18; y=VIEW_H-8; w=36; h=6; }
      if (dir==="W"){ x=2; y=VIEW_H/2-18; w=6; h=36; }
      if (dir==="E"){ x=VIEW_W-8; y=VIEW_H/2-18; w=6; h=36; }
      lctx.fillStyle = open ? "rgba(0,255,240,0.22)" : "rgba(255,90,120,0.18)";
      lctx.fillRect(x,y,w,h);
    }
    for (const d of ["N","S","E","W"]) {
      if (room.neighbors[d]) doorGlow(d, room.doorsOpen[d]);
    }

    // entities
    function drawRect(x,y,r,fill,stroke) {
      const sx = (x - camX)|0, sy = (y - camY)|0;
      const rr = r|0;
      lctx.fillStyle = fill;
      lctx.fillRect(sx-rr, sy-rr, rr*2, rr*2);
      if (stroke) {
        lctx.fillStyle = stroke;
        lctx.fillRect(sx-rr-1, sy-rr-1, rr*2+2, 1);
        lctx.fillRect(sx-rr-1, sy+rr, rr*2+2, 1);
      }
    }

    // pickups
    for (const p of state.pickups) {
      let col = THEME.warn;
      if (p.type==="coin") col = THEME.warn;
      if (p.type==="hp") col = THEME.good;
      if (p.type==="shield") col = THEME.neonB;
      if (p.type==="ammo") col = THEME.neonA;
      if (p.type==="key") col = THEME.warn;
      if (p.type==="item") col = THEME.neonC;
      if (p.type==="weapon") col = THEME.neonA;
      if (p.type==="chest") col = "rgba(255,255,255,0.45)";
      if (p.type==="shop") col = "rgba(124,92,255,0.65)";
      if (p.type==="portal") col = "rgba(0,255,240,0.55)";
      drawRect(p.x,p.y, 4.5, col, "rgba(0,0,0,0.35)");
    }

    // enemies
    for (const e of state.enemies) {
      if (!e.alive) continue;
      let col = "rgba(124,92,255,0.85)";
      if (e.kind==="runner") col = "rgba(124,92,255,0.85)";
      if (e.kind==="shooter")col = "rgba(255,59,212,0.85)";
      if (e.kind==="drone")  col = "rgba(0,255,240,0.85)";
      if (e.kind==="turret") col = "rgba(255,59,212,0.85)";
      if (e.kind==="brute")  col = "rgba(255,120,0,0.88)";
      if (e.kind==="spitter")col = "rgba(62,255,118,0.82)";
      if (e.kind==="boss_proxy") col = "rgba(255,204,0,0.92)";
      if (e.elite) col = "rgba(255,204,0,0.90)";
      if (e.hitT>0) col = "rgba(255,255,255,0.95)";
      if (e.frozenT>0) col = "rgba(0,255,240,0.92)";
      if (e.shockedT>0) col = "rgba(255,59,212,0.92)";
      drawRect(e.x,e.y, e.r, col, "rgba(0,0,0,0.4)");

      // tiny hp bar for elites/boss
      if (e.elite || e.kind==="boss_proxy") {
        const sx = (e.x - camX)|0, sy = (e.y - camY)|0;
        const w = 24, h = 3;
        lctx.fillStyle = "rgba(0,0,0,0.5)";
        lctx.fillRect(sx - w/2, sy - (e.r|0) - 8, w, h);
        lctx.fillStyle = "rgba(255,255,255,0.75)";
        lctx.fillRect(sx - w/2, sy - (e.r|0) - 8, w * (e.hp/e.hpMax), h);
      }
    }

    // bullets
    for (const b of state.bullets) {
      const sx = (b.x - camX)|0, sy = (b.y - camY)|0;
      lctx.fillStyle = b.color;
      lctx.fillRect(sx-1,sy-1,2,2);
    }

    // player
    const pCol = player.invT>0 ? "rgba(255,255,255,0.95)" : "rgba(0,255,240,0.92)";
    drawRect(player.x, player.y, 7, pCol, "rgba(0,0,0,0.45)");

    // aim indicator
    {
      const ax = (player.aimX - camX)|0, ay = (player.aimY - camY)|0;
      lctx.fillStyle = "rgba(0,255,240,0.6)";
      lctx.fillRect(ax-2, ay-2, 4, 4);
    }

    // FX sparks
    for (const fx of state.fx) {
      if (fx.kind==="spark") {
        const sx = (fx.x - camX)|0, sy = (fx.y - camY)|0;
        lctx.fillStyle = chance(0.5) ? THEME.neonB : THEME.neonC;
        lctx.fillRect(sx,sy,1,1);
      }
      if (fx.kind==="explosion") {
        const sx = (fx.x - camX)|0, sy = (fx.y - camY)|0;
        lctx.globalAlpha = clamp(1 - fx.t/fx.c, 0, 1) * 0.35;
        lctx.fillStyle = THEME.warn;
        lctx.fillRect(sx - fx.a, sy - fx.a, fx.a*2, fx.a*2);
        lctx.globalAlpha = 1;
      }
    }

    // message
    if (state.msgT > 0) {
      lctx.font = "12px ui-monospace,monospace";
      lctx.textAlign = "center";
      lctx.textBaseline = "top";
      lctx.fillStyle = "rgba(0,0,0,0.65)";
      lctx.fillText(state.msg, (VIEW_W/2)+1, 10+1);
      lctx.fillStyle = "rgba(255,255,255,0.85)";
      lctx.fillText(state.msg, VIEW_W/2, 10);
      lctx.textAlign = "left";
    }

    // watermark on view
    lctx.font = "10px ui-monospace,monospace";
    lctx.fillStyle = "rgba(255,255,255,0.18)";
    lctx.fillText("freegameslist.blog", 10, VIEW_H - 14);
  }

  function compositeToScreen() {
    ctx.fillStyle = "rgb(5,0,8)";
    ctx.fillRect(0,0,canvas.width, canvas.height);

    const sx = canvas.width / VIEW_W;
    const sy = canvas.height / VIEW_H;
    const sc = Math.min(sx, sy);
    const dw = (VIEW_W * sc) | 0;
    const dh = (VIEW_H * sc) | 0;
    const dx = ((canvas.width - dw)/2) | 0;
    const dy = ((canvas.height - dh)/2) | 0;

    setSmooth(ctx, false);
    ctx.drawImage(low, dx, dy, dw, dh);

    // subtle vignette
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(0,0,canvas.width,canvas.height);
  }

  // ---------- Main update ----------
  function update(dt) {
    if (state.mode !== "play") return;

    // hitstop slows time briefly
    let slow = 1.0;
    for (const fx of state.fx) {
      if (fx.kind==="hitstop") {
        slow = Math.min(slow, 0.25);
      }
    }
    dt *= slow;

    state.t += dt;
    if (state.msgT > 0) state.msgT -= dt;
    if (state.cam.shakeT > 0) {
      state.cam.shakeT -= dt;
      state.cam.shake = lerp(state.cam.shake, 0, 0.18);
    } else state.cam.shake = 0;

    const room = getRoom(state.roomId);
    if (!room) return;

    // ensure room spawn
    spawnRoomContents(state.roomId);

    // update player aim from mouse in screen coords -> low coords -> world coords (camera)
    const cw = canvas.width, ch = canvas.height;
    const sx = cw / VIEW_W, sy = ch / VIEW_H;
    const sc = Math.min(sx, sy);
    const dw = VIEW_W * sc, dh = VIEW_H * sc;
    const ox = (cw - dw)/2, oy = (ch - dh)/2;
    const mx = clamp((mouse.x - ox) / sc, 0, VIEW_W);
    const my = clamp((mouse.y - oy) / sc, 0, VIEW_H);
    player.aimX = state.cam.x + mx;
    player.aimY = state.cam.y + my;

    // player timers
    if (player.invT > 0) player.invT -= dt;
    if (player.dashCD > 0) player.dashCD -= dt;
    if (player.dashT > 0) player.dashT -= dt;
    if (player.fireCD > 0) player.fireCD -= dt;
    if (player.reloadT > 0) {
      player.reloadT -= dt;
      if (player.reloadT <= 0) {
        // finish reload
        const need = player.clipMax - player.clip;
        if (player.ammo === 999) {
          player.clip = player.clipMax;
        } else {
          const take = Math.min(need, player.ammo);
          player.ammo -= take;
          player.clip += take;
        }
      }
    }

    // shield regen
    if (player.shieldDelay > 0) player.shieldDelay -= dt;
    else if (player.shield < player.shieldMax) player.shield = Math.min(player.shieldMax, player.shield + 11*dt);

    // movement input
    let ax = 0, ay = 0;
    if (keys.KeyA) ax -= 1;
    if (keys.KeyD) ax += 1;
    if (keys.KeyW) ay -= 1;
    if (keys.KeyS) ay += 1;
    const n = norm(ax, ay);

    const moveSpeed = player.speed * player.moveMul * (player.dashT>0 ? 1.6 : 1.0);
    player.vx = lerp(player.vx, n.x * moveSpeed, 0.22);
    player.vy = lerp(player.vy, n.y * moveSpeed, 0.22);

    // friction
    player.vx *= player.friction;
    player.vy *= player.friction;

    // hazard tile: neon puddle slows + chips shield
    const t = tileAtWorld(player.x, player.y, room);
    if (t === 3) {
      player.vx *= 0.78; player.vy *= 0.78;
      if (chance(0.08 * dt * 60)) damagePlayer(1.4, player.x-10, player.y-10);
    }

    // dash/roll
    if (keys.Space) {
      keys.Space = false;
      if (player.dashCD <= 0) {
        let dx = n.x, dy = n.y;
        if (Math.abs(dx)+Math.abs(dy) < 0.001) {
          const a = norm(player.aimX-player.x, player.aimY-player.y);
          dx = a.x; dy = a.y;
        }
        player.dashCD = 0.95;
        player.dashT = 0.10;
        player.invT = Math.max(player.invT, player.rollIframes);
        player.vx += dx * 280;
        player.vy += dy * 280;
        for (let i=0;i<14;i++) state.fx.push(makeFX("spark", player.x, player.y, rand(-160,160), rand(-160,160), 0.28));
        shake(2.2, 0.10);
      }
    }

    // apply movement with collision
    moveEntity(player, dt, room);

    // shooting
    if (mouse.down) fireWeapon(room);

    // reload key
    if (keys.KeyR) { keys.KeyR = false; reloadWeapon(); }

    // interact
    if (keys.KeyE) { keys.KeyE = false; tryInteract(room); }

    // minimize map
    if (keys.Tab) { keys.Tab = false; state.showMap = !state.showMap; }

    // bullets update
    for (let i=state.bullets.length-1;i>=0;i--){
      const b = state.bullets[i];
      b.t += dt;
      b.life -= dt;
      if (b.life <= 0) { state.bullets.splice(i,1); continue; }

      // homing
      if (b.owner==="p" && b.homing > 0) {
        let best = null, bd = 1e18;
        for (const e of state.enemies) {
          if (!e.alive) continue;
          const d = dist2(b.x,b.y,e.x,e.y);
          if (d < bd) { bd=d; best=e; }
        }
        if (best) {
          const a = norm(best.x - b.x, best.y - b.y);
          b.vx = lerp(b.vx, a.x * len(b.vx,b.vy), b.homing * 0.06);
          b.vy = lerp(b.vy, a.y * len(b.vx,b.vy), b.homing * 0.06);
        }
      }

      const nx = b.x + b.vx*dt;
      const ny = b.y + b.vy*dt;

      // collision with walls/blocks/pits
      const tt = tileAtWorld(nx, ny, room);
      const solid = (tt===0 || tt===2 || tt===4);
      if (solid) {
        // bounce for player bullets
        if (b.owner==="p" && b.bounce > 0) {
          b.bounce -= 1;
          // crude reflect: flip based on which axis more blocked
          b.vx *= -0.8; b.vy *= -0.8;
          b.life *= 0.85;
          state.fx.push(makeFX("spark", b.x, b.y, rand(-90,90), rand(-90,90), 0.22));
          continue;
        } else {
          // explode?
          if (b.explode > 0) doExplosion(b.x,b.y,b.explode, b.dmg*0.75);
          state.fx.push(makeFX("spark", b.x, b.y, rand(-90,90), rand(-90,90), 0.22));
          state.bullets.splice(i,1);
          continue;
        }
      }

      b.x = nx; b.y = ny;

      // hit tests
      if (b.owner==="e") {
        if (dist2(b.x,b.y, player.x,player.y) < (player.r+3)*(player.r+3)) {
          damagePlayer(b.dmg, b.x, b.y);
          state.bullets.splice(i,1);
          continue;
        }
      } else {
        // player bullet -> enemies
        for (let ei=0;ei<state.enemies.length;ei++){
          const e = state.enemies[ei];
          if (!e.alive) continue;
          if (dist2(b.x,b.y,e.x,e.y) < (e.r+3)*(e.r+3)) {
            damageEnemy(e, b.dmg, b);

            // chain lightning for tesla
            if (b.chain > 0) {
              chainShock(e, b.dmg*0.55, b.chain);
            }

            // explode on hit
            if (b.explode > 0) doExplosion(b.x,b.y,b.explode, b.dmg*0.70);

            // pierce
            if (b.pierce > 0) {
              b.pierce -= 1;
              b.dmg *= 0.78;
            } else {
              state.bullets.splice(i,1);
            }
            break;
          }
        }
      }
    }

    // enemies update
    let aliveCount = 0;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      aliveCount++;
      e.t += dt;
      if (e.hitT > 0) e.hitT -= dt;

      // statuses
      if (e.frozenT > 0) e.frozenT -= dt;
      if (e.shockedT > 0) e.shockedT -= dt;

      // behavior disabled when frozen
      const slowMul = e.frozenT>0 ? 0.15 : (e.shockedT>0 ? 0.70 : 1.0);

      const dx = player.x - e.x, dy = player.y - e.y;
      const nn = norm(dx,dy);

      // collision touch damage
      if (e.touch && dist2(e.x,e.y, player.x,player.y) < (e.r+player.r+1)*(e.r+player.r+1)) {
        damagePlayer(e.touch * (e.elite?1.1:1.0), e.x, e.y);
        // thorns
        if (player.thorns > 0) {
          e.hp -= e.touch * player.thorns;
          if (e.hp <= 0) e.alive=false;
        }
      }

      // AI
      if (e.ai==="chase") {
        e.vx = lerp(e.vx, nn.x * e.spd * slowMul, 0.12);
        e.vy = lerp(e.vy, nn.y * e.spd * slowMul, 0.12);
        moveEntity(e, dt, room);
      }

      if (e.ai==="kite") {
        // keep distance, shoot
        const desired = 78;
        const d = nn.l;
        const away = d < desired ? -1 : 1;
        e.vx = lerp(e.vx, nn.x * e.spd * 0.55 * away * slowMul, 0.10);
        e.vy = lerp(e.vy, nn.y * e.spd * 0.55 * away * slowMul, 0.10);
        moveEntity(e, dt, room);

        e.fireCD -= dt;
        if (e.fireCD <= 0 && slowMul>0.2) {
          e.fireCD = (e.rate || 1.0) + rand(0,0.25);
          const ang = Math.atan2(nn.y, nn.x) + rand(-0.10,0.10);
          enemyShoot(e, ang, room, 1.0, 1.0, "rgba(255,90,120,0.9)");
        }
      }

      if (e.ai==="orbit") {
        // orbit + shoot
        const side = Math.sin(e.t * (1.6 + e.tier*0.08));
        const ox = -nn.y * side * 0.8;
        const oy =  nn.x * side * 0.8;
        e.vx = lerp(e.vx, (nn.x*0.55 + ox) * e.spd * slowMul, 0.10);
        e.vy = lerp(e.vy, (nn.y*0.55 + oy) * e.spd * slowMul, 0.10);
        moveEntity(e, dt, room);

        e.fireCD -= dt;
        if (e.fireCD <= 0 && slowMul>0.2) {
          e.fireCD = (e.rate || 0.85) + rand(0,0.22);
          const ang = Math.atan2(nn.y, nn.x) + rand(-0.14,0.14);
          enemyShoot(e, ang, room, 1.05, 0.95, "rgba(255,59,212,0.9)");
        }
      }

      if (e.ai==="turret") {
        e.fireCD -= dt;
        if (e.fireCD <= 0 && slowMul>0.2) {
          e.fireCD = (e.rate || 0.7) + rand(0,0.20);
          // burst 3
          const base = Math.atan2(nn.y, nn.x);
          for (let k=0;k<3;k++){
            const ang = base + rand(-0.10,0.10) + (k-1)*0.06;
            enemyShoot(e, ang, room, 1.0, 1.0, "rgba(255,120,0,0.9)");
          }
        }
      }

      if (e.ai==="lob") {
        // spitter: slow lob shots (simulate by slower bullets)
        const desired = 90;
        const d = nn.l;
        const away = d < desired ? -1 : 1;
        e.vx = lerp(e.vx, nn.x * e.spd * 0.35 * away * slowMul, 0.10);
        e.vy = lerp(e.vy, nn.y * e.spd * 0.35 * away * slowMul, 0.10);
        moveEntity(e, dt, room);

        e.fireCD -= dt;
        if (e.fireCD <= 0 && slowMul>0.2) {
          e.fireCD = (e.rate || 0.95) + rand(0,0.25);
          const ang = Math.atan2(nn.y, nn.x) + rand(-0.12,0.12);
          // bullet that “slows” on hit
          const spd = 150;
          const vx = Math.cos(ang)*spd, vy = Math.sin(ang)*spd;
          state.bullets.push(makeBullet("e", e.x, e.y, vx, vy, e.shot||9, 2.0, { color:"rgba(62,255,118,0.9)" }));
        }
      }

      if (e.ai==="boss") {
        // Mirror Executor: phases with patterns
        const boss = e;
        const hpPct = boss.hp / boss.hpMax;
        if (hpPct < 0.66 && boss.phase === 1) { boss.phase = 2; state.msg="BOSS PHASE 2"; state.msgT=1.1; }
        if (hpPct < 0.33 && boss.phase === 2) { boss.phase = 3; state.msg="BOSS PHASE 3"; state.msgT=1.1; }

        // movement: slow chase + sidestep
        const side = Math.sin(boss.t * 1.2);
        const ox = -nn.y * side * 0.6;
        const oy =  nn.x * side * 0.6;
        boss.vx = lerp(boss.vx, (nn.x*0.6 + ox) * boss.spd * slowMul, 0.08);
        boss.vy = lerp(boss.vy, (nn.y*0.6 + oy) * boss.spd * slowMul, 0.08);
        moveEntity(boss, dt, room);

        boss.fireCD -= dt;
        if (boss.fireCD <= 0 && slowMul>0.2) {
          if (boss.phase === 1) {
            boss.fireCD = 0.75;
            // radial 10
            radialBurst(boss.x,boss.y, 10, 220, 12, "rgba(255,204,0,0.95)");
          } else if (boss.phase === 2) {
            boss.fireCD = 0.68;
            // aimed triple + radial small
            const base = Math.atan2(nn.y, nn.x);
            for (let k=0;k<3;k++){
              enemyShoot(boss, base + (k-1)*0.10, room, 1.05, 1.05, "rgba(255,90,120,0.95)");
            }
            if (chance(0.6)) radialBurst(boss.x,boss.y, 8, 200, 10, "rgba(255,59,212,0.85)");
          } else {
            boss.fireCD = 0.58;
            // spiral
            spiralBurst(boss, 14, 240, 12, "rgba(0,255,240,0.92)");
            if (chance(0.25)) {
              // spawn minions
              const tier = 1 + Math.floor((state.floor-1)*0.45);
              const m = makeEnemy(chance(0.5)?"runner":"drone", boss.x + rand(-20,20), boss.y + rand(-20,20), tier);
              state.enemies.push(m);
            }
          }
        }
      }
    }

    // room cleared -> open doors
    const node = getRoomNode(state.roomId);
    if (node && !node.cleared) {
      const combat = (node.kind==="normal"||node.kind==="elite"||node.kind==="boss");
      if (combat) {
        if (aliveCount === 0 && (!state.bossAlive || node.kind!=="boss")) {
          node.cleared = true;
          room.cleared = true;
          for (const d of ["N","S","E","W"]) room.doorsOpen[d] = !!room.neighbors[d];
          // reward for elite room
          if (node.kind==="elite") {
            state.pickups.push(makePickup("item", ROOM_W*0.5, ROOM_H*0.5, 1, { item: rollItemId(2) }));
            state.msg = "ELITE CLEARED — ITEM DROPPED";
            state.msgT = 1.2;
          } else {
            state.msg = "ROOM CLEARED";
            state.msgT = 0.9;
          }
        }
      }
    }

    // pickups collect
    pickupCollect(room);

    // transitions
    tryDoorTransition(room);

    // FX update
    for (let i=state.fx.length-1;i>=0;i--){
      const fx = state.fx[i];
      fx.t += dt;
      if (fx.kind==="spark") {
        fx.x += fx.a * dt;
        fx.y += fx.b * dt;
        fx.a *= 0.88;
        fx.b *= 0.88;
        if (fx.t > fx.c) state.fx.splice(i,1);
      } else if (fx.kind==="hitstop") {
        if (fx.t > fx.a) state.fx.splice(i,1);
      } else if (fx.kind==="delayedShot") {
        // fx.a is delay, fx.b is angle
        if (fx.t >= fx.a) {
          // spawn burst shot (bloom cannon)
          const w = player.weaponObj;
          const angBase = fx.b;
          const bullets = (w && w.bullets) ? w.bullets : 1;
          const spread = ((w && w.spread) ? w.spread : 0.08) * player.spreadMul;
          const baseSpeed = ((w && w.speed) ? w.speed : 220) * player.shotSpeedMul;
          const baseDmg = ((w && w.dmg) ? w.dmg : 10) * player.dmgMul;
          const rangeLife = (1.3 + (w && w.tier ? w.tier*0.12 : 0)) * player.rangeMul;

          for (let j=0;j<bullets;j++){
            const t = bullets===1 ? 0 : (j/(bullets-1))*2 - 1;
            const ang = angBase + t*0.24 + rand(-spread,spread);
            const vx = Math.cos(ang)*baseSpeed;
            const vy = Math.sin(ang)*baseSpeed;
            let dmg = baseDmg;
            if (chance(player.crit)) dmg *= 1.85;
            state.bullets.push(makeBullet("p", player.x, player.y, vx, vy, dmg, rangeLife, {
              pierce: player.pierce,
              bounce: player.bounce,
              homing: player.homing,
              color: (w && w.color) || THEME.good
            }));
          }
          state.fx.splice(i,1);
        }
      } else if (fx.kind==="explosion") {
        if (fx.t > fx.c) state.fx.splice(i,1);
      } else {
        // default cleanup
        if (fx.t > 0.5) state.fx.splice(i,1);
      }
    }
  }

  function doExplosion(x,y, radius, dmg) {
    // FX
    state.fx.push({ kind:"explosion", x,y, a:radius, c:0.35, t:0 });
    shake(6, 0.14);
    hitstop(0.04);

    // damage enemies in radius
    for (const e of state.enemies) {
      if (!e.alive) continue;
      const d = Math.sqrt(dist2(x,y,e.x,e.y));
      if (d < radius) {
        const falloff = 1 - (d / radius);
        damageEnemy(e, dmg * (0.55 + 0.45*falloff), null);
      }
    }
  }

  function chainShock(originEnemy, dmg, chains) {
    let last = originEnemy;
    for (let i=0;i<chains;i++){
      let best = null, bd = 1e18;
      for (const e of state.enemies) {
        if (!e.alive || e === last) continue;
        const d = dist2(last.x,last.y,e.x,e.y);
        if (d < bd && d < 110*110) { bd=d; best=e; }
      }
      if (!best) break;
      damageEnemy(best, dmg, null);
      // zap FX line
      state.fx.push(makeFX("spark", (last.x+best.x)/2, (last.y+best.y)/2, rand(-60,60), rand(-60,60), 0.25));
      last = best;
      dmg *= 0.75;
    }
  }

  function radialBurst(x,y, n, speed, dmg, color) {
    for (let i=0;i<n;i++){
      const a = (i/n)*TAU;
      const vx = Math.cos(a)*speed;
      const vy = Math.sin(a)*speed;
      state.bullets.push(makeBullet("e", x,y, vx,vy, dmg, 2.0, { color }));
    }
  }
  function spiralBurst(boss, n, speed, dmg, color) {
    const base = boss.t * 2.2;
    for (let i=0;i<n;i++){
      const a = base + (i/n)*TAU;
      const vx = Math.cos(a)*speed;
      const vy = Math.sin(a)*speed;
      state.bullets.push(makeBullet("e", boss.x,boss.y, vx,vy, dmg, 2.0, { color }));
    }
  }

  // ---------- Game loop ----------
  let lastT = 0;
  let raf = 0;

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    lastT = t;
    dt = Math.min(dt, state.dtCap);

    // pause if not focused
    if (document.hasFocus && !document.hasFocus()) dt = 0;

    // hotkeys
    if (keys.Escape) {
      keys.Escape = false;
      if (state.mode === "play") { state.mode = "pause"; openPause(); }
      else if (state.mode === "pause") { hideModal(); state.mode = "play"; }
    }
    if (keys.KeyF) { keys.KeyF = false; toggleFullscreen(); }

    if (state.mode === "play") {
      update(dt);
    }

    // render
    const room = (state.mode === "menu") ? null : getRoom(state.roomId);
    if (room) drawRoom(room);
    else {
      // blank low buffer for menu
      lctx.fillStyle = "rgb(5,0,8)";
      lctx.fillRect(0,0,VIEW_W,VIEW_H);
      lctx.font = "12px ui-monospace,monospace";
      lctx.fillStyle = "rgba(255,255,255,0.25)";
      lctx.fillText("freegameslist.blog", 10, VIEW_H - 14);
    }
    compositeToScreen();
    updateHUD();
    drawMinimap();
  }

  // ---------- Start / restart ----------
  function startGame() {
    hideModal();
    __F._root.style.display = "none";
    gameWrap.style.display = "block";
    state.mode = "play";

    // reset run
    state.floor = 1;
    state.score = 0;
    state.money = 0;
    state.keys = 0;
    state.cam.x = 0; state.cam.y = 0; state.cam.shake = 0; state.cam.shakeT = 0;
    state.enemies.length = 0;
    state.bullets.length = 0;
    state.pickups.length = 0;
    state.fx.length = 0;
    state.decals.length = 0;
    state.showMap = false;

    // reset player
    player.hpMax = 100; player.hp = 100;
    player.shieldMax = 35; player.shield = 35;
    player.invT = 0; player.dashCD = 0; player.dashT = 0;
    player.crit = 0.07; player.luck = 0; player.dmgMul = 1.0;
    player.shotSpeedMul = 1.0; player.rangeMul = 1.0; player.moveMul = 1.0;
    player.pickupRadius = 20;
    player.lifeSteal = 0; player.thorns = 0; player.onHitFreeze = 0; player.onHitShock = 0;
    player.homing = 0; player.pierce = 0; player.bounce = 0; player.bulletsPerShotAdd = 0; player.spreadMul = 1.0;
    player.items.length = 0;
    equipWeapon("starter_pistol");

    buildFloor();
    spawnRoomContents(state.roomId);
  }

  // ---------- create() public API ----------
  window.create = function create(config) {
    config = config || {};
    if (!menuWrap) buildUI();

    resize();
    window.addEventListener("resize", resize, { passive:true });
    window.addEventListener("mousemove", onMouseMove, { passive:true });
    window.addEventListener("mousedown", onMouseDown, { passive:true });
    window.addEventListener("mouseup", onMouseUp, { passive:true });
    window.addEventListener("keydown", (e)=>onKey(e,true), { passive:false });
    window.addEventListener("keyup", (e)=>onKey(e,false), { passive:false });

    // show menu
    state.mode = "menu";
    __F._root.style.display = "flex";
    gameWrap.style.display = "none";
    hideModal();

    if (!raf) {
      lastT = 0;
      raf = requestAnimationFrame(frame);
    }

    // optional autostart
    if (config.autostart) startGame();

    return {
      start: startGame,
      menu: backToMenu,
      leaderboard: showLeaderboard
    };
  };

  // ---------- destroy ----------
  __F.destroy = function () {
    try { cancelAnimationFrame(raf); } catch (_) {}
    raf = 0;
    try { if (__F._root && __F._root.parentNode) __F._root.parentNode.removeChild(__F._root); } catch (_) {}
    try { if (gameWrap && gameWrap.parentNode) gameWrap.parentNode.removeChild(gameWrap); } catch (_) {}
    try { if (uiWrap && uiWrap.parentNode) uiWrap.parentNode.removeChild(uiWrap); } catch (_) {}
    try { if (styleTag && styleTag.parentNode) styleTag.parentNode.removeChild(styleTag); } catch (_) {}
    menuWrap = gameWrap = uiWrap = styleTag = null;
    canvas = ctx = low = lctx = null;
  };

})();
