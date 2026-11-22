/* PNR pitch deck runtime. No dependency, works offline.
   Keys: → / Space / ↓ / PageDown / Enter next · ← / ↑ / PageUp / Backspace previous · Home / End
         N speaker notes · T timer · R reset timer · F fullscreen
   URL: #3 opens slide 3 · ?print=1 final state of every slide (used for the PDF) · ?final=1 all builds visible */
(() => {
  const params = new URLSearchParams(location.search);
  const PRINT = params.has('print');
  const FINAL = params.has('final');
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  if (PRINT) root.classList.add('print');

  const stage = document.getElementById('stage');
  const slides = [...document.querySelectorAll('.slide')];
  const total = slides.length;
  const maxStep = (s) => Math.max(0, ...[...s.querySelectorAll('[data-b]')].map((e) => +e.dataset.b || 0));
  const steps = slides.map(maxStep);

  // counters: the HTML already holds the final text; animation only counts up to it
  const fmt = (n, dec) => n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  document.querySelectorAll('.count').forEach((el) => { el.dataset.final = el.textContent; });
  const runCount = (el) => {
    const to = parseFloat(el.dataset.to);
    const dec = +(el.dataset.dec || 0);
    const final = el.dataset.final;
    if (REDUCED || PRINT || isNaN(to)) { el.textContent = final; return; }
    const t0 = performance.now(), dur = +(el.dataset.dur || 1500);
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      if (k < 1) { el.textContent = fmt(to * e, dec); requestAnimationFrame(tick); } else { el.textContent = final; }
    };
    requestAnimationFrame(tick);
  };
  const runIn = (e) => { if (e.matches('.count')) runCount(e); e.querySelectorAll('.count').forEach(runCount); };

  let cur = 0, step = 0, started = null;

  function fit() {
    if (PRINT) return;
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `scale(${k}) translate(-50%, -50%)`;
  }

  function apply(i, st, animate) {
    const s = slides[i];
    slides.forEach((x, j) => x.classList.toggle('active', j === i));
    s.querySelectorAll('[data-b]').forEach((e) => {
      const on = +e.dataset.b <= st;
      const was = e.classList.contains('on');
      e.classList.toggle('on', on);
      if (on && !was && animate) runIn(e);
    });
    document.getElementById('progress').style.width = `${((i + (steps[i] ? st / steps[i] : 1)) / total) * 100}%`;
    document.getElementById('counter').textContent = `${i + 1} / ${total}` + (steps[i] ? ` · ${st}/${steps[i]}` : '');
    renderNotes();
  }

  function enter(i, st, animate) {
    // reset builds of the slide we enter when coming from before; keep them when coming back
    const s = slides[i];
    if (animate) {
      s.querySelectorAll('.count').forEach((el) => { if (!el.closest('[data-b]')) runCount(el); });
    }
    cur = i; step = st;
    apply(i, st, animate);
    history.replaceState(null, '', `#${i + 1}`);
  }

  function next() {
    if (!started) started = Date.now();
    if (step < steps[cur]) { step += 1; apply(cur, step, true); return; }
    if (cur < total - 1) {
      // clear builds of the incoming slide first so they play from scratch
      slides[cur + 1].querySelectorAll('[data-b]').forEach((e) => e.classList.remove('on'));
      enter(cur + 1, 0, true);
    }
  }
  function prev() {
    if (step > 0) { step -= 1; apply(cur, step, false); return; }
    if (cur > 0) enter(cur - 1, steps[cur - 1], false);
  }
  function goto(i, st) {
    i = Math.max(0, Math.min(total - 1, i));
    st = st == null ? steps[i] : Math.min(st, steps[i]);
    enter(i, st, false);
  }

  // speaker notes + timer
  const notesEl = document.getElementById('notes');
  const timerEl = document.getElementById('timer');
  function renderNotes() {
    const n = slides[cur].querySelector('.notes');
    notesEl.innerHTML = `<div class="meta">Notes · slide ${cur + 1} / ${total}</div>` + (n ? n.innerHTML : '');
  }
  let timerOn = false, tHandle = null;
  function tick() {
    if (!started) { timerEl.textContent = '0:00'; return; }
    const s = Math.floor((Date.now() - started) / 1000);
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    timerEl.classList.toggle('warn', s >= 270 && s < 300);
    timerEl.classList.toggle('over', s >= 300);
  }
  function toggleTimer() {
    timerOn = !timerOn;
    timerEl.classList.toggle('show', timerOn);
    if (timerOn && !started) started = Date.now();
    clearInterval(tHandle);
    if (timerOn) { tHandle = setInterval(tick, 250); tick(); }
  }

  if (!PRINT) {
    addEventListener('resize', fit);
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
      else if (k === 'Home') goto(0, 0);
      else if (k === 'End') goto(total - 1);
      else if (k === 'n' || k === 'N') notesEl.classList.toggle('show');
      else if (k === 't' || k === 'T') toggleTimer();
      else if (k === 'r' || k === 'R') { started = timerOn ? Date.now() : null; tick(); }
      else if (k === 'f' || k === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen && root.requestFullscreen(); }
    });
    addEventListener('click', (e) => { if (!e.target.closest('a, #notes')) next(); });
    fit();
  }

  const h = parseInt(location.hash.slice(1), 10);
  const startIndex = !isNaN(h) && h >= 1 && h <= total ? h - 1 : 0;
  if (PRINT) {
    slides.forEach((s) => { s.classList.add('active'); s.querySelectorAll('[data-b]').forEach((e) => e.classList.add('on')); });
  } else if (FINAL) {
    goto(startIndex);
  } else {
    // first slide: play its builds from the start
    slides[startIndex].querySelectorAll('[data-b]').forEach((e) => e.classList.remove('on'));
    enter(startIndex, startIndex === 0 ? 0 : steps[startIndex], startIndex === 0);
  }

  window.deck = {
    total, steps, next, prev, goto,
    state: () => ({ cur, step }),
    freeze: () => root.classList.add('freeze'),
  };
})();
