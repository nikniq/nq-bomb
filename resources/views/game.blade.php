<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>NQ Bomb</title>
    <link rel="stylesheet" href="{{ asset('css/bomb.css') }}">
</head>
<body>
    <main>
        <header>
            <h1>NQ&nbsp;Bomb</h1>
            <div id="hud">
                <span>Level <b id="level">1</b></span>
                <span>Lives <b id="lives">3</b></span>
                <span>Score <b id="score">0</b></span>
                <span>Bombs <b id="bombs">1</b></span>
                <span>Fire <b id="fire">2</b></span>
                <span>Time <b id="time">3:00</b></span>
                <span>Best <b id="best">0</b></span>
                <button id="mute" aria-label="Toggle sound">🔊</button>
            </div>
        </header>
        <div id="stage">
            <canvas id="game" width="780" height="660"></canvas>
            <div id="overlay">
                <h2 id="overlay-title">NQ Bomb</h2>
                <p id="overlay-text">Clear every enemy, then find the hidden exit.</p>
                <button id="start">Press Enter / Tap to start</button>
            </div>
        </div>
        <p class="help">Move: Arrow keys / WASD &nbsp;·&nbsp; Bomb: Space &nbsp;·&nbsp; Pause: P &nbsp;·&nbsp; Mute: M</p>
        <div id="touch">
            <div class="pad">
                <button data-dir="up">▲</button>
                <button data-dir="left">◀</button>
                <button data-dir="down">▼</button>
                <button data-dir="right">▶</button>
            </div>
            <button id="tbomb">💣</button>
        </div>
    </main>
    <script src="{{ asset('js/bomb.js') }}"></script>
</body>
</html>
