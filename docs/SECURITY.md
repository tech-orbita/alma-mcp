# Seguridad

## Activos protegidos

- token Bearer de entrada MCP;
- token de salida ALMA;
- secreto HMAC de slots;
- credenciales PostgreSQL;
- PII devuelta por clientes/citas;
- integridad de creación, reagendamiento y cancelación.

## Controles

### Autenticación y transporte

- `/mcp` solo acepta `Authorization: Bearer` exacto, comparado en tiempo constante.
- El Bearer MCP debe ser independiente del token ALMA.
- Producción exige HTTPS hacia ALMA y EasyPanel debe terminar HTTPS para HighLevel.
- `ALLOWED_HOSTS` protege contra DNS rebinding. Debe incluir el dominio público y hosts de healthcheck explícitos.
- No hay credenciales en query strings.

Un Bearer estático es apropiado para la primera integración servidor-a-servidor, pero no ofrece identidad por usuario. Si el servidor se comparte entre subcuentas se debe implementar autenticación/autoridad por tenant antes de hacerlo multi-tenant.

### Validación y minimización

- Variables de entorno validadas al iniciar.
- Zod estricto para entrada, envelope y respuestas documentadas.
- Body máximo configurable, rate limit por IP y máximo de sesiones.
- Rutas ALMA constantes: una llamada MCP no puede elegir host/ruta arbitraria (mitiga SSRF).
- Consultas de citas requieren un filtro.
- Los errores no devuelven stack, request body ni mensajes de red crudos.

### Mutaciones

- Confirmación literal `true` en el esquema; el prompt exige confirmación humana previa.
- Slots HMAC con TTL, zona horaria, nonce y consumo único.
- Verificación de cita antes de editar/cancelar.
- Idempotencia persistente y conflicto de payload.
- Advisory locks para contacto/cita/slot.
- Cero retries automáticos en mutaciones.
- Estado `uncertain` bloquea repeticiones después de timeout/red.

### PII, logs y auditoría

Los logs de aplicación solo registran operación, ruta constante, status, intento, duración, correlación y códigos seguros. La utilidad de redacción cubre token, secreto, documento, identificación, teléfono, correo, nombre, apellido, observación y motivo.

`audit_events` no contiene conversaciones, prompts, tokens ni datos de contacto. `mutation_operations.response` solo persiste la respuesta mínima necesaria para reproducir idempotencia; en las mutaciones documentadas contiene IDs/estado/fecha/hora, no el objeto completo de cliente.

Defina una política de retención antes de producción. Propuesta inicial: auditoría 180 días, operaciones idempotentes 30-90 días según ventana de reintento y obligaciones contractuales. No hay job automático porque el periodo no fue entregado por el cliente.

### Base de datos

- PostgreSQL solo en red privada de EasyPanel.
- Usuario exclusivo con privilegios limitados a su base/esquema.
- Backups cifrados y prueba de restauración.
- `DATABASE_SSL_MODE=require` si la conexión sale de una red privada confiable.
- La migración usa advisory lock y checksum; un archivo aplicado no puede cambiar silenciosamente.

### Contenedor y proceso

- Imagen exacta `node:24.18.0-alpine3.23`.
- Multi-stage; dependencias dev fuera de runtime.
- Usuario `node`, `no-new-privileges` en Compose y proceso init.
- Apagado ordenado y timeouts HTTP.
- Healthchecks sin secretos.

## Dependencias

Las dependencias directas están fijadas y el lockfile fija transitivas. `@modelcontextprotocol/node@2.0.0` declara `@hono/node-server` 1.x; esa línea tiene una alerta de path traversal en `serve-static`. El proyecto fuerza `@hono/node-server@2.1.0`, que conserva `getRequestListener`, único API usado por el adaptador MCP. El flujo completo se prueba después del override y `npm audit --omit=dev` no reporta vulnerabilidades en esta entrega.

Este override debe revisarse cuando el SDK oficial publique una versión que acepte Hono 2.x de forma nativa; no actualizarlo a ciegas.

## Amenazas residuales

| Riesgo | Mitigación actual | Pendiente |
|---|---|---|
| Bearer filtrado | Secrets + logs redactados + TLS | Rotación y revocación operacional |
| Replay de mutación | Idempotencia + slot consumido | Confirmar ventana/retención |
| Resultado incierto | Estado bloqueante | Endpoint/proceso ALMA de reconciliación |
| Doble reserva entre contactos | Lock por slot + validación ALMA | Prueba contra ALMA real |
| PII en respuesta al modelo | Filtros y permisos MCP | Políticas HighLevel/retención del proveedor |
| Sesión perdida en redeploy | Cliente reinicializa | Probar comportamiento HighLevel |
| Múltiples réplicas | Desaconsejadas inicialmente | Afinidad o sesiones compartidas |

## Rotación de secretos

1. Crear nuevo secreto en el sistema de secretos, nunca en Git.
2. Para MCP, coordinar ventana breve: actualizar EasyPanel y luego HighLevel; probar conexión.
3. Para ALMA, actualizar EasyPanel después de recibir token nuevo y probar solo lecturas primero.
4. Para slots, cambiar el secreto invalida tokens emitidos; hacerlo en ventana controlada.
5. No registrar valores anteriores/nuevos en tickets o capturas.

## Respuesta a incidentes

- Revocar/rotar token comprometido.
- Deshabilitar conexión MCP o herramientas de mutación en HighLevel.
- Conservar logs/auditoría mínimos y snapshot de DB.
- Consultar operaciones `pending`/`uncertain` y reconciliar con ALMA por ID/cliente/fecha.
- No reintentar mutaciones masivamente.
- Documentar alcance, timestamps y acciones sin copiar PII innecesaria.
