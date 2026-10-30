# Herramientas MCP

## Salida común

Todas las herramientas responden:

```json
{
  "ok": true,
  "operation": "listar_servicios",
  "message": "Servicios consultados.",
  "data": {},
  "error": null,
  "meta": {
    "correlation_id": "uuid",
    "cached": false,
    "timezone": "America/Bogota"
  }
}
```

Un error mantiene la misma forma, usa `ok: false`, `data: null`, `isError: true` en MCP y un objeto `error` con `code`, `message`, `retryable` y detalles seguros opcionales.

## Herramientas de lectura

### `listar_sucursales`

Entrada `{}`. Devuelve sucursales activas. Uso administrativo para identificar registros; no permite verificar la dirección y no debe llamarse durante cada conversación. El usuario confirmó que Amsterdam Plaza corresponde a ID numérico 1.

### `listar_servicios`

Entrada opcional `{ "page": 1 }`. Devuelve servicios paginados.

### `listar_especialistas`

Entrada `{ "servicio_id": 10, "page": 1 }`. `servicio_id` es obligatorio.

### `buscar_cliente`

Entrada `{ "identificacion": "123456789" }`. No sustituir documento por teléfono, correo o nombre.

### `consultar_disponibilidad`

```json
{
  "sucursal_id": 1,
  "servicio_id": 10,
  "fecha": "2026-08-10",
  "especialista_id": 25,
  "page": 1
}
```

Cada resultado agrega `slot_token`. El agente debe conservar el token opaco sin editarlo, no mostrarlo al cliente y usarlo una sola vez al crear/reagendar. Si expira, se consulta disponibilidad de nuevo.

### `consultar_citas`

Acepta `cita_id`, `cliente_id`, `documento`, `fecha`, `estado`, `page`. Exige al menos un filtro distinto de página.

## Mutaciones

### `crear_cita`

Cliente existente:

```json
{
  "tipo_cliente": "existente",
  "cliente_id": 50,
  "slot_token": "...",
  "idempotency_key": "contact-abc-create-intent-001",
  "confirmacion": true,
  "observacion": "Opcional"
}
```

Cliente nuevo:

```json
{
  "tipo_cliente": "nuevo",
  "tipo_identificacion": "CC",
  "identificacion": "123456789",
  "nombre": "Carlos",
  "apellido": "Lopez",
  "telefono": "3001234567",
  "correo": "cliente@correo.com",
  "slot_token": "...",
  "idempotency_key": "contact-abc-create-intent-001",
  "confirmacion": true
}
```

La confirmación debe ocurrir después de mostrar sucursal, servicio, especialista, fecha y hora. No interpretar silencio o una respuesta ambigua como confirmación.

### `reagendar_cita`

```json
{
  "cita_id": 100,
  "slot_token": "...",
  "idempotency_key": "appointment-100-reschedule-intent-001",
  "confirmacion": true,
  "observacion": "Cambio solicitado por cliente"
}
```

El servidor consulta la cita actual antes del `PUT`, rechaza citas inexistentes/canceladas y serializa cita + slot.

### `cancelar_cita`

```json
{
  "cita_id": 100,
  "idempotency_key": "appointment-100-cancel-intent-001",
  "confirmacion": true,
  "motivo": "Cliente solicita cancelación"
}
```

El servidor verifica la cita antes del `DELETE`. Es destructiva y requiere confirmación explícita.

## Claves de idempotencia

- 16-128 caracteres: letras, números, `.`, `_`, `:`, `-`.
- Deben identificar la intención, no cada intento técnico.
- Reutilice exactamente la misma clave y payload cuando HighLevel repita la misma llamada.
- No incluya nombre, documento, correo, teléfono ni token.
- Nunca genere una clave nueva para sortear `IDEMPOTENCIA_EN_REVISION` o `RESULTADO_MUTACION_INCIERTO`.

## Orden recomendado

Crear: servicio real (catálogo paginado si es necesario) -> especialistas para ese servicio -> disponibilidad con sede previamente verificada -> datos necesarios -> resumen/confirmación explícita del servicio y horario -> crear. Consultar cliente solo cuando haga falta. No repetir lecturas sin necesidad. Tras éxito confirmado, activar Cita creada solo cuando el nuevo flujo exista y esté configurado.

Reagendar: localizar cita -> disponibilidad -> resumen/confirmación -> reagendar -> consultar cita.

Cancelar: localizar cita -> resumen/confirmación -> cancelar -> comunicar resultado.
