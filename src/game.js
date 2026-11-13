import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// =====================================================================
//  helpers
// =====================================================================
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = a => a[(Math.random() * a.length) | 0];
const damp = (dt, k) => 1 - Math.exp(-dt * k);
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = clamp(t, 0, 1); return Math.hypot(px - (ax + dx * t), py - (ay + dy * t)); }
function logEnds(e) { const c = Math.cos(e.a) * e.len / 2, s = Math.sin(e.a) * e.len / 2; return [e.x - c, e.y - s, e.x + c, e.y + s]; }

// river shape. Game plane: x = sideways, y = along river (forward = negative). 3D: (x, height, y)
const rc = y => Math.sin(y * 0.0011) * 140 + Math.sin(y * 0.0029 + 1.3) * 60;
const rh = y => { const d = Math.min(1, -y / 45000); return 255 - d * 75 + Math.sin(y * 0.0007) * 45; };

// tileable value noise
function h2(i, j, s) { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); }
function vn(x, y, P, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const m = a => ((a % P) + P) % P;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(m(xi), m(yi), s), b = h2(m(xi + 1), m(yi), s), c = h2(m(xi), m(yi + 1), s), d = h2(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, P, o, s) { let t = 0, a = 0.5, n = 0, f = 1; for (let i = 0; i < o; i++) { t += a * vn(x * f, y * f, P * f, s + i * 13); n += a; a *= 0.5; f *= 2; } return t / n; }
const noise2 = (x, y) => vn(x, y, 1e6, 3);

const QUIPS = ["EAT WATER!", "YARD SALE!", "SPECTACULAR!", "10/10 FORM", "SPLASHDOWN!", "HYDRATED!", "THAT'LL LEAVE A MARK", "SEND HELP", "SKIPPING STONES!", "GRAVITY WINS"];
const RCOLS = [0xff3b6b, 0x9b5cff, 0x2ecc71, 0xff9f1a, 0x00c2d1, 0xf4f4f4];
const RCOLS_CSS = ['#ff3b6b', '#9b5cff', '#2ecc71', '#ff9f1a', '#00c2d1', '#f4f4f4'];

// =====================================================================
//  loading screen helpers
// =====================================================================
const LD = { el: document.getElementById('loader'), bar: document.getElementById('ldBar'), msg: document.getElementById('ldMsg') };
function step(pct, msg) {
  if (LD.bar) LD.bar.style.width = pct + '%';
  if (LD.msg) LD.msg.textContent = msg;
  return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
}
function fail(err) {
  console.error(err);
  const box = document.getElementById('ldErr'); if (!box) return;
  const noGL = String(err && err.message || err).includes('WEBGL');
  box.innerHTML = noGL
    ? '<b>3D graphics are switched off in this browser.</b><br>In Chrome: open <i>Settings → System</i>, turn on <i>“Use graphics acceleration when available”</i>, relaunch Chrome and open the game again.'
    : '<b>The game could not start.</b><br>' + String(err && err.message || err).replace(/</g, '&lt;') + '<br>Try reloading, or open the file in an up-to-date Chrome, Edge or Firefox.';
  box.style.display = 'block';
  document.getElementById('loader').classList.add('error');
}
window.addEventListener('error', e => fail(e.error || e.message));
window.addEventListener('unhandledrejection', e => fail(e.reason));

async function boot() {
await step(4, 'Starting the engine…');
{ const c = document.createElement('canvas'); if (!c.getContext('webgl2')) throw new Error('WEBGL2 not available'); }
// =====================================================================
//  renderer / scene
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const isMobile = matchMedia('(pointer:coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.5 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.shadowMap.enabled = true; renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.id = 'gl';
document.body.prepend(renderer.domElement);
const MAXA = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const FOG = new THREE.Color(0xa9c9de);
scene.fog = new THREE.Fog(FOG, 900, 3400);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 4, 20000);

const hud = document.getElementById('hud'), ctx = hud.getContext('2d');
let CW, CH, HDPR;
// optional native host bridge ("surge" script message handler); null in a plain browser
const NATIVE = (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.surge) || null;
function native(type, data) { if (!NATIVE) return false; try { NATIVE.postMessage(Object.assign({ type }, data)); return true; } catch (e) { return false; } }
function buzz(kind) { if (native('haptic', { kind })) return; try { if (navigator.vibrate) navigator.vibrate(kind === 'heavy' ? 60 : kind === 'medium' ? 25 : 10); } catch (e) {} }
const SAFE = { t: 0, r: 0, b: 0, l: 0 }, safeEl = document.getElementById('safe');
// post-processing: HDR render -> bloom -> tone mapping
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: isMobile ? 2 : 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.16, 0.35, 14);
composer.addPass(bloom); composer.addPass(new OutputPass());
// graphics quality levels (Q key). Starts high and steps down by itself if the frame rate is poor.
const QUAL = [{ name: 'LOW', pr: 0.8, bloom: false, refl: 3, shadow: 4 }, { name: 'MEDIUM', pr: 1.25, bloom: true, refl: 2, shadow: 2 }, { name: 'HIGH', pr: 2, bloom: true, refl: 1, shadow: 1 }];
let qi = isMobile ? 1 : 2, qAuto = true, frameNo = 0;
try { const sv = localStorage.getItem('surgeRiderQ'); if (sv !== null) { qi = clamp(+sv || 0, 0, 2); qAuto = false; } } catch (e) {}
function applyQuality() {
  const q = QUAL[qi], pr = Math.min(devicePixelRatio || 1, q.pr);
  renderer.setPixelRatio(pr); composer.setPixelRatio(pr); renderer.setSize(CW, CH); composer.setSize(CW, CH); bloom.enabled = q.bloom;
}
function resize() {
  CW = innerWidth; CH = innerHeight; HDPR = Math.min(devicePixelRatio || 1, 2);
  if (safeEl) { const cs = getComputedStyle(safeEl); SAFE.t = parseFloat(cs.paddingTop) || 0; SAFE.r = parseFloat(cs.paddingRight) || 0; SAFE.b = parseFloat(cs.paddingBottom) || 0; SAFE.l = parseFloat(cs.paddingLeft) || 0; }
  hud.width = CW * HDPR; hud.height = CH * HDPR;
  camera.aspect = CW / CH; camera.updateProjectionMatrix(); applyQuality();
}
addEventListener('resize', resize); resize();

// lights
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(145));
scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3d5a32, 0.55));
const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
const sc = sun.shadow.camera; sc.left = -300; sc.right = 300; sc.top = 300; sc.bottom = -300; sc.near = 10; sc.far = 2200;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

// sky + environment
const sky = new Sky(); sky.scale.setScalar(10000);
const su = sky.material.uniforms;
su.turbidity.value = 2.2; su.rayleigh.value = 2.4; su.mieCoefficient.value = 0.005; su.mieDirectionalG.value = 0.82;
su.sunPosition.value.copy(sunDir);
{
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(sky);
  scene.environment = pm.fromScene(envScene).texture; scene.environmentIntensity = 0.55;
  scene.add(sky);
}

// =====================================================================
//  procedural textures
// =====================================================================
function canvasTex(w, h, draw, srgb = true, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAXA;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pixels(g, w, h, fn) {
  const im = g.createImageData(w, h), d = im.data, c = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { c[3] = 255; fn(x, y, c); const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3]; }
  g.putImageData(im, 0, 0);
}
const TEX = {};
// water normals
await step(10, 'Making waves…');
TEX.waterN = canvasTex(512, 512, (g, w, h) => {
  const P = 8, hm = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = x / w * P, v = y / h * P; hm[y * w + x] = fbm(u, v, P, 6, 1) + 0.4 * Math.abs(fbm(u * 2, v * 2, P * 2, 4, 7) - 0.5); }
  const S = 7;
  pixels(g, w, h, (x, y, c) => {
    const dx = hm[y * w + (x + 1) % w] - hm[y * w + (x - 1 + w) % w];
    const dy = hm[((y + 1) % h) * w + x] - hm[((y - 1 + h) % h) * w + x];
    let nx = -dx * S * 10, ny = -dy * S * 10, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    c[0] = (nx * 0.5 + 0.5) * 255; c[1] = (ny * 0.5 + 0.5) * 255; c[2] = (nz * 0.5 + 0.5) * 255;
  });
}, false);
await step(22, 'Raking the sand…');
TEX.sand = canvasTex(512, 512, (g, w, h) => pixels(g, w, h, (x, y, c) => {
  const u = x / w * 16, v = y / h * 16, n = fbm(u, v, 16, 5, 3);
  const rip = Math.sin(v * TAU + n * 5) * 0.5 + 0.5, gr = Math.random() * 22 - 11;
  const k = 0.82 + 0.32 * n;
  c[0] = 226 * k + rip * 7 + gr; c[1] = 203 * k + rip * 6 + gr; c[2] = 150 * k + rip * 4 + gr;
}));
await step(32, 'Growing grass…');
TEX.grass = canvasTex(512, 512, (g, w, h) => {
  pixels(g, w, h, (x, y, c) => { const u = x / w * 8, v = y / h * 8, n = fbm(u, v, 8, 5, 21), m = fbm(u * 4, v * 4, 32, 2, 5);
    c[0] = lerp(48, 102, n) * (0.85 + m * 0.3); c[1] = lerp(98, 150, n) * (0.85 + m * 0.3); c[2] = lerp(34, 60, n); });
  g.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * w, y = Math.random() * h, l = rand(4, 10), a = -Math.PI / 2 + rand(-0.6, 0.6);
    g.strokeStyle = `rgba(${rand(40, 120) | 0},${rand(110, 175) | 0},${rand(30, 60) | 0},.55)`; g.lineWidth = rand(1, 2);
    for (const ox of [0, -w, w]) { g.beginPath(); g.moveTo(x + ox, y); g.lineTo(x + ox + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  }
});
await step(42, 'Carving rocks and logs…');
TEX.rock = canvasTex(256, 256, (g, w, h) => pixels(g, w, h, (x, y, c) => {
  const u = x / w * 6, v = y / h * 6, n = fbm(u, v, 6, 6, 5), cr = Math.abs(fbm(u * 1.5, v * 1.5, 9, 4, 11) - 0.5) < 0.016;
  let k = 70 + n * 120; if (cr) k *= 0.45; const gr = Math.random() * 14;
  c[0] = k + gr; c[1] = k * 0.98 + gr; c[2] = k * 0.94 + gr;
}));
TEX.wood = canvasTex(256, 256, (g, w, h) => pixels(g, w, h, (x, y, c) => {
  const band = Math.floor(y / 64), ly = y % 64;
  if (ly < 3) { c[0] = 45; c[1] = 28; c[2] = 16; return; }
  const n = fbm(x / w * 4, y / h * 16, 4, 4, band * 3 + 1), tone = 0.82 + 0.25 * h2(band, 0, 2);
  const gr = 0.82 + 0.18 * Math.sin(x / w * TAU * 6 + n * 18);
  c[0] = 168 * tone * gr; c[1] = 112 * tone * gr; c[2] = 62 * tone * gr;
}));
TEX.bark = canvasTex(256, 256, (g, w, h) => pixels(g, w, h, (x, y, c) => {
  const u = x / w * 8, v = y / h * 2, n = fbm(u, v * 4, 8, 4, 9), s = Math.sin(x / w * TAU * 10 + n * 7) * 0.5 + 0.5;
  const k = 0.55 + 0.45 * s * (0.7 + n * 0.5);
  c[0] = 118 * k; c[1] = 80 * k; c[2] = 46 * k;
}));
TEX.rings = canvasTex(128, 128, (g, w, h) => pixels(g, w, h, (x, y, c) => {
  const d = Math.hypot(x - 64, y - 64), r = Math.sin(d * 0.9 + fbm(x / 32, y / 32, 4, 3, 2) * 4) * 0.5 + 0.5;
  const k = d > 58 ? 0.45 : 0.75 + r * 0.25; c[0] = 205 * k; c[1] = 160 * k; c[2] = 105 * k;
}), true, false);
await step(50, 'Planting palm trees…');
TEX.leaf = canvasTex(256, 64, (g) => {
  g.clearRect(0, 0, 256, 64);
  for (let i = 0; i < 34; i++) {
    const x = 6 + i * 7.2, len = 26 * Math.sin(Math.PI * Math.min(1, (i + 2) / 34)) + 3;
    for (const s of [-1, 1]) {
      g.save(); g.translate(x, 32); g.rotate(s * (0.75 + i * 0.008));
      const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, '#2f7a2c'); gr.addColorStop(1, '#5fae3e');
      g.fillStyle = gr; g.beginPath(); g.ellipse(len / 2, 0, len / 2, 2.6, 0, 0, TAU); g.fill(); g.restore();
    }
  }
  g.strokeStyle = '#5b7a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 32); g.lineTo(254, 32); g.stroke();
}, true, false);
TEX.soft = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,.85)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }, false, false);
TEX.pad = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = 'rgba(0,235,225,0.45)'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff36b'; g.lineWidth = 16; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < 3; i++) { const y = 50 + i * 80; g.beginPath(); g.moveTo(22, y + 30); g.lineTo(64, y - 10); g.lineTo(106, y + 30); g.stroke(); }
  g.strokeStyle = 'rgba(160,255,255,.9)'; g.lineWidth = 6; g.strokeRect(3, -10, w - 6, h + 20);
});
TEX.whirl = canvasTex(256, 256, (g) => {
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128); r.addColorStop(0, 'rgba(0,15,35,.95)'); r.addColorStop(0.35, 'rgba(0,40,80,.6)'); r.addColorStop(1, 'rgba(0,40,80,0)');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  g.lineCap = 'round';
  for (let arm = 0; arm < 5; arm++) { g.beginPath();
    for (let k = 0; k <= 60; k++) { const rr = 10 + k * 1.95, a = arm * TAU / 5 + rr * 0.045; const x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr; k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 5; g.stroke(); }
}, true, false);
TEX.foam = canvasTex(64, 256, (g, w, h) => pixels(g, w, h, (x, y, c) => {
  const n = fbm(x / w * 4, y / h * 16, 4, 4, 31), edge = 1 - Math.abs(x / w - 0.5) * 2;
  c[0] = c[1] = c[2] = 255; c[3] = clamp((n - 0.42) * 4, 0, 1) * edge * 255;
}));
TEX.stripes = canvasTex(256, 16, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#fff' : '#ff4d6d'; g.fillRect(i * 32, 0, 32, 16); } }, true, false);
TEX.stripes2 = canvasTex(256, 16, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffd60a' : '#3a86ff'; g.fillRect(i * 32, 0, 32, 16); } }, true, false);

// =====================================================================
//  materials & shared geometries
// =====================================================================
const M = {
  rock: new THREE.MeshStandardMaterial({ map: TEX.rock, bumpMap: TEX.rock, bumpScale: 3, roughness: 0.92, flatShading: true }),
  wood: new THREE.MeshStandardMaterial({ map: TEX.wood, bumpMap: TEX.wood, bumpScale: 1.5, roughness: 0.8 }),
  rampSide: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 }),
  bark: new THREE.MeshStandardMaterial({ map: TEX.bark, bumpMap: TEX.bark, bumpScale: 2, roughness: 0.95 }),
  rings: new THREE.MeshStandardMaterial({ map: TEX.rings, roughness: 0.9 }),
  leaf: new THREE.MeshStandardMaterial({ map: TEX.leaf, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 }),
  red: new THREE.MeshPhysicalMaterial({ color: 0xe8312f, roughness: 0.35, clearcoat: 1 }),
  white: new THREE.MeshPhysicalMaterial({ color: 0xf6f6f6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.6 }),
  seat: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.85 }),
  seat2: new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.8 }),
  keel: new THREE.MeshPhysicalMaterial({ color: 0x14171b, roughness: 0.25, clearcoat: 1, side: THREE.DoubleSide }),
  bumper: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.7 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.2 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.22, emissive: 0x4a2a00 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe9b98a, roughness: 0.7 }),
  shorts: new THREE.MeshStandardMaterial({ color: 0x24357a, roughness: 0.8 }),
  shark: new THREE.MeshStandardMaterial({ color: 0x5b6773, roughness: 0.55, side: THREE.DoubleSide }),
  sharkBody: new THREE.MeshBasicMaterial({ color: 0x0a2233, transparent: true, opacity: 0.45, depthWrite: false }),
  pad: new THREE.MeshBasicMaterial({ map: TEX.pad, color: new THREE.Color(2.6, 2.6, 2.6), transparent: true, depthWrite: false }),
  whirl: new THREE.MeshBasicMaterial({ map: TEX.whirl, transparent: true, depthWrite: false }),
  foam: new THREE.MeshBasicMaterial({ map: TEX.foam, color: new THREE.Color(1.7, 1.7, 1.7), transparent: true, depthWrite: false, opacity: 0.9 }),
  flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(26, 12, 3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  nitroGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(16, 7.5, 1.5), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  umb1: new THREE.MeshStandardMaterial({ map: TEX.stripes, roughness: 0.8, side: THREE.DoubleSide }),
  umb2: new THREE.MeshStandardMaterial({ map: TEX.stripes2, roughness: 0.8, side: THREE.DoubleSide }),
  towel: new THREE.MeshStandardMaterial({ color: 0xff9f80, roughness: 1 }),
};
const hullMats = new Map(), helmetMats = new Map();
const paintMats = new Map();
let PCOL = 0xff7a00;
function paintMat(c) { if (!paintMats.has(c)) paintMats.set(c, new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.34, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.15 })); return paintMats.get(c); }
// deck paint job: stripes, race number, vents and grip mats (u = across, v = stern -> bow)
function deckTex(col, num) {
  return canvasTex(256, 512, (g, w, h) => {
    const css = '#' + new THREE.Color(col).getHexString(), c = new THREE.Color(col), light = c.r * 0.3 + c.g * 0.6 + c.b * 0.1 > 0.6;
    const ink = light ? '#15181d' : '#ffffff', ink2 = light ? '#ffffff' : '#15181d';
    g.fillStyle = css; g.fillRect(0, 0, w, h);
    const sh = g.createLinearGradient(0, 0, w, 0); sh.addColorStop(0, 'rgba(0,0,0,.28)'); sh.addColorStop(0.25, 'rgba(0,0,0,0)'); sh.addColorStop(0.75, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.28)'); g.fillStyle = sh; g.fillRect(0, 0, w, h);
    // twin racing stripes converging on the bow
    g.fillStyle = ink; for (const sgn of [-1, 1]) { g.beginPath(); g.moveTo(128 + sgn * 46, 512); g.lineTo(128 + sgn * 64, 512); g.lineTo(128 + sgn * 20, 0); g.lineTo(128 + sgn * 8, 0); g.closePath(); g.fill(); }
    // side flashes
    g.fillStyle = ink2; for (const sgn of [-1, 1]) { g.beginPath(); g.moveTo(128 + sgn * 122, 330); g.lineTo(128 + sgn * 96, 300); g.lineTo(128 + sgn * 92, 150); g.lineTo(128 + sgn * 122, 90); g.closePath(); g.fill(); }
    // grip mats in the footwells
    g.fillStyle = '#1b1e22'; for (const sgn of [-1, 1]) { g.beginPath(); g.roundRect(128 + sgn * 84 - 17, 300, 34, 190, 8); g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 2; for (let y = 310; y < 486; y += 9) for (const sgn of [-1, 1]) { g.beginPath(); g.moveTo(128 + sgn * 84 - 13, y); g.lineTo(128 + sgn * 84 + 13, y); g.stroke(); }
    // hood vents
    g.fillStyle = '#0d0f12'; for (const sgn of [-1, 1]) for (let i = 0; i < 3; i++) { g.beginPath(); g.roundRect(128 + sgn * 30 - 9, 196 + i * 13, 18, 6, 3); g.fill(); }
    // race number plate on the hood
    g.fillStyle = ink2; g.beginPath(); g.arc(128, 132, 27, 0, TAU); g.fill();
    g.fillStyle = ink; g.font = '900 38px system-ui,Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(num), 128, 134);
  }, true, false);
}
function hullMat(c, num = 7) { if (!hullMats.has(c)) hullMats.set(c, new THREE.MeshPhysicalMaterial({ map: deckTex(c, num), roughness: 0.34, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.15, side: THREE.DoubleSide })); return hullMats.get(c); }
function helmetMat(c) { if (!helmetMats.has(c)) helmetMats.set(c, new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.25, clearcoat: 1 })); return helmetMats.get(c); }

// terrain material: sand / grass splat by vertex attribute
const terrainMat = new THREE.MeshStandardMaterial({ map: TEX.sand, vertexColors: true, roughness: 0.97 });
terrainMat.onBeforeCompile = sh => {
  sh.uniforms.grassMap = { value: TEX.grass }; sh.uniforms.rockMap = { value: TEX.rock };
  sh.vertexShader = 'attribute float blend;\nattribute float rockB;\nvarying float vBlend;\nvarying float vRock;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vBlend = blend; vRock = rockB;');
  sh.fragmentShader = 'uniform sampler2D grassMap;\nuniform sampler2D rockMap;\nvarying float vBlend;\nvarying float vRock;\n' + sh.fragmentShader.replace('#include <map_fragment>',
    'vec4 sC = texture2D( map, vMapUv * 2.0 ); vec4 gC = mix( texture2D( grassMap, vMapUv * 2.2 ), texture2D( grassMap, vMapUv * 0.37 ), 0.45 ); vec4 rC = texture2D( rockMap, vMapUv * 1.6 ) * vec4(1.05,1.0,0.92,1.0); diffuseColor *= mix( mix( sC, gC, vBlend ), rC, vRock );');
};
const bushMat = new THREE.MeshStandardMaterial({ map: TEX.grass, color: 0x6a9a50, roughness: 0.95 });
const umbPoleMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });

function hullShape(L, W) {
  const s = new THREE.Shape(), n = L * 0.61, b = L * 0.39;
  s.moveTo(0, n); s.quadraticCurveTo(W * 0.56, n * 0.55, W * 0.5, -b * 0.2); s.lineTo(W * 0.46, -b);
  s.quadraticCurveTo(0, -b * 1.18, -W * 0.46, -b); s.lineTo(-W * 0.5, -b * 0.2); s.quadraticCurveTo(-W * 0.56, n * 0.55, 0, n);
  return s;
}
function extrudeHull(L, W, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(hullShape(L, W), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4, curveSegments: 20 });
  g.rotateX(-Math.PI / 2); return g;
}
const GEO = {
  hull: extrudeHull(46, 24, 6, 3), hullLow: extrudeHull(44, 22, 3, 2), stripe: extrudeHull(20, 11, 0.6, 0.6),
  seat: new THREE.CapsuleGeometry(5, 12, 4, 10), console: new THREE.BoxGeometry(13, 6, 9),
  bar: new THREE.CylinderGeometry(1.1, 1.1, 22, 8), grip: new THREE.CylinderGeometry(1.6, 1.6, 4, 8), column: new THREE.CylinderGeometry(1.6, 1.6, 9, 8),
  screen: new THREE.BoxGeometry(11, 5, 0.6), nozzle: new THREE.CylinderGeometry(2.6, 3.2, 5, 10), flame: new THREE.ConeGeometry(3.2, 16, 10, 1, true),
  torso: new THREE.CapsuleGeometry(5.5, 9, 4, 12), head: new THREE.SphereGeometry(6, 20, 14),
  visor: new THREE.SphereGeometry(6.15, 20, 10, Math.PI * 1.5 - 0.95, 1.9, 0.95, 0.85),
  arm: new THREE.CapsuleGeometry(1.9, 9, 4, 8), leg: new THREE.CapsuleGeometry(2.4, 10, 4, 8), boot: new THREE.BoxGeometry(4.5, 3, 7),
  buoy: new THREE.CylinderGeometry(7, 8, 14, 16), buoyTop: new THREE.SphereGeometry(5, 14, 10), buoyBand: new THREE.CylinderGeometry(7.6, 7.6, 3.5, 16),
  can: new THREE.CylinderGeometry(7, 7, 20, 16), canCap: new THREE.CylinderGeometry(3, 3, 4, 10), glowRing: new THREE.TorusGeometry(13, 1.4, 8, 32),
  trunkTop: new THREE.SphereGeometry(3.4, 8, 6), umbCone: new THREE.ConeGeometry(20, 6, 16, 1, true), pole: new THREE.CylinderGeometry(0.8, 0.8, 26, 6),
  towel: new THREE.BoxGeometry(12, 0.6, 24),
  boatHull: extrudeHull(110, 36, 8, 4), boatCabin: new THREE.BoxGeometry(24, 12, 28), boatScreen: new THREE.BoxGeometry(26, 8, 1),
};
// ramp wedge
GEO.ramp = (() => { const L = 44, H = 22, W = 72; const s = new THREE.Shape(); s.moveTo(0, -4); s.lineTo(L, -4); s.lineTo(L, H); s.lineTo(0, 0); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false }); g.rotateY(Math.PI / 2); g.translate(-W / 2, 0, L / 2); return g; })();
// star coin
GEO.star = (() => { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 5 : 10.5; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? s.lineTo(x, y) : s.moveTo(x, y); } s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 2, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1, bevelSegments: 2 }); g.center(); return g; })();
// shark fin
GEO.fin = (() => { const s = new THREE.Shape(); s.moveTo(-11, 0); s.lineTo(11, 0); s.quadraticCurveTo(2, 6, -8, 19); s.quadraticCurveTo(-6, 8, -11, 0);
  return new THREE.ExtrudeGeometry(s, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.5, bevelSegments: 2 }); })();
GEO.sharkBody = new THREE.SphereGeometry(1, 16, 10);
GEO.whirl = new THREE.PlaneGeometry(1, 1); GEO.whirl.rotateX(-Math.PI / 2);
GEO.pad = new THREE.PlaneGeometry(1, 1); GEO.pad.rotateX(-Math.PI / 2);
// rocks
await step(56, 'Building jetskis…');
GEO.rocks = [0, 1, 2, 3, 4].map(s => {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i);
    const f = 1 + 0.22 * Math.sin(v.x * 3 + s) * Math.sin(v.y * 4 + s * 2) * Math.sin(v.z * 3.5 + s * 3) + 0.09 * Math.sin(v.x * 9 + v.z * 7 + s * 5);
    v.multiplyScalar(f); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g; });
// log
GEO.log = new THREE.CylinderGeometry(9, 9, 1, 16, 1);
// palm leaf (bent plane)
GEO.leaf = (() => { const g = new THREE.PlaneGeometry(62, 15, 10, 1); g.translate(31, 0, 0); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, -Math.pow(x / 62, 2) * 26 + x * 0.12); } g.computeVertexNormals(); return g; })();
GEO.trunk = (() => { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -6, 0), new THREE.Vector3(2, 25, 0), new THREE.Vector3(7, 52, 0), new THREE.Vector3(14, 74, 0)]);
  return new THREE.TubeGeometry(c, 12, 3.2, 8, false); })();

// =====================================================================
//  model builders
// =====================================================================
function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = shadow; return m; }
// lofted hull: cross-sections from stern (t=0) to bow (t=1)
function loftGeo(nS, ring, cap) {
  const pos = [], uv = [], idx = []; let m = 0;
  for (let i = 0; i <= nS; i++) { const t = i / nS, r = ring(t); m = r.length; for (const q of r) { pos.push(q[0], q[1], q[2]); uv.push(q[3], t); } }
  for (let i = 0; i < nS; i++) for (let j = 0; j < m - 1; j++) { const a = i * m + j, b = a + 1, c = a + m, d = c + 1; idx.push(a, c, b, b, c, d); }
  if (cap) { const r = ring(0); let cy = 0; for (const q of r) cy += q[1]; const ci = pos.length / 3; pos.push(0, cy / m, r[0][2]); uv.push(0.5, 0); for (let j = 0; j < m - 1; j++) idx.push(ci, j, j + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const SKI = {
  z: t => lerp(22, -32, t),
  w: t => 11.5 * (t < 0.35 ? 0.86 + 0.14 * Math.sin(t / 0.35 * Math.PI / 2) : Math.pow(Math.max(0, 1 - Math.pow((t - 0.35) / 0.65, 2.3)), 0.62)),
  keel: t => -6 + 8 * Math.pow(t, 3.2),
  gun: t => 2.5 + 3.5 * t * t,
  crown: t => (1 + 0.95 * Math.exp(-Math.pow((t - 0.6) / 0.17, 2))) * (1 - Math.pow(t, 6)),
};
GEO.skiHull = loftGeo(28, t => { const w = SKI.w(t), g = SKI.gun(t), k = SKI.keel(t), z = SKI.z(t), ch = lerp(k, g, 0.62);
  return [[-w, g, z, 0], [-w * 0.82, ch, z, 0.25], [0, k, z, 0.5], [w * 0.82, ch, z, 0.75], [w, g, z, 1]]; }, true);
GEO.skiDeck = loftGeo(28, t => { const w = SKI.w(t), g = SKI.gun(t), z = SKI.z(t), c = SKI.crown(t), s = Math.min(1, w / 4), u = x => x / 23 + 0.5;
  const P = [[-1, 0], [-0.78, 2.2], [-0.42, 3.1 + 1.5 * c], [0, 3.4 + 2.2 * c], [0.42, 3.1 + 1.5 * c], [0.78, 2.2], [1, 0]];
  return P.map(q => [q[0] * w, g + q[1] * s, z, u(q[0] * w)]); }, true);
GEO.skiBumper = (() => { const pts = []; for (let i = 0; i <= 28; i++) { const t = i / 28; pts.push(new THREE.Vector3(SKI.w(t) + 0.2, SKI.gun(t), SKI.z(t))); }
  const a = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.55, 6, false), b = a.clone().scale(-1, 1, 1); return mergeGeometries([a, b]); })();
GEO.skiSeat = new THREE.CapsuleGeometry(4, 9, 4, 12); GEO.skiSeatR = new THREE.CapsuleGeometry(4.4, 5, 4, 12);
GEO.cowl = new THREE.SphereGeometry(1, 20, 14); GEO.wind = new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI * 0.5);
GEO.mirror = new THREE.SphereGeometry(1, 10, 8); GEO.sponson = new THREE.BoxGeometry(1.6, 2.2, 13); GEO.platform = new THREE.BoxGeometry(15, 1, 4.5);
GEO.barS = new THREE.CylinderGeometry(0.8, 0.8, 16, 8); GEO.gripS = new THREE.CylinderGeometry(1.25, 1.25, 3.4, 8); GEO.barPad = new THREE.BoxGeometry(5, 2.2, 2.4);
GEO.nozzleS = new THREE.CylinderGeometry(2.2, 2.9, 4, 12);
function makeSki(color, num = 7) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const paint = paintMat(color);
  const deck = mesh(GEO.skiDeck, hullMat(color, num));
  g.add(mesh(GEO.skiHull, M.keel), deck, mesh(GEO.skiBumper, M.bumper));
  const seat = mesh(GEO.skiSeat, M.seat, 0, 9.2, 8); seat.rotation.x = Math.PI / 2; seat.scale.set(1, 1, 0.75); g.add(seat);
  const seatR = mesh(GEO.skiSeatR, M.seat2, 0, 10.2, 16.5); seatR.rotation.x = Math.PI / 2 - 0.12; seatR.scale.set(1, 1, 0.72); g.add(seatR);
  const cowl = mesh(GEO.cowl, paint, 0, 10.6, -6); cowl.scale.set(5.6, 3.4, 7.5); g.add(cowl);
  const wind = mesh(GEO.wind, M.glass, 0, 11.6, -7.5, false); wind.scale.set(5, 4.6, 5.5); wind.rotation.x = -0.75; g.add(wind);
  const col = mesh(GEO.column, M.dark, 0, 12.5, -2.6); col.rotation.x = 0.35; col.scale.set(1, 0.6, 1); g.add(col);
  const bar = mesh(GEO.barS, M.chrome, 0, 14.6, -2); bar.rotation.z = Math.PI / 2; g.add(bar);
  const barPad = mesh(GEO.barPad, paint, 0, 14.6, -2); g.add(barPad);
  for (const s of [-1, 1]) {
    const gr = mesh(GEO.gripS, M.dark, s * 7.2, 14.6, -2); gr.rotation.z = Math.PI / 2; g.add(gr);
    const mr = mesh(GEO.mirror, M.chrome, s * 6.6, 14.4, -9.5); mr.scale.set(1.9, 1.3, 0.6); g.add(mr);
    const stalk = mesh(GEO.column, M.dark, s * 5.6, 12.6, -9.2); stalk.scale.set(0.35, 0.45, 0.35); stalk.rotation.z = -s * 0.5; g.add(stalk);
    g.add(mesh(GEO.sponson, M.bumper, s * 10.6, 0.6, 14));
  }
  g.add(mesh(GEO.platform, M.bumper, 0, 3.1, 21.5));
  const noz = mesh(GEO.nozzleS, M.chrome, 0, -1.2, 23.2); noz.rotation.x = Math.PI / 2; g.add(noz);
  const flame = mesh(GEO.flame, M.flame, 0, -1.2, 33, false); flame.rotation.x = -Math.PI / 2; flame.visible = false; g.add(flame);
  return { g, flame, deck, paints: [cowl, barPad] };
}
const RIDER_S = 0.72, RIDER_Y = 3.4, RIDER_Z = 3.7;
function makeRider(vest, helmet) {
  const R = new THREE.Group(); R.rotation.order = 'YXZ'; R.scale.setScalar(RIDER_S); R.position.set(0, RIDER_Y, RIDER_Z);
  const vestMat = vest instanceof THREE.Material ? vest : new THREE.MeshStandardMaterial({ color: vest, roughness: 0.75 });
  const hips = new THREE.Group(); hips.position.set(0, 12, 6); R.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const vestMesh = mesh(GEO.torso, vestMat, 0, 9, 0); torso.add(vestMesh);
  const head = new THREE.Group(); head.position.set(0, 22, -1); torso.add(head);
  const helm = mesh(GEO.head, helmetMat(helmet)); head.add(helm);
  head.add(mesh(GEO.visor, M.glass, 0, 0, 0, false));
  const limb = (geo, mat, x, y, z, off) => { const pv = new THREE.Group(); pv.position.set(x, y, z); const m = mesh(geo, mat, 0, off, 0); pv.add(m); return pv; };
  const lArm = limb(GEO.arm, M.skin, -6.8, 15, 0, -6), rArm = limb(GEO.arm, M.skin, 6.8, 15, 0, -6);
  torso.add(lArm, rArm);
  const lLeg = limb(GEO.leg, M.shorts, -3.5, 0, 0, -7), rLeg = limb(GEO.leg, M.shorts, 3.5, 0, 0, -7);
  for (const l of [lLeg, rLeg]) l.add(mesh(GEO.boot, M.dark, 0, -14, -1.5));
  hips.add(lLeg, rLeg);
  return { R, hips, torso, head, lArm, rArm, lLeg, rLeg, vest: vestMesh, helm };
}
function poseRider(r, mode, t, lean = 0, seed = 0) {
  if (mode === 'ride') {
    r.hips.position.set(lean * 1.5, 12, 6);
    r.torso.rotation.set(-0.38, 0, -lean * 0.3);
    r.lArm.rotation.set(0.95, 0, -0.18 + lean * 0.1); r.rArm.rotation.set(0.95, 0, 0.18 + lean * 0.1);
    r.lLeg.rotation.set(1.15, 0, -0.28); r.rLeg.rotation.set(1.15, 0, 0.28);
  } else if (mode === 'flail') {
    const f = t * 22 + seed;
    r.hips.position.set(0, 12, 6);
    r.torso.rotation.set(Math.sin(t * 9 + seed) * 0.5, 0, Math.sin(t * 7) * 0.3);
    r.lArm.rotation.set(Math.sin(f) * 1.6, 0, -(1.3 + Math.sin(t * 17) * 0.6)); r.rArm.rotation.set(Math.sin(f + 2) * 1.6, 0, 1.3 + Math.sin(t * 15) * 0.6);
    r.lLeg.rotation.set(Math.sin(t * 20 + seed) * 0.9, 0, -0.5); r.rLeg.rotation.set(Math.sin(t * 20 + 3) * 0.9, 0, 0.5);
  } else {
    r.hips.position.set(0, 12, 6);
    r.torso.rotation.set(0, 0, 0);
    r.rArm.rotation.set(0, 0, 2.6 + Math.sin(t * 8) * 0.4); r.lArm.rotation.set(0.3, 0, -0.5 - Math.sin(t * 3) * 0.2);
    r.lLeg.rotation.set(Math.sin(t * 4) * 0.4, 0, -0.1); r.rLeg.rotation.set(-Math.sin(t * 4) * 0.4, 0, 0.1);
  }
}
function makePalm() {
  const g = new THREE.Group();
  g.add(mesh(GEO.trunk, M.bark));
  const top = new THREE.Group(); top.position.set(14, 74, 0); g.add(top);
  for (let i = 0; i < 9; i++) { const l = mesh(GEO.leaf, M.leaf); l.rotation.set(0, i * TAU / 9 + rand(-0.15, 0.15), rand(-0.15, 0.2)); top.add(l); }
  for (let i = 0; i < 3; i++) top.add(mesh(GEO.trunkTop, M.bark, Math.cos(i * 2.1) * 3, -3, Math.sin(i * 2.1) * 3));
  return g;
}
const palmTemplates = [makePalm(), makePalm(), makePalm()];
function makeUmbrella(alt) {
  const g = new THREE.Group();
  g.add(mesh(GEO.pole, M.chrome, 0, 13, 0));
  const c = mesh(GEO.umbCone, alt ? M.umb2 : M.umb1, 0, 27, 0); g.add(c);
  g.add(mesh(GEO.towel, M.towel, 18, 0.5, 10));
  return g;
}
function makeBoat() {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  g.add(mesh(GEO.boatHull, M.white, 0, -3, 0));
  const stripe = mesh(extrudeHullCached(), M.red, 0, -4, 0); stripe.scale.set(1.02, 0.25, 1.02); g.add(stripe);
  g.add(mesh(GEO.boatCabin, M.white, 0, 14, 8));
  const s = mesh(GEO.boatScreen, M.glass, 0, 22, -7, false); s.rotation.x = -0.5; g.add(s);
  const drv = makeRider(0x1d3557, 0xffffff); drv.R.position.set(0, 2, 10); poseRider(drv, 'ride', 0); g.add(drv.R);
  return g;
}
let _bh; function extrudeHullCached() { return _bh || (_bh = extrudeHull(110, 36, 6, 4)); }

// =====================================================================
//  water + terrain
// =====================================================================
await step(62, 'Filling the river…');
const water = new Water(new THREE.PlaneGeometry(9000, 9000), {
  textureWidth: isMobile ? 256 : 512, textureHeight: isMobile ? 256 : 512, waterNormals: TEX.waterN,
  sunDirection: sunDir.clone(), sunColor: 0xfff4e0, waterColor: 0x117a8c, distortionScale: 1.8, fog: true,
});
water.rotation.x = -Math.PI / 2;
water.material.uniforms.size.value = 0.38;
water.material.fragmentShader = water.material.fragmentShader
  .replace('noise.xzy * vec3( 1.5, 1.0, 1.5 )', 'noise.xzy * vec3( 0.55, 1.0, 0.55 )')
  .replace('vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;', 'vec3 scatter = ( 0.55 + 0.45 * max( 0.0, dot( surfaceNormal, eyeDirection ) ) ) * waterColor + vec3( 0.0, 0.035, 0.045 );')
  .replace('reflectionSample + specularLight, reflectance )', 'reflectionSample * 0.85 + specularLight, clamp( reflectance * 0.8, 0.0, 0.75 ) )');
water.material.needsUpdate = true;
{ const obr = water.onBeforeRender; water.onBeforeRender = function (...a) { if (frameNo % QUAL[qi].refl === 0) obr.apply(this, a); }; }
scene.add(water);

await step(68, 'Painting the clouds…');
// cloud dome
TEX.clouds = canvasTex(1024, 256, (g, w, h) => pixels(g, w, h, (x, y, c) => {
  const n = fbm(x / w * 8, y / h * 2, 8, 6, 41), v = y / h; // v=0 top
  const dens = clamp((n - 0.5) * 3.2, 0, 1) * clamp(v * 3, 0, 1) * clamp((1 - v) * 4, 0, 1);
  const shade = 235 + 20 * (1 - v) - n * 30; c[0] = shade; c[1] = shade; c[2] = Math.min(255, shade + 10); c[3] = dens * 230;
}));
TEX.clouds.wrapT = THREE.ClampToEdgeWrapping;
const clouds = new THREE.Mesh(new THREE.SphereGeometry(4500, 48, 16, 0, TAU, 0.08, Math.PI * 0.42),
  new THREE.MeshBasicMaterial({ map: TEX.clouds, color: new THREE.Color(2.2, 2.2, 2.2), transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }));
clouds.renderOrder = -1; scene.add(clouds);

// foam wake trails (ribbons)
TEX.trail = canvasTex(64, 256, (g, w, h) => pixels(g, w, h, (x, y, c) => {
  const u = x / w, n = fbm(u * 4, y / h * 16, 4, 4, 53), edge = Math.pow(Math.abs(u - 0.5) * 2, 2.2);
  c[0] = c[1] = c[2] = 255; c[3] = clamp((n * 0.9 + edge * 0.7 - 0.38) * 2.2, 0, 1) * (1 - Math.pow(Math.abs(u - 0.5) * 2, 8)) * 255;
}));
const trailMat = new THREE.MeshBasicMaterial({ map: TEX.trail, color: new THREE.Color(1.7, 1.7, 1.7), vertexColors: true, transparent: true, depthWrite: false });
class Trail {
  constructor(n = 60) {
    this.n = n; this.pts = []; this.acc = 0; this.dist = 0;
    this.pos = new Float32Array(n * 2 * 3); this.col = new Float32Array(n * 2 * 4); this.uv = new Float32Array(n * 2 * 2);
    const g = new THREE.BufferGeometry(), idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 4)); g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    this.mesh = new THREE.Mesh(g, trailMat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; scene.add(this.mesh);
  }
  update(x, y, on, dt, speed) {
    this.acc += dt;
    const last = this.pts[0];
    if (last) this.dist += Math.hypot(x - last.x, y - last.y) * 0;
    if (this.acc > 0.035) { this.acc = 0; if (last) this.dist += Math.hypot(x - last.x, y - last.y); this.pts.unshift({ x, y, a: on ? Math.min(1, speed / 250) : 0, age: 0, d: this.dist }); if (this.pts.length > this.n) this.pts.pop(); }
    for (const p of this.pts) p.age += dt;
    const P = this.pts, n = this.n;
    for (let i = 0; i < n; i++) {
      const p = P[Math.min(i, P.length - 1)] || { x, y, a: 0, age: 9, d: 0 }, q = P[Math.min(i + 1, P.length - 1)] || p;
      let dx = p.x - q.x, dy = p.y - q.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const w = 9 + p.age * 55, a = i >= P.length ? 0 : p.a * Math.max(0, 1 - p.age / 1.9) * (i === 0 ? 0 : 1);
      const j = i * 6;
      this.pos[j] = p.x - dy * w; this.pos[j + 1] = 0.7; this.pos[j + 2] = p.y + dx * w;
      this.pos[j + 3] = p.x + dy * w; this.pos[j + 4] = 0.7; this.pos[j + 5] = p.y - dx * w;
      const k = i * 8; for (let m = 0; m < 2; m++) { this.col[k + m * 4] = this.col[k + m * 4 + 1] = this.col[k + m * 4 + 2] = 1; this.col[k + m * 4 + 3] = a * 0.85; }
      const u = i * 4; this.uv[u] = 0; this.uv[u + 1] = p.d / 90; this.uv[u + 2] = 1; this.uv[u + 3] = p.d / 90;
    }
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.uv.needsUpdate = true;
  }
  reset() { this.pts = []; }
  dispose() { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}
const PTRAIL = new Trail(70);

const CHUNK = 300;
const OFFS = [-90, -50, -25, -10, -3, 3, 10, 22, 38, 55, 70, 88, 110, 135, 165, 200, 240, 290, 350, 420, 500, 600, 720, 860, 1050, 1300];
function landH(d, z, side) {
  if (d <= 0) return lerp(-0.6, -16, clamp(-d / 60, 0, 1));
  if (d < 55) return 0.4 + d * 0.075 + noise2(z * 0.03, d * 0.05 + side * 7) * 0.8;
  const n = noise2(z * 0.0025 + side * 31, d * 0.004), ridge = 1 - Math.abs(noise2(z * 0.006 + side * 9, d * 0.006) * 2 - 1);
  return 4.5 + (d - 55) * 0.1 + Math.pow(Math.max(0, d - 130) / 360, 1.6) * (30 + 90 * n + 35 * ridge) + noise2(z * 0.02, d * 0.02) * 6 + noise2(z * 0.07, d * 0.07) * 2;
}
const _m4 = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _sc = new THREE.Vector3(), _ps = new THREE.Vector3(), _eu = new THREE.Euler();
function placed(geo, x, y, z, rx, ry, rz, sx, sy, sz) { _eu.set(rx, ry, rz); _qq.setFromEuler(_eu); _m4.compose(_ps.set(x, y, z), _qq, _sc.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz)); return geo.clone().applyMatrix4(_m4); }
await step(76, 'Landscaping the shore…');
const PALM_PARTS = (() => {
  const trunk = [GEO.trunk.clone()], leaves = [];
  for (let i = 0; i < 3; i++) trunk.push(placed(GEO.trunkTop, 14 + Math.cos(i * 2.1) * 3, 71, Math.sin(i * 2.1) * 3, 0, 0, 0, 1));
  for (let i = 0; i < 9; i++) leaves.push(placed(GEO.leaf, 14, 74, 0, 0, i * TAU / 9 + (i % 3) * 0.1, (i % 2 ? 0.12 : -0.1), 1));
  return { trunk: mergeGeometries(trunk), leaves: mergeGeometries(leaves) };
})();
GEO.bush = new THREE.SphereGeometry(1, 7, 5);
const chunks = new Map();
function buildChunk(k) {
  const grp = new THREE.Group(), z0 = -k * CHUNK, rows = CHUNK / 10 + 1, cols = OFFS.length;
  const trunks = [], leaves = [], bushes = [], rocks = [], cones1 = [], cones2 = [], poles = [];
  for (const side of [-1, 1]) {
    const pos = [], uv = [], col = [], bl = [], idx = [];
    for (let r = 0; r < rows; r++) {
      const z = z0 - r * 10, e = rc(z) + side * rh(z);
      for (let c = 0; c < cols; c++) {
        const d = OFFS[c], x = e + side * d, y = landH(d, z, side);
        pos.push(x, y, z); uv.push(x / 70, z / 70);
        bl.push(clamp((d - 48 + noise2(z * 0.02, side) * 22) / 30, 0, 1));
        const tint = 0.78 + 0.4 * noise2(x * 0.012, z * 0.012);
        const wet = d < -4 ? 0.5 : d < 9 ? 0.74 : 1;
        col.push(wet * (d > 50 ? tint * 0.95 : 1), wet * (d > 50 ? tint : 1) * (d < -4 ? 1.03 : 1), wet * (d > 50 ? tint * 0.85 : 1) * (d < -4 ? 1.06 : 1));
      }
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, cc = a + cols, dd = cc + 1;
      if (side > 0) idx.push(a, b, cc, b, dd, cc); else idx.push(a, cc, b, b, cc, dd);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('blend', new THREE.Float32BufferAttribute(bl, 1));
    g.setIndex(idx); g.computeVertexNormals();
    const nrm = g.attributes.normal, rb = new Float32Array(nrm.count);
    for (let i = 0; i < nrm.count; i++) rb[i] = clamp((0.72 - nrm.getY(i)) * 3.0, 0, 0.85) * (bl[i] > 0.5 ? 1 : 0.2);
    g.setAttribute('rockB', new THREE.BufferAttribute(rb, 1));
    const m = new THREE.Mesh(g, terrainMat); m.receiveShadow = true; grp.add(m);
    // shoreline foam ribbon
    const fp = [], fu = [], fi = [];
    for (let r = 0; r < rows; r++) { const z = z0 - r * 10, e = rc(z) + side * rh(z);
      fp.push(e - side * 16, 0.5, z, e + side * 2, 0.5, z); fu.push(0, z / 60, 1, z / 60); }
    for (let r = 0; r < rows - 1; r++) { const a = r * 2; fi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); fg.setIndex(fi);
    const fm = new THREE.Mesh(fg, M.foam); fm.renderOrder = 2; grp.add(fm);
    // vegetation (merged per chunk for speed)
    for (let i = 0; i < 16; i++) {
      const z = z0 - Math.random() * CHUNK, d = Math.random() < 0.6 ? rand(70, 200) : rand(200, 600), x = rc(z) + side * (rh(z) + d), y = landH(d, z, side) - 2, s = rand(0.8, 1.35), ry = rand(0, TAU), lean = rand(-0.12, 0.12);
      trunks.push(placed(PALM_PARTS.trunk, x, y, z, lean, ry, lean, s)); leaves.push(placed(PALM_PARTS.leaves, x, y, z, lean, ry, lean, s));
    }
    for (let i = 0; i < 40; i++) {
      const z = z0 - Math.random() * CHUNK, d = rand(62, 700), x = rc(z) + side * (rh(z) + d), r = rand(6, 16) * (d > 250 ? 1.8 : 1);
      bushes.push(placed(GEO.bush, x, landH(d, z, side) - r * 0.15, z, 0, rand(0, TAU), 0, r, r * rand(0.55, 0.8), r * rand(0.8, 1.2)));
    }
    for (let i = 0; i < 4; i++) {
      const z = z0 - Math.random() * CHUNK, d = rand(30, 500), x = rc(z) + side * (rh(z) + d), r = rand(10, 34);
      rocks.push(placed(pick(GEO.rocks), x, landH(d, z, side) - r * 0.2, z, rand(-0.3, 0.3), rand(0, TAU), 0, r, r * 0.7, r));
    }
    for (let i = 0; i < 2; i++) { if (Math.random() < 0.45) continue;
      const z = z0 - Math.random() * CHUNK, d = rand(18, 40), x = rc(z) + side * (rh(z) + d), y = landH(d, z, side);
      (Math.random() < 0.5 ? cones1 : cones2).push(placed(GEO.umbCone, x, y + 27, z, rand(-0.1, 0.1), rand(0, TAU), rand(-0.1, 0.1), 1));
      poles.push(placed(GEO.pole, x, y + 13, z, 0, 0, 0, 1)); poles.push(placed(GEO.towel, x + 16, y + 0.5, z + 8, 0, rand(-0.5, 0.5), 0, 1)); }
  }
  const add = (arr, mat, shadow = true) => { if (!arr.length) return; const mm = new THREE.Mesh(mergeGeometries(arr), mat); mm.castShadow = shadow; mm.receiveShadow = true; mm.userData.own = true; grp.add(mm); };
  add(trunks, M.bark); add(leaves, M.leaf); add(bushes, bushMat); add(rocks, M.rock); add(cones1, M.umb1); add(cones2, M.umb2); add(poles, umbPoleMat);
  scene.add(grp); chunks.set(k, grp);
}
let chunkBudget = 99;
function updateChunks(refZ) {
  const kMin = Math.floor(-(refZ + 600) / CHUNK), kMax = Math.floor(-(refZ - 3400) / CHUNK);
  let n = 0; for (let k = kMin; k <= kMax && n < chunkBudget; k++) if (!chunks.has(k)) { buildChunk(k); n++; }
  for (const [k, g] of chunks) if (k < kMin - 1 || k > kMax + 1) {
    scene.remove(g); g.traverse(o => { if (o.isMesh && (o.material === terrainMat || o.material === M.foam || o.userData.own)) o.geometry.dispose(); }); chunks.delete(k);
  }
}

// =====================================================================
//  particles (GPU points)
// =====================================================================
const MAXP = 3200;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(MAXP * 3), pSize = new Float32Array(MAXP), pAlpha = new Float32Array(MAXP), pCol = new Float32Array(MAXP * 3);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1));
pGeo.setAttribute('aCol', new THREE.BufferAttribute(pCol, 3));
const pMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: TEX.soft }, scale: { value: 800 } },
  vertexShader: 'attribute float aSize; attribute float aAlpha; attribute vec3 aCol; varying float vA; varying vec3 vC; uniform float scale; void main(){ vA=aAlpha; vC=aCol; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=min(aSize*scale/max(1.0,-mv.z),180.0); gl_Position=projectionMatrix*mv; }',
  fragmentShader: 'uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 c=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC*2.6, c.a*vA); }',
  transparent: true, depthWrite: false,
});
const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; points.renderOrder = 5; scene.add(points);

// =====================================================================
//  audio
// =====================================================================
let AC = null, master, eng, eng2, engFilt, engGain, noiseBuf, muted = false;
function ensureAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.5; master.connect(AC.destination);
    eng = AC.createOscillator(); eng.type = 'sawtooth'; eng2 = AC.createOscillator(); eng2.type = 'square';
    engFilt = AC.createBiquadFilter(); engFilt.type = 'lowpass'; engFilt.frequency.value = 500;
    engGain = AC.createGain(); engGain.gain.value = 0;
    eng.connect(engFilt); eng2.connect(engFilt); engFilt.connect(engGain); engGain.connect(master); eng.start(); eng2.start();
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
}
function noise(dur, freq, q, vol, type) { if (!AC || muted) return; const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05); }
function tone(f1, f2, dur, vol, type) { if (!AC || muted) return; const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'sine'; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05); }
const sfx = {
  splash: () => noise(0.45, 900, 0.7, 0.45),
  bigSplash: () => { noise(1.1, 500, 0.5, 0.8); tone(110, 40, 0.35, 0.4); },
  crash: () => { noise(0.7, 280, 0.8, 0.9, 'lowpass'); tone(170, 35, 0.55, 0.7, 'triangle'); },
  boost: () => { tone(180, 900, 0.45, 0.22, 'sawtooth'); noise(0.6, 2200, 0.6, 0.25); },
  coin: () => tone(900, 1800, 0.1, 0.15, 'square'),
  bonk: () => tone(320, 110, 0.15, 0.3, 'square'),
  jump: () => tone(260, 720, 0.25, 0.18, 'triangle'),
  trick: () => { tone(523, 1046, 0.14, 0.18, 'square'); setTimeout(() => tone(784, 1568, 0.2, 0.18, 'square'), 110); },
  life: () => { tone(523, 523, 0.1, 0.2, 'square'); setTimeout(() => tone(659, 659, 0.1, 0.2, 'square'), 100); setTimeout(() => tone(1046, 1046, 0.2, 0.2, 'square'), 200); },
};

// =====================================================================
//  input
// =====================================================================
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); if (!e.repeat) onKey(e.code); });
addEventListener('keyup', e => { keys[e.code] = false; });
const touch = { l: false, r: false, brake: false, boost: false };
let touchOn = false;
function enableTouch() { if (touchOn) return; touchOn = true; document.getElementById('touch').style.display = 'flex'; document.getElementById('camBtn').style.display = 'flex'; if (!NATIVE) document.getElementById('fsBtn').style.display = 'flex'; }
if (isMobile) enableTouch();
function bindBtn(id, k) {
  const el = document.getElementById(id);
  const on = e => { e.preventDefault(); e.stopPropagation(); ensureAudio(); if (k === 'cam') { toggleCam(); return; } if (k === 'fs') { toggleFS(); return; } touch[k] = true; el.classList.add('on'); if (state === 'paused') state = 'play'; };
  const off = e => { e.preventDefault(); if (k === 'cam' || k === 'fs') return; touch[k] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
}
bindBtn('leftBtn', 'l'); bindBtn('rightBtn', 'r'); bindBtn('brakeBtn', 'brake'); bindBtn('boostBtn', 'boost'); bindBtn('camBtn', 'cam'); bindBtn('fsBtn', 'fs');
function getInput() {
  const L = keys.ArrowLeft || keys.KeyA || touch.l, R = keys.ArrowRight || keys.KeyD || touch.r;
  return { steer: (R ? 1 : 0) - (L ? 1 : 0), up: !!(keys.ArrowUp || keys.KeyW), brake: !!(keys.ArrowDown || keys.KeyS || touch.brake), boost: !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || touch.boost) };
}
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || e.pointerType === 'pen') enableTouch();
  ensureAudio();
  if (hitBtn(e.clientX, e.clientY)) return;
  if (state === 'menu') start(); else if (state === 'over' && G.overT > 0.8) start(); else if (state === 'paused') state = 'play';
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { bankRun(); if (state === 'play') state = 'paused'; } });
addEventListener('pagehide', () => bankRun());
let camMode = 'chase';
function toggleFS() { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {} }
function toggleCam() { camMode = camMode === 'chase' ? 'helmet' : 'chase'; }
function onKey(c) {
  if (c === 'KeyM') { muted = !muted; return; }
  if (c === 'KeyC') { toggleCam(); return; }
  if (c === 'KeyQ') { qi = (qi + 2) % 3; qAuto = false; try { localStorage.setItem('surgeRiderQ', String(qi)); } catch (e) {} applyQuality(); banner('GRAPHICS: ' + QUAL[qi].name, '', '#fff', 1); return; }
  if (c === 'KeyF') { toggleFS(); return; }
  if (state === 'garage') { garKey(c); return; }
  if (c === 'KeyG' && (state === 'menu' || (state === 'over' && G.overT > 0.8))) { openGarage(); return; }
  if (state === 'menu' && (c === 'Enter' || c === 'Space')) { ensureAudio(); start(); }
  else if (state === 'over' && (c === 'Enter' || c === 'Space') && G.overT > 0.8) start();
  else if (c === 'KeyP' || c === 'Escape') { if (state === 'play') state = 'paused'; else if (state === 'paused') state = 'play'; }
}
function loadBest() { try { return +localStorage.getItem('surgeRider3dBest') || 0; } catch (e) { return 0; } }
function saveBest(v) { try { localStorage.setItem('surgeRider3dBest', String(v)); } catch (e) {} }

// =====================================================================
//  player model
// =====================================================================
const PSKI = makeSki(PCOL, 7);
const SHIELD = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 3), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
SHIELD.scale.set(26, 22, 38); SHIELD.position.set(0, 8, -4); SHIELD.visible = false; PSKI.g.add(SHIELD);
const PRIDER = makeRider(0xff5a1f, 0xffffff);
PSKI.g.add(PRIDER.R); scene.add(PSKI.g);

// =====================================================================
//  meta game: star wallet, garage, daily missions (one save blob)
// =====================================================================
const SKIS = [
  { id: 'tangerine', name: 'TANGERINE', col: 0xff7a00, num: 7, price: 0 },
  { id: 'lagoon', name: 'LAGOON', col: 0x1273de, num: 21, price: 150 },
  { id: 'lime', name: 'LIME TWIST', col: 0xb6e300, num: 5, price: 300 },
  { id: 'flamingo', name: 'FLAMINGO', col: 0xff5fa2, num: 88, price: 500 },
  { id: 'midnight', name: 'MIDNIGHT', col: 0x1c2333, num: 13, price: 800 },
  { id: 'gold', name: 'GOLD RUSH', col: 0xe8b923, num: 1, price: 1500 },
];
const RIDERS = [
  { id: 'classic', name: 'CLASSIC', vest: 0xff5a1f, helmet: 0xffffff, price: 0 },
  { id: 'marine', name: 'MARINE', vest: 0x1d6fd8, helmet: 0xffd400, price: 200 },
  { id: 'stealth', name: 'STEALTH', vest: 0x23272e, helmet: 0x2b3038, price: 400 },
  { id: 'coral', name: 'CORAL REEF', vest: 0xff4f79, helmet: 0x35e0c8, price: 600 },
  { id: 'champ', name: 'CHAMPION', vest: 0xf4f4f4, helmet: 0xe8b923, price: 1000 },
];
const MTYPES = {
  stars: { n: [40, 70, 110], text: n => 'Collect ' + n + ' stars' },
  dist: { n: [3000, 5000, 8000], text: n => 'Ride ' + n.toLocaleString() + ' m' },
  tricks: { n: [3, 5, 8], text: n => 'Land ' + n + ' spin tricks' },
  takedowns: { n: [2, 4, 6], text: n => 'Take down ' + n + ' rivals' },
  close: { n: [4, 8, 12], text: n => 'Survive ' + n + ' close calls' },
  score: { n: [15000, 30000, 50000], text: n => 'Score ' + n.toLocaleString() + ' in one run' },
};
const MREWARD = [50, 80, 120], SAVE_KEY = 'surgeRiderSave1';
const S = { v: 1, coins: 0, ski: 'tangerine', rider: 'classic', owned: ['tangerine', 'classic'], day: '', streak: 0, missions: [], top: [], runs: 0 };
try { const o = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (o && o.v === 1) Object.assign(S, o); } catch (e) {}
if (!SKIS.some(k => k.id === S.ski)) S.ski = 'tangerine';
if (!RIDERS.some(k => k.id === S.rider)) S.rider = 'classic';
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
const owns = id => S.owned.includes(id);
const dayKey = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
function rollMissions(key) {
  let h = 2166136261; for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const ks = Object.keys(MTYPES), out = [];
  for (let i = 0; i < 3; i++) { const k = ks.splice(Math.floor(rnd() * ks.length), 1)[0], tier = Math.floor(rnd() * 3); out.push({ k, n: MTYPES[k].n[tier], r: MREWARD[tier], p: 0, done: false }); }
  return out;
}
let dayBonus = 0;
function ensureDay() {
  const now = new Date(), today = dayKey(now); if (S.day === today && S.missions.length === 3) return;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  S.streak = S.day === dayKey(y) ? S.streak + 1 : 1; S.day = today; S.missions = rollMissions(today);
  dayBonus = 20 * Math.min(S.streak, 7); S.coins += dayBonus; save();
}
ensureDay();
function missionVals() { return { stars: G.stars, dist: G.dist / 10, tricks: G.stats.tricks, takedowns: G.stats.takedowns, close: G.stats.close, score: G.score }; }
function tickMissions() {
  const v = missionVals(), p = G.p;
  for (const m of S.missions) {
    if (m.done) continue;
    if (m.k === 'score') m.p = Math.max(m.p, v.score); else m.p += Math.max(0, v[m.k] - G.mprev[m.k]);
    if (m.p >= m.n) { m.done = true; m.p = m.n; S.coins += m.r; save(); sfx.life(); buzz('medium'); pop('MISSION DONE  +' + m.r + ' ★', p.x, p.y, '#7CFFB2', 22, 90); }
  }
  G.mprev = v;
}
function bankRun() { if (!G) return; const d = G.stars - G.banked; if (d > 0) { S.coins += d; G.banked = G.stars; } save(); }
function applySkin(sk, rd) {
  sk = sk || SKIS.find(k => k.id === S.ski); rd = rd || RIDERS.find(k => k.id === S.rider);
  hullMat(PCOL).emissive.setScalar(0); paintMat(PCOL).emissive.setScalar(0);
  PCOL = sk.col; PSKI.deck.material = hullMat(sk.col, sk.num); for (const m of PSKI.paints) m.material = paintMat(sk.col);
  PRIDER.vest.material.color.setHex(rd.vest); PRIDER.helm.material = helmetMat(rd.helmet);
}
const GAR = { row: 0, i: [0, 0] }, garList = row => (row ? RIDERS : SKIS), garItem = row => garList(row)[GAR.i[row]];
function toMenu() { PTRAIL.reset(); repairSki(); newGame(); state = 'menu'; }
function openGarage() { if (state !== 'menu') toMenu(); dayBonus = 0; GAR.row = 0; GAR.i = [SKIS.findIndex(k => k.id === S.ski), RIDERS.findIndex(k => k.id === S.rider)]; state = 'garage'; }
function closeGarage() { applySkin(); state = 'menu'; }
function garEquip(row) { const it = garItem(row); if (owns(it.id)) { S[row ? 'rider' : 'ski'] = it.id; save(); } applySkin(garItem(0), garItem(1)); }
function garStep(row, d) { GAR.row = row; const L = garList(row); GAR.i[row] = (GAR.i[row] + d + L.length) % L.length; garEquip(row); buzz('light'); }
function garBuy(row) { const it = garItem(row); if (owns(it.id) || S.coins < it.price) return; S.coins -= it.price; S.owned.push(it.id); garEquip(row); sfx.life(); buzz('medium'); }
function garKey(c) {
  if (c === 'Escape' || c === 'KeyG' || c === 'Backspace') closeGarage();
  else if (c === 'ArrowUp' || c === 'KeyW' || c === 'ArrowDown' || c === 'KeyS') GAR.row = 1 - GAR.row;
  else if (c === 'ArrowLeft' || c === 'KeyA') garStep(GAR.row, -1);
  else if (c === 'ArrowRight' || c === 'KeyD') garStep(GAR.row, 1);
  else if (c === 'Enter' || c === 'Space') { if (owns(garItem(GAR.row).id)) closeGarage(); else garBuy(GAR.row); }
}

// =====================================================================
//  game state
// =====================================================================
let G, state = 'menu';
applySkin();
function clearWorld() {
  if (G) for (const e of G.ents) killMesh(e);
  if (PRIDER.R.parent !== PSKI.g) { PSKI.g.add(PRIDER.R); PRIDER.R.position.set(0, RIDER_Y, RIDER_Z); PRIDER.R.rotation.set(0, 0, 0); }
}
function newGame() {
  clearWorld();
  G = { t: 0, stars: 0, banked: 0, rank: 0, score: 0, dist: 0, lives: 3, mult: 1, multT: 0, nitro: 60, best: loadBest(), nextLife: 20000, newBest: false,
    stats: { tricks: 0, takedowns: 0, close: 0, wipeouts: 0 },
    p: { shieldT: 0, hits: 0, hitCD: 0, sandT: 0, x: rc(0), y: 0, z: 0, vz: 0, vx: 0, speed: 150, heading: 0, spin: 0, spinV: 0, air: false, hop: false, airT: 0, boostT: 0, invuln: 4, state: 'ride', lean: 0, wakeCD: 0, boosting: false, wasBoost: false },
    lastHaz: 0, lastBig: 0, noHazY: -1500, ents: [], parts: [], pops: [], boom: null, flash: 0, nextY: -700, ts: 1, shake: 0, wipe: null, msg: null, rivalT: 4, overT: 0,
    cam: { pos: new THREE.Vector3(rc(0), 60, 140), yaw: 0, fov: 68, orbit: 0 } };
  G.mprev = missionVals();
  for (let i = 0; i < 3; i++) spawnRival(-260 - i * 260, rand(250, 320));
}
function start() { ensureDay(); dayBonus = 0; applySkin(); PTRAIL.reset(); repairSki(); newGame(); state = 'play'; banner('GO!', 'Warm-up stretch: easy water ahead', '#7CFFB2', 1.8); }
const INTRO = 9000; // ~30 seconds of easy water
const diff = () => clamp((-G.p.y - INTRO) / 48000, 0, 1);
function addScore(n, useMult = true) { const v = Math.round(n * (useMult ? G.mult : 1)); G.score += v; return v; }
function bumpMult(a) { G.mult = Math.min(8, G.mult + a); G.multT = 3.5; }
function pop(text, x, y, col, size, h = 30) { G.pops.push({ text, x, y, h, life: 1.1, max: 1.1, col: col || '#fff', size: size || 22 }); }
function banner(text, sub, col, life, sub2, wob) { G.msg = { text, sub, sub2, col, life, max: life, wob: !!wob }; }

// =====================================================================
//  entities: spawn & meshes
// =====================================================================
function spawnRival(y, spd) {
  const c = rc(y), h = rh(y), ci = (Math.random() * RCOLS.length) | 0;
  const s = spd || rand(230, 330) + diff() * 80;
  G.ents.push({ t: 'rival', x: c + rand(-h * 0.6, h * 0.6), y, z: 0, vz: 0, speed: s, target: s, heading: 0, ci, state: 'ride', wt: 0, spin: 0, spinV: 0, air: false, bumpCD: 0, lean: 0, rider: null, seed: rand(0, 10) });
}
const HAZ = { rock: 1, log: 1, shark: 1, boat: 1, whirl: 1, rockgate: 1, logjump: 1 }, BIG = { shark: 1, boat: 1, whirl: 1, rockgate: 1, logjump: 1 };
function spawnRow(y) {
  const dist = -y, intro = dist < INTRO, d = clamp((dist - INTRO) / 48000, 0, 1), c = rc(y), h = rh(y), E = G.ents;
  const xr = () => c + rand(-h + 45, h - 45);
  const nRiv = E.filter(e => e.t === 'rival').length, hits = G.p.hits;
  const table = intro
    ? [['coins', 30], ['pad', 12], ['ramp', dist > 1200 ? 9 : 0], ['nitro', 8], ['buoy', 8], ['rampcoins', dist > 2500 ? 5 : 0], ['rock', dist > 3000 ? 10 : 0], ['log', dist > 6500 ? 5 : 0], ['rival', nRiv < 4 ? 5 : 0], ['wrench', hits > 0 ? 5 : 0]]
    : [['rock', 20 + d * 14], ['buoy', 9], ['ramp', 8], ['pad', 8], ['nitro', 6], ['coins', 15], ['rampcoins', 5], ['log', 7 + d * 6], ['shark', 4 + d * 7], ['rival', nRiv < 5 ? 6 : 0],
      ['boat', d > 0.08 ? 3 + d * 3 : 0], ['whirl', d > 0.15 ? 3 + d * 3 : 0], ['rockgate', d > 0.35 ? 4 : 0], ['logjump', d > 0.45 ? 3 : 0], ['wrench', hits > 0 ? 3 + hits * 2 : 0], ['shield', 2]];
  let tot = 0; for (const [, w] of table) tot += w;
  let r = Math.random() * tot, type = 'coins'; for (const [k, w] of table) { if ((r -= w) <= 0) { type = k; break; } }
  // fairness: breathing room between hazards, more between the nasty ones, none in a ramp's landing zone
  const hazGap = intro ? 430 : lerp(340, 190, d), bigGap = lerp(950, 480, d);
  if (BIG[type] && G.lastBig - y < bigGap) type = 'rock';
  if (HAZ[type] && (G.lastHaz - y < hazGap || y > G.noHazY)) type = pick(['coins', 'coins', 'buoy', 'pad']);
  if (HAZ[type]) G.lastHaz = y; if (BIG[type]) G.lastBig = y;
  const rock = (x, yy, rad) => E.push({ t: 'rock', x, y: yy, r: rad, seed: Math.random() });
  const ramp = x => { E.push({ t: 'ramp', x, y, w: 72, l: 44 }); G.noHazY = y - 520; };
  switch (type) {
    case 'rock': intro ? rock(c + (Math.random() < 0.5 ? -1 : 1) * rand(h * 0.45, h - 45), y, rand(15, 20)) : rock(xr(), y, rand(16, 28)); break;
    case 'buoy': E.push({ t: 'buoy', x: xr(), y, r: 10, ph: rand(0, TAU), vx: 0, hitCD: 0 }); break;
    case 'ramp': ramp(xr()); break;
    case 'pad': E.push({ t: 'pad', x: xr(), y, w: 54, l: 66, used: false }); break;
    case 'nitro': E.push({ t: 'nitro', x: xr(), y, r: 13 }); break;
    case 'wrench': E.push({ t: 'wrench', x: xr(), y, r: 13 }); break;
    case 'shield': E.push({ t: 'shield', x: xr(), y, r: 13 }); break;
    case 'coins': { const x0 = c + rand(-h + 70, h - 70); for (let i = 0; i < 6; i++) E.push({ t: 'coin', x: x0 + Math.sin(i * 0.7) * 30, y: y - i * 34, r: 10 }); break; }
    case 'log': E.push({ t: 'log', x: xr(), y, len: intro ? 70 : rand(70, 110), a: rand(-0.5, 0.5) }); break;
    case 'shark': E.push({ t: 'shark', bx: c + rand(-h * 0.5, h * 0.5), x: 0, y, amp: rand(40, 110), sp: rand(1.2, 2.4), ph: rand(0, TAU), r: 14, dir: 1 }); break;
    case 'rival': spawnRival(y); break;
    case 'boat': { const dir = Math.random() < 0.5 ? -1 : 1; E.push({ t: 'boat', x: c + rand(-h * 0.4, h * 0.4), y, vx: dir * rand(110, 160), len: 110, wid: 36, wakeT: 0, yaw: dir > 0 ? -Math.PI / 2 : Math.PI / 2 }); break; }
    case 'whirl': E.push({ t: 'whirl', x: c + rand(-h * 0.5, h * 0.5), y, r: 72, rot: 0, cw: Math.random() < 0.5 ? -1 : 1 }); break;
    case 'rockgate': { const gx = c + rand(-h * 0.5, h * 0.5); for (let x = c - h + 18; x <= c + h - 18; x += 44) { if (Math.abs(x - gx) < 95) continue; rock(x, y, rand(17, 22)); } for (let i = -1; i <= 1; i++) E.push({ t: 'coin', x: gx, y: y + i * 40, r: 10 }); break; }
    case 'rampcoins': { const x = c + rand(-h * 0.5, h * 0.5); ramp(x); for (let i = 0; i < 4; i++) E.push({ t: 'coin', x, y: y - 80 - i * 34, r: 10, high: true }); break; }
    case 'logjump': { const x = c + rand(-h * 0.5, h * 0.5); ramp(x); E.push({ t: 'log', x, y: y - 120, len: 110, a: rand(-0.15, 0.15) }); for (let i = 0; i < 3; i++) E.push({ t: 'coin', x, y: y - 90 - i * 30, r: 10, high: true }); break; }
  }
}
GEO.plus = (() => { const s = new THREE.Shape(), a = 3.2, b = 9.5; [[-a, b], [a, b], [a, a], [b, a], [b, -a], [a, -a], [a, -b], [-a, -b], [-a, -a], [-b, -a], [-b, a], [-a, a]].forEach((q, i) => i ? s.lineTo(q[0], q[1]) : s.moveTo(q[0], q[1])); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: true, bevelThickness: 1, bevelSize: 0.8, bevelSegments: 2 }); g.center(); return g; })();
const PICK = { green: new THREE.MeshStandardMaterial({ color: 0x35e06a, emissive: 0x0f7a2c, roughness: 0.3 }), blue: new THREE.MeshPhysicalMaterial({ color: 0x4db8ff, emissive: 0x0a4a9a, roughness: 0.1, clearcoat: 1 }),
  greenGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 16, 4), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
  blueGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 7, 18), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }) };
function createMesh(e) {
  let m;
  switch (e.t) {
    case 'rock': m = mesh(GEO.rocks[(e.seed * 5) | 0], M.rock); m.scale.set(e.r * 1.05, e.r * 0.85, e.r * 1.05); m.position.set(e.x, -e.r * 0.15, e.y); m.rotation.set(rand(-0.3, 0.3), rand(0, TAU), rand(-0.3, 0.3)); break;
    case 'buoy': m = new THREE.Group(); m.add(mesh(GEO.buoy, M.red, 0, 3, 0), mesh(GEO.buoyBand, M.white, 0, 5, 0), mesh(GEO.buoyTop, M.red, 0, 11, 0)); break;
    case 'ramp': m = new THREE.Mesh(GEO.ramp, [M.rampSide, M.wood]); m.castShadow = m.receiveShadow = true; m.position.set(e.x, 0, e.y); break;
    case 'pad': m = new THREE.Mesh(GEO.pad, M.pad); m.scale.set(e.w, 1, e.l); m.position.set(e.x, 0.8, e.y); m.renderOrder = 3; break;
    case 'nitro': m = new THREE.Group(); { const can = mesh(GEO.can, M.red); can.add(mesh(GEO.canCap, M.chrome, 0, 12, 0)); m.add(can); m.userData.can = can;
      const ring = new THREE.Mesh(GEO.glowRing, M.nitroGlow); ring.rotation.x = Math.PI / 2; ring.position.y = -12; m.add(ring); } break;
    case 'coin': m = mesh(GEO.star, M.gold); break;
    case 'wrench': case 'shield': { m = new THREE.Group(); const isW = e.t === 'wrench';
      const core = isW ? mesh(GEO.plus, PICK.green) : mesh(GEO.buoyTop, PICK.blue); if (!isW) core.scale.setScalar(1.8); m.add(core);
      const ring = new THREE.Mesh(GEO.glowRing, isW ? PICK.greenGlow : PICK.blueGlow); m.add(ring); } break;
    case 'log': m = new THREE.Mesh(GEO.log, [M.bark, M.rings, M.rings]); m.castShadow = m.receiveShadow = true; m.scale.set(1, e.len, 1); m.rotation.order = 'YXZ'; m.rotation.set(0, -e.a, Math.PI / 2); m.position.set(e.x, 1.5, e.y); break;
    case 'shark': m = new THREE.Group(); { const f = mesh(GEO.fin, M.shark); f.position.z = -0.8; m.add(f); m.userData.fin = f;
      const b = new THREE.Mesh(GEO.sharkBody, M.sharkBody); b.scale.set(36, 7, 11); b.position.set(-8, -9, 0); m.add(b); } break;
    case 'whirl': m = new THREE.Group(); { const a = new THREE.Mesh(GEO.whirl, M.whirl); a.scale.set(e.r * 2.2, 1, e.r * 2.2); a.position.y = 0.7; const b = a.clone(); b.scale.multiplyScalar(0.7); b.position.y = 0.9; m.add(a, b); m.userData.a = a; m.userData.b = b; m.position.set(e.x, 0, e.y); m.renderOrder = 3; } break;
    case 'boat': m = makeBoat(); break;
    case 'rival': { const s = makeSki(RCOLS[e.ci], e.ci + 2); const r = makeRider(0x222831, RCOLS[e.ci]); s.g.add(r.R); m = s.g; e.ski = s; e.ro = r; e.trail = new Trail(45); } break;
    default: return;
  }
  e.mesh = m; scene.add(m);
}
function killMesh(e) {
  if (e.mesh) { scene.remove(e.mesh); e.mesh = null; }
  if (e.ro && e.ro.R.parent === scene) scene.remove(e.ro.R);
  if (e.trail) { e.trail.dispose(); e.trail = null; }
}

// =====================================================================
//  particles logic
// =====================================================================
function foamP(x, y, s) { const l = rand(0.7, 1.4); return { k: 0, x, y, z: 0, vx: rand(-12, 12), vy: rand(-8, 8), vz: 0, life: l, max: l, size: s }; }
function drop(x, y, vx, vy, vz, s, z = 2, col) { const l = rand(0.6, 1.2); return { k: 1, x, y, z, vx, vy, vz, life: l, max: l, size: s, col }; }
// rising fire / smoke puff: hot = 1 starts as flame and cools to smoke, hot = 0 pure smoke
function puff(x, y, z, s, hot, life) { const l = life || rand(0.8, 1.6); return { k: 3, x, y, z, vx: rand(-25, 25), vy: rand(-25, 25), vz: rand(30, 90), life: l, max: l, size: s, hot }; }
const SAND = [0.85, 0.75, 0.52];
function splash(x, y, n, pow) {
  pow = pow || 1;
  for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(30, 170) * pow; G.parts.push(drop(x, y, Math.cos(a) * s, Math.sin(a) * s * 0.8, rand(120, 380) * pow, rand(2, 4.5) * Math.min(1.6, pow))); }
  for (let i = 0; i < n / 3; i++) G.parts.push(foamP(x + rand(-14, 14) * pow, y + rand(-10, 10) * pow, rand(6, 12) * pow));
  for (let i = 0; i < 10 * pow; i++) { const a = i / (10 * pow) * TAU; const q = foamP(x, y, 6 * pow); q.vx = Math.cos(a) * 90 * pow; q.vy = Math.sin(a) * 90 * pow; G.parts.push(q); }
}
function updateParts(dt) {
  for (const q of G.parts) {
    q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.k === 3) { q.z += q.vz * dt; q.vz *= Math.max(0, 1 - 0.6 * dt); q.size += dt * (q.hot ? 26 : 14); const k = Math.max(0, 1 - 1.5 * dt); q.vx *= k; q.vy *= k; continue; }
    if (q.k === 1) { q.vz -= 900 * dt; q.z += q.vz * dt; if (q.z < 0) { q.life = 0; if (Math.random() < 0.15) G.parts.push(foamP(q.x, q.y, q.size * 1.5)); } }
    else { const k = Math.max(0, 1 - 2.2 * dt); q.vx *= k; q.vy *= k; q.size += dt * 6; }
  }
  G.parts = G.parts.filter(q => q.life > 0);
  if (G.parts.length > MAXP) G.parts.splice(0, G.parts.length - MAXP);
}
function syncParticles() {
  const n = G.parts.length;
  for (let i = 0; i < n; i++) { const q = G.parts[i], j = i * 3;
    pPos[j] = q.x; pPos[j + 1] = q.k === 1 ? q.z : 0.8; pPos[j + 2] = q.y;
    const a = q.life / q.max;
    if (q.k === 3) { pPos[j + 1] = q.z; pSize[i] = q.size * 2; pAlpha[i] = Math.min(1, a * 1.5) * (q.hot ? 0.95 : 0.6);
      const heat = q.hot ? clamp((a - 0.45) * 2.2, 0, 1) : 0, sm = 0.18 + 0.12 * (1 - a);
      pCol[j] = lerp(sm, 1.0, heat); pCol[j + 1] = lerp(sm, 0.55 + 0.4 * heat * heat, heat); pCol[j + 2] = lerp(sm, 0.08, heat); continue; }
    pSize[i] = q.k === 1 ? q.size * 2.2 : q.size * 1.5;
    pAlpha[i] = q.k === 1 ? Math.min(1, a * 1.6) : a * 0.5;
    const cc = q.col; pCol[j] = cc ? cc[0] : 0.96; pCol[j + 1] = cc ? cc[1] : 0.98; pCol[j + 2] = cc ? cc[2] : 1.0; }
  for (let i = n; i < MAXP; i++) pAlpha[i] = 0;
  pGeo.attributes.position.needsUpdate = pGeo.attributes.aSize.needsUpdate = pGeo.attributes.aAlpha.needsUpdate = pGeo.attributes.aCol.needsUpdate = true;
  pGeo.setDrawRange(0, n);
}

// =====================================================================
//  player
// =====================================================================
function nearMiss(e, gap) { if (gap < 34 && G.p.speed > 240 && G.p.z < 5) e.close = true; }
function updatePlayer(dt, d) {
  const p = G.p, inp = getInput(), maxS = (380 + d * 120) * (1 - 0.2 * p.hits);
  p.hitCD = Math.max(0, p.hitCD - dt);
  if (p.shieldT > 0) { p.shieldT -= dt; p.invuln = Math.max(p.invuln, 0.05); }
  p.invuln = Math.max(0, p.invuln - dt); p.wakeCD -= dt;
  p.boosting = false;
  if (inp.boost && G.nitro > 0) { p.boosting = true; G.nitro = Math.max(0, G.nitro - 30 * dt); if (!p.wasBoost) sfx.boost(); }
  p.wasBoost = p.boosting; p.boostT = Math.max(0, p.boostT - dt);
  const boosted = p.boosting || p.boostT > 0;
  let cap = inp.brake ? 0 : maxS * (inp.up ? 1 : 0.74);
  if (boosted && !inp.brake) cap = maxS * 1.5;
  if (!p.air) {
    if (p.speed < cap) p.speed = Math.min(cap, p.speed + (boosted ? 650 : 240) * dt); else p.speed = Math.max(cap, p.speed - (inp.brake ? 420 : 130) * dt);
    const tr = 2.5 * (0.55 + 0.45 * Math.min(1, p.speed / 300));
    p.heading += inp.steer * tr * dt;
    if (!inp.steer) p.heading = lerp(p.heading, 0, Math.min(1, dt * 1.6));
    p.heading = clamp(p.heading, -1.05, 1.05);
    p.lean = lerp(p.lean, inp.steer, Math.min(1, dt * 8));
  } else {
    if (!p.hop) {
      if (inp.steer) { p.spinV += inp.steer * 22 * dt; p.spinV = clamp(p.spinV, -13, 13); }
      else { const tgt = Math.round(p.spin / TAU) * TAU; p.spinV = lerp(p.spinV, (tgt - p.spin) * 5, Math.min(1, dt * 6)); }
      p.spin += p.spinV * dt;
    }
    p.vz -= 850 * dt; p.z += p.vz * dt; p.airT += dt;
    if (p.z <= 0) land();
    if (p.state !== 'ride') return;
  }
  const tvx = Math.sin(p.heading) * p.speed;
  p.vx = lerp(p.vx, tvx, Math.min(1, dt * (p.air ? 0.4 : 3.0)));
  const vy = -Math.cos(p.heading) * p.speed, y0 = p.y;
  p.x += p.vx * dt; p.y += vy * dt;
  const dy = y0 - p.y; if (dy > 0) { G.dist += dy; G.score += dy * 0.1; }
  if (!p.air) {
    const sx = p.x - Math.sin(p.heading) * 20, sy = p.y + Math.cos(p.heading) * 20;
    if (Math.random() < 0.35) G.parts.push(foamP(sx + rand(-4, 4), sy + rand(-3, 3), rand(4, 7) + p.speed / 160));
    if (Math.random() < p.speed / 380) G.parts.push(drop(sx, sy, rand(-30, 30) - Math.sin(p.heading) * 80, Math.cos(p.heading) * rand(60, 160), rand(60, 170) * (boosted ? 1.7 : 1), rand(1.5, 3.2)));
    if (inp.steer && p.speed > 200) for (let i = 0; i < 2; i++) { const side = -inp.steer;
      G.parts.push(drop(p.x + Math.cos(p.heading) * side * 12, p.y + Math.sin(p.heading) * side * 12, Math.cos(p.heading) * side * rand(90, 230), rand(-30, 40), rand(80, 230), rand(1.5, 3.5))); }
  }
  if (p.hits >= 2 && Math.random() < 0.12 * p.hits) G.parts.push(puff(p.x - Math.sin(p.heading) * 14, p.y + Math.cos(p.heading) * 14, p.z + 12, rand(4, 7), p.hits >= 3 && Math.random() < 0.5 ? 1 : 0));
  const lethal = p.invuln <= 0;
  for (const e of G.ents) {
    if (e.dead) continue;
    if (e.close && !e.nm && e.y > p.y + 40) { e.nm = true; const v = addScore(75); G.stats.close++; pop('CLOSE CALL +' + v, p.x, p.y, '#9fffe0', 18, 50); bumpMult(0.5); }
    const dx = p.x - e.x, dy2 = p.y - e.y;
    if (Math.abs(dy2) > 160) continue;
    const dd = Math.hypot(dx, dy2) || 0.001;
    switch (e.t) {
      case 'rock': if (dd < e.r + 11 && p.z < e.r * 0.9) { if (!e.hitDone && p.hitCD <= 0 && lethal) { e.hitDone = true; if (hullHit(e.x, e.y, 'ROCK')) return; }
          const k = (e.r + 11 - dd); p.x += dx / dd * k; p.y += dy2 / dd * k; } else nearMiss(e, dd - e.r - 11); break;
      case 'shark': if (dd < e.r + 11 && p.z < 10) { if (lethal) { wipeout('SHARK ATTACK!'); return; } } else nearMiss(e, dd - e.r - 11); break;
      case 'log': { const s = segDist(p.x, p.y, ...logEnds(e)); if (s < 21 && p.z < 14) { if (!e.hitDone && p.hitCD <= 0 && lethal) { e.hitDone = true; if (hullHit(p.x, p.y - 15, 'LOG')) return; } } else nearMiss(e, s - 21); break; }
      case 'boat': { const s = segDist(p.x, p.y, e.x - e.len / 2, e.y, e.x + e.len / 2, e.y); if (s < e.wid / 2 + 11 && p.z < 30) { if (lethal) { wipeout('T-BONED!'); return; } } else nearMiss(e, s - e.wid / 2 - 11); break; }
      case 'whirl': if (p.z < 2 && dd < e.r) { const k = 1 - dd / e.r; p.x -= dx / dd * 140 * k * dt; p.heading += dt * 2.8 * k * e.cw; p.speed *= 1 - 0.7 * k * dt;
          if (!e.warned) { e.warned = true; pop('WHIRLPOOL!', e.x, e.y, '#bfe9ff', 18); } if (dd < 15 && lethal) { wipeout('SUCKED UNDER!'); return; } } break;
      case 'buoy': if (dd < e.r + 12 && p.z < 12 && e.hitCD <= 0) { const s = Math.sign(dx) || 1; p.vx += s * 220; p.heading += s * 0.25; p.speed *= 0.82; e.vx = -s * 120; e.hitCD = 0.5; sfx.bonk(); G.shake = Math.max(G.shake, 5); pop('BONK', e.x, e.y, '#ffb0a8', 16); splash(e.x, e.y, 8, 0.6); } break;
      case 'ramp': if (!p.air && Math.abs(dx) < e.w / 2 && Math.abs(dy2) < e.l / 2 && p.speed > 110) { p.air = true; p.hop = false; p.vz = clamp(p.speed * 1.0, 260, 640); p.airT = 0; p.spin = 0; p.spinV = 0; p.z = 18; sfx.jump(); splash(p.x, p.y, 10, 0.8); } break;
      case 'pad': if (Math.abs(dx) < e.w / 2 && Math.abs(dy2) < e.l / 2 && p.z < 5) { p.boostT = 1.5; p.speed = Math.max(p.speed, maxS * 1.3); if (!e.used) { e.used = true; sfx.boost(); pop('BOOST!', p.x, p.y, '#7ffcff', 22, 50); G.shake = Math.max(G.shake, 4); } } break;
      case 'wrench': if (dd < e.r + 16 && p.z < 40) { e.dead = true; if (p.hits > 0) p.hits--; sfx.life(); pop('HULL REPAIRED', e.x, e.y, '#7CFFB2', 20, 40); } break;
      case 'shield': if (dd < e.r + 16 && p.z < 40) { e.dead = true; p.shieldT = 7; sfx.life(); pop('SHIELD!', e.x, e.y, '#8fd0ff', 22, 40); } break;
      case 'nitro': if (dd < e.r + 14 && p.z < 40) { e.dead = true; G.nitro = Math.min(100, G.nitro + 40); sfx.coin(); pop('+NITRO', e.x, e.y, '#ffb24d', 18); } break;
      case 'coin': if (dd < e.r + 14 && (e.high ? true : p.z < 40)) { e.dead = true; G.stars++; const v = addScore(50); sfx.coin(); pop('+' + v, e.x, e.y, '#ffe14d', 15, e.high ? 70 : 20); } break;
      case 'wake': if (dd < 15 && !p.air && p.wakeCD <= 0 && p.speed > 170) { p.air = true; p.hop = true; p.vz = 140 + p.speed * 0.15; p.airT = 0; p.wakeCD = 0.5; splash(p.x, p.y, 6, 0.5); } break;
      case 'rival':
        if (e.state === 'ride' && dd < 24 && Math.abs(p.z - e.z) < 16 && e.bumpCD <= 0) {
          e.bumpCD = 0.4;
          if (boosted || (p.air && p.vz < 0)) { const how = p.air ? 'STOMPED!' : 'TAKEDOWN!'; rivalWipe(e, true); const v = addScore(400); G.stars += 3; buzz('medium'); G.stats.takedowns++; bumpMult(1); banner(how, '+' + v, '#ff7ab0', 1.1); G.shake = Math.max(G.shake, 10); sfx.crash(); }
          else { const s = Math.sign(dx) || 1; p.vx += s * 200; e.x -= s * 14; e.heading -= s * 0.3; p.speed *= 0.86; sfx.bonk(); G.shake = Math.max(G.shake, 6); pop('BUMP', p.x, p.y, '#fff', 16);
            if (p.speed - e.speed > 230 && lethal && -p.y > INTRO) { wipeout('REAR-ENDED!'); return; } }
        }
        break;
    }
  }
  const c = rc(p.y), h = rh(p.y);
  if (Math.abs(p.x - c) > h - 14 && p.z < 5) {
    const side = Math.sign(p.x - c);
    p.x = c + side * (h - 14); p.vx = -side * Math.max(40, Math.abs(p.vx) * 0.3);
    p.heading = lerp(p.heading, -side * 0.35, Math.min(1, dt * 6)); p.speed = Math.max(Math.min(p.speed, 90), p.speed * (1 - 3.2 * dt));
    p.sandT -= dt; if (p.sandT <= 0) { p.sandT = 1.2; pop('SAND!', p.x, p.y, '#f2d48a', 16, 30); sfx.bonk(); G.shake = Math.max(G.shake, 3); }
    for (let i = 0; i < 3; i++) G.parts.push(drop(p.x + side * 8, p.y, side * rand(20, 120), rand(-40, 60), rand(60, 200), rand(1.5, 3.5), 2, SAND));
  }
}
function hullHit(x, y, what) {
  const p = G.p;
  p.hits++; p.hitCD = 0.9;
  G.shake = Math.max(G.shake, 14); sfx.crash(); buzz('heavy');
  for (let i = 0; i < 14; i++) G.parts.push(drop(x, y, rand(-160, 160), rand(-160, 160), rand(120, 320), rand(1.5, 3), 6, [1, 0.75, 0.3]));
  splash(p.x, p.y, 18, 1);
  if (p.hits >= 5) { explode(); return true; }
  p.speed *= 0.35; p.vx = -p.vx * 0.5 + (Math.random() < 0.5 ? -1 : 1) * 90; p.heading *= -0.4;
  banner('HULL HIT ' + p.hits + '/5', '−20% TOP SPEED', p.hits >= 4 ? '#ff4d2e' : '#ffb24d', 1.2, p.hits === 4 ? 'ONE MORE AND IT BLOWS!' : what + '!');
  return false;
}
// big fireball
const fireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 11, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(40, 30, 12), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const FIRE = new THREE.Group(); { const g = new THREE.SphereGeometry(1, 28, 18); FIRE.add(new THREE.Mesh(g, fireMat), new THREE.Mesh(g, coreMat)); FIRE.visible = false; scene.add(FIRE); }
const boomLight = new THREE.PointLight(0xff8a30, 0, 1400, 1.4); scene.add(boomLight);
const wreckMat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.95 });
function explode() {
  const p = G.p;
  wipeout('KABOOM!', true);
  const w = G.wipe;
  w.rider.vz = 560; w.rider.vx += rand(-120, 120); w.rider.z += 10;
  w.ski.vz = 380; w.ski.pitchV = rand(6, 10) * (Math.random() < 0.5 ? -1 : 1); w.ski.pitch = 0; w.boom = true;
  G.boom = { x: p.x, y: p.y, t: 0 }; G.flash = 1; G.shake = 32; G.msg = null;
  PSKI.g.traverse(o => { if (o.isMesh && (o.material === hullMat(PCOL) || o.material === paintMat(PCOL))) { o.userData.orig = o.material; o.material = wreckMat; } });
  for (let i = 0; i < 70; i++) G.parts.push(puff(p.x + rand(-20, 20), p.y + rand(-20, 20), rand(5, 40), rand(10, 22), 1, rand(1.2, 2.4)));
  for (let i = 0; i < 40; i++) G.parts.push(drop(p.x, p.y, rand(-260, 260), rand(-260, 260), rand(200, 520), rand(2, 4), 10, [1, 0.6, 0.15]));
  splash(p.x, p.y, 50, 1.8);
  noise(2.2, 120, 0.5, 1.2, 'lowpass'); tone(90, 25, 1.4, 0.9, 'sawtooth');
}
function updateBoom(dtr) {
  const b = G.boom; G.flash = Math.max(0, G.flash - dtr * 2.2);
  if (!b) { FIRE.visible = false; boomLight.intensity = 0; return; }
  b.t += dtr;
  const t = b.t, grow = 1 - Math.pow(1 - Math.min(1, t / 0.45), 3), fade = clamp(1 - (t - 0.5) / 1.3, 0, 1);
  FIRE.visible = fade > 0; FIRE.position.set(b.x, 20 + t * 22, b.y);
  FIRE.children[0].scale.setScalar(10 + grow * 85 + Math.sin(t * 40) * 3); FIRE.children[1].scale.setScalar(6 + grow * 50);
  fireMat.opacity = 0.75 * fade; coreMat.opacity = 0.9 * fade * fade;
  boomLight.position.set(b.x, 50, b.y); boomLight.intensity = 9e5 * fade * fade;
  if (t < 1.4 && Math.random() < 0.8) G.parts.push(puff(b.x + rand(-40, 40), b.y + rand(-40, 40), rand(10, 60), rand(10, 20), 1));
  if (t > 4) G.boom = null;
}

function land() {
  const p = G.p; p.z = 0; p.air = false; p.vz = 0;
  if (p.hop) { p.hop = false; splash(p.x, p.y, 8, 0.6); return; }
  const n = ((p.spin % TAU) + TAU) % TAU, off = Math.min(n, TAU - n);
  if (off > 0.62) { p.invuln = 0; wipeout('BAD LANDING!'); return; }
  const rots = Math.round(Math.abs(p.spin) / TAU);
  splash(p.x, p.y, 26, 1.1); sfx.splash(); G.shake = Math.max(G.shake, 5);
  if (rots > 0) { const v = addScore(350 * rots * rots); bumpMult(rots); G.stars += 2 * rots; buzz('medium'); G.stats.tricks++; banner((rots * 360) + '°!', '+' + v, '#ffe14d', 1.1, off > 0.3 ? 'SKETCHY LANDING' : 'CLEAN!'); sfx.trick(); }
  else if (p.airT > 0.75) { const v = addScore(150); pop('BIG AIR +' + v, p.x, p.y, '#9ff', 20, 40); bumpMult(0.5); }
  p.spin = 0; p.spinV = 0; p.speed *= 0.93;
}

// =====================================================================
//  wipeouts
// =====================================================================
function makeR(x, y, z, vx, vy, vz) { return { x, y, z, vx, vy, vz, rot: rand(0, TAU), vr: rand(-12, 12), bounces: 0, swim: false, seed: rand(0, 10) }; }
function updRider(r, dt, isPlayer) {
  if (!r.swim) {
    r.vz -= 900 * dt; r.z += r.vz * dt; r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.vr * dt;
    if (r.z <= 0) {
      r.z = 0; splash(r.x, r.y, r.bounces === 0 ? 44 : 18, r.bounces === 0 ? 1.6 : 0.9);
      if (isPlayer) { if (r.bounces === 0) sfx.bigSplash(); else sfx.splash(); G.shake = Math.max(G.shake, r.bounces === 0 ? 12 : 5); }
      if (r.bounces < 2 && -r.vz > 200) { r.vz = -r.vz * 0.42; r.vx *= 0.6; r.vy *= 0.6; r.vr *= 0.7; r.bounces++; } else { r.vz = 0; r.swim = true; }
    }
  } else {
    const k = Math.max(0, 1 - 3 * dt); r.vx *= k; r.vy *= k; r.x += r.vx * dt; r.y += r.vy * dt;
    if (Math.random() < 0.2) G.parts.push(foamP(r.x + rand(-6, 6), r.y + rand(-4, 4), rand(3, 6)));
  }
}
function wipeout(reason, silent) {
  const p = G.p; if (p.state !== 'ride') return;
  p.state = 'wipe'; G.stats.wipeouts++; buzz('heavy');
  const vy = -Math.cos(p.heading) * p.speed, sp = p.speed;
  G.wipe = { t: 0, reason, rider: makeR(p.x, p.y - 6, p.z + 14, p.vx * 0.9 + rand(-80, 80), vy * 0.95, 220 + sp * 0.55),
    ski: { x: p.x, y: p.y, vx: p.vx * 0.6 + rand(-60, 60), vy: vy * 0.55, rot: p.heading + p.spin, vr: rand(-9, 9) * (0.5 + sp / 500), roll: 0, rollT: (Math.random() < 0.5 ? -1 : 1) * rand(1.0, 1.9), z: p.z } };
  scene.attach(PRIDER.R);
  G.cam.orbit = G.cam.yaw;
  splash(p.x, p.y, 55, 1.5); sfx.crash(); G.shake = 20; G.ts = 0.22;
  if (!silent) banner('WIPEOUT!', reason, '#ff4d2e', 2.6, pick(QUIPS), true);
  G.mult = 1; G.multT = 0; p.air = false; p.z = 0; p.boostT = 0;
}
function updateWipe(dt) {
  const w = G.wipe; w.t += dt;
  updRider(w.rider, dt, true);
  const s = w.ski, k = Math.max(0, 1 - 1.4 * dt);
  s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= k; s.vy *= k; s.rot += s.vr * dt; s.vr *= Math.max(0, 1 - 1.2 * dt);
  s.roll = lerp(s.roll, s.rollT, Math.min(1, dt * 3));
  if (s.vz !== undefined) { s.vz -= 900 * dt; s.z += s.vz * dt; s.pitch += s.pitchV * dt; if (s.z <= 0) { if (s.vz < -150) { splash(s.x, s.y, 30, 1.2); sfx.splash(); } s.z = 0; s.vz = 0; s.pitchV *= 0.3; s.pitch = lerp(s.pitch, Math.round(s.pitch / Math.PI) * Math.PI, Math.min(1, dt * 4)); } }
  else s.z = Math.max(0, s.z - 300 * dt);
  if (w.boom && Math.random() < 0.5) G.parts.push(puff(s.x, s.y, s.z + 6, rand(5, 9), Math.random() < 0.4 ? 1 : 0));
  if (Math.hypot(s.vx, s.vy) > 50) { G.parts.push(foamP(s.x, s.y, rand(6, 10))); if (Math.random() < 0.8) G.parts.push(drop(s.x, s.y, rand(-80, 80), rand(-80, 80), rand(80, 240), rand(2, 4))); }
  if (w.t > (w.boom ? 3.6 : 2.9) && G.p.state === 'wipe') endWipe();
}
function endWipe() {
  const p = G.p, w = G.wipe;
  G.lives--;
  if (G.lives <= 0) { gameOver(); return; }
  const ry = Math.min(w.ski.y, w.rider.y);
  p.y = ry; p.x = rc(ry);
  for (const e of G.ents) {
    if (['rock', 'log', 'shark', 'whirl', 'boat'].includes(e.t) && e.y > ry - 400 && e.y < ry + 120) e.dead = true;
    if (e.t === 'rival' && Math.abs(e.y - ry) < 80 && Math.abs(e.x - p.x) < 40) e.x += 60;
  }
  G.wipe = null; PTRAIL.reset(); repairSki(); p.hits = 0; p.state = 'ride'; p.invuln = 2.5; p.speed = 170; p.heading = 0; p.vx = 0; p.spin = 0; p.spinV = 0; p.z = 0; p.air = false; p.hop = false;
  PSKI.g.add(PRIDER.R); PRIDER.R.position.set(0, RIDER_Y, RIDER_Z); PRIDER.R.rotation.set(0, 0, 0);
  banner('BACK ON!', G.lives + (G.lives === 1 ? ' life left' : ' lives left'), '#7CFFB2', 1.3);
}
function repairSki() { PSKI.g.traverse(o => { if (o.isMesh && o.userData.orig) { o.material = o.userData.orig; delete o.userData.orig; } }); }
function gameOver() {
  G.p.state = 'dead'; state = 'over'; G.overT = 0;
  const s = Math.floor(G.score); if (s > G.best) { G.best = s; G.newBest = true; saveBest(s); }
  S.runs++; S.top.push(s); S.top.sort((a, b) => b - a); S.top.length = Math.min(5, S.top.length); G.rank = S.top.indexOf(s) + 1;
  bankRun(); native('score', { score: s });
  G.msg = null;
}
function rivalWipe(r, byPlayer) {
  r.state = 'wipe'; r.wt = 0;
  r.rider = makeR(r.x, r.y, 12, rand(-120, 120), -r.speed * 0.8, 200 + r.speed * 0.4);
  r.skiRot = r.heading; r.vr = rand(-8, 8); r.svx = rand(-80, 80); r.air = false; r.z = 0; r.roll = 0; r.rollT = (Math.random() < 0.5 ? -1 : 1) * rand(1, 1.8);
  if (r.ro) scene.attach(r.ro.R);
  splash(r.x, r.y, 34, 1.2);
  if (!byPlayer && Math.abs(r.y - G.p.y) < 600) { pop('RIVAL WIPEOUT!', r.x, r.y, '#ffc2c2', 17, 40); sfx.splash(); }
}

// =====================================================================
//  entity update
// =====================================================================
function updRival(r, dt) {
  r.bumpCD -= dt;
  if (r.state === 'wipe') {
    r.wt += dt; updRider(r.rider, dt, false);
    r.speed *= Math.max(0, 1 - 1.3 * dt); r.skiRot += r.vr * dt; r.vr *= Math.max(0, 1 - 1.5 * dt); r.roll = lerp(r.roll, r.rollT, Math.min(1, dt * 3));
    r.x += r.svx * dt; r.y -= r.speed * dt; r.svx *= Math.max(0, 1 - 1.5 * dt);
    if (r.wt > 3) { r.state = 'ride'; r.x = clamp(r.rider.x, rc(r.rider.y) - rh(r.rider.y) + 30, rc(r.rider.y) + rh(r.rider.y) - 30); r.y = r.rider.y; r.speed = 80; r.heading = 0; r.rider = null; r.roll = 0;
      if (r.ro && r.ski) { r.ski.g.add(r.ro.R); r.ro.R.position.set(0, RIDER_Y, RIDER_Z); r.ro.R.rotation.set(0, 0, 0); } }
    return;
  }
  let steer = 0; const look = 150 + r.speed * 0.35;
  for (const e of G.ents) {
    if (e === r || e.dead) continue;
    const dy = r.y - e.y; if (dy < 0 || dy > look) continue;
    const dx = (e.t === 'shark' ? e.bx : e.x) - r.x; let w;
    switch (e.t) {
      case 'rock': w = e.r + 26; break; case 'shark': w = e.amp + 30; break; case 'log': w = e.len / 2 + 22; break;
      case 'whirl': w = e.r + 10; break; case 'boat': w = e.len / 2 + 40; break;
      case 'rival': if (e.state !== 'ride') continue; w = 26; break;
      case 'ramp': if (Math.abs(dx) < 90) steer += clamp(dx / 40, -1, 1) * 0.5; continue;
      default: continue;
    }
    if (Math.abs(dx) < w) steer += (dx > 0 ? -1 : 1) * (1.6 - dy / look);
  }
  const c = rc(r.y - 100), h = rh(r.y - 100);
  steer += clamp((c - r.x) / (h * 0.8), -1, 1) * 0.8 * Math.abs((r.x - c) / h);
  r.heading = lerp(r.heading, clamp(steer, -1, 1) * 0.7, Math.min(1, dt * 3.5));
  r.lean = lerp(r.lean, clamp(steer, -1, 1), Math.min(1, dt * 6));
  r.speed = lerp(r.speed, r.target, Math.min(1, dt * 0.7));
  r.x += Math.sin(r.heading) * r.speed * dt; r.y -= Math.cos(r.heading) * r.speed * dt;
  if (r.air) { r.vz -= 850 * dt; r.z += r.vz * dt; r.spin += r.spinV * dt; if (r.z <= 0) { r.z = 0; r.air = false; r.spin = 0; splash(r.x, r.y, 12, 0.8); } }
  else if (Math.random() < 0.15) G.parts.push(foamP(r.x - Math.sin(r.heading) * 20, r.y + Math.cos(r.heading) * 20, rand(4, 7)));
  const c2 = rc(r.y), h2 = rh(r.y); if (Math.abs(r.x - c2) > h2 - 16) r.x = c2 + Math.sign(r.x - c2) * (h2 - 16);
  if (r.z < 5) for (const e of G.ents) {
    if (e.dead || e === r || Math.abs(e.y - r.y) > 120) continue;
    let hit = false;
    if (e.t === 'rock') hit = Math.hypot(e.x - r.x, e.y - r.y) < e.r + 10;
    else if (e.t === 'shark') hit = Math.hypot(e.x - r.x, e.y - r.y) < e.r + 10;
    else if (e.t === 'log') hit = segDist(r.x, r.y, ...logEnds(e)) < 20;
    else if (e.t === 'boat') hit = segDist(r.x, r.y, e.x - e.len / 2, e.y, e.x + e.len / 2, e.y) < e.wid / 2 + 10;
    else if (e.t === 'ramp' && !r.air && Math.abs(e.x - r.x) < e.w / 2 && Math.abs(e.y - r.y) < e.l / 2) {
      r.air = true; r.vz = clamp(r.speed, 260, 560); r.spin = 0; r.z = 18; r.spinV = Math.random() < 0.6 ? (Math.random() < 0.5 ? -1 : 1) * TAU / (2 * r.vz / 850) : 0; }
    if (hit) { rivalWipe(r, false); break; }
  }
}
function updateEnts(dt) {
  const refY = G.p.state === 'ride' ? G.p.y : (G.wipe ? G.wipe.ski.y : G.p.y);
  for (const e of G.ents) {
    if (e.dead) continue;
    switch (e.t) {
      case 'rival': updRival(e, dt); if (e.y > refY + 900 || e.y < refY - 3400) e.dead = true; break;
      case 'shark': { const a = G.t * e.sp + e.ph; e.x = e.bx + Math.sin(a) * e.amp; e.dir = Math.cos(a) >= 0 ? 1 : -1; if (Math.random() < 0.6) G.parts.push(foamP(e.x - e.dir * 8, e.y + rand(-3, 3), rand(3, 5))); break; }
      case 'buoy': e.x += e.vx * dt; e.vx *= Math.max(0, 1 - 3 * dt); e.hitCD -= dt; break;
      case 'whirl': e.rot += dt * 2.2 * e.cw; if (Math.random() < 0.5) { const a = rand(0, TAU), rr = rand(20, e.r); G.parts.push(foamP(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr, rand(3, 5))); } break;
      case 'boat': {
        e.x += e.vx * dt; const c = rc(e.y), h = rh(e.y);
        if ((e.vx > 0 && e.x + e.len / 2 > c + h - 20) || (e.vx < 0 && e.x - e.len / 2 < c - h + 20)) { e.vx = -e.vx; splash(e.x + Math.sign(-e.vx) * e.len / 2, e.y, 12, 0.8); }
        e.yaw = lerp(e.yaw, e.vx > 0 ? -Math.PI / 2 : Math.PI / 2, Math.min(1, dt * 4));
        e.wakeT -= dt;
        if (e.wakeT <= 0) { e.wakeT = 0.08; const sx = e.x - Math.sign(e.vx) * e.len * 0.5;
          G.ents.push({ t: 'wake', x: sx, y: e.y - 8, vy: -45, age: 0 }, { t: 'wake', x: sx, y: e.y + 8, vy: 45, age: 0 });
          G.parts.push(foamP(sx, e.y + rand(-6, 6), rand(7, 11))); G.parts.push(drop(sx, e.y, -Math.sign(e.vx) * rand(30, 90), rand(-30, 30), rand(60, 140), rand(2, 3.5))); }
        break; }
      case 'wake': e.age += dt; e.y += e.vy * dt; e.vy *= Math.max(0, 1 - 0.6 * dt); if (Math.random() < 0.12) G.parts.push(foamP(e.x, e.y, rand(4, 7))); if (e.age > 3.5) e.dead = true; break;
    }
    if (e.t !== 'rival' && e.y > refY + 800) e.dead = true;
  }
  for (const e of G.ents) if (e.dead) killMesh(e);
  G.ents = G.ents.filter(e => !e.dead);
}

// =====================================================================
//  main update
// =====================================================================
function update(dtr) {
  const p = G.p, w = G.wipe;
  if (w && w.t < 0.9) G.ts = lerp(G.ts, 0.28, Math.min(1, dtr * 10)); else G.ts = lerp(G.ts, 1, Math.min(1, dtr * 2.5));
  const dt = dtr * G.ts;
  G.t += dt;
  if (p.state === 'ride') updatePlayer(dt, diff());
  if (G.wipe) updateWipe(dt);
  const sy = G.wipe ? Math.min(G.wipe.ski.y, G.wipe.rider.y) : p.y;
  while (G.nextY > sy - 2700) { spawnRow(G.nextY); G.nextY -= rand(130, 210) * (-G.nextY < INTRO ? 1.3 : 1 - 0.35 * diff()); }
  if (p.state === 'ride') { G.rivalT -= dt; if (G.rivalT <= 0) { G.rivalT = rand(5, 10); if (G.ents.filter(e => e.t === 'rival').length < 5) spawnRival(p.y + 520, rand(330, 400) + diff() * 80); } }
  updateEnts(dt); updateParts(dt);
  if (G.multT > 0) { G.multT -= dt; if (G.multT <= 0) G.mult = 1; }
  for (const q of G.pops) q.life -= dtr; G.pops = G.pops.filter(q => q.life > 0);
  if (G.msg) { G.msg.life -= dtr; if (G.msg.life <= 0) G.msg = null; }
  G.shake = Math.max(0, G.shake - dtr * 30);
  updateBoom(dtr);
  if (G.score >= G.nextLife) { G.nextLife += 20000; if (G.lives < 5 && p.state === 'ride') { G.lives++; pop('EXTRA LIFE!', p.x, p.y, '#7CFFB2', 24, 60); sfx.life(); } }
}

// =====================================================================
//  sync 3D scene
// =====================================================================
function syncScene(dtr) {
  const t = G.t, p = G.p;
  // entities
  for (const e of G.ents) {
    if (e.t === 'wake') continue;
    if (!e.mesh) createMesh(e);
    const m = e.mesh; if (!m) continue;
    switch (e.t) {
      case 'buoy': m.position.set(e.x, Math.sin(t * 3 + e.ph) * 1.2 - 1, e.y); m.rotation.set(Math.sin(t * 2 + e.ph) * 0.12, 0, Math.cos(t * 2.3 + e.ph) * 0.12); break;
      case 'nitro': m.position.set(e.x, 18 + Math.sin(t * 3 + e.x) * 2, e.y); m.userData.can.rotation.y = t * 2; m.children[1].scale.setScalar(1 + Math.sin(t * 6) * 0.1); break;
      case 'wrench': case 'shield': m.position.set(e.x, 18 + Math.sin(t * 3 + e.x) * 2, e.y); m.rotation.y = t * 2.2; m.children[1].scale.setScalar(1 + Math.sin(t * 6) * 0.1); break;
      case 'coin': m.position.set(e.x, (e.high ? 70 : 14) + Math.sin(t * 3 + e.y) * 1.5, e.y); m.rotation.y = t * 3 + e.y * 0.05; break;
      case 'shark': m.position.set(e.x, 0, e.y); m.scale.x = e.dir; break;
      case 'whirl': m.userData.a.rotation.y = -e.rot; m.userData.b.rotation.y = -e.rot * 1.6; break;
      case 'boat': m.position.set(e.x, Math.sin(t * 2 + e.y) * 0.8, e.y); m.rotation.set(0.03, e.yaw, Math.sin(t * 1.7) * 0.03); break;
      case 'rival':
        if (e.state === 'wipe') {
          m.position.set(e.x, Math.sin(t * 3) * 0.6 - 2, e.y); m.rotation.set(0, -e.skiRot, e.roll);
          placeFlung(e.ro, e.rider, t);
        } else {
          m.position.set(e.x, e.z + Math.sin(t * 6 + e.seed) * 0.6, e.y);
          m.rotation.set(e.air ? clamp(e.vz / 1400, -0.35, 0.45) : 0.04 + e.speed / 9000, -(e.heading + e.spin), -e.lean * 0.32);
          poseRider(e.ro, 'ride', t, e.lean);
        }
        e.ski.flame.visible = false;
        if (e.trail) e.trail.update(e.x - Math.sin(e.heading) * 18, e.y + Math.cos(e.heading) * 18, e.state === 'ride' && !e.air, dtr * G.ts, e.speed);
        break;
    }
  }
  // player
  const g = PSKI.g;
  if (G.wipe) {
    const s = G.wipe.ski; g.visible = true;
    g.position.set(s.x, s.z + Math.sin(t * 3) * 0.6 - 2, s.y); g.rotation.set(s.pitch || 0, -s.rot, s.roll);
    PSKI.flame.visible = false; SHIELD.visible = false;
    placeFlung(PRIDER, G.wipe.rider, t);
  } else {
    g.position.set(p.x, p.z + (p.air ? 0 : Math.sin(t * 7) * 0.7), p.y);
    g.rotation.set(p.air ? clamp(p.vz / 1400, -0.35, 0.45) : 0.04 + p.speed / 8000, -(p.heading + p.spin), p.air ? -p.lean * 0.15 : -p.lean * 0.34);
    poseRider(PRIDER, 'ride', t, p.lean);
    const boosted = p.state === 'ride' && (p.boosting || p.boostT > 0);
    PSKI.flame.visible = boosted; if (boosted) PSKI.flame.scale.set(1 + Math.random() * 0.3, 0.8 + Math.random() * 0.6, 1);
    g.visible = true;
    SHIELD.visible = p.state === 'ride' && p.shieldT > 0; SHIELD.material.opacity = 0.13 + 0.05 * Math.sin(G.t * 8) - (p.shieldT < 1.5 && ((G.t * 8) | 0) % 2 ? 0.08 : 0);
    paintMat(PCOL).emissive.copy(hullMat(PCOL).emissive.setRGB(0.25, 0.9, 0.6).multiplyScalar(state === 'play' && p.state === 'ride' && p.invuln > 0 ? 0.25 + 0.2 * Math.sin(G.t * 10) : 0));
  }
  { const pt = G.wipe ? G.wipe.ski : p, hd = G.wipe ? G.wipe.ski.rot : p.heading;
    PTRAIL.update(pt.x - Math.sin(hd) * 18, pt.y + Math.cos(hd) * 18, G.wipe ? Math.hypot(G.wipe.ski.vx, G.wipe.ski.vy) > 40 : (p.state === 'ride' && !p.air), dtr * G.ts, G.wipe ? 200 : p.speed); }
  PRIDER.head.visible = !(camMode === 'helmet' && !G.wipe && state !== 'menu' && state !== 'garage');
  TEX.pad.offset.y = (t * 1.2) % 1;
  TEX.foam.offset.y = (t * 0.05) % 1;
}
function placeFlung(ro, r, t) {
  if (!ro) return;
  if (r.swim) {
    ro.R.position.set(r.x, -12 + Math.sin(t * 4 + r.seed) * 1.2, r.y); ro.R.rotation.set(0, r.rot * 0.2, 0); poseRider(ro, 'swim', t);
  } else {
    ro.R.position.set(r.x, r.z - 4, r.y); ro.R.rotation.set(r.rot * 0.9, r.rot * 0.3, r.rot * 0.6); poseRider(ro, 'flail', t, 0, r.seed);
  }
}

// =====================================================================
//  camera
// =====================================================================
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _look = new THREE.Vector3(), _e = new THREE.Euler();
function updateCamera(dtr) {
  const p = G.p, C = G.cam;
  let fovT = 68;
  if (state === 'menu' || state === 'garage') {
    const a = performance.now() / 1000 * (state === 'garage' ? 0.35 : 0.18), R = state === 'garage' ? 88 : 105;
    _v.set(p.x + Math.sin(a) * R, state === 'garage' ? 40 : 48, p.y + Math.cos(a) * R); C.pos.lerp(_v, damp(dtr, 2));
    camera.position.copy(C.pos); camera.lookAt(p.x, 14, p.y);
  } else if (G.wipe) {
    const w = G.wipe, mx = (w.rider.x + w.ski.x) / 2, my = (w.rider.y + w.ski.y) / 2, mh = Math.max(8, w.rider.z * 0.5);
    C.orbit += dtr * 0.35;
    _v.set(mx + Math.sin(C.orbit) * 150, 75 + mh * 0.3, my + Math.cos(C.orbit) * 150);
    C.pos.lerp(_v, damp(dtr, 2.5));
    camera.position.copy(C.pos); camera.lookAt(mx, mh, my);
    fovT = 58;
  } else if (camMode === 'helmet' && p.state === 'ride') {
    PSKI.g.updateMatrixWorld(true);
    _v.set(0, 28, 1.5).applyMatrix4(PSKI.g.matrixWorld);
    C.pos.copy(_v); camera.position.copy(_v);
    PSKI.g.getWorldQuaternion(_q); camera.quaternion.copy(_q);
    _e.set(-0.16, 0, 0); camera.quaternion.multiply(_q.setFromEuler(_e));
    fovT = 76 + Math.min(1, p.speed / 550) * 16 + ((p.boosting || p.boostT > 0) ? 8 : 0);
  } else {
    C.yaw = lerp(C.yaw, p.heading * 0.6, damp(dtr, 2.5));
    const fx = Math.sin(C.yaw), fz = -Math.cos(C.yaw);
    C.h = lerp(C.h || 0, p.z, damp(dtr, 2.5));
    _v.set(p.x - fx * 170, 112 + C.h * 0.6, p.y - fz * 170);
    C.pos.lerp(_v, damp(dtr, 6));
    camera.position.copy(C.pos);
    C.lx = lerp(C.lx === undefined ? p.x : C.lx, p.x + fx * 300, damp(dtr, 5));
    _look.set(C.lx, C.h * 0.6, p.y + fz * 300); camera.lookAt(_look);
    fovT = 58 + Math.min(1, p.speed / 550) * 14 + ((p.boosting || p.boostT > 0) ? 6 : 0);
  }
  C.fov = lerp(C.fov, fovT, damp(dtr, 3));
  camera.fov = C.fov; camera.updateProjectionMatrix();
  if (G.shake > 0) { const s = G.shake * 0.35; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s; }
  // follow objects
  const fx = camera.position.x, fz = camera.position.z;
  water.position.set(fx, 0, fz); sky.position.copy(camera.position);
  const tz = G.wipe ? G.wipe.ski.y : p.y, tx = G.wipe ? G.wipe.ski.x : p.x;
  const snap = 600 / sun.shadow.mapSize.x * 2; sun.target.position.set(Math.round(tx / snap) * snap, 0, Math.round((tz - 150) / snap) * snap); sun.position.copy(sun.target.position).addScaledVector(sunDir, 1200);
  clouds.position.set(camera.position.x, 0, camera.position.z); clouds.rotation.y = clock.water * 0.004;
  pMat.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  updateChunks(Math.min(tz, camera.position.z));
}

// =====================================================================
//  HUD (2D overlay)
// =====================================================================
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function txt(s, x, y, size, col, align, stroke) {
  ctx.font = '900 ' + size + 'px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  if (stroke !== false) { ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = 'rgba(0,25,50,.85)'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}
function miniSki(x, y) {
  ctx.save(); ctx.translate(x, y); ctx.scale(0.55, 0.55);
  ctx.fillStyle = '#ffcc00'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -28); ctx.quadraticCurveTo(13, -16, 12, 4); ctx.lineTo(11, 18); ctx.quadraticCurveTo(0, 22, -11, 18); ctx.lineTo(-12, 4); ctx.quadraticCurveTo(-13, -16, 0, -28); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#222'; rr(-5, -2, 10, 18, 4); ctx.fill(); ctx.restore();
}
// canvas buttons: redrawn every frame, hit-tested on pointerdown
let BTNS = [];
function btn(label, x, y, w, h, fn, o) {
  o = o || {}; const size = o.size || Math.min(18, h * 0.42);
  ctx.fillStyle = o.off ? 'rgba(0,0,0,.4)' : (o.bg || 'rgba(255,212,0,.94)'); rr(x - w / 2, y - h / 2, w, h, Math.min(14, h / 2)); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,25,50,.7)'; ctx.stroke();
  txt(label, x, y + size * 0.36, size, o.off ? '#9fb3c2' : (o.fg || '#00314a'), 'center', false);
  if (!o.off) BTNS.push({ x: x - w / 2, y: y - h / 2, w, h, fn });
}
function hitBtn(x, y) { for (const b of BTNS) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.fn(); return true; } return false; }
const uiScale = () => Math.min(1, CW / 520, CH / 560);
function drawWallet(withGarage) {
  txt('★ ' + S.coins.toLocaleString(), SAFE.l + 14, SAFE.t + 34, 22, '#ffe14d');
  if (withGarage) btn('GARAGE', CW - SAFE.r - 68, SAFE.t + 30, 108, 44, openGarage, { size: 16 });
}
function drawHUD() {
  const p = G.p, pad = 14, top = pad + SAFE.t, L = pad + SAFE.l, R = CW - pad - SAFE.r;
  txt(Math.floor(G.score).toLocaleString(), L, top + 28, 30, '#fff');
  txt(Math.floor(G.dist / 10) + ' m', L, top + 48, 14, '#bfe9ff');
  txt('★ ' + G.stars, L, top + 68, 14, '#ffe14d');
  if (G.mult > 1) { txt('x' + (Math.round(G.mult * 10) / 10), L, top + 98, 24, '#ffe14d'); ctx.fillStyle = 'rgba(255,225,77,.85)'; ctx.fillRect(L, top + 105, 64 * (G.multT / 3.5), 4); }
  for (let i = 0; i < G.lives; i++) miniSki(R - 10 - i * 20, top + 16);
  txt(Math.round((p.state === 'ride' ? p.speed : 0) * 0.2) + ' km/h', R, top + 56, 18, '#fff', 'right');
  const bw = 110, bx = R - bw, by = top + 66;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; rr(bx, by, bw, 12, 6); ctx.fill();
  if (G.nitro > 1) { const g = ctx.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#ffcf3a'); g.addColorStop(1, '#ff4d2e'); ctx.fillStyle = g; rr(bx, by, Math.max(12, bw * G.nitro / 100), 12, 6); ctx.fill(); }
  txt('NITRO', bx - 6, by + 11, 11, '#ffd27a', 'right');
  const hy = by + 20, sw = (bw - 8) / 5;
  for (let i = 0; i < 5; i++) { const ok = i < 5 - p.hits; ctx.fillStyle = ok ? (p.hits >= 3 ? '#ff6a3d' : '#58e07a') : 'rgba(0,0,0,.35)'; rr(bx + i * (sw + 2), hy, sw, 10, 4); ctx.fill(); }
  txt('HULL', bx - 6, hy + 10, 11, p.hits >= 3 ? '#ff8a6a' : '#9ff0b4', 'right');
  if (muted) txt('MUTED', CW / 2, top + 20, 12, '#ccc', 'center');
}
function drawScreenFX() {
  const p = G.p;
  if (p.state === 'ride' && (p.boosting || p.boostT > 0)) {
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < 22; i++) { const a = rand(0, TAU), r0 = rand(0.25, 0.4) * Math.max(CW, CH), l = rand(60, 160); const cx = CW / 2 + Math.cos(a) * r0, cy = CH * 0.45 + Math.sin(a) * r0; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); }
    ctx.stroke();
  }
  if (G.ts < 0.95) { const g = ctx.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * 0.3, CW / 2, CH / 2, Math.max(CW, CH) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(110,0,0,' + ((1 - G.ts) * 0.55) + ')'); ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH); }
  if (p.air && !p.hop && p.state === 'ride') { const n = ((p.spin % TAU) + TAU) % TAU, off = Math.min(n, TAU - n);
    txt(off < 0.62 ? 'STRAIGHT — LAND IT!' : 'SPINNING…', CW / 2, CH * 0.8, 16, off < 0.62 ? '#7CFFB2' : '#ffb24d', 'center'); }
}
function drawBanner() {
  const m = G.msg; if (!m) return;
  const age = m.max - m.life, s = age < 0.15 ? 0.4 + age / 0.15 * 0.85 : age < 0.3 ? 1.25 - (age - 0.15) * 1.66 : 1;
  ctx.save(); ctx.globalAlpha = Math.min(1, m.life / 0.3); ctx.translate(CW / 2, CH * 0.3);
  if (m.wob) ctx.rotate(Math.sin(age * 20) * 0.08 * Math.max(0, 1 - age));
  ctx.scale(s, s); const size = Math.min(86, CW / 6.5);
  txt(m.text, 0, 0, size, m.col, 'center'); if (m.sub) txt(m.sub, 0, size * 0.6, size * 0.32, '#fff', 'center'); if (m.sub2) txt(m.sub2, 0, size * 1.0, size * 0.27, '#ffe14d', 'center');
  ctx.restore();
}
function drawPops() {
  for (const q of G.pops) {
    _v.set(q.x, q.h, q.y).project(camera); if (_v.z > 1) continue;
    const a = q.life / q.max, sx = (_v.x * 0.5 + 0.5) * CW, sy = (-_v.y * 0.5 + 0.5) * CH - (1 - a) * 45;
    ctx.globalAlpha = Math.min(1, a * 2); txt(q.text, sx, sy, q.size, q.col, 'center');
  }
  ctx.globalAlpha = 1;
}
function overlay(a) { ctx.fillStyle = 'rgba(4,24,44,' + a + ')'; ctx.fillRect(0, 0, CW, CH); }
function drawMissions(y, s) {
  const done = S.missions.filter(m => m.done).length;
  txt('DAILY MISSIONS  ' + done + '/3' + (S.streak > 1 ? '   ·   DAY ' + S.streak + ' STREAK' : ''), CW / 2, y, 13 * s, '#bfe9ff', 'center');
  S.missions.forEach((m, i) => txt((m.done ? '✓ ' : '') + MTYPES[m.k].text(m.n) + (m.done ? '' : '   ' + Math.floor(m.p).toLocaleString() + '/' + m.n.toLocaleString()) + '   +' + m.r + ' ★', CW / 2, y + (i + 1) * 23 * s, 15 * s, m.done ? '#7CFFB2' : '#fff', 'center'));
}
function drawMenu() {
  const g = ctx.createLinearGradient(0, 0, 0, CH); g.addColorStop(0, 'rgba(4,24,44,.55)'); g.addColorStop(0.5, 'rgba(4,24,44,.15)'); g.addColorStop(1, 'rgba(4,24,44,.65)'); ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  const s = uiScale(), ty = Math.max(CH * 0.18, SAFE.t + 64 + 48 * s);
  drawWallet(true);
  txt('SURGE RIDER', CW / 2, ty, 64 * s, '#ffd400', 'center');
  txt('3D', CW / 2, ty + 52 * s, 40 * s, '#fff', 'center');
  txt(dayBonus ? 'Daily bonus  +' + dayBonus + ' ★' : 'Jetski chaos. Big air. Bigger wipeouts.', CW / 2, ty + 84 * s, 17 * s, dayBonus ? '#ffe14d' : '#e6f6ff', 'center');
  const my = CH * 0.56; drawMissions(my, s);
  const lines = touchOn ? ['◀ ▶ steer  ·  in the air: spin, let go to land straight', 'NITRO boosts  ·  hold BRAKE to stop  ·  5 hull hits and it blows']
    : ['←/→ steer  ·  ↑ throttle  ·  hold ↓ to stop  ·  SPACE nitro  ·  in the air: spin', 'G garage  ·  C camera  ·  F fullscreen  ·  Q graphics  ·  P pause  ·  M mute'];
  lines.forEach((l, i) => txt(l, CW / 2, my + 108 * s + i * 20 * s, Math.max(10, 13 * s), '#d8efff', 'center'));
  const pulse = 0.85 + Math.sin(performance.now() / 250) * 0.15;
  txt(touchOn ? 'TAP TO RIDE' : 'PRESS SPACE TO RIDE', CW / 2, CH * 0.9, 26 * s * pulse, '#ffd400', 'center');
  if (G.best) txt('BEST ' + G.best.toLocaleString(), CW / 2, CH * 0.9 + 28 * s, 15 * s, '#bfe9ff', 'center');
}
function drawGarage() {
  const g = ctx.createLinearGradient(0, 0, 0, CH); g.addColorStop(0, 'rgba(4,24,44,.6)'); g.addColorStop(0.3, 'rgba(4,24,44,0)'); g.addColorStop(0.55, 'rgba(4,24,44,0)'); g.addColorStop(1, 'rgba(4,24,44,.75)'); ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  const s = uiScale(); drawWallet(false);
  btn('DONE', CW - SAFE.r - 58, SAFE.t + 30, 88, 44, closeGarage, { size: 16 });
  txt('GARAGE', CW / 2, SAFE.t + 34 + 44 * s, 40 * s, '#ffd400', 'center');
  const ax = Math.min(CW / 2 - 34, 170 * s + 30);
  for (const row of [0, 1]) {
    const it = garItem(row), y = CH - SAFE.b - (row ? 70 : 160) * Math.max(s, 0.8) - 20, own = owns(it.id), L = garList(row);
    txt((row ? 'RIDER' : 'SKI') + '  ' + (GAR.i[row] + 1) + '/' + L.length, CW / 2, y - 24 * s, 12 * s, '#bfe9ff', 'center');
    txt(it.name, CW / 2, y, 24 * s, GAR.row === row ? '#ffd400' : '#fff', 'center');
    btn('‹', CW / 2 - ax, y - 4, 48, 48, () => garStep(row, -1), { size: 30, bg: 'rgba(255,255,255,.9)' });
    btn('›', CW / 2 + ax, y - 4, 48, 48, () => garStep(row, 1), { size: 30, bg: 'rgba(255,255,255,.9)' });
    if (own) txt('EQUIPPED', CW / 2, y + 24 * s, 13 * s, '#7CFFB2', 'center');
    else btn((S.coins >= it.price ? 'BUY  ' : 'NEED  ') + it.price.toLocaleString() + ' ★', CW / 2, y + 26 * s, 150, 34, () => garBuy(row), { size: 14, off: S.coins < it.price });
  }
}
function drawOver() {
  overlay(Math.min(0.55, G.overT)); const s = uiScale();
  if (G.overT > 0.8) drawWallet(true);
  txt('GAME OVER', CW / 2, CH * 0.27, 64 * s, '#ff4d2e', 'center');
  txt(Math.floor(G.score).toLocaleString(), CW / 2, CH * 0.27 + 70 * s, 52 * s, '#fff', 'center');
  if (G.newBest) txt('NEW BEST!', CW / 2, CH * 0.27 + 104 * s, 22 * s, '#ffd400', 'center'); else txt((G.rank ? '#' + G.rank + ' OF YOUR TOP 5   ·   ' : '') + 'BEST ' + G.best.toLocaleString(), CW / 2, CH * 0.27 + 104 * s, 18 * s, '#bfe9ff', 'center');
  const st = G.stats;
  [`Stars  +${G.stars} ★`, `Distance  ${Math.floor(G.dist / 10)} m`, `Spin tricks  ${st.tricks}`, `Takedowns  ${st.takedowns}`, `Close calls  ${st.close}`, `Missions today  ${S.missions.filter(m => m.done).length}/3`].forEach((l, i) => txt(l, CW / 2, CH * 0.5 + i * 25 * s, 17 * s, i === 0 ? '#ffe14d' : '#fff', 'center'));
  if (G.overT > 0.8) { const pulse = 0.85 + Math.sin(performance.now() / 250) * 0.15; txt(touchOn ? 'TAP TO RIDE AGAIN' : 'SPACE TO RIDE AGAIN  ·  G GARAGE', CW / 2, CH * 0.86, 24 * s * pulse, '#ffd400', 'center'); }
}
function drawBay() {
  if (G.flash > 0) { ctx.fillStyle = 'rgba(255,240,200,' + (G.flash * 0.8) + ')'; ctx.fillRect(0, 0, CW, CH); }
  const b = G.boom; if (!b || b.t > 2.2) return;
  _v.set(b.x, 40, b.y).project(camera);
  const fx = (_v.x * 0.5 + 0.5) * CW, fy = (-_v.y * 0.5 + 0.5) * CH;
  const e = Math.min(1, b.t / 0.5), ease = 1 + 2.2 * Math.pow(e - 1, 3) + 1.2 * Math.pow(e - 1, 2);
  const x = lerp(fx, CW / 2, e), y = lerp(fy, CH * 0.42, e);
  const size = Math.min(110, CW / 6.2) * Math.max(0.05, ease);
  const flashOn = ((b.t / 0.11) | 0) % 2 === 0;
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(b.t * 30) * 0.03 * (1 - e * 0.5));
  ctx.font = '900 ' + size + 'px Impact,"Arial Black",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.shadowColor = flashOn ? '#ff6a00' : '#ffffff'; ctx.shadowBlur = 40;
  ctx.lineWidth = size / 7; ctx.strokeStyle = flashOn ? '#3a0a00' : '#ff3d00'; ctx.strokeText('MICHAEL BAY', 0, 0);
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  if (flashOn) { g.addColorStop(0, '#fff7c2'); g.addColorStop(0.45, '#ffc21a'); g.addColorStop(1, '#ff3d00'); } else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ffe08a'); }
  ctx.fillStyle = g; ctx.fillText('MICHAEL BAY', 0, 0);
  ctx.restore();
}
function drawOverlay() {
  ctx.setTransform(HDPR, 0, 0, HDPR, 0, 0); ctx.clearRect(0, 0, CW, CH); BTNS = [];
  drawScreenFX(); drawPops();
  if (state === 'play' || state === 'paused') { drawHUD(); drawBanner(); }
  drawBay();
  if (state === 'paused') { overlay(0.5); txt('PAUSED', CW / 2, CH * 0.45, 56, '#fff', 'center'); txt(touchOn ? 'Tap to continue' : 'Press P to continue', CW / 2, CH * 0.45 + 36, 16, '#bfe9ff', 'center'); }
  if (state === 'menu') drawMenu();
  if (state === 'garage') drawGarage();
  if (state === 'over') drawOver();
}

function engineAudio() {
  if (!AC || !engGain) return;
  const p = G.p, on = state === 'play' && p.state === 'ride' && !muted;
  const f = 45 + p.speed * 0.2 * (p.air ? 1.35 : 1) + ((p.boosting || p.boostT > 0) ? 25 : 0), t = AC.currentTime;
  eng.frequency.setTargetAtTime(f, t, 0.05); eng2.frequency.setTargetAtTime(f * 1.01, t, 0.05);
  engFilt.frequency.setTargetAtTime(300 + p.speed * 3, t, 0.1); engGain.gain.setTargetAtTime(on ? 0.07 : 0, t, 0.08);
}

// =====================================================================
//  loop
// =====================================================================
const clock = { water: 0 };
newGame();
await step(82, 'Building the river…');
// warm-up: put one of everything in view so all shaders compile behind the loading screen
const warm = [];
{ const p = G.p, kinds = ['rock', 'buoy', 'ramp', 'pad', 'nitro', 'coin', 'log', 'shark', 'whirl', 'boat'];
  kinds.forEach((t, i) => { const e = { t, x: p.x + (i - 5) * 30, y: p.y - 150 - i * 20, r: 15, seed: 0.3, len: 80, a: 0, w: 72, l: 44, ph: 0, vx: 1, amp: 10, sp: 1, bx: p.x, dir: 1, yaw: 0, rot: 0, cw: 1 };
    createMesh(e); warm.push(e); }); }
const wreckDummy = new THREE.Mesh(GEO.hull, wreckMat); wreckDummy.position.set(G.p.x, 0, -120); scene.add(wreckDummy);
FIRE.visible = true; FIRE.position.set(G.p.x, 20, -200);
G.parts.push(puff(G.p.x, -100, 10, 5, 1), drop(G.p.x, -100, 0, 0, 0, 2));
syncScene(0.016); updateCamera(0.016); syncParticles();
await step(88, 'Warming up the graphics card…');
try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); } catch (e) { renderer.compile(scene, camera); }
await step(95, 'Almost there…');
renderer.shadowMap.needsUpdate = true; composer.render(0.016);
for (const e of warm) killMesh(e);
scene.remove(wreckDummy); FIRE.visible = false; G.parts.length = 0;
await step(100, 'Ready!');
if (LD.el) { LD.el.classList.add('done'); setTimeout(() => LD.el.remove(), 700); }
chunkBudget = 2;
let last = performance.now(), perfAcc = 0, perfN = 0, padsShown = true;
const padEls = ['touch', 'camBtn', 'fsBtn'].map(id => document.getElementById(id));
function frame(now) {
  const raw = (now - last) / 1000, dtr = Math.min(0.05, raw); last = now; frameNo++;
  if (qAuto && state === 'play' && raw < 0.5) { perfAcc += raw; if (++perfN >= 150) { if (perfAcc / perfN > 1 / 42 && qi > 0) { qi--; applyQuality(); pop('GRAPHICS: ' + QUAL[qi].name, G.p.x, G.p.y, '#fff', 15, 70); } perfAcc = 0; perfN = 0; } }
  if (frameNo % QUAL[qi].shadow === 0) renderer.shadowMap.needsUpdate = true;
  const pads = state === 'play' || state === 'paused'; if (pads !== padsShown) { padsShown = pads; for (const el of padEls) el.style.visibility = pads ? '' : 'hidden'; }
  if (state === 'play') { update(dtr); tickMissions(); }
  else if (state === 'over') { G.overT += dtr; update(dtr); }
  else if (state === 'menu' || state === 'garage') { G.t += dtr; }
  clock.water += dtr * (G.ts || 1);
  water.material.uniforms.time.value = clock.water * 0.9;
  syncScene(dtr);
  updateCamera(dtr);
  syncParticles();
  engineAudio();
  composer.render(dtr);
  drawOverlay();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
}
boot().catch(fail);
