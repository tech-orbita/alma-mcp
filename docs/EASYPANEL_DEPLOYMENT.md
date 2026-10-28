# Despliegue en Hostinger VPS con EasyPanel

Este es un procedimiento de entrega; no fue ejecutado en esta entrega.

## Prerrequisitos

- VPS Hostinger actualizado y EasyPanel operativo.
- Repositorio GitHub privado con este proyecto (este checkout no se subió).
- dominio previsto `mcp.<dominio-del-cliente>` apuntando al VPS;
- URL/token de pruebas ALMA autorizados;
- secretos aleatorios independientes;
- ventana de cambio, snapshot y responsable de rollback.

## Red y firewall Hostinger

Permitir públicamente:

- TCP 80 para validación/redirección HTTP;
- TCP 443 para HTTPS;
- SSH únicamente desde IPs administrativas conocidas, con llaves, sin contraseña si la política lo permite.

No publicar 3000 ni 5432 en el firewall. EasyPanel hace proxy interno al puerto 3000. PostgreSQL permanece privado.

## PostgreSQL en EasyPanel

1. Crear un servicio PostgreSQL 18 compatible.
2. No asignar dominio ni puerto público.
3. Crear base/usuario exclusivos para `alma-mcp`.
4. Activar volumen persistente.
5. Configurar backups automáticos y retención acordada.
6. Ejecutar una restauración de prueba antes del go-live.
7. Guardar `DATABASE_URL` como secreto de la App Service.

## App Service desde GitHub/Dockerfile

1. Crear Project y luego App Service.
2. Conectar el repositorio y rama de release.
3. Elegir build desde `Dockerfile` en la raíz.
4. Puerto interno/proxy: `3000`.
5. Healthcheck: `/ready`, HTTP, éxito esperado 200.
6. Réplicas: `1` en la primera versión, porque las sesiones MCP son locales al proceso.
7. Recursos iniciales sugeridos: 0.5-1 vCPU, 512 MB-1 GB RAM; ajustar con métricas reales.
8. Mantener el comando de imagen: aplica migraciones y luego inicia la app.

No desplegar `compose.yaml` completo en producción: contiene un mock ALMA y valores locales. EasyPanel debe tener servicios separados App + PostgreSQL.

## Variables y secretos

Variables no secretas:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
TRUST_PROXY=1
ALLOWED_HOSTS=mcp.dominio-cliente.com,127.0.0.1,localhost
ALMA_BASE_URL=https://url-autorizada-alma.example/api/
ALMA_TIMEOUT_MS=8000
ALMA_READ_RETRIES=2
ALMA_TIMEZONE=America/Bogota
SLOT_TOKEN_TTL_SECONDS=300
DATABASE_SSL_MODE=disable
DB_POOL_MAX=10
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
MCP_SESSION_TTL_MS=1800000
MCP_MAX_SESSIONS=1000
JSON_BODY_LIMIT=256kb
SHUTDOWN_GRACE_MS=10000
```

Secrets de EasyPanel:

- `MCP_BEARER_TOKEN` (mínimo 32 caracteres aleatorios);
- `ALMA_API_TOKEN`;
- `SLOT_TOKEN_SECRET` (mínimo 32, distinto de ambos tokens);
- `DATABASE_URL`.

No use placeholders ni secretos de Compose.

## Dominio y HTTPS

1. Crear registro DNS A/AAAA para `mcp.<dominio>` hacia el VPS.
2. En EasyPanel, asociar el dominio a la App Service.
3. Emitir certificado automático y forzar HTTPS.
4. Verificar que `/health` y `/ready` responden sin cabeceras/valores secretos.
5. Verificar que `/mcp` sin Bearer devuelve 401 y con Bearer acepta `initialize`.
6. Confirmar que el proxy conserva `Authorization`, `Accept`, `Mcp-Session-Id` y `MCP-Protocol-Version`, y permite `POST`, `GET`, `DELETE`.

## Primera publicación

1. Tomar snapshot del VPS y backup PostgreSQL.
2. Desplegar commit/tag conocido.
3. Revisar logs de migración; no deben incluir URL/token.
4. Confirmar `/ready` 200.
5. Ejecutar una prueba MCP de lectura desde un cliente controlado.
6. Usar ALMA temporal y datos desechables para cualquier mutación autorizada.
7. Solo después configurar HighLevel.

## Observabilidad mínima

Alertar por:

- `/ready` 503;
- tasa de 5xx/429;
- `RESULTADO_MUTACION_INCIERTO`, `PERSISTENCIA_MUTACION_INCIERTA`;
- crecimiento de `pending`/`uncertain`;
- pool PostgreSQL agotado;
- reinicios o memoria alta;
- expiración TLS/backups fallidos.

## Backup y rollback

Antes de cada release: backup DB, snapshot VPS/EasyPanel y tag de imagen/commit.

Rollback de aplicación:

1. Deshabilitar temporalmente herramientas de mutación en HighLevel si hay riesgo.
2. Redeploy del último commit/imagen aprobado.
3. No revertir migraciones destructivamente. La migración inicial solo crea tablas.
4. Verificar `/ready`, conexión MCP y lecturas.
5. Reconciliar operaciones `pending`/`uncertain` antes de reactivar mutaciones.

Si la DB está dañada, crear servicio de restauración separado desde backup, validar y cambiar `DATABASE_URL` durante una ventana. No sobreescribir el volumen original sin evidencia y aprobación.
