
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
const RENDER_WIDTH = 2400;
const MAX_PIXELS = 30e6;
const MIN_SLICE = 30;

export async function fileToCanvas(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return isPdf ? pdfToCanvas(file) : imageToCanvas(file);
}

async function pdfToCanvas(file) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push(await doc.getPage(i));
  const base = pages.map((p) => p.getViewport({ scale: 1 }));
  const maxW = Math.max(...base.map((v) => v.width));
  let scale = RENDER_WIDTH / maxW;
  const totalH = base.reduce((a, v) => a + v.height, 0);
  if (RENDER_WIDTH * totalH * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (maxW * totalH));
  const out = document.createElement('canvas');
  out.width = Math.round(maxW * scale);
  out.height = Math.round(totalH * scale);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  let y = 0;
  for (const page of pages) {
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: '#ffffff' }).promise;
    ctx.drawImage(c, 0, y);
    y += c.height;
  }
  return out;
}

async function imageToCanvas(file) {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height)));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

function analysisData(src) {
  const w = 600, k = src.width / w, h = Math.round(src.height / k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h, k };
}

const inked = (d, i) => Math.min(d[i], d[i + 1], d[i + 2]) < 238;

export function detectCrop(src) {
  const { data, w, h, k } = analysisData(src);
  const colFill = new Float32Array(w), rowFill = new Float32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (inked(data, (y * w + x) * 4)) { colFill[x]++; rowFill[y]++; }
  }
  const first = (arr, n, t) => { for (let i = 0; i < arr.length; i++) if (arr[i] / n > t) return i; return 0; };
  const last = (arr, n, t) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] / n > t) return i + 1; return arr.length; };
  let x0 = first(colFill, h, 0.5), x1 = last(colFill, h, 0.5);
  let y0 = first(rowFill, w, 0.5), y1 = last(rowFill, w, 0.5);
  if (x1 - x0 < w * 0.3 || y1 - y0 < h * 0.2) { x0 = 0; x1 = w; y0 = 0; y1 = h; }
  return { x: Math.round(x0 * k), y: Math.round(y0 * k), w: Math.round((x1 - x0) * k), h: Math.round((y1 - y0) * k) };
}

export function detectCuts(src, crop) {
  const { data, w, k } = analysisData(src);
  const x0 = Math.round(crop.x / k), x1 = Math.round((crop.x + crop.w) / k);
  const y0 = Math.round(crop.y / k), y1 = Math.round((crop.y + crop.h) / k);
  const med = [], flat = [];
  const R = [], G = [], B = [];
  for (let y = y0; y < y1; y++) {
    R.length = G.length = B.length = 0;
    let l1 = 0, l2 = 0;
    for (let x = x0; x < x1; x += 3) {
      const i = (y * w + x) * 4;
      R.push(data[i]); G.push(data[i + 1]); B.push(data[i + 2]);
      const l = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11; l1 += l; l2 += l * l;
    }
    const m = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    med.push([m(R), m(G), m(B)]);
    const n = R.length, lm = l1 / n;
    flat.push(Math.sqrt(Math.max(0, l2 / n - lm * lm)) < 14);
  }
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const scale600 = 600 / (x1 - x0);
  const minGap = MIN_SLICE / scale600;
  const P = 5;
  const EDGE = 2;
  const band = (from) => {
    if (from < 0 || from + P > med.length) return null;
    const c = med[from];
    for (let r = from; r < from + P; r++) if (!flat[r] || dist(med[r], c) > 20) return null;
    return c;
  };
  const differs = (from, c) => {
    if (from < 0 || from + P > med.length) return 0;
    let min = Infinity;
    for (let r = from; r < from + P; r++) min = Math.min(min, dist(med[r], c));
    return min > 40 ? min : 0;
  };
  const cand = [];
  for (let i = EDGE + P; i <= med.length - EDGE - P; i++) {
    if (dist(med[i], med[i - 1]) < 12) continue;
    const above = band(i - EDGE - P), below = band(i + EDGE);
    const d = Math.max(above ? differs(i + EDGE, above) : 0, below ? differs(i - EDGE - P, below) : 0);
    if (!d) continue;
    let best = i, bestD = -1;
    for (let r = i - EDGE; r <= i + EDGE; r++) { const dd = dist(med[r], med[r - 1]); if (dd > bestD) { bestD = dd; best = r; } }
    cand.push({ y: best, d });
  }
  cand.sort((a, b) => b.d - a.d);
  const picked = [];
  for (const c of cand) {
    if (c.y < minGap || med.length - c.y < minGap) continue;
    if (picked.every((p) => Math.abs(p - c.y) >= minGap * 1.5)) picked.push(c.y);
  }
  return picked.sort((a, b) => a - b).map((y) => Math.round((y + y0) * k));
}

export async function cutSlices(src, crop, cuts, { width = 600, retina = true, quality = 0.82, format = 'image/jpeg' } = {}) {
  const outW = width * (retina ? 2 : 1);
  const ys = [crop.y, ...cuts.filter((y) => y > crop.y && y < crop.y + crop.h).sort((a, b) => a - b), crop.y + crop.h];
  const slices = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const sh = ys[i + 1] - ys[i];
    if (sh < 2) continue;
    const outH = Math.round(sh * outW / crop.w);
    const c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(src, crop.x, ys[i], crop.w, sh, 0, 0, outW, outH);
    const blob = await new Promise((r) => c.toBlob(r, format, quality));
    slices.push({ blob, width: outW, height: outH, bg: edgeColour(ctx, outW, outH) });
  }
  return slices;
}

function edgeColour(ctx, w, h) {
  const d = ctx.getImageData(0, 0, 1, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function openSlicer(src, { width = 600 } = {}) {
  return new Promise((resolve) => {
    let crop = detectCrop(src);
    let cuts = detectCuts(src, crop);
    let retina = true, quality = 0.82, format = 'image/jpeg';

    const el = document.createElement('div');
    el.className = 'nq-slicer';
    el.innerHTML = `
      <div class="bar">
        <b>Slice your flyer</b>
        <span class="hint">Click to add a cut · drag a line to move it · × removes it · blue dashed lines are the trim edges</span>
        <span class="grow"></span>
        <button class="btn" data-a="auto">Auto-detect again</button>
        <button class="btn" data-a="clear">Clear cuts</button>
        <button class="btn" data-a="cancel">Cancel</button>
        <button class="btn btn-gold" data-a="done">Slice &amp; upload</button>
      </div>
      <div class="body">
        <div class="slice-view"><div class="slice-wrap"></div></div>
        <div class="slice-side">
          <div class="field"><label>Output</label>
            <div class="eb-seg" data-g="fmt"><button data-v="image/jpeg" class="active">JPG</button><button data-v="image/png">PNG</button></div>
          </div>
          <div class="field"><label>JPG quality <span data-q>82</span></label><input type="range" min="50" max="95" value="82" data-a="q" style="width:100%"></div>
          <div class="field"><label class="eb-check"><input type="checkbox" checked data-a="retina"> Retina (2× pixels, sharper on phones)</label></div>
          <div class="field"><label>Slices</label><ul class="slice-list"></ul></div>
          <p class="muted">Tip: cut through plain background where you can, and give every button or link its own strip so each one can link somewhere different.</p>
        </div>
      </div>`;
    document.body.appendChild(el);
    const wrap = el.querySelector('.slice-wrap');
    const view = el.querySelector('.slice-view');
    const disp = document.createElement('canvas');
    const dk = Math.min(1, 1600 / src.width);
    disp.width = Math.round(src.width * dk); disp.height = Math.round(src.height * dk);
    disp.getContext('2d').drawImage(src, 0, 0, disp.width, disp.height);
    wrap.appendChild(disp);
    const fit = () => { const cs = getComputedStyle(view); const avail = view.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); wrap.style.width = Math.max(240, Math.min(avail, 980)) + 'px'; draw(); };

    const S = () => wrap.clientWidth / src.width;
    function draw() {
      wrap.querySelectorAll('.cut,.edge,.shade').forEach((n) => n.remove());
      const s = S();
      const shade = (l, t, w, h) => { const d = document.createElement('div'); d.className = 'shade'; Object.assign(d.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' }); wrap.appendChild(d); };
      const W = src.width * s, H = src.height * s;
      shade(0, 0, W, crop.y * s); shade(0, (crop.y + crop.h) * s, W, H - (crop.y + crop.h) * s);
      shade(0, crop.y * s, crop.x * s, crop.h * s); shade((crop.x + crop.w) * s, crop.y * s, W - (crop.x + crop.w) * s, crop.h * s);
      [['top', 'h'], ['bottom', 'h'], ['left', 'v'], ['right', 'v']].forEach(([side, o]) => {
        const e = document.createElement('div');
        e.className = 'edge ' + o; e.dataset.side = side;
        if (side === 'top') e.style.top = crop.y * s + 'px';
        if (side === 'bottom') e.style.top = (crop.y + crop.h) * s + 'px';
        if (side === 'left') e.style.left = crop.x * s + 'px';
        if (side === 'right') e.style.left = (crop.x + crop.w) * s + 'px';
        wrap.appendChild(e);
      });
      const toEmail = width / crop.w;
      const bounds = [crop.y, ...cuts, crop.y + crop.h];
      cuts.forEach((y, i) => {
        const c = document.createElement('div');
        c.className = 'cut'; c.dataset.i = i;
        Object.assign(c.style, { top: y * s + 'px', left: crop.x * s + 'px', right: (src.width - crop.x - crop.w) * s + 'px' });
        c.innerHTML = `<span class="lab">${i + 1}</span><button class="x" title="Remove cut">×</button>`;
        wrap.appendChild(c);
      });
      el.querySelector('.slice-list').innerHTML = bounds.slice(0, -1).map((y, i) =>
        `<li><span>Slice ${i + 1}</span><span class="muted">${width} × ${Math.round((bounds[i + 1] - y) * toEmail)} px</span></li>`).join('');
    }

    let drag = null;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('x')) {
        cuts.splice(Number(e.target.parentNode.dataset.i), 1); draw(); return;
      }
      const cut = e.target.closest('.cut'), edge = e.target.closest('.edge');
      if (cut) drag = { type: 'cut', i: Number(cut.dataset.i) };
      else if (edge) drag = { type: 'edge', side: edge.dataset.side };
      else {
        const r = wrap.getBoundingClientRect();
        const y = (e.clientY - r.top) / S();
        if (y > crop.y + 4 && y < crop.y + crop.h - 4) { cuts.push(Math.round(y)); cuts.sort((a, b) => a - b); draw(); }
        return;
      }
      wrap.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = wrap.getBoundingClientRect();
      const x = Math.max(0, Math.min(src.width, Math.round((e.clientX - r.left) / S())));
      const y = Math.max(0, Math.min(src.height, Math.round((e.clientY - r.top) / S())));
      if (drag.type === 'cut') cuts[drag.i] = Math.max(crop.y + 2, Math.min(crop.y + crop.h - 2, y));
      else {
        const b = { l: crop.x, t: crop.y, r: crop.x + crop.w, bt: crop.y + crop.h };
        if (drag.side === 'top') b.t = Math.min(y, b.bt - 50);
        if (drag.side === 'bottom') b.bt = Math.max(y, b.t + 50);
        if (drag.side === 'left') b.l = Math.min(x, b.r - 50);
        if (drag.side === 'right') b.r = Math.max(x, b.l + 50);
        crop = { x: b.l, y: b.t, w: b.r - b.l, h: b.bt - b.t };
      }
      draw();
    });
    const endDrag = () => {
      if (drag && drag.type === 'cut') cuts = cuts.filter((y) => y > crop.y + 2 && y < crop.y + crop.h - 2).sort((a, b) => a - b);
      drag = null; draw();
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    el.querySelector('[data-a=q]').addEventListener('input', (e) => { quality = e.target.value / 100; el.querySelector('[data-q]').textContent = e.target.value; });
    el.querySelector('[data-a=retina]').addEventListener('change', (e) => { retina = e.target.checked; });
    el.querySelectorAll('[data-g=fmt] button').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('[data-g=fmt] button').forEach((x) => x.classList.toggle('active', x === b)); format = b.dataset.v;
    }));

    const close = (val) => { removeEventListener('resize', fit); el.remove(); resolve(val); };
    el.querySelector('.bar').addEventListener('click', async (e) => {
      const a = e.target.dataset.a;
      if (a === 'auto') { crop = detectCrop(src); cuts = detectCuts(src, crop); draw(); }
      if (a === 'clear') { cuts = []; draw(); }
      if (a === 'cancel') close(null);
      if (a === 'done') {
        e.target.disabled = true; e.target.textContent = 'Slicing…';
        close(await cutSlices(src, crop, cuts, { width, retina, quality, format }));
      }
    });
    addEventListener('resize', fit);
    requestAnimationFrame(fit);
  });
}
