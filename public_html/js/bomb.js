(() => {
    'use strict';

    const COLS = 13, ROWS = 11, T = 60;
    const EMPTY = 0, WALL = 1, BRICK = 2;
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const FUSE = 2.4, BLAST = 0.5;

    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const $ = id => document.getElementById(id);
    const overlay = $('overlay');

    let grid, bombs, flames, items, enemies, player, exit, particles = [];
    let level = 1, lives = 3, score = 0, state = 'menu', stateTimer = 0;
    let timeLeft = 0, shake = 0, hurryUp = false;
    const STAGE_TIME = 180;
    const held = [];
    const store = {
        get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    };
    let best = +store.get('nqbomb.best', 0);
    let muted = store.get('nqbomb.muted', '0') === '1';

    // ---------- sound (synthesised, no assets) ----------
    let actx;
    function tone(freq, dur, type = 'square', vol = 0.15, slide = 0) {
        if (muted) return;
        try {
            actx = actx || new (window.AudioContext || window.webkitAudioContext)();
            const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
            o.type = type; o.frequency.setValueAtTime(freq, t);
            if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
            g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
        } catch { /* audio unavailable */ }
    }
    function noise(dur, vol = 0.3) {
        if (muted) return;
        try {
            actx = actx || new (window.AudioContext || window.webkitAudioContext)();
            const len = actx.sampleRate * dur, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
            const s = actx.createBufferSource(), g = actx.createGain();
            s.buffer = buf; g.gain.value = vol; s.connect(g).connect(actx.destination); s.start();
        } catch { /* audio unavailable */ }
    }
    const sfx = {
        place: () => tone(220, 0.08, 'square', 0.1),
        boom: () => { noise(0.45, 0.35); tone(90, 0.4, 'sine', 0.3, -60); },
        pickup: () => { tone(660, 0.08); setTimeout(() => tone(990, 0.12), 70); },
        kill: () => tone(500, 0.2, 'sawtooth', 0.1, -400),
        die: () => tone(400, 0.9, 'triangle', 0.2, -350),
        clear: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'square', 0.12), i * 110)),
        hurry: () => [880, 660, 880, 660].forEach((f, i) => setTimeout(() => tone(f, 0.1), i * 120)),
    };

    function burst(x, y, color, n = 8, spd = 4) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * spd;
            particles.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.6 + Math.random() * 0.4, color });
        }
    }

    // ---------- helpers ----------
    const key = (x, y) => y * COLS + x;
    const inside = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
    const bombAt = (x, y) => bombs.find(b => b.x === x && b.y === y);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

    function walkable(x, y, forEnemy, ghost) {
        if (!inside(x, y)) return false;
        const cell = grid[key(x, y)];
        if (cell === WALL || (cell === BRICK && !ghost)) return false;
        if (bombAt(x, y)) return false;
        if (forEnemy && flames.some(f => f.x === x && f.y === y)) return false;
        return true;
    }

    // Grid mover: tx/ty is target tile, px/py is current pixel-ish tile position (float)
    function makeMover(x, y, speed) {
        return { x, y, px: x, py: y, tx: x, ty: y, speed, dir: 'down', moving: false };
    }

    function stepMover(m, dt) {
        if (!m.moving) return true;
        const dx = m.tx - m.px, dy = m.ty - m.py;
        const dist = Math.abs(dx) + Math.abs(dy);
        const step = m.speed * dt;
        if (step >= dist) {
            m.px = m.tx; m.py = m.ty; m.x = m.tx; m.y = m.ty; m.moving = false;
            return true;
        }
        m.px += Math.sign(dx) * step;
        m.py += Math.sign(dy) * step;
        // logical tile = the one we're mostly in
        m.x = Math.round(m.px); m.y = Math.round(m.py);
        return false;
    }

    function tryMove(m, dir, forEnemy) {
        const [dx, dy] = DIRS[dir];
        m.dir = dir;
        if (!walkable(m.tx + dx, m.ty + dy, forEnemy, m.ghost)) return false;
        m.tx += dx; m.ty += dy; m.moving = true;
        return true;
    }

    // ---------- level ----------
    function buildLevel() {
        grid = new Array(COLS * ROWS).fill(EMPTY);
        bombs = []; flames = []; items = new Map(); enemies = [];
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
            if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0)) grid[key(x, y)] = WALL;
        }
        const safe = (x, y) => x + y < 4; // player start corner
        const open = [];
        for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
            if (grid[key(x, y)] !== EMPTY || safe(x, y)) continue;
            if (Math.random() < 0.55 + Math.min(level, 6) * 0.02) grid[key(x, y)] = BRICK; else open.push([x, y]);
        }
        const bricks = shuffle(grid.map((v, i) => v === BRICK ? i : -1).filter(i => i >= 0));
        exit = { i: bricks.pop(), open: false };
        const pool = ['bomb', 'bomb', 'fire', 'fire', 'speed'];
        if (level % 3 === 0) pool.push('life');
        pool.forEach(t => { if (bricks.length) items.set(bricks.pop(), { type: t, shown: false }); });

        const p = player;
        player = makeMover(1, 1, p ? p.baseSpeed : 4);
        player.baseSpeed = player.speed;
        player.maxBombs = p ? p.maxBombs : 1;
        player.fire = p ? p.fire : 2;
        player.invuln = 2;

        const far = shuffle(open.filter(([x, y]) => x + y > 7));
        const count = Math.min(3 + level, 10);
        for (let i = 0; i < count && far.length; i++) {
            const [x, y] = far.pop();
            spawnEnemy(x, y, level >= 3 && Math.random() < 0.2 ? 'ghost' : null);
        }
        particles = []; timeLeft = STAGE_TIME; hurryUp = false;
        hud();
    }

    function spawnEnemy(x, y, kind) {
        const smart = kind === 'fast' || (!kind && Math.random() < Math.min(0.15 * (level - 1), 0.6));
        const ghost = kind === 'ghost';
        const speed = ghost ? 1.6 : kind === 'fast' ? 4 : (smart ? 2.6 : 2) + level * 0.15;
        const e = makeMover(x, y, speed);
        e.smart = smart; e.ghost = ghost;
        e.hue = ghost ? 200 : kind === 'fast' ? 50 : smart ? 300 : 10;
        e.points = ghost ? 300 : kind === 'fast' ? 400 : smart ? 200 : 100;
        enemies.push(e);
    }

    // ---------- bombs & fire ----------
    function placeBomb() {
        const x = player.x, y = player.y;
        if (bombs.length >= player.maxBombs || bombAt(x, y)) return;
        bombs.push({ x, y, t: FUSE, range: player.fire });
        sfx.place();
    }

    function explode(b) {
        bombs.splice(bombs.indexOf(b), 1);
        sfx.boom(); shake = Math.min(12, shake + 6);
        burst(b.x, b.y, '#ffd76a', 14, 5);
        addFlame(b.x, b.y);
        for (const [dx, dy] of Object.values(DIRS)) {
            for (let r = 1; r <= b.range; r++) {
                const x = b.x + dx * r, y = b.y + dy * r, i = key(x, y);
                if (grid[i] === WALL) break;
                if (grid[i] === BRICK) {
                    grid[i] = EMPTY; score += 10;
                    burst(x, y, '#a0522d', 10, 3);
                    if (items.has(i)) items.get(i).shown = true;
                    if (exit.i === i) exit.open = true;
                    addFlame(x, y);
                    break;
                }
                // flames destroy uncovered power-ups
                if (items.has(i) && items.get(i).shown) items.delete(i);
                addFlame(x, y);
                const other = bombAt(x, y);
                if (other) { other.t = Math.min(other.t, 0.05); break; }
            }
        }
    }

    function addFlame(x, y) { flames.push({ x, y, t: BLAST }); }

    // ---------- enemy AI ----------
    function enemyThink(e) {
        const options = Object.keys(DIRS).filter(d => walkable(e.x + DIRS[d][0], e.y + DIRS[d][1], true));
        if (!options.length) return;
        let dir;
        if (e.smart && Math.random() < 0.7) {
            options.sort((a, b) => distTo(e, a) - distTo(e, b));
            dir = options[0];
        } else {
            const forward = options.includes(e.dir) && Math.random() < 0.75;
            dir = forward ? e.dir : options[Math.random() * options.length | 0];
        }
        tryMove(e, dir, true);
    }
    const distTo = (e, d) => Math.abs(e.x + DIRS[d][0] - player.x) + Math.abs(e.y + DIRS[d][1] - player.y);

    // ---------- game flow ----------
    function hud() {
        $('level').textContent = level; $('lives').textContent = lives; $('score').textContent = score;
        $('bombs').textContent = player ? player.maxBombs : 1; $('fire').textContent = player ? player.fire : 2;
        const t = Math.max(0, Math.ceil(timeLeft));
        $('time').textContent = `${t / 60 | 0}:${String(t % 60).padStart(2, '0')}`;
        $('time').classList.toggle('warn', t <= 30);
        if (score > best) { best = score; store.set('nqbomb.best', best); }
        $('best').textContent = best;
        $('mute').textContent = muted ? '🔇' : '🔊';
    }

    function showOverlay(title, text, btn) {
        $('overlay-title').textContent = title; $('overlay-text').textContent = text; $('start').textContent = btn;
        overlay.classList.remove('hidden');
    }

    function start() {
        if (state === 'menu' || state === 'over') {
            level = 1; lives = 3; score = 0; player = null;
            buildLevel(); state = 'play';
        } else if (state === 'paused') state = 'play';
        overlay.classList.add('hidden');
    }

    function die() {
        if (state !== 'play' || player.invuln > 0) return;
        state = 'dying'; stateTimer = 1.4; lives--;
        sfx.die(); burst(player.x, player.y, '#2b7bd6', 16, 4);
        hud();
    }

    function update(dt) {
        shake = Math.max(0, shake - dt * 40);
        for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.t -= dt; }
        particles = particles.filter(p => p.t > 0);
        if (state === 'dying') {
            stateTimer -= dt;
            if (stateTimer <= 0) {
                if (lives <= 0) { state = 'over'; showOverlay('Game Over', `Final score: ${score}`, 'Play again'); }
                else {
                    player.maxBombs = Math.max(1, player.maxBombs - 1);
                    player.fire = Math.max(2, player.fire - 1);
                    buildLevel(); state = 'play';
                }
            }
            return;
        }
        if (state === 'clear') {
            stateTimer -= dt;
            if (stateTimer <= 0) { level++; score += 500; buildLevel(); state = 'play'; }
            return;
        }
        if (state !== 'play') return;

        player.invuln = Math.max(0, player.invuln - dt);

        // stage timer: when it runs out, fast hunters pour in from the corners
        timeLeft -= dt;
        if (timeLeft <= 0 && !hurryUp) {
            hurryUp = true; sfx.hurry();
            [[COLS - 2, ROWS - 2], [COLS - 2, 1], [1, ROWS - 2]].forEach(([x, y]) => {
                if (grid[key(x, y)] === BRICK) grid[key(x, y)] = EMPTY;
                spawnEnemy(x, y, 'fast');
            });
        }

        // player
        if (stepMover(player, dt)) {
            const dir = held[held.length - 1];
            if (dir) tryMove(player, dir, false) || (player.dir = dir);
        }

        // pick up
        const pi = key(player.x, player.y);
        const it = items.get(pi);
        if (it && it.shown) {
            items.delete(pi); score += 50; sfx.pickup();
            if (it.type === 'bomb') player.maxBombs = Math.min(8, player.maxBombs + 1);
            if (it.type === 'fire') player.fire = Math.min(8, player.fire + 1);
            if (it.type === 'speed') player.speed = player.baseSpeed = Math.min(7, player.speed + 0.75);
            if (it.type === 'life') lives++;
        }
        if (exit.open && pi === exit.i && enemies.length === 0) {
            state = 'clear'; stateTimer = 1.5; sfx.clear();
            score += Math.max(0, Math.ceil(timeLeft)) * 5; // time bonus
        }

        // bombs
        for (const b of [...bombs]) { b.t -= dt; if (b.t <= 0 && bombs.includes(b)) explode(b); }

        // flames
        for (const f of flames) f.t -= dt;
        flames = flames.filter(f => f.t > 0);
        const burning = new Set(flames.map(f => key(f.x, f.y)));

        // enemies
        for (const e of enemies) {
            if (stepMover(e, dt)) enemyThink(e);
            if (burning.has(key(e.x, e.y))) {
                e.dead = true; score += e.points; sfx.kill();
                burst(e.px, e.py, `hsl(${e.hue},70%,55%)`, 12, 4);
            }
            else if (Math.abs(e.px - player.px) + Math.abs(e.py - player.py) < 0.7) die();
        }
        enemies = enemies.filter(e => !e.dead);
        if (burning.has(pi)) die();
        hud();
    }

    // ---------- render ----------
    function draw(now) {
        ctx.fillStyle = '#3b7d47'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (!grid) return;
        ctx.save();
        if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
            const i = key(x, y), X = x * T, Y = y * T;
            if ((x + y) % 2 === 0 && grid[i] === EMPTY) { ctx.fillStyle = '#367341'; ctx.fillRect(X, Y, T, T); }
            if (i === exit.i && exit.open) drawExit(X, Y, now);
            const it = items.get(i);
            if (it && it.shown && grid[i] === EMPTY) drawItem(it.type, X, Y, now);
            if (grid[i] === WALL) drawWall(X, Y);
            if (grid[i] === BRICK) drawBrick(X, Y);
        }
        for (const b of bombs) drawBomb(b, now);
        for (const f of flames) drawFlame(f);
        for (const e of enemies) drawEnemy(e, now);
        drawPlayer(now);
        for (const p of particles) {
            ctx.globalAlpha = Math.min(1, p.t * 2); ctx.fillStyle = p.color;
            ctx.fillRect(p.x * T - 3, p.y * T - 3, 6, 6);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        if (state === 'play' && hurryUp && Math.floor(now / 400) % 2) banner('Hurry up!');
        if (state === 'clear') banner('Stage clear!');
        if (state === 'dying' && lives > 0) banner('Ouch!');
    }

    function drawWall(X, Y) {
        ctx.fillStyle = '#5a5f73'; ctx.fillRect(X, Y, T, T);
        ctx.fillStyle = '#767c94'; ctx.fillRect(X + 4, Y + 4, T - 8, T - 8);
        ctx.fillStyle = '#8d94ae'; ctx.fillRect(X + 4, Y + 4, T - 8, 6);
    }
    function drawBrick(X, Y) {
        ctx.fillStyle = '#a0522d'; ctx.fillRect(X, Y, T, T);
        ctx.strokeStyle = '#6b3519'; ctx.lineWidth = 3;
        for (let r = 0; r < 3; r++) {
            const yy = Y + r * 20;
            ctx.strokeRect(X + (r % 2 ? -15 : 0), yy, 30, 20); ctx.strokeRect(X + (r % 2 ? 15 : 30), yy, 30, 20);
        }
    }
    function drawExit(X, Y, now) {
        const locked = enemies.length > 0;
        ctx.fillStyle = locked ? '#444' : `hsl(${(now / 8) % 360},80%,55%)`;
        ctx.fillRect(X + 8, Y + 8, T - 16, T - 16);
        ctx.fillStyle = '#111'; ctx.fillRect(X + 18, Y + 16, T - 36, T - 24);
    }
    function drawItem(type, X, Y, now) {
        const pulse = 3 * Math.sin(now / 150);
        ctx.fillStyle = { bomb: '#2c3e50', fire: '#e67e22', speed: '#2980b9', life: '#c0392b' }[type];
        ctx.fillRect(X + 8 - pulse / 2, Y + 8 - pulse / 2, T - 16 + pulse, T - 16 + pulse);
        ctx.font = '28px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText({ bomb: '💣', fire: '🔥', speed: '👟', life: '❤️' }[type], X + T / 2, Y + T / 2 + 2);
    }
    function drawBomb(b, now) {
        const cx = b.x * T + T / 2, cy = b.y * T + T / 2;
        const s = 1 + 0.08 * Math.sin(now / (b.t < 0.8 ? 40 : 120));
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cx, cy + 3, 20 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(cx - 7, cy - 4, 5 * s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#d9b26a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx + 8, cy - 14); ctx.lineTo(cx + 14, cy - 22); ctx.stroke();
        ctx.fillStyle = Math.random() < 0.5 ? '#ff0' : '#f60'; ctx.beginPath(); ctx.arc(cx + 15, cy - 23, 4, 0, Math.PI * 2); ctx.fill();
    }
    function drawFlame(f) {
        const a = f.t / BLAST, X = f.x * T, Y = f.y * T;
        ctx.fillStyle = `rgba(255,120,0,${a})`; ctx.fillRect(X + 2, Y + 2, T - 4, T - 4);
        ctx.fillStyle = `rgba(255,230,80,${a})`; ctx.fillRect(X + 14, Y + 14, T - 28, T - 28);
    }
    function drawEnemy(e, now) {
        const cx = e.px * T + T / 2, cy = e.py * T + T / 2 + 2 * Math.sin(now / 120 + e.x);
        if (e.ghost) ctx.globalAlpha = 0.55 + 0.25 * Math.sin(now / 200);
        ctx.fillStyle = `hsl(${e.hue},70%,55%)`;
        ctx.beginPath(); ctx.arc(cx, cy - 4, 20, Math.PI, 0); ctx.lineTo(cx + 20, cy + 18);
        for (let i = 0; i < 4; i++) ctx.lineTo(cx + 20 - (i * 2 + 1) * 5, cy + (i % 2 ? 18 : 10));
        ctx.lineTo(cx - 20, cy + 18); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(cx - 11, cy - 10, 8, 10); ctx.fillRect(cx + 3, cy - 10, 8, 10);
        const [dx, dy] = DIRS[e.dir];
        ctx.fillStyle = '#000'; ctx.fillRect(cx - 9 + dx * 2, cy - 7 + dy * 2, 4, 5); ctx.fillRect(cx + 5 + dx * 2, cy - 7 + dy * 2, 4, 5);
        ctx.globalAlpha = 1;
    }
    function drawPlayer(now) {
        if (player.invuln > 0 && Math.floor(now / 100) % 2) return;
        const cx = player.px * T + T / 2, cy = player.py * T + T / 2;
        if (state === 'dying') {
            ctx.globalAlpha = Math.max(0, stateTimer / 1.4);
            ctx.save(); ctx.translate(cx, cy); ctx.rotate((1.4 - stateTimer) * 8); ctx.translate(-cx, -cy);
        }
        ctx.fillStyle = '#2b7bd6'; ctx.fillRect(cx - 13, cy + 2, 26, 18);          // body
        ctx.fillStyle = '#1b4f8f'; ctx.fillRect(cx - 13, cy + 18, 10, 6); ctx.fillRect(cx + 3, cy + 18, 10, 6);
        ctx.fillStyle = '#f5f5f5'; ctx.beginPath(); ctx.arc(cx, cy - 8, 15, 0, Math.PI * 2); ctx.fill(); // head
        ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(cx, cy - 22, 4, 0, Math.PI * 2); ctx.fill(); // antenna
        const [dx, dy] = DIRS[player.dir];
        if (player.dir !== 'up') {
            ctx.fillStyle = '#ffd1a8'; ctx.fillRect(cx - 10 + dx * 3, cy - 13 + dy * 2, 20, 11);
            ctx.fillStyle = '#000'; ctx.fillRect(cx - 6 + dx * 3, cy - 11 + dy * 2, 3, 6); ctx.fillRect(cx + 3 + dx * 3, cy - 11 + dy * 2, 3, 6);
        }
        if (state === 'dying') { ctx.restore(); ctx.globalAlpha = 1; }
    }
    function banner(text) {
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
        ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 40px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    }

    // ---------- input ----------
    const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
    const press = d => { if (!held.includes(d)) held.push(d); };
    const release = d => { const i = held.indexOf(d); if (i >= 0) held.splice(i, 1); };

    addEventListener('keydown', e => {
        if (KEYMAP[e.code]) { press(KEYMAP[e.code]); e.preventDefault(); }
        else if (e.code === 'Space') { if (state === 'play') placeBomb(); e.preventDefault(); }
        else if (e.code === 'Enter' && state !== 'play') start();
        else if (e.code === 'KeyM') toggleMute();
        else if (e.code === 'KeyP') {
            if (state === 'play') { state = 'paused'; showOverlay('Paused', 'Take a breather.', 'Resume'); }
            else if (state === 'paused') start();
        }
    });
    addEventListener('keyup', e => { if (KEYMAP[e.code]) release(KEYMAP[e.code]); });
    addEventListener('blur', () => { held.length = 0; });
    function toggleMute() { muted = !muted; store.set('nqbomb.muted', muted ? '1' : '0'); hud(); }
    $('mute').addEventListener('click', toggleMute);
    $('start').addEventListener('click', start);
    overlay.addEventListener('touchend', e => { e.preventDefault(); start(); });
    document.querySelectorAll('[data-dir]').forEach(btn => {
        btn.addEventListener('pointerdown', e => { e.preventDefault(); press(btn.dataset.dir); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, () => release(btn.dataset.dir)));
    });
    $('tbomb').addEventListener('pointerdown', e => { e.preventDefault(); if (state === 'play') placeBomb(); });

    // ---------- loop ----------
    let last = performance.now();
    function frame(now) {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        update(dt); draw(now);
        requestAnimationFrame(frame);
    }
    buildLevel();
    requestAnimationFrame(frame);
})();
