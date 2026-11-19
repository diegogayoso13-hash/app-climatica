# Tu Faro (app-climatica)

## Cómo hablar con el usuario
- Responder siempre en español rioplatense, claro y sin tecnicismos; el usuario no es programador.

## Reglas de la app (no romper)
- No cambiar NUNCA el nombre ni la ubicación de `docs/sw.js` (ni el alcance con que se registra). La suscripción a los avisos al celular está atada a ese archivo: si cambia, se pierden las suscripciones de todos los celulares.
- En cada versión nueva: subir `VERSION` en `docs/sw.js` y `VERSION_APP` en `docs/app.js` con el mismo número, y probar antes de publicar que la suscripción a avisos sigue igual después de actualizar.
