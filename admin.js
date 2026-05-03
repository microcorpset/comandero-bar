// ── PROTECCIÓN DE DOMINIO ─────────────────────────────────────────────────────
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

import { authReady, db } from './firebase.js';
import {
  ref, set, push, remove, onValue, get, update, query, orderByChild, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

await authReady;

// ─── CONTRASEÑA ──────────────────────────────────────────────────────────────
const ADMIN_PWD_DEFAULT = 'admin1234';
const ADMIN_PWD_PATH = 'config/admin/password';

window.checkLogin = async () => {
  const pwd = document.getElementById('pwd-input').value;
  const snap = await get(ref(db, ADMIN_PWD_PATH));
  const stored = snap.val() || ADMIN_PWD_DEFAULT;
  if (pwd === stored) {
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    init();
  } else {
    document.getElementById('login-error').style.display = 'block';
  }
};

document.getElementById('pwd-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.checkLogin();
});

window.changePwd = async () => {
  const v = document.getElementById('new-pwd').value.trim();
  if (!v) return;
  await set(ref(db, ADMIN_PWD_PATH), v);
  document.getElementById('new-pwd').value = '';
  toast('Contraseña actualizada');
};

// ─── TABS ────────────────────────────────────────────────────────────────────
window.showTab = (name, btn) => {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sec-' + name).classList.add('active');
  btn.classList.add('active');
};

// ─── TOAST ───────────────────────────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── MÓDULO: DATOS GLOBALES ───────────────────────────────────────────────────
let mesasData     = {};
let cartaData     = {};
let categoriasData = {};
let ventasData    = [];        // para CSV y dashboard por artículo
let historialLimit = 300;      // paginación historial
let ventasTabActiva = 'tickets';

const ALERGENOS_EU = [
  'Gluten','Crustáceos','Huevo','Pescado','Cacahuetes','Soja','Lácteos',
  'Frutos de cáscara','Apio','Mostaza','Sésamo','Dióxido de azufre','Altramuces','Moluscos'
];

// ─── MESAS ───────────────────────────────────────────────────────────────────
function renderMesas(mesas) {
  mesasData = mesas || {};
  const contenedor = document.getElementById('mesas-lista');
  if (!contenedor) return;
  const entries = Object.entries(mesasData)
    .sort(([,a],[,b]) => (a.orden??999)-(b.orden??999) || a.nombre.localeCompare(b.nombre,'es',{numeric:true}));

  if (!entries.length) {
    contenedor.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:4px 0">Sin mesas aún</p>';
    return;
  }
  contenedor.innerHTML = '';
  entries.forEach(([id, m], idx) => {
    const zona = m.zona ? `<span class="row-sub" style="font-size:11px;opacity:.7">${m.zona}</span>` : '';
    const row = document.createElement('div');
    row.className = 'row-item';
    row.innerHTML = `
      <span class="row-label" style="font-family:var(--mono);font-size:15px" id="mlbl-${id}">${m.nombre}</span>
      ${zona}
      <span class="row-sub">${m.estado||'libre'}</span>
      <button class="btn btn-sm" onclick="editarMesaInline('${id}','${m.nombre.replace(/'/g,"\\'")}','${(m.zona||'').replace(/'/g,"\\'")}')">✏</button>
      <button class="btn btn-sm btn-danger" onclick="delMesa('${id}')">×</button>`;
    contenedor.appendChild(row);
  });
}

window.editarMesaInline = (id, nombreActual, zonaActual) => {
  const lbl = document.getElementById('mlbl-' + id);
  if (!lbl) return;
  lbl.innerHTML = `
    <input type="text" id="inp-mesa-${id}" value="${nombreActual}"
      style="font-family:var(--mono);font-size:13px;background:var(--bg);border:1px solid var(--accent);
      border-radius:4px;padding:3px 8px;width:110px;color:var(--text)" />
    <input type="text" id="inp-zona-${id}" value="${zonaActual||''}" placeholder="Zona (opc.)"
      style="font-size:12px;background:var(--bg);border:1px solid var(--border);
      border-radius:4px;padding:3px 8px;width:90px;color:var(--text);margin-left:4px" />`;
  const inp = document.getElementById('inp-mesa-' + id);
  const inpZona = document.getElementById('inp-zona-' + id);
  inp.focus(); inp.select();
  const guardar = async () => {
    const nuevo = inp.value.trim();
    const nuevaZona = inpZona.value.trim();
    const updates = {};
    if (nuevo && nuevo !== nombreActual) updates['mesas/' + id + '/nombre'] = nuevo;
    if (nuevaZona !== (zonaActual || '')) updates['mesas/' + id + '/zona'] = nuevaZona;
    if (Object.keys(updates).length) {
      await update(ref(db), updates);
      toast('Mesa actualizada');
    }
  };
  inp.addEventListener('blur', guardar);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
};

window.moverMesa = async (id, idx, dir) => {
  const lista = Object.entries(mesasData)
    .sort(([,a],[,b]) => (a.orden??999)-(b.orden??999) || a.nombre.localeCompare(b.nombre,'es',{numeric:true}));
  const idxDest = idx + dir;
  if (idxDest < 0 || idxDest >= lista.length) return;
  const updates = {};
  lista.forEach(([mid], i) => { updates['mesas/' + mid + '/orden'] = i; });
  updates['mesas/' + lista[idx][0] + '/orden'] = idxDest;
  updates['mesas/' + lista[idxDest][0] + '/orden'] = idx;
  await update(ref(db), updates);
};

window.addMesa = async () => {
  const nombre = document.getElementById('nueva-mesa').value.trim();
  const zona   = (document.getElementById('nueva-mesa-zona')?.value || '').trim();
  if (!nombre) return;
  await push(ref(db, 'mesas'), { nombre, estado: 'libre', zona });
  document.getElementById('nueva-mesa').value = '';
  if (document.getElementById('nueva-mesa-zona')) document.getElementById('nueva-mesa-zona').value = '';
  toast('Mesa añadida');
};

window.delMesa = async (id, e) => {
  if (e) e.stopPropagation();
  if (!confirm('¿Eliminar esta mesa?')) return;
  await remove(ref(db, 'mesas/' + id));
  toast('Mesa eliminada');
};

// ─── CARTA ───────────────────────────────────────────────────────────────────
let destino = 'barra';

window.setDest = d => {
  destino = d;
  document.querySelectorAll('.dest-btn').forEach(b => {
    b.className = 'dest-btn';
    if (b.id === 'db-' + d) b.classList.add('active-' + d);
  });
};

window.addCategoria = async () => {
  const nombre = document.getElementById('cat-nombre').value.trim();
  if (!nombre) return;
  await push(ref(db, 'categorias'), { nombre });
  document.getElementById('cat-nombre').value = '';
  toast('Categoría añadida');
};

window.addArticulo = async () => {
  const nombre = document.getElementById('art-nombre').value.trim();
  const precio = parseFloat(document.getElementById('art-precio').value);
  const catId  = document.getElementById('art-cat').value;
  if (!nombre || isNaN(precio) || !catId) { toast('Rellena todos los campos'); return; }
  await push(ref(db, 'carta'), { nombre, precio, destino, catId, disponible: true });
  document.getElementById('art-nombre').value = '';
  document.getElementById('art-precio').value = '';
  toast('Artículo añadido');
};

window.delArticulo = async id => {
  await remove(ref(db, 'carta/' + id));
  toast('Artículo eliminado');
};

window.toggleDestino = async (id, actual) => {
  const orden = ['barra','cocina','ambos'];
  const next = orden[(orden.indexOf(actual) + 1) % 3];
  await set(ref(db, 'carta/' + id + '/destino'), next);
};

window.toggleDisponible = async (id, disponibleActual) => {
  const nuevo = !disponibleActual;
  await set(ref(db, 'carta/' + id + '/disponible'), nuevo);
  toast(nuevo ? 'Artículo disponible' : 'Artículo marcado como agotado');
};

function renderCarta() {
  const lista = document.getElementById('carta-lista');
  if (!Object.keys(categoriasData).length) {
    lista.innerHTML = '<p style="color:var(--muted);font-size:13px">Sin categorías aún</p>';
    return;
  }
  lista.innerHTML = '';
  Object.entries(categoriasData)
    .sort(([,a],[,b]) => a.nombre.localeCompare(b.nombre, 'es'))
    .forEach(([catId, cat]) => {
      const arts = Object.entries(cartaData)
        .filter(([,a]) => a.catId === catId)
        .sort(([,a],[,b]) => (a.orden||0) - (b.orden||0) || a.nombre.localeCompare(b.nombre,'es'));

      const catEl = document.createElement('div');
      catEl.innerHTML = `<div class="categoria-header">${cat.nombre}
        <button class="btn btn-sm btn-danger" style="float:right;margin-top:-2px"
          onclick="delCat('${catId}')">× eliminar</button></div>`;

      arts.forEach(([id, a], idx) => {
        const disponible = a.disponible !== false;
        const row = document.createElement('div');
        row.className = 'row-item';
        row.id = 'art-row-' + id;
        row.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
            <span class="row-label" id="art-label-${id}" style="${disponible?'':'opacity:.45;text-decoration:line-through'}">${a.nombre}</span>
            <span class="row-sub">${Number(a.precio).toFixed(2)} €${a.variantes?.length ? ` · ${a.variantes.length} variante${a.variantes.length>1?'s':''}` : ''}${a.alergenos?.length ? ` · ${a.alergenos.length} alérg.` : ''}</span>
          </div>
          <button class="btn btn-sm ${disponible ? 'btn-success' : 'btn-danger'}" style="flex-shrink:0;font-size:11px"
            onclick="toggleDisponible('${id}',${disponible})">${disponible ? '✓ Disp.' : '✗ Agotado'}</button>
          <span class="badge-dest bd-${a.destino}" style="cursor:pointer;flex-shrink:0"
            onclick="toggleDestino('${id}','${a.destino}')" id="art-dest-${id}">${a.destino}</span>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn btn-sm" title="Mover arriba"
              onclick="moverArt('${id}','${catId}',${idx},-1)" ${idx===0?'disabled':''}>↑</button>
            <button class="btn btn-sm" title="Mover abajo"
              onclick="moverArt('${id}','${catId}',${idx},1)" ${idx===arts.length-1?'disabled':''}>↓</button>
            <button class="btn btn-sm" onclick="editarArticulo('${id}')">✏</button>
            <button class="btn btn-sm btn-danger" onclick="delArticulo('${id}')">×</button>
          </div>`;
        catEl.appendChild(row);

        // Panel de edición inline
        const editPanel = document.createElement('div');
        editPanel.id = 'edit-panel-' + id;
        editPanel.style.cssText = 'display:none;padding:12px;background:var(--surface2);border-bottom:1px solid var(--border);flex-direction:column;gap:10px';

        // Campos básicos
        const camposHTML = `
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input type="text" id="edit-nombre-${id}" value="${a.nombre.replace(/"/g,'&quot;')}"
              placeholder="Nombre" style="flex:2;min-width:120px" />
            <input type="number" id="edit-precio-${id}" value="${Number(a.precio).toFixed(2)}"
              placeholder="Precio" step="0.1" min="0" style="width:90px;flex:none" />
            <select id="edit-cat-${id}" style="flex:1;min-width:110px"></select>
            <button class="btn btn-success btn-sm" onclick="guardarArticulo('${id}')">Guardar</button>
            <button class="btn btn-sm" onclick="cancelarEdicion('${id}')">Cancelar</button>
          </div>`;

        // Alérgenos
        const alergenosActuales = a.alergenos || [];
        const alergenosHTML = `
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em">Alérgenos</div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px" id="alerg-checks-${id}">
              ${ALERGENOS_EU.map(al => `
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:3px 0">
                  <input type="checkbox" data-alerg="${al}" ${alergenosActuales.includes(al)?'checked':''} style="width:14px;height:14px" />
                  <span>${al}</span>
                </label>`).join('')}
            </div>
          </div>`;

        // Variantes
        const variantesActuales = a.variantes || [];
        const variantesHTML = `
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em">Variantes de precio</div>
            <div id="variantes-lista-${id}">
              ${variantesActuales.map((v, i) => `
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
                  <span style="flex:1;font-size:13px">${v.nombre}</span>
                  <span style="font-family:var(--mono);font-size:12px;color:var(--muted)">${Number(v.precio).toFixed(2)} €</span>
                  <button class="btn btn-sm btn-danger" onclick="eliminarVariante('${id}',${i})">×</button>
                </div>`).join('')}
            </div>
            <div style="display:flex;gap:8px;margin-top:6px">
              <input type="text" id="var-nombre-${id}" placeholder="Nombre variante" style="flex:2;min-width:100px" />
              <input type="number" id="var-precio-${id}" placeholder="Precio €" step="0.1" min="0" style="width:90px;flex:none" />
              <button class="btn btn-sm btn-success" onclick="agregarVariante('${id}')">+ Añadir</button>
            </div>
          </div>`;

        editPanel.innerHTML = camposHTML + alergenosHTML + variantesHTML;
        catEl.appendChild(editPanel);
      });

      lista.appendChild(catEl);
    });

  // Rellenar selects de categoría en paneles de edición
  Object.keys(cartaData).forEach(id => {
    const sel = document.getElementById('edit-cat-' + id);
    if (!sel) return;
    sel.innerHTML = Object.entries(categoriasData)
      .map(([cid, c]) => `<option value="${cid}" ${cartaData[id]?.catId===cid?'selected':''}>${c.nombre}</option>`)
      .join('');
  });
}

window.editarArticulo = id => {
  document.querySelectorAll('[id^="edit-panel-"]').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('edit-panel-' + id);
  if (panel) panel.style.cssText = panel.style.cssText.replace('none','flex');
};

window.cancelarEdicion = id => {
  const panel = document.getElementById('edit-panel-' + id);
  if (panel) panel.style.display = 'none';
};

window.guardarArticulo = async id => {
  const nombre = document.getElementById('edit-nombre-' + id)?.value.trim();
  const precio = parseFloat(document.getElementById('edit-precio-' + id)?.value);
  const catId  = document.getElementById('edit-cat-' + id)?.value;
  if (!nombre || isNaN(precio) || !catId) { toast('Rellena todos los campos'); return; }

  // Recoger alérgenos seleccionados
  const checks = document.querySelectorAll(`#alerg-checks-${id} input[type="checkbox"]`);
  const alergenos = Array.from(checks).filter(c => c.checked).map(c => c.dataset.alerg);

  // Variantes actuales (se gestionan por agregarVariante/eliminarVariante en tiempo real)
  const variantesActuales = cartaData[id]?.variantes || [];

  await set(ref(db, 'carta/' + id), {
    ...cartaData[id], nombre, precio, catId, alergenos,
    variantes: variantesActuales,
    disponible: cartaData[id]?.disponible !== false
  });
  toast('Artículo actualizado');
};

window.agregarVariante = async (artId) => {
  const nombre = document.getElementById('var-nombre-' + artId)?.value.trim();
  const precio = parseFloat(document.getElementById('var-precio-' + artId)?.value);
  if (!nombre || isNaN(precio)) { toast('Rellena nombre y precio de la variante'); return; }
  const variantesActuales = cartaData[artId]?.variantes || [];
  const nuevas = [...variantesActuales, { nombre, precio }];
  await set(ref(db, 'carta/' + artId + '/variantes'), nuevas);
  document.getElementById('var-nombre-' + artId).value = '';
  document.getElementById('var-precio-' + artId).value = '';
  toast('Variante añadida');
};

window.eliminarVariante = async (artId, idx) => {
  const variantesActuales = cartaData[artId]?.variantes || [];
  const nuevas = variantesActuales.filter((_, i) => i !== idx);
  await set(ref(db, 'carta/' + artId + '/variantes'), nuevas.length ? nuevas : null);
  toast('Variante eliminada');
};

window.moverArt = async (id, catId, idx, dir) => {
  const arts = Object.entries(cartaData)
    .filter(([,a]) => a.catId === catId)
    .sort(([,a],[,b]) => (a.orden||0) - (b.orden||0) || a.nombre.localeCompare(b.nombre,'es'));

  const idxDest = idx + dir;
  if (idxDest < 0 || idxDest >= arts.length) return;

  const updates = {};
  arts.forEach(([aid], i) => { updates['carta/' + aid + '/orden'] = i; });
  updates['carta/' + arts[idx][0] + '/orden'] = idxDest;
  updates['carta/' + arts[idxDest][0] + '/orden'] = idx;
  await update(ref(db), updates);
};

window.delCat = async id => {
  if (!confirm('¿Eliminar categoría y sus artículos?')) return;
  const snaps = await get(ref(db, 'carta'));
  const arts = snaps.val() || {};
  const dels = Object.entries(arts).filter(([,a]) => a.catId === id).map(([aid]) =>
    remove(ref(db, 'carta/' + aid)));
  await Promise.all([...dels, remove(ref(db, 'categorias/' + id))]);
  toast('Categoría eliminada');
};

function updateCatSelect() {
  const sel = document.getElementById('art-cat');
  sel.innerHTML = '<option value="">— Categoría —</option>';
  Object.entries(categoriasData).forEach(([id, c]) => {
    sel.innerHTML += `<option value="${id}">${c.nombre}</option>`;
  });
}

window.guardarPin = (rol) => {
  const val = document.getElementById('pin-' + rol).value.trim();
  if (!/^\d{4}$/.test(val)) { toast('El PIN debe tener exactamente 4 dígitos'); return; }
  set(ref(db, 'config/pins/' + rol), val);
  toast('PIN de ' + rol + ' actualizado');
};

// ─── VENTAS ──────────────────────────────────────────────────────────────────
function initFiltrosFecha() {
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm   = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd   = String(hoy.getDate()).padStart(2, '0');
  const local = `${yyyy}-${mm}-${dd}`;
  document.getElementById('filtro-fecha-ini').value = local;
  document.getElementById('filtro-fecha-fin').value = local;
}

function parseFechaHoraTicket(fecha, hora = '00:00') {
  if (!fecha) return NaN;
  const fechaTxt = String(fecha).trim();
  const horaTxt = String(hora || '00:00').trim().slice(0, 5);

  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaTxt)) {
    return new Date(`${fechaTxt}T${horaTxt}:00`).getTime();
  }

  const match = fechaTxt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return NaN;

  const [, dd, mm, yyyy] = match;
  const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return new Date(`${iso}T${horaTxt}:00`).getTime();
}

function normalizarTicketVenta(id, ticket = {}) {
  const tsNum = Number(ticket.ts);
  const ts = Number.isFinite(tsNum) && tsNum > 0
    ? tsNum
    : parseFechaHoraTicket(ticket.fecha, ticket.hora);
  return { id, ...ticket, ts };
}

window.resetFiltros = () => {
  initFiltrosFecha();
  document.getElementById('filtro-hora-ini').value = '00:00';
  document.getElementById('filtro-hora-fin').value = '23:59';
  historialLimit = 300;
  aplicarFiltros();
};

window.aplicarFiltros = async () => {
  const fechaIni  = document.getElementById('filtro-fecha-ini').value;
  const fechaFin  = document.getElementById('filtro-fecha-fin').value;
  const horaIni   = document.getElementById('filtro-hora-ini').value || '00:00';
  const horaFin   = document.getElementById('filtro-hora-fin').value || '23:59';

  if (!fechaIni || !fechaFin) { toast('Selecciona las fechas'); return; }

  const tsIni = new Date(`${fechaIni}T${horaIni}:00`).getTime();
  const tsFin = new Date(`${fechaFin}T${horaFin}:59`).getTime();

  const q = query(ref(db, 'historial'), orderByChild('ts'), limitToLast(historialLimit));
  const snap = await get(q);
  const data = snap.val() || {};
  const totalCargados = Object.keys(data).length;

  const tickets = Object.entries(data)
    .map(([id, t]) => normalizarTicketVenta(id, t))
    .filter(t => Number.isFinite(t.ts))
    .filter(t => t.ts >= tsIni && t.ts <= tsFin)
    .sort((a, b) => b.ts - a.ts);

  ventasData = tickets;

  const btnCargar = document.getElementById('btn-cargar-mas');
  if (btnCargar) btnCargar.style.display = totalCargados >= historialLimit ? '' : 'none';

  renderVentas(tickets);
  if (ventasTabActiva === 'articulos') renderVentasPorArticulo(tickets);
};

window.cargarMasHistorial = async () => {
  historialLimit += 300;
  await aplicarFiltros();
};

window.exportarCSV = () => {
  if (!ventasData.length) { toast('Sin datos para exportar'); return; }
  const fechaIni = document.getElementById('filtro-fecha-ini').value;
  const fechaFin = document.getElementById('filtro-fecha-fin').value;
  let csv = 'Fecha,Hora,Mesa,Camarero,Total,Artículo,Cantidad,Precio unitario\n';
  ventasData.forEach(t => {
    const fecha = new Date(t.ts).toLocaleDateString('es-ES');
    const hora  = new Date(t.ts).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
    (t.lineas || []).forEach(l => {
      const esc = s => '"' + String(s||'').replace(/"/g,'""') + '"';
      csv += `${esc(fecha)},${esc(hora)},${esc(t.mesa)},${esc(t.camarero||'')},${esc((t.total||0).toFixed(2))},${esc(l.nombre)},${esc(l.qty)},${esc(Number(l.precio).toFixed(2))}\n`;
    });
  });
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `ventas_${fechaIni}_${fechaFin}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
};

window.mostrarTabVentas = (tab, btn) => {
  ventasTabActiva = tab;
  document.querySelectorAll('.ventas-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const divTickets   = document.getElementById('ventas-por-ticket');
  const divArticulos = document.getElementById('ventas-por-articulo');
  if (divTickets)   divTickets.style.display   = tab === 'tickets'   ? '' : 'none';
  if (divArticulos) divArticulos.style.display = tab === 'articulos' ? '' : 'none';
  if (tab === 'articulos') renderVentasPorArticulo(ventasData);
};

function renderVentas(tickets) {
  const lista = document.getElementById('ventas-lista');

  if (!tickets.length) {
    lista.innerHTML = '<div class="ventas-empty">Sin ventas en ese período</div>';
    document.getElementById('stat-mesas').textContent  = '0';
    document.getElementById('stat-total').textContent  = '0,00 €';
    document.getElementById('stat-media').textContent  = '—';
    document.getElementById('stat-lineas').textContent = '0';
    return;
  }

  const totalGeneral = tickets.reduce((s, t) => s + (t.total || 0), 0);
  const totalLineas  = tickets.reduce((s, t) =>
    s + (t.lineas || []).reduce((acc, l) => acc + Number(l.qty || 0), 0), 0);
  const media        = totalGeneral / tickets.length;

  document.getElementById('stat-mesas').textContent  = tickets.length;
  document.getElementById('stat-total').textContent  = totalGeneral.toFixed(2).replace('.', ',') + ' €';
  document.getElementById('stat-media').textContent  = media.toFixed(2).replace('.', ',') + ' €';
  document.getElementById('stat-lineas').textContent = totalLineas;

  lista.innerHTML = '';
  tickets.forEach(t => {
    const hora = new Date(t.ts).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
    const div = document.createElement('div');
    div.className = 'ticket-hist';
    div.innerHTML = `
      <div class="ticket-hist-hdr" onclick="this.parentElement.classList.toggle('open')">
        <span class="ticket-hist-mesa">Mesa ${t.mesa}</span>
        <span class="ticket-hist-hora">${hora}</span>
        ${t.camarero ? `<span style="font-family:var(--mono);font-size:11px;color:var(--accent)">${t.camarero}</span>` : ''}
        <span class="ticket-hist-total">${(t.total||0).toFixed(2).replace('.',',')} €</span>
        <span style="color:var(--muted);font-size:12px">▾</span>
      </div>
      <div class="ticket-hist-body">
        ${(t.lineas || []).map(l => `
          <div class="ticket-hist-linea">
            <span>${l.qty}× ${l.nombre}</span>
            <span style="font-family:var(--mono)">${(l.precio * l.qty).toFixed(2)} €</span>
          </div>`).join('')}
        <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-weight:500;margin-top:8px;padding-top:8px;border-top:2px solid var(--border)">
          <span>Total</span><span>${(t.total||0).toFixed(2).replace('.',',')} €</span>
        </div>
      </div>`;
    lista.appendChild(div);
  });
}

function renderVentasPorArticulo(tickets) {
  const lista = document.getElementById('ventas-por-articulo');
  if (!lista) return;
  if (!tickets.length) {
    lista.innerHTML = '<div class="ventas-empty">Sin datos en el período seleccionado</div>';
    return;
  }
  const mapa = {};
  tickets.forEach(t => {
    (t.lineas || []).forEach(l => {
      const k = l.nombre;
      if (!mapa[k]) mapa[k] = { nombre: l.nombre, qty: 0, total: 0 };
      mapa[k].qty   += Number(l.qty || 0);
      mapa[k].total += Number(l.precio || 0) * Number(l.qty || 0);
    });
  });
  const sorted = Object.values(mapa).sort((a, b) => b.qty - a.qty);
  lista.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:8px 4px;color:var(--muted);font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Artículo</th>
        <th style="text-align:right;padding:8px 4px;color:var(--muted);font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Uds</th>
        <th style="text-align:right;padding:8px 4px;color:var(--muted);font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Total</th>
      </tr></thead>
      <tbody>${sorted.map(a => `
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:8px 4px">${a.nombre}</td>
          <td style="text-align:right;padding:8px 4px;font-family:var(--mono)">${a.qty}</td>
          <td style="text-align:right;padding:8px 4px;font-family:var(--mono);color:var(--accent)">${a.total.toFixed(2).replace('.',',')} €</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

// ─── USUARIOS ────────────────────────────────────────────────────────────────
window.addUsuario = async () => {
  const nombre = document.getElementById('usr-nombre').value.trim();
  const pin    = document.getElementById('usr-pin').value.trim();
  if (!nombre) { toast('Introduce un nombre'); return; }
  if (!/^\d{4}$/.test(pin)) { toast('El PIN debe tener 4 dígitos'); return; }
  const snap = await get(ref(db, 'config/usuarios'));
  const usuarios = snap.val() || {};
  const duplicado = Object.values(usuarios).find(u => u.pin === pin);
  if (duplicado) { toast('Ese PIN ya está en uso por ' + duplicado.nombre); return; }
  await push(ref(db, 'config/usuarios'), { nombre, pin });
  document.getElementById('usr-nombre').value = '';
  document.getElementById('usr-pin').value = '';
  toast('Camarero añadido');
};

window.delUsuario = async id => {
  await remove(ref(db, 'config/usuarios/' + id));
  toast('Camarero eliminado');
};

function renderUsuarios(usuarios) {
  const lista = document.getElementById('usuarios-lista');
  if (!lista) return;
  const entries = Object.entries(usuarios || {});
  if (!entries.length) {
    lista.innerHTML = '<p style="font-size:13px;color:var(--muted)">Sin camareros. Añade uno abajo.</p>';
    return;
  }
  lista.innerHTML = '';
  entries.forEach(([id, u]) => {
    const row = document.createElement('div');
    row.className = 'row-item';
    row.innerHTML = `
      <span class="row-label">${u.nombre}</span>
      <span class="row-sub" style="font-family:var(--mono)">PIN: ${u.pin}</span>
      <button class="btn btn-sm btn-danger" onclick="delUsuario('${id}')">× Eliminar</button>`;
    lista.appendChild(row);
  });
}

// ─── ALERTAS DE TIEMPO ────────────────────────────────────────────────────────
window.guardarAlertas = async () => {
  const verde    = parseInt(document.getElementById('alerta-verde')?.value) || 10;
  const amarillo = parseInt(document.getElementById('alerta-amarillo')?.value) || 20;
  if (verde >= amarillo) { toast('El umbral amarillo debe ser mayor que el verde'); return; }
  await set(ref(db, 'config/alertas'), { verde, amarillo });
  toast('Umbrales de alerta guardados');
};

// ─── TURNO ────────────────────────────────────────────────────────────────────
window.abrirTurno = async () => {
  const nombre = document.getElementById('turno-nombre')?.value.trim() || 'Turno';
  await set(ref(db, 'config/turno'), { abierto: true, inicio: Date.now(), nombre });
  toast('Turno abierto: ' + nombre);
};

window.cerrarTurno = async () => {
  const snapTurno = await get(ref(db, 'config/turno'));
  const turno = snapTurno.val();
  if (!turno?.abierto) { toast('No hay turno abierto'); return; }

  const q = query(ref(db, 'historial'), orderByChild('ts'), limitToLast(1000));
  const snapHistorial = await get(q);
  const data = snapHistorial.val() || {};
  const tickets = Object.values(data).filter(t => t.ts >= turno.inicio);

  const total       = tickets.reduce((s, t) => s + (t.total || 0), 0);
  const lineas_count = tickets.reduce((s, t) => s + (t.lineas?.length || 0), 0);

  await push(ref(db, 'historial_turnos'), {
    nombre: turno.nombre,
    inicio: turno.inicio,
    fin: Date.now(),
    mesas: tickets.length,
    total: Math.round(total * 100) / 100,
    lineas_count
  });
  await set(ref(db, 'config/turno/abierto'), false);
  toast(`Turno cerrado — ${tickets.length} mesas · ${total.toFixed(2).replace('.', ',')} €`);
};

// ─── INIT ────────────────────────────────────────────────────────────────────
function init() {
  initFiltrosFecha();
  aplicarFiltros();

  onValue(ref(db, 'mesas'), snap => renderMesas(snap.val()));

  onValue(ref(db, 'categorias'), snap => {
    categoriasData = snap.val() || {};
    updateCatSelect();
    renderCarta();
  });
  onValue(ref(db, 'carta'), snap => {
    cartaData = snap.val() || {};
    renderCarta();
  });
  onValue(ref(db, 'config/local'), snap => {
    const d = snap.val() || {};
    document.getElementById('local-nombre').value    = d.nombre    || '';
    document.getElementById('local-direccion').value = d.direccion || '';
    document.getElementById('local-telefono').value  = d.telefono  || '';
    document.getElementById('local-cif').value       = d.cif       || '';
    document.getElementById('local-footer').value    = d.footer    || '';
  });
  onValue(ref(db, 'config/usuarios'), snap => renderUsuarios(snap.val()));

  // Cuota en tiempo real
  onValue(ref(db, 'config/quota/lineas'), snap => {
    const val = snap.val();
    const el = document.getElementById('quota-display');
    if (!el) return;
    if (val === null)    { el.textContent = 'Sin configurar'; el.style.color = 'var(--muted)'; }
    else if (val === -1) { el.textContent = '∞ Sin límite';   el.style.color = 'var(--success)'; }
    else if (val <= 0)   { el.textContent = '0 — BLOQUEADO';  el.style.color = 'var(--danger)'; }
    else if (val <= 200) { el.textContent = val;              el.style.color = '#e57a35'; }
    else                 { el.textContent = val;              el.style.color = 'var(--accent)'; }
  });

  // Estadísticas de consumo mensual
  onValue(ref(db, 'config/stats'), snap => {
    renderStats(snap.val() || {});
  });

  // Alertas de tiempo configurables
  onValue(ref(db, 'config/alertas'), snap => {
    const d = snap.val() || {};
    const elV = document.getElementById('alerta-verde');
    const elA = document.getElementById('alerta-amarillo');
    if (elV) elV.value = d.verde    ?? 10;
    if (elA) elA.value = d.amarillo ?? 20;
  });

  // Turno
  onValue(ref(db, 'config/turno'), snap => {
    const t = snap.val() || {};
    const statusEl  = document.getElementById('turno-status');
    const btnAbrir  = document.getElementById('btn-abrir-turno');
    const btnCerrar = document.getElementById('btn-cerrar-turno');
    if (!statusEl) return;
    if (t.abierto) {
      const inicio = new Date(t.inicio).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
      statusEl.textContent = `"${t.nombre || 'Sin nombre'}" abierto desde ${inicio}`;
      statusEl.style.color = 'var(--success)';
      if (btnAbrir)  btnAbrir.disabled  = true;
      if (btnCerrar) btnCerrar.disabled = false;
    } else {
      statusEl.textContent = 'Sin turno activo';
      statusEl.style.color = 'var(--muted)';
      if (btnAbrir)  btnAbrir.disabled  = false;
      if (btnCerrar) btnCerrar.disabled = true;
    }
  });
}

function renderStats(data) {
  const lista = document.getElementById('stats-lista');
  if (!lista) return;

  const meses = Object.entries(data).sort(([a],[b]) => b.localeCompare(a));

  if (!meses.length) {
    lista.innerHTML = '<div style="font-size:13px;color:var(--muted)">Sin datos aún. Se irán registrando con cada pedido enviado.</div>';
    return;
  }

  const mesActual = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
  })();

  const totalGeneral = meses.reduce((s, [,d]) => s + (d.lineas||0), 0);
  const maxMes = Math.max(...meses.map(([,d]) => d.lineas||0));

  lista.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 12px;border-bottom:1px solid var(--border);margin-bottom:4px">
      <span style="font-size:13px;color:var(--muted)">Total acumulado</span>
      <span style="font-family:var(--mono);font-size:18px;font-weight:500">${totalGeneral.toLocaleString('es-ES')} líneas</span>
    </div>`;

  meses.forEach(([mes, datos]) => {
    const lineas = datos.lineas || 0;
    const esActual = mes === mesActual;
    const [anio, num] = mes.split('-');
    const nombre = new Date(anio, num-1, 1).toLocaleString('es-ES', {month:'long', year:'numeric'});
    const porcentaje = maxMes > 0 ? Math.round(lineas / maxMes * 100) : 0;

    const row = document.createElement('div');
    row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--border)';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="font-size:13px;font-weight:500;flex:1;text-transform:capitalize">${nombre}</span>
        ${esActual ? `<span style="font-size:11px;background:var(--accent-dim);color:var(--accent);padding:2px 8px;border-radius:20px;font-family:var(--mono)">en curso</span>` : ''}
        <span style="font-family:var(--mono);font-size:14px;font-weight:500">${lineas.toLocaleString('es-ES')}</span>
        <span style="font-size:12px;color:var(--muted)">líneas</span>
      </div>
      <div style="height:4px;background:var(--surface2);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${porcentaje}%;background:${esActual?'var(--accent)':'var(--border)'};border-radius:2px"></div>
      </div>`;
    lista.appendChild(row);
  });
}

window.guardarLocal = async () => {
  await set(ref(db, 'config/local'), {
    nombre:    document.getElementById('local-nombre').value.trim(),
    direccion: document.getElementById('local-direccion').value.trim(),
    telefono:  document.getElementById('local-telefono').value.trim(),
    cif:       document.getElementById('local-cif').value.trim(),
    footer:    document.getElementById('local-footer').value.trim(),
  });
  toast('Datos del local guardados');
};
