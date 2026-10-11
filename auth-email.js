import { auth } from './firebase.js';
import {
  browserLocalPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signOut,
  signInWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

function mensajeError(error) {
  const code = error?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Correo o contraseña incorrectos.';
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera unos minutos.';
  if (code.includes('network-request-failed')) return 'No se pudo conectar. Comprueba tu conexión.';
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
}

function escapeHtml(valor) {
  return String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Renderiza una única pantalla de acceso reutilizable. La autorización real
// (rol, activo y dispositivo) queda deliberadamente en cada aplicación.
export function iniciarAccesoCorreo({ contenedor, titulo, subtitulo, alAutenticar, alSalir }) {
  let ultimoUid = null;

  const mostrarFormulario = (mensaje = '') => {
    contenedor.style.display = 'flex';
    contenedor.innerHTML = `
      <div style="width:min(360px,calc(100% - 36px));box-sizing:border-box;padding:28px 24px;border-radius:18px;background:#16213a;color:#fff;box-shadow:0 18px 55px rgba(0,0,0,.42);font-family:Arial,sans-serif">
        <div style="font-size:22px;font-weight:800;text-align:center;margin-bottom:8px">${titulo}</div>
        <div style="font-size:13px;line-height:1.45;color:#bdc9dc;text-align:center;margin-bottom:20px">${subtitulo}</div>
        <form id="form-acceso-correo" style="display:flex;flex-direction:column;gap:12px">
          <input id="acceso-correo" type="email" autocomplete="username" inputmode="email" placeholder="Correo electrónico" required style="box-sizing:border-box;width:100%;border:1px solid #45608b;border-radius:9px;padding:12px;background:#0e1729;color:#fff;font-size:16px">
          <input id="acceso-clave" type="password" autocomplete="current-password" placeholder="Contraseña" required style="box-sizing:border-box;width:100%;border:1px solid #45608b;border-radius:9px;padding:12px;background:#0e1729;color:#fff;font-size:16px">
          <div id="acceso-error" style="min-height:18px;color:#ff9a9a;font-size:12px;text-align:center">${mensaje}</div>
          <button type="submit" id="acceso-entrar" style="border:0;border-radius:9px;padding:12px;background:#cfff4d;color:#0b1324;font-weight:800;font-size:15px;cursor:pointer">Entrar</button>
          <button type="button" id="acceso-recuperar" style="border:0;background:transparent;color:#b8cfff;font-size:12px;cursor:pointer;text-decoration:underline">He olvidado la contraseña</button>
        </form>
      </div>`;

    const form = contenedor.querySelector('#form-acceso-correo');
    const email = contenedor.querySelector('#acceso-correo');
    const password = contenedor.querySelector('#acceso-clave');
    const error = contenedor.querySelector('#acceso-error');
    const entrar = contenedor.querySelector('#acceso-entrar');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      entrar.disabled = true;
      entrar.textContent = 'Comprobando…';
      error.textContent = '';
      try {
        await setPersistence(auth, browserLocalPersistence);
        await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
      } catch (err) {
        error.textContent = mensajeError(err);
        entrar.disabled = false;
        entrar.textContent = 'Entrar';
      }
    });
    contenedor.querySelector('#acceso-recuperar').addEventListener('click', async () => {
      const direccion = email.value.trim();
      if (!direccion) { error.textContent = 'Escribe primero tu correo electrónico.'; email.focus(); return; }
      try {
        await sendPasswordResetEmail(auth, direccion);
        error.style.color = '#cfff4d';
        error.textContent = 'Te hemos enviado un correo para restablecer la contraseña.';
      } catch (err) {
        error.style.color = '#ff9a9a';
        error.textContent = mensajeError(err);
      }
    });
  };

  const mostrarSesion = (user, mensaje = '') => {
    const correo = escapeHtml(user.email || 'Cuenta sin correo');
    const aviso = mensaje || 'No necesitas cerrar sesión al terminar. El gerente puede activar o desactivar tu acceso para cada turno.';
    contenedor.style.display = 'flex';
    contenedor.innerHTML = `
      <div style="width:min(360px,calc(100% - 36px));box-sizing:border-box;padding:28px 24px;border-radius:18px;background:#16213a;color:#fff;box-shadow:0 18px 55px rgba(0,0,0,.42);font-family:Arial,sans-serif">
        <div style="font-size:22px;font-weight:800;text-align:center;margin-bottom:8px">${titulo}</div>
        <div style="font-size:13px;line-height:1.45;color:#bdc9dc;text-align:center;margin-bottom:20px">${subtitulo}</div>
        <div style="border:1px solid #45608b;border-radius:10px;background:#0e1729;padding:14px;margin-bottom:14px;text-align:center">
          <div style="font-size:11px;color:#bdc9dc;margin-bottom:5px">SESIÓN INICIADA</div>
          <div style="font-size:15px;font-weight:700;overflow-wrap:anywhere">${correo}</div>
        </div>
        <div style="min-height:36px;font-size:12px;line-height:1.45;color:${mensaje ? '#ffb1b1' : '#bdc9dc'};text-align:center;margin-bottom:16px">${escapeHtml(aviso)}</div>
        <button type="button" id="acceso-cerrar-sesion" style="width:100%;border:1px solid #6a7f9f;border-radius:9px;padding:11px;background:transparent;color:#fff;font-size:14px;cursor:pointer">Cambiar de cuenta</button>
        <div id="acceso-confirmar-salida" hidden style="margin-top:14px;border:1px solid #a77c42;border-radius:10px;background:#251d13;padding:14px">
          <div style="font-weight:800;font-size:14px;margin-bottom:7px">¿Cerrar sesión?</div>
          <div style="font-size:12px;line-height:1.45;color:#f0d6aa;margin-bottom:14px">No hace falta cerrar sesión al acabar: el gerente puede desactivar tu cuenta para este turno. Hazlo solo si vas a entrar con otra cuenta en este teléfono.</div>
          <div style="display:flex;gap:8px">
            <button type="button" id="acceso-cancelar-salida" style="flex:1;border:1px solid #6a7f9f;border-radius:8px;padding:10px;background:transparent;color:#fff;cursor:pointer">Cancelar</button>
            <button type="button" id="acceso-confirmar-salida-btn" style="flex:1;border:0;border-radius:8px;padding:10px;background:#e6a23c;color:#17110a;font-weight:800;cursor:pointer">Cerrar sesión</button>
          </div>
        </div>
      </div>`;

    const confirmar = contenedor.querySelector('#acceso-confirmar-salida');
    contenedor.querySelector('#acceso-cerrar-sesion').addEventListener('click', () => { confirmar.hidden = false; });
    contenedor.querySelector('#acceso-cancelar-salida').addEventListener('click', () => { confirmar.hidden = true; });
    contenedor.querySelector('#acceso-confirmar-salida-btn').addEventListener('click', async event => {
      const boton = event.currentTarget;
      boton.disabled = true;
      boton.textContent = 'Cerrando…';
      try {
        await signOut(auth);
      } catch (err) {
        boton.disabled = false;
        boton.textContent = 'Cerrar sesión';
        confirmar.querySelector('div:nth-child(2)').textContent = mensajeError(err);
      }
    });
  };

  const mostrar = (mensaje = '') => {
    const user = auth.currentUser;
    if (user && !user.isAnonymous) {
      mostrarSesion(user, mensaje);
      return;
    }
    mostrarFormulario(mensaje);
  };

  onAuthStateChanged(auth, user => {
    if (!user || user.isAnonymous) {
      ultimoUid = null;
      alSalir?.();
      mostrar();
      return;
    }
    if (user.uid === ultimoUid) return;
    ultimoUid = user.uid;
    alAutenticar(user, mostrar);
  });

  mostrar();
  return { mostrar };
}
