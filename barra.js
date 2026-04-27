// ── PROTECCIÓN DE DOMINIO ─────────────────────────────────────────────────────
// Cambia 'tuusuario.github.io' por tu dominio real antes de ofuscar
const _dominiosPermitidos = [
  'microcorpset.github.io',
  'localhost',
  '127.0.0.1'
];
if (!_dominiosPermitidos.some(d => location.hostname === d || location.hostname.endsWith('.' + d))) {
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#888">Acceso no autorizado</div>';
  throw new Error('Dominio no autorizado');
}
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase.js';
import { ref, onValue, set, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const escocina = location.pathname.includes('cocina') || location.search.includes('rol=cocina');
const ROL = escocina ? 'cocina' : 'barra';
const PRINT_KEY = 'autoimp_' + ROL;
const PIN_SESSION = 'auth_' + ROL;
let PIN_CORRECTO = '1234';

get(ref(db, 'config/pins/' + ROL)).then(s => { if (s.val()) PIN_CORRECTO = s.val(); }).catch(()=>{});

// ── PIN ───────────────────────────────────────────────────────────────────────
let pinBuffer = '';
if (sessionStorage.getItem(PIN_SESSION) === '1') {
  document.getElementById('pin-screen').style.display = 'none';
}
if (ROL === 'cocina') {
  const t = document.getElementById('pin-rol-title');
  if (t) t.textContent = 'Cocina';
}
window.pinKey = d => {
  if (pinBuffer.length >= 4) return;
  pinBuffer += d;
  updatePinDots();
  if (pinBuffer.length === 4) verificarPin();
};
window.pinDel = () => {
  pinBuffer = pinBuffer.slice(0,-1);
  updatePinDots(false);
  document.getElementById('pin-error').style.display = 'none';
};
function updatePinDots(error) {
  for (let i=0;i<4;i++) {
    const d = document.getElementById('pd'+i);
    if(d) d.className='pin-dot'+(i<pinBuffer.length?(error?' error':' filled'):'');
  }
}
function verificarPin() {
  if (pinBuffer === PIN_CORRECTO) {
    sessionStorage.setItem(PIN_SESSION, '1');
    document.getElementById('pin-screen').style.display = 'none';
  } else {
    updatePinDots(true);
    document.getElementById('pin-error').style.display = 'block';
    setTimeout(() => { pinBuffer=''; updatePinDots(false); document.getElementById('pin-error').style.display='none'; }, 900);
  }
}
// Listener teclado PIN sin onclick inline
document.getElementById('pin-pad').addEventListener('click', e => {
  const btn = e.target.closest('[data-k]');
  if (!btn) return;
  const k = btn.dataset.k;
  if (k === 'del') pinDel();
  else if (k !== '') pinKey(k);
});
// ─────────────────────────────────────────────────────────────────────────────

// ── Wake Lock ──────────────────────────────────────────────────────────────────
const WAKE_KEY2 = 'wake_' + ROL;
let wakeLock2 = null;
let autoWake2 = localStorage.getItem(WAKE_KEY2) === 'true';
const wakeTrack2 = document.getElementById('wake-track');
if (wakeTrack2) wakeTrack2.classList.toggle('on', autoWake2);
async function activarWake2() {
  try { if ('wakeLock' in navigator) wakeLock2 = await navigator.wakeLock.request('screen'); } catch(e) {}
}
if (autoWake2) activarWake2();
if (wakeTrack2) wakeTrack2.parentElement.addEventListener('click', () => {
  autoWake2 = !autoWake2;
  localStorage.setItem(WAKE_KEY2, autoWake2);
  wakeTrack2.classList.toggle('on', autoWake2);
  if (autoWake2) activarWake2(); else { if (wakeLock2) { wakeLock2.release(); wakeLock2 = null; } }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && autoWake2) activarWake2();
});

if (ROL === 'cocina') {
  document.documentElement.classList.add('rol-cocina');
  document.getElementById('topbar-title').textContent = 'Cocina';
  document.title = 'Cocina · Comandero';
}
// Mostrar rol en PIN screen como subtítulo
const pinSubEl = document.querySelector('.pin-box .pin-sub');
if (pinSubEl) pinSubEl.textContent = `— ${ROL === 'cocina' ? 'Cocina' : 'Barra'} —`;

// ── Toggle impresión automática ───────────────────────────────────────────────
let autoImprimir = localStorage.getItem(PRINT_KEY) === 'true';
const printTrack = document.getElementById('print-track');

function updateToggleUI() {
  printTrack.classList.toggle('on', autoImprimir);
}
updateToggleUI();

printTrack.parentElement.addEventListener('click', () => {
  autoImprimir = !autoImprimir;
  localStorage.setItem(PRINT_KEY, autoImprimir);
  updateToggleUI();
});

// ── Toggle TXT ────────────────────────────────────────────────────────────────
const TXT_KEY = 'txt_' + ROL;
let autoTXT = localStorage.getItem(TXT_KEY) === 'true';
const txtTrack = document.getElementById('txt-track');
if (txtTrack) txtTrack.classList.toggle('on', autoTXT);
if (txtTrack) txtTrack.parentElement.addEventListener('click', () => {
  autoTXT = !autoTXT;
  localStorage.setItem(TXT_KEY, autoTXT);
  txtTrack.classList.toggle('on', autoTXT);
});

function generarTXT(mesaNombre, lineas) {
  const ahora = new Date();
  const hora  = ahora.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
  const fecha = ahora.toLocaleDateString('es-ES');
  const ts    = `${String(ahora.getHours()).padStart(2,'0')}${String(ahora.getMinutes()).padStart(2,'0')}${String(ahora.getSeconds()).padStart(2,'0')}`;
  const sep   = '--------------------------------';
  const camareros = [...new Set(lineas.map(l => l.camarero).filter(Boolean))];
  const camareroTxt = camareros.join(', ');
  let txt = `${ROL==='cocina'?'COCINA':'BARRA'} — Mesa ${mesaNombre}\n`;
  if (camareroTxt) txt += `Camarero: ${camareroTxt}\n`;
  txt += `${fecha}  ${hora}\n${sep}\n`;
  lineas.forEach(l => {
    const precio = (l.precio*l.qty).toFixed(2)+'EUR';
    const izq    = `${l.qty}x ${l.nombre}`;
    txt += izq+' '.repeat(Math.max(1,32-izq.length-precio.length))+precio+'\n';
    if (l.nota) txt += `   -> ${l.nota}\n`;
  });
  txt += sep+'\n';
  const blob = new Blob([txt],{type:'text/plain;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=`comanda-${ROL}-mesa${mesaNombre}-${ts}.txt`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Impresión via iframe oculto (sin ventanas emergentes) ─────────────────────
const iframePrint = document.createElement('iframe');
iframePrint.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none';
document.body.appendChild(iframePrint);

function imprimirComanda(mesaNombre, lineas) {
  const fecha = new Date().toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
  const camarero = [...new Set(lineas.map(l => l.camarero).filter(Boolean))].join(', ');
  const rows = lineas.map(l => `
    <tr>
      <td style="padding:4px 6px 4px 0;font-weight:bold;vertical-align:top">${l.qty}×</td>
      <td style="padding:4px 0;vertical-align:top">
        ${l.nombre}
        ${l.nota ? `<br><span style="font-size:11px;color:#555">↳ ${l.nota}</span>` : ''}
      </td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: monospace; font-size: 13px; padding: 8px; width: 100%; }
      h2 { font-size: 15px; font-weight: bold; margin-bottom: 2px; }
      .sub { font-size: 11px; color: #666; margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; }
      tr { border-bottom: 1px solid #ddd; }
      tr:last-child { border-bottom: none; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h2>${ROL === 'cocina' ? '🍳 COCINA' : '🍺 BARRA'} — Mesa ${mesaNombre}</h2>
    <div class="sub">${fecha}${camarero ? ' · ' + camarero : ''}</div>
    <table>${rows}</table>
    </body></html>`;

  iframePrint.srcdoc = html;
  iframePrint.onload = () => {
    try { iframePrint.contentWindow.focus(); iframePrint.contentWindow.print(); }
    catch(e) { console.warn('Error impresión iframe:', e); }
  };
}

function tick() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
}
tick(); setInterval(tick, 10000);

// Audio beep
let audioCtx;
function beep() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    g.gain.setValueAtTime(.4, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + .35);
    o.start(); o.stop(audioCtx.currentTime + .35);
  } catch(e) {}
}

let mesasData = {};
let pedidosPorMesa = {};
let vistos = new Set(JSON.parse(localStorage.getItem('vistos_' + ROL) || '[]'));
let nuevosActivos = new Set();
let primeraVez = true;

function saveVistos() { localStorage.setItem('vistos_' + ROL, JSON.stringify([...vistos])); }

onValue(ref(db, 'mesas'), snap => { mesasData = snap.val() || {}; });

onValue(ref(db, 'pedidos'), snap => {
  const all = snap.val() || {};
  pedidosPorMesa = {};
  Object.entries(all).forEach(([mesaId, lineas]) => {
    const mias = Object.entries(lineas).filter(([,l]) => l.destino === ROL || l.destino === 'ambos');
    if (mias.length) pedidosPorMesa[mesaId] = Object.fromEntries(mias);
  });

  const antesNuevos = new Set(nuevosActivos);
  detectarNuevos();
  renderPedidos();

  if (!primeraVez && nuevosActivos.size > 0) {
    beep();

    // Detectar líneas individuales nuevas (no vistas aún y pendientes)
    // Agrupar por mesa para generar un solo TXT/impresión por envío
    const lineasNuevasPorMesa = {};
    Object.entries(pedidosPorMesa).forEach(([mesaId, lineas]) => {
      Object.entries(lineas).forEach(([lineaId, l]) => {
        const key = mesaId + '/' + lineaId;
        if (!vistos.has(key) && l.estado === 'pendiente') {
          if (!lineasNuevasPorMesa[mesaId]) lineasNuevasPorMesa[mesaId] = [];
          lineasNuevasPorMesa[mesaId].push(l);
        }
      });
    });

    Object.entries(lineasNuevasPorMesa).forEach(([mesaId, lineas]) => {
      if (!lineas.length) return;
      const nombre = mesasData[mesaId]?.nombre || mesaId;
      if (autoImprimir) imprimirComanda(nombre, lineas);
      if (autoTXT)      generarTXT(nombre, lineas);
    });
  }
  primeraVez = false;
});

function detectarNuevos() {
  nuevosActivos.clear();
  Object.entries(pedidosPorMesa).forEach(([mesaId, lineas]) => {
    Object.entries(lineas).forEach(([lineaId, l]) => {
      if (!vistos.has(mesaId + '/' + lineaId) && l.estado === 'pendiente') {
        // Usar envioId si existe, si no usar mesaId
        nuevosActivos.add(l.envioId || mesaId);
      }
    });
  });
  const hay = nuevosActivos.size > 0;
  document.body.classList.toggle('hay-nuevos', hay);
  const badge = document.getElementById('badge-nuevos');
  if (hay) {
    badge.style.display = '';
    badge.textContent = nuevosActivos.size + (nuevosActivos.size === 1 ? ' comanda nueva' : ' comandas nuevas');
  } else {
    badge.style.display = 'none';
  }
}

function renderPedidos() {
  const grid = document.getElementById('pedidos-grid');
  const empty = document.getElementById('empty-state');

  // Construir lista de envíos: cada envioId es una tarjeta independiente
  // Un envío = todas las líneas con el mismo envioId (o mesaId+ts si no hay envioId)
  const envios = {}; // envioKey → { mesaId, mesaNombre, ts, camarero, lineas: {lineaId: linea} }

  Object.entries(pedidosPorMesa).forEach(([mesaId, lineas]) => {
    Object.entries(lineas).forEach(([lineaId, l]) => {
      if (l.estado !== 'pendiente') return;
      // Clave del envío: usar envioId si existe, si no agrupar todo por mesa (pedidos antiguos)
      const envioKey = l.envioId || mesaId;
      if (!envios[envioKey]) {
        envios[envioKey] = {
          mesaId, ts: l.ts || 0,
          camarero: l.camarero || '',
          lineas: {}
        };
      }
      envios[envioKey].lineas[lineaId] = l;
      // El ts del envío es el mínimo de sus líneas
      if ((l.ts || 0) < envios[envioKey].ts || envios[envioKey].ts === 0) {
        envios[envioKey].ts = l.ts || 0;
      }
    });
  });

  const listaEnvios = Object.entries(envios);
  if (!listaEnvios.length) {
    empty.style.display = ''; grid.style.display = 'none'; return;
  }
  empty.style.display = 'none'; grid.style.display = '';
  grid.innerHTML = '';

  // Ordenar: nuevos primero dentro de su grupo, luego por timestamp ASC (FIFO)
  listaEnvios
    .sort(([ak, a], [bk, b]) => {
      const aNuevo = nuevosActivos.has(ak) ? 0 : 1;
      const bNuevo = nuevosActivos.has(bk) ? 0 : 1;
      if (aNuevo !== bNuevo) return aNuevo - bNuevo;
      return (a.ts || 0) - (b.ts || 0); // FIFO: el más antiguo arriba
    })
    .forEach(([envioKey, envio]) => {
      grid.appendChild(crearCard(envioKey, envio));
    });
}

function crearCard(envioKey, envio) {
  const { mesaId, ts, camarero, lineas } = envio;
  const esNuevo = nuevosActivos.has(envioKey) || nuevosActivos.has(mesaId);
  const card = document.createElement('div');
  card.className = 'mesa-card' + (esNuevo ? ' nueva' : '');
  card.id = 'card-' + envioKey;

  const nombre = mesasData[mesaId]?.nombre || mesaId;

  const header = document.createElement('div');
  header.className = 'card-header';
  header.innerHTML = `
    <span class="dot"></span>
    <span class="card-mesa-name">Mesa ${nombre}</span>
    <span class="card-time">${ts ? tiempoRelativo(ts) : ''}</span>
    ${camarero ? `<span style="font-size:10px;color:var(--muted);font-family:var(--mono)">${camarero}</span>` : ''}
    <button class="btn-imprimir" onclick="imprimirEnvio('${envioKey}')" title="Imprimir">🖨</button>`;
  header.addEventListener('click', e => {
    if (e.target.closest('.btn-imprimir')) return;
    marcarVistaEnvio(envioKey, lineas);
  });
  card.appendChild(header);

  Object.entries(lineas)
    .sort(([,a],[,b]) => (a.ts||0) - (b.ts||0))
    .forEach(([lineaId, l]) => {
      const row = document.createElement('div');
      row.className = 'linea-row';
      row.id = 'linea-' + lineaId;
      const main = document.createElement('div');
      main.className = 'linea-main';
      main.innerHTML = `
        <span class="linea-qty">${l.qty}</span>
        <span class="linea-nombre">${l.nombre}</span>
        <button class="btn-servido" onclick="marcarServido('${mesaId}','${lineaId}','${envioKey}',this)">Servido</button>
        <button class="btn-stock" onclick="marcarSinStock('${mesaId}','${lineaId}','${envioKey}',this)" title="Sin stock">✕</button>`;
      row.appendChild(main);
      if (l.nota && l.nota.trim()) {
        const nota = document.createElement('div');
        nota.className = 'linea-nota';
        nota.textContent = '↳ ' + l.nota;
        row.appendChild(nota);
      }
      card.appendChild(row);
    });

  return card;
}

function marcarVistaEnvio(envioKey, lineas) {
  Object.keys(lineas).forEach(lid => {
    const l = lineas[lid];
    const mesaId = Object.keys(pedidosPorMesa).find(mid => pedidosPorMesa[mid][lid]);
    if (mesaId) vistos.add(mesaId + '/' + lid);
  });
  saveVistos();
  const card = document.getElementById('card-' + envioKey);
  if (card) card.classList.remove('nueva');
  nuevosActivos.delete(envioKey);
  detectarNuevos();
}

// Mantener marcarVista para compatibilidad
function marcarVista(mesaId, lineas) { marcarVistaEnvio(mesaId, lineas); }

window.marcarServido = async (mesaId, lineaId, envioKey, btn) => {
  if (!btn || btn.classList.contains('hecho')) return;
  btn.disabled = true; btn.textContent = '…';
  await set(ref(db, `pedidos/${mesaId}/${lineaId}/estado`), 'servido');
  vistos.add(mesaId + '/' + lineaId);
  saveVistos();
  btn.className = 'btn-servido hecho'; btn.textContent = '✓ Servido'; btn.disabled = false;
  btn.closest('.linea-row').classList.add('servida');

  // Comprobar si quedan pendientes en este envío
  const snap = await get(ref(db, 'pedidos/' + mesaId));
  const todasLineas = snap.val() || {};
  // Buscar si quedan pendientes del mismo envioId
  const quedanEnvio = Object.values(todasLineas).filter(l =>
    (l.destino === ROL || l.destino === 'ambos') &&
    l.estado === 'pendiente' &&
    (l.envioId === envioKey || (!l.envioId && mesaId === envioKey))
  );
  if (!quedanEnvio.length) {
    const card = document.getElementById('card-' + envioKey);
    if (card) card.classList.remove('nueva');
    nuevosActivos.delete(envioKey);
    detectarNuevos();
    setTimeout(() => renderPedidos(), 600);
  }
};

window.marcarSinStock = async (mesaId, lineaId, envioKey, btn) => {
  if (btn.disabled) return;
  btn.disabled = true;
  await set(ref(db, `pedidos/${mesaId}/${lineaId}/estado`), 'cancelado');
  const row = btn.closest('.linea-row');
  if (row) { row.style.opacity = '.3'; row.style.textDecoration = 'line-through'; }
  btn.disabled = false;
  const snap = await get(ref(db, 'pedidos/' + mesaId));
  const todasLineas = snap.val() || {};
  const quedan = Object.values(todasLineas).filter(l =>
    (l.destino === ROL || l.destino === 'ambos') && l.estado === 'pendiente' &&
    (l.envioId === envioKey || (!l.envioId && mesaId === envioKey))
  );
  if (!quedan.length) { nuevosActivos.delete(envioKey); detectarNuevos(); setTimeout(() => renderPedidos(), 600); }
};

window.imprimirEnvio = envioKey => {
  // Buscar el envío en los datos actuales
  let lineas = [], mesaNombre = envioKey;
  Object.entries(pedidosPorMesa).forEach(([mesaId, ls]) => {
    Object.values(ls).forEach(l => {
      if ((l.envioId === envioKey || (!l.envioId && mesaId === envioKey)) && l.estado === 'pendiente') {
        lineas.push(l);
        mesaNombre = mesasData[mesaId]?.nombre || mesaId;
      }
    });
  });
  if (!lineas.length) return;
  imprimirComanda(mesaNombre, lineas);
  if (autoTXT) generarTXT(mesaNombre, lineas);
};

// Alias para compatibilidad
window.imprimirMesa = envioKey => window.imprimirEnvio(envioKey);

function tiempoRelativo(ts) {
  const diff = Math.floor((Date.now() - ts) / 60000);
  if (diff < 1) return 'ahora';
  if (diff === 1) return 'hace 1 min';
  return `hace ${diff} min`;
}