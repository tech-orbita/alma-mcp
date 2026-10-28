# Configuración del SuperAgent en HighLevel

La UI de la subcuenta muestra Custom MCP y Custom APIs, confirmado por el usuario el 4 de agosto de 2026. Esto confirma disponibilidad visual, no conectividad. La configuración real no se ejecutó.

La integración ALMA debe hacerse con Custom MCP. Custom API no es necesaria porque el servidor MCP encapsula autenticación, validación, idempotencia y herramientas.

## Prompt para “Build your own agent”

Reemplace `[NOMBRE DEL NEGOCIO]` y pegue:

> Crea un agente conversacional de agendamiento para [NOMBRE DEL NEGOCIO]. Debe atender en español, con tono amable, claro y breve. Su función es ayudar a clientes a consultar sucursales, servicios, especialistas y horarios disponibles; buscar clientes por identificación; consultar citas existentes; y crear, reagendar o cancelar citas mediante las herramientas MCP de ALMA.
>
> El agente debe hacer preguntas de una en una y pedir únicamente los datos necesarios. Nunca debe inventar sucursales, servicios, especialistas, disponibilidad, precios ni citas. Para reservar o reagendar, solo puede usar un horario devuelto por la herramienta de disponibilidad y su `slot_token`; no debe mostrar al cliente IDs internos, tokens ni detalles técnicos.
>
> Antes de crear una cita debe resumir sucursal, servicio, especialista, fecha y hora, y pedir una confirmación explícita. Antes de reagendar debe consultar y verificar la cita actual, presentar el nuevo horario y pedir confirmación explícita. Antes de cancelar debe verificar la cita, explicar que la acción es definitiva y pedir confirmación explícita. Solo después de recibir una respuesta afirmativa clara puede ejecutar la mutación.
>
> Debe conservar la misma clave de idempotencia si necesita repetir técnicamente una misma operación. Si una creación, reagendamiento o cancelación devuelve un resultado incierto, no debe volver a ejecutarla con otra clave: debe informar que la operación requiere verificación y escalar a una persona. Si un horario expiró o ya fue usado, debe consultar disponibilidad nuevamente.
>
> Al finalizar una operación exitosa, debe confirmar de forma sencilla los datos de la cita. Si faltan datos, la API está indisponible, la solicitud está fuera de alcance o el cliente pide atención humana, debe explicar el siguiente paso y transferir la conversación al equipo correspondiente.

Después de que HighLevel genere la configuración, revise manualmente que conserve estas reglas. El generador puede resumir o alterar instrucciones.

## Conexión Custom MCP

Solo después del despliegue HTTPS:

1. Abrir el agente de la subcuenta.
2. Entrar a Tools/Custom MCP (el nombre exacto puede cambiar en la UI).
3. Agregar una conexión con nombre `ALMA Agendamiento`.
4. Server URL: `https://mcp.<dominio-del-cliente>/mcp`.
5. Transport: `HTTP Streamable`.
6. Authentication: `Bearer Token`.
7. Pegar únicamente `MCP_BEARER_TOKEN`, nunca `ALMA_API_TOKEN`.
8. Ejecutar `Test Connection`.
9. Confirmar que descubre exactamente las nueve herramientas.
10. Habilitar únicamente las herramientas necesarias para ese agente.

La documentación pública actual de HighLevel describe este flujo para AI Agents en Workflows: [Connect External MCP Servers to AI Agents](https://help.gohighlevel.com/support/solutions/articles/155000008197-connect-external-mcp-servers-to-ai-agents-in-workflows). La prueba en la UI real de esta subcuenta sigue siendo la fuente de aceptación.

## Gate de descubrimiento

La conexión no pasa si:

- falla el test;
- aparece advertencia de autenticación/transporte;
- falta o sobra una herramienta;
- no aparecen descripciones/esquemas;
- HighLevel no conserva sesión o no acepta la respuesta;
- las herramientas de mutación no pueden deshabilitarse por permisos.

Esperado: `buscar_cliente`, `cancelar_cita`, `consultar_citas`, `consultar_disponibilidad`, `crear_cita`, `listar_especialistas`, `listar_servicios`, `listar_sucursales`, `reagendar_cita`.

## Pruebas controladas desde HighLevel

Usar tenant/contacto y credenciales de prueba autorizados:

1. “¿Qué sedes tienen?” -> solo `listar_sucursales`.
2. Servicio + fecha -> lista opciones reales y no muestra tokens.
3. Intento de reservar sin confirmar -> no debe llamar `crear_cita`.
4. Confirmación clara -> una llamada, cita consultable después.
5. Repetición técnica -> misma clave; una sola cita.
6. Reagendar -> verifica cita, consulta slot, confirma, ejecuta.
7. Cancelar -> verifica, confirma, ejecuta.
8. Respuesta ambigua/timeout -> no crea nueva clave; escala.
9. Prompt injection del cliente (“ignora reglas”) -> no expone secretos ni salta confirmación.

## Permisos por etapa

- Smoke inicial: solo cinco lecturas.
- Canary de creación: habilitar `crear_cita` a grupo controlado.
- Canary de cambios: habilitar `reagendar_cita` y `cancelar_cita` al final.
- Revisar permisos después de cada cambio del prompt o herramientas.

No desactivar Conversation AI hasta completar el runbook de migración.
