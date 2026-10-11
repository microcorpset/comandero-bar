# Contexto y prompt para una conversación futura

Copia y pega este texto al iniciar una conversación nueva:

---

Estoy trabajando en `C:\Users\Jon\Desktop\comanderoVF`. Quiero unificar mi aplicación de camarero sin romper funciones existentes. Antes de editar, lee completamente `GUIA_UNIFICACION_CAMARERO.md` de la raíz del proyecto y sigue ese plan.

Contexto esencial:

- Quiero que `camarero.html` y `camarero.js` sean la única aplicación real y sostenible.
- `camareroTPV.html` debe mantenerse como URL/lanzador compatible, pero al final solo debe abrir o redirigir a `camarero.html?modo=tpv`; no debe tener iframe, CSS inyectado ni lógica duplicada.
- El modo normal conserva el login y el comportamiento actual de camarero.
- El modo `?modo=tpv` no pide login y debe iniciar en cuadrícula y con `Cuenta →` activa: cuenta lateral derecha a altura completa en escritorio.
- En móvil o pantallas estrechas el modo TPV debe conservar la barra superior y un diseño utilizable.
- En TPV cada artículo de la cuenta se organiza en dos líneas: nombre arriba; precio y controles de cantidad abajo.
- Debe existir `✎ Editar` / `✓ Listo`: fuera de edición los artículos no se pueden cambiar, el estado debe verse claramente, y durante edición los demás botones de la interfaz quedan deshabilitados. No bloquear el teclado físico/Windows al editar un input.
- Si la lista de cuenta es larga, sumar, restar, editar nombre o precio nunca debe devolver el scroll arriba ni mover el usuario de su elemento actual.
- Imprimir ticket necesita animación o bloqueo breve contra doble pulsación.
- Cobro en efectivo: si no se escribe cantidad se interpreta como importe justo; ofrecer billetes sugeridos; incluir acción «cobrar, imprimir y nueva cuenta» mostrando cambio.
- En ticket TPV no debe imprimirse una hora artificial de apertura de «Mesa TPV». La fecha/hora real de impresión sí debe permanecer.
- `desarrollador.html` permite enviar un aviso persistente al TPV del local seleccionado. Ruta Firebase: `config/tpvAviso`; tipos `info`, `warning`, `urgent`. No aparece en Desarrollo hasta elegir local y debe indicar el local destino. En TPV el aviso se actualiza en tiempo real, no puede cerrarlo el camarero y solo desaparece cuando se retira desde Desarrollo.

Estado actual antes de unificar:

- `camareroTPV.html` es un iframe que carga `camareronew2.html` y le inyecta estilos/comportamiento TPV. Es temporal y hay que eliminar esa arquitectura al finalizar.
- Las mejoras TPV existentes están principalmente en `camareronew2.html` y `camareronew2.js`.
- `camarero.html` y `camarero.js` representan la ruta normal que debe convertirse en tronco único, comprobando primero las diferencias funcionales.
- Hay archivos históricos (`camareronew.html`, `camareronew2.html`, `camareronew3.html`, copias): no borrarlos ni sobrescribirlos sin una confirmación explícita. Úsalos como referencia y respaldo.
- El repositorio puede tener cambios no relacionados: revísalos y no uses `git reset --hard`, ni descartes modificaciones ajenas.
- Antes de una migración grande, crea una copia recuperable/commit y realiza cambios por fases con pruebas en ambos modos.

Restricciones de trabajo:

- No des por hecho que una página Netlify abierta se actualizará sola: F5 carga normalmente la publicación nueva; Ctrl+F5 fuerza la caché. Firebase sí actualiza el aviso en vivo.
- No implemente recarga automática de la aplicación sin proteger posibles comandas abiertas.
- Evita duplicar listeners Firebase, handlers o funciones de cobro al migrar.
- Comprueba la sintaxis con `node --check` y prueba manualmente los flujos indicados en la guía.

Empieza por hacer un inventario y comparación de ambas variantes, explícame qué trasladarás y después implementa de forma incremental. No elimines versiones antiguas hasta que el modo normal y TPV estén validados.

---

## Archivos que debe leer la futura conversación

1. `GUIA_UNIFICACION_CAMARERO.md`.
2. `camarero.html` y `camarero.js`.
3. `camareroTPV.html`.
4. `camareronew2.html` y `camareronew2.js`.
5. `desarrollador.html` y `desarrollador.js` para el aviso TPV.
