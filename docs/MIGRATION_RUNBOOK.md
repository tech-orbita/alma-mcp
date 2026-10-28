# Runbook de migración: Conversation AI -> SuperAgent + MCP

## Principios

- Sin n8n.
- Sin mutaciones reales antes de credenciales, entorno desechable y autorización explícita.
- Canary antes de cortar el bot existente.
- Rollback preparado y verificable.
- Un HTTP 200 o un test de conexión aislado no equivale a operación productiva correcta.

## Fase 0 - Preparación

- [ ] Dueño técnico y dueño operativo asignados.
- [ ] Inventario de flujos/copy/handoff del bot actual.
- [ ] Métricas base: conversaciones, agendamientos, errores, transferencias.
- [ ] URL/token ALMA temporal y datos de prueba.
- [ ] Zona horaria confirmada por ALMA/cliente.
- [ ] Ventana, comunicación y rollback aprobados.
- [ ] Política de PII/retención aprobada.

## Fase 1 - Infraestructura

- [ ] PostgreSQL privado, backup y restauración probada.
- [ ] App desplegada desde commit/tag conocido.
- [ ] DNS/HTTPS válido.
- [ ] Firewall 80/443; SSH restringido; 3000/5432 no públicos.
- [ ] `/health` y `/ready` correctos.
- [ ] `/mcp` sin Bearer = 401.
- [ ] Lectura MCP controlada desde cliente técnico.
- [ ] Snapshot y evidencia de rollback.

## Fase 2 - Gate HighLevel

- [x] La UI muestra Custom MCP y Custom APIs (confirmación del usuario).
- [ ] Custom MCP configurado con HTTP Streamable + Bearer MCP.
- [ ] `Test Connection` exitoso.
- [ ] Nueve herramientas descubiertas.
- [ ] Permisos inicialmente solo de lectura.
- [ ] Prompt revisado después de la generación automática.

Si alguno falla, Conversation AI permanece activo y no se habilitan mutaciones.

## Fase 3 - Certificación ALMA desechable

Con autorización explícita:

- [ ] sucursales/servicios/especialistas/cliente;
- [ ] disponibilidad y paginación;
- [ ] crear y consultar cita;
- [ ] replay con misma clave, sin duplicado;
- [ ] dos llamadas concurrentes, sin doble reserva;
- [ ] reagendar y confirmar consulta posterior;
- [ ] cancelar y confirmar estado;
- [ ] slot vencido/manipulado/consumido;
- [ ] cita inexistente/ya cancelada;
- [ ] timeout de lectura y de mutación;
- [ ] reconciliación de operación incierta;
- [ ] contenido real del envelope/campos comparado contra el PDF.

Eliminar o identificar claramente los datos de prueba según indicación del proveedor.

## Fase 4 - Canary

1. Mantener Conversation AI como ruta principal/rollback.
2. Activar SuperAgent para un segmento pequeño y controlable, sugerido 5% o equipo interno.
3. Habilitar lecturas primero durante al menos un ciclo operacional acordado.
4. Habilitar creación con supervisión humana.
5. Habilitar reagendar/cancelar después de evidencias de creación estable.
6. Revisar diariamente conversaciones muestreadas, auditoría mínima y ALMA.

Métricas mínimas:

- éxito por herramienta;
- errores por código;
- `pending`/`uncertain`;
- duplicados en ALMA (objetivo cero);
- reservas incorrectas;
- transferencias humanas;
- latencia p50/p95;
- quejas/incidentes de PII.

## Fase 5 - Ampliación

Escalar 5% -> 25% -> 50% -> 100% solo si cada etapa cumple durante el periodo acordado:

- cero duplicados/acciones sin confirmar;
- cero exposición de secretos;
- operaciones inciertas reconciliadas dentro del SLA;
- tasa de éxito/latencia aceptable;
- rollback probado y bot anterior disponible.

## Cutover

Antes de desactivar Conversation AI:

- [ ] aprobación técnica, operativa y negocio;
- [ ] 100% canary estable;
- [ ] soporte/guardia informado;
- [ ] backup/snapshot recientes;
- [ ] prompt y permisos exportados/capturados sin secretos;
- [ ] contacto ALMA disponible;
- [ ] rollback practicado.

Desactivar el bot anterior, no borrarlo. Vigilar intensivamente el primer ciclo.

## Rollback

Triggers sugeridos:

- duplicado o acción sin confirmación;
- error sistemático de autenticación/herramientas;
- PII/secreto expuesto;
- `uncertain` no reconciliable;
- caída sostenida de ALMA/DB/app;
- desviación significativa de negocio.

Pasos:

1. Deshabilitar herramientas de mutación o conexión MCP.
2. Reactivar/rutear a Conversation AI.
3. Conservar evidencias y snapshot; no borrar operaciones.
4. Consultar ALMA y reconciliar `pending`/`uncertain`.
5. Corregir en staging, repetir pruebas y obtener nueva aprobación.

Nunca resolver un incidente reintentando masivamente con claves nuevas.
