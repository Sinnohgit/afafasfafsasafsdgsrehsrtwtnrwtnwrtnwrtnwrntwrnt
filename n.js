/* n.js — ES5-safe single-file dungeon shooter (full-window)
   Updates:
   - Full-window canvas (100vw/100vh) + HiDPI + crisp pixels
   - Added peaceful rooms: Shop, Heal Fountain (free heal), Armory (rare free weapon)
   - Watermark system (set WATERMARK_TEXT to YOUR OWN text; cannot add 3rd-party site branding)
   - Improved spritework / tilework (cleaner pixel look + shading)
*/

(function () {
  "use strict";

  // ---------- Boot / Entry ----------
  window.create = function () { Game.create(); };

  // ---------- Config ----------
  // Put YOUR OWN watermark text here (e.g. "MyDungeonGame.com" / "My Studio" / etc.)
  var WATERMARK_TEXT = "YOUR-SITE-OR-GAME-NAME";
  var WATERMARK_ENABLED = true;

  // ---------- Constants ----------
  var TAU = Math.PI * 2;

  // Pixel-art scale: canvas is HiDPI, but we render with crisp edges
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
  var DOOR_THICK = 18;     // thickness of doorway trigger band inside room

  // ---------- Canvas / Context ----------
  var canvas, ctx;
  var dpr = 1;
  var VIEW_W = 960, VIEW_H = 540;
  var lastT = 0;

  // ---------- Input ----------
  var keys = {};
  var keysPressed = {};
  var mouse = { x: 0, y: 0, down: false };
  var wantsAutoFullscreen = false; // you asked full-window; not forcing fullscreen anymore

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
  function onMouseDown() { mouse.down = true; }
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
    map: {},
    rooms: {},
    enemies: [],
    bullets: [],
    pickups: [],
    fx: [],
    decals: []
  };

  // Weapons
  var WEAPONS = [
    { id: 0, name: "Pistol",  unlocked: true,  dmg: 2, fire: 0.18, speed: 440, spread: 0.00, pellets: 1 },
    { id: 1, name: "Shotgun", unlocked: false, dmg: 1, fire: 0.55, speed: 400, spread: 0.35, pellets: 5 },
    { id: 2, name: "Rifle",   unlocked: false, dmg: 3, fire: 0.12, speed: 520, spread: 0.02, pellets: 1 }
  ];

  // Shop items
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
        kind: "combat",   // combat | shop | heal | armory | start
        seen: false,
        cleared: false,
        flags: {}         // per-room flags (e.g., fountainUsed)
      };
    }
    return state.map[id];
  }
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

  // ---------- Deterministic special rooms ----------
  // Shop: one per depth ring
  function isShopCoord(x, y) {
    var d = Math.abs(x) + Math.abs(y);
    if (d < 1) return false;
    var m = d % 4;
    if (m === 0) return (x === d && y === 0);
    if (m === 1) return (x === 0 && y === d);
    if (m === 2) return (x === -d && y === 0);
    return (x === 0 && y === -d);
  }

  // Heal: one per depth ring, offset from shop ring pick
  function isHealCoord(x, y) {
    var d = Math.abs(x) + Math.abs(y);
    if (d < 2) return false;
    // choose the "diagonal-ish" extreme to differentiate
    // (d-1, 1), (1, d-1), (-d+1, -1), (-1, -d+1) with sign consistency
    if (x >= 0 && y >= 0) return (x === d - 1 && y === 1);
    if (x <= 0 && y >= 0) return (x === -1 && y === d - 1);
    if (x <= 0 && y <= 0) return (x === -(d - 1) && y === -1);
    return (x === 1 && y === -(d - 1));
  }

  // Armory: rare rooms (deterministic “hash”)
  function isArmoryCoord(x, y) {
    var d = Math.abs(x) + Math.abs(y);
    if (d < 3) return false;
    // deterministic pseudo-hash: rare when (x*31 + y*17 + d*13) % 11 == 0, but avoid colliding with shop/heal
    var h = (x * 31 + y * 17 + d * 13);
    h = ((h % 11) + 11) % 11;
    if (h !== 0) return false;
    if (isShopCoord(x, y) || isHealCoord(x, y)) return false;
    return true;
  }

  // ---------- Tile generation ----------
  // 0 wall, 1 floor, 2 pit, 3 door marker, 4 small pillar, 5 decor
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

    // Different feels per room
    if (node.kind === "combat") {
      for (var i = 0; i < 26; i++) {
        var px = 2 + randi(ROOM_TW - 4);
        var py = 2 + randi(ROOM_TH - 4);
        if (chance(0.25)) g[tileIndex(px, py)] = 2;
      }
    } else if (node.kind === "shop") {
      // cleaner floors + decor
      for (var d = 0; d < 18; d++) {
        var sx = 2 + randi(ROOM_TW - 4);
        var sy = 2 + randi(ROOM_TH - 4);
        if (chance(0.35)) g[tileIndex(sx, sy)] = 5;
      }
    } else if (node.kind === "heal") {
      for (var d2 = 0; d2 < 14; d2++) {
        var hx = 2 + randi(ROOM_TW - 4);
        var hy = 2 + randi(ROOM_TH - 4);
        if (chance(0.28)) g[tileIndex(hx, hy)] = 5;
      }
    } else if (node.kind === "armory") {
      for (var d3 = 0; d3 < 16; d3++) {
        var ax = 2 + randi(ROOM_TW - 4);
        var ay = 2 + randi(ROOM_TH - 4);
        if (chance(0.30)) g[tileIndex(ax, ay)] = 5;
      }
    }

    // pillars
    var density = (node.kind === "combat") ? 0.055 : 0.020;
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

  // ---------- World collision ----------
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

  // ---------- Neighbor generation ----------
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

  // ---------- Room kind assignment ----------
  function assignRoomKind(node) {
    if (node.id === "0,0") return "start";
    if (isShopCoord(node.x, node.y)) return "shop";
    if (isHealCoord(node.x, node.y)) return "heal";
    if (isArmoryCoord(node.x, node.y)) return "armory";
    return "combat";
  }

  // ---------- Content spawning ----------
  function lockDoors(room, locked) {
    room.doorsOpen.N = !locked;
    room.doorsOpen.S = !locked;
    room.doorsOpen.W = !locked;
    room.doorsOpen.E = !locked;
  }

  function spawnRoomContents(roomId) {
    var node = ensureNode(roomId);
    var room = ensureRoom(roomId);

    node.kind = assignRoomKind(node);

    // clear live arrays
    state.enemies.length = 0;
    state.bullets.length = 0;
    state.pickups.length = 0;
    state.fx.length = 0;
    state.decals.length = 0;

    // peaceful rooms
    if (node.kind === "start" || node.kind === "shop" || node.kind === "heal" || node.kind === "armory") {
      node.cleared = true;
      lockDoors(room, false);

      // start freebies
      if (node.kind === "start") {
        state.pickups.push({ x: ROOM_W / 2 + 44, y: ROOM_H / 2, t: "coin", v: 3, r: 7 });
      }

      return;
    }

    // combat rooms
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

  // ---------- Enemy spawn ----------
  function spawnEnemy(type, x, y, depth) {
    var hpBase = (type === "shooter") ? 6 : 5;
    var e = {
      type: type,
      x: x, y: y,
      r: (type === "shooter") ? 10 : 11,
      hp: hpBase + ((depth / 3) | 0),
      vx: 0, vy: 0,
      t: 0,
      fireCD: 0
    };
    state.enemies.push(e);
  }

  // ---------- Room caching ----------
  function shallowClone(o) { var k, n = {}; for (k in o) if (o.hasOwnProperty(k)) n[k] = o[k]; return n; }
  function cloneArray(arr) { var out = []; for (var i = 0; i < arr.length; i++) out.push(shallowClone(arr[i])); return out; }

  function stashRoom(roomId) {
    var r = state.rooms[roomId];
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

    node.kind = assignRoomKind(node);

    buildNeighborsAround(roomId);
    genRoomTiles(node);

    // clear live arrays
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
    state.shopOpen = false;
  }

  // ---------- Door transition (push-to-transition bugfix stays) ----------
  function inDoorBand(dir, x, y) {
    var cx = ROOM_W * 0.5;
    var cy = ROOM_H * 0.5;

    if (dir === "N") return (Math.abs(x - cx) <= DOOR_SPAN) && (y <= DOOR_THICK);
    if (dir === "S") return (Math.abs(x - cx) <= DOOR_SPAN) && (y >= ROOM_H - DOOR_THICK);
    if (dir === "W") return (Math.abs(y - cy) <= DOOR_SPAN) && (x <= DOOR_THICK);
    return (Math.abs(y - cy) <= DOOR_SPAN) && (x >= ROOM_W - DOOR_THICK);
  }

  function tryDoorTransitionByIntent(dir) {
    var node = ensureNode(state.roomId);
    var room = ensureRoom(state.roomId);

    if (!room.neighbors[dir]) return false;
    if (!room.doorsOpen[dir]) {
      if (inDoorBand(dir, player.x, player.y)) {
        state.msg = "DOOR LOCKED";
        state.msgT = 0.6;
      }
      return false;
    }

    var dx = 0, dy = 0;
    if (dir === "N") dy = -1;
    else if (dir === "S") dy = 1;
    else if (dir === "W") dx = -1;
    else dx = 1;

    var nid = roomKey(node.x + dx, node.y + dy);
    ensureNode(nid);
    ensureRoom(nid);

    stashRoom(state.roomId);
    state.roomId = nid;
    loadRoom(state.roomId);

    if (dir === "N") { player.y = ROOM_H - 18; player.x = clamp(player.x, 18, ROOM_W - 18); }
    if (dir === "S") { player.y = 18; player.x = clamp(player.x, 18, ROOM_W - 18); }
    if (dir === "W") { player.x = ROOM_W - 18; player.y = clamp(player.y, 18, ROOM_H - 18); }
    if (dir === "E") { player.x = 18; player.y = clamp(player.y, 18, ROOM_H - 18); }

    state.cam.x = clamp(player.x - VIEW_W / 2, 0, Math.max(0, ROOM_W - VIEW_W));
    state.cam.y = clamp(player.y - VIEW_H / 2, 0, Math.max(0, ROOM_H - VIEW_H));
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

  function shake(amount, time) {
    state.cam.shake = Math.max(state.cam.shake, amount);
    state.cam.shakeT = Math.max(state.cam.shakeT, time);
  }

  function shoot() {
    if (player.fireCD > 0) return;

    var w = WEAPONS[player.weapon];
    if (!w.unlocked) return;

    var wx = state.cam.x + mouse.x;
    var wy = state.cam.y + mouse.y;
    var n = norm(wx - player.x, wy - player.y);
    var baseA = Math.atan2(n.y, n.x);

    for (var i = 0; i < w.pellets; i++) {
      var a = baseA + (w.spread * (randf() - 0.5));
      var sp = w.speed * (0.92 + randf() * 0.16);
      spawnBullet(player.x, player.y, Math.cos(a) * sp, Math.sin(a) * sp, w.dmg, "player", "p");
    }

    player.fireCD = w.fire;
    shake(2 + (w.pellets > 1 ? 2 : 0), 0.08);
  }

  function spawnEnemyBullet(x, y, vx, vy, dmg) {
    spawnBullet(x, y, vx, vy, dmg, "enemy", "e");
  }

  // ---------- Damage / FX ----------
  function hurtPlayer(dmg) {
    if (player.invT > 0) return;
    player.hp -= dmg;
    player.invT = 0.6;
    shake(6, 0.16);
    if (player.hp <= 0) {
      player.hp = 0;
      state.msg = "YOU DIED — PRESS R";
      state.msgT = 999;
      state.paused = true;
    }
  }

  // ---------- Pickups ----------
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
      if (w.unlocked) { state.msg = "ALREADY OWNED"; state.msgT = 0.7; return; }
      w.unlocked = true;
      state.coins -= item.cost;
      state.msg = "UNLOCKED: " + w.name;
      state.msgT = 1.0;
      return;
    }

    if (item.type === "heal") {
      if (player.hp >= player.hpMax) { state.msg = "HP FULL"; state.msgT = 0.7; return; }
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

  // ---------- Heal Fountain / Armory interactions ----------
  function nearFountain() {
    var cx = ROOM_W * 0.5;
    var cy = ROOM_H * 0.5;
    return dist2(player.x, player.y, cx, cy) < (44 * 44);
  }

  function useFountain() {
    var node = ensureNode(state.roomId);
    if (node.kind !== "heal") return;
    if (!nearFountain()) { state.msg = "STAND BY THE FOUNTAIN"; state.msgT = 0.8; return; }
    if (node.flags.fountainUsed) { state.msg = "FOUNTAIN DRIED"; state.msgT = 0.9; return; }

    node.flags.fountainUsed = true;
    player.hp = player.hpMax;
    state.msg = "FULL HEAL";
    state.msgT = 1.0;
    shake(2, 0.10);
  }

  function nearArmoryChest() {
    var cx = ROOM_W * 0.5;
    var cy = TILE * 3.5;
    return dist2(player.x, player.y, cx, cy) < (44 * 44);
  }

  function openArmory() {
    var node = ensureNode(state.roomId);
    if (node.kind !== "armory") return;
    if (!nearArmoryChest()) { state.msg = "GET CLOSER"; state.msgT = 0.8; return; }
    if (node.flags.armoryUsed) { state.msg = "EMPTY"; state.msgT = 0.8; return; }

    node.flags.armoryUsed = true;

    // Give a free weapon unlock if any locked remain
    var candidates = [];
    for (var i = 0; i < WEAPONS.length; i++) if (!WEAPONS[i].unlocked) candidates.push(WEAPONS[i]);
    if (candidates.length === 0) {
      // fallback: coins
      state.coins += 10;
      state.msg = "FOUND COINS";
      state.msgT = 1.0;
      return;
    }

    var w = candidates[randi(candidates.length)];
    w.unlocked = true;
    state.msg = "FOUND: " + w.name;
    state.msgT = 1.2;
  }

  // ---------- Update loop ----------
  function update(dt) {
    if (state.paused) {
      if (wasPressed(KEY.ESC)) state.paused = false;
      if (wasPressed(KEY.R)) resetGame();
      return;
    }

    if (wasPressed(KEY.ESC)) {
      if (state.shopOpen) state.shopOpen = false;
      else state.paused = true;
    }
    if (wasPressed(KEY.R)) resetGame();

    if (state.msgT > 0) state.msgT -= dt;
    if (player.invT > 0) player.invT -= dt;
    if (player.fireCD > 0) player.fireCD -= dt;
    if (player.dashT > 0) player.dashT -= dt;
    if (player.dashCD > 0) player.dashCD -= dt;
    if (state.cam.shakeT > 0) { state.cam.shakeT -= dt; state.cam.shake = lerp(state.cam.shake, 0, 10 * dt); }
    else state.cam.shake = 0;

    var node = ensureNode(state.roomId);

    // room interactions (F)
    if (wasPressed(KEY.F)) {
      if (node.kind === "shop") tryOpenShop();
      else if (node.kind === "heal") useFountain();
      else if (node.kind === "armory") openArmory();
    }

    // weapon swaps
    if (wasPressed(KEY.Q) && WEAPONS[0].unlocked) player.weapon = 0;
    if (wasPressed(KEY.E)) {
      // prefer shotgun then rifle
      if (WEAPONS[1].unlocked) player.weapon = 1;
      else if (WEAPONS[2].unlocked) player.weapon = 2;
    }

    // shop overlay purchase
    if (node.kind === "shop" && state.shopOpen) {
      if (wasPressed(KEY.ONE)) buyShopItem(SHOP_ITEMS[0]);
      if (wasPressed(KEY.TWO)) buyShopItem(SHOP_ITEMS[1]);
      if (wasPressed(KEY.THREE)) buyShopItem(SHOP_ITEMS[2]);
      if (wasPressed(KEY.FOUR)) buyShopItem(SHOP_ITEMS[3]);
      // freeze combat sim
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

    // move + door transitions
    var room = ensureRoom(state.roomId);

    var nxp = player.x + player.vx * dt;
    var nyp = player.y + player.vy * dt;

    if (player.vy < 0 && inDoorBand("N", player.x, player.y) && (nyp <= 2)) { if (tryDoorTransitionByIntent("N")) return; }
    if (player.vy > 0 && inDoorBand("S", player.x, player.y) && (nyp >= ROOM_H - 2)) { if (tryDoorTransitionByIntent("S")) return; }
    if (player.vx < 0 && inDoorBand("W", player.x, player.y) && (nxp <= 2)) { if (tryDoorTransitionByIntent("W")) return; }
    if (player.vx > 0 && inDoorBand("E", player.x, player.y) && (nxp >= ROOM_W - 2)) { if (tryDoorTransitionByIntent("E")) return; }

    if (!collideCircle(nxp, player.y, player.r, room)) player.x = nxp; else player.vx = 0;
    if (!collideCircle(player.x, nyp, player.r, room)) player.y = nyp; else player.vy = 0;

    // camera
    var targetX = clamp(player.x - VIEW_W / 2, 0, Math.max(0, ROOM_W - VIEW_W));
    var targetY = clamp(player.y - VIEW_H / 2, 0, Math.max(0, ROOM_H - VIEW_H));
    state.cam.x = lerp(state.cam.x, targetX, 10 * dt);
    state.cam.y = lerp(state.cam.y, targetY, 10 * dt);

    // sim
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
        if (chance(0.30)) state.pickups.push({ x: ROOM_W / 2, y: ROOM_H / 2, t: "coin", v: 3, r: 7 });
        if (chance(0.18)) state.pickups.push({ x: ROOM_W / 2 + 18, y: ROOM_H / 2, t: "heart", v: 1, r: 7 });
      }
    }
  }

  function updateEnemies(dt) {
    var room = ensureRoom(state.roomId);
    var node = ensureNode(state.roomId);
    var depth = node.depth;

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
        var sp2 = 70 + depth * 1.5;
        var desired = 150;
        if (d < desired) { e.vx = -(dx / d) * sp2; e.vy = -(dy / d) * sp2; }
        else { e.vx = (randf() - 0.5) * 30; e.vy = (randf() - 0.5) * 30; }

        if (e.fireCD > 0) e.fireCD -= dt;
        if (e.fireCD <= 0 && d < 340) {
          var n = norm(dx, dy);
          spawnEnemyBullet(e.x, e.y, n.x * (240 + depth * 5), n.y * (240 + depth * 5), 1);
          e.fireCD = 1.0 + randf() * 0.6;
        }
      }

      var nx = e.x + e.vx * dt;
      var ny = e.y + e.vy * dt;
      if (!collideCircle(nx, e.y, e.r, room)) e.x = nx;
      if (!collideCircle(e.x, ny, e.r, room)) e.y = ny;

      if (dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) * (e.r + player.r)) hurtPlayer(1);

      if (e.hp <= 0) {
        // coin drop
        var coins = 1 + randi(2) + ((depth / 4) | 0);
        dropCoins(e.x, e.y, coins);
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

      if (isSolidAtPoint(nx, ny, room)) { state.bullets.splice(i, 1); continue; }

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
        if (p.t === "coin") { state.coins += p.v; state.msg = "+COIN"; state.msgT = 0.35; }
        else if (p.t === "heart") { player.hp = clamp(player.hp + p.v, 0, player.hpMax); state.msg = "+HP"; state.msgT = 0.45; }
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

  // ---------- Render (cleaner pixel look) ----------
  function draw() {
    var room = ensureRoom(state.roomId);
    var node = ensureNode(state.roomId);

    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#07060b";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    var sx = 0, sy = 0;
    if (state.cam.shake > 0 && state.cam.shakeT > 0) {
      sx = (randf() - 0.5) * state.cam.shake * 2;
      sy = (randf() - 0.5) * state.cam.shake * 2;
    }
    var camX = state.cam.x + sx;
    var camY = state.cam.y + sy;

    drawRoom(room, node, camX, camY);
    drawEntities(camX, camY);
    drawHUD(node);
    drawMinimap();

    if (node.kind === "shop") drawShopHint();
    if (node.kind === "heal") drawHealHint(node);
    if (node.kind === "armory") drawArmoryHint(node);

    if (state.shopOpen) drawShopOverlay();
    if (state.paused) drawPause();

    if (WATERMARK_ENABLED && WATERMARK_TEXT && WATERMARK_TEXT !== "YOUR-SITE-OR-GAME-NAME") drawWatermark();
  }

  function drawRoom(room, node, camX, camY) {
    var g = room.g;
    if (!g) return;

    // palette by room
    var floorA = "rgba(255,255,255,0.020)";
    var floorB = "rgba(255,255,255,0.028)";
    var wallA  = "rgba(255,255,255,0.060)";
    var wallB  = "rgba(255,255,255,0.085)";
    var pit    = "rgba(0,0,0,0.62)";
    var deco   = "rgba(124,92,255,0.10)";

    if (node.kind === "shop") { floorA = "rgba(255,255,255,0.030)"; floorB = "rgba(255,255,255,0.040)"; }
    if (node.kind === "heal") { floorA = "rgba(120,255,170,0.020)"; floorB = "rgba(255,255,255,0.034)"; }
    if (node.kind === "armory") { floorA = "rgba(255,215,90,0.016)"; floorB = "rgba(255,255,255,0.034)"; }

    var x, y;
    for (y = 0; y < ROOM_TH; y++) {
      for (x = 0; x < ROOM_TW; x++) {
        var t = g[tileIndex(x, y)];
        var sx = (x * TILE - camX) | 0;
        var sy = (y * TILE - camY) | 0;

        if (sx > VIEW_W || sy > VIEW_H || sx + TILE < 0 || sy + TILE < 0) continue;

        if (t === 0) {
          ctx.fillStyle = ((x + y) & 1) ? wallA : wallB;
          ctx.fillRect(sx, sy, TILE, TILE);
          // bevel highlight
          ctx.fillStyle = "rgba(0,0,0,0.22)";
          ctx.fillRect(sx, sy + TILE - 3, TILE, 3);
          ctx.fillStyle = "rgba(255,255,255,0.05)";
          ctx.fillRect(sx, sy, TILE, 2);
        } else if (t === 2) {
          ctx.fillStyle = pit;
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = "rgba(255,255,255,0.02)";
          ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
        } else {
          ctx.fillStyle = ((x + y) & 1) ? floorA : floorB;
          ctx.fillRect(sx, sy, TILE, TILE);
        }

        if (t === 3) {
          ctx.fillStyle = "rgba(124,92,255,0.14)";
          ctx.fillRect(sx + 6, sy + 6, TILE - 12, TILE - 12);
        } else if (t === 4) {
          // pillar: chunky pixel orb + shadow
          var cx = sx + (TILE >> 1);
          var cy = sy + (TILE >> 1);
          var r = (TILE * 0.28) | 0;

          ctx.fillStyle = "rgba(0,0,0,0.30)";
          ctx.fillRect(cx - r, cy + r, r * 2, r);

          ctx.fillStyle = "rgba(255,255,255,0.07)";
          ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

          ctx.fillStyle = "rgba(124,92,255,0.18)";
          ctx.fillRect(cx - r + 2, cy - r + 2, r, r);
        } else if (t === 5) {
          ctx.fillStyle = deco;
          ctx.fillRect(sx + 8, sy + 8, TILE - 16, TILE - 16);
        }
      }
    }

    drawDoorBars(room, camX, camY);

    if (node.kind === "shop") drawShopSet(camX, camY);
    if (node.kind === "heal") drawFountainSet(node, camX, camY);
    if (node.kind === "armory") drawArmorySet(node, camX, camY);

    drawVignette();
  }

  function drawDoorBars(room, camX, camY) {
    var mx = ROOM_W * 0.5;
    var my = ROOM_H * 0.5;
    var span = DOOR_SPAN;

    ctx.fillStyle = "rgba(255,80,140,0.24)";
    if (room.neighbors.N && !room.doorsOpen.N) ctx.fillRect((mx - span - camX) | 0, (2 - camY) | 0, (span * 2) | 0, 6);
    if (room.neighbors.S && !room.doorsOpen.S) ctx.fillRect((mx - span - camX) | 0, (ROOM_H - 8 - camY) | 0, (span * 2) | 0, 6);
    if (room.neighbors.W && !room.doorsOpen.W) ctx.fillRect((2 - camX) | 0, (my - span - camY) | 0, 6, (span * 2) | 0);
    if (room.neighbors.E && !room.doorsOpen.E) ctx.fillRect((ROOM_W - 8 - camX) | 0, (my - span - camY) | 0, 6, (span * 2) | 0);
  }

  function drawShopSet(camX, camY) {
    var cx = (ROOM_W * 0.5 - camX) | 0;
    var cy = (TILE * 2.5 - camY) | 0;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(cx - 72, cy + 16, 144, 10);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(cx - 72, cy + 2, 144, 16);

    ctx.fillStyle = "rgba(124,92,255,0.75)";
    ctx.fillRect(cx - 6, cy - 8, 12, 12);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(cx - 2, cy - 6, 4, 2);
  }

  function drawFountainSet(node, camX, camY) {
    var cx = (ROOM_W * 0.5 - camX) | 0;
    var cy = (ROOM_H * 0.5 - camY) | 0;

    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.fillRect(cx - 22, cy + 18, 44, 8);

    // basin
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(cx - 24, cy - 12, 48, 24);

    // water (or dried)
    ctx.fillStyle = node.flags.fountainUsed ? "rgba(255,80,140,0.18)" : "rgba(120,255,170,0.22)";
    ctx.fillRect(cx - 18, cy - 6, 36, 12);

    // sparkle
    if (!node.flags.fountainUsed) {
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(cx - 2, cy - 10, 4, 2);
    }
  }

  function drawArmorySet(node, camX, camY) {
    var cx = (ROOM_W * 0.5 - camX) | 0;
    var cy = (TILE * 3.5 - camY) | 0;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(cx - 26, cy + 22, 52, 8);

    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(cx - 28, cy - 10, 56, 28);

    ctx.fillStyle = node.flags.armoryUsed ? "rgba(255,80,140,0.25)" : "rgba(255,215,90,0.25)";
    ctx.fillRect(cx - 20, cy - 2, 40, 12);

    // latch
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.fillRect(cx - 2, cy + 6, 4, 4);
  }

  function drawVignette() {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, VIEW_W, 44);
    ctx.fillRect(0, VIEW_H - 44, VIEW_W, 44);
    ctx.fillRect(0, 0, 44, VIEW_H);
    ctx.fillRect(VIEW_W - 44, 0, 44, VIEW_H);
  }

  function drawEntities(camX, camY) {
    // pickups
    for (var i = 0; i < state.pickups.length; i++) {
      var pk = state.pickups[i];
      var px = (pk.x - camX) | 0, py = (pk.y - camY) | 0;

      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.fillRect(px - pk.r, py + 6, pk.r * 2, 4);

      if (pk.t === "coin") {
        ctx.fillStyle = "rgba(255,215,90,0.95)";
        ctx.fillRect(px - 5, py - 5, 10, 10);
        ctx.fillStyle = "rgba(255,255,255,0.30)";
        ctx.fillRect(px - 2, py - 4, 4, 2);
      } else {
        ctx.fillStyle = "rgba(120,255,170,0.95)";
        ctx.fillRect(px - 5, py - 5, 10, 10);
      }
    }

    // enemies
    for (i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      var ex = (e.x - camX) | 0, ey = (e.y - camY) | 0;

      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(ex - e.r, ey + e.r, e.r * 2, 5);

      // sprite body
      if (e.type === "shooter") ctx.fillStyle = "rgba(140,190,255,0.92)";
      else ctx.fillStyle = "rgba(255,90,170,0.92)";
      ctx.fillRect(ex - e.r, ey - e.r, e.r * 2, e.r * 2);

      // highlight
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(ex - e.r + 2, ey - e.r + 2, e.r, e.r);

      // eye
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(ex + (e.type === "shooter" ? 2 : -4), ey - 2, 3, 3);
    }

    // bullets
    for (i = 0; i < state.bullets.length; i++) {
      var b = state.bullets[i];
      var bx = (b.x - camX) | 0, by = (b.y - camY) | 0;
      ctx.fillStyle = (b.from === "player") ? "rgba(255,255,255,0.9)" : "rgba(255,200,90,0.9)";
      ctx.fillRect(bx - 2, by - 2, 4, 4);
    }

    // player
    var px2 = (player.x - camX) | 0, py2 = (player.y - camY) | 0;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(px2 - player.r, py2 + player.r, player.r * 2, 5);

    ctx.fillStyle = (player.invT > 0) ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.92)";
    ctx.fillRect(px2 - player.r, py2 - player.r, player.r * 2, player.r * 2);

    ctx.fillStyle = "rgba(124,92,255,0.22)";
    ctx.fillRect(px2 - player.r + 2, py2 - player.r + 2, player.r, player.r);

    // reticle
    ctx.strokeStyle = "rgba(124,92,255,0.55)";
    ctx.strokeRect((mouse.x - 8) | 0, (mouse.y - 8) | 0, 16, 16);
  }

  function drawHUD(node) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(14, 12, 360, 74);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("HP", 24, 36);

    for (var i = 0; i < player.hpMax; i++) {
      ctx.fillStyle = (i < player.hp) ? "rgba(120,255,170,0.9)" : "rgba(255,255,255,0.12)";
      ctx.fillRect(56 + i * 16, 24, 12, 12);
    }

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("Coins: " + state.coins, 24, 60);

    var w = WEAPONS[player.weapon];
    ctx.fillText("Weapon: " + w.name + " (Q/E)", 170, 36);

    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText("Room: " + node.kind + "  Depth: " + node.depth + "  [" + state.roomId + "]", 170, 60);

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
      if (n.kind === "shop") c = "rgba(124,92,255,0.35)";
      if (n.kind === "heal") c = "rgba(120,255,170,0.30)";
      if (n.kind === "armory") c = "rgba(255,215,90,0.30)";
      if (n.kind === "start") c = "rgba(255,255,255,0.30)";

      ctx.fillStyle = c;
      ctx.fillRect(rx, ry, size, size);
    }

    var cur = ensureNode(state.roomId);
    var cx = ox + 88 + cur.x * (size + 3);
    var cy = oy + 88 + cur.y * (size + 3);
    ctx.fillStyle = "rgba(255,80,140,0.9)";
    ctx.fillRect(cx - 2, cy - 2, size + 4, size + 4);

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("MAP", ox + 12, oy + 18);
  }

  function drawShopHint() {
    ctx.fillStyle = "rgba(0,0,0,0.40)";
    ctx.fillRect(14, VIEW_H - 56, 440, 40);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("SHOP — press F at the counter. Buy with 1–4.", 24, VIEW_H - 30);
  }

  function drawHealHint(node) {
    ctx.fillStyle = "rgba(0,0,0,0.40)";
    ctx.fillRect(14, VIEW_H - 56, 520, 40);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(node.flags.fountainUsed ? "HEAL ROOM — fountain is used up." : "HEAL ROOM — press F at the fountain for a FREE full heal.", 24, VIEW_H - 30);
  }

  function drawArmoryHint(node) {
    ctx.fillStyle = "rgba(0,0,0,0.40)";
    ctx.fillRect(14, VIEW_H - 56, 560, 40);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(node.flags.armoryUsed ? "ARMORY — chest is empty." : "ARMORY — press F at the chest for a FREE weapon unlock.", 24, VIEW_H - 30);
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
  }

  function drawPause() {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText("PAUSED", 34, 56);
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("ESC: resume   R: restart   Q/E: weapon   SPACE/SHIFT: dash", 34, 84);
  }

  function drawWatermark() {
    var pad = 12;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(VIEW_W - 280, VIEW_H - 44, 268, 32);
    ctx.fillStyle = "rgba(255,255,255,0.70)";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(WATERMARK_TEXT, VIEW_W - 280 + pad, VIEW_H - 22);
  }

  // ---------- Full-window Resize ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;

    // full window
    var w = window.innerWidth;
    var h = window.innerHeight;

    canvas.style.position = "fixed";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";

    canvas.width = (w * dpr) | 0;
    canvas.height = (h * dpr) | 0;

    // Reset transform then scale
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // crisp pixels
    ctx.imageSmoothingEnabled = false;

    VIEW_W = w;
    VIEW_H = h;

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

      document.body.style.margin = "0";
      document.body.style.overflow = "hidden";
      document.body.style.background = "#07060b";

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
