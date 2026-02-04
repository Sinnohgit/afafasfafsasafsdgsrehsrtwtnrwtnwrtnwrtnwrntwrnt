/* n.js — single-file roguelite (ES5-safe)
   - Exposes global create() for loaders expecting it
   - Door transitions trigger ONLY when you CROSS the boundary THROUGH the doorway
   - Only current room simulates; other rooms are cached/restored when revisited
   - Tile=4 obstacles are SMALL pillars (collision + render)
   - Extra goodies: minimap, dash, 2 weapons, pause, screenshake, simple particles
*/

(function () {
  "use strict";

  // ---------- Boot / Entry ----------
  // Many runners look for global create(). Provide it.
  window.create = function () {
    Game.create();
  };

  // ---------- Constants ----------
  var TAU = Math.PI * 2;

  var TILE = 24;
  var ROOM_TW = 21; // tiles wide
  var ROOM_TH = 13; // tiles tall
  var ROOM_W = ROOM_TW * TILE;
  var ROOM_H = ROOM_TH * TILE;

  var VIEW_W = 960;
  var VIEW_H = 540;

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    A: 65, W: 87, D: 68, S: 83,
    SPACE: 32, SHIFT: 16, ESC: 27,
    F: 70, Q: 81, E: 69
  };

  // ---------- Canvas / Context ----------
  var canvas, ctx;
  var lastT = 0;

  // ---------- Input ----------
  var keys = {};
  var keysPressed = {};
  var mouse = { x: 0, y: 0, down: false };

  function onKeyDown(e) {
    if (!keys[e.keyCode]) keysPressed[e.keyCode] = true;
    keys[e.keyCode] = true;
    // prevent page scroll
    if (e.keyCode === KEY.SPACE || e.keyCode === KEY.UP || e.keyCode === KEY.DOWN) e.preventDefault();
  }
  function onKeyUp(e) {
    keys[e.keyCode] = false;
  }
  function onMouseMove(e) {
    var rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
  }
  function onMouseDown() { mouse.down = true; }
  function onMouseUp() { mouse.down = false; }

  function wasPressed(code) {
    return !!keysPressed[code];
  }

  // ---------- RNG ----------
  function randf() { return Math.random(); }
  function randi(n) { return (Math.random() * n) | 0; }
  function chance(p) { return Math.random() < p; }

  // ---------- Math helpers ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function len(x, y) { return Math.sqrt(x * x + y * y); }
  function norm(x, y) { var l = Math.sqrt(x * x + y * y) || 1; return { x: x / l, y: y / l }; }

  // ---------- Room graph helpers ----------
  function roomKey(x, y) { return x + "," + y; }
  function tileIndex(tx, ty) { return ty * ROOM_TW + tx; }

  // ---------- Game State ----------
  var state = {
    running: false,
    paused: false,
    msg: "",
    msgT: 0,
    keys: 0,
    roomId: "0,0",
    cam: { x: 0, y: 0, shake: 0, shakeT: 0 },
    map: {}, // nodes by id
    rooms: {}, // room data by id
    // current-live arrays (ONLY current room simulates)
    enemies: [],
    bullets: [],
    pickups: [],
    fx: [],
    decals: []
  };

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
    speed: 140,
    weapon: 0, // 0 pistol, 1 shotgun
    fireCD: 0
  };

  // ---------- Room Node / Room Data ----------
  function ensureNode(id) {
    if (!state.map[id]) {
      state.map[id] = {
        id: id,
        x: parseInt(id.split(",")[0], 10),
        y: parseInt(id.split(",")[1], 10),
        kind: "combat", // start as combat
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
        g: null, // tiles
        doorsOpen: { N: true, S: true, W: true, E: true },
        neighbors: { N: false, S: false, W: false, E: false },
        __cache: null
      };
    }
    return state.rooms[id];
  }

  function getRoom(id) { return state.rooms[id] || null; }

  // ---------- Tile generation ----------
  // Tile meanings:
  // 0 wall
  // 1 floor
  // 2 pit
  // 3 door marker (visual only)
  // 4 small pillar obstacle
  function genRoomTiles(kind, node) {
    var room = ensureRoom(node.id);
    var g = new Array(ROOM_TW * ROOM_TH);
    var x, y;

    // Fill with walls
    for (y = 0; y < ROOM_TH; y++) {
      for (x = 0; x < ROOM_TW; x++) {
        var edge = (x === 0 || y === 0 || x === ROOM_TW - 1 || y === ROOM_TH - 1);
        g[tileIndex(x, y)] = edge ? 0 : 1;
      }
    }

    // Add some pits (combat rooms only)
    if (kind === "combat") {
      for (var i = 0; i < 30; i++) {
        var px = 2 + randi(ROOM_TW - 4);
        var py = 2 + randi(ROOM_TH - 4);
        if (chance(0.25)) g[tileIndex(px, py)] = 2;
      }
    }

    // Add small pillars (tile 4), a bit less frequent
    var density = (kind === "combat") ? 0.06 : 0.03;
    for (y = 2; y < ROOM_TH - 2; y++) {
      for (x = 2; x < ROOM_TW - 2; x++) {
        if (g[tileIndex(x, y)] !== 1) continue;
        if (chance(density)) g[tileIndex(x, y)] = 4;
      }
    }

    // Clear spawn area
    for (y = (ROOM_TH / 2 - 1) | 0; y <= (ROOM_TH / 2 + 1) | 0; y++) {
      for (x = (ROOM_TW / 2 - 1) | 0; x <= (ROOM_TW / 2 + 1) | 0; x++) {
        g[tileIndex(x, y)] = 1;
      }
    }

    // Doors carved at middle of each edge if neighbor exists
    // Door "opening" will be floor (1) in the wall boundary line.
    // We also drop some door marker (3) just inside for visuals.
    function carveDoor(dir) {
      var mx = (ROOM_TW / 2) | 0;
      var my = (ROOM_TH / 2) | 0;
      if (dir === "N") {
        g[tileIndex(mx, 0)] = 1;
        g[tileIndex(mx, 1)] = 3;
      } else if (dir === "S") {
        g[tileIndex(mx, ROOM_TH - 1)] = 1;
        g[tileIndex(mx, ROOM_TH - 2)] = 3;
      } else if (dir === "W") {
        g[tileIndex(0, my)] = 1;
        g[tileIndex(1, my)] = 3;
      } else {
        g[tileIndex(ROOM_TW - 1, my)] = 1;
        g[tileIndex(ROOM_TW - 2, my)] = 3;
      }
    }

    if (room.neighbors.N) carveDoor("N");
    if (room.neighbors.S) carveDoor("S");
    if (room.neighbors.W) carveDoor("W");
    if (room.neighbors.E) carveDoor("E");

    room.g = g;
    return room;
  }

  // ---------- World collision (small pillars!) ----------
  function isSolidAtPoint(wx, wy, room) {
    var tx = (wx / TILE) | 0;
    var ty = (wy / TILE) | 0;
    if (tx < 0 || ty < 0 || tx >= ROOM_TW || ty >= ROOM_TH) return true;

    var t = room.g[tileIndex(tx, ty)];
    if (t === 0 || t === 2) return true; // wall/pit are solid

    if (t === 4) {
      // Small pillar circle inside tile
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

  // ---------- Content spawning ----------
  function spawnRoomContents(roomId) {
    var node = ensureNode(roomId);
    var room = ensureRoom(roomId);

    // Decide kind for some rooms (simple variety)
    // Start is safe; far rooms more likely treasure/boss.
    if (roomId === "0,0") node.kind = "start";
    else {
      var d = Math.abs(node.x) + Math.abs(node.y);
      if (!node.kind || node.kind === "combat") {
        if (d >= 4 && chance(0.10)) node.kind = "treasure";
        else if (d >= 6 && chance(0.06)) node.kind = "boss";
        else node.kind = "combat";
      }
    }

    // Lock treasure occasionally
    if (node.kind === "treasure" && !node.cleared) node.locked = chance(0.45);

    // Fresh arrays for live room
    state.enemies.length = 0;
    state.bullets.length = 0;
    state.pickups.length = 0;
    state.fx.length = 0;
    state.decals.length = 0;

    // Spawn pickups/enemies by kind
    if (node.kind === "start") {
      // little starter pickup
      state.pickups.push({ x: ROOM_W / 2 + 40, y: ROOM_H / 2, t: "heart", v: 1, r: 7 });
      node.cleared = true;
    } else if (node.kind === "treasure") {
      // single big reward
      state.pickups.push({ x: ROOM_W / 2, y: ROOM_H / 2, t: "key", v: 1, r: 7 });
      state.pickups.push({ x: ROOM_W / 2 + 28, y: ROOM_H / 2, t: "heart", v: 2, r: 7 });
      node.cleared = true;
    } else if (node.kind === "boss") {
      if (!node.cleared) {
        spawnEnemy("boss", ROOM_W / 2, ROOM_H / 2 - 50);
        lockDoors(room, true);
      }
    } else {
      if (!node.cleared) {
        var n = 4 + randi(4);
        for (var i = 0; i < n; i++) {
          var px = 60 + randf() * (ROOM_W - 120);
          var py = 60 + randf() * (ROOM_H - 120);
          spawnEnemy(chance(0.25) ? "shooter" : "chaser", px, py);
        }
        lockDoors(room, true);
      }
    }
  }

  function lockDoors(room, locked) {
    // In combat/boss rooms, doors close until cleared.
    room.doorsOpen.N = !locked;
    room.doorsOpen.S = !locked;
    room.doorsOpen.W = !locked;
    room.doorsOpen.E = !locked;
  }

  // ---------- Enemy spawn ----------
  function spawnEnemy(type, x, y) {
    var e = {
      type: type,
      x: x, y: y,
      r: (type === "boss") ? 18 : 10,
      hp: (type === "boss") ? 30 : (type === "shooter" ? 6 : 5),
      vx: 0, vy: 0,
      t: 0,
      fireCD: 0
    };
    state.enemies.push(e);
  }

  // ---------- Room graph generation (simple expanding) ----------
  function buildNeighborsAround(id) {
    var node = ensureNode(id);
    var room = ensureRoom(id);

    // Ensure neighbors exist probabilistically (but stable once created)
    // Expand a few rooms out; keep bounded.
    var max = 8;
    var x = node.x, y = node.y;

    function maybeMake(nx, ny, dirA, dirB, p) {
      if (Math.abs(nx) + Math.abs(ny) > max) return;
      if (!room.neighbors[dirA]) {
        if (chance(p) || id === "0,0") {
          room.neighbors[dirA] = true;
          var nid = roomKey(nx, ny);
          ensureNode(nid);
          var r2 = ensureRoom(nid);
          r2.neighbors[dirB] = true;
        }
      }
    }

    // Bias to create at least some branching near start
    var baseP = (id === "0,0") ? 0.9 : 0.55;
    maybeMake(x, y - 1, "N", "S", baseP);
    maybeMake(x, y + 1, "S", "N", baseP);
    maybeMake(x - 1, y, "W", "E", baseP);
    maybeMake(x + 1, y, "E", "W", baseP);

    // Make sure tiles exist / doors carved
    genRoomTiles(node.kind, node);
  }

  // ---------- Room caching ----------
  function stashRoom(roomId) {
    var r = getRoom(roomId);
    if (!r) return;
    r.__cache = {
      enemies: cloneArray(state.enemies),
      pickups: cloneArray(state.pickups),
      decals: cloneArray(state.decals)
      // intentionally not caching bullets/fx to avoid cross-room clutter
    };
  }

  function loadRoom(roomId) {
    var r = ensureRoom(roomId);
    var node = ensureNode(roomId);

    // Ensure neighbors & tiles exist
    buildNeighborsAround(roomId);
    genRoomTiles(node.kind, node);

    // Clear live arrays
    state.enemies.length = 0;
    state.bullets.length = 0;
    state.pickups.length = 0;
    state.fx.length = 0;
    state.decals.length = 0;

    // Restore cache OR spawn fresh
    if (r.__cache) {
      state.enemies = cloneArray(r.__cache.enemies);
      state.pickups = cloneArray(r.__cache.pickups);
      state.decals = cloneArray(r.__cache.decals);
      // Re-attach to state object (since we replaced arrays)
      // Keep references consistent:
      // (Some code assumes state.enemies etc are the live arrays.)
      // So ensure they're arrays and used directly below.
    } else {
      spawnRoomContents(roomId);
    }

    // If room is combat/boss and not cleared, lock doors
    if (!node.cleared && (node.kind === "combat" || node.kind === "boss")) {
      lockDoors(r, true);
    } else {
      lockDoors(r, false);
    }

    node.seen = true;
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

  // ---------- Door transition (cross boundary through doorway) ----------
  function tryDoorTransition() {
    var node = getRoomNode(state.roomId);
    if (!node) return;
    var room = ensureRoom(state.roomId);

    // Door opening spans
    var doorSpan = 22;
    var inTopDoor = Math.abs(player.x - ROOM_W * 0.5) < doorSpan;
    var inBotDoor = inTopDoor;
    var inLeftDoor = Math.abs(player.y - ROOM_H * 0.5) < doorSpan;
    var inRightDoor = inLeftDoor;

    // Must cross boundary
    var crossTop = (player.y < 0) && inTopDoor;
    var crossBot = (player.y > ROOM_H) && inBotDoor;
    var crossLeft = (player.x < 0) && inLeftDoor;
    var crossRight = (player.x > ROOM_W) && inRightDoor;

    function canGo(dir) {
      if (!room.neighbors[dir]) return false;
      if (!room.doorsOpen[dir]) return false;
      return true;
    }

    function bounceInside(dir) {
      if (dir === "N") player.y = 2;
      if (dir === "S") player.y = ROOM_H - 2;
      if (dir === "W") player.x = 2;
      if (dir === "E") player.x = ROOM_W - 2;
    }

    function go(dx, dy, dirFrom) {
      var nx = node.x + dx, ny = node.y + dy;
      var nid = roomKey(nx, ny);
      var nextNode = ensureNode(nid);
      ensureRoom(nid);

      var dir = dirFrom;

      if (!canGo(dir)) {
        bounceInside(dir);
        return;
      }

      // Treasure lock check on entry
      if (nextNode.kind === "treasure" && nextNode.locked && !nextNode.cleared) {
        if (state.keys <= 0) {
          state.msg = "TREASURE LOCKED — NEED KEY";
          state.msgT = 1.2;
          bounceInside(dir);
          return;
        }
        state.keys -= 1;
        nextNode.locked = false;
        state.msg = "LOCK UNSEALED";
        state.msgT = 1.0;
      }

      // Stash current
      stashRoom(state.roomId);

      // Switch
      state.roomId = nid;
      loadRoom(state.roomId);

      // Place player inside new room opposite side
      if (dirFrom === "N") { player.y = ROOM_H - 14; player.x = clamp(player.x, 14, ROOM_W - 14); }
      if (dirFrom === "S") { player.y = 14; player.x = clamp(player.x, 14, ROOM_W - 14); }
      if (dirFrom === "W") { player.x = ROOM_W - 14; player.y = clamp(player.y, 14, ROOM_H - 14); }
      if (dirFrom === "E") { player.x = 14; player.y = clamp(player.y, 14, ROOM_H - 14); }

      // Snap camera
      state.cam.x = clamp(player.x - VIEW_W / 2, 0, ROOM_W - VIEW_W);
      state.cam.y = clamp(player.y - VIEW_H / 2, 0, ROOM_H - VIEW_H);
      state.cam.shake = 0;
      state.cam.shakeT = 0;
    }

    if (crossTop) go(0, -1, "N");
    else if (crossBot) go(0, 1, "S");
    else if (crossLeft) go(-1, 0, "W");
    else if (crossRight) go(1, 0, "E");
  }

  // ---------- Shooting ----------
  function shoot() {
    if (player.fireCD > 0) return;
    var room = ensureRoom(state.roomId);

    // Aim: mouse in screen -> world
    var wx = state.cam.x + mouse.x;
    var wy = state.cam.y + mouse.y;
    var dx = wx - player.x;
    var dy = wy - player.y;
    var n = norm(dx, dy);

    if (player.weapon === 0) {
      // pistol
      spawnBullet(player.x, player.y, n.x * 420, n.y * 420, 2, "p");
      player.fireCD = 0.18;
      shake(2, 0.08);
    } else {
      // shotgun
      for (var i = 0; i < 5; i++) {
        var a = Math.atan2(n.y, n.x) + (randf() - 0.5) * 0.35;
        spawnBullet(player.x, player.y, Math.cos(a) * 380, Math.sin(a) * 380, 1, "s");
      }
      player.fireCD = 0.55;
      shake(4, 0.10);
    }

    // muzzle puff
    for (var k = 0; k < 6; k++) {
      state.fx.push({ x: player.x, y: player.y, vx: (randf() - 0.5) * 120, vy: (randf() - 0.5) * 120, t: 0.22 });
    }
  }

  function spawnBullet(x, y, vx, vy, dmg, kind) {
    state.bullets.push({
      x: x, y: y,
      vx: vx, vy: vy,
      r: 3,
      t: 1.1,
      dmg: dmg,
      kind: kind,
      from: "player"
    });
  }

  function spawnEnemyBullet(x, y, vx, vy, dmg) {
    state.bullets.push({
      x: x, y: y,
      vx: vx, vy: vy,
      r: 3,
      t: 1.6,
      dmg: dmg,
      kind: "e",
      from: "enemy"
    });
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
    for (var i = 0; i < 14; i++) {
      state.fx.push({ x: player.x, y: player.y, vx: (randf() - 0.5) * 220, vy: (randf() - 0.5) * 220, t: 0.4 });
    }
    if (player.hp <= 0) {
      player.hp = 0;
      state.msg = "YOU DIED — PRESS R TO RESTART";
      state.msgT = 999;
      state.paused = true;
    }
  }

  // ---------- Update loop ----------
  function update(dt) {
    if (state.paused) {
      // allow toggles while paused
      if (wasPressed(KEY.ESC)) state.paused = false;
      if (wasPressed(KEY.F)) toggleFullscreen();
      // restart
      if (keys[82]) resetGame(); // R
      return;
    }

    if (wasPressed(KEY.ESC)) state.paused = true;
    if (wasPressed(KEY.F)) toggleFullscreen();
    if (wasPressed(KEY.Q)) player.weapon = 0;
    if (wasPressed(KEY.E)) player.weapon = 1;

    // timers
    if (state.msgT > 0) state.msgT -= dt;
    if (player.invT > 0) player.invT -= dt;
    if (player.fireCD > 0) player.fireCD -= dt;
    if (player.dashT > 0) player.dashT -= dt;
    if (player.dashCD > 0) player.dashCD -= dt;

    // Dash
    if ((wasPressed(KEY.SPACE) || wasPressed(KEY.SHIFT)) && player.dashCD <= 0) {
      var mx = 0, my = 0;
      if (keys[KEY.A] || keys[KEY.LEFT]) mx -= 1;
      if (keys[KEY.D] || keys[KEY.RIGHT]) mx += 1;
      if (keys[KEY.W] || keys[KEY.UP]) my -= 1;
      if (keys[KEY.S] || keys[KEY.DOWN]) my += 1;

      // If no move input, dash toward aim
      if (mx === 0 && my === 0) {
        var wx = state.cam.x + mouse.x, wy = state.cam.y + mouse.y;
        var dn = norm(wx - player.x, wy - player.y);
        mx = dn.x; my = dn.y;
      } else {
        var dn2 = norm(mx, my);
        mx = dn2.x; my = dn2.y;
      }

      player.dashT = 0.12;
      player.dashCD = 0.75;
      player.vx = mx * 620;
      player.vy = my * 620;
      shake(3, 0.08);
    }

    // Movement input (ignored while dashing)
    var ax = 0, ay = 0;
    if (player.dashT <= 0) {
      if (keys[KEY.A] || keys[KEY.LEFT]) ax -= 1;
      if (keys[KEY.D] || keys[KEY.RIGHT]) ax += 1;
      if (keys[KEY.W] || keys[KEY.UP]) ay -= 1;
      if (keys[KEY.S] || keys[KEY.DOWN]) ay += 1;
      var sp = player.speed;

      // mild sprint modifier
      if (keys[KEY.SHIFT]) sp *= 1.25;

      if (ax !== 0 || ay !== 0) {
        var nn = norm(ax, ay);
        player.vx = nn.x * sp;
        player.vy = nn.y * sp;
      } else {
        // friction
        player.vx = lerp(player.vx, 0, 10 * dt);
        player.vy = lerp(player.vy, 0, 10 * dt);
      }
    } else {
      // dash friction
      player.vx = lerp(player.vx, 0, 4 * dt);
      player.vy = lerp(player.vy, 0, 4 * dt);
    }

    // Shoot
    if (mouse.down) shoot();

    // Move with collision
    var room = ensureRoom(state.roomId);
    var nxp = player.x + player.vx * dt;
    var nyp = player.y + player.vy * dt;

    // try x
    if (!collideCircle(nxp, player.y, player.r, room)) player.x = nxp;
    else player.vx = 0;
    // try y
    if (!collideCircle(player.x, nyp, player.r, room)) player.y = nyp;
    else player.vy = 0;

    // Door transition check AFTER movement
    tryDoorTransition();

    // Camera follow
    var targetX = clamp(player.x - VIEW_W / 2, 0, ROOM_W - VIEW_W);
    var targetY = clamp(player.y - VIEW_H / 2, 0, ROOM_H - VIEW_H);
    state.cam.x = lerp(state.cam.x, targetX, 10 * dt);
    state.cam.y = lerp(state.cam.y, targetY, 10 * dt);

    // Shake
    if (state.cam.shakeT > 0) {
      state.cam.shakeT -= dt;
      state.cam.shake = lerp(state.cam.shake, 0, 8 * dt);
    } else {
      state.cam.shake = 0;
    }

    // Update enemies
    updateEnemies(dt);

    // Update bullets
    updateBullets(dt);

    // Update pickups
    updatePickups(dt);

    // Update particles
    for (var i = state.fx.length - 1; i >= 0; i--) {
      var p = state.fx[i];
      p.t -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.001, dt);
      p.vy *= Math.pow(0.001, dt);
      if (p.t <= 0) state.fx.splice(i, 1);
    }

    // Clear room check
    var node = ensureNode(state.roomId);
    if (!node.cleared && (node.kind === "combat" || node.kind === "boss")) {
      if (state.enemies.length === 0) {
        node.cleared = true;
        lockDoors(room, false);
        state.msg = "ROOM CLEARED";
        state.msgT = 0.9;
        // drop a key sometimes
        if (chance(0.25)) state.pickups.push({ x: ROOM_W / 2, y: ROOM_H / 2, t: "key", v: 1, r: 7 });
      }
    }
  }

  function updateEnemies(dt) {
    var room = ensureRoom(state.roomId);
    for (var i = state.enemies.length - 1; i >= 0; i--) {
      var e = state.enemies[i];
      e.t += dt;

      // basic AI
      var dx = player.x - e.x;
      var dy = player.y - e.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;

      if (e.type === "chaser") {
        var sp = 85;
        e.vx = (dx / d) * sp;
        e.vy = (dy / d) * sp;
      } else if (e.type === "shooter") {
        // keep distance + shoot
        var sp2 = 70;
        var desired = 150;
        if (d < desired) {
          e.vx = -(dx / d) * sp2;
          e.vy = -(dy / d) * sp2;
        } else {
          e.vx = (randf() - 0.5) * 30;
          e.vy = (randf() - 0.5) * 30;
        }

        if (e.fireCD > 0) e.fireCD -= dt;
        if (e.fireCD <= 0 && d < 320) {
          var n = norm(dx, dy);
          spawnEnemyBullet(e.x, e.y, n.x * 240, n.y * 240, 1);
          e.fireCD = 1.1 + randf() * 0.6;
        }
      } else if (e.type === "boss") {
        // simple boss: slow drift + bursts
        var spB = 55;
        e.vx = (dx / d) * spB;
        e.vy = (dy / d) * spB;

        if (e.fireCD > 0) e.fireCD -= dt;
        if (e.fireCD <= 0) {
          // radial burst
          for (var k = 0; k < 10; k++) {
            var a = (k / 10) * TAU;
            spawnEnemyBullet(e.x, e.y, Math.cos(a) * 210, Math.sin(a) * 210, 1);
          }
          e.fireCD = 2.2;
          shake(5, 0.14);
        }
      }

      // move with collision
      var nx = e.x + e.vx * dt;
      var ny = e.y + e.vy * dt;
      if (!collideCircle(nx, e.y, e.r, room)) e.x = nx;
      if (!collideCircle(e.x, ny, e.r, room)) e.y = ny;

      // touch damage
      if (dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) * (e.r + player.r)) {
        hurtPlayer(1);
      }

      // death
      if (e.hp <= 0) {
        // decals
        state.decals.push({ x: e.x, y: e.y, r: e.r + 6, t: 999 });
        // particles
        for (var j = 0; j < 18; j++) {
          state.fx.push({ x: e.x, y: e.y, vx: (randf() - 0.5) * 260, vy: (randf() - 0.5) * 260, t: 0.55 });
        }
        // loot chance
        if (chance(0.18)) state.pickups.push({ x: e.x, y: e.y, t: "heart", v: 1, r: 7 });
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

      // collision with world (small pillars too)
      if (isSolidAtPoint(nx, ny, room)) {
        // impact puff
        for (var k = 0; k < 5; k++) {
          state.fx.push({ x: nx, y: ny, vx: (randf() - 0.5) * 140, vy: (randf() - 0.5) * 140, t: 0.18 });
        }
        state.bullets.splice(i, 1);
        continue;
      }

      b.x = nx; b.y = ny;

      // hit enemies / player
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
      if (dist2(p.x, p.y, player.x, player.y) < (p.r + player.r + 4) * (p.r + player.r + 4)) {
        if (p.t === "key") {
          state.keys += p.v;
          state.msg = "+KEY";
          state.msgT = 0.7;
        } else if (p.t === "heart") {
          player.hp = clamp(player.hp + p.v, 0, player.hpMax);
          state.msg = "+HEALTH";
          state.msgT = 0.7;
        }
        // little burst
        for (var k = 0; k < 10; k++) {
          state.fx.push({ x: p.x, y: p.y, vx: (randf() - 0.5) * 180, vy: (randf() - 0.5) * 180, t: 0.3 });
        }
        state.pickups.splice(i, 1);
      }
    }
  }

  // ---------- Render ----------
  function draw() {
    var room = ensureRoom(state.roomId);
    var node = ensureNode(state.roomId);

    // clear
    ctx.fillStyle = "#09070d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // camera shake offset
    var sx = 0, sy = 0;
    if (state.cam.shake > 0 && state.cam.shakeT > 0) {
      sx = (randf() - 0.5) * state.cam.shake * 2;
      sy = (randf() - 0.5) * state.cam.shake * 2;
    }

    var camX = state.cam.x + sx;
    var camY = state.cam.y + sy;

    // draw tiles
    drawRoom(room, camX, camY);

    // decals
    for (var i = 0; i < state.decals.length; i++) {
      var d = state.decals[i];
      var dx = d.x - camX, dy = d.y - camY;
      ctx.fillStyle = "rgba(255,70,110,0.10)";
      ctx.beginPath();
      ctx.arc(dx, dy, d.r, 0, TAU);
      ctx.fill();
    }

    // pickups
    for (i = 0; i < state.pickups.length; i++) {
      var p = state.pickups[i];
      var px = p.x - camX, py = p.y - camY;
      if (p.t === "key") ctx.fillStyle = "rgba(255,215,80,0.95)";
      else ctx.fillStyle = "rgba(120,255,170,0.95)";
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, TAU);
      ctx.fill();
    }

    // enemies
    for (i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      var ex = e.x - camX, ey = e.y - camY;

      ctx.fillStyle = (e.type === "boss") ? "rgba(255,120,60,0.95)" :
                      (e.type === "shooter") ? "rgba(140,180,255,0.9)" :
                      "rgba(255,90,160,0.9)";
      ctx.beginPath();
      ctx.arc(ex, ey, e.r, 0, TAU);
      ctx.fill();

      // HP bar
      var w = e.r * 2;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(ex - w / 2, ey - e.r - 10, w, 4);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(ex - w / 2, ey - e.r - 10, w * clamp(e.hp / ((e.type === "boss") ? 30 : 6), 0, 1), 4);
    }

    // bullets
    for (i = 0; i < state.bullets.length; i++) {
      var b = state.bullets[i];
      var bx = b.x - camX, by = b.y - camY;
      ctx.fillStyle = (b.from === "player") ? "rgba(255,255,255,0.9)" : "rgba(255,210,90,0.9)";
      ctx.beginPath();
      ctx.arc(bx, by, b.r, 0, TAU);
      ctx.fill();
    }

    // particles
    for (i = 0; i < state.fx.length; i++) {
      var fx = state.fx[i];
      var fxX = fx.x - camX, fxY = fx.y - camY;
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(fxX, fxY, 2, 2);
    }

    // player
    var px2 = player.x - camX, py2 = player.y - camY;
    ctx.fillStyle = (player.invT > 0) ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(px2, py2, player.r, 0, TAU);
    ctx.fill();

    // HUD
    drawHUD(node);

    // Minimap
    drawMinimap();

    // pause overlay
    if (state.paused) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "24px system-ui, sans-serif";
      ctx.fillText("PAUSED", 24, 50);
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("ESC: resume   F: fullscreen   Q/E: weapons   R: restart", 24, 78);
    }
  }

  function drawRoom(room, camX, camY) {
    var g = room.g;
    if (!g) return;

    var x, y;
    for (y = 0; y < ROOM_TH; y++) {
      for (x = 0; x < ROOM_TW; x++) {
        var t = g[tileIndex(x, y)];
        var sx = x * TILE - camX;
        var sy = y * TILE - camY;

        // skip offscreen quickly
        if (sx > canvas.width || sy > canvas.height || sx + TILE < 0 || sy + TILE < 0) continue;

        if (t === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(sx, sy, TILE, TILE);
        } else if (t === 2) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(sx, sy, TILE, TILE);
        } else {
          // floor
          ctx.fillStyle = "rgba(255,255,255,0.02)";
          ctx.fillRect(sx, sy, TILE, TILE);
        }

        if (t === 3) {
          // door marker glow
          ctx.fillStyle = "rgba(124,92,255,0.18)";
          ctx.fillRect(sx + 6, sy + 6, TILE - 12, TILE - 12);
        } else if (t === 4) {
          // SMALL pillar obstacle (match collision)
          var cx = sx + TILE * 0.5;
          var cy = sy + TILE * 0.5;
          var r = TILE * 0.28;

          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect((cx - r) | 0, (cy - r) | 0, (r * 2) | 0, (r * 2) | 0);

          ctx.fillStyle = "rgba(124,92,255,0.22)";
          ctx.fillRect((cx - r * 0.65) | 0, (cy - r * 0.65) | 0, (r * 1.3) | 0, (r * 1.3) | 0);
        }
      }
    }

    // Draw door “closed bars” if doorsOpen false
    drawDoorBars(room, camX, camY);
  }

  function drawDoorBars(room, camX, camY) {
    var mx = ROOM_W * 0.5;
    var my = ROOM_H * 0.5;
    var span = 26;

    ctx.fillStyle = "rgba(255,80,140,0.22)";

    // top
    if (room.neighbors.N && !room.doorsOpen.N) {
      var x0 = mx - span - camX;
      var y0 = 2 - camY;
      ctx.fillRect(x0, y0, span * 2, 6);
    }
    // bottom
    if (room.neighbors.S && !room.doorsOpen.S) {
      x0 = mx - span - camX;
      y0 = ROOM_H - 8 - camY;
      ctx.fillRect(x0, y0, span * 2, 6);
    }
    // left
    if (room.neighbors.W && !room.doorsOpen.W) {
      x0 = 2 - camX;
      y0 = my - span - camY;
      ctx.fillRect(x0, y0, 6, span * 2);
    }
    // right
    if (room.neighbors.E && !room.doorsOpen.E) {
      x0 = ROOM_W - 8 - camX;
      y0 = my - span - camY;
      ctx.fillRect(x0, y0, 6, span * 2);
    }
  }

  function drawHUD(node) {
    // top-left HUD
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(14, 12, 250, 66);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("HP", 24, 36);

    // hearts bar
    var i;
    for (i = 0; i < player.hpMax; i++) {
      ctx.fillStyle = (i < player.hp) ? "rgba(120,255,170,0.9)" : "rgba(255,255,255,0.12)";
      ctx.fillRect(56 + i * 16, 24, 12, 12);
    }

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("Keys: " + state.keys, 24, 60);
    ctx.fillText("Room: " + node.kind + " (" + state.roomId + ")", 120, 60);

    // weapon
    var wname = player.weapon === 0 ? "Pistol (Q)" : "Shotgun (E)";
    ctx.fillText("Weapon: " + wname, 120, 36);

    // message
    if (state.msgT > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillText(state.msg, 14, canvas.height - 20);
    }
  }

  // ---------- Minimap ----------
  function drawMinimap() {
    var size = 8;
    var pad = 14;
    var ox = canvas.width - 180;
    var oy = 14;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(ox, oy, 166, 166);

    var id;
    for (id in state.map) if (state.map.hasOwnProperty(id)) {
      var n = state.map[id];
      if (!n.seen) continue;
      var rx = ox + 83 + n.x * (size + 3);
      var ry = oy + 83 + n.y * (size + 3);

      var c = "rgba(255,255,255,0.22)";
      if (n.kind === "treasure") c = "rgba(255,215,80,0.35)";
      if (n.kind === "boss") c = "rgba(255,120,60,0.35)";
      if (n.kind === "start") c = "rgba(120,255,170,0.30)";
      if (n.cleared) c = "rgba(255,255,255,0.35)";

      ctx.fillStyle = c;
      ctx.fillRect(rx, ry, size, size);
    }

    // current room marker
    var cur = ensureNode(state.roomId);
    var cx = ox + 83 + cur.x * (size + 3);
    var cy = oy + 83 + cur.y * (size + 3);
    ctx.fillStyle = "rgba(124,92,255,0.9)";
    ctx.fillRect(cx - 2, cy - 2, size + 4, size + 4);

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("MAP", ox + pad, oy + 18);
  }

  // ---------- Fullscreen ----------
  function toggleFullscreen() {
    var d = document;
    if (!d.fullscreenElement) {
      if (canvas.requestFullscreen) canvas.requestFullscreen();
    } else {
      if (d.exitFullscreen) d.exitFullscreen();
    }
  }

  // ---------- Reset ----------
  function resetGame() {
    state.msg = "";
    state.msgT = 0;
    state.keys = 0;
    state.roomId = "0,0";
    state.map = {};
    state.rooms = {};
    state.enemies = [];
    state.bullets = [];
    state.pickups = [];
    state.fx = [];
    state.decals = [];
    state.paused = false;

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

    state.cam.x = clamp(player.x - VIEW_W / 2, 0, ROOM_W - VIEW_W);
    state.cam.y = clamp(player.y - VIEW_H / 2, 0, ROOM_H - VIEW_H);
  }

  // ---------- Main loop ----------
  function frame(t) {
    if (!state.running) return;
    var now = t || 0;
    var dt = (now - lastT) / 1000;
    lastT = now;
    dt = clamp(dt, 0, 1 / 30); // clamp big steps

    // Clear "pressed" flags each frame
    keysPressed = {};

    update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // ---------- Game object ----------
  var Game = {
    create: function () {
      // Create canvas if not present
      canvas = document.getElementById("game");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "game";
        document.body.style.margin = "0";
        document.body.style.background = "#07060b";
        document.body.appendChild(canvas);
      }

      canvas.width = VIEW_W;
      canvas.height = VIEW_H;
      ctx = canvas.getContext("2d");

      // Input hooks
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      canvas.addEventListener("mousemove", onMouseMove);
      canvas.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mouseup", onMouseUp);

      // Start
      resetGame();
      state.running = true;
      lastT = performance.now ? performance.now() : 0;
      requestAnimationFrame(frame);
    }
  };

})();
