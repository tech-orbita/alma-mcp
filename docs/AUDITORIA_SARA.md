# Auditoría y guía para Sara — 30 de octubre de 2026

## Hallazgos y límites

1. **Sede confirmada por el usuario:** Amsterdam Plaza corresponde a `OMM BEAUTY LAB S.A.S.`, ID `1`. El servidor local rechaza otras sedes en disponibilidad, creación y reagendamiento, y verifica la sede de la cita antes de modificarla o cancelarla. Esto no protege aún la lectura privada de citas por otras sedes ni verifica identidad. Alma no admite parámetro de sede al listar servicios.
2. **P0: privacidad y autorización.** `buscar_cliente`, `consultar_citas`, `reagendar_cita` y `cancelar_cita` no autentican a la persona titular; un documento o `confirmacion: true` no prueban identidad. No habilitar acceso a citas existentes ni cambios/cancelaciones hasta contar con verificación externa confiable y su vínculo con cada llamada. `consultar_citas` admite filtros amplios. Un token MCP compartido tampoco distingue usuarios.
3. **P0: creación real no demostrada.** El historial no muestra `crear_cita`; no se puede atribuir el fallo a ALMA. Ver Action Execution History, argumentos y resultado de cada llamada, configuración de acciones GHL y si el modelo conserva el token y la clave exactos. No repetir con datos reales sin autorización.
4. **P1: catálogos y especialistas.** La lectura real de todas las páginas no contiene el nombre exacto «masaje corporal»; sí `Masaje de relajación` (122, 60 min) y `Masaje relajacion o reflexiologia` (152, 30 min). No son equivalentes automáticamente. Para ambos, la API devolvió los mismos 13 registros, incluso recepción y una cuenta comercial. El endpoint no indica sucursal ni el conjunto de servicios por especialista; pedir al proveedor que aclare la relación. La disponibilidad es la evidencia para un servicio, sede y fecha concretos, no garantía de reserva.
5. **P1: datos temporales.** El token HMAC vence por defecto a los 300 segundos y el historial tardó varios minutos. La expiración no demuestra que el cupo se haya ocupado. Una consulta nueva puede cambiar resultados; nunca ofrecer horarios anteriores como si fueran actuales. Si se renueva un token, verificar que corresponda a la misma opción confirmada, o solicitar nueva confirmación si cambió.
6. **P1: lecturas redundantes.** El prompt y la descripción anterior ordenaban buscar sucursales; servicios se volvió a consultar aunque ya estaba identificado. El flujo solicitado incluye especialistas antes de disponibilidad, aunque la API no exige esa consulta como parámetro previo. El resultado está paginado: servicios 50 y disponibilidad 10 por página; `next` indica más resultados.
7. **P1: fallos de escritura.** Una respuesta inválida o 5xx posterior al POST/PUT/DELETE puede ocultar un éxito real. Se cambia la clasificación local a resultado incierto y se bloquea repetición automática con la misma clave. Reconciliar con ALMA antes de cualquier nuevo intento. No se garantiza deduplicación al cambiar la clave o renovar token.
8. **P1: idempotencia tiene límites.** Se valida expiración antes de consultar el registro idempotente; una repetición del resultado exitoso con token vencido puede fallar. Los bloqueos usan fingerprint del token aleatorio, no identidad estable del horario; tokens distintos para el mismo horario no se serializan entre sí. La prevención definitiva de conflictos depende de ALMA. Pendiente reforzar y probar contra PostgreSQL real.
9. **P2: observabilidad y sesiones.** Hay UUID por herramienta, logs sin payload y tiempos HTTP solo en debug; el request ID HTTP no se propaga a ALMA ni al registro de auditoría. Las sesiones y limitación de frecuencia son locales al proceso; un reinicio las invalida y varias réplicas requieren afinidad/estado compartido. Los reintentos GET con timeout 8 s y dos reintentos pueden superar 24 s; contrastar timeouts del proxy. `fetch failed` puede ocurrir en distintos saltos y no hay evidencia para asignar causa.
10. **P2: validación y errores.** Los esquemas Zod son estrictos y la salida usa envoltura uniforme. Errores de argumentos rechazados por el SDK antes del handler podrían no usar esa envoltura; comprobar en GHL. Fecha valida formato, no calendario ni fecha futura; política comercial vive en prompt/KB. Las respuestas estrictas pueden rechazar campos adicionales o nulos reales.

## Arquitectura

Node 24/TypeScript, Express + MCP Streamable HTTP, Bearer, Helmet y rate limit; `ToolService` dirige nueve herramientas a `AlmaClient` HTTP con token ALMA. PostgreSQL guarda idempotencia, consumo de tokens y auditoría; `/ready` consulta DB. Tokens de horarios HMAC firmados incluyen sede, servicio, especialista, fecha, horas, expiración y nonce. Lecturas se reintentan de forma limitada; escrituras no. Migración `001_initial.sql`; Docker aplica migraciones al arrancar. Ver `ARCHITECTURE.md`, `SECURITY.md`, `API_CONTRACT.md` y `MCP_TOOLS.md` para contratos y operación. Las descripciones completas y schemas publicados están en `src/mcp/server.ts` y `src/tools/schemas.ts`; no se cambian nombres ni parámetros.

## Flujo recomendado para copiar al prompt de Sara

Reemplazar las instrucciones contradictorias que obligan a listar sucursales en cada reserva. Mantener la consulta de especialistas antes de disponibilidad. Conservar personalidad, KB, restricciones comerciales y escalamiento del prompt original. No pegar esto hasta verificar las capacidades GHL y las protecciones pendientes:

```text
Atiende solo Amsterdam Plaza. Su ID operativo confirmado es 1; envía sucursal_id como número 1 al consultar disponibilidad. Nunca llames listar_sucursales en conversaciones; no ofrezcas otras sedes.

Identifica el servicio exacto en listar_servicios y conserva su ID durante esta conversación. Revisa páginas siguientes solo si hace falta; si no aparece, no lo inventes. Si el nombre pedido no coincide exactamente, puedes presentar una opción relacionada identificada en Alma, nombrándola claramente; no afirmes que es idéntica ni la reserves sin confirmación explícita del cliente. Verifica la política comercial en KB.

Después de identificar el servicio, consulta listar_especialistas con su ID. Esta lista por sí sola no prueba que el registro atienda en esta sede o fecha. Luego consulta consultar_disponibilidad con sede, servicio y fecha; añade especialista_id solo si hay una preferencia identificada. Presenta el nombre exacto del servicio y únicamente los profesionales y horarios que devuelva la disponibilidad. Si el cliente pidió un nombre diferente, presenta el servicio relacionado como opción y confirma que lo desea antes de reservar.

Conserva servicio, fecha, especialista, hora y slot_token exacto devuelto. No repitas consultas de catálogo mientras los datos sigan siendo aplicables. Si cambian servicio, fecha, especialista u hora, usa la disponibilidad correspondiente; no ofrezcas opciones anteriores como actuales. Un token vencido requiere consultar de nuevo. Una fecha sin cupos no significa que la sede esté cerrada.

Cuando la persona elija un horario, recoge solo datos necesarios, resume servicio, profesional, fecha, hora y sede y solicita confirmación explícita. Tras una respuesta afirmativa, llama crear_cita con confirmacion=true, slot_token vigente y los datos exigidos por su schema; usa una clave de idempotencia estable, única y sin datos personales. Si el token expiró, renueva disponibilidad del mismo horario; si ya no existe, ofrece solamente opciones actuales. No confirmes reserva sin ok=true de crear_cita. Ante resultado incierto no cambies la clave ni vuelvas a intentar: escala para reconciliar.

Para consultar o reagendar una cita existente exige verificación de identidad aprobada y asociada a la operación. Si no está disponible, escala. Tras identificar la cita autorizada consulta el nuevo horario, resume y solicita confirmación; después llama reagendar_cita con el nuevo token y clave estable. Un documento conocido no verifica identidad.

Nunca ejecutes Lead listo para agendar. Sara gestiona la reserva directamente. Solo después de que crear_cita devuelva ok=true, ejecuta la acción Cita creada si ya está configurada y habilitada en GHL; la acción es de seguimiento y no crea la cita. Si no existe aún, confirma la cita exitosa sin inventar que se ejecutó la acción. Si Alma falla o el resultado es incierto, escala al equipo sin afirmar que se creó.
```

La sede fija en el prompt reduce llamadas; el control de servidor local bloquea otras sedes en las operaciones de agenda indicadas arriba. Confirmar qué dato usa GHL para crear claves estables y que almacena tokens completos entre turnos. Si no puede hacerlo, se necesita un mediador que mantenga estado e identidad en servidor, no claves ni tokens inventados por el modelo.

## Matriz manual GHL — usar agente duplicado y datos desechables

| Escenario / mensaje | Herramienta y argumentos esperados | Aprobación y error a evitar |
|---|---|---|
| Servicios: «¿Qué masajes ofrecen?» | `listar_servicios` páginas necesarias | Opciones reales; no inventar equivalencias |
| Especialistas: «¿Quién hace [servicio]?» | `listar_especialistas` con ID real | Reconoce limitación de sede; no asegurar disponibilidad |
| Días: «¿Abren el lunes?» | KB; disponibilidad solo con servicio/fecha | No confundir ausencia de cupos con cierre |
| Cupos: «[servicio] el 3 de noviembre» | `listar_servicios`, `listar_especialistas` con servicio_id, `consultar_disponibilidad` con sede verificada, servicio y `2026-11-03` | Nombre exacto, horarios y profesional de respuesta actual |
| Sin cupos | misma consulta, fecha elegida | No inventa alternativas ni declara cierre |
| Nombre sin coincidencia exacta: «masaje corporal» | catálogo, especialistas y disponibilidad para una opción relacionada, si hay fecha | Ofrece el masaje de relajación por su nombre real con profesional y horarios consultados; confirma que desea ese servicio antes de crear |
| Preferencia no disponible | disponibilidad con especialista_id real | Ofrece cambio solo con nueva consulta |
| Petición ambigua | ninguna hasta aclarar servicio | Una pregunta, sin IDs inventados |
| Cliente nuevo | tras selección, datos mínimos documentados | Usa variante nuevo; sin datos inventados |
| Cliente existente | `buscar_cliente` con identificación solo si necesario | ID real; búsqueda no verifica identidad |
| Crear | disponibilidad, confirmación, `crear_cita` con token y clave estable | éxito confirmado solo con `ok=true`; una sola escritura mock |
| Consultar cita | `consultar_citas` filtro específico tras verificación externa | Sin verificación, escala y no expone PII |
| Reagendar | localizar cita autorizada; disponibilidad; `reagendar_cita` | confirma explícitamente; una escritura mock |
| Cancelar | localizar cita autorizada; `cancelar_cita` | confirmación explícita; una escritura mock |
| Red caída | lectura simulada falla | no inventa datos; escala tras error |
| Argumentos inválidos | ID string o falta de fecha en prueba técnica | rechazo; no intenta con datos supuestos |
| Error temporal ALMA | respuesta 503 simulada | lectura con reintentos acotados; escritura incierta y reconciliación |
| Cambio fecha | disponibilidad con nueva fecha | no reutiliza token o cupos anteriores |
| Otra sede | ninguna consulta de sucursal | ofrece únicamente Amsterdam Plaza |
| Sin confirmación | conversación sin afirmación clara | ninguna escritura |
| Token vencido | avanzar reloj mock más de TTL | nueva disponibilidad, nunca inferir ocupación |
| Escritura incierta | timeout/5xx/respuesta inválida mock | no nueva clave; reconciliación humana |
| Seguimiento | crear cita en mock y obtener `ok=true` | activa Cita creada solo si está configurada; nunca ejecuta Lead listo para agendar ni usa seguimiento como reserva |

Todos los escenarios que leen o modifican citas requieren dataset desechable autorizado. Los argumentos concretos de creación y reagendamiento están en `MCP_TOOLS.md`.

## Despliegue y rollback

No desplegado. Antes: validar el control de sede en el entorno desplegado; resolver identidad y validación del mediador GHL; configurar agente duplicado; registrar imagen/commit anterior, backup y ventanas; ejecutar pruebas y build; revisar `/health`, `/ready`, `tools/list` y lecturas. Las mutaciones solo con entorno desechable autorizado; no exponer cancelación ni consulta de PII antes de verificación robusta. Tras aprobación, desplegar imagen y repetir smoke/control GHL. En incidente deshabilitar acciones de escritura, restaurar imagen anterior, comprobar readiness y lecturas, y reconciliar operaciones pendientes o inciertas; nunca revertir base de datos a ciegas. Consultar `EASYPANEL_DEPLOYMENT.md`.
