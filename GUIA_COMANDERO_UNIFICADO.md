# Comandero unificado: guía de uso y arquitectura

## Qué se ha creado

Se han añadido estos archivos nuevos, sin modificar `camarero.html`, `camarero.js`, `camareronew2.html`, `camareronew2.js` ni `camareroTPV.html`:

| Archivo | Función |
| --- | --- |
| `comandero.html` | Interfaz única de Sala y TPV, sin iframe. |
| `comandero.js` | Lógica única derivada de la versión que ya contiene todas las mejoras TPV. |
| `manifest-comandero.webmanifest` | Manifiesto PWA propio. |
| `sw-comandero.js` | Caché propia, separada de las versiones antiguas. |

Los archivos existentes siguen siendo respaldo operativo. Por eso se puede probar Comandero sin interrumpir al personal que utilice las páginas antiguas.

## Cómo abrir cada modo

### Sala / camarero normal

Abrir:

```text
comandero.html
```

Comportamiento:

- Muestra el acceso actual de Firebase por correo.
- Mantiene mesas, carta, pedidos, cobros, historial, impresión y el resto de la lógica común.
- No carga la bandeja ni las personalizaciones visuales TPV.

### TPV de barra

Abrir:

```text
comandero.html?modo=tpv
```

Comportamiento:

- No solicita contraseña.
- Abre directamente carta, cuadrícula y una cuenta temporal TPV.
- Activa por defecto la cuenta a la derecha en pantallas de 768 px o más.
- En móvil conserva la barra superior y usa el diseño adaptado.
- Incluye edición controlada (`✎ Editar` / `✓ Listo`), conservación del scroll, aparcados, cobro, impresión, últimos tickets y aviso persistente de Desarrollo.

## Advertencia de seguridad actual

El acceso TPV es deliberadamente directo durante esta fase de prueba. Cualquier persona que conozca la URL `comandero.html?modo=tpv` y tenga acceso a la aplicación podría abrir la interfaz TPV.

No es todavía una restricción por equipo. No se usa QR ni emparejamiento de dispositivos, por decisión expresa para mantener únicamente la autenticación Firebase por correo en Sala.

La siguiente mejora recomendada, cuando se decida activarla, es ampliar la API loopback ya existente del worker Python (`psVF.exe`) con una comprobación en `127.0.0.1`. El navegador TPV solicitaría esa comprobación antes de arrancar. Así el modo TPV solo funcionaría en el PC donde esté activo el supervisor/worker, sin contraseña diaria ni QR. Esa mejora requiere compilar y distribuir un nuevo `psVF.exe`; no se ha tocado el worker ni el supervisor en esta fase.

## Dependencias reales

`comandero.js` importa las mismas dependencias funcionales que las aplicaciones actuales:

- `firebase.js`: conexión y autenticación técnica Firebase.
- `auth-email.js`: inicio de sesión de Sala por correo.
- `verifacti.js`: facturación y datos fiscales.
- Servicio Python `psVF.exe` / supervisor `psV2.exe`: impresión configurada mediante Firebase `print_jobs`.

No depende de `local-network-server.js`. Puede conservar código opcional histórico para red local heredada, pero la ruta operativa usada para imprimir es el servicio Python.

## Qué se consolidó desde las variantes anteriores

`comandero.js` parte de `camareronew2.js`, ya que contiene el conjunto más amplio de funciones respecto a `camarero.js`, incluyendo:

- modo TPV, cuenta temporal y aparcados;
- cuenta lateral con dos líneas por artículo;
- edición con bloqueo de controles ajenos;
- conservación del scroll de artículos;
- botón de imprimir protegido contra doble pulsación;
- efectivo con importe exacto si queda vacío, sugerencias de billetes y cambio;
- cobrar, imprimir y nueva cuenta;
- aviso persistente administrado desde Desarrollo;
- últimos tickets paginados de cinco en cinco y reimpresión.

La personalización visual que antes se inyectaba desde `camareroTPV.html` se ha incorporado como CSS condicionado por `html[data-modo="tpv"]`. Ya no se necesita un iframe para que Comandero tenga el diseño TPV.

## Pruebas antes de cambiar accesos existentes

Realizar estas pruebas con cuentas de prueba o en un momento sin servicio:

1. Abrir `comandero.html` y comprobar acceso por correo, mesas, carta y envío de una comanda.
2. Abrir `comandero.html?modo=tpv`; confirmar que no pide contraseña y que inicia carta/cuadrícula/cuenta derecha.
3. Añadir suficientes artículos para crear scroll; editar el último, sumar y restar. La lista no debe volver arriba.
4. Comprobar que fuera de `Editar` no se pueden modificar las líneas y que durante edición se bloquean las demás acciones.
5. Probar efectivo sin importe (debe considerarse exacto), un billete sugerido, tarjeta y `Cobrar, imprimir y nueva`.
6. Abrir `📋 Últimos`, pasar páginas y reimprimir un ticket.
7. Desde `desarrollador.html`, enviar y retirar un aviso de cada nivel; debe llegar al TPV sin recarga.
8. Verificar la impresión real con el worker Python, incluidos los casos de reimpresión.

## Después de validar

Solo cuando las pruebas anteriores estén correctas:

1. Convertir `camareroTPV.html` en un lanzador hacia `comandero.html?modo=tpv`.
2. Decidir si `camarero.html` debe continuar como aplicación antigua o redirigir al modo normal de `comandero.html`.
3. Añadir la comprobación loopback del supervisor si se quiere limitar TPV al equipo local.
4. Limpiar las opciones de seguridad heredadas en Desarrollo: bloqueo global de camareros, QR/emparejamiento, acceso de encargado y emojis. Antes de eliminarlas del código, confirmar que ninguna instalación usa `encargado.html` o PIN/emojis; sus datos Firebase pueden conservarse sin mostrarse.
5. Mantener las variantes antiguas hasta disponer de una copia recuperable y haber trabajado varios días con Comandero sin incidencias.

## Caché y publicación

La nueva aplicación utiliza `sw-comandero.js`, con un nombre de caché distinto de las variantes antiguas. Tras publicar cambios en Netlify, F5 carga normalmente la versión nueva; `Ctrl + F5` fuerza la descarga sin caché. No se ha añadido recarga automática para no interrumpir una cuenta abierta.
