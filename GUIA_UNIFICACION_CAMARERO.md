# Guía de unificación: una sola aplicación de camarero con modo TPV

## Objetivo

Dejar una única aplicación mantenible en `camarero.html` y `camarero.js`, conservando dos formas de entrada:

- `camarero.html`: modo camarero normal, con el flujo de acceso actual.
- `camareroTPV.html`: lanzador mínimo que abre `camarero.html?modo=tpv`, sin pantalla de inicio de sesión y con la interfaz TPV.

El lanzador no será una segunda aplicación ni contendrá CSS o JavaScript de negocio. Su única responsabilidad será fijar el modo TPV y mantener la URL histórica que usan los dispositivos.

## Decisión arquitectónica

No copiar más cambios entre `camarero.html`, `camareronew2.html` y `camareronew3.html`. El resultado debe tener:

| Responsabilidad | Archivo final |
| --- | --- |
| Estructura HTML compartida | `camarero.html` |
| Lógica y Firebase compartidos | `camarero.js` |
| Estilos comunes y variantes de modo | CSS de `camarero.html` o un CSS común si se extrae |
| Acceso TPV sin login | `?modo=tpv` leído por `camarero.js` |
| URL de compatibilidad | `camareroTPV.html` redirige a `camarero.html?modo=tpv` |
| Gestión de aviso persistente | `desarrollador.html` / `desarrollador.js` y Firebase `config/tpvAviso` |

`camareronew2.html` debe usarse solo como referencia funcional durante la migración. No debe seguir siendo la base de producción al terminar.

## Comportamiento de los modos

### Modo normal: `camarero.html`

- Conserva el login, las barras y el diseño móvil actual.
- Conserva todas las funciones existentes de comandas, mesas, carta, impresión y Firebase.
- No activa automáticamente ninguna personalización TPV.

### Modo TPV: `camarero.html?modo=tpv`

- Omite la pantalla de login mediante una comprobación interna y explícita de `modo=tpv`; no mediante un truco de iframe ni una variable global inyectada después de cargar.
- Arranca por defecto con la carta en vista cuadrícula.
- Arranca por defecto con `Cuenta →`: cuenta lateral derecha y altura completa en escritorio/tablet.
- En pantalla estrecha recupera la barra superior y adapta la cuenta a un diseño móvil legible; nunca debe dejar controles inaccesibles.
- La cuenta lateral muestra cada línea en dos filas: nombre/editable arriba; precio, cantidad y botones menos/más debajo.
- Los artículos de la cuenta solo se editan tras pulsar `✎ Editar`. En edición debe distinguirse visualmente y los controles ajenos a la cuenta deben estar bloqueados. `✓ Listo` termina la edición.
- Al cambiar cantidad, nombre o precio se conserva la posición de scroll de la lista de la cuenta.
- `Imprimir ticket` ofrece retroalimentación temporal y se bloquea brevemente para evitar doble pulsación.
- En el cobro en efectivo, una cantidad vacía significa importe exacto. Se ofrecen billetes sugeridos y existe una acción de cobrar, imprimir con cambio y abrir cuenta nueva.
- El aviso de `config/tpvAviso` se visualiza solo en este modo y nunca puede cerrarlo el camarero.

## Migración segura por fases

### 1. Inventario antes de editar

1. Crear una copia de seguridad o un commit de los archivos actuales.
2. Comparar `camarero.html`/`camarero.js` con `camareronew2.html`/`camareronew2.js`.
3. Hacer una lista de funciones que existen en cada versión: autenticación, selección de mesas, pedidos, carta, cobro, aparcados, impresión, configuraciones, responsive y Firebase.
4. Considerar `camareronew2` como la fuente de las mejoras TPV ya verificadas, no como un archivo para pegar entero sobre `camarero`.

### 2. Crear un selector de modo único

Al comienzo de `camarero.js`, crear una configuración inmutable:

```js
const params = new URLSearchParams(window.location.search);
const modo = params.get('modo') === 'tpv' ? 'tpv' : 'camarero';
const esTPV = modo === 'tpv';
document.documentElement.dataset.modo = modo;
```

Todas las decisiones deben depender de `esTPV` o de `data-modo="tpv"`. Evitar `window.__tpvBarKiosco` y evitar que otra página modifique el documento después de cargado.

### 3. Trasladar primero la base funcional

Mantener el HTML y JS de `camarero.html` como tronco principal. Incorporar desde `camareronew2` únicamente las funciones que falten, una a una, sin duplicar listeners de Firebase ni handlers de botones.

Prioridad:

1. Arranque y autenticación.
2. Carga de categorías, productos, pedidos y mesas.
3. Bandeja/cuenta, persistencia del carrito y aparcados.
4. Cobro, cierre e impresión.
5. Mejoras exclusivas TPV.

Tras cada bloque, probar ambos modos antes de continuar.

### 4. Integrar el diseño TPV como CSS condicionado

Mover el CSS que actualmente inyecta `camareroTPV.html` a `camarero.html`. Prefijarlo con:

```css
html[data-modo="tpv"] { /* reglas solo TPV */ }
html[data-modo="tpv"].cuenta-derecha { /* cuenta lateral */ }
```

No usar un iframe para inyectar reglas ni sobrescribir métodos DOM globales. La cuenta lateral debe ser un componente normal del HTML y la lógica de render debe conservar directamente `scrollTop` antes de actualizar sus líneas.

Regla responsive recomendada:

- A partir de 768 px: cuenta lateral fija con alto útil completo y lista interior desplazable.
- Por debajo de 768 px: diseño móvil; cabecera visible y sin una bandeja lateral que reduzca la carta hasta hacerla inutilizable.

### 5. Implementar la cuenta lateral de forma explícita

La función de render de la cuenta debe:

1. Guardar `scrollTop` de la lista.
2. Actualizar solo las líneas necesarias o volver a renderizar.
3. Restaurar el valor guardado mediante `requestAnimationFrame`.
4. No ejecutar `scrollIntoView`, focus automático ni reset de scroll al sumar/restar.

El estado de edición se guarda en una variable única, por ejemplo `estadoCuenta.editando`. No se debe inferir por el foco de un input.

Al activar edición:

- Habilitar nombre, precio y cantidad de las líneas.
- Resaltar la bandeja, el botón y los campos editables.
- Bloquear pulsaciones en carta, navegación, cobro, imprimir y acciones externas.

Al pulsar `Listo`:

- Persistir cualquier cambio pendiente.
- Desbloquear el resto de acciones.
- Mantener el scroll exacto de la lista.

No bloquear el teclado físico/teclado de Windows: al enfocar un campo de edición debe poder utilizarse con normalidad.

### 6. Migrar cobro e impresión sin regresiones

Conservar una única función de cierre de venta. Debe recibir las líneas y el total antes de limpiar el carrito, para que la variante «cobrar, imprimir y nueva cuenta» imprima el ticket correcto.

Para efectivo:

- Campo vacío = total exacto.
- Botones de importes sugeridos: elegir los billetes inmediatamente superiores al total (por ejemplo, para 6 €, mostrar 10 €; para más de 10 €, 20 €).
- Mostrar cambio solo si procede.

Para impresión:

- Deshabilitar temporalmente el botón y mostrar «Imprimiendo…» o una animación breve.
- En modo TPV, evitar imprimir el texto/hora de apertura de una mesa temporal como «Mesa TPV». Sí debe mantenerse la fecha/hora real de impresión.

### 7. Llevar el aviso persistente al núcleo

El aviso se guarda por local en Firebase:

```text
config/tpvAviso
  activo: true | false
  texto: string
  tipo: "info" | "warning" | "urgent"
  actualizadoEn: timestamp
```

`desarrollador.js` lo administra únicamente después de seleccionar el local y debe rotular de forma visible el destino («TPV de [nombre del local]»).

`camarero.js` se suscribe a esa ruta solo en modo TPV. El mensaje no contiene botón de cierre; desaparece solo cuando Desarrollo lo retire. Sus tres estilos son:

- Información: azul.
- Atención: amarillo.
- Urgente: rojo.

Colocarlo sin tapar la bandeja lateral ni los botones de cobro. En escritorio lateral, preferir zona inferior del área central o una posición calculada fuera de la cuenta; en móvil, fijarlo de forma que no oculte la acción primaria.

### 8. Reducir `camareroTPV.html` a lanzador

Al haber verificado el modo unificado, sustituir el iframe y las inyecciones por un redireccionamiento mínimo:

```html
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=camarero.html?modo=tpv">
<script>location.replace('camarero.html?modo=tpv');</script>
```

Opcionalmente puede conservar una pantalla de carga durante el redireccionamiento. No debe duplicar CSS, Firebase ni lógica de TPV.

No eliminar todavía `camareronew2.html` hasta terminar la validación y disponer de una copia/commit recuperable.

## Pruebas obligatorias

### Arranque y compatibilidad

- Abrir `camarero.html`: comprobar login y flujo normal.
- Abrir `camareroTPV.html`: comprobar redirección y ausencia de login.
- Abrir directamente `camarero.html?modo=tpv`.
- Probar una pantalla ancha y un móvil/viewport estrecho.

### Cuenta TPV

- Verificar que cuadrícula y cuenta derecha se activan por defecto.
- Añadir más artículos de los que caben en pantalla.
- Bajar al último elemento, sumar/restar y editar: la lista no puede volver arriba.
- Comprobar que fuera de Editar no hay inputs o botones modificables y que el texto del artículo se lee en negro puro.
- Activar Editar y confirmar que el resto de controles se bloquea; pulsar Listo y confirmar que vuelven.

### Cobro e impresión

- Efectivo vacío con total de 6 €: cierre correcto con importe recibido de 6 € y cambio 0 €.
- Pulsar una sugerencia de billete y comprobar cambio.
- Probar tarjeta.
- Pulsar impresión rápidamente dos veces: debe salir una sola acción.
- Probar «cobrar, imprimir y nueva cuenta» y revisar el ticket.
- Verificar que ticket TPV no muestre una hora artificial de apertura de «Mesa TPV».

### Aviso de desarrollador

- Sin local seleccionado, el panel no debe aparecer.
- Seleccionar un local: debe indicar el destino correcto.
- Enviar cada nivel y comprobar que el TPV abierto cambia en tiempo real sin F5.
- Retirar: el aviso desaparece en ese local, no en los otros.
- Comprobar que el aviso no tapa la cuenta lateral ni se puede cerrar desde TPV.

## Publicación y caché en Netlify

Al publicar, un TPV que ya está abierto no descarga por sí solo el HTML/JS nuevo: F5 obtiene normalmente la nueva versión y `Ctrl + F5` fuerza una recarga sin caché. Los datos Firebase, como el aviso, sí se actualizan en vivo porque mantienen su suscripción.

Cuando la unificación esté estable, añadir versionado a scripts y, si existe un service worker, una estrategia clara de actualización. No introducir recarga automática mientras haya pedidos/cuentas sin proteger, porque podría interrumpir el trabajo de un camarero.

## Criterio de terminado

La migración está terminada únicamente cuando `camarero.html`/`camarero.js` son la única fuente de lógica de camarero, `camareroTPV.html` es solo un lanzador sin iframe, ambos modos pasan las pruebas anteriores y las versiones antiguas quedan archivadas como respaldo, no como rutas activas.
