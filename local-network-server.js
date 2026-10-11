const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'local_network_data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const CONFIG_PATH = path.join(ROOT, 'local-network-config.json');
const PRINT_SCRIPT = path.join(ROOT, 'print-receipt.ps1');
const HOST = process.env.COMANDERO_LOCAL_HOST || '0.0.0.0';
const PORT = Number(process.env.COMANDERO_LOCAL_PORT || 5390);

ensureDir(DATA_DIR);
ensureFile(DB_PATH, JSON.stringify(defaultDb(), null, 2));
ensureFile(CONFIG_PATH, JSON.stringify(defaultConfig(), null, 2));

const clients = new Set();
let dispatching = false;

const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        host: HOST,
        port: PORT,
        queueSize: loadDb().jobs.length,
        pending: loadDb().jobs.filter(job => job.status === 'pending').length,
        serverTime: Date.now()
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      return handleEvents(req, res);
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, loadConfig());
    }

    if (req.method === 'PUT' && url.pathname === '/api/config') {
      const body = await readJson(req);
      const merged = mergeConfig(loadConfig(), body || {});
      saveConfig(merged);
      broadcast({ type: 'config', config: merged });
      return json(res, 200, { ok: true, config: merged });
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      const status = String(url.searchParams.get('status') || '').trim();
      const db = loadDb();
      const jobs = status ? db.jobs.filter(job => job.status === status) : db.jobs;
      return json(res, 200, jobs.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)));
    }

    if (req.method === 'POST' && url.pathname === '/api/orders/command') {
      const body = await readJson(req);
      const jobs = createCommandJobs(body || {});
      if (!jobs.length) return json(res, 400, { error: 'La comanda no tiene líneas válidas.' });
      const db = loadDb();
      db.jobs.push(...jobs);
      saveDb(db);
      broadcast({ type: 'jobs', jobs: db.jobs });
      queueDispatchSoon();
      return json(res, 200, { ok: true, created: jobs.length, jobs });
    }

    if (req.method === 'POST' && url.pathname === '/api/orders/ticket') {
      const body = await readJson(req);
      const job = createTicketJob(body || {});
      if (!job.payload.lineas.length) return json(res, 400, { error: 'El ticket no tiene líneas válidas.' });
      const db = loadDb();
      db.jobs.push(job);
      saveDb(db);
      broadcast({ type: 'jobs', jobs: db.jobs });
      queueDispatchSoon();
      return json(res, 200, { ok: true, created: 1, job });
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs/dispatch') {
      const body = await readJson(req).catch(() => ({}));
      const limit = clamp(Number(body?.limit || url.searchParams.get('limit') || 25), 1, 100);
      const result = await dispatchPending(limit);
      return json(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/retry')) {
      const jobId = decodeURIComponent(url.pathname.split('/')[3] || '');
      const db = loadDb();
      const job = db.jobs.find(item => item.id === jobId);
      if (!job) return json(res, 404, { error: 'Trabajo no encontrado.' });
      job.status = 'pending';
      job.error = '';
      job.printingAt = null;
      saveDb(db);
      broadcast({ type: 'jobs', jobs: db.jobs });
      queueDispatchSoon();
      return json(res, 200, { ok: true, job });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/print')) {
      const jobId = decodeURIComponent(url.pathname.split('/')[3] || '');
      const result = await printSingleJob(jobId);
      return json(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/jobs/')) {
      const jobId = decodeURIComponent(url.pathname.split('/')[3] || '');
      const db = loadDb();
      const next = db.jobs.filter(job => job.id !== jobId);
      if (next.length === db.jobs.length) return json(res, 404, { error: 'Trabajo no encontrado.' });
      db.jobs = next;
      saveDb(db);
      broadcast({ type: 'jobs', jobs: db.jobs });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs/clear-history') {
      const db = loadDb();
      db.jobs = db.jobs.filter(job => job.status !== 'printed' && job.status !== 'error');
      saveDb(db);
      broadcast({ type: 'jobs', jobs: db.jobs });
      return json(res, 200, { ok: true, remaining: db.jobs.length });
    }

    json(res, 404, { error: 'Ruta no encontrada.' });
  } catch (error) {
    json(res, 500, { error: error.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[local-network] escuchando en http://${HOST}:${PORT}`);
  queueDispatchSoon();
});

function defaultDb() {
  return { jobs: [] };
}

function defaultConfig() {
  return {
    printing: {
      autoDispatch: true,
      barra: { enabled: true, printerName: '', paper: '58mm', fontSize: 9, uppercase: false },
      cocina: { enabled: true, printerName: '', paper: '58mm', fontSize: 9, uppercase: false },
      pizzas: { enabled: true, printerName: '', paper: '58mm', fontSize: 9, uppercase: false },
      ticketFinal: { enabled: true, printerName: '', paper: '58mm', fontSize: 9, uppercase: false }
    }
  };
}

function mergeConfig(current, patch) {
  const base = current && typeof current === 'object' ? current : defaultConfig();
  const next = patch && typeof patch === 'object' ? patch : {};
  return {
    ...base,
    ...next,
    printing: {
      ...base.printing,
      ...(next.printing || {}),
      barra: { ...base.printing?.barra, ...(next.printing?.barra || {}) },
      cocina: { ...base.printing?.cocina, ...(next.printing?.cocina || {}) },
      ticketFinal: { ...base.printing?.ticketFinal, ...(next.printing?.ticketFinal || {}) }
    }
  };
}

function loadDb() {
  return safeJsonRead(DB_PATH, defaultDb());
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function loadConfig() {
  return mergeConfig(defaultConfig(), safeJsonRead(CONFIG_PATH, defaultConfig()));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function safeJsonRead(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFile(filePath, contents) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, contents, 'utf8');
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);
  const client = { res };
  clients.add(client);
  req.on('close', () => clients.delete(client));
}

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(data);
    } catch {}
  }
}

function queueDispatchSoon() {
  setTimeout(() => {
    dispatchPending(5).catch(() => {});
  }, 150);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function createCommandJobs(body) {
  const lines = Array.isArray(body.lineas || body.lines) ? (body.lineas || body.lines) : [];
  const byRole = { barra: [], cocina: [], pizzas: [] };
  for (const raw of lines) {
    const item = normalizeCommandLine(raw);
    if (!item) continue;
    const destino = String(raw.destino || raw.destination || 'barra').toLowerCase();
    if (destino === 'cocina' || destino === 'ambos') byRole.cocina.push(item);
    if (destino === 'pizzas' || destino === 'ambos') byRole.pizzas.push(item);
    if (destino === 'barra' || destino === 'ambos' || !['barra', 'cocina', 'pizzas', 'ambos'].includes(destino)) byRole.barra.push(item);
  }

  return ['barra', 'cocina', 'pizzas']
    .filter(role => byRole[role].length)
    .map(role => ({
      id: createJobId(role),
      kind: 'comanda',
      role,
      status: 'pending',
      createdAt: Date.now(),
      mesaId: String(body.mesaId || ''),
      mesaNombre: String(body.mesaNombre || body.tableName || ''),
      camarero: String(body.camarero || body.waiter || ''),
      payload: { lineas: byRole[role] },
      error: '',
      printedAt: null,
      printingAt: null
    }));
}

function createTicketJob(body) {
  const lines = Array.isArray(body.lineas || body.lines) ? (body.lineas || body.lines) : [];
  return {
    id: createJobId('ticket_final'),
    kind: 'ticket_final',
    role: 'ticket_final',
    status: 'pending',
    createdAt: Date.now(),
    mesaId: String(body.mesaId || ''),
    mesaNombre: String(body.mesaNombre || body.tableName || ''),
    camarero: String(body.camarero || body.waiter || ''),
    ticketMeta: body.ticketMeta && typeof body.ticketMeta === 'object' ? {
      esReimpresion: body.ticketMeta.esReimpresion === true,
      fechaVentaOriginal: String(body.ticketMeta.fechaVentaOriginal || ''),
      fechaReimpresion: String(body.ticketMeta.fechaReimpresion || '')
    } : null,
    payload: {
      total: roundMoney(body.total || 0),
      cobro: body.cobro ? {
        recibido: roundMoney(body.cobro.recibido || body.paid || 0),
        cambio: roundMoney(body.cobro.cambio || body.change || 0)
      } : (body.paid ? {
        recibido: roundMoney(body.paid || 0),
        cambio: roundMoney(body.change || 0)
      } : null),
      lineas: lines.map(normalizeTicketLine).filter(Boolean)
    },
    error: '',
    printedAt: null,
    printingAt: null
  };
}

function normalizeCommandLine(raw) {
  const qty = Number(raw.qty || raw.quantity || 0);
  const nombre = String(raw.nombre || raw.name || '').trim();
  if (!nombre || qty <= 0) return null;
  return {
    nombre,
    qty,
    precio: roundMoney(raw.precio || raw.unitPrice || 0),
    nota: String(raw.nota || raw.notes || '').trim()
  };
}

function normalizeTicketLine(raw) {
  const qty = Number(raw.qty || raw.quantity || 0);
  const nombre = String(raw.nombre || raw.name || '').trim();
  if (!nombre || qty <= 0) return null;
  return {
    nombre,
    qty,
    precio: roundMoney(raw.precio || raw.unitPrice || 0),
    nota: String(raw.nota || raw.notes || '').trim()
  };
}

function createJobId(role) {
  return `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function dispatchPending(limit) {
  if (dispatching) return { printed: 0, errors: [] };
  dispatching = true;
  const errors = [];
  let printed = 0;

  try {
    for (let i = 0; i < limit; i++) {
      const db = loadDb();
      const next = db.jobs
        .filter(job => job.status === 'pending')
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0];
      if (!next) break;

      const result = await printSingleJob(next.id);
      if (result.ok) printed += 1;
      else errors.push({ jobId: next.id, error: result.error || 'Error desconocido' });
    }
  } finally {
    dispatching = false;
  }

  return { printed, errors };
}

async function printSingleJob(jobId) {
  const db = loadDb();
  const job = db.jobs.find(item => item.id === jobId);
  if (!job) return { ok: false, error: 'Trabajo no encontrado.' };

  job.status = 'printing';
  job.printingAt = Date.now();
  job.error = '';
  saveDb(db);
  broadcast({ type: 'jobs', jobs: db.jobs });

  try {
    const config = resolvePrintConfig(job.role);
    if (!config.enabled) {
      throw new Error(`La impresión para ${job.role} está desactivada.`);
    }

    const filePath = writeTempReceipt(job);
    await runPrintScript(filePath, config);

    job.status = 'printed';
    job.printedAt = Date.now();
    job.printingAt = null;
    job.error = '';
    saveDb(db);
    broadcast({ type: 'jobs', jobs: db.jobs });
    return { ok: true, job };
  } catch (error) {
    job.status = 'error';
    job.error = error.message || String(error);
    job.printingAt = null;
    saveDb(db);
    broadcast({ type: 'jobs', jobs: db.jobs });
    return { ok: false, error: job.error, job };
  }
}

function resolvePrintConfig(role) {
  const printing = loadConfig().printing || {};
  if (role === 'ticket_final') return printing.ticketFinal || defaultConfig().printing.ticketFinal;
  if (role === 'cocina') return printing.cocina || defaultConfig().printing.cocina;
  if (role === 'pizzas') return printing.pizzas || defaultConfig().printing.pizzas;
  return printing.barra || defaultConfig().printing.barra;
}

function writeTempReceipt(job) {
  const tempPath = path.join(DATA_DIR, `${job.id}.txt`);
  fs.writeFileSync(tempPath, renderReceipt(job), 'utf8');
  return tempPath;
}

function renderReceipt(job) {
  const lines = [];
  const fecha = new Date(job.createdAt || Date.now());
  const fechaTxt = fecha.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  if (job.role === 'ticket_final') {
    lines.push(`[[CENTER_TITLE]]Mesa ${job.mesaNombre || ''}`.trim());
  } else {
    lines.push(`[[LEFT_META]]${job.role === 'cocina' ? 'COCINA' : 'BARRA'} - Mesa ${job.mesaNombre || ''}`.trim());
  }

  if (job.camarero) lines.push(`[[LEFT_SUBTITLE]]Camarero: ${job.camarero}`);
  const meta = job.ticketMeta || {};
  if (meta.esReimpresion && meta.fechaVentaOriginal) {
    lines.push(`[[LEFT_SUBTITLE]]Venta original: ${meta.fechaVentaOriginal}`);
    lines.push(`[[LEFT_SUBTITLE]]Reimpresión: ${meta.fechaReimpresion || fechaTxt}`);
  } else {
    lines.push(`[[LEFT_SUBTITLE]]${fechaTxt}`);
  }
  lines.push('--------------------------------');

  for (const item of job.payload.lineas || []) {
    lines.push(`${Number(item.qty || 0)}x ${item.nombre || ''}`.trim());
    if (item.nota) lines.push(`[[ITALIC]]-> ${item.nota}`);
    if (job.role === 'ticket_final') {
      const totalLinea = roundMoney(Number(item.qty || 0) * Number(item.precio || 0));
      lines.push(`[[RAW]]${Number(item.qty || 0)} x ${roundMoney(item.precio || 0).toFixed(2)} EUR ${totalLinea.toFixed(2)} EUR`);
    }
  }

  if (job.role === 'ticket_final') {
    lines.push('--------------------------------');
    lines.push(`TOTAL ${roundMoney(job.payload.total || 0).toFixed(2)}`);
    if (job.payload.cobro) {
      lines.push(`PAGO ${roundMoney(job.payload.cobro.recibido || 0).toFixed(2)}`);
      lines.push(`CAMBIO ${roundMoney(job.payload.cobro.cambio || 0).toFixed(2)}`);
    }
  }

  lines.push('');
  lines.push('');
  return lines.join(os.EOL);
}

function runPrintScript(filePath, cfg) {
  return new Promise((resolve, reject) => {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', PRINT_SCRIPT,
      '-FilePath', filePath,
      '-Paper', String(cfg.paper || '58mm'),
      '-FontSize', String(Number(cfg.fontSize || 9))
    ];

    if (cfg.printerName) {
      args.push('-PrinterName', String(cfg.printerName));
    }
    if (cfg.uppercase === true) {
      args.push('-Uppercase');
    }

    const child = spawn('powershell.exe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell salió con código ${code}`));
    });
  });
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
