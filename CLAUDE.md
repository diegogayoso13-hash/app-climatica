# Tu Faro (app-climatica)

## Cómo hablar con el usuario
- Responder siempre en español rioplatense, claro y sin tecnicismos; el usuario no es programador.

## Reglas de la app (no romper)
- No cambiar NUNCA el nombre ni la ubicación de `docs/sw.js` (ni el alcance con que se registra). La suscripción a los avisos al celular está atada a ese archivo: si cambia, se pierden las suscripciones de todos los celulares.
- En cada versión nueva: subir `VERSION` en `docs/sw.js` y `VERSION_APP` en `docs/app.js` con el mismo número, y probar antes de publicar que la suscripción a avisos sigue igual después de actualizar.
- Pestañas de abajo: Tiempo · Canal · Mapa · Más. El mapa es una pestaña propia y ocupa todo entre la barra de arriba y las pestañas (no se desliza).
- GPS: se prende SOLO con el botón del pin (nunca solo al abrir la app ni el mapa). El pin nunca lo apaga: prendido, centra en tu posición. Se apaga solo con el botón "Apagar GPS" del detalle del cartel de posición, o al cerrar la app. Sigue andando al cambiar de pestaña (puntito en la pestaña Mapa).
- Con el GPS prendido la app nunca se recarga para actualizarse (ni sola ni tocando el cartel de versión nueva).
