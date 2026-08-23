/* ═══════════════════════════════════════════════════════════════════════════
   COMANDERO 2 · camarero2.js
   UI renovada para camareros (mobile-first). Compatible al 100% con el
   esquema Firebase existente: mesas, pedidos, carta, config/*, print_jobs.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── PROTECCIÓN DE DOMINIO ────────────────────────────────────────────────────
const _dominiosPermitidos = ['microcorpset.github.io', 'localhost', '127.0.0.1'];
if (!_dominiosPermitidos.some(d => location.hostname === d || location.hostname.endsWith('.' + d))) {
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#888">Acceso no autorizado</div>';
  throw new Error('Dominio no autorizado');
}

import { authReady, db } from './firebase.js';
import { ref, onValue, push, set, remove, get, update }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Esperar a la autenticación anónima antes de registrar listeners
await authReady;

// ── HELPERS ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmtEu = n => Number(n || 0).toFixed(2).replace('.', ',') + ' €';
const escapeHtml = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const haptic = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) { } };

function fmtDur(mins) {
  if (mins <= 0) return '<1m';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

// ── TOASTS ───────────────────────────────────────────────────────────────────
function toast(msg, { action = null, duration = 2600 } = {}) {
  const host = $('toast-host');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${msg}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'tk-act';
    b.textContent = action.label;
    b.onclick = () => { action.fn(); dismiss(); };
    el.appendChild(b);
  }
  host.appendChild(el);
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  };
  setTimeout(dismiss, duration);
}

// ── TEMA CLARO/OSCURO (auto + toggle) ────────────────────────────────────────
const THEME_KEY = 'cam2_theme';
let temaManual = localStorage.getItem(THEME_KEY) || '';

function esHoraNocturna() {
  const h = new Date().getHours();
  return h < 7 || h >= 20;
}
function aplicarTema() {
  const dark = temaManual ? temaManual === 'dark' : esHoraNocturna();
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn = $('btn-theme');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}
$('btn-theme').addEventListener('click', () => {
  const darkAhora = document.documentElement.getAttribute('data-theme') === 'dark';
  temaManual = darkAhora ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, temaManual);
  aplicarTema();
});
setInterval(() => { if (!temaManual) aplicarTema(); }, 60000); // re-evaluar auto cada minuto

// ── MODAL GLOBAL ─────────────────────────────────────────────────────────────
function showModal({ title, body = '', buttons = [] }) {
  $('modal-title').textContent = title;
  const mb = $('modal-body');
  mb.textContent = body;
  const acts = $('modal-actions');
  acts.innerHTML = '';
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'modal-btn' + (b.style ? ' ' + b.style : '');
    btn.textContent = b.label;
    btn.onclick = () => {
      if (b.keepOpen) { if (b.action) b.action(); return; }
      closeModal();
      if (b.action) b.action();
    };
    acts.appendChild(btn);
  });
  $('modal-overlay').classList.add('open');
  return mb;
}
function showModalHTML(title, html, buttons = []) {
  const mb = showModal({ title, body: '', buttons });
  mb.innerHTML = html;
  return mb;
}
function closeModal() { $('modal-overlay').classList.remove('open'); }
$('modal-overlay').addEventListener('click', e => {
  if (e.target === $('modal-overlay')) closeModal();
});

// ── ACTION SHEET (pulsación larga en mesa) ───────────────────────────────────
function abrirSheet({ titulo, sub = '', acciones }) {
  $('sheet-title').textContent = titulo;
  $('sheet-sub').textContent = sub;
  $('sheet-sub').style.display = sub ? '' : 'none';
  const cont = $('sheet-actions');
  cont.innerHTML = '';
  acciones.forEach(a => {
    const b = document.createElement('button');
    b.className = 'sheet-btn' + (a.style ? ' ' + a.style : '');
    b.innerHTML = `<span class="ico">${a.icono}</span><span style="flex:1">${a.label}${a.sub ? `<small>${a.sub}</small>` : ''}</span>`;
    b.onclick = () => { cerrarSheet(); a.fn(); };
    cont.appendChild(b);
  });
  $('sheet-overlay').classList.add('open');
  requestAnimationFrame(() => $('sheet').classList.add('open'));
}
function cerrarSheet() {
  $('sheet').classList.remove('open');
  $('sheet-overlay').classList.remove('open');
}
$('sheet-overlay').addEventListener('click', cerrarSheet);

// ── ESTADO GLOBAL ────────────────────────────────────────────────────────────
let mesasData = {};
let pedidosData = {};
let categoriasData = {};
let cartaData = {};
let catsReady = false, cartaReady = false;
let configLocal = {};
let usuariosData = {};
let seguridadData = {};
let alertasConfig = { verde: 10, amarillo: 20 };
let planoCfg = { cols: 16, rows: 12 };
let quotaActual = null;

let mesaId = null;
let mesaNombre = null;
let carrito = {};
let camareroActual = sessionStorage.getItem('cam_user') || '';
let camareroKeyActual = '';

let mesasViewMode = localStorage.getItem('cam2_view_mode') || 'grid';
let filtroMias = localStorage.getItem('cam2_mias') === '1';
let filtroCat = '';
let filtroSearch = '';
let ordenarUrgencia = localStorage.getItem('cam2_orden_urgencia') === '1';
let drawerNotasAbiertas = new Set();
let ticketEditMode = false;
let envioSinImprimir = false;

let isFirebaseConnected = false;
let isSyncInProgress = false;
const queuedMesas = new Set();
const localOcupada = new Set();
const queuedPedidosLocal = {};

let cachedVersion = localStorage.getItem('cam2_menu_version') || '0';
try {
  const cache = JSON.parse(localStorage.getItem('cam2_menu_cache') || '{}');
  if (cache.categorias && cache.carta) {
    categoriasData = cache.categorias;
    cartaData = cache.carta;
    catsReady = true; cartaReady = true;
  }
} catch (_) { }

const NOTAS_PREDEFINIDAS = ["Sin cebolla", "Poco hecho", "Muy hecho", "Sin hielo", "Para llevar", "Salsa aparte", "Sin lactosa", "Sin gluten", "Sin sal"];
function notasParaArticulo(artId) {
  const art = cartaData[artId];
  if (art && typeof art.notasRapidas === 'string' && art.notasRapidas.trim()) {
    return art.notasRapidas.split(',').map(n => n.trim()).filter(Boolean);
  }
  if (art && Array.isArray(art.notasRapidas) && art.notasRapidas.length) {
    return art.notasRapidas.map(n => String(n).trim()).filter(Boolean);
  }
  const cat = categoriasData[art?.catId];
  if (cat && Array.isArray(cat.notasRapidas) && cat.notasRapidas.length) {
    return cat.notasRapidas.map(n => String(n).trim()).filter(Boolean);
  }
  return NOTAS_PREDEFINIDAS;
}

// ── FRECUENTES (por dispositivo) ─────────────────────────────────────────────
const FREQ_KEY = 'cam2_frecuentes';
function cargarFrecuentes() {
  try { return JSON.parse(localStorage.getItem(FREQ_KEY) || '{}'); } catch (_) { return {}; }
}
function guardarFrecuente(artId, qty) {
  if (!cartaData[artId]) return;
  const f = cargarFrecuentes();
  f[artId] = (f[artId] || 0) + qty;
  const entries = Object.entries(f);
  if (entries.length > 60) {
    entries.sort((a, b) => b[1] - a[1]).slice(60).forEach(([k]) => delete f[k]);
  }
  localStorage.setItem(FREQ_KEY, JSON.stringify(f));
}

// ── PIN / LOGIN ──────────────────────────────────────────────────────────────
const PIN_SESSION = 'cam2_auth';
let pinBuffer = '';
let pinFailCount = 0;
let lockoutActive = false;

function updatePinDots(error) {
  for (let i = 0; i < 4; i++) {
    $('pd' + i).className = 'pin-dot' + (i < pinBuffer.length ? (error ? ' error' : ' filled') : '');
  }
}
function lockoutDevice(seg = 30) {
  lockoutActive = true;
  let rest = seg;
  const err = $('pin-error');
  err.textContent = `Bloqueado. Intenta en ${rest}s`;
  err.style.display = 'block';
  updatePinDots(true);
  const iv = setInterval(() => {
    rest--;
    if (rest <= 0) {
      clearInterval(iv);
      lockoutActive = false;
      err.style.display = 'none';
      err.textContent = 'PIN incorrecto';
      pinBuffer = '';
      updatePinDots(false);
    } else {
      err.textContent = `Bloqueado. Intenta en ${rest}s`;
    }
  }, 1000);
}

function obtenerPosicionGPS(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Sin geolocalización')); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout, maximumAge: 60000 });
  });
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pinErrorMsg(msg, dur = 3000) {
  const err = $('pin-error');
  err.textContent = msg;
  err.style.display = 'block';
  updatePinDots(true);
  setTimeout(() => { pinBuffer = ''; updatePinDots(false); err.style.display = 'none'; }, dur);
}

async function verificarPin() {
  if (lockoutActive) return;
  const matchEntry = Object.entries(usuariosData).find(([, u]) => u.pin === pinBuffer);
  if (!matchEntry) {
    pinFailCount++;
    updatePinDots(true);
    $('pin-error').textContent = 'PIN incorrecto';
    $('pin-error').style.display = 'block';
    logAuditoria('login_incorrecto_pin', `Intento fallido de PIN. PIN probado: ${pinBuffer}`, { intento: pinFailCount });
    if (pinFailCount >= 3) {
      logAuditoria('login_bloqueado', `Acceso bloqueado tras 3 fallos de PIN. PIN probado: ${pinBuffer}`);
      pinFailCount = 0;
      lockoutDevice(30);
    } else {
      setTimeout(() => { pinBuffer = ''; updatePinDots(false); $('pin-error').style.display = 'none'; }, 900);
    }
    return;
  }

  const [matchKey, match] = matchEntry;
  if (match.activo === false) { pinErrorMsg('Acceso denegado: este camarero está desactivado.'); return; }
  if (seguridadData?.bloqueoCamareros === true && seguridadData.excepcionCamarero !== matchKey) {
    pinErrorMsg('Acceso denegado: el comandero está cerrado.'); return;
  }

  // Validación Wi-Fi (IP)
  if (seguridadData?.wifiRestricted) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
      clearTimeout(tid);
      const data = await resp.json();
      if (data.ip !== seguridadData.wifiIP) { pinErrorMsg('Acceso denegado: debes estar en la Wi-Fi del local.'); return; }
    } catch (_) { pinErrorMsg('Error de conexión al validar la Wi-Fi.'); return; }
  }

  // Validación GPS
  if (seguridadData?.geoActivo === true && seguridadData.geoLat != null && seguridadData.geoLng != null) {
    const radio = seguridadData.geoRadio || 100;
    const intervalo = (seguridadData.geoIntervaloHoras || 3) * 3600000;
    const ultima = parseInt(localStorage.getItem('geo_validated_at') || '0');
    if (Date.now() - ultima >= intervalo) {
      try {
        const pos = await obtenerPosicionGPS(10000);
        const dist = haversine(pos.coords.latitude, pos.coords.longitude, seguridadData.geoLat, seguridadData.geoLng);
        if (dist > radio) { pinErrorMsg(`Acceso denegado: estás a ${Math.round(dist)}m del local (máx: ${radio}m).`, 4000); return; }
        localStorage.setItem('geo_validated_at', String(Date.now()));
      } catch (_) { pinErrorMsg('Error al obtener ubicación GPS. Activa la ubicación.', 4000); return; }
    }
  }

  camareroActual = match.nombre;
  camareroKeyActual = matchKey;
  const pin = pinBuffer;
  pinBuffer = '';
  updatePinDots(false);
  pinFailCount = 0;
  loginExitoso(`Inicio de sesión: ${camareroActual} (PIN: ${pin})`);
}

function loginExitoso(detalleAuditoria) {
  sessionStorage.setItem(PIN_SESSION, '1');
  sessionStorage.setItem('cam_user', camareroActual);
  $('pin-screen').style.display = 'none';
  actualizarCabecera();
  logAuditoria('login', detalleAuditoria);
  comprobarNovedades();
  if (camareroKeyActual) {
    update(ref(db, `config/usuarios/${camareroKeyActual}`), { ultimoLogin: Date.now() }).catch(() => { });
  }
}

$('pin-pad').addEventListener('click', e => {
  const btn = e.target.closest('[data-k]');
  if (!btn || lockoutActive) return;
  const k = btn.dataset.k;
  if (k === 'del') {
    pinBuffer = pinBuffer.slice(0, -1);
    updatePinDots(false);
    $('pin-error').style.display = 'none';
  } else if (k !== '') {
    if (pinBuffer.length >= 4) return;
    pinBuffer += k;
    haptic(8);
    updatePinDots(false);
    if (pinBuffer.length === 4) verificarPin();
  }
});

if (sessionStorage.getItem(PIN_SESSION) === '1' && camareroActual) {
  $('pin-screen').style.display = 'none';
}

function actualizarCabecera() {
  $('topbar-title').textContent = camareroActual || 'Camarero 2';
  $('topbar-sub').textContent = mesaNombre ? `Mesa ${mesaNombre}` : 'Comandero · sala';
}

// ── NOVEDADES (mensajes del admin a camareros) ───────────────────────────────
async function comprobarNovedades() {
  try {
    const snap = await get(ref(db, 'novedades'));
    const novedades = snap.val() || {};
    const activas = Object.values(novedades)
      .filter(n => n && n.activo)
      .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
    if (!activas.length) return;
    const clave = camareroActual.replace(/[\.#$\[\]]/g, '_');
    const vistas = (await get(ref(db, `novedades_vistas/${clave}`))).val() || {};
    const pendiente = activas.find(n => !vistas[n.id]);
    if (!pendiente) return;
    showModal({
      title: pendiente.titulo || 'Aviso',
      body: String(pendiente.mensaje || '').trim(),
      buttons: [{
        label: 'Entendido', style: 'primary',
        action: () => {
          set(ref(db, `novedades_vistas/${clave}/${pendiente.id}`), true).catch(() => { });
          setTimeout(comprobarNovedades, 300);
        }
      }]
    });
  } catch (e) { console.warn('Novedades:', e); }
}

// ── LOGS DE AUDITORÍA (compatibles con admin) ────────────────────────────────
async function logAccion(mId, envioId, accion, detalle) {
  try {
    await push(ref(db, `pedidos/${mId}/${envioId}/log`), {
      ts: Date.now(), accion, usuario: camareroActual, detalle: String(detalle || '')
    });
  } catch (_) { }
}
async function logAuditoria(accion, detalle = '', extras = {}) {
  try {
    const ts = Date.now();
    const d = new Date(ts);
    const fechaKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const entrada = {
      ts, fechaKey, hora,
      camarero: camareroActual || '(sin identificar)',
      accion,
      mesaId: mesaId || extras.mesaId || null,
      mesa: mesaNombre || extras.mesa || null,
      detalle: String(detalle || '')
    };
    if (extras && typeof extras === 'object') {
      Object.entries(extras).forEach(([k, v]) => {
        if (v !== undefined && entrada[k] === undefined) entrada[k] = v;
      });
    }
    await push(ref(db, `auditoria/${fechaKey}`), entrada);
  } catch (_) { }
}

// ── LISTENERS FIREBASE ───────────────────────────────────────────────────────
onValue(ref(db, 'config/usuarios'), s => {
  usuariosData = s.val() || {};
  if (!Object.keys(usuariosData).length) {
    get(ref(db, 'config/pins/camarero')).then(p => {
      if (p.val()) usuariosData['_default'] = { nombre: 'Camarero', pin: p.val() };
      else usuariosData['_default'] = { nombre: 'Camarero', pin: '1234' };
    });
  }
}, () => {
  usuariosData['_default'] = { nombre: 'Camarero', pin: '1234' };
});

onValue(ref(db, 'mesas'), snap => {
  mesasData = snap.val() || {};
  renderVistaMesas();
});

onValue(ref(db, 'config/menu_version'), async snap => {
  const version = String(snap.val() || '0');
  if (version !== cachedVersion || !catsReady || !cartaReady) {
    try {
      const [catsSnap, cartaSnap] = await Promise.all([
        get(ref(db, 'categorias')),
        get(ref(db, 'carta'))
      ]);
      categoriasData = catsSnap.val() || {};
      cartaData = cartaSnap.val() || {};
      catsReady = true; cartaReady = true;
      cachedVersion = version;
      localStorage.setItem('cam2_menu_version', version);
      localStorage.setItem('cam2_menu_cache', JSON.stringify({ categorias: categoriasData, carta: cartaData }));
      if (mesaId) renderCarta();
    } catch (e) { console.error('Error actualizando carta:', e); }
  } else if (mesaId) {
    renderCarta();
  }
});

onValue(ref(db, 'config/local'), snap => { configLocal = snap.val() || {}; });
onValue(ref(db, 'config/seguridad'), snap => { seguridadData = snap.val() || {}; });
onValue(ref(db, 'pedidos'), snap => {
  pedidosData = snap.val() || {};
  Object.entries(queuedPedidosLocal).forEach(([mid, envios]) => {
    if (!pedidosData[mid]) pedidosData[mid] = {};
    Object.assign(pedidosData[mid], envios);
  });
  renderVistaMesas();
  if ($('view-carta').hidden === false && mesaId) actualizarFabCuenta();
});
onValue(ref(db, 'config/alertas'), snap => {
  const d = snap.val();
  if (d) alertasConfig = { verde: d.verde || 10, amarillo: d.amarillo || 20 };
});
onValue(ref(db, 'config/plano'), snap => {
  const d = snap.val();
  if (d) planoCfg = { cols: Number(d.cols) || 16, rows: Number(d.rows) || 12 };
  if (mesasViewMode === 'plano') renderPlano();
});
onValue(ref(db, 'config/quota/lineas'), snap => { quotaActual = snap.val() ?? null; });
onValue(ref(db, '.info/connected'), snap => {
  const eraConectado = isFirebaseConnected;
  isFirebaseConnected = !!snap.val();
  actualizarBannerOffline();
  const pLoad = $('pin-loading');
  if (pLoad) pLoad.style.display = 'none';
  if (!eraConectado && isFirebaseConnected) vaciarCola();
});

// Refresco de tiempos cada 30s (colores por tiempo)
setInterval(() => {
  if (Object.keys(mesasData).length && $('view-mesas').hidden === false) {
    renderVistaMesas();
  }
}, 30000);

// ── COLA OFFLINE (IndexedDB) — mismo formato que camarero.js ─────────────────
const IDB_NAME = 'cmd-queue';
const IDB_VER = 1;
const IDB_STORE = 'orders';
let idb = null;

function abrirIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains(IDB_STORE))
        e.target.result.createObjectStore(IDB_STORE, { keyPath: 'queueId', autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}
function idbTodos() {
  return new Promise((resolve, reject) => {
    const req = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror = e => reject(e.target.error);
  });
}
function idbAgregar(registro) {
  return new Promise((resolve, reject) => {
    const req = idb.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).add(registro);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}
function idbEliminar(queueId) {
  return new Promise((resolve, reject) => {
    const req = idb.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(queueId);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

async function actualizarBannerOffline() {
  const banner = $('offline-banner');
  const pendientes = idb ? await idbTodos() : [];
  if (isFirebaseConnected) {
    if (isSyncInProgress && pendientes.length > 0) {
      banner.style.display = 'flex';
      banner.style.background = 'rgba(37,99,235,.92)';
      banner.innerHTML = '<span class="spinner"></span> Sincronizando ' + pendientes.length + ' pedido' + (pendientes.length > 1 ? 's' : '') + '…';
    } else {
      banner.style.display = 'none';
    }
  } else {
    banner.style.display = 'flex';
    banner.style.background = 'rgba(220,38,38,.94)';
    banner.innerHTML = pendientes.length > 0
      ? '📡 Sin conexión — ' + pendientes.length + ' pedido' + (pendientes.length > 1 ? 's' : '') + ' en cola local'
      : '📡 Sin conexión — los pedidos se enviarán al reconectar';
  }
}

async function vaciarCola() {
  if (isSyncInProgress || !idb) return;
  const pendientes = await idbTodos();
  if (!pendientes.length) return;
  isSyncInProgress = true;
  actualizarBannerOffline();
  for (const item of pendientes) {
    try {
      await set(ref(db, 'mesas/' + item.mesaId + '/estado'), 'ocupada');
      const payload = {
        ts: item.envioTs, camarero: item.camarero, envioId: item.envioId,
        lineas: item.lineasObj
      };
      if (item._printService) payload._printService = item._printService;
      await set(ref(db, 'pedidos/' + item.mesaId + '/' + item.envioId), payload);
      await idbEliminar(item.queueId);
      if (queuedPedidosLocal[item.mesaId]) delete queuedPedidosLocal[item.mesaId][item.envioId];
      const resto = await idbTodos();
      if (!resto.some(r => r.mesaId === item.mesaId)) {
        queuedMesas.delete(item.mesaId);
        localOcupada.delete(item.mesaId);
      }
      actualizarBannerOffline();
    } catch (_) { break; }
  }
  isSyncInProgress = false;
  actualizarBannerOffline();
  renderVistaMesas();
}

async function initCola() {
  try {
    idb = await abrirIDB();
    const pendientes = await idbTodos();
    pendientes.forEach(r => {
      queuedMesas.add(r.mesaId);
      localOcupada.add(r.mesaId);
      if (!queuedPedidosLocal[r.mesaId]) queuedPedidosLocal[r.mesaId] = {};
      queuedPedidosLocal[r.mesaId][r.envioId] = {
        ts: r.envioTs, camarero: r.camarero, envioId: r.envioId, lineas: r.lineasObj
      };
    });
    if (pendientes.length) { actualizarBannerOffline(); renderVistaMesas(); }
  } catch (e) { console.warn('IndexedDB no disponible:', e); }
}
initCola();

// ═══════════════════════════════════════════════════════════════════════════
// MESAS · CÁLCULO DE ESTADO
// Nueva semántica de color: el color NO depende de líneas "pendiente"
// (barra/cocina no marcan servido en pantalla), sino del tiempo desde la
// ÚLTIMA INTERACCIÓN = max(última comanda enviada, toque "✓ Atendida").
// ═══════════════════════════════════════════════════════════════════════════
function qtyResumen(linea) {
  if (linea.estado === 'cancelado') return 0;
  if (linea.qtyTicket !== undefined && linea.qtyTicket !== null) return Number(linea.qtyTicket || 0);
  if (linea.estado === 'servido') return Number(linea.qty || 0);
  if (linea.qtyServida !== undefined && linea.qtyServida !== null && Number(linea.qtyServida) > 0) {
    return Number(linea.qtyServida || 0);
  }
  return Number(linea.qty || 0);
}

function infoMesa(id, m) {
  const esTemporal = m.temporal === true || id.startsWith('temp_');
  const ocupada = m.estado === 'ocupada' || localOcupada.has(id);
  const info = {
    ocupada, esTemporal,
    clase: 'st-libre',            // st-libre | st-ocupada | st-warn | st-danger
    minsSentada: 0,               // tiempo desde la primera comanda
    minsAtencion: 0,              // tiempo desde la última interacción (gobierna el color)
    total: 0, uds: 0,
    nPend: 0, destinosPend: [],
    camareros: new Set(),
    tienePedidos: false
  };
  if (!ocupada && !esTemporal) return info;

  const data = pedidosData[id] || {};
  let primeraTs = Infinity, ultimaTs = 0;

  Object.entries(data).forEach(([envioId, envio]) => {
    if (envioId.startsWith('_')) return;
    const ts = Number(envio.ts) || 0;
    if (ts > 0) {
      if (ts < primeraTs) primeraTs = ts;
      if (ts > ultimaTs) ultimaTs = ts;
    }
    if (envio.camarero) info.camareros.add(envio.camarero);
    const ls = envio.lineas || { _: envio };
    Object.values(ls).forEach(l => {
      if (l.estado === 'pendiente') {
        info.nPend++;
        if (l.destino && !info.destinosPend.includes(l.destino)) info.destinosPend.push(l.destino);
      }
      if (l.camarero) info.camareros.add(l.camarero);
      const q = qtyResumen(l);
      if (q > 0 && l.destino !== 'descuento') {
        info.uds += q;
        info.total += Number(l.precio || 0) * q;
      }
    });
  });

  info.tienePedidos = ultimaTs > 0 || Object.keys(data).some(k => !k.startsWith('_'));

  if (!ocupada) { info.clase = 'st-libre'; return info; }

  // Sin pedidos: mesa ocupada neutra
  if (!info.tienePedidos) {
    info.clase = 'st-ocupada';
    return info;
  }

  info.minsSentada = primeraTs < Infinity
    ? Math.max(0, Math.floor((Date.now() - primeraTs) / 60000)) : 0;

  // ── Color por última interacción ──
  const atendidaTs = Number(m.atendidaTs) || 0;
  const baseTs = Math.max(ultimaTs, atendidaTs);
  info.minsAtencion = Math.max(0, Math.floor((Date.now() - baseTs) / 60000));

  if (info.minsAtencion >= alertasConfig.amarillo) info.clase = 'st-danger';
  else if (info.minsAtencion >= alertasConfig.verde) info.clase = 'st-warn';
  else info.clase = 'st-ocupada';

  return info;
}

function iconosDestino(destinos) {
  if (!destinos.length) return '';
  const mapa = { cocina: '🍳', pizzas: '🍕', barra: '🍺', ambos: '🍺🍳' };
  if (destinos.includes('ambos')) return '🍺🍳';
  return destinos.map(d => mapa[d] || '🍺').join('');
}

function esMesaMia(info) {
  if (!camareroActual) return false;
  return info.camareros.has(camareroActual);
}

// ── RENDER VISTA MESAS (grid o plano según modo) ─────────────────────────────
function renderVistaMesas() {
  if ($('view-mesas').hidden) return;
  if (mesasViewMode === 'plano') renderPlano();
  else renderGridMesas();
  renderKpis();
}

function mesasVisibles() {
  return Object.entries(mesasData)
    .filter(([, m]) => !String(m.nombre || '').startsWith('#'))
    .map(([id, m]) => ({ id, m, info: infoMesa(id, m) }))
    .filter(({ info }) => !filtroMias || (info.ocupada && esMesaMia(info)));
}

function ordenarMesas(lista) {
  const arr = [...lista];
  if (ordenarUrgencia) {
    // Urgentes primero (más tiempo sin atender), luego ocupadas, luego libres
    return arr.sort((a, b) => {
      const peso = i => i.info.ocupada ? (i.info.clase === 'st-danger' ? 0 : i.info.clase === 'st-warn' ? 1 : 2) : 3;
      const pa = peso(a), pb = peso(b);
      if (pa !== pb) return pa - pb;
      if (pa < 3) return b.info.minsAtencion - a.info.minsAtencion;
      return (a.m.orden ?? 999) - (b.m.orden ?? 999) || String(a.m.nombre).localeCompare(String(b.m.nombre), 'es', { numeric: true });
    });
  }
  return arr.sort((a, b) => {
    if (a.info.esTemporal && b.info.esTemporal) {
      const ha = a.m.horaRecogida || '', hb = b.m.horaRecogida || '';
      if (ha && hb) return ha.localeCompare(hb);
      if (!ha && hb) return -1;
      if (ha && !hb) return 1;
      return (a.m.creadoTs || 0) - (b.m.creadoTs || 0);
    }
    if (a.info.esTemporal !== b.info.esTemporal) return a.info.esTemporal ? 1 : -1;
    return (a.m.orden ?? 999) - (b.m.orden ?? 999) || String(a.m.nombre).localeCompare(String(b.m.nombre), 'es', { numeric: true });
  });
}

// ── KPIs de sala ─────────────────────────────────────────────────────────────
function renderKpis() {
  const lista = Object.entries(mesasData)
    .filter(([, m]) => !String(m.nombre || '').startsWith('#'))
    .map(([id, m]) => infoMesa(id, m));
  const ocupadas = lista.filter(i => i.ocupada);
  const totalSala = ocupadas.reduce((s, i) => s + i.total, 0);
  const urgentes = ocupadas.filter(i => i.clase === 'st-danger').length;
  const avisadas = ocupadas.filter(i => i.clase === 'st-warn').length;
  const mias = ocupadas.filter(i => esMesaMia(i)).length;

  $('kpis').innerHTML = `
    <div class="kpi"><b>${ocupadas.length}</b><span>ocupadas${camareroActual ? ` · ${mias} mías` : ''}</span></div>
    <div class="kpi"><b>${fmtEu(totalSala)}</b><span>en sala</span></div>
    <div class="kpi ${avisadas ? 'kpi-warn' : ''}"><b>${avisadas}</b><span>⏳ por atender</span></div>
    <div class="kpi ${urgentes ? 'kpi-danger' : ''}"><b>${urgentes}</b><span>🔴 urgentes</span></div>`;
}

// ── GRID de mesas ────────────────────────────────────────────────────────────
function crearMesaCard({ id, m, info }) {
  const card = document.createElement('div');
  const clases = ['mesa-card', info.clase];
  if (info.esTemporal) clases.push('st-temporal');
  card.className = clases.join(' ');

  const chipTiempo = info.ocupada && info.tienePedidos
    ? `<span class="mesa-time" title="Tiempo sin atender">⏱ ${fmtDur(info.minsAtencion)}</span>`
    : '';
  const badges = [];
  if (queuedMesas.has(id)) badges.push('<span class="mini-badge sync">⏳ sync</span>');
  if (info.ocupada && esMesaMia(info)) badges.push(`<span class="mini-badge">${escapeHtml((camareroActual || '?').slice(0, 2).toUpperCase())}</span>`);

  const mid = info.ocupada && info.tienePedidos
    ? `<div class="mesa-mid"><b>${fmtEu(info.total)}</b><span>${info.uds} uds</span></div>`
    : `<div class="mesa-mid"><span class="mesa-estado-txt">${info.ocupada ? 'ocupada' : info.esTemporal ? 'temporal' : 'libre'}</span></div>`;

  const pend = info.ocupada && info.nPend > 0
    ? `<div class="mesa-pend">${iconosDestino(info.destinosPend)} ${info.nPend} pend · sentados ${fmtDur(info.minsSentada)}</div>`
    : (info.ocupada && info.tienePedidos
      ? `<div class="mesa-pend">sentados ${fmtDur(info.minsSentada)}</div>` : '');

  card.innerHTML = `
    ${badges.length ? `<div class="mesa-badges">${badges.join('')}</div>` : ''}
    <div class="mesa-top">
      <span class="mesa-num">${escapeHtml(m.nombre)}</span>
      ${chipTiempo}
    </div>
    ${mid}
    ${pend}`;

  asignarLongPress(card, id, m, info);
  return card;
}

function renderGridMesas() {
  const grid = $('mesas-grid');
  const lista = ordenarMesas(mesasVisibles());

  if (!lista.length) {
    grid.innerHTML = filtroMias
      ? '<div class="loading">No tienes mesas asignadas ahora mismo.</div>'
      : '<div class="loading">Sin mesas configuradas.</div>';
    return;
  }

  grid.innerHTML = '';
  const hayZonas = lista.some(({ m }) => m.zona && String(m.zona).trim());

  if (hayZonas && !ordenarUrgencia) {
    const grupos = {};
    lista.forEach(item => {
      const zona = String(item.m.zona || '').trim() || 'Sin zona';
      (grupos[zona] = grupos[zona] || []).push(item);
    });
    Object.entries(grupos).forEach(([zona, items]) => {
      const h = document.createElement('div');
      h.className = 'zona-header';
      h.textContent = zona;
      grid.appendChild(h);
      const sub = document.createElement('div');
      sub.className = 'mesas-grid';
      items.forEach(item => sub.appendChild(crearMesaCard(item)));
      grid.appendChild(sub);
    });
    grid.style.display = 'block';
  } else {
    grid.style.display = 'grid';
    lista.forEach(item => grid.appendChild(crearMesaCard(item)));
  }
}

// ── PLANO renovado (zonas con color, scroll táctil) ──────────────────────────
let planoZonaActiva = null;

function renderPlano() {
  const cont = $('plano-contenedor');
  const grid = $('mesas-grid');

  const entries = Object.entries(mesasData)
    .filter(([id]) => !id.startsWith('temp_'))
    .map(([id, m]) => ({ id, m, info: infoMesa(id, m) }))
    .filter(({ info }) => !filtroMias || (info.ocupada && esMesaMia(info)));

  if (!entries.length) {
    grid.innerHTML = '';
    cont.innerHTML = '<div class="loading">Sin mesas que mostrar.</div>';
    return;
  }

  const hayZonas = entries.some(({ m }) => m.zona && String(m.zona).trim());
  const zonas = hayZonas ? [...new Set(entries.map(({ m }) => String(m.zona).trim()))] : [];
  if (hayZonas && (!planoZonaActiva || !zonas.includes(planoZonaActiva))) planoZonaActiva = zonas[0];

  const tabsHTML = hayZonas
    ? `<div class="plano-tabs">
        <button class="plano-tab${!planoZonaActiva ? ' active' : ''}" data-zona="">Todas</button>
        ${zonas.map(z => `<button class="plano-tab${z === planoZonaActiva ? ' active' : ''}" data-zona="${escapeHtml(z)}">${escapeHtml(z)}</button>`).join('')}
       </div>`
    : '';

  const mostrar = planoZonaActiva
    ? entries.filter(({ m }) => String(m.zona || '').trim() === planoZonaActiva)
    : entries;

  // Agrupar por zona para pintar cajas diferenciadas
  const grupos = {};
  mostrar.forEach(item => {
    const z = String(item.m.zona || '').trim() || '';
    (grupos[z] = grupos[z] || []).push(item);
  });

  const cols = planoCfg.cols, rows = planoCfg.rows;
  const zonasHTML = Object.entries(grupos).map(([zona, items]) => {
    const ubicadas = items.filter(({ m }) => m.plano);
    const sinUbicar = items.filter(({ m }) => !m.plano && !String(m.nombre).startsWith('#'));

    const celdas = ubicadas.map(({ id, m, info }) => {
      const p = m.plano;
      const isDeco = String(m.nombre).startsWith('#');
      const style = `--pc:${p.x};--pw:${p.w || 1};--pr:${p.y};--ph:${p.h || 1}`;

      if (isDeco) {
        return `<div class="plano-mesa decorador${p.shape === 'circle' ? ' circle' : ''}" style="${style}">
          <span class="pm-nombre">${escapeHtml(m.nombre.slice(1))}</span></div>`;
      }

      const lineaInfo = info.ocupada && info.tienePedidos
        ? `${fmtEu(info.total)} · ⏱${fmtDur(info.minsAtencion)}`
        : (info.ocupada ? 'ocupada' : 'libre');

      return `<div class="plano-mesa ${info.clase}${p.shape === 'circle' ? ' circle' : ''}"
        data-id="${id}" style="${style}">
        <span class="pm-nombre">${escapeHtml(m.nombre)}${queuedMesas.has(id) ? ' ⏳' : ''}</span>
        <span class="pm-info">${lineaInfo}</span>
      </div>`;
    }).join('');

    const sinUbicarHTML = sinUbicar.length
      ? `<div class="plano-sinubicar">Sin ubicar en plano: ${sinUbicar.map(({ m }) => escapeHtml(m.nombre)).join(', ')}</div>`
      : '';

    return `<div class="plano-zona">
      ${zona ? `<div class="plano-zona-label">${escapeHtml(zona)}</div>` : ''}
      <div class="plano-scroll"><div class="plano-zona-box">
        <div class="plano-grid" style="--plano-cols:${cols};--plano-rows:${rows}">${celdas}</div>
      </div></div>
      ${sinUbicarHTML}
    </div>`;
  }).join('');

  grid.innerHTML = '';
  grid.style.display = 'none';
  cont.innerHTML = tabsHTML + zonasHTML;

  // Eventos tabs
  cont.querySelectorAll('.plano-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      planoZonaActiva = btn.dataset.zona || null;
      renderPlano();
    });
  });

  // Eventos celdas
  cont.querySelectorAll('.plano-mesa[data-id]').forEach(el => {
    const id = el.dataset.id;
    const m = mesasData[id];
    if (!m) return;
    asignarLongPress(el, id, m, infoMesa(id, m));
  });
}

// ── PULSACIÓN LARGA → ACTION SHEET con acciones rápidas ──────────────────────
function asignarLongPress(el, id, m, info) {
  let timer = null;
  let longPress = false;

  const start = e => {
    if (e.type === 'mousedown' && e.button !== 0) return;
    longPress = false;
    timer = setTimeout(() => {
      longPress = true;
      timer = null;
      haptic(30);
      abrirSheetMesa(id, m, infoMesa(id, m));
    }, 550);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

  el.style.webkitTouchCallout = 'none';
  el.style.userSelect = 'none';

  el.addEventListener('mousedown', start);
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('click', e => {
    if (longPress) { e.preventDefault(); e.stopPropagation(); longPress = false; return; }
    cancel();
    abrirMesa(id, m.nombre, info.ocupada);
  });
  el.addEventListener('mouseup', cancel);
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchmove', cancel);
  el.addEventListener('mouseleave', cancel);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

function abrirSheetMesa(id, m, info) {
  const ocupada = info.ocupada;
  const sub = ocupada && info.tienePedidos
    ? `${fmtEu(info.total)} · ${info.uds} uds · ${fmtDur(info.minsSentada)} sentados`
    : (ocupada ? 'Ocupada sin consumo' : 'Libre');

  const acciones = [];

  if (ocupada && info.tienePedidos) {
    acciones.push({
      icono: '✓', label: 'Marcar atendida', style: 'accent',
      sub: 'Reinicia el temporizador de color',
      fn: () => marcarAtendida(id, m.nombre)
    });
    acciones.push({ icono: '🧾', label: 'Ver cuenta', fn: async () => { abrirMesa(id, m.nombre, true); await verCuenta(); } });
    acciones.push({ icono: '🔁', label: 'Repetir última comanda', sub: 'Con revisión previa', fn: () => abrirRepetirModal(id, m.nombre) });
    acciones.push({
      icono: '🧹', label: 'Vaciar mesa',
      sub: 'Borra pedidos sin guardar historial',
      fn: () => vaciarMesa(id, m.nombre)
    });
    acciones.push({ icono: '✕', label: 'Cerrar mesa', style: 'danger', sub: 'Guarda historial', fn: () => cerrarMesaEspecifica(id, m.nombre) });
  } else if (ocupada) {
    acciones.push({ icono: '✕', label: 'Cerrar mesa', style: 'danger', sub: 'Abierta por error', fn: () => cerrarMesaEspecifica(id, m.nombre) });
  } else {
    acciones.push({ icono: '📝', label: 'Abrir mesa', fn: () => abrirMesa(id, m.nombre, false) });
  }

  abrirSheet({ titulo: `Mesa ${m.nombre}`, sub, acciones });
}

// ── ACCIONES DE MESA ─────────────────────────────────────────────────────────
async function marcarAtendida(id, nombre) {
  try {
    await update(ref(db, 'mesas/' + id), { atendidaTs: Date.now() });
    haptic(20);
    toast(`✓ Mesa ${escapeHtml(nombre)} marcada como atendida`);
    logAuditoria('mesa_atendida', `Mesa ${nombre} marcada como atendida`, { mesaId: id });
  } catch (e) {
    toast('No se pudo guardar');
  }
}

function vaciarMesa(id, nombre) {
  showModal({
    title: `Vaciar mesa ${nombre}`,
    body: 'Se borrarán los pedidos de esta mesa SIN guardar historial. Útil si se abrió por error.',
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Vaciar', style: 'danger', action: async () => {
          await remove(ref(db, 'pedidos/' + id));
          if (id.startsWith('temp_')) await remove(ref(db, 'mesas/' + id));
          else await update(ref(db, 'mesas/' + id), { estado: 'libre', atendidaTs: null });
          logAuditoria('mesa_vaciada', `Mesa ${nombre} vaciada sin historial`, { mesaId: id });
          toast(`Mesa ${escapeHtml(nombre)} vaciada`);
          if (mesaId === id) volverMesas(true);
        }
      }
    ]
  });
}

// ── HELPERS DE PEDIDOS ───────────────────────────────────────────────────────
function aplanarPedidos(pedidos) {
  const lineas = [];
  Object.entries(pedidos || {}).forEach(([envioId, envio]) => {
    if (envioId.startsWith('_')) return;
    const ls = envio.lineas || { [envioId]: envio };
    const envioTs = envio.ts || null;
    const envioCamarero = envio.camarero || null;
    Object.entries(ls).forEach(([keyInDb, l]) => {
      const artId = l.artId || keyInDb;
      const baseId = String(artId).split('__')[0];
      const nombre = l.nombre || (cartaData[baseId]?.nombre) || 'Artículo';
      const precio = l.precio !== undefined ? l.precio : (cartaData[baseId]?.precio || 0);
      const destino = l.destino || (cartaData[baseId]?.destino || 'barra');
      lineas.push({ ...l, envioId, dbKey: keyInDb, artId, nombre, precio, destino, envioTs, envioCamarero });
    });
  });
  return lineas;
}
function qtyEnCuenta(linea) {
  if (linea.qtyTicket !== undefined && linea.qtyTicket !== null) return Number(linea.qtyTicket || 0);
  if (linea.estado === 'cancelado') return 0;
  if (linea.estado === 'servido') return Number(linea.qty || 0);
  if (linea.qtyServida !== undefined && linea.qtyServida !== null) return Number(linea.qtyServida || 0);
  return Number(linea.qty || 0);
}

// ── REPETIR ÚLTIMA COMANDA (con previsualización editable) ───────────────────
async function abrirRepetirModal(targetMesaId, nombreMesa) {
  try {
    const snap = await get(ref(db, 'pedidos/' + targetMesaId));
    const todas = aplanarPedidos(snap.val() || {})
      .filter(l => qtyEnCuenta(l) > 0 && l.destino !== 'descuento');

    if (!todas.length) {
      showModal({ title: 'Repetir comanda', body: 'Esta mesa no tiene comandas anteriores.', buttons: [{ label: 'Cerrar', style: 'primary' }] });
      return;
    }

    // Agrupar por nombre+precio+nota para la previsualización
    const grupos = {};
    todas.forEach(l => {
      const k = `${l.nombre}||${Number(l.precio).toFixed(2)}||${(l.nota || '').trim()}`;
      if (!grupos[k]) grupos[k] = { nombre: l.nombre, precio: Number(l.precio), nota: l.nota || '', artId: String(l.artId).split('__')[0], destino: l.destino, qty: 0 };
      grupos[k].qty += qtyEnCuenta(l);
    });
    const filas = Object.values(grupos);

    showModalHTML(`Repetir · Mesa ${nombreMesa}`, `
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
        Esto es lo que se va a repetir. Ajusta cantidades o quita líneas antes de cargarlo al pedido.
      </div>
      <div id="rep-list" style="display:flex;flex-direction:column;gap:8px"></div>`,
      [
        { label: 'Cancelar' },
        {
          label: 'Cargar al pedido', style: 'primary',
          action: () => cargarRepetido(targetMesaId, nombreMesa, filas)
        }
      ]);

    const list = $('rep-list');
    filas.forEach((f, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:600">${escapeHtml(f.nombre)}</div>
          <div style="font-size:11px;color:var(--muted);font-family:var(--mono)">${fmtEu(f.precio)}${f.nota ? ' · ' + escapeHtml(f.nota) : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="tk-qty-btn" data-act="dec">−</button>
          <span class="tk-qty-num" data-qty>${f.qty}</span>
          <button class="tk-qty-btn" data-act="inc">+</button>
        </div>`;
      row.querySelector('[data-act="dec"]').onclick = () => {
        if (f.qty > 0) { f.qty--; row.querySelector('[data-qty]').textContent = f.qty; row.style.opacity = f.qty ? '1' : '.4'; }
      };
      row.querySelector('[data-act="inc"]').onclick = () => {
        f.qty++; row.querySelector('[data-qty]').textContent = f.qty; row.style.opacity = '1';
      };
      list.appendChild(row);
    });
  } catch (e) {
    console.error(e);
    toast('No se pudo cargar la comanda');
  }
}

function cargarRepetido(targetMesaId, nombreMesa, filas) {
  const seleccion = filas.filter(f => f.qty > 0);
  if (!seleccion.length) { toast('No has seleccionado nada'); return; }

  if (mesaId !== targetMesaId) abrirMesa(targetMesaId, nombreMesa, true);

  seleccion.forEach((f, i) => {
    const baseArt = cartaData[f.artId];
    const key = `rep_${targetMesaId}_${i}`;
    carrito[key] = {
      art: {
        nombre: f.nombre,
        precio: f.precio,
        destino: f.destino === 'none' ? 'none' : (baseArt?.destino || f.destino || 'barra')
      },
      qty: f.qty,
      nota: f.nota,
      _repArtId: f.artId
    };
  });

  updateCartaUI();
  cerrarDrawerSilencioso();
  haptic(25);
  toast(`🔁 ${seleccion.reduce((s, f) => s + f.qty, 0)} artículos cargados — revisa y envía`, { duration: 3200 });
  logAuditoria('repetir_comanda', `Repetición cargada en mesa ${nombreMesa}`, { mesaId: targetMesaId, lineas: seleccion.length });
}

// ═══════════════════════════════════════════════════════════════════════════
// NAVEGACIÓN ENTRE VISTAS
// ═══════════════════════════════════════════════════════════════════════════
function show(vista) {
  $('view-mesas').hidden = vista !== 'mesas';
  $('view-carta').hidden = vista !== 'carta';
  $('view-ticket').hidden = vista !== 'ticket';
  $('carta-actionbar').hidden = vista !== 'carta';
  $('btn-cuenta-fab').classList.toggle('visible', vista === 'carta' && !!mesaId && mesaTieneConsumo());
  if (vista === 'mesas') {
    $('mesas-grid').style.display = mesasViewMode === 'grid' ? '' : 'none';
    $('plano-contenedor').hidden = mesasViewMode !== 'plano';
    renderVistaMesas();
  }
  window.scrollTo({ top: 0 });
}

function mesaTieneConsumo() {
  if (!mesaId) return false;
  const d = pedidosData[mesaId];
  if (!d) return false;
  return Object.entries(d).some(([k, envio]) => !k.startsWith('_') && envio && envio.lineas);
}

function actualizarFabCuenta() {
  $('btn-cuenta-fab').classList.toggle('visible', $('view-carta').hidden === false && !!mesaId && mesaTieneConsumo());
}

function abrirMesa(id, nombre, ocupada) {
  if (mesaId && mesaId !== id && Object.keys(carrito).length) {
    showModal({
      title: 'Cambiar de mesa',
      body: 'Tienes artículos sin enviar en la mesa actual. Si cambias, se perderán.',
      buttons: [
        { label: 'Cancelar' },
        { label: 'Cambiar y borrar', style: 'danger', action: () => entrarMesa(id, nombre, ocupada) }
      ]
    });
    return;
  }
  entrarMesa(id, nombre, ocupada);
}

function entrarMesa(id, nombre, ocupada) {
  mesaId = id;
  mesaNombre = nombre;
  carrito = {};
  drawerNotasAbiertas.clear();
  filtroCat = '';
  filtroSearch = '';
  $('carta-search').value = '';
  $('btn-clear-search').hidden = true;
  $('carta-mesa-pill').textContent = 'Mesa ' + nombre;
  actualizarCabecera();
  if (cartaReady && catsReady) renderCarta();
  else $('carta-body').innerHTML = '<div class="loading">Cargando carta…</div>';
  updateCartaUI();
  show('carta');
}

function volverMesas(forzar = false) {
  const salir = () => {
    mesaId = null;
    mesaNombre = null;
    carrito = {};
    drawerNotasAbiertas.clear();
    ticketEditMode = false;
    actualizarCabecera();
    cerrarDrawerSilencioso();
    show('mesas');
  };
  if (!forzar && Object.keys(carrito).length) {
    showModal({
      title: '¿Salir de la mesa?',
      body: 'Tienes artículos en el pedido actual que aún no has enviado. Si sales, se perderán.',
      buttons: [
        { label: 'Salir y borrar', style: 'danger', action: salir },
        { label: 'Permanecer', style: 'primary' }
      ]
    });
  } else {
    salir();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CARTA
// ═══════════════════════════════════════════════════════════════════════════
function renderCarta() {
  const cats = Object.entries(categoriasData)
    .sort(([, a], [, b]) => (a.orden ?? 999) - (b.orden ?? 999) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const body = $('carta-body');
  if (!cats.length) { body.innerHTML = '<div class="loading">Sin categorías en la carta.</div>'; renderFrecuentes(); renderCatChips(cats); return; }

  // Chips de categoría
  renderCatChips(cats);

  // Frecuentes
  renderFrecuentes();

  // Secciones
  body.innerHTML = '';
  cats.forEach(([catId, cat]) => {
    const arts = Object.entries(cartaData)
      .filter(([, a]) => a.catId === catId)
      .sort(([, a], [, b]) => (a.orden ?? 999) - (b.orden ?? 999) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
    if (!arts.length) return;

    const section = document.createElement('div');
    section.className = 'cat-section';
    section.id = 'cat-' + catId;

    const toggle = document.createElement('div');
    toggle.className = 'cat-toggle';
    toggle.innerHTML = `
      <span class="cn">${escapeHtml(cat.nombre)}</span>
      <span class="cc" id="catcount-${catId}"></span>
      <span class="arrow">▾</span>`;
    toggle.addEventListener('click', () => section.classList.toggle('collapsed'));
    section.appendChild(toggle);

    const items = document.createElement('div');
    items.className = 'cat-items';
    arts.forEach(([artId, art]) => items.appendChild(crearArtRow(artId, art)));
    section.appendChild(items);
    body.appendChild(section);
  });

  aplicarFiltrosCarta();
}

function renderFrecuentes() {
  const wrap = $('frecuentes');
  const scroll = $('freq-scroll');
  const sinFiltro = !filtroSearch && !filtroCat;
  const f = cargarFrecuentes();
  const top = Object.entries(f)
    .filter(([artId]) => cartaData[artId] && cartaData[artId].disponible !== false && !cartaData[artId].esCombo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (!sinFiltro || top.length < 3) { wrap.hidden = true; return; }
  wrap.hidden = false;
  scroll.innerHTML = '';
  top.forEach(([artId]) => {
    const art = cartaData[artId];
    const el = document.createElement('div');
    el.className = 'freq-item';
    el.innerHTML = `<span class="fn">${escapeHtml(art.nombre)}</span><span class="fp">${fmtEu(art.precio)}</span>`;
    el.addEventListener('click', () => { cambiarQty(artId, +1); haptic(10); });
    scroll.appendChild(el);
  });
}

function renderCatChips(cats) {
  const host = $('cat-chips');
  host.innerHTML = '';
  const mk = (catId, nombre) => {
    const b = document.createElement('button');
    b.className = 'cat-chip' + (filtroCat === catId ? ' active' : '');
    b.dataset.cat = catId;
    const count = qtyEnCategoria(catId);
    b.innerHTML = `${escapeHtml(nombre)}${count ? `<span class="cnt">${count}</span>` : ''}`;
    b.addEventListener('click', () => {
      filtroCat = filtroCat === catId ? '' : catId;
      renderCatChips(cats);
      aplicarFiltrosCarta();
      renderFrecuentes();
    });
    return b;
  };
  host.appendChild(mk('', 'Todas'));
  cats.forEach(([catId, cat]) => {
    const n = Object.values(cartaData).filter(a => a.catId === catId).length;
    if (n) host.appendChild(mk(catId, cat.nombre));
  });
}

function qtyEnCategoria(catId) {
  if (!catId) return Object.values(carrito).reduce((s, i) => s + i.qty, 0);
  return Object.entries(carrito).reduce((s, [k, i]) => {
    const baseId = k.split('__')[0];
    return cartaData[baseId]?.catId === catId ? s + i.qty : s;
  }, 0);
}

// ── Fila de artículo ─────────────────────────────────────────────────────────
function crearArtRow(artId, art) {
  const agotado = art.disponible === false;
  const wrap = document.createElement('div');
  wrap.className = 'art-row' + (agotado ? ' agotado' : '');
  wrap.dataset.artid = artId;
  wrap.dataset.nombre = String(art.nombre || '').toLowerCase();

  const meta = [];
  if (art.esCombo) meta.push('🎁 combo');
  const nVars = (art.variantes?.length || 0) + (categoriasData[art.catId]?.variantes?.length || 0);
  if (nVars) meta.push('◈ variantes');
  if (art.destino === 'cocina') meta.push('🍳 cocina');
  else if (art.destino === 'pizzas') meta.push('🍕 pizzas');
  else if (art.destino === 'ambos') meta.push('🍺🍳');

  const alergBtn = art.alergenos?.length
    ? `<button class="btn-alerg" data-alerg="${artId}" title="Alérgenos">⚠</button>` : '';

  wrap.innerHTML = `
    <div class="art-main">
      <div class="art-info">
        <span class="art-nombre">${escapeHtml(art.nombre)}</span>
        ${meta.length ? `<span class="art-meta">${meta.join(' · ')}</span>` : ''}
      </div>
      ${alergBtn}
      <span class="art-precio">${fmtEu(art.precio)}</span>
      <button class="btn-nota" data-nota="${artId}" title="Nota">📝</button>
      <div class="qty-ctrl">
        <button class="qty-btn" data-d="-1">−</button>
        <span class="qty-num" id="qty-${artId}">0</span>
        <button class="qty-btn" data-d="1">+</button>
      </div>
    </div>
    ${art.alergenos?.length ? `<div class="alerg-panel" id="alerg-${artId}" hidden>⚠ Alérgenos: ${escapeHtml(art.alergenos.join(', '))}</div>` : ''}`;

  // Tocar la zona de nombre/precio = +1 (más rápido que buscar el +)
  wrap.querySelector('.art-info').addEventListener('click', () => {
    if (agotado) return;
    cambiarQty(artId, +1);
    haptic(8);
  });
  wrap.querySelectorAll('.qty-btn').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (agotado) return;
      cambiarQty(artId, Number(b.dataset.d));
      haptic(8);
    });
  });
  const notaBtn = wrap.querySelector('[data-nota]');
  notaBtn.addEventListener('click', e => { e.stopPropagation(); abrirNotaModal(artId, art.nombre); });
  const alergB = wrap.querySelector('[data-alerg]');
  if (alergB) alergB.addEventListener('click', e => {
    e.stopPropagation();
    const p = $('alerg-' + artId);
    if (p) p.hidden = !p.hidden;
  });

  return wrap;
}

// ── Filtros (búsqueda + categoría) ───────────────────────────────────────────
function aplicarFiltrosCarta() {
  const search = filtroSearch.trim().toLowerCase();
  document.querySelectorAll('#carta-body .cat-section').forEach(section => {
    const catId = section.id.slice(4);
    const matchCat = !filtroCat || filtroCat === catId;
    if (!matchCat) { section.style.display = 'none'; return; }

    let visibles = 0;
    section.querySelectorAll('.art-row').forEach(row => {
      const ok = !search || row.dataset.nombre.includes(search);
      row.style.display = ok ? '' : 'none';
      if (ok) visibles++;
    });
    section.style.display = visibles ? '' : 'none';
    if (search && visibles) section.classList.remove('collapsed');
  });
}

$('carta-search').addEventListener('input', e => {
  filtroSearch = e.target.value;
  $('btn-clear-search').hidden = !filtroSearch;
  aplicarFiltrosCarta();
  renderFrecuentes();
});
$('btn-clear-search').addEventListener('click', () => {
  $('carta-search').value = '';
  filtroSearch = '';
  $('btn-clear-search').hidden = true;
  aplicarFiltrosCarta();
  renderFrecuentes();
});

// ═══════════════════════════════════════════════════════════════════════════
// CARRITO
// ═══════════════════════════════════════════════════════════════════════════
function cambiarQty(artId, delta) {
  const art = cartaData[artId];
  if (!art) return;

  // Combo: modal al sumar, resta la última línea
  if (art.esCombo === true) {
    if (delta > 0) { abrirComboModal(artId, art); return; }
    const comboKeys = Object.keys(carrito).filter(k => k.startsWith(artId + '__combo__'));
    if (comboKeys.length) {
      const last = comboKeys[comboKeys.length - 1];
      const next = Math.max(0, carrito[last].qty + delta);
      if (next === 0) delete carrito[last]; else carrito[last].qty = next;
      updateCartaUI();
    }
    return;
  }

  const catVariantes = categoriasData[art.catId]?.variantes || [];
  const artVariantes = art.variantes || [];
  const tieneVariantes = artVariantes.length > 0 || catVariantes.length > 0;

  if (delta > 0 && tieneVariantes) { abrirVarianteModal(artId, art); return; }
  if (delta < 0 && tieneVariantes) {
    const varKeys = Object.keys(carrito).filter(k => k.startsWith(artId + '__v'));
    if (varKeys.length) {
      const last = varKeys[varKeys.length - 1];
      const next = Math.max(0, carrito[last].qty + delta);
      if (next === 0) delete carrito[last]; else carrito[last].qty = next;
      updateCartaUI();
    }
    return;
  }

  // Artículo simple
  const prev = carrito[artId]?.qty || 0;
  const next = Math.max(0, prev + delta);
  if (next === 0) delete carrito[artId];
  else if (!carrito[artId]) carrito[artId] = { art, qty: next, nota: '' };
  else carrito[artId].qty = next;
  updateCartaUI();
}

function seleccionarVariante(artId, varIdx, qty) {
  const art = cartaData[artId];
  const todas = [...(art.variantes || []), ...(categoriasData[art.catId]?.variantes || [])];
  const v = todas[varIdx];
  if (!v) return;
  const key = `${artId}__v${varIdx}__${String(v.nombre).replace(/[^a-zA-Z0-9]/g, '')}`;
  const prev = carrito[key]?.qty || 0;
  carrito[key] = {
    art: { ...art, nombre: `${art.nombre} (${v.nombre})`, precio: Number(v.precio ?? art.precio) },
    qty: prev + qty,
    nota: carrito[key]?.nota || ''
  };
  haptic(10);
  updateCartaUI();
}

// ── Modal variantes ──────────────────────────────────────────────────────────
function abrirVarianteModal(artId, art) {
  let selIdx = null;
  let qty = 1;
  const todas = [...(art.variantes || []), ...(categoriasData[art.catId]?.variantes || [])];

  function render() {
    showModalHTML(art.nombre, `
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">Elige variante y cantidad:</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${todas.map((v, i) => `
          <div style="border-radius:12px;border:1px solid ${selIdx === i ? 'var(--accent-border)' : 'var(--border)'};background:${selIdx === i ? 'var(--accent-soft)' : 'var(--surface-2)'};overflow:hidden">
            <button type="button" data-varidx="${i}" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;width:100%;background:none;border:none;cursor:pointer;font-size:14px;color:${selIdx === i ? 'var(--accent)' : 'var(--text)'}">
              <span>${escapeHtml(v.nombre)}</span>
              <span style="font-family:var(--mono)">${Number(v.precio).toFixed(2)} €</span>
            </button>
          </div>`).join('')}
        <div style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:4px">
          <button type="button" class="tk-qty-btn" id="vq-m">−</button>
          <span class="tk-qty-num">${qty}</span>
          <button type="button" class="tk-qty-btn" id="vq-p">+</button>
        </div>
      </div>`,
      [
        { label: 'Cancelar' },
        {
          label: selIdx === null ? 'Añadir' : `Añadir ${qty}`, style: 'primary',
          action: () => { if (selIdx !== null) seleccionarVariante(artId, selIdx, qty); }
        }
      ]);

    document.querySelectorAll('[data-varidx]').forEach(b => {
      b.onclick = () => { selIdx = parseInt(b.dataset.varidx); qty = 1; render(); };
    });
    const m = $('vq-m'), p = $('vq-p');
    if (m) m.onclick = () => { if (qty > 1) { qty--; render(); } };
    if (p) p.onclick = () => { qty++; render(); };
  }
  render();
}

// ── Modal combos ─────────────────────────────────────────────────────────────
function abrirComboModal(artId, art) {
  const comboGroups = art.combo || [];
  if (!comboGroups.length) {
    const key = artId + '__combo__directo';
    const prev = carrito[key]?.qty || 0;
    carrito[key] = { art: { ...art }, qty: prev + 1, nota: '', basePrecio: art.precio };
    updateCartaUI();
    return;
  }

  let selections = new Array(comboGroups.length).fill(null);
  let qty = 1;

  function render() {
    const completos = selections.every(s => s !== null);
    const botones = [{ label: 'Cancelar' }];
    if (completos) {
      botones.push({
        label: `Añadir ${qty}`, style: 'primary',
        action: () => confirmarCombo(artId, art, selections, qty)
      });
    }
    showModalHTML(`🎁 ${art.nombre}`, `
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
        Elige una opción de cada grupo${completos ? '' : ' · faltan selecciones'}:
      </div>
      ${comboGroups.map((g, gi) => `
        <div style="margin-bottom:12px">
          <div style="font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px">${escapeHtml(g.nombre || 'Grupo ' + (gi + 1))}</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${(g.items || []).map(it => {
              const subArt = cartaData[it.artId];
              if (!subArt) return '';
              const sel = selections[gi]?.artId === it.artId;
              const vars = subArt.variantes || [];
              return `
                <div style="border:1px solid ${sel ? 'var(--accent-border)' : 'var(--border)'};background:${sel ? 'var(--accent-soft)' : 'var(--surface-2)'};border-radius:12px;overflow:hidden">
                  <button type="button" class="combo-opt" data-g="${gi}" data-a="${it.artId}" style="display:flex;justify-content:space-between;width:100%;padding:11px 13px;background:none;border:none;cursor:pointer;font-size:13.5px;color:${sel ? 'var(--accent)' : 'var(--text)'}">
                    <span>${escapeHtml(subArt.nombre)}</span>
                    ${it.suplemento > 0 ? `<span style="font-family:var(--mono);font-size:12px">+${Number(it.suplemento).toFixed(2)} €</span>` : ''}
                  </button>
                  ${sel && vars.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 13px 10px">
                    ${vars.map(v => `<button type="button" class="ri-chip" data-g="${gi}" data-v="${escapeHtml(v.nombre)}" style="${selections[gi]?.variante === v.nombre ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : ''}">${escapeHtml(v.nombre)}</button>`).join('')}
                  </div>` : ''}
                </div>`;
            }).join('')}
          </div>
        </div>`).join('')}
      <div style="display:flex;align-items:center;gap:8px;justify-content:center">
        <button type="button" class="tk-qty-btn" id="cq-m">−</button>
        <span class="tk-qty-num">${qty}</span>
        <button type="button" class="tk-qty-btn" id="cq-p">+</button>
      </div>`, botones);

    document.querySelectorAll('.combo-opt').forEach(b => {
      b.onclick = () => {
        const gi = +b.dataset.g, aid = b.dataset.a;
        const item = (comboGroups[gi].items || []).find(i => i.artId === aid);
        const subArt = cartaData[aid];
        if (item && subArt) {
          selections[gi] = {
            artId: aid, nombre: subArt.nombre, destino: subArt.destino || 'barra',
            suplemento: item.suplemento || 0, variante: null
          };
          render();
        }
      };
    });
    document.querySelectorAll('[data-v]').forEach(b => {
      b.onclick = () => {
        const gi = +b.dataset.g;
        if (selections[gi]) { selections[gi].variante = b.dataset.v; render(); }
      };
    });
    const m = $('cq-m'), p = $('cq-p');
    if (m) m.onclick = () => { if (qty > 1) { qty--; render(); } };
    if (p) p.onclick = () => { qty++; render(); };
  }
  render();
}

function confirmarCombo(artId, art, selections, qty) {
  const selStr = selections.map(s => `${s.artId}:${s.variante || ''}`).join('|');
  const key = artId + '__combo__' + selStr;
  const prev = carrito[key]?.qty || 0;
  const totalSupl = selections.reduce((s, i) => s + (i.suplemento || 0), 0);
  carrito[key] = {
    art: { ...art, precio: Number(art.precio) + totalSupl },
    selections: selections.map(s => ({ ...s })),
    basePrecio: art.precio,
    qty: prev + qty,
    nota: carrito[key]?.nota || ''
  };
  haptic(10);
  updateCartaUI();
}

// ── Actualizar UI del carrito (contadores + barra + drawer) ──────────────────
function updateCartaUI() {
  const n = Object.keys(carrito).length;
  const totalUds = Object.values(carrito).reduce((s, i) => s + i.qty, 0);
  const total = Object.values(carrito).reduce((s, i) => s + Number(i.art.precio) * i.qty, 0);

  $('res-uds').textContent = n ? `${totalUds} ud${totalUds > 1 ? 's' : ''} · ${n} línea${n > 1 ? 's' : ''}` : 'Sin artículos';
  $('res-total').textContent = fmtEu(total);
  $('btn-enviar').disabled = n === 0;
  $('btn-enviar').textContent = n ? `Enviar · ${fmtEu(total)}` : 'Enviar';
  $('cart-badge').textContent = totalUds;
  $('drawer-total').textContent = fmtEu(total);
  $('btn-enviar-drawer').disabled = n === 0;
  $('btn-vaciar-cart').hidden = n === 0;

  // Contadores en la carta
  Object.keys(cartaData).forEach(id => {
    const el = $('qty-' + id);
    if (!el) return;
    const q = Object.entries(carrito)
      .filter(([k]) => k === id || k.startsWith(id + '__'))
      .reduce((s, [, i]) => s + i.qty, 0);
    el.textContent = q;
    el.classList.toggle('has-qty', q > 0);
    const row = el.closest('.art-row');
    if (row) row.classList.toggle('in-cart', q > 0);
    const nb = row?.querySelector('.btn-nota');
    if (nb) {
      const tieneNota = Object.entries(carrito).some(([k, v]) => (k === id || k.startsWith(id + '__')) && v.nota);
      nb.classList.toggle('tiene-nota', tieneNota);
    }
  });

  // Contadores por categoría (cabeceras + chips)
  Object.entries(categoriasData).forEach(([catId]) => {
    const total = qtyEnCategoria(catId);
    const cc = $('catcount-' + catId);
    if (cc) {
      cc.textContent = total > 0 ? total : '';
      cc.classList.toggle('visible', total > 0);
    }
    const chip = document.querySelector(`.cat-chip[data-cat="${catId}"]`);
    if (chip) {
      let cnt = chip.querySelector('.cnt');
      if (total > 0) {
        if (!cnt) { cnt = document.createElement('span'); cnt.className = 'cnt'; chip.appendChild(cnt); }
        cnt.textContent = total;
      } else if (cnt) cnt.remove();
    }
  });
  // Chip "Todas"
  const chipTodas = document.querySelector('.cat-chip[data-cat=""]');
  if (chipTodas) {
    const totalUdsAll = Object.values(carrito).reduce((s, i) => s + i.qty, 0);
    let cnt = chipTodas.querySelector('.cnt');
    if (totalUdsAll > 0) {
      if (!cnt) { cnt = document.createElement('span'); cnt.className = 'cnt'; chipTodas.appendChild(cnt); }
      cnt.textContent = totalUdsAll;
    } else if (cnt) cnt.remove();
  }

  if ($('drawer').classList.contains('open')) renderDrawer();
}

// ── Modal de nota por artículo ───────────────────────────────────────────────
function abrirNotaModal(artId, nombreArt) {
  const carritoKey = Object.keys(carrito).find(k => k === artId || k.startsWith(artId + '__v') || k.startsWith(artId + '__combo__')) || artId;
  const qty = carrito[carritoKey]?.qty || 0;
  if (!qty) {
    showModal({ title: 'Cantidad requerida', body: 'Añade primero el artículo con + para poder ponerle una nota.', buttons: [{ label: 'Cerrar', style: 'primary' }] });
    return;
  }

  const mb = showModalHTML(`📝 ${nombreArt}`, `
    <input id="nota-input" type="text" placeholder="ej: poco hecho, sin cebolla…"
      value="${escapeHtml(carrito[carritoKey]?.nota || '')}"
      style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:11px;padding:11px 12px;font-size:14px;outline:none;color:var(--text)">
    <div class="ri-chips" style="margin-top:10px">
      ${notasParaArticulo(artId).map(n => `<button type="button" class="ri-chip" data-n="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}
    </div>`,
    [
      { label: 'Quitar nota', style: 'danger', action: () => { if (carrito[carritoKey]) carrito[carritoKey].nota = ''; updateCartaUI(); } },
      { label: 'Guardar', style: 'primary', action: () => { if (carrito[carritoKey]) carrito[carritoKey].nota = $('nota-input').value.trim(); updateCartaUI(); } }
    ]);

  const inp = $('nota-input');
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (carrito[carritoKey]) carrito[carritoKey].nota = inp.value.trim();
      updateCartaUI();
      closeModal();
    }
  });
  mb.querySelectorAll('[data-n]').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = chip.dataset.n;
      const cur = inp.value.trim();
      const partes = cur.split(',').map(p => p.trim().toLowerCase());
      inp.value = !cur ? val : (partes.includes(val.toLowerCase()) ? cur : cur + ', ' + val);
      inp.focus();
    });
  });
  setTimeout(() => inp.focus(), 100);
}

// ── Drawer (pedido actual) ───────────────────────────────────────────────────
function abrirDrawer() {
  renderDrawer();
  $('drawer').classList.add('open');
  $('drawer-overlay').classList.add('open');
}
function cerrarDrawerSilencioso() {
  $('drawer').classList.remove('open');
  $('drawer-overlay').classList.remove('open');
}

function renderDrawer() {
  $('drawer-title').textContent = mesaNombre ? `Mesa ${mesaNombre}` : 'Pedido';
  const body = $('drawer-body');
  const items = Object.entries(carrito);
  if (!items.length) {
    body.innerHTML = '<div class="drawer-empty">Sin artículos aún.<br>Añádelos desde la carta.</div>';
    return;
  }
  body.innerHTML = '';
  items.forEach(([key, item]) => {
    const { art, qty, nota, selections } = item;
    const notaAbierta = drawerNotasAbiertas.has(key);
    const wrap = document.createElement('div');
    wrap.className = 'ri-wrap';

    const selHTML = selections?.length
      ? `<span class="ri-sel">${selections.map(s => `• ${escapeHtml(s.nombre)}${s.variante ? ` (${escapeHtml(s.variante)})` : ''}${s.suplemento > 0 ? ` +${Number(s.suplemento).toFixed(2)}€` : ''}`).join('<br>')}</span>`
      : '';

    wrap.innerHTML = `
      <div class="ri-main">
        <span class="ri-nombre${nota || notaAbierta ? ' con-nota' : ''}" data-toggle>
          <span class="txt"><span>${escapeHtml(art.nombre)}</span><span class="arrow">${nota || notaAbierta ? '▾' : '▸'}</span></span>
          ${selHTML}
        </span>
        <div class="ri-qty">
          <button data-q="-1">−</button>
          <span>${qty}</span>
          <button data-q="1">+</button>
        </div>
        <span class="ri-precio">${fmtEu(Number(art.precio) * qty)}</span>
      </div>
      <div class="ri-nota-row${nota || notaAbierta ? '' : ' oculta'}">
        <input type="text" placeholder="Nota: poco hecho, sin cebolla…" value="${escapeHtml(nota || '')}">
        <div class="ri-chips">
          ${notasParaArticulo(key.split('__')[0]).map(n => `<button type="button" class="ri-chip" data-n="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}
        </div>
      </div>`;

    wrap.querySelector('[data-toggle]').addEventListener('click', () => {
      if (drawerNotasAbiertas.has(key)) drawerNotasAbiertas.delete(key);
      else drawerNotasAbiertas.add(key);
      renderDrawer();
    });
    wrap.querySelectorAll('[data-q]').forEach(b => {
      b.addEventListener('click', () => {
        const next = Math.max(0, carrito[key].qty + Number(b.dataset.q));
        if (next === 0) { delete carrito[key]; drawerNotasAbiertas.delete(key); }
        else carrito[key].qty = next;
        haptic(8);
        updateCartaUI();
      });
    });
    const inp = wrap.querySelector('input');
    inp.addEventListener('input', () => {
      if (carrito[key]) carrito[key].nota = inp.value.trim();
    });
    wrap.querySelectorAll('[data-n]').forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.dataset.n;
        const cur = (carrito[key]?.nota || '').trim();
        const partes = cur.split(',').map(p => p.trim().toLowerCase());
        if (carrito[key]) carrito[key].nota = !cur ? val : (partes.includes(val.toLowerCase()) ? cur : cur + ', ' + val);
        drawerNotasAbiertas.add(key);
        renderDrawer();
        updateCartaUI();
      });
    });
    body.appendChild(wrap);
  });
}

$('btn-abrir-drawer').addEventListener('click', abrirDrawer);
$('drawer-overlay').addEventListener('click', cerrarDrawerSilencioso);
$('drawer-close').addEventListener('click', cerrarDrawerSilencioso);
$('btn-vaciar-cart').addEventListener('click', () => {
  showModal({
    title: 'Vaciar pedido',
    body: 'Se quitarán todos los artículos del pedido actual.',
    buttons: [
      { label: 'Cancelar' },
      { label: 'Vaciar', style: 'danger', action: () => { carrito = {}; drawerNotasAbiertas.clear(); updateCartaUI(); cerrarDrawerSilencioso(); } }
    ]
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENVIAR PEDIDO (mismo payload que camarero.js → barra/cocina/PS compatibles)
// ═══════════════════════════════════════════════════════════════════════════
function sanitizeFirebaseKey(key) {
  if (!key) return '';
  const clean = String(key)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'N');
  return clean.replace(/[^a-zA-Z0-9_:\-\|]/g, '_');
}

function construirLineasEnvio() {
  const lineasObj = {};
  const lineasImprimir = [];
  const conteoDestinos = {};
  Object.entries(carrito).forEach(([carritoKey, item]) => {
    const { art, qty, nota, selections, basePrecio, _repArtId } = item;
    const artId = _repArtId || carritoKey.split('__')[0];
    const safeKey = sanitizeFirebaseKey(carritoKey);

    if (selections && selections.length) {
      // Cabecera del combo + sub-líneas (igual que camarero.js)
      lineasObj[safeKey] = {
        artId, nombre: art.nombre, precio: Number(basePrecio), qty,
        destino: 'none', estado: 'pendiente', nota: nota || '', camarero: camareroActual
      };
      lineasImprimir.push({ nombre: art.nombre, precio: Number(basePrecio), qty, nota: nota || '' });
      selections.forEach((s, sIdx) => {
        const subKey = `${carritoKey}__sub__${sIdx}`;
        lineasObj[sanitizeFirebaseKey(subKey)] = {
          artId: s.artId, nombre: `> ${s.nombre}${s.variante ? ` (${s.variante})` : ''}`,
          precio: Number(s.suplemento || 0), qty, destino: s.destino || 'barra',
          estado: 'pendiente', nota: '', camarero: camareroActual
        };
        const d = s.destino || 'barra';
        conteoDestinos[d] = (conteoDestinos[d] || 0) + qty;
      });
    } else {
      lineasObj[safeKey] = {
        artId, nombre: art.nombre, precio: Number(art.precio), qty,
        destino: art.destino || 'barra', estado: 'pendiente',
        nota: nota || '', camarero: camareroActual
      };
      lineasImprimir.push({ nombre: art.nombre, precio: Number(art.precio), qty, nota: nota || '' });
      const d = art.destino || 'barra';
      if (d !== 'none' && d !== 'descuento') conteoDestinos[d] = (conteoDestinos[d] || 0) + qty;
    }
  });
  return { lineasObj, lineasImprimir, conteoDestinos };
}

async function enviarPedido() {
  if (!mesaId || !Object.keys(carrito).length) return;

  const nLineas = Object.keys(carrito).length;

  // Cuota de líneas (plan)
  if (isFirebaseConnected && quotaActual !== null && quotaActual !== -1) {
    if (quotaActual <= 0) {
      showModal({ title: 'Límite de pedidos alcanzado', body: 'Se han agotado las líneas de pedido incluidas en el plan. Contacta con el administrador.', buttons: [{ label: 'Entendido', style: 'primary' }] });
      return;
    }
    if (quotaActual < nLineas) {
      showModal({ title: 'Líneas insuficientes', body: `Quedan ${quotaActual} líneas y el pedido tiene ${nLineas}. Reduce el pedido o contacta con el administrador.`, buttons: [{ label: 'Entendido', style: 'primary' }] });
      return;
    }
  }

  const btn1 = $('btn-enviar'), btn2 = $('btn-enviar-drawer');
  btn1.disabled = true; btn1.textContent = 'Enviando…';
  btn2.disabled = true;

  const envioTs = Date.now();
  const envioId = envioTs + '_' + mesaId;
  const { lineasObj, lineasImprimir, conteoDestinos } = construirLineasEnvio();
  const resumenDestinos = Object.entries(conteoDestinos)
    .map(([d, q]) => `${d === 'cocina' ? '🍳' : d === 'pizzas' ? '🍕' : '🍺'} ${q} ${d}`)
    .join(' · ');

  // ── OFFLINE ──
  if (!isFirebaseConnected) {
    let enviadoLocal = false;
    if (usarServidorLocal()) {
      try { enviadoLocal = await enviarComandaAServidorLocal(lineasObj); } catch (_) { }
    }
    if (idb) {
      const dbPayload = { mesaId, mesaNombre, envioId, envioTs, camarero: camareroActual, lineasObj };
      if (envioSinImprimir) dbPayload._printService = skipPrintPayload();
      await idbAgregar(dbPayload);
      queuedMesas.add(mesaId);
      localOcupada.add(mesaId);
      if (!queuedPedidosLocal[mesaId]) queuedPedidosLocal[mesaId] = {};
      queuedPedidosLocal[mesaId][envioId] = { ts: envioTs, camarero: camareroActual, envioId, lineas: lineasObj };
      if (!pedidosData[mesaId]) pedidosData[mesaId] = {};
      pedidosData[mesaId][envioId] = queuedPedidosLocal[mesaId][envioId];
    }
    if (!envioSinImprimir && autoTXT()) generarTXTComanda(mesaNombre, lineasImprimir);
    finalizarEnvio();
    toast(enviadoLocal ? '✓ Enviado al servidor local' : `📥 Guardado en cola · ${resumenDestinos}`, { duration: 3400 });
    actualizarBannerOffline();
    renderVistaMesas();
    envioSinImprimir = false;
    return;
  }

  // ── ONLINE ──
  try {
    // atendidaTs = envío: enviar una comanda también "atiende" la mesa
    await update(ref(db, 'mesas/' + mesaId), { estado: 'ocupada', atendidaTs: envioTs });
    const payload = { ts: envioTs, camarero: camareroActual, envioId, lineas: lineasObj };
    if (envioSinImprimir) payload._printService = skipPrintPayload();
    await set(ref(db, `pedidos/${mesaId}/${envioId}`), payload);

    if (!envioSinImprimir && String(configLocal?.localNetworkMode || 'disabled') === 'mirror') {
      try { await enviarComandaAServidorLocal(lineasObj); } catch (_) { }
    }

    logAccion(mesaId, envioId, 'enviado', `${nLineas} líneas`);
    const detalleArts = Object.values(lineasObj)
      .map(l => `${l.qty}× ${l.nombre}${Number(l.precio) ? ' (' + fmtEu(l.precio) + ')' : ''}`).join(', ');
    const totalAprox = Object.values(lineasObj).reduce((s, l) => s + Number(l.precio || 0) * Number(l.qty || 0), 0);
    logAuditoria('articulo_agregado', detalleArts, { envioId, lineas: nLineas, total: Math.round(totalAprox * 100) / 100 });

    if (quotaActual !== null && quotaActual !== -1) {
      await set(ref(db, 'config/quota/lineas'), quotaActual - nLineas);
    }
    const ahora = new Date();
    const mesKey = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const statsRef = ref(db, 'config/stats/' + mesKey + '/lineas');
    const statsSnap = await get(statsRef);
    await set(statsRef, (statsSnap.val() || 0) + nLineas);

    if (!envioSinImprimir && autoTXT()) generarTXTComanda(mesaNombre, lineasImprimir);

    finalizarEnvio();
    haptic([20, 40, 20]);
    toast(`✓ Enviado · ${resumenDestinos || mesaNombre}`, { duration: 3200 });
  } catch (e) {
    console.error(e);
    toast('Error al enviar. Reintenta.');
    btn1.disabled = false; btn2.disabled = false;
    updateCartaUI();
  }
  envioSinImprimir = false;
}

function finalizarEnvio() {
  // Registrar frecuentes ANTES de vaciar el carrito
  Object.entries(carrito).forEach(([key, item]) => {
    const baseId = item._repArtId || key.split('__')[0];
    if (cartaData[baseId]) guardarFrecuente(baseId, item.qty);
  });
  carrito = {};
  drawerNotasAbiertas.clear();
  cerrarDrawerSilencioso();
  updateCartaUI();
  actualizarFabCuenta();
}

function skipPrintPayload() {
  const serviceId = (configLocal?.ticketPrintServiceId || 'local-print-service-1').trim() || 'local-print-service-1';
  const serviceKey = serviceId.replace(/[.#$/\[\]]+/g, '_');
  const skipMark = { printedAt: Date.now(), serviceId, manualSkip: true };
  return {
    barra: { [serviceKey]: skipMark },
    cocina: { [serviceKey]: skipMark },
    pizzas: { [serviceKey]: skipMark }
  };
}

let longPressEnvio = false;
$('btn-enviar').addEventListener('click', () => {
  if (longPressEnvio) { longPressEnvio = false; return; }
  if (!envioSinImprimir) enviarPedido();
});
$('btn-enviar-drawer').addEventListener('click', () => {
  if (longPressEnvio) { longPressEnvio = false; return; }
  if (!envioSinImprimir) enviarPedido();
});

// Pulsación larga en Enviar = enviar sin imprimir (misma convención que camarero.js)
(function initEnviarLongPress() {
  let timer = null;
  const start = e => {
    if (e.type === 'mousedown' && e.button !== 0) return;
    timer = setTimeout(() => {
      timer = null;
      longPressEnvio = true;
      envioSinImprimir = true;
      haptic(30);
      enviarPedido();
      setTimeout(() => { longPressEnvio = false; }, 800);
    }, 700);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  [$('btn-enviar'), $('btn-enviar-drawer')].forEach(b => {
    if (!b) return;
    b.addEventListener('mousedown', start);
    b.addEventListener('touchstart', start, { passive: true });
    b.addEventListener('mouseup', cancel);
    b.addEventListener('touchend', cancel);
    b.addEventListener('touchmove', cancel);
    b.addEventListener('mouseleave', cancel);
  });
})();

// ── TXT de comanda (autoimpresión) ───────────────────────────────────────────
const autoTXT = () => localStorage.getItem('cam2_txt') === '1';
function generarTXTComanda(nombreMesa, lineas) {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('es-ES');
  const hora = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}:${String(ahora.getSeconds()).padStart(2, '0')}`;
  const ts = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(ahora.getDate()).padStart(2, '0')}-${String(ahora.getHours()).padStart(2, '0')}${String(ahora.getMinutes()).padStart(2, '0')}${String(ahora.getSeconds()).padStart(2, '0')}`;
  const sep = '--------------------------------';
  let txt = '';
  if (configLocal?.nombre) txt += configLocal.nombre + '\n';
  if (configLocal?.direccion) txt += configLocal.direccion + '\n';
  txt += sep + '\n';
  txt += `Mesa ${nombreMesa}\n${fecha}  ${hora}\n${sep}\n`;
  lineas.forEach(l => {
    txt += `${l.qty}x ${l.nombre}\n`;
    if (l.nota) txt += `   -> ${l.nota}\n`;
  });
  txt += sep + '\n';
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `comanda-mesa${nombreMesa}-${ts}.txt`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Servidor local de red (fallback/mirror) ──────────────────────────────────
function usarServidorLocal() {
  const mode = String(configLocal?.localNetworkMode || 'disabled');
  return mode === 'fallback' || mode === 'mirror';
}
function urlServidorLocal() {
  return String(configLocal?.localNetworkUrl || '').trim().replace(/\/+$/, '');
}
async function postServidorLocal(path, payload) {
  const base = urlServidorLocal();
  if (!base) throw new Error('No hay servidor local configurado');
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function enviarComandaAServidorLocal(lineasObj) {
  if (!usarServidorLocal()) return false;
  const lineas = Object.values(lineasObj || {}).map(linea => ({
    nombre: linea.nombre, qty: Number(linea.qty || 0),
    precio: Number(linea.precio || 0), nota: linea.nota || '',
    destino: linea.destino || 'barra'
  }));
  if (!lineas.length) return false;
  await postServidorLocal('/api/orders/command', {
    mesaId, mesaNombre, camarero: camareroActual || '', lineas
  });
  return true;
}
async function enviarTicketAServidorLocal(lineasTicket, total, cobro = null) {
  await postServidorLocal('/api/orders/ticket', {
    mesaId, mesaNombre, camarero: camareroActual || '', total, cobro, lineas: lineasTicket
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPRESIÓN DE TICKETS
// ═══════════════════════════════════════════════════════════════════════════
const iframeComanda = document.createElement('iframe');
iframeComanda.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none';
document.body.appendChild(iframeComanda);

function getTicketPaperConfig() {
  const paper = String(configLocal?.ticketPaper || configLocal?.papelTicket || '58mm').toLowerCase();
  const fontSize = Number(configLocal?.ticketFontSize || (paper.includes('80') ? 10 : 9));
  const uppercase = configLocal?.ticketUppercase === true;
  const marginX = Number(configLocal?.ticketMarginX ?? 3);
  const marginY = Number(configLocal?.ticketMarginY ?? 3);
  if (paper.includes('80')) {
    return { paper: '80mm', width: '80mm', chars: 48, fontSize, uppercase, marginX, marginY };
  }
  return { paper: '58mm', width: '58mm', chars: 32, fontSize, uppercase, marginX, marginY };
}

function wrapTicketLine(text, maxChars) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  const out = [];
  let rest = clean;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut < 1) cut = maxChars;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function renderTicketRowsHTML(lineas, maxChars, conPrecio, showNotes = true) {
  const nameChars = conPrecio ? Math.max(10, maxChars - 14) : Math.max(20, maxChars - 4);
  const headerHtml = conPrecio
    ? `<div class="print-line-top print-header">
        <span class="print-qty">Ud.</span>
        <span class="print-name">Artículo</span>
        <div class="print-prices-group"><span class="print-unit-price">Precio</span><span class="print-price">Importe</span></div>
      </div>`
    : '';
  const rowsHtml = lineas.map(l => {
    const nombreLineas = wrapTicketLine(l.nombre, nameChars);
    const primera = nombreLineas.shift() || '';
    const qty = Number(l.qty);
    const precioUd = Number(l.precio);
    const extras = [];
    nombreLineas.forEach(n => extras.push(`<div class="ticket-subline">${n}</div>`));
    if (showNotes && l.nota) extras.push(`<div class="ticket-note">-> ${l.nota}</div>`);
    return `
      <div class="print-line">
        <div class="print-line-top">
          <span class="print-qty">${qty}</span>
          <span class="print-name">${primera}</span>
          ${conPrecio ? `<div class="print-prices-group"><span class="print-unit-price">${precioUd.toFixed(2)}€</span><span class="print-price">${(precioUd * qty).toFixed(2)}€</span></div>` : ''}
        </div>
        ${extras.join('')}
      </div>`;
  }).join('');
  return headerHtml + rowsHtml;
}

function limpiarNotaTicket(nota) {
  return (nota || '')
    .replace(/Comprobar/g, '').replace(/Verificado/g, '')
    .replace(/⚠️/g, '').replace(/✅/g, '')
    .replace(/Â·/g, '').replace(/\s+/g, ' ').trim();
}

function construirHTMLTicket({ titulo, subtitulo, lineas, mostrarPrecio = false, mostrarTotal = false, total = 0, pie = '', mostrarLogo = false, cobro = null, autoPrint = false, modoCopia = false }) {
  const paperCfg = getTicketPaperConfig();
  const logoHtml = mostrarLogo && configLocal?.ticketLogoUrl
    ? `<div class="ticket-logo-wrap"><img class="ticket-logo" src="${escapeHtml(configLocal.ticketLogoUrl)}" alt="Logo" /></div>`
    : '';
  const cabecera = (configLocal?.nombre || configLocal?.direccion || configLocal?.telefono || configLocal?.cif)
    ? `<div class="local">${logoHtml}${configLocal?.nombre ? `<div class="local-name">${configLocal.nombre}</div>` : ''}${configLocal?.direccion ? `<div class="local-line">${configLocal.direccion}</div>` : ''}${configLocal?.telefono ? `<div class="local-line">${configLocal.telefono}</div>` : ''}${configLocal?.cif ? `<div class="local-line">${configLocal.cif}</div>` : ''}</div>`
    : logoHtml;
  const rows = renderTicketRowsHTML(lineas, paperCfg.chars, mostrarPrecio, configLocal?.ticketShowNotes !== false);
  const totalHtml = mostrarTotal
    ? `<div class="print-total"><span>Total</span><span>${fmtEu(total)}</span></div>`
    : '';
  const cobradoHtml = cobro
    ? `<div class="print-total" style="font-weight:normal;border-top:none;margin-top:4px;padding-top:4px"><span>Recibido</span><span>${fmtEu(cobro.recibido)}</span></div>` +
      `<div class="print-total" style="border-top:1px dashed #666;margin-top:4px;padding-top:4px"><span>Cambio</span><span>${fmtEu(cobro.cambio)}</span></div>`
    : '';
  const footerHtml = pie ? `<div class="print-footer">${pie}</div>` : '';
  const accionesHtml = modoCopia
    ? `<div class="share-toolbar">
         <button onclick="window.print()">Imprimir / Guardar PDF</button>
         <button onclick="window.close()">Cerrar</button>
       </div>
       <div class="share-hint">Copia visual del ticket final para guardar o compartir.</div>`
    : '';
  const autoPrintScript = autoPrint
    ? `<script>window.onload=()=>setTimeout(()=>window.print(),60)<\/script>`
    : '';
  const css = ticketCSS(paperCfg);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${css}</style></head><body>
  ${accionesHtml}
  <div class="ticket-wrap">
    ${cabecera}
    <h2>${titulo}</h2>
    <div class="sub">${subtitulo}</div>
    ${rows}
    ${totalHtml}
    ${cobradoHtml}
    ${footerHtml}
  </div>
  ${autoPrintScript}
  <script>if(${modoCopia ? 'true' : 'false'})document.body.classList.add('copia')<\/script>
  </body></html>`;
}

function ticketCSS(paperCfg) {
  return `
    *{box-sizing:border-box;margin:0;padding:0}
    @page{size:${paperCfg.width} auto;margin:0}
    body{font-family:monospace;font-size:${paperCfg.fontSize}px;width:${paperCfg.width};padding:${paperCfg.marginY}mm ${paperCfg.marginX}mm;color:#111;${paperCfg.uppercase ? 'text-transform:uppercase;' : ''}}
    .local{text-align:center;color:#111;border-bottom:1px dashed #999;padding-bottom:6px;margin-bottom:8px}
    .local-name{font-size:${configLocal?.ticketHeaderNameFontSize || paperCfg.fontSize + 3}px;font-weight:bold;letter-spacing:.02em;color:#000}
    .local-line{font-size:${configLocal?.ticketHeaderSubFontSize || Math.max(9, paperCfg.fontSize - 1)}px;line-height:1.35;color:#111}
    .ticket-logo-wrap{text-align:center;margin-bottom:6px}
    .ticket-logo{max-width:100%;max-height:${paperCfg.paper === '80mm' ? '70px' : '52px'};object-fit:contain}
    h2{font-size:${paperCfg.fontSize + 4}px;font-weight:bold;margin-bottom:2px;text-align:center;color:#000}
    .sub{font-size:${Math.max(9, paperCfg.fontSize - 1)}px;color:#333;margin-bottom:10px;text-align:center}
    .print-line{padding:4px 0;border-bottom:1px solid #ccc}
    .print-line:last-of-type{border-bottom:none}
    .print-line-top{display:flex;gap:6px;align-items:flex-start}
    .print-qty{font-weight:bold;white-space:nowrap;min-width:1.2em}
    .print-name{flex:1;min-width:0}
    .print-prices-group{display:flex;gap:2px;white-space:nowrap}
    .print-unit-price{text-align:right;white-space:nowrap;color:#555;min-width:4.5em}
    .print-price{text-align:right;white-space:nowrap;font-weight:bold;min-width:4.5em}
    .print-header{font-size:${Math.max(8, paperCfg.fontSize - 1)}px;color:#666;border-bottom:1px solid #999;padding-bottom:3px;margin-bottom:2px}
    .ticket-subline{padding-left:24px}
    .ticket-note{padding-left:24px;font-size:10px;color:#333;font-style:italic}
    .print-total{display:flex;justify-content:space-between;border-top:1px dashed #666;margin-top:8px;padding-top:8px;font-weight:bold;color:#000}
    .print-footer{text-align:center;font-size:11px;color:#333;margin-top:10px;padding-top:8px;border-top:1px dashed #999}
    .share-toolbar{display:flex;gap:8px;justify-content:center;margin:0 auto 12px;width:min(100%, 420px)}
    .share-toolbar button{border:1px solid #999;background:#fff;color:#111;border-radius:999px;padding:8px 14px;font:inherit;cursor:pointer}
    .share-hint{margin:0 auto 12px;width:min(100%, 420px);text-align:center;font-size:${Math.max(10, paperCfg.fontSize - 1)}px;color:#555}
    body.copia{background:#f4f4f4;padding-top:14px;padding-bottom:20px}
    body.copia .ticket-wrap{background:#fff;padding:${paperCfg.marginY}mm ${paperCfg.marginX}mm;border:1px solid #ddd;box-shadow:0 8px 28px rgba(0,0,0,.08);margin:0 auto}
    @media print{body{width:${paperCfg.width};padding:${paperCfg.marginY}mm ${paperCfg.marginX}mm}*{color:#000!important;border-color:#000!important}}
    @media print{
      .share-toolbar,.share-hint{display:none!important}
      body.copia{background:#fff;padding:0}
      body.copia .ticket-wrap{border:none;box-shadow:none;margin:0;padding:${paperCfg.marginY}mm ${paperCfg.marginX}mm}
    }`;
}

function abrirImpresionTicket(opts) {
  iframeComanda.srcdoc = construirHTMLTicket({ ...opts, autoPrint: true });
}

function abrirCopiaTicketFinal(opts) {
  const win = window.open('', '_blank');
  if (!win) {
    showModal({ title: 'No se pudo abrir la copia', body: 'Tu navegador ha bloqueado la ventana emergente. Permítela si quieres guardar o compartir la copia del ticket.', buttons: [{ label: 'Cerrar', style: 'primary' }] });
    return;
  }
  const html = construirHTMLTicket({ ...opts, mostrarPrecio: true, mostrarTotal: true, modoCopia: true });
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ── Servicio de impresión (printer_service.py → print_jobs) ─────────────────
async function enviarTicketFinalAServicio(lineasServidas, total, cobro = null) {
  const paperCfg = getTicketPaperConfig();
  const serviceId = String(configLocal?.ticketPrintServiceId || 'local-print-service-1').trim() || 'local-print-service-1';
  const payload = {
    kind: 'ticket_final',
    status: 'pending',
    createdAt: Date.now(),
    serviceId,
    requestedBy: camareroActual || '',
    mesaId: mesaId || '',
    mesaNombre: mesaNombre || '',
    local: {
      nombre: configLocal?.nombre || '',
      direccion: configLocal?.direccion || '',
      telefono: configLocal?.telefono || '',
      cif: configLocal?.cif || '',
      footer: configLocal?.footer || '',
      logoUrl: configLocal?.ticketLogoUrl || '',
      ticketShowNotes: configLocal?.ticketShowNotes !== false,
      headerNameFontSize: Number(configLocal?.ticketHeaderNameFontSize || 12),
      headerSubFontSize: Number(configLocal?.ticketHeaderSubFontSize || 8)
    },
    format: {
      paper: paperCfg.paper,
      fontSize: paperCfg.fontSize,
      uppercase: paperCfg.uppercase === true,
      headerOffset: Number(configLocal?.ticketHeaderOffset ?? 0)
    },
    total: Math.round(Number(total || 0) * 100) / 100,
    lines: lineasServidas.map(l => ({
      nombre: l.nombre,
      qty: Number(l.qtyCuenta || 0),
      precio: Math.round(Number(l.precio || 0) * 100) / 100,
      nota: configLocal?.ticketShowNotes === false ? '' : limpiarNotaTicket(l.nota)
    })),
    cobro: cobro ? {
      metodo: cobro.metodo || 'Efectivo',
      recibido: Math.round(Number(cobro.recibido || 0) * 100) / 100,
      cambio: Math.round(Number(cobro.cambio || 0) * 100) / 100
    } : null
  };

  // Guardar en historial ANTES de enviar al servicio (por si el servicio falla)
  if (mesaId) {
    const lineasHist = payload.lines.filter(l => l.qty > 0);
    if (lineasHist.length > 0) {
      const ahora = new Date();
      await upsertHistorial({
        mesa: mesaNombre, camarero: camareroActual || '',
        ts: ahora.getTime(), fecha: ahora.toLocaleDateString('es-ES'),
        hora: ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        total: payload.total, lineas: lineasHist,
        pagoMetodo: cobro?.metodo
      });
    }
  }

  await push(ref(db, 'print_jobs'), payload);
}

// Guarda/sobreescribe la venta de la sesión activa en historial
async function upsertHistorial(datos) {
  if (!mesaId) return;
  try {
    if (!datos.pagoMetodo) {
      const pmSnap = await get(ref(db, `pedidos/${mesaId}/_meta/pagoMetodo`));
      datos.pagoMetodo = pmSnap.exists() ? pmSnap.val() : 'Efectivo';
    }
    const ventaKeySnap = await get(ref(db, `pedidos/${mesaId}/_meta/ventaKey`));
    const ventaKey = ventaKeySnap.val();
    if (ventaKey) {
      await set(ref(db, 'historial/' + ventaKey), datos);
    } else {
      const newRef = await push(ref(db, 'historial'), datos);
      await set(ref(db, `pedidos/${mesaId}/_meta/ventaKey`), newRef.key);
    }
  } catch (_) { }
}

async function limpiarPrintJobsCerradosDeMesa(mesaIdObjetivo) {
  if (!mesaIdObjetivo) return 0;
  const snap = await get(ref(db, 'print_jobs'));
  const printJobs = snap.val() || {};
  const updates = {};
  let borrados = 0;
  Object.entries(printJobs).forEach(([jobId, job]) => {
    if (!job || typeof job !== 'object') return;
    if (String(job.mesaId || '') !== String(mesaIdObjetivo)) return;
    const status = String(job.status || '').toLowerCase();
    if (!['printed', 'error', 'skipped'].includes(status)) return;
    updates[`print_jobs/${jobId}`] = null;
    borrados++;
  });
  if (!borrados) return 0;
  await update(ref(db), updates);
  return borrados;
}

// Toggle de copia visual del ticket
const autoCopia = () => localStorage.getItem('cam2_copia') === '1';

// Dispatcher de impresión según configLocal.ticketPrintMode
async function imprimirTicketFinal(lineasServidas, total, cobro = null) {
  const mode = String(configLocal?.ticketPrintMode || 'browser');
  const fecha = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  const base = {
    titulo: `Mesa ${mesaNombre}`,
    subtitulo: fecha,
    lineas: lineasServidas.map(l => ({
      nombre: l.nombre, qty: l.qtyCuenta, precio: Number(l.precio),
      nota: configLocal?.ticketShowNotes === false ? '' : limpiarNotaTicket(l.nota)
    })),
    total, pie: configLocal?.footer || '', mostrarLogo: true, cobro
  };

  try {
    const extras = { total: Math.round(Number(total || 0) * 100) / 100 };
    if (cobro) { extras.recibido = Number(cobro.recibido || 0); extras.cambio = Number(cobro.cambio || 0); }
    logAuditoria(cobro ? 'ticket_cobrado' : 'ticket_impreso',
      lineasServidas.slice(0, 12).map(l => `${l.qtyCuenta}× ${l.nombre}`).join(', '), extras);
  } catch (_) { }

  if (mode === 'service' || mode === 'both') {
    try {
      await enviarTicketFinalAServicio(lineasServidas, total, cobro);
      toast('🖨 Enviado a la impresora de tickets');
    } catch (e) {
      console.error('Error servicio impresión:', e);
      showModal({ title: 'Error de impresión remota', body: 'No se pudo enviar el ticket al servicio de impresión.', buttons: [{ label: 'Cerrar', style: 'primary' }] });
      if (mode === 'service') return;
    }
  }

  if (mode === 'local_server' || mode === 'local_server+browser') {
    try {
      await enviarTicketAServidorLocal(base.lineas, total, cobro);
      toast('🖨 Enviado al servidor local');
    } catch (e) {
      console.error(e);
      showModal({ title: 'Error de impresión local', body: 'No se pudo enviar el ticket al servidor local de la red.', buttons: [{ label: 'Cerrar', style: 'primary' }] });
      if (mode === 'local_server') return;
    }
  }

  // Impresión vía navegador (por defecto y modos combinados)
  if (mode === 'browser' || mode === 'both' || mode === 'local_server+browser') {
    abrirImpresionTicket({ ...base, mostrarPrecio: true, mostrarTotal: true });
  }

  if (autoCopia()) abrirCopiaTicketFinal(base);
}

// ═══════════════════════════════════════════════════════════════════════════
// CUENTA / TICKET
// ═══════════════════════════════════════════════════════════════════════════
let tLineas = [];

async function cargarTicketActual() {
  if (!mesaId) return;
  const snap = await get(ref(db, 'pedidos/' + mesaId));
  renderTicket(snap.val() || {});
}

async function verCuenta() {
  if (!mesaId) return;
  ticketEditMode = false;
  await cargarTicketActual();
  show('ticket');
}

function calcTotalTicket() {
  return tLineas.reduce((s, l) => s + Number(l.precio) * l.qtyCuenta, 0);
}

function renderTicket(pedidos) {
  const card = $('ticket-card');
  const todasLineas = aplanarPedidos(pedidos);

  tLineas = todasLineas
    .map(l => ({ ...l, qtyCuenta: qtyEnCuenta(l) }))
    .filter(l => l.qtyCuenta > 0)
    .sort((a, b) => (a.envioId || '').localeCompare(b.envioId || '') || (a.nombre || '').localeCompare(b.nombre || '', 'es'));

  if (!tLineas.length) {
    card.innerHTML = `
      <div class="tk-mesa">Mesa ${escapeHtml(mesaNombre || '')}</div>
      <div class="tk-hint">No hay artículos consumidos aún</div>
      <div class="tk-total"><span>Total</span><span>${fmtEu(0)}</span></div>
      <div class="tk-actions">
        <button class="tk-btn danger" data-act="cerrar">Cerrar mesa y limpiar</button>
      </div>`;
    wireTicketActions();
    return;
  }

  const total = calcTotalTicket();
  const fecha = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  const loc = configLocal;

  const cab =
    (loc.nombre || loc.direccion || loc.telefono)
      ? `<div class="tk-local">
          ${loc.nombre ? `<div class="n">${escapeHtml(loc.nombre)}</div>` : ''}
          ${loc.direccion ? `<div class="d">${escapeHtml(loc.direccion)}</div>` : ''}
          ${loc.telefono ? `<div class="d">${escapeHtml(loc.telefono)}</div>` : ''}
         </div>`
      : '';

  const filas = tLineas.map((l, i) => {
    const importe = Number(l.precio) * l.qtyCuenta;
    const edit = ticketEditMode
      ? `<div class="tk-qty-edit">
           <button class="tk-qty-btn" data-act="dec" data-i="${i}" ${l.qtyCuenta <= 1 ? 'disabled' : ''}>−</button>
           <span class="tk-qty-num">${l.qtyCuenta}</span>
           <button class="tk-qty-btn" data-act="inc" data-i="${i}" ${l.qtyCuenta >= Number(l.qty || l.qtyCuenta) ? 'disabled' : ''}>+</button>
         </div>
         <button class="tk-del" data-act="del" data-i="${i}" title="Quitar">✕</button>`
      : `<span class="tk-qty-num" style="min-width:auto">${l.qtyCuenta}×</span>`;
    const nota = l.nota ? limpiarNotaTicket(l.nota) : '';
    return `
      <div class="tk-linea">
        <div class="tk-l-main">
          <div class="tk-l-nombre">${escapeHtml(l.nombre)}</div>
          <div class="tk-l-meta">${fmtEu(l.precio)} / ud${nota ? ' · ' + escapeHtml(nota) : ''}</div>
        </div>
        ${edit}
        <span class="tk-l-precio">${fmtEu(importe)}</span>
      </div>`;
  }).join('');

  card.innerHTML = `
    ${cab}
    <div class="tk-mesa">Mesa ${escapeHtml(mesaNombre || '')}</div>
    <div class="tk-fecha">${fecha}</div>
    ${ticketEditMode ? '<div class="tk-hint">Modo edición: ajusta cantidades o quita líneas</div>' : ''}
    ${filas}
    <div class="tk-total"><span>Total</span><span>${fmtEu(total)}</span></div>
    <div class="tk-actions">
      <div class="tk-row2">
        <button class="tk-btn ${ticketEditMode ? 'warn' : ''}" data-act="editar">${ticketEditMode ? '✓ Listo' : '✏️ Editar'}</button>
        <button class="tk-btn" data-act="descuento">− Descuento</button>
      </div>
      <button class="tk-btn primary" data-act="imprimir">🖨 Imprimir ticket</button>
      <button class="tk-btn success" data-act="cobrar">💶 Cobrar · ${fmtEu(total)}</button>
      <button class="tk-btn danger" data-act="cerrar">Cerrar mesa</button>
    </div>`;
  wireTicketActions();
}

function wireTicketActions() {
  const card = $('ticket-card');
  card.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      const i = Number(btn.dataset.i);
      if (act === 'inc') await editarCantidadTicket(i, +1);
      else if (act === 'dec') await editarCantidadTicket(i, -1);
      else if (act === 'del') await quitarDelTicket(i);
      else if (act === 'editar') { ticketEditMode = !ticketEditMode; await cargarTicketActual(); }
      else if (act === 'descuento') abrirDescuentoModal(calcTotalTicket());
      else if (act === 'imprimir') await imprimirTicketFinal(tLineas, calcTotalTicket());
      else if (act === 'cobrar') showCobrarModal(calcTotalTicket(), tLineas);
      else if (act === 'cerrar') cerrarMesaEspecifica(mesaId, mesaNombre);
    });
  });
}

async function editarCantidadTicket(i, delta) {
  const l = tLineas[i];
  if (!l) return;
  const nuevaQty = Math.max(1, l.qtyCuenta + delta);
  const maxQty = l.estado === 'cancelado' ? 0 : Number(l.qty || l.qtyCuenta);
  const keyToUse = l.dbKey || l.artId;
  const path = `pedidos/${mesaId}/${l.envioId}/lineas/${keyToUse}/qtyTicket`;
  if (nuevaQty >= maxQty) await set(ref(db, path), null);
  else await set(ref(db, path), nuevaQty);
  logAccion(mesaId, l.envioId, 'cantidad_editada', `${keyToUse}: ${l.qtyCuenta}→${nuevaQty}`);
  logAuditoria('cantidad_editada', `${l.nombre || keyToUse}: ${l.qtyCuenta} → ${nuevaQty}`,
    { envioId: l.envioId, artId: keyToUse, qtyAntes: l.qtyCuenta, qtyDespues: nuevaQty, precio: Number(l.precio || 0) });
  await cargarTicketActual();
}

async function quitarDelTicket(i) {
  const l = tLineas[i];
  if (!l) return;
  const keyToUse = l.dbKey || l.artId;
  const notaBase = (l.nota || '')
    .replace(/\s*·?\s*⚠️\s*Comprobar/g, '').replace(/\s*·?\s*✅\s*Verificado/g, '').trim();
  const updates = {
    verificado: false,
    qtyServida: null,
    qtyTicket: 0,
    nota: (notaBase ? notaBase + ' · ' : '') + '⚠️ Comprobar'
  };
  if (l.estado === 'servido') updates.estado = 'pendiente';
  await update(ref(db, `pedidos/${mesaId}/${l.envioId}/lineas/${keyToUse}`), updates);
  logAccion(mesaId, l.envioId, 'item_quitado', keyToUse);
  logAuditoria('articulo_eliminado',
    `${l.nombre || keyToUse} (${l.qtyCuenta}× a ${fmtEu(l.precio || 0)})`,
    { envioId: l.envioId, artId: keyToUse, qty: l.qtyCuenta, precio: Number(l.precio || 0) });
  await cargarTicketActual();
}

// ── Descuento (importe fijo o porcentaje) ────────────────────────────────────
function abrirDescuentoModal(totalActual = 0) {
  const mb = showModalHTML('− Añadir descuento', `
    <div style="display:flex;flex-direction:column;gap:10px">
      <select id="desc-tipo" style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:14px;outline:none;color:var(--text)">
        <option value="importe">Descuento por importe fijo</option>
        <option value="porcentaje">Descuento por porcentaje</option>
      </select>
      <input type="text" id="desc-nombre" placeholder="Descripción opcional"
        style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:14px;outline:none;color:var(--text)">
      <input type="number" id="desc-valor" placeholder="Importe a descontar €" min="0.01" step="0.01"
        style="width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:14px;outline:none;color:var(--text)">
      <div id="desc-ayuda" style="font-size:12px;color:var(--muted)">Total actual: ${fmtEu(totalActual)}.</div>
    </div>`,
    [
      { label: 'Cancelar' },
      {
        label: 'Aplicar', style: 'primary', action: async () => {
          const tipo = $('desc-tipo')?.value || 'importe';
          const nombreInput = ($('desc-nombre')?.value || '').trim();
          const valor = parseFloat($('desc-valor')?.value);
          if (isNaN(valor) || valor <= 0) return;
          let importe = valor, nombre = nombreInput;
          if (tipo === 'porcentaje') {
            if (valor > 100) return;
            importe = Math.round(totalActual * valor) / 100;
            if (!(importe > 0)) return;
            if (!nombre) nombre = `Descuento ${valor.toFixed(valor % 1 === 0 ? 0 : 2).replace('.', ',')}%`;
          } else if (!nombre) nombre = 'Descuento';
          const ts = Date.now();
          const envioId = 'desc_' + ts;
          await set(ref(db, `pedidos/${mesaId}/${envioId}`), {
            ts, camarero: camareroActual, envioId,
            lineas: {
              desc_line: {
                artId: 'descuento', nombre, precio: -importe,
                qty: 1, destino: 'descuento', estado: 'servido',
                nota: '', camarero: camareroActual
              }
            }
          });
          logAuditoria('descuento_aplicado',
            `${nombre}: -${fmtEu(importe)} (${tipo === 'porcentaje' ? valor + '%' : 'importe fijo'})`,
            { envioId, importe: -Math.round(importe * 100) / 100, tipo, valor, totalAntes: Math.round(totalActual * 100) / 100 });
          await cargarTicketActual();
        }
      }
    ]);
  const sync = () => {
    const tipo = $('desc-tipo')?.value || 'importe';
    const valor = parseFloat($('desc-valor')?.value);
    const ayuda = $('desc-ayuda');
    if (!ayuda) return;
    if (tipo === 'porcentaje') {
      const est = !isNaN(valor) && valor > 0 ? Math.round(totalActual * valor) / 100 : 0;
      ayuda.textContent = `Total actual: ${fmtEu(totalActual)}. Descuento estimado: ${est > 0 ? fmtEu(est) : '—'}.`;
    } else {
      ayuda.textContent = `Total actual: ${fmtEu(totalActual)}. Se descontará el importe indicado.`;
    }
  };
  mb.querySelector('#desc-tipo').addEventListener('change', sync);
  mb.querySelector('#desc-valor').addEventListener('input', sync);
}

// ── Cobrar (efectivo/tarjeta) ────────────────────────────────────────────────
function showCobrarModal(total, lineasImprimir) {
  let metodo = 'Efectivo';

  const mb = showModalHTML(`Cobrar mesa ${mesaNombre || ''}`, `
    <div style="display:flex;flex-direction:column;gap:12px;font-family:var(--mono)">
      <div style="font-size:15px">Total a cobrar: <strong>${fmtEu(total)}</strong></div>
      <div>
        <label style="display:block;margin-bottom:6px;color:var(--muted);font-size:12px">Método de pago</label>
        <div style="display:flex;gap:8px">
          <button id="btn-metodo-efectivo" type="button" class="modal-btn primary" style="flex:1;padding:12px">💵 Efectivo</button>
          <button id="btn-metodo-tarjeta" type="button" class="modal-btn" style="flex:1;padding:12px">💳 Tarjeta</button>
        </div>
      </div>
      <div id="cobrar-recibido-wrap">
        <label style="display:block;margin-bottom:6px;color:var(--muted);font-size:12px">Cantidad recibida (€)</label>
        <input id="cobrar-input" type="number" min="0" step="0.01" inputmode="decimal"
          style="width:100%;padding:11px;border:1px solid var(--border);border-radius:10px;font-size:17px;font-family:var(--mono);background:var(--surface-2);color:var(--text);outline:none"
          placeholder="0,00">
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap" id="cobrar-quick"></div>
      </div>
      <div id="cobrar-cambio" style="font-size:14px;color:var(--ok);display:none"></div>
      <div id="cobrar-error" style="color:var(--danger);font-size:12px;display:none">La cantidad recibida debe ser mayor o igual al total.</div>
    </div>`,
    [
      { label: 'Cancelar' },
      { label: 'Imprimir y cobrar', style: 'primary', id: 'btn-cobrar-ok' }
    ]);

  const btnEf = mb.querySelector('#btn-metodo-efectivo');
  const btnTj = mb.querySelector('#btn-metodo-tarjeta');
  const inp = mb.querySelector('#cobrar-input');
  const cambioEl = mb.querySelector('#cobrar-cambio');
  const errEl = mb.querySelector('#cobrar-error');
  const quick = mb.querySelector('#cobrar-quick');

  // Botones de importe rápido (redondeo hacia arriba)
  const sugerencias = [...new Set([
    Math.ceil(total), Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 20) * 20
  ])].filter(v => v >= total).sort((a, b) => a - b).slice(0, 4);
  sugerencias.forEach(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'modal-btn';
    b.style.cssText = 'padding:8px 12px;font-size:12px';
    b.textContent = v + ' €';
    b.onclick = () => { inp.value = v; syncCambio(); };
    quick.appendChild(b);
  });

  function syncCambio() {
    const recibido = parseFloat((inp.value || '').replace(',', '.'));
    if (!isNaN(recibido) && recibido >= total - 0.001) {
      const cambio = Math.round((recibido - total) * 100) / 100;
      cambioEl.textContent = `Cambio: ${fmtEu(cambio)}`;
      cambioEl.style.display = 'block';
      errEl.style.display = 'none';
    } else {
      cambioEl.style.display = 'none';
    }
  }
  inp.addEventListener('input', syncCambio);

  function pintarMetodo() {
    btnEf.className = 'modal-btn' + (metodo === 'Efectivo' ? ' primary' : '');
    btnTj.className = 'modal-btn' + (metodo === 'Tarjeta' ? ' primary' : '');
    btnEf.style.cssText = 'flex:1;padding:12px';
    btnTj.style.cssText = 'flex:1;padding:12px';
    const wrap = mb.querySelector('#cobrar-recibido-wrap');
    wrap.style.display = metodo === 'Efectivo' ? '' : 'none';
    if (metodo === 'Tarjeta') { inp.value = total.toFixed(2); errEl.style.display = 'none'; cambioEl.style.display = 'none'; }
    else { inp.value = ''; inp.focus(); }
  }
  btnEf.onclick = () => { metodo = 'Efectivo'; pintarMetodo(); };
  btnTj.onclick = () => { metodo = 'Tarjeta'; pintarMetodo(); };

  const btnOk = [...document.querySelectorAll('#modal-actions .modal-btn')].pop();
  btnOk.onclick = async () => {
    const recibido = parseFloat((inp.value || '').replace(',', '.'));
    if (isNaN(recibido) || recibido < total - 0.001) { errEl.style.display = 'block'; return; }
    const cambio = Math.round((recibido - total) * 100) / 100;
    closeModal();
    if (mesaId) await set(ref(db, `pedidos/${mesaId}/_meta/pagoMetodo`), metodo);
    await imprimirTicketFinal(lineasImprimir, total, { recibido, cambio, metodo });
  };
  setTimeout(() => inp.focus(), 100);
}

// ── Cerrar mesa (con historial) ──────────────────────────────────────────────
function cerrarMesaEspecifica(targetMesaId, targetMesaNombre) {
  showModal({
    title: 'Cerrar mesa ' + targetMesaNombre,
    body: 'Se guardará la venta en el historial y se borrarán los pedidos de esta mesa. ¿Continuar?',
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Cerrar mesa', style: 'danger', action: async () => {
          const snap = await get(ref(db, 'pedidos/' + targetMesaId));
          const pedidos = snap.val() || {};

          const todasLineas = aplanarPedidos(pedidos);
          const agrupado = {};
          const camareros = new Set();
          todasLineas.forEach(l => {
            const q = qtyEnCuenta(l);
            if (q <= 0) return;
            if (l.camarero && l.destino !== 'descuento') camareros.add(l.camarero);
            const k = l.nombre + '||' + Number(l.precio).toFixed(2);
            if (!agrupado[k]) agrupado[k] = { nombre: l.nombre, precio: Number(l.precio), qty: 0, nota: l.nota || '' };
            agrupado[k].qty += q;
          });
          const lineas = Object.values(agrupado);
          const total = lineas.reduce((s, l) => s + l.precio * l.qty, 0);

          // Guardar en historial (usando el contexto de la mesa objetivo)
          const mesaIdPrev = mesaId, mesaNombrePrev = mesaNombre;
          mesaId = targetMesaId; mesaNombre = targetMesaNombre;
          if (lineas.length > 0) {
            const ahora = new Date();
            await upsertHistorial({
              mesa: targetMesaNombre, camarero: [...camareros].join(', '),
              ts: ahora.getTime(), fecha: ahora.toLocaleDateString('es-ES'),
              hora: ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
              total: Math.round(total * 100) / 100, lineas
            });
            logAuditoria('mesa_cerrada', `Total ${fmtEu(total)} · ${lineas.length} artículos`,
              { total: Math.round(total * 100) / 100, articulos: lineas.length });
          } else {
            logAuditoria('mesa_cerrada', 'Mesa cerrada sin consumo', { total: 0 });
          }

          await remove(ref(db, 'pedidos/' + targetMesaId));
          if (targetMesaId.startsWith('temp_')) {
            await remove(ref(db, 'mesas/' + targetMesaId));
          } else {
            await update(ref(db, 'mesas/' + targetMesaId), { estado: 'libre', atendidaTs: null });
          }
          try {
            const borrados = await limpiarPrintJobsCerradosDeMesa(targetMesaId);
            if (borrados > 0) {
              logAuditoria('print_jobs_limpiados', `Limpieza técnica al cerrar mesa (${borrados})`,
                { mesaId: targetMesaId, mesa: targetMesaNombre, printJobs: borrados });
            }
          } catch (_) { }
          mesaId = mesaIdPrev === targetMesaId ? null : mesaIdPrev;
          mesaNombre = mesaIdPrev === targetMesaId ? null : mesaNombrePrev;

          toast(`Mesa ${escapeHtml(targetMesaNombre)} cerrada · ${fmtEu(total)}`);
          if (mesaIdPrev === targetMesaId) {
            carrito = {};
            actualizarCabecera();
            cerrarDrawerSilencioso();
            show('mesas');
          } else {
            renderVistaMesas();
          }
        }
      }
    ]
  });
}

// ── Pedido temporal (llevar/domicilio/local) ─────────────────────────────────
let npTipoPedido = 'Llevar';

function abrirNuevoPedidoModal() {
  npTipoPedido = 'Llevar';
  const mb = showModalHTML('🛍️ Nuevo pedido', `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:6px">
        <button id="npb-llevar" type="button" class="modal-btn primary" style="flex:1;padding:10px;font-size:12px">🛍️ Llevar</button>
        <button id="npb-dom" type="button" class="modal-btn" style="flex:1;padding:10px;font-size:12px">🛵 Domicilio</button>
        <button id="npb-local" type="button" class="modal-btn" style="flex:1;padding:10px;font-size:12px">🍺 Local</button>
      </div>
      <div>
        <label style="display:block;font-size:11px;color:var(--muted);margin-bottom:4px;font-family:var(--mono)">CLIENTE</label>
        <input id="np-cliente" type="text" placeholder="Nombre (ej: Juan, María…)"
          style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--border);font-size:14px;background:var(--surface-2);color:var(--text);outline:none">
      </div>
      <div id="np-div-telefono">
        <label style="display:block;font-size:11px;color:var(--muted);margin-bottom:4px;font-family:var(--mono)">TELÉFONO</label>
        <input id="np-telefono" type="tel" placeholder="Teléfono (opcional)"
          style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--border);font-size:14px;background:var(--surface-2);color:var(--text);outline:none">
      </div>
      <div id="np-div-hora">
        <label style="display:block;font-size:11px;color:var(--muted);margin-bottom:4px;font-family:var(--mono)">HORA DE RECOGIDA</label>
        <div style="display:flex;gap:6px">
          <input id="np-hora" type="time" style="flex:1;padding:8px;border-radius:10px;border:1px solid var(--border);font-size:14px;background:var(--surface-2);color:var(--text);outline:none">
          <button type="button" class="modal-btn" style="padding:0 12px" data-min="15">+15m</button>
          <button type="button" class="modal-btn" style="padding:0 12px" data-min="30">+30m</button>
        </div>
      </div>
    </div>`,
    [
      { label: 'Cancelar' },
      {
        label: 'Crear pedido', style: 'primary', keepOpen: true, action: async () => {
          const inpC = $('np-cliente');
          const cliente = inpC.value.trim();
          const telefono = $('np-telefono').value.trim();
          const hora = $('np-hora').value;
          if (!cliente) {
            inpC.style.border = '2px solid var(--danger)';
            inpC.placeholder = '¡El nombre es obligatorio!';
            inpC.focus();
            return;
          }
          closeModal();
          await crearNuevoPedido(cliente, telefono, hora);
        }
      }
    ]);

  const btns = { Llevar: mb.querySelector('#npb-llevar'), Domicilio: mb.querySelector('#npb-dom'), Local: mb.querySelector('#npb-local') };
  function pintarTipo() {
    Object.entries(btns).forEach(([tipo, b]) => {
      b.className = 'modal-btn' + (npTipoPedido === tipo ? ' primary' : '');
      b.style.cssText = 'flex:1;padding:10px;font-size:12px';
    });
    const esLocal = npTipoPedido === 'Local';
    mb.querySelector('#np-div-telefono').style.display = esLocal ? 'none' : '';
    mb.querySelector('#np-div-hora').style.display = esLocal ? 'none' : '';
  }
  Object.entries(btns).forEach(([tipo, b]) => {
    b.onclick = () => { npTipoPedido = tipo; pintarTipo(); };
  });
  mb.querySelectorAll('[data-min]').forEach(b => {
    b.onclick = () => {
      const inp = $('np-hora');
      const base = new Date();
      if (inp.value) {
        const [h, m] = inp.value.split(':').map(Number);
        base.setHours(h, m, 0, 0);
      }
      base.setMinutes(base.getMinutes() + Number(b.dataset.min));
      inp.value = `${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}`;
    };
  });
  pintarTipo();
  setTimeout(() => $('np-cliente')?.focus(), 100);
}

async function crearNuevoPedido(cliente, telefono, hora) {
  const newMesaId = 'temp_' + Date.now();
  const emoji = npTipoPedido === 'Domicilio' ? '🛵' : npTipoPedido === 'Local' ? '🍺' : '🛍️';
  const displayHora = npTipoPedido !== 'Local' && hora ? ` (${hora})` : '';
  const nombreMesa = `${emoji} ${cliente}${displayHora}`;

  const newMesa = {
    nombre: nombreMesa,
    estado: 'ocupada',
    zona: 'Pedidos',
    temporal: true,
    cliente,
    telefono: npTipoPedido !== 'Local' ? telefono : '',
    horaRecogida: npTipoPedido !== 'Local' ? hora : '',
    tipoPedido: npTipoPedido,
    creadoTs: Date.now()
  };

  await set(ref(db, 'mesas/' + newMesaId), newMesa);
  logAuditoria('pedido_temporal_creado', `Pedido temporal creado: ${nombreMesa}`, {
    cliente, telefono: newMesa.telefono, hora: newMesa.horaRecogida,
    tipo: npTipoPedido, mesaId: newMesaId, mesa: nombreMesa
  });
  entrarMesa(newMesaId, nombreMesa, true);
}

// ═══════════════════════════════════════════════════════════════════════════
// CABLEADO DE UI
// ═══════════════════════════════════════════════════════════════════════════

// ── Vista Grid ⇄ Plano ──
function aplicarModoVista() {
  $('btn-vista-grid').classList.toggle('active', mesasViewMode === 'grid');
  $('btn-vista-plano').classList.toggle('active', mesasViewMode === 'plano');
  $('mesas-grid').style.display = mesasViewMode === 'grid' ? '' : 'none';
  $('plano-contenedor').hidden = mesasViewMode !== 'plano';
  renderVistaMesas();
}
$('btn-vista-grid').addEventListener('click', () => {
  mesasViewMode = 'grid';
  localStorage.setItem('cam2_view_mode', 'grid');
  aplicarModoVista();
});
$('btn-vista-plano').addEventListener('click', () => {
  mesasViewMode = 'plano';
  localStorage.setItem('cam2_view_mode', 'plano');
  aplicarModoVista();
});

// ── Mis mesas ──
function pintarFiltroMias() {
  $('btn-mias').classList.toggle('on', filtroMias);
}
$('btn-mias').addEventListener('click', () => {
  filtroMias = !filtroMias;
  localStorage.setItem('cam2_mias', filtroMias ? '1' : '0');
  pintarFiltroMias();
  renderVistaMesas();
});

// ── Orden por urgencia ──
function pintarOrdenUrgencia() {
  const b = $('btn-urgentes');
  if (b) b.classList.toggle('on', ordenarUrgencia);
}
$('btn-urgentes')?.addEventListener('click', () => {
  ordenarUrgencia = !ordenarUrgencia;
  localStorage.setItem('cam2_orden_urgencia', ordenarUrgencia ? '1' : '0');
  pintarOrdenUrgencia();
  renderVistaMesas();
});

// ── Nuevo pedido ──
$('btn-nuevo-pedido').addEventListener('click', abrirNuevoPedidoModal);

// ── Navegación carta/ticket ──
$('btn-back-mesas').addEventListener('click', () => volverMesas());
$('btn-cuenta-bar').addEventListener('click', verCuenta);
$('btn-cuenta-fab').addEventListener('click', verCuenta);
$('btn-ticket-back').addEventListener('click', () => { ticketEditMode = false; show('carta'); });
$('btn-ticket-refresh').addEventListener('click', cargarTicketActual);

// Mostrar el botón Cuenta cuando la mesa tiene consumo
setInterval(() => {
  if ($('view-carta').hidden === false && mesaId) actualizarFabCuenta();
}, 5000);

// ── Wake lock ──
let wakeLock = null;
async function activarWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (_) { }
}
function refrescarWakeLock() {
  const on = localStorage.getItem('cam2_wake') === '1';
  $('tgl-wake').classList.toggle('on', on);
  if (on) activarWakeLock();
  else if (wakeLock) { wakeLock.release().catch(() => { }); wakeLock = null; }
}
$('tgl-wake').addEventListener('click', () => {
  const on = localStorage.getItem('cam2_wake') === '1';
  localStorage.setItem('cam2_wake', on ? '0' : '1');
  refrescarWakeLock();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && localStorage.getItem('cam2_wake') === '1') activarWakeLock();
});

// ── Toggles TXT y Copia ──
function refrescarToggles() {
  $('tgl-txt').classList.toggle('on', localStorage.getItem('cam2_txt') === '1');
  $('tgl-copia').classList.toggle('on', localStorage.getItem('cam2_copia') === '1');
}
$('tgl-txt').addEventListener('click', () => {
  const on = localStorage.getItem('cam2_txt') === '1';
  localStorage.setItem('cam2_txt', on ? '0' : '1');
  refrescarToggles();
  toast(on ? 'TXT de comanda desactivado' : 'TXT de comanda activado: se descargará al enviar', { duration: 2200 });
});
$('tgl-copia').addEventListener('click', () => {
  const on = localStorage.getItem('cam2_copia') === '1';
  localStorage.setItem('cam2_copia', on ? '0' : '1');
  refrescarToggles();
  toast(on ? 'Copia visual del ticket desactivada' : 'Copia visual del ticket activada', { duration: 2200 });
});

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════
aplicarTema();
refrescarToggles();
refrescarWakeLock();
pintarFiltroMias();
pintarOrdenUrgencia();
aplicarModoVista();
actualizarCabecera();

// Fallback del loader del PIN si la conexión tarda
setTimeout(() => {
  const pLoad = $('pin-loading');
  if (pLoad) pLoad.style.display = 'none';
}, 4000);

// Service Worker (offline real del shell)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw-camarero2.js').catch(e => console.warn('SW:', e));
  });
}

// Exponer para depuración
window.__cam2 = { get state() { return { mesasData, pedidosData, cartaData, carrito, mesaId }; } };

































