// ── MÓDULO VERIFACTI ──────────────────────────────────────────────────────────
// Implementación de Verifactu (AEAT) mediante la API de Verifacti
// Docs: https://www.verifacti.com/docs
import { db } from './firebase.js';
import { ref, get, set, push }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const VF_DEFAULT_URL = 'https://api.verifacti.com';

// ── UTILS ─────────────────────────────────────────────────────────────────────

export function fmtFechaVf(ts) {
  const d = new Date(ts || Date.now());
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
}

// Calcula líneas de IVA a partir de las líneas del ticket
// Devuelve array de objetos { base_imponible, tipo_impositivo, cuota_repercutida }
// Todos los valores como string (formato que espera Verifacti)
export function buildLineasVf(lineas, ivaDefault = 10) {
  const total = lineas.reduce((s, l) => {
    const qty = Number(l.qty ?? l.qtyCuenta ?? 0);
    const precio = Number(l.precio ?? 0);
    return s + Math.round(precio * qty * 100) / 100;
  }, 0);

  if (total <= 0) {
    return [{
      base_imponible: '0.00',
      tipo_impositivo: String(ivaDefault),
      cuota_repercutida: '0.00'
    }];
  }

  const factor = 1 + ivaDefault / 100;
  const base = Math.round(total / factor * 100) / 100;
  const cuota = Math.round((total - base) * 100) / 100;

  return [{
    base_imponible: base.toFixed(2),
    tipo_impositivo: String(ivaDefault),
    cuota_repercutida: cuota.toFixed(2)
  }];
}

// Formatea fecha DD-MM-YYYY para mostrar en ticket
export function fmtFechaTicket(fechaVf) {
  // fechaVf ya viene en DD-MM-YYYY
  return fechaVf || '';
}

// ── SERIES / NUMERACIÓN ───────────────────────────────────────────────────────

// Lee el contador de serie en Firebase y lo incrementa
export async function siguienteNumero(serie) {
  const path = `verifactu/series/${serie.toUpperCase()}/siguiente`;
  const snap = await get(ref(db, path));
  const actual = Number(snap.val()) || 1;
  await set(ref(db, path), actual + 1);
  return String(actual);
}

// Lee el número actual sin incrementar (para mostrar en UI)
export async function verNumeroActual(serie) {
  const snap = await get(ref(db, `verifactu/series/${serie.toUpperCase()}/siguiente`));
  return Number(snap.val()) || 1;
}

// ── API CLIENT ────────────────────────────────────────────────────────────────

async function apiPost(endpoint, data, apiKey, baseUrl) {
  const url = (baseUrl || VF_DEFAULT_URL).replace(/\/$/, '') + endpoint;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(data)
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(json.message || json.error || `Error HTTP ${resp.status}`);
  }
  return json;
}

async function apiGet(endpoint, apiKey, baseUrl) {
  const url = (baseUrl || VF_DEFAULT_URL).replace(/\/$/, '') + endpoint;
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(json.message || json.error || `Error HTTP ${resp.status}`);
  }
  return json;
}

// ── TIPOS DE FACTURA ──────────────────────────────────────────────────────────

// F2 – Simplificada (sin destinatario identificado; lo normal en hostelería)
export async function emitirSimplificada(
  { serie, numero, lineas, total, descripcion, fecha }, apiKey, baseUrl
) {
  return apiPost('/verifactu/create', {
    serie,
    numero: String(numero),
    fecha_expedicion: fecha || fmtFechaVf(Date.now()),
    tipo_factura: 'F2',
    descripcion: descripcion || 'Consumición en local',
    lineas,
    importe_total: Number(total).toFixed(2)
  }, apiKey, baseUrl);
}

// F1 – Completa (con destinatario NIF/nombre identificado)
export async function emitirCompleta(
  { serie, numero, lineas, total, descripcion, fecha, nif, nombre }, apiKey, baseUrl
) {
  return apiPost('/verifactu/create', {
    serie,
    numero: String(numero),
    fecha_expedicion: fecha || fmtFechaVf(Date.now()),
    tipo_factura: 'F1',
    descripcion: descripcion || 'Consumición en local',
    nif,
    nombre,
    lineas,
    importe_total: Number(total).toFixed(2)
  }, apiKey, baseUrl);
}

// F3 – Sustitutiva (reemplaza una o varias simplificadas con una factura completa)
export async function emitirSustitutiva(
  { serie, numero, lineas, total, descripcion, fecha, nif, nombre, facturasOriginales },
  apiKey, baseUrl
) {
  return apiPost('/verifactu/create', {
    serie,
    numero: String(numero),
    fecha_expedicion: fecha || fmtFechaVf(Date.now()),
    tipo_factura: 'F3',
    descripcion: descripcion || 'Factura sustitutiva',
    nif,
    nombre,
    lineas,
    facturas_sustituidas: facturasOriginales,
    importe_total: Number(total).toFixed(2)
  }, apiKey, baseUrl);
}

// Rx – Rectificativa (R1-R5; método diferencias "I" o sustitución "S")
export async function emitirRectificativa(
  {
    serie, numero, tipo, metodo, lineas, total, descripcion, fecha,
    nif, nombre, facturasRectificadas, importeRectificativa
  },
  apiKey, baseUrl
) {
  const body = {
    serie,
    numero: String(numero),
    fecha_expedicion: fecha || fmtFechaVf(Date.now()),
    tipo_factura: tipo || 'R1',
    tipo_rectificativa: metodo || 'I',
    descripcion: descripcion || 'Factura rectificativa',
    lineas,
    importe_total: Number(total).toFixed(2),
    facturas_rectificadas: facturasRectificadas
  };
  if (nif) { body.nif = nif; body.nombre = nombre || ''; }
  if (importeRectificativa) body.importe_rectificativa = importeRectificativa;
  return apiPost('/verifactu/create', body, apiKey, baseUrl);
}

// Anulación (POST /verifactu/cancel)
export async function anularFactura(
  { serie, numero, fecha_expedicion }, apiKey, baseUrl
) {
  return apiPost('/verifactu/cancel', {
    serie,
    numero: String(numero),
    fecha_expedicion
  }, apiKey, baseUrl);
}

// Subsanación (POST /verifactu/modify)
export async function subsanarFactura(payload, apiKey, baseUrl) {
  return apiPost('/verifactu/modify', payload, apiKey, baseUrl);
}

// Consultar estado (GET /verifactu/status?uuid=...)
export async function consultarEstado(uuid, apiKey, baseUrl) {
  return apiGet(`/verifactu/status?uuid=${encodeURIComponent(uuid)}`, apiKey, baseUrl);
}

// ── FIREBASE STORAGE ──────────────────────────────────────────────────────────

export async function guardarFacturaEmitida(data) {
  const newRef = await push(ref(db, 'verifactu/facturas'), {
    ...data,
    ts: Date.now()
  });
  return newRef.key;
}

export async function listarFacturas() {
  const snap = await get(ref(db, 'verifactu/facturas'));
  return snap.val() || {};
}

export async function actualizarEstadoFactura(fbKey, nuevoEstado) {
  await set(ref(db, `verifactu/facturas/${fbKey}/status`), nuevoEstado);
}

export async function cargarConfigVf() {
  const snap = await get(ref(db, 'config/verifacti'));
  return snap.val() || {};
}

// ── ETIQUETAS LEGIBLES ────────────────────────────────────────────────────────

export function labelTipoFactura(tipo) {
  const map = {
    F1: 'Factura Completa',
    F2: 'Ticket Simplificado',
    F3: 'Factura Sustitutiva',
    R1: 'Rectificativa (Art.80.1,2,6)',
    R2: 'Rectificativa (Art.80.3)',
    R3: 'Rectificativa (Art.80.4)',
    R4: 'Rectificativa (otras causas)',
    R5: 'Rectificativa Simplificada',
    Rx: 'Rectificativa'
  };
  return map[tipo] || tipo;
}

export function labelEstado(status) {
  const map = {
    Pending: 'Pendiente AEAT',
    Accepted: 'Aceptada AEAT',
    Rejected: 'Rechazada AEAT',
    Error: 'Error',
    Cancelled: 'Anulada'
  };
  return map[status] || status || '—';
}
