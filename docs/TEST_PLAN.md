# Plan de pruebas

## Objetivo

Demostrar que el servidor respeta el contrato documentado, protege mutaciones y habla MCP Streamable HTTP sin llamar a ALMA real durante CI/local.

## Automatización actual

Comandos obligatorios:

```powershell
npm.cmd install
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
docker compose config --quiet
```

Cobertura implementada (27 casos):

- URL con/sin `/api`, prefijo y rechazo de rutas inseguras;
- Bearer exacto y configuración de secretos/HTTPS/timezone;
- envelope exitoso, error ALMA y respuesta inválida;
- schemas estrictos, confirmación literal y consulta filtrada;
- slot firmado, manipulado, vencido y fingerprint;
- redacción de PII/secretos;
- retries de lectura y cero retries de mutación;
- JSON inválido;
- idempotencia, conflicto, slot consumido y estado incierto;
- `/health`, `/ready`, auth MCP;
- inicialización y descubrimiento exacto de nueve herramientas;
- ALMA simulado por HTTP;
- disponibilidad -> slot -> crear -> replay cacheado;
- doble creación concurrente;
- ejecución por MCP del flujo completo de las nueve herramientas;
- cierre `DELETE` de sesión.

## PostgreSQL/Compose

Cuando Docker Engine esté disponible:

```powershell
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://127.0.0.1:3000/ready
docker compose exec postgres psql -U alma_mcp -d alma_mcp -c "select filename, applied_at from schema_migrations;"
docker compose exec postgres psql -U alma_mcp -d alma_mcp -c "select count(*) from mutation_operations;"
docker compose down
```

No use `docker compose down -v` salvo autorización para borrar el volumen local. En esta entrega `compose config` pasó, pero Docker Engine no estaba iniciado; por eso no se afirma ejecución real de PostgreSQL/contenedores.

## Certificación con ALMA temporal

Solo con autorización y tenant/dataset desechable:

| Área | Caso positivo | Caso negativo |
|---|---|---|
| Auth | token válido | ausente/expirado/incorrecto |
| Listas | datos y paginación | página extrema |
| Cliente | documento existente/no existente | formato inválido |
| Disponibilidad | con/sin especialista | IDs/fecha inválidos |
| Crear | cliente existente/nuevo | slot ocupado/expirado |
| Consultar | cada filtro | sin coincidencia |
| Reagendar | nuevo slot | cita cancelada/cruce |
| Cancelar | con/sin motivo | inexistente/ya cancelada |
| Concurrencia | misma clave/payload | otra clave mismo slot |
| Fallos | lectura 503 recuperable | timeout mutación incierto |

Guardar evidencia sanitizada: timestamp, código de prueba, request ID, códigos/estado y conteos. No capturar tokens ni PII real.

## Certificación HighLevel

- Test Connection con URL HTTPS.
- Auth Bearer correcta/incorrecta.
- Descubrimiento exacto y permisos.
- Llamada de cada lectura.
- Confirmación antes de mutaciones.
- Clave estable en repetición.
- No mostrar `slot_token`, IDs o errores internos al cliente.
- Handoff ante resultado incierto.
- Persistencia de sesión tras varias llamadas y reinicialización tras redeploy.

## Seguridad

- Host no permitido -> 403.
- Origin no permitido cuando se configure allowlist -> 403.
- body excesivo -> 413.
- rate limit -> 429 con Retry-After.
- inputs extra/incorrectos -> error de herramienta.
- revisión de logs sin PII/token.
- escaneo de imagen/dependencias.
- restauración de backup.
- prueba de rotación Bearer y secreto de slots.

## Go/No-Go

No-Go automático si hay duplicados, acción sin confirmación, exposición de secretos/PII, campos ALMA incompatibles sin adaptar, operaciones inciertas sin reconciliación, Postgres público/sin backup, TLS inválido o descubrimiento incompleto.

Local/static no demuestra éxito remoto. El acta de aceptación debe separar resultados de código, contenedores, ALMA, HighLevel y hosting.
