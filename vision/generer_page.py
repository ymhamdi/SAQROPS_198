import base64
import json
import time
import numpy as np

import propagation as p
import evacuation as ev

# ========== A MODIFIER ==========
SCENARIOS_PAGE = [
    # (nom, titre, vitesse du vent en km/h, direction D'OU VIENT le vent en degrés)
    ("vent_faible", "Vent faible 10 km/h", 10, 200),
    ("sirocco", "Sirocco 40 km/h", 40, 200),
]
HORIZONS_PAGE = [5, 10, 15, 20, 25, 30, 35, 40, 45]
FICHIER = f"{p.SORTIE}/page_demo.html"
# ================================


def charger_ou_simuler(nom, kmh, d_vent):
    fichier = f"{p.SORTIE}/propagation_{nom}.npz"
    try:
        data = np.load(fichier)
        meme = (abs(float(data["vitesse_kmh"]) - kmh) < 1e-6
                and abs(float(data["direction_deg"]) - d_vent) < 1e-6
                and tuple(int(x) for x in data["ignition"]) == tuple(p.IGNITION)
                and max(HORIZONS_PAGE) <= max(int(x) for x in data["horizons"]))
        if meme:
            arr = data["arrivees"]
            print(f"{nom} : simulation existante utilisée ({len(arr)} répétitions)")
            return arr
        print(f"{nom} : le fichier existant ne correspond pas, nouvelle simulation...")
    except FileNotFoundError:
        print(f"{nom} : pas de fichier existant, simulation...")
    v = kmh / 3.6
    vers = np.radians((d_vent + 180) % 360)
    wx, wy = np.sin(vers), np.cos(vers)
    cartes = p.cartes_propagation(v, wx, wy)
    rng = np.random.default_rng(42)
    nsteps = int(round(max(max(HORIZONS_PAGE), max(p.HORIZONS)) / p.DT))
    t0 = time.time()
    res = []
    for i in range(p.NB_SIMULATIONS):
        res.append(p.une_simulation(rng, cartes, v, wx, wy, nsteps))
        if (i + 1) % 10 == 0:
            print(f"  {i + 1}/{p.NB_SIMULATIONS} ({time.time() - t0:.0f} s)", flush=True)
    return np.stack(res)


def b64(a):
    return base64.b64encode(np.asarray(a).astype(np.uint8).tobytes()).decode("ascii")


def encoder_etape(arrivees, kmh, d_vent, h, prem):
    R = ev.analyser(arrivees, kmh, d_vent, h)
    code = np.rint(R["risque"] * 100).astype(np.int16) + 128 * R["fumee"].astype(np.int16)
    evac = []
    for nom_s, e in R["evac"].items():
        if e is None:
            evac.append(dict(sortie=nom_s, pts=None))
            continue
        evac.append(dict(
            sortie=nom_s, rass=e["rassemblement"],
            pts=[[int(c), int(r)] for c, r in e["pts"]],
            longueur=int(round(e["longueur"])), duree=round(float(e["duree"]), 1),
            feu=int(round(e["risque_max"] * 100)),
            sur=bool(e["risque_max"] <= ev.SEUIL_ZONE and e["zone_sure"]),
            fumee=bool(e["enfumee"])))
    c = R["camion"]
    camion = None
    if c is not None:
        camion = dict(porte=c["porte"], eau=c["eau"], au_vent=bool(c["au_vent"]),
                      pts=[[int(a), int(b)] for a, b in c["pts"]],
                      longueur=int(round(c["longueur"])), feu=int(round(c["risque_max"] * 100)),
                      fumee=bool(c["enfumee"]))
    return dict(
        h=int(h), carte=b64(code),
        surface_ha=round(float((arrivees <= h).sum(axis=(1, 2)).mean() * p.CELL ** 2 / 10000), 1),
        batiments={nb: int(round((pm <= h).mean() * 100)) for nb, pm in prem.items()},
        rass={k: int(round(v * 100)) for k, v in R["rass"].items()},
        evac=evac, camion=camion)


TEMPLATE = r"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Démo - détection d'incendie par drone</title>
<style>
 body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f2f2f2;color:#222}
 header{background:#a51d1d;color:#fff;padding:10px 16px}
 header h1{margin:0;font-size:18px}
 header p{margin:4px 0 0;font-size:12px}
 main{display:flex;flex-wrap:wrap;gap:14px;padding:12px}
 canvas{width:min(94vw,720px);height:auto;background:#fff;border:1px solid #888;display:block}
 .panneau{flex:1 1 400px;min-width:300px}
 .ctrl{background:#fff;border:1px solid #ccc;padding:8px;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
 .ctrl input[type=range]{flex:1 1 200px}
 #tl{font-weight:bold;font-size:18px;min-width:70px}
 table{border-collapse:collapse;width:100%;background:#fff;font-size:13px;margin-bottom:8px}
 th,td{border:1px solid #ccc;padding:3px 6px;text-align:left}
 th{background:#e8e8e8}
 .ok{background:#e4f5e4}.att{background:#fff0cc}.bad{background:#fbd5d5}
 .box{background:#fff;border:1px solid #ccc;padding:8px;margin-bottom:8px;font-size:13px}
 .aviso{font-size:11px;color:#555}
</style></head><body>
<header><h1>Détection d'incendie par drone - démo de l'aide à la décision</h1>
<p>Site fictif, simulation non calibrée. Les décisions d'évacuation restent à la Protection Civile.</p></header>
<main>
<div><canvas id="cv"></canvas>
<p class="aviso">Rouge : probabilité que la case ait brûlé. Gris : fumée. Étoile : départ du feu. Flèche bleue : sens vers lequel souffle le vent.</p></div>
<div class="panneau">
 <div class="ctrl">
  <label>Scénario : <select id="scen"></select></label>
  <label><input type="checkbox" id="ch_evac" checked> évacuation</label>
  <label><input type="checkbox" id="ch_cam" checked> accès camions</label>
 </div>
 <div class="ctrl">
  <button id="play">Lecture</button>
  <input type="range" id="t" min="0" value="0" step="1">
  <span id="tl"></span>
 </div>
 <div class="box" id="resume"></div>
 <div class="box" id="reco"></div>
 <table id="tbat"></table>
 <table id="tevac"></table>
 <div class="box" id="camion"></div>
 <table id="trass"></table>
 <p class="aviso">Hypothèses : un seul départ de feu, vent constant, terrain plat, pas d'intervention des pompiers. Paramètres de la simulation non calibrés : seule la comparaison entre scénarios est défendable. Les chemins sont calculés comme si tout le monde partait à l'instant affiché.</p>
</div></main>
<script>
const D = __DATA__;
const N = D.n, S = 6;
const cv = document.getElementById('cv');
cv.width = N * S; cv.height = N * S;
const ctx = cv.getContext('2d');
const off = document.createElement('canvas');
off.width = N; off.height = N;
const octx = off.getContext('2d');

function dec(s) {
  const b = atob(s), a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
function hex(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
const GRID = dec(D.grid);
const COL = D.couleurs.map(hex);
let sc = 0, step = 0, timer = null;
const X = c => (c + 0.5) * S;
const Y = r => (N - r - 0.5) * S;

function mix(a, b, k) { return a * (1 - k) + b * k; }

function trace(pts, color, w, dash) {
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  ctx.setLineDash(dash);
  ctx.strokeStyle = color; ctx.lineWidth = w;
  pts.forEach((q, i) => { if (i === 0) ctx.moveTo(X(q[0]), Y(q[1])); else ctx.lineTo(X(q[0]), Y(q[1])); });
  ctx.stroke();
  ctx.setLineDash([]);
}

function dessiner() {
  const sce = D.scenarios[sc], st = sce.steps[step];
  const carte = dec(st.carte);
  const img = octx.createImageData(N, N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      let col = COL[GRID[i]];
      let R = mix(col[0], 255, 0.45), G = mix(col[1], 255, 0.45), B = mix(col[2], 255, 0.45);
      let code = carte[i];
      if (code >= 128) { code -= 128; R = mix(R, 110, 0.45); G = mix(G, 110, 0.45); B = mix(B, 110, 0.45); }
      if (code >= 2) {
        const a = Math.min(0.9, 0.2 + 0.7 * code / 100);
        R = mix(R, 215, a); G = mix(G, 25, a); B = mix(B, 28, a);
      }
      const k = ((N - 1 - r) * N + c) * 4;
      img.data[k] = R; img.data[k + 1] = G; img.data[k + 2] = B; img.data[k + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, N * S, N * S);
  ctx.drawImage(off, 0, 0, N * S, N * S);

  ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000';
  ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const nom in D.batiments) {
    const [a, b, c, d] = D.batiments[nom];
    ctx.strokeRect(a * S, (N - d) * S, (c - a) * S, (d - b) * S);
    ctx.fillText(nom[0], (a + c) / 2 * S, (N - (b + d) / 2) * S);
  }
  if (document.getElementById('ch_evac').checked) {
    st.evac.forEach(e => trace(e.pts, '#00a000', 2.5, []));
  }
  if (document.getElementById('ch_cam').checked && st.camion) {
    trace(st.camion.pts, '#ff8c00', 3.5, [8, 5]);
  }
  for (const k in D.sorties) { const q = D.sorties[k]; ctx.fillStyle = '#000'; ctx.fillRect(X(q[0]) - 3, Y(q[1]) - 3, 6, 6); }
  for (const k in D.portes) {
    const q = D.portes[k];
    ctx.fillStyle = '#800080'; ctx.fillRect(X(q[0]) - 6, Y(q[1]) - 6, 12, 12);
    ctx.fillStyle = '#800080'; ctx.font = '10px Arial'; ctx.fillText(k, X(q[0]), Y(q[1]) - 12);
  }
  const choisis = new Set(st.evac.filter(e => e.pts).map(e => e.rass));
  const appui = st.camion ? st.camion.eau : null;
  for (const k in D.eau) {
    const q = D.eau[k];
    ctx.beginPath(); ctx.arc(X(q[0]), Y(q[1]), k === appui ? 9 : 5, 0, 7);
    ctx.fillStyle = k === appui ? '#e00000' : '#1e50ff'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
  }
  for (const k in D.rass) {
    const q = D.rass[k], x = X(q[0]), y = Y(q[1]), t = choisis.has(k) ? 12 : 8;
    ctx.beginPath(); ctx.moveTo(x, y - t); ctx.lineTo(x - t, y + t); ctx.lineTo(x + t, y + t); ctx.closePath();
    ctx.fillStyle = choisis.has(k) ? '#00a000' : '#ffffff'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#00a000'; ctx.stroke();
    ctx.fillStyle = '#000'; ctx.font = '10px Arial'; ctx.fillText(k, x, y + t + 8);
  }
  ctx.font = '26px Arial'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ffe000';
  const ix = X(D.ignition[0] + 1) - S / 2, iy = Y(D.ignition[1] + 1) + S / 2;
  ctx.strokeText('★', ix, iy); ctx.fillText('★', ix, iy);

  const vers = (sce.direction + 180) * Math.PI / 180;
  const wx = Math.sin(vers), wy = Math.cos(vers), ox = N * S - 70, oy = N * S - 50;
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + wx * 50, oy - wy * 50);
  ctx.strokeStyle = '#1e50ff'; ctx.lineWidth = 4; ctx.stroke();
  ctx.beginPath(); ctx.arc(ox + wx * 50, oy - wy * 50, 5, 0, 7); ctx.fillStyle = '#1e50ff'; ctx.fill();
  ctx.fillStyle = '#1e50ff'; ctx.font = '12px Arial'; ctx.fillText('vent', ox, oy + 14);
}

function cls(ok) { return ok ? 'ok' : 'att'; }

function panneau() {
  const sce = D.scenarios[sc], st = sce.steps[step];
  document.getElementById('tl').textContent = '+' + st.h + ' min';
  document.getElementById('resume').innerHTML = '<b>' + sce.titre + '</b> : vent venant de ' + sce.direction +
    ' deg, ' + sce.nb_sim + ' simulations.<br>Surface brûlée moyenne à +' + st.h + ' min : <b>' + st.surface_ha + ' ha</b>';
  const r1 = sce.reco[0], g1 = D.reco_globale[0];
  const sur = r1[1] <= 10 ? 'sous 10 % à tous les horizons' : 'AUCUN rassemblement sous 10 % : à revoir';
  document.getElementById('reco').innerHTML = 'Rassemblement recommandé pour ce scénario : <b>' + r1[0] +
    '</b> (risque max ' + r1[1] + ' %, ' + sur + ').<br>Tous scénarios confondus : <b>' + g1[0] + '</b> (risque max ' + g1[1] + ' %).';
  let h = '<tr><th>Bâtiment</th><th>Probabilité qu\'une case brûle à +' + st.h + ' min</th></tr>';
  for (const nb in st.batiments) {
    const v = st.batiments[nb];
    h += '<tr class="' + (v >= 50 ? 'bad' : v >= 10 ? 'att' : 'ok') + '"><td>' + nb + '</td><td>' + v + ' %</td></tr>';
  }
  document.getElementById('tbat').innerHTML = h;
  h = '<tr><th>Sortie</th><th>Rassemblement</th><th>Longueur</th><th>Durée</th><th>Feu max</th><th>État</th></tr>';
  st.evac.forEach(e => {
    if (!e.pts) { h += '<tr class="bad"><td>' + e.sortie + '</td><td colspan="5">AUCUN CHEMIN SÛR</td></tr>'; return; }
    const etat = (e.sur ? 'OK' : 'À surveiller') + (e.fumee ? ' + fumée' : '');
    h += '<tr class="' + cls(e.sur) + '"><td>' + e.sortie + '</td><td>' + e.rass + '</td><td>' + e.longueur +
      ' m</td><td>' + e.duree + ' min</td><td>' + e.feu + ' %</td><td>' + etat + '</td></tr>';
  });
  document.getElementById('tevac').innerHTML = h;
  const c = st.camion;
  document.getElementById('camion').innerHTML = c
    ? '<b>Accès camions</b> : ' + c.porte + ' vers ' + c.eau + ' (point d\'appui), ' + c.longueur + ' m, feu sur le chemin ' +
      c.feu + ' %' + (c.fumee ? ', traverse la fumée' : '') + (c.au_vent ? '' : ' (porte sous le vent du départ de feu)')
    : '<b>Accès camions</b> : aucun accès (routes bloquées ou poteaux inaccessibles)';
  h = '<tr><th>Rassemblement</th><th>Risque autour (environ 40 m)</th></tr>';
  for (const k in st.rass) {
    const v = st.rass[k];
    h += '<tr class="' + (v >= 50 ? 'bad' : v > 10 ? 'att' : 'ok') + '"><td>' + k + '</td><td>' + v + ' %</td></tr>';
  }
  document.getElementById('trass').innerHTML = h;
}

function maj() { dessiner(); panneau(); }

const sel = document.getElementById('scen');
D.scenarios.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = s.titre; sel.appendChild(o); });
sel.onchange = () => { sc = parseInt(sel.value); maj(); };
const slider = document.getElementById('t');
slider.max = D.horizons.length - 1;
slider.oninput = () => { step = parseInt(slider.value); maj(); };
document.getElementById('ch_evac').onchange = maj;
document.getElementById('ch_cam').onchange = maj;
document.getElementById('play').onclick = function () {
  if (timer) { clearInterval(timer); timer = null; this.textContent = 'Lecture'; return; }
  this.textContent = 'Pause';
  timer = setInterval(() => { step = (step + 1) % D.horizons.length; slider.value = step; maj(); }, 900);
};
maj();
</script></body></html>
"""


def main():
    scenarios = []
    pire_global = {}
    for nom, titre, kmh, d_vent in SCENARIOS_PAGE:
        arrivees = charger_ou_simuler(nom, kmh, d_vent)
        prem = {}
        for nb, (a, b, c, d) in p.BATIMENTS.items():
            prem[nb] = arrivees[:, b:d, a:c].reshape(len(arrivees), -1).min(axis=1)
        steps, pire = [], {}
        for h in HORIZONS_PAGE:
            st = encoder_etape(arrivees, kmh, d_vent, h, prem)
            steps.append(st)
            for k, v in st["rass"].items():
                pire[k] = max(pire.get(k, 0), v)
                pire_global[k] = max(pire_global.get(k, 0), v)
        reco = [[k, v] for k, v in sorted(pire.items(), key=lambda x: x[1])]
        scenarios.append(dict(nom=nom, titre=titre, kmh=kmh, direction=d_vent,
                              nb_sim=int(len(arrivees)), reco=reco, steps=steps))
        print(f"{titre} : {len(steps)} horizons calculés")
    reco_globale = [[k, v] for k, v in sorted(pire_global.items(), key=lambda x: x[1])]
    data = dict(
        n=int(p.N), cell=float(p.CELL), grid=b64(p.GRID), couleurs=list(p.COULEURS),
        batiments={k: [int(x) for x in v] for k, v in p.BATIMENTS.items()},
        portes={k: [int(x) for x in v] for k, v in ev.PORTES.items()},
        sorties={k: [int(x) for x in v] for k, v in ev.SORTIES.items()},
        eau={k: [int(x) for x in v] for k, v in ev.EAU.items()},
        rass={k: [int(x) for x in v] for k, v in ev.RASS.items()},
        ignition=[int(x) for x in p.IGNITION], horizons=HORIZONS_PAGE,
        scenarios=scenarios, reco_globale=reco_globale)
    html = TEMPLATE.replace("__DATA__", json.dumps(data, ensure_ascii=False))
    with open(FICHIER, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"\nPage enregistrée : {FICHIER} ({len(html) / 1024:.0f} Ko)")
    print("Pour l'ouvrir : double-clic sur le fichier, ou commande : start " + FICHIER.replace("/", "\\"))


if __name__ == "__main__":
    main()
