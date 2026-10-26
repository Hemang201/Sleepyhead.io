/**
 * A disposable browser build used to validate the publishing pipeline.
 *
 * This is deliberately not a game: it is a build-check card that proves the
 * upload, storage, MIME types, nested asset paths and execution isolation all
 * work. It is only ever installed by `npm run seed` on a local machine.
 */

import { encodePng } from './cover-art.mjs';

function probePng(size = 32) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const checker = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
      rgba[offset] = checker ? 53 : 12;
      rgba[offset + 1] = checker ? 230 : 16;
      rgba[offset + 2] = checker ? 255 : 40;
      rgba[offset + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Build check — publishing pipeline fixture</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Build check</h1>
      <p class="sub">A disposable fixture that proves this uploaded build is stored, served and executed correctly.</p>
      <canvas id="card" width="640" height="360" aria-label="Test pattern"></canvas>
      <div class="row">
        <button id="cycle" type="button">Cycle pattern</button>
        <img id="probe" src="assets/probe.png" alt="Nested asset probe" width="32" height="32" />
        <span id="status" class="status">checking…</span>
      </div>
    </main>
    <script src="main.js"></script>
  </body>
</html>
`;

const CSS = `:root { color-scheme: dark; --accent: #35e6ff; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #070a16; color: #eff3ff;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: min(680px, 92vw); padding: 1.5rem; }
h1 { font-size: 1.5rem; margin: 0 0 0.35rem; letter-spacing: -0.02em; }
.sub { margin: 0 0 1rem; color: #9aa6c6; font-size: 0.95rem; }
canvas { width: 100%; height: auto; border-radius: 14px; border: 1px solid #23305c; }
.row { display: flex; align-items: center; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap; }
button { font: inherit; padding: 0.6rem 1rem; border-radius: 10px; border: 1px solid var(--accent); background: transparent;
  color: var(--accent); cursor: pointer; }
button:hover { background: color-mix(in oklab, var(--accent) 18%, transparent); }
.status { font-size: 0.9rem; color: #9aa6c6; }
.status[data-ok="true"] { color: #b2ff59; }
.status[data-ok="false"] { color: #ff4d97; }
`;

const JS = `(function () {
  var canvas = document.getElementById('card');
  var ctx = canvas.getContext('2d');
  var palette = ['#35e6ff', '#a084ff', '#ff4d97', '#b2ff59', '#ff9840'];
  var step = 0;

  function draw() {
    var accent = palette[step % palette.length];
    ctx.fillStyle = '#0a0f22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < 8; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? accent : '#23305c';
      ctx.globalAlpha = 0.85 - i * 0.06;
      ctx.fillRect(i * 60 + 20, i * 28 + 20, 120, 24);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.strokeRect(24.5, 24.5, canvas.width - 49, canvas.height - 49);
    ctx.fillStyle = accent;
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillText('pattern ' + (step % palette.length + 1) + '/5', 48, canvas.height - 48);
  }

  document.getElementById('cycle').addEventListener('click', function () {
    step += 1;
    draw();
  });

  draw();

  var status = document.getElementById('status');
  fetch('data/status.json')
    .then(function (response) { return response.json(); })
    .then(function (data) {
      status.textContent = 'nested JSON ok — ' + data.label + ' · ' + (window.self === window.top ? 'top level' : 'framed');
      status.dataset.ok = 'true';
    })
    .catch(function (error) {
      status.textContent = 'nested JSON failed: ' + error.message;
      status.dataset.ok = 'false';
    });
})();
`;

const STATUS_JSON = JSON.stringify({ label: 'pipeline fixture', nested: true, generated: 'by scripts/lib/test-build.mjs' }, null, 2);

/** Files of the fixture build, keyed by path inside the build. */
export function testBuildFiles() {
  return [
    { path: 'index.html', bytes: Buffer.from(HTML, 'utf8') },
    { path: 'style.css', bytes: Buffer.from(CSS, 'utf8') },
    { path: 'main.js', bytes: Buffer.from(JS, 'utf8') },
    { path: 'data/status.json', bytes: Buffer.from(STATUS_JSON, 'utf8') },
    { path: 'assets/probe.png', bytes: probePng() },
  ];
}
