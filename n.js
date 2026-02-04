/* n.js — ES5-safe single-file dungeon shooter (full-window)
   Added:
   a) Coins drop + Shop room on each depth ring (|x|+|y| = depth). Buy weapons/upgrades.
   b) Door transition bugfix: transitions trigger when you PUSH into an open doorway (no need to cross OOB).
   c) Full-window canvas with resize + HiDPI; optional fullscreen on first click / press F.
   d) Better look: richer tile shading, soft lighting vignette, improved sprites/shadows, UI polish.
*/

(function () {
  "use strict";

  // ---------- Boot / Entry ----------
  window.create = function () { Game.create(); };

  // ---------- Constants ----------
  var TAU = Math.PI * 2;

  var TILE = 24;
  var ROOM_TW = 21;
  var ROOM_TH = 13;
  var ROOM_W = ROOM_TW * TILE;
  var ROOM_H = ROOM_TH * TILE;

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    A: 65, W: 87, D: 68, S: 83,
    SPACE: 32, SHIFT: 16, ESC: 27,
    F: 70, Q: 81, E: 69,
    R: 82, ONE: 49, TWO: 50, THREE: 51, FOUR: 52
  };

  // Door opening geometry in pixels
  var DOOR_SPAN = 26;      // half-width of door opening around center
  var DOOR_THICK = 18;     // thickness of doorway "trigger band" inside room

  // ---------- Canvas / Context ----------
  var canvas, ctx;
  var dpr = 1;
  var VIEW_W = 960, VIEW_H = 540; // updated at resize
  var lastT = 0;

  // ---------- Input ----------
  var keys = {};
  var keysPressed = {};
  var mouse = { x: 0, y: 0, down: false };
  var wantsAutoFullscreen = true;

  function onKeyDown(e) {
    if (!keys[e.keyCode]) keysPressed[e.keyCode] = true;
    keys[e.keyCode] = true;
    if (e.keyCode === KEY.SPACE || e.keyCode === KEY.UP || e.keyCode === KEY.DOWN) e.preventDefault();
  }
  function onKeyUp(e) { keys[e.keyCode] = false; }
  function onMouseMove(e) {
    var rect = canvas.getBoundingClientRect();
    var cx = (e.clientX - rect.left);
    var cy = (e.clientY - rect.top);
    mouse.x = (cx / rect.width) * VIEW_W;
    mouse.y = (cy / rect.height) * VIEW_H;
  }
  function onMouseDown() {
    mouse.down = true;
    // best-effort: go fullscreen on first click (user gesture)
    if (wantsAutoFullscreen) {
      wantsAutoFullscreen = false;
      requestFullscreen();
    }
  }
  function onMouseUp() { mouse.down = false; }

  function wasPressed(code) { return !!keysPressed[code]; }

  // ---------- RNG ----------
  function randf() { return Math.random(); }
  function randi(n) { return (Math.random() * n) | 0; }
  function chance(p) { return Math.random() < p; }

  // ---------- Math helpers ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function norm(x, y) { var l = Math.sqrt(x * x + y * y) || 1; return { x: x / l, y: y / l }; }

  // ---------- Room graph helpers ----------
  function roomKey(x, y) { return x + "," + y; }
  function tileIndex(tx, ty) { return ty * ROOM_TW + tx; }
  function parseRoom(id) {
    var s = id.split(",");
    return { x: parseInt(s[0], 10), y: parseInt(s[1], 10) };
  }

  // ---------- Game State ----------
  var state = {
    running: false,
    paused: false,
    shopOpen: false,
    msg: "",
    msgT: 0,
    keys: 0,
    coins: 0,
    roomId: "0,0",
    cam: { x: 0, y: 0, shake: 0, shakeT: 0 },
    map: {},   // nodes by id
    rooms: {}, // room data by id
    enemies: [],
    bullets: [],
    pickups: [],
    fx: [],
    decals: []
  };

  // Weapons (unlockable / buyable)
  var WEAPONS = [
    { id: 0, name: "Pistol",  unlocked: true,  dmg: 2, fire: 0.18, speed: 440, spread: 0.00, pellets: 1 },
    { id: 1, name: "Shotgun", unlocked: false, dmg: 1, fire: 0.55, speed: 400, spread: 0.35, pellets: 5 },
    { id: 2, name: "Rifle",   unlocked: false, dmg: 3, fire: 0.12, speed: 520, spread: 0.02, pellets: 1 }
  ];

  // Shop items (simple)
  // type: "unlock" sets weapon unlocked; "heal" heals; "maxhp" increases max hp
  var SHOP_ITEMS = [
    { key: 1, label: "Unlock Shotgun", cost: 8,  type: "unlock", weaponId: 1, desc: "Wide spread, big control" },
    { key: 2, label: "Unlock Rifle",   cost: 14, type: "unlock", weaponId: 2, desc: "Fast, accurate, punchy" },
    { key: 3, label: "Heal +2",        cost: 4,  type: "heal",   amount: 2,    desc: "Patch up" },
    { key: 4, label: "+1 Max HP",      cost: 18, type: "maxhp",  amount: 1,    desc: "More tanky" }
  ];

  var player = {
    x: ROOM_W / 2,
    y: ROOM_H / 2,
    r: 8,
    hp: 6,
    hpMax: 6,
    invT: 0,
    dashT: 0,
    dashCD: 0,
    vx: 0, vy: 0,
    speed: 150,
    weapon: 0,
    fireCD: 0
  };

  // ---------- Room Node / Room Data ----------
  function ensureNode(id) {
    if (!state.map[id]) {
      var p = parseRoom(id);
      state.map[id] = {
        id: id,
        x: p.x, y: p.y,
        depth: Math.abs(p.x) + Math.abs(p.y),
        kind: "combat",
        seen: false,
        cleared: false,
        locked: false
      };
    }
    return state.map[id];
  }
  function getRoomNode(id) { return state.map[id] || null; }

  function ensureRoom(id) {
    if (!state.rooms[id]) {
      state.rooms[id] = {
        id: id,
        g: null,
        doorsOpen: { N: true, S: true, W: true, E: true },
        neighbors: { N: false, S: false, W: false, E: false },
        __cache: null
      };
    }
    return state.rooms[id];
  }
  function getRoom(id) { return state.rooms[id] || null; }

  // ---------- Deterministic shop placement per depth ----------
  // For each depth d >= 1, pick exactly one coordinate on that ring:
  // cycle through cardinal points so it's reachable and obvious.
  function isShopCoord(x, y) {
    var d = Math.abs(x) + Math.abs(y);
    if (d < 1) return false;
    // choose one of 4 positions: (d,0), (0,d), (-d,0), (0,-d)
    var m = d % 4;
    if (m === 0) return (x === d && y === 0);
    if (m === 1) return (x === 0 && y === d);
    if (m === 2) return (x === -d && y === 0);
    return (x === 0 && y === -d);
  }

  // ---------- Tile generation ----------
  // 0 wall, 1 floor, 2 pit, 3 door marker, 4 small pillar
  function genRoomTiles(node) {
    var room = ensureRoom(node.id);
    var g = new Array(ROOM_TW * ROOM_TH);
    var x, y;

    for (y = 0; y < ROOM_TH; y++) {
      for (x = 0; x < ROOM_TW; x++) {
        var edge = (x === 0 || y === 0 || x === ROOM_TW - 1 || y === ROOM_TH - 1);
        g[tileIndex(x, y)] = edge ? 0 : 1;
      }
    }

    // rooms look different
    if (node.kind === "shop") {
      // cleaner floor
    } else if (node.kind === "combat") {
      for (var i = 0; i < 26; i++) {
        var px = 2 + randi(ROOM_TW - 4);
        var py = 2 + randi(ROOM_TH - 4);
        if (chance(0.25)) g[tileIndex(px, py)] = 2;
      }
    }

    // pillars
    var density = (node.kind === "combat") ? 0.055 : 0.03;
    for (y = 2; y < ROOM_TH - 2; y++) {
      for (x = 2; x < ROOM_TW - 2; x++) {
        if (g[tileIndex(x, y)] !== 1) continue;
        if (chance(density)) g[tileIndex(x, y)] = 4;
      }
    }

    // clear center spawn
    for (y = (ROOM_TH / 2 - 1) | 0; y <= (ROOM_TH / 2 + 1) | 0; y++) {
      for (x = (ROOM_TW / 2 - 1) | 0; x <= (ROOM_TW / 2 + 1) | 0; x++) {
        g[tileIndex(x, y)] = 1;
      }
    }

    // carve doors where neighbors exist
    function carveDoor(dir) {
      var mx = (ROOM_TW / 2) | 0;
      var my = (ROOM_TH / 2) | 0;
      if (dir === "N") { g[tileIndex(mx, 0)] = 1; g[tileIndex(mx, 1)] = 3; }
      else if (dir === "S") { g[tileIndex(mx, ROOM_TH - 1)] = 1; g[tileIndex(mx, ROOM_TH - 2)] = 3; }
      else if (dir === "W") { g[tileIndex(0, my)] = 1; g[tileIndex(1, my)] = 3; }
      else { g[tileIndex(ROOM_TW - 1, my)] = 1; g[tileIndex(ROOM_TW - 2, my)] = 3; }
    }

    if (room.neighbors.N) carveDoor("N");
    if (room.neighbors.S) carveDoor("S");
    if (room.neighbors.W) carveDoor("W");
    if (room.neighbors.E) carveDoor("E");

    room.g = g;
    return room;
  }

  // ---------- World collision (pillars are SMALL) ----------
  function isSolidAtPoint(wx, wy, room) {
    var tx = (wx / TILE) | 0;
    var ty = (wy / TILE) | 0;
    if (tx < 0 || ty < 0 || tx >= ROOM_TW || ty >= ROOM_TH) return true;

    var t = room.g[tileIndex(tx, ty)];
    if (t === 0 || t === 2) return true;

    if (t === 4) {
      var cx = tx * TILE + TILE * 0.5;
      var cy = ty * TILE + TILE * 0.5;
      var dx = wx - cx, dy = wy - cy;
      var rad = TILE * 0.28;
      return (dx * dx + dy * dy) <= rad * rad;
    }

    return false;
  }

  function collideCircle(x, y, r, room) {
    var samples = 12;
    for (var i = 0; i < samples; i++) {
      var a = (i / samples) * TAU;
      var px = x + Math.cos(a) * r;
      var py = y + Math.sin(a) * r;
      if (isSolidAtPoint(px, py, room)) return true;
    }
    return false;
  }

  // ---------- Neighbor generation (guaranteed connectivity within bounds) ----------
  var MAX_DEPTH = 10;

  function buildNeighborsAround(id) {
    var node = ensureNode(id);
    var room = ensureRoom(id);

    var x = node.x, y = node.y;

    function link(nx, ny, dirA, dirB) {
      if (Math.abs(nx) + Math.abs(ny) > MAX_DEPTH) return;
      room.neighbors[dirA] = true;
      var nid = roomKey(nx, ny);
      ensureNode(nid);
      var r2 = ensureRoom(nid);
      r2.neighbors[dirB] = true;
    }

    link(x, y - 1, "N", "S");
    link(x, y + 1, "S", "N");
    link(x - 1, y, "W", "E");
    link(x + 1, y, "E", "W");

    genRoomTiles(node);
  }

  // ---------- Content spawning ----------
  function spawnRoomContents(roomId) {
    var node = ensureNode(roomId);
    var room = ensureRoom(roomId);

    // Determine kind
    if (roomId === "0,0") node.kind = "start";
    else if (isShopCoord(node.x, node.y)) node.kind = "shop";
    else node.kind = "combat";

    // Clear live arrays
    state.enemies.length = 0;
    state.bullets.length = 0;
    state.pickups.length = 0;
    state.fx.length = 0;
    state.decals.length = 0;

    // Door behavior by kind
    if (node.kind === "shop" || node.kind === "start") {
      node.cleared = true;
      lockDoors(room, false);
      // little freebies in start
      if (node.kind === "start") {
        state.pickups.push({ x: ROOM_W / 2 + 44, y: ROOM_H / 2, t: "coin", v: 3, r: 7 });
      }
      return;
    }

    // Combat room
    if (!node.cleared) {
      var n = 4 + randi(4) + (node.depth > 4 ? 1 : 0);
      for (var i = 0; i < n; i++) {
        var px = 60 + randf() * (ROOM_W - 120);
        var py = 60 + randf() * (ROOM_H - 120);
        spawnEnemy(chance(0.25) ? "shooter" : "chaser", px, py, node.depth);
      }
      lockDoors(room, true);
    } else {
      lockDoors(room, false);
    }
  }

  function lockDoors(room, locked) {
    room.doorsOpen.N = !locked;
    room.doorsOpen.S = !locked;
    room.doorsOpen.W = !locked;
    room.doorsOpen.E = !locked;
  }

  // ---------- Enemy spawn ----------
  function spawnEnemy(type, x, y, depth) {
    var hpBase = (type === "shooter") ? 6 : 5;
    var e = {
      type: type,
      x: x, y: y,
      r: 10,
      hp: hpBase + ((depth / 3) | 0),
      vx: 0, vy: 0,
      t: 0,
      fireCD: 0
    };
    state.enemies.push(e);
  }

  // ---------- Room caching ----------
  function stashRoom(roomId) {
    var r = getRoom(roomId);
    if (!r) return;
    r.__cache = {
      enemies: cloneArray(state.enemies),
      pickups: cloneArray(state.pickups),
      decals: cloneArray(state.decals)
    };
  }

  function loadRoom(roomId) {
    var r = ensureRoom(roomId);
    var node = ensureNode(roomId);

    // Ensure kind is set early (for tile look)
    if (roomId === "0,0") node.kind = "start";
    else if (isShopCoord(node.x, node.y)) node.kind = "shop";
    else node.kind = node.kind || "combat";

    buildNeighborsAround(roomId);
    genRoomTiles(node);

    // Clear live arrays
    state.enemies.length = 0;
    state.bullets.length = 0;
    state.pickups.length = 0;
    state.fx.length = 0;
    state.decals.length = 0;

    if (r.__cache) {
      state.enemies = cloneArray(r.__cache.enemies);
      state.pickups = cloneArray(r.__cache.pickups);
      state.decals = cloneArray(r.__cache.decals);
    } else {
      spawnRoomContents(roomId);
    }

    // lock doors if combat not cleared
    if (!node.cleared && node.kind === "combat") lockDoors(r, true);
    else lockDoors(r, false);

    node.seen = true;

    // Close shop UI on room change
    state.shopOpen = false;
  }

  function cloneArray(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(shallowClone(arr[i]));
    return out;
  }
  function shallowClone(o) {
    var k, n = {};
    for (k in o) if (o.hasOwnProperty(k)) n[k] = o[k];
    return n;
  }

  // ---------- Door transition (BUGFIX: trigger when pushing into doorway) ----------
  function inDoorBand(dir, x, y) {
    var cx = ROOM_W * 0.5;
    var cy = ROOM_H * 0.5;

    if (dir === "N") {
      return (Math.abs(x - cx) <= DOOR_SPAN) && (y <= DOOR_THICK);
    }
    if (dir === "S") {
      return (Math.abs(x - cx) <= DOOR_SPAN) && (y >= ROOM_H - DOOR_THICK);
    }
    if (dir === "W") {
      return (Math.abs(y - cy) <= DOOR_SPAN) && (x <= DOOR_THICK);
    }
    return (Math.abs(y - cy) <= DOOR_SPAN) && (x >= ROOM_W - DOOR_THICK);
  }

  function tryDoorTransitionByIntent(dir) {
    var node = ensureNode(state.roomId);
    var room = ensureRoom(state.roomId);

    if (!room.neighbors[dir]) return false;
    if (!room.doorsOpen[dir]) {
      // bump message only if you're actually at the blocked door
      if (inDoorBand(dir, player.x, player.y)) {
        state.msg = "DOOR LOCKED";
        state.msgT = 0.6;
      }
      return false;
    }

    // compute next room id
    var dx = 0, dy = 0;
    if (dir === "N") dy = -1;
    else if (dir === "S") dy = 1;
    else if (dir === "W") dx = -1;
    else dx = 1;

    var nid = roomKey(node.x + dx, node.y + dy);
    var nextNode = ensureNode(nid);
    ensureRoom(nid);

    // stash current, load next
    stashRoom(state.roomId);
    state.roomId = nid;
    loadRoom(state.roomId);

    // place player just inside opposite side
    if (dir === "N") { player.y = ROOM_H - 18; player.x = clamp(player.x, 18, ROOM_W - 18); }
    if (dir === "S") { player.y = 18; player.x = clamp(player.x, 18, ROOM_W - 18); }
    if (dir === "W") { player.x = ROOM_W - 18; player.y = clamp(player.y, 18, ROOM_H - 18); }
    if (dir === "E") { player.x = 18; player.y = clamp(player.y, 18, ROOM_H - 18); }

    // snap camera
    state.cam.x = clamp(player.x - VIEW_W / 2, 0, ROOM_W - VIEW_W);
    state.cam.y = clamp(player.y - VIEW_H / 2, 0, ROOM_H - VIEW_H);
    state.cam.shake = 0;
    state.cam.shakeT = 0;
    return true;
  }

  // ---------- Shooting ----------
  function spawnBullet(x, y, vx, vy, dmg, from, kind) {
    state.bullets.push({
      x: x, y: y,
      vx: vx, vy: vy,
      r: 3,
      t: (from === "player") ? 1.05 : 1.6,
      dmg: dmg,
      from: from,
      kind: kind
    });
  }

  function shoot() {
    if (player.fireCD > 0) return;

    var w = WEAPONS[player.weapon];
    if (!w.unlocked) return;

    var wx = state.cam.x + mouse.x;
    var wy = state.cam.y + mouse.y;
    var dx = wx - player.x;
    var dy = wy - player.y;
    var n = norm(dx, dy);
    var baseA = Math.atan2(n.y, n.x);

    for (var i = 0; i < w.pellets; i++) {
      var a = baseA + (w.spread * (randf() - 0.5));
      var sp = w.speed * (0.92 + randf() * 0.16);
      spawnBullet(player.x, player.y, Math.cos(a) * sp, Math.sin(a) * sp, w.dmg, "player", "p");
    }

    player.fireCD = w.fire;

    // FX
    shake(2 + (w.pellets > 1 ? 2 : 0), 0.08);
    for (var k = 0; k < 10; k++) {
      state.fx.push({ x: player.x, y: player.y, vx: (randf() - 0.5) * 160, vy: (randf() - 0.5) * 160, t: 0.25, c: 0 });
    }
  }

  function spawnEnemyBullet(x, y, vx, vy, dmg) {
    spawnBullet(x, y, vx, vy, dmg, "enemy", "e");
  }

  // ---------- Damage / FX ----------
  function shake(amount, time) {
    state.cam.shake = Math.max(state.cam.shake, amount);
    state.cam.shakeT = Math.max(state.cam.shakeT, time);
  }

  function hurtPlayer(dmg) {
    if (player.invT > 0) return;
    player.hp -= dmg;
    player.invT = 0.6;
    shake(6, 0.16);
    for (var i = 0; i < 18; i++) {
      state.fx.push({ x: player.x, y: player.y, vx: (randf() - 0.5) * 240, vy: (randf() - 0.5) * 240, t: 0.5, c: 1 });
    }
    if (player.hp <= 0) {
      player.hp = 0;
      state.msg = "YOU DIED — PRESS R";
      state.msgT = 999;
      state.paused = true;
    }
  }

  // ---------- Pickups ----------
  // types: coin, heart
  function dropCoins(x, y, amount) {
    for (var i = 0; i < amount; i++) {
      var a = randf() * TAU;
      var r = 10 + randf() * 14;
      state.pickups.push({
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r,
        t: "coin",
        v: 1,
        r: 6
      });
    }
  }

  // ---------- Shop ----------
  function nearShopCounter() {
    // counter at top-center-ish
    var cx = ROOM_W * 0.5;
    var cy = TILE * 2.5;
    return dist2(player.x, player.y, cx, cy) < (38 * 38);
  }

  function tryOpenShop() {
    var node = ensureNode(state.roomId);
    if (node.kind !== "shop") return;
    if (!nearShopCounter()) {
      state.msg = "STEP UP TO THE COUNTER";
      state.msgT = 0.8;
      return;
    }
    state.shopOpen = !state.shopOpen;
  }

  function buyShopItem(item) {
    if (state.coins < item.cost) {
      state.msg = "NOT ENOUGH COINS";
      state.msgT = 0.8;
      shake(1, 0.06);
      return;
    }

    if (item.type === "unlock") {
      var w = WEAPONS[item.weaponId];
      if (w.unlocked) {
        state.msg = "ALREADY OWNED";
        state.msgT = 0.7;
        return;
      }
      w.unlocked = true;
      state.coins -= item.cost;
      state.msg = "UNLOCKED: " + w.name;
      state.msgT = 1.0;
      shake(2, 0.08);
      return;
    }

    if (item.type === "heal") {
      if (player.hp >= player.hpMax) {
        state.msg = "HP FULL";
        state.msgT = 0.7;
        return;
      }
      state.coins -= item.cost;
      player.hp = clamp(player.hp + item.amount, 0, player.hpMax);
      state.msg = "HEALED";
      state.msgT = 0.9;
      return;
    }

    if (item.type === "maxhp") {
      state.coins -= item.cost;
      player.hpMax += item.amount;
      player.hp += item.amount;
      state.msg = "MAX HP UP";
      state.msgT = 1.0;
      return;
    }
  }

  // ---------- Update loop ----------
  function update(dt) {
    // pause / restart
    if (state.paused) {
      if (wasPressed(KEY.ESC)) state.paused = false;
      if (wasPressed(KEY.F)) requestFullscreen();
      if (wasPressed(KEY.R)) resetGame();
      return;
    }

    if (wasPressed(KEY.ESC)) {
      // if shop open, close it first
      if (state.shopOpen) state.shopOpen = false;
      else state.paused = true;
    }
    if (wasPressed(KEY.F)) requestFullscreen();
    if (wasPressed(KEY.R)) resetGame();

    // timers
    if (state.msgT > 0) state.msgT -= dt;
    if (player.invT > 0) player.invT -= dt;
    if (player.fireCD > 0) player.fireCD -= dt;
    if (player.dashT > 0) player.dashT -= dt;
    if (player.dashCD > 0) player.dashCD -= dt;
    if (state.cam.shakeT > 0) { state.cam.shakeT -= dt; state.cam.shake = lerp(state.cam.shake, 0, 10 * dt); }
    else state.cam.shake = 0;

    // shop interactions
    var node = ensureNode(state.roomId);
    if (node.kind === "shop") {
      if (wasPressed(KEY.Q)) { if (WEAPONS[0].unlocked) player.weapon = 0; }
      if (wasPressed(KEY.E)) { if (WEAPONS[1].unlocked) player.weapon = 1; else if (WEAPONS[2].unlocked) player.weapon = 2; } // quick swap-ish

      if (wasPressed(KEY.F)) tryOpenShop();

      if (state.shopOpen) {
        // buy using 1-4
        if (wasPressed(KEY.ONE)) buyShopItem(SHOP_ITEMS[0]);
        if (wasPressed(KEY.TWO)) buyShopItem(SHOP_ITEMS[1]);
        if (wasPressed(KEY.THREE)) buyShopItem(SHOP_ITEMS[2]);
        if (wasPressed(KEY.FOUR)) buyShopItem(SHOP_ITEMS[3]);
      }
    } else {
      // weapon swaps in normal rooms
      if (wasPressed(KEY.Q) && WEAPONS[0].unlocked) player.weapon = 0;
      if (wasPressed(KEY.E)) {
        if (WEAPONS[1].unlocked) player.weapon = 1;
        else if (WEAPONS[2].unlocked) player.weapon = 2;
      }
    }

    // if shop open, freeze combat sim (still allow movement a bit? keep it simple: freeze)
    if (state.shopOpen) {
      // still allow small idle particles fade
      updateParticles(dt);
      return;
    }

    // dash
    if ((wasPressed(KEY.SPACE) || wasPressed(KEY.SHIFT)) && player.dashCD <= 0) {
      var mx = 0, my = 0;
      if (keys[KEY.A] || keys[KEY.LEFT]) mx -= 1;
      if (keys[KEY.D] || keys[KEY.RIGHT]) mx += 1;
      if (keys[KEY.W] || keys[KEY.UP]) my -= 1;
      if (keys[KEY.S] || keys[KEY.DOWN]) my += 1;

      if (mx === 0 && my === 0) {
        var awx = state.cam.x + mouse.x, awy = state.cam.y + mouse.y;
        var dn = norm(awx - player.x, awy - player.y);
        mx = dn.x; my = dn.y;
      } else {
        var dn2 = norm(mx, my);
        mx = dn2.x; my = dn2.y;
      }

      player.dashT = 0.12;
      player.dashCD = 0.75;
      player.vx = mx * 640;
      player.vy = my * 640;
      shake(3, 0.08);
    }

    // movement
    var ax = 0, ay = 0;
    if (player.dashT <= 0) {
      if (keys[KEY.A] || keys[KEY.LEFT]) ax -= 1;
      if (keys[KEY.D] || keys[KEY.RIGHT]) ax += 1;
      if (keys[KEY.W] || keys[KEY.UP]) ay -= 1;
      if (keys[KEY.S] || keys[KEY.DOWN]) ay += 1;

      var sp = player.speed;
      if (keys[KEY.SHIFT]) sp *= 1.20;

      if (ax !== 0 || ay !== 0) {
        var nn = norm(ax, ay);
        player.vx = nn.x * sp;
        player.vy = nn.y * sp;
      } else {
        player.vx = lerp(player.vx, 0, 10 * dt);
        player.vy = lerp(player.vy, 0, 10 * dt);
      }
    } else {
      player.vx = lerp(player.vx, 0, 4 * dt);
      player.vy = lerp(player.vy, 0, 4 * dt);
    }

    // shoot
    if (mouse.down) shoot();

    // move with door-aware collision (bugfix)
    var room = ensureRoom(state.roomId);

    var nxp = player.x + player.vx * dt;
    var nyp = player.y + player.vy * dt;

    // If pushing into a doorway band and moving outward, transition.
    // North
    if (player.vy < 0 && inDoorBand("N", player.x, player.y) && (nyp <= 2)) {
      if (tryDoorTransitionByIntent("N")) return;
    }
    // South
    if (player.vy > 0 && inDoorBand("S", player.x, player.y) && (nyp >= ROOM_H - 2)) {
      if (tryDoorTransitionByIntent("S")) return;
    }
    // West
    if (player.vx < 0 && inDoorBand("W", player.x, player.y) && (nxp <= 2)) {
      if (tryDoorTransitionByIntent("W")) return;
    }
    // East
    if (player.vx > 0 && inDoorBand("E", player.x, player.y) && (nxp >= ROOM_W - 2)) {
      if (tryDoorTransitionByIntent("E")) return;
    }

    // normal collision resolution
    if (!collideCircle(nxp, player.y, player.r, room)) player.x = nxp;
    else player.vx = 0;

    if (!collideCircle(player.x, nyp, player.r, room)) player.y = nyp;
    else player.vy = 0;

    // camera follow
    var targetX = clamp(player.x - VIEW_W / 2, 0, ROOM_W - VIEW_W);
    var targetY = clamp(player.y - VIEW_H / 2, 0, ROOM_H - VIEW_H);
    state.cam.x = lerp(state.cam.x, targetX, 10 * dt);
    state.cam.y = lerp(state.cam.y, targetY, 10 * dt);

    // enemies/bullets/pickups/fx
    updateEnemies(dt);
    updateBullets(dt);
    updatePickups(dt);
    updateParticles(dt);

    // room clear check
    if (!node.cleared && node.kind === "combat") {
      if (state.enemies.length === 0) {
        node.cleared = true;
        lockDoors(room, false);
        state.msg = "ROOM CLEARED";
        state.msgT = 0.9;
        // occasional reward
        if (chance(0.30)) state.pickups.push({ x: ROOM_W / 2, y: ROOM_H / 2, t: "coin", v: 3, r: 7 });
        if (chance(0.18)) state.pickups.push({ x: ROOM_W / 2 + 18, y: ROOM_H / 2, t: "heart", v: 1, r: 7 });
      }
    }
  }

  function updateEnemies(dt) {
    var room = ensureRoom(state.roomId);
    var depth = ensureNode(state.roomId).depth;

    for (var i = state.enemies.length - 1; i >= 0; i--) {
      var e = state.enemies[i];
      e.t += dt;

      var dx = player.x - e.x;
      var dy = player.y - e.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;

      if (e.type === "chaser") {
        var sp = 85 + depth * 2;
        e.vx = (dx / d) * sp;
        e.vy = (dy / d) * sp;
      } else {
        // shooter
        var sp2 = 70 + depth * 1.5;
        var desired = 150;
        if (d < desired) {
          e.vx = -(dx / d) * sp2;
          e.vy = -(dy / d) * sp2;
        } else {
          e.vx = (randf() - 0.5) * 30;
          e.vy = (randf() - 0.5) * 30;
        }

        if (e.fireCD > 0) e.fireCD -= dt;
        if (e.fireCD <= 0 && d < 340) {
          var n = norm(dx, dy);
          spawnEnemyBullet(e.x, e.y, n.x * (240 + depth * 5), n.y * (240 + depth * 5), 1);
          e.fireCD = 1.0 + randf() * 0.6;
        }
      }

      // move with collision
      var nx = e.x + e.vx * dt;
      var ny = e.y + e.vy * dt;
      if (!collideCircle(nx, e.y, e.r, room)) e.x = nx;
      if (!collideCircle(e.x, ny, e.r, room)) e.y = ny;

      // contact damage
      if (dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) * (e.r + player.r)) hurtPlayer(1);

      // death
      if (e.hp <= 0) {
        state.decals.push({ x: e.x, y: e.y, r: e.r + 10, t: 999, kind: "spl" });
        for (var j = 0; j < 22; j++) {
          state.fx.push({ x: e.x, y: e.y, vx: (randf() - 0.5) * 300, vy: (randf() - 0.5) * 300, t: 0.55, c: 2 });
        }

        // coins drop (scales a bit with depth)
        var coins = 1 + randi(2) + ((depth / 4) | 0);
        dropCoins(e.x, e.y, coins);

        // small heart chance
        if (chance(0.14)) state.pickups.push({ x: e.x, y: e.y, t: "heart", v: 1, r: 7 });

        state.enemies.splice(i, 1);
      }
    }
  }

  function updateBullets(dt) {
    var room = ensureRoom(state.roomId);

    for (var i = state.bullets.length - 1; i >= 0; i--) {
      var b = state.bullets[i];
      b.t -= dt;

      var nx = b.x + b.vx * dt;
      var ny = b.y + b.vy * dt;

      if (isSolidAtPoint(nx, ny, room)) {
        for (var k = 0; k < 6; k++) {
          state.fx.push({ x: nx, y: ny, vx: (randf() - 0.5) * 170, vy: (randf() - 0.5) * 170, t: 0.22, c: 0 });
        }
        state.bullets.splice(i, 1);
        continue;
      }

      b.x = nx; b.y = ny;

      if (b.from === "player") {
        for (var e = state.enemies.length - 1; e >= 0; e--) {
          var en = state.enemies[e];
          if (dist2(b.x, b.y, en.x, en.y) < (b.r + en.r) * (b.r + en.r)) {
            en.hp -= b.dmg;
            shake(2, 0.06);
            state.bullets.splice(i, 1);
            break;
          }
        }
      } else {
        if (dist2(b.x, b.y, player.x, player.y) < (b.r + player.r) * (b.r + player.r)) {
          hurtPlayer(b.dmg);
          state.bullets.splice(i, 1);
          continue;
        }
      }

      if (b.t <= 0) state.bullets.splice(i, 1);
    }
  }

  function updatePickups(dt) {
    for (var i = state.pickups.length - 1; i >= 0; i--) {
      var p = state.pickups[i];
      if (dist2(p.x, p.y, player.x, player.y) < (p.r + player.r + 6) * (p.r + player.r + 6)) {
        if (p.t === "coin") {
          state.coins += p.v;
          state.msg = "+COIN";
          state.msgT = 0.35;
        } else if (p.t === "heart") {
          player.hp = clamp(player.hp + p.v, 0, player.hpMax);
          state.msg = "+HP";
          state.msgT = 0.45;
        }
        for (var k = 0; k < 10; k++) {
          state.fx.push({ x: p.x, y: p.y, vx: (randf() - 0.5) * 200, vy: (randf() - 0.5) * 200, t: 0.25, c: 3 });
        }
        state.pickups.splice(i, 1);
      }
    }
  }

  function updateParticles(dt) {
    for (var i = state.fx.length - 1; i >= 0; i--) {
      var p = state.fx[i];
      p.t -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.002, dt);
      p.vy *= Math.pow(0.002, dt);
      if (p.t <= 0) state.fx.splice(i, 1);
    }
  }

  // ---------- Render ----------
  function draw() {
    var room = ensureRoom(state.roomId);
    var node = ensureNode(state.roomId);

    // background
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#07060b";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // camera shake
    var sx = 0, sy = 0;
    if (state.cam.shake > 0 && state.cam.shakeT > 0) {
      sx = (randf() - 0.5) * state.cam.shake * 2;
      sy = (randf() - 0.5) * state.cam.shake * 2;
    }
    var camX = state.cam.x + sx;
    var camY = state.cam.y + sy;

    // room
    drawRoom(room, node, camX, camY);

    // decals
    for (var i = 0; i < state.decals.length; i++) {
      var d = state.decals[i];
      var dx = d.x - camX, dy = d.y - camY;
      ctx.fillStyle = "rgba(255,70,120,0.10)";
      ctx.beginPath();
      ctx.arc(dx, dy, d.r, 0, TAU);
      ctx.fill();
    }

    // pickups
    for (i = 0; i < state.pickups.length; i++) {
      var pk = state.pickups[i];
      var px = pk.x - camX, py = pk.y - camY;

      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(px, py + 6, pk.r * 1.0, pk.r * 0.6, 0, 0, TAU);
      ctx.fill();

      if (pk.t === "coin") {
        ctx.fillStyle = "rgba(255,215,90,0.95)";
        ctx.beginPath();
        ctx.arc(px, py, pk.r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(px - 2, py - 4, 4, 2);
      } else {
        ctx.fillStyle = "rgba(120,255,180,0.95)";
        ctx.beginPath();
        ctx.arc(px, py, pk.r, 0, TAU);
        ctx.fill();
      }
    }

    // enemies
    for (i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      var ex = e.x - camX, ey = e.y - camY;

      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(ex, ey + e.r * 0.85, e.r * 0.95, e.r * 0.55, 0, 0, TAU);
      ctx.fill();

      // body
      ctx.fillStyle = (e.type === "shooter") ? "rgba(140,190,255,0.92)" : "rgba(255,90,170,0.92)";
      ctx.beginPath();
      ctx.arc(ex, ey, e.r, 0, TAU);
      ctx.fill();

      // face dot
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.arc(ex + (e.type === "shooter" ? 3 : -3), ey - 2, 2, 0, TAU);
      ctx.fill();

      // HP bar
      var w = e.r * 2.2;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(ex - w / 2, ey - e.r - 12, w, 4);
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.fillRect(ex - w / 2, ey - e.r - 12, w * clamp(e.hp / (6 + ((node.depth / 3) | 0)), 0, 1), 4);
    }

    // bullets
    for (i = 0; i < state.bullets.length; i++) {
      var b = state.bullets[i];
      var bx = b.x - camX, by = b.y - camY;
      ctx.fillStyle = (b.from === "player") ? "rgba(255,255,255,0.9)" : "rgba(255,200,90,0.9)";
      ctx.beginPath();
      ctx.arc(bx, by, b.r, 0, TAU);
      ctx.fill();
    }

    // particles
    for (i = 0; i < state.fx.length; i++) {
      var fx = state.fx[i];
      var fxX = fx.x - camX, fxY = fx.y - camY;
      var a = clamp(fx.t / 0.55, 0, 1);
      if (fx.c === 1) ctx.fillStyle = "rgba(255,90,140," + (0.28 * a) + ")";
      else if (fx.c === 2) ctx.fillStyle = "rgba(255,210,120," + (0.22 * a) + ")";
      else if (fx.c === 3) ctx.fillStyle = "rgba(124,92,255," + (0.18 * a) + ")";
      else ctx.fillStyle = "rgba(255,255,255," + (0.22 * a) + ")";
      ctx.fillRect(fxX, fxY, 2, 2);
    }

    // player
    var px2 = player.x - camX, py2 = player.y - camY;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(px2, py2 + player.r * 0.95, player.r * 0.95, player.r * 0.55, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = (player.invT > 0) ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.arc(px2, py2, player.r, 0, TAU);
    ctx.fill();

    // aim reticle
    ctx.strokeStyle = "rgba(124,92,255,0.55)";
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 10, 0, TAU);
    ctx.stroke();

    // vignette lighting
    drawVignette();

    // HUD + minimap + shop overlay
    drawHUD(node);
    drawMinimap();

    if (node.kind === "shop") drawShopHint();
    if (state.shopOpen) drawShopOverlay();

    if (state.paused) drawPause();
  }

  function drawRoom(room, node, camX, camY) {
    var g = room.g;
    if (!g) return;

    // palette
    var floor = (node.kind === "shop") ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)";
    var wall = "rgba(255,255,255,0.06)";
    var pit = "rgba(0,0,0,0.58)";

    var x, y;
    for (y = 0; y < ROOM_TH; y++) {
      for (x = 0; x < ROOM_TW; x++) {
        var t = g[tileIndex(x, y)];
        var sx = x * TILE - camX;
        var sy = y * TILE - camY;

        if (sx > VIEW_W || sy > VIEW_H || sx + TILE < 0 || sy + TILE < 0) continue;

        if (t === 0) {
          ctx.fillStyle = wall;
          ctx.fillRect(sx, sy, TILE, TILE);
          // subtle bevel
          ctx.fillStyle = "rgba(0,0,0,0.10)";
          ctx.fillRect(sx, sy + TILE - 3, TILE, 3);
        } else if (t === 2) {
          ctx.fillStyle = pit;
          ctx.fillRect(sx, sy, TILE, TILE);
        } else {
          ctx.fillStyle = floor;
          ctx.fillRect(sx, sy, TILE, TILE);

          // faint grid line
          ctx.fillStyle = "rgba(0,0,0,0.10)";
          ctx.fillRect(sx, sy + TILE - 1, TILE, 1);
        }

        if (t === 3) {
          ctx.fillStyle = "rgba(124,92,255,0.14)";
          ctx.fillRect(sx + 6, sy + 6, TILE - 12, TILE - 12);
        } else if (t === 4) {
          // pillar
          var cx = sx + TILE * 0.5;
          var cy = sy + TILE * 0.5;
          var r = TILE * 0.28;

          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.beginPath();
          ctx.ellipse(cx, cy + r * 1.2, r * 1.1, r * 0.65, 0, 0, TAU);
          ctx.fill();

          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, TAU);
          ctx.fill();

          ctx.fillStyle = "rgba(124,92,255,0.18)";
          ctx.beginPath();
          ctx.arc(cx - 1, cy - 2, r * 0.62, 0, TAU);
          ctx.fill();
        }
      }
    }

    drawDoorBars(room, camX, camY);

    // shop set dressing
    if (node.kind === "shop") drawShopSet(camX, camY);
  }

  function drawDoorBars(room, camX, camY) {
    var mx = ROOM_W * 0.5;
    var my = ROOM_H * 0.5;
    var span = DOOR_SPAN;

    ctx.fillStyle = "rgba(255,80,140,0.22)";

    if (room.neighbors.N && !room.doorsOpen.N) ctx.fillRect(mx - span - camX, 2 - camY, span * 2, 6);
    if (room.neighbors.S && !room.doorsOpen.S) ctx.fillRect(mx - span - camX, ROOM_H - 8 - camY, span * 2, 6);
    if (room.neighbors.W && !room.doorsOpen.W) ctx.fillRect(2 - camX, my - span - camY, 6, span * 2);
    if (room.neighbors.E && !room.doorsOpen.E) ctx.fillRect(ROOM_W - 8 - camX, my - span - camY, 6, span * 2);
  }

  function drawShopSet(camX, camY) {
    var cx = ROOM_W * 0.5 - camX;
    var cy = TILE * 2.5 - camY;

    // counter
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(cx - 70, cy + 14, 140, 10);

    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(cx - 70, cy + 2, 140, 14);

    // shopkeeper orb
    ctx.fillStyle = "rgba(124,92,255,0.65)";
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(cx - 2, cy - 6, 4, 2);
  }

  function drawVignette() {
    // simple vignette: draw four big translucent rects
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, VIEW_W, 40);
    ctx.fillRect(0, VIEW_H - 40, VIEW_W, 40);
    ctx.fillRect(0, 0, 40, VIEW_H);
    ctx.fillRect(VIEW_W - 40, 0, 40, VIEW_H);
  }

  function drawHUD(node) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(14, 12, 320, 74);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("HP", 24, 36);

    for (var i = 0; i < player.hpMax; i++) {
      ctx.fillStyle = (i < player.hp) ? "rgba(120,255,170,0.9)" : "rgba(255,255,255,0.12)";
      ctx.fillRect(56 + i * 16, 24, 12, 12);
    }

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("Coins: " + state.coins + "   Keys: " + state.keys, 24, 60);

    var w = WEAPONS[player.weapon];
    var wname = w.name + (w.unlocked ? "" : " (LOCKED)");
    ctx.fillText("Weapon: " + wname + "   (Q/E)", 180, 36);

    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText("Room: " + node.kind + "  Depth: " + node.depth + "  [" + state.roomId + "]", 180, 60);

    if (state.msgT > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillText(state.msg, 14, VIEW_H - 20);
    }
  }

  function drawMinimap() {
    var size = 8;
    var ox = VIEW_W - 190;
    var oy = 14;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(ox, oy, 176, 176);

    var id;
    for (id in state.map) if (state.map.hasOwnProperty(id)) {
      var n = state.map[id];
      if (!n.seen) continue;
      var rx = ox + 88 + n.x * (size + 3);
      var ry = oy + 88 + n.y * (size + 3);

      var c = "rgba(255,255,255,0.22)";
      if (n.kind === "shop") c = "rgba(124,92,255,0.32)";
      if (n.kind === "start") c = "rgba(120,255,170,0.30)";
      if (n.cleared) c = "rgba(255,255,255,0.35)";

      ctx.fillStyle = c;
      ctx.fillRect(rx, ry, size, size);
    }

    var cur = ensureNode(state.roomId);
    var cx = ox + 88 + cur.x * (size + 3);
    var cy = oy + 88 + cur.y * (size + 3);
    ctx.fillStyle = "rgba(255,215,90,0.9)";
    ctx.fillRect(cx - 2, cy - 2, size + 4, size + 4);

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("MAP", ox + 12, oy + 18);
  }

  function drawShopHint() {
    ctx.fillStyle = "rgba(0,0,0,0.40)";
    ctx.fillRect(14, VIEW_H - 56, 360, 40);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("SHOP — press F at the counter to trade coins", 24, VIEW_H - 30);
  }

  function drawShopOverlay() {
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "28px system-ui, sans-serif";
    ctx.fillText("SHOP", 34, 56);

    ctx.font = "14px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("Coins: " + state.coins + "   (ESC to close)", 34, 80);

    var y = 120;
    for (var i = 0; i < SHOP_ITEMS.length; i++) {
      var it = SHOP_ITEMS[i];

      var owned = false;
      if (it.type === "unlock") owned = WEAPONS[it.weaponId].unlocked;

      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(34, y - 34, VIEW_W - 68, 54);

      ctx.fillStyle = "rgba(124,92,255,0.65)";
      ctx.fillText("[" + it.key + "]", 50, y);

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillText(it.label, 86, y);

      ctx.font = "14px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillText(it.desc, 86, y + 20);

      var right = VIEW_W - 160;
      if (owned) {
        ctx.fillStyle = "rgba(120,255,170,0.85)";
        ctx.fillText("OWNED", right, y);
      } else {
        ctx.fillStyle = (state.coins >= it.cost) ? "rgba(255,215,90,0.92)" : "rgba(255,255,255,0.35)";
        ctx.fillText(it.cost + " coins", right, y);
      }

      y += 72;
    }

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText("Tip: clear combat rooms for coin drops. Shops appear once per depth ring.", 34, VIEW_H - 30);
  }

  function drawPause() {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText("PAUSED", 34, 56);
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("ESC: resume   F: fullscreen   R: restart   Q/E: weapon   SPACE/SHIFT: dash", 34, 84);
  }

  // ---------- Fullscreen + Resize ----------
  function requestFullscreen() {
    var d = document;
    if (!d.fullscreenElement && canvas.requestFullscreen) {
      canvas.requestFullscreen();
    } else if (d.exitFullscreen) {
      d.exitFullscreen();
    }
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;

    // CSS size fills window
    var w = window.innerWidth;
    var h = window.innerHeight;

    // Internal resolution for crispness
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = (w * dpr) | 0;
    canvas.height = (h * dpr) | 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    VIEW_W = w;
    VIEW_H = h;

    // clamp camera (room stays fixed)
    state.cam.x = clamp(state.cam.x, 0, Math.max(0, ROOM_W - VIEW_W));
    state.cam.y = clamp(state.cam.y, 0, Math.max(0, ROOM_H - VIEW_H));
  }

  // ---------- Reset ----------
  function resetGame() {
    state.msg = "";
    state.msgT = 0;
    state.keys = 0;
    state.coins = 0;
    state.roomId = "0,0";
    state.map = {};
    state.rooms = {};
    state.enemies = [];
    state.bullets = [];
    state.pickups = [];
    state.fx = [];
    state.decals = [];
    state.paused = false;
    state.shopOpen = false;

    // reset weapons
    for (var i = 0; i < WEAPONS.length; i++) WEAPONS[i].unlocked = (WEAPONS[i].id === 0);

    player.x = ROOM_W / 2;
    player.y = ROOM_H / 2;
    player.hpMax = 6;
    player.hp = 6;
    player.invT = 0;
    player.dashT = 0;
    player.dashCD = 0;
    player.vx = 0;
    player.vy = 0;
    player.weapon = 0;
    player.fireCD = 0;

    ensureNode("0,0");
    ensureRoom("0,0");
    loadRoom("0,0");

    state.cam.x = clamp(player.x - VIEW_W / 2, 0, Math.max(0, ROOM_W - VIEW_W));
    state.cam.y = clamp(player.y - VIEW_H / 2, 0, Math.max(0, ROOM_H - VIEW_H));
  }

  // ---------- Main loop ----------
  function frame(t) {
    if (!state.running) return;
    var now = t || 0;
    var dt = (now - lastT) / 1000;
    lastT = now;
    dt = clamp(dt, 0, 1 / 30);

    update(dt);
    draw();

    keysPressed = {};
    requestAnimationFrame(frame);
  }

  // ---------- Game object ----------
  var Game = {
    create: function () {
      canvas = document.getElementById("game");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "game";
        document.body.appendChild(canvas);
      }

      // full-window styling
      document.body.style.margin = "0";
      document.body.style.overflow = "hidden";
      document.body.style.background = "#07060b";
      canvas.style.display = "block";
      canvas.style.position = "fixed";
      canvas.style.left = "0";
      canvas.style.top = "0";

      ctx = canvas.getContext("2d");

      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      canvas.addEventListener("mousemove", onMouseMove);
      canvas.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mouseup", onMouseUp);
      window.addEventListener("resize", resize);

      resize();
      resetGame();

      state.running = true;
      lastT = (performance && performance.now) ? performance.now() : 0;
      requestAnimationFrame(frame);
    }
  };

})();
