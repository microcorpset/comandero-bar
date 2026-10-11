# Checklist · instalación de un comercio nuevo

Esta es la instalación reducida: sala, gerencia móvil, barra y cocina. No se
incluyen `admin.html`, `admins.html`, `encargado.html` ni sus JavaScript.

> Regla de oro: un comercio = un proyecto Firebase distinto. Nunca se copian
> los datos, usuarios ni credenciales de otro local.

## 1. Crear la carpeta de publicación

Copiar desde el repositorio base estos archivos y carpetas:

| Necesario para | Archivos |
|---|---|
| Sala | `camarero.html`, `camarero.js`, `manifest-camarero.webmanifest` |
| Gerencia móvil | `gerentemovil.html`, `gerentemovil.js`, `manifest-gerentemovil.webmanifest` |
| Barra | `barra.html`, `barra.js`, `manifest-barra.webmanifest` |
| Cocina | `cocina.html`, `manifest-cocina.webmanifest` |
| Firebase y acceso | `firebase.js`, `auth-email.js` |
| Facturación / cierres | `verifacti.js`, `facturas-completas.js` |
| Dependencia de Gerencia | `qrcode.mjs` |
| Instalación como app | carpeta completa `icons/` |

No copiar a esa publicación:

- `admin.html`, `admin.js`, `admins.html`, `admins.js`.
- `encargado.html`, `encargado.js`.
- Copias de seguridad, exportaciones de Firebase, archivos `.rar`, carpetas
  `BACKUP/`, `build/`, `dist/` ni datos de otros comercios.

## 2. Crear y configurar Firebase

- [ ] Crear un proyecto Firebase nuevo, con un nombre identificable del local.
- [ ] Crear una **Realtime Database** en la región más cercana.
- [ ] Registrar una app web dentro de ese proyecto.
- [ ] En **Authentication → Sign-in method**, activar
  **Correo electrónico/contraseña**.
- [ ] Mantener desactivado el vínculo de correo sin contraseña.
- [ ] En **Authentication → Settings → Authorized domains**, añadir el dominio
  real donde se publica la app. Se escribe solo el host, por ejemplo:
  `comandas.local.com`, sin `https://` ni ruta.
- [ ] Para pruebas locales, añadir también `localhost` y `127.0.0.1`.
- [ ] Copiar la configuración web de ese proyecto en `firebase.js`.
- [ ] Revisar que `databaseURL` corresponde a la base de ese comercio, no a la
  de otro proyecto.

## 3. Adaptar el dominio permitido por la aplicación

En `camarero.js` y `barra.js`, añadir el host de publicación al array
`_dominiosPermitidos`.

Ejemplo para `comandas.local.com`:

```js
const _dominiosPermitidos = [
  'comandas.local.com',
  'localhost',
  '127.0.0.1'
];
```

- [ ] No incluir `https://`, puertos ni rutas.
- [ ] Si se usa una IP fija dentro de la red del local, añadir esa IP también
  tanto aquí como en **Authorized domains** de Firebase.

## 4. Crear las cuentas iniciales

En **Firebase Authentication → Users** crear las cuentas con su propio correo
y contraseña. No reutilizar una cuenta entre empleados.

Después, en **Realtime Database → Data**, crear un perfil por UID en:

```text
config
└── authUsuarios
    └── UID_DE_FIREBASE
        ├── nombre: "Nombre visible"  → Texto
        ├── rol: "..."                → Texto
        └── activo: true               → Booleano
```

Perfiles mínimos antes de publicar:

- [ ] Dueño/gerente: `rol: "gerente"` o `rol: "dueno"`.
- [ ] Desarrollador técnico, solo cuando proceda: `rol: "desarrollador"`.
- [ ] Cada camarero: `rol: "camarero"`.
- [ ] Todos los perfiles iniciales tienen `activo: true` como booleano, no
  como texto.

Solo `desarrollador`, `administrador`, `gerente` y `dueno` abren
`gerentemovil.html`. Solo `camarero` abre `camarero.html`.

## 5. Reglas de Realtime Database — revisión obligatoria

- [ ] Antes de abrir el local, revisar la pestaña **Rules** de Realtime
  Database.
- [ ] Confirmar que no quedan reglas abiertas como `.read: true` o
  `.write: true`.
- [ ] Confirmar que un camarero no puede escribir su propio `rol` ni cambiar
  `activo` a `true`.
- [ ] Confirmar que Gerencia puede leer los perfiles necesarios para listar y
  activar/desactivar camareros.
- [ ] Probar las reglas con una cuenta de camarero y con una cuenta de
  gerencia antes de cerrar el acceso público.

**Importante:** no pegar las reglas antiguas de `GUIA_NUEVO_LOCAL.md` ni una
regla genérica `auth != null`. Parte de las pantallas heredadas aún usan
autenticación anónima y esas reglas no distinguen roles. Las reglas finales se
deben aplicar cuando estén cubiertos todos los módulos que se publiquen para
ese comercio.

## 6. Configuración inicial del local

Desde `gerentemovil.html`, con la cuenta de gerencia:

- [ ] Crear las zonas, plano y mesas.
- [ ] Crear categorías y artículos de la carta.
- [ ] Revisar precio, destino de cada artículo (barra, cocina o ambos) y
  disponibilidad.
- [ ] Configurar los datos fiscales y la numeración solo si se utilizará
  VERI*FACTU/facturación.
- [ ] Comprobar fecha, moneda e identidad visible del local.
- [ ] Crear y activar únicamente los camareros que trabajarán ese turno.

## 7. Publicar y probar

- [ ] Subir la carpeta de publicación completa al dominio del comercio.
- [ ] Abrir `gerentemovil.html`: iniciar con la cuenta de gerencia, recargar y
  comprobar que conserva la sesión.
- [ ] Abrir `camarero.html`: iniciar con una cuenta de camarero y comprobar
  que una cuenta de gerencia no entra aquí.
- [ ] Desactivar ese camarero desde Gerencia y verificar que Sala pierde el
  acceso; volver a activarlo y verificar que puede volver a entrar.
- [ ] Iniciar la misma cuenta de camarero en un segundo teléfono y comprobar
  que la sesión anterior se cierra.
- [ ] Crear una comanda de prueba y confirmar que llega a `barra.html`.
- [ ] Abrir `cocina.html` y confirmar que recibe solo los artículos de cocina.
- [ ] Cerrar una mesa de prueba y revisar el cierre/reimpresión.
- [ ] Instalar las PWA necesarias y repetir una prueba después de cerrar y
  volver a abrir cada una.

## 8. Entrega al local

- [ ] Entregar al dueño/gerente la URL de `gerentemovil.html`.
- [ ] Explicar que activar/desactivar un camarero se hace desde esa pantalla;
  no se borran cuentas para retirarle el acceso.
- [ ] Entregar a cada empleado la URL o PWA de `camarero.html`.
- [ ] Guardar, fuera del repositorio, una copia privada de los UID y correos
  de gerencia.
- [ ] Guardar una exportación de Realtime Database del local antes de la
  apertura y después de una configuración importante.

## Incidencias frecuentes

| Síntoma | Revisar |
|---|---|
| `auth/unauthorized-domain` | Añadir el host exacto a Authorized domains. |
| `Acceso no autorizado` | Añadir el host exacto a `_dominiosPermitidos`. |
| La cuenta inicia sesión pero Sala/Gerencia no abre | Perfil inexistente o `rol`/`activo` con tipo o valor incorrecto. |
| Pide contraseña tras cada recarga | Abrir desde el mismo dominio, no incógnito, y no borrar datos de la PWA/navegador. |
| No aparece una mejora reciente | Cerrar la PWA, recargar forzado y comprobar que se han publicado todos los `.js` dependientes. |
