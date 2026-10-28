# Contexto, alcance y restricciones

## Objetivo

Migrar el bot de HighLevel Conversation AI a un SuperAgent que use un servidor MCP externo para operar directamente sobre ALMA. Esta arquitectura no usa n8n ni modifica workflows existentes.

La fuente del contrato es `C:\Users\ASUS\Downloads\Documentacion Tecnica API Agendamiento.pdf`, documento de 13 páginas creado el 4 de agosto de 2026. Se revisó el texto y el render de todas las páginas antes de implementar.

## Hechos confirmados por el documento ALMA

- No existen ambientes separados permanentes de pruebas y producción. ALMA entregará una URL temporal para integración.
- La autenticación usa `Authorization: Token <TOKEN>` y JSON.
- Todas las respuestas usan `{ success, message, data, errors }`.
- Hay nueve operaciones: sucursales, servicios, especialistas, cliente, disponibilidad, crear, consultar, reagendar y cancelar citas.
- Servicios, especialistas, disponibilidad y citas están paginados.
- La API valida disponibilidad real y cruces antes de crear/reagendar.

## Ambigüedad conocida de URL

El ejemplo de URL base termina en `/api/`, mientras las rutas se escriben como `/api/agendamiento/...`. Interpretarlas por concatenación literal produciría `/api/api/agendamiento/...`.

La implementación mantiene las rutas canónicas documentadas y normaliza la base:

- `https://host/api/` + `/api/agendamiento/citas/` -> `https://host/api/agendamiento/citas/`;
- `https://host/` + `/api/agendamiento/citas/` -> `https://host/api/agendamiento/citas/`;
- una base con prefijo, por ejemplo `/integraciones/api/`, conserva el prefijo sin repetir `api`.

La decisión es configurable mediante `ALMA_BASE_URL` y está cubierta por pruebas.

## Hechos confirmados sobre HighLevel

- El usuario confirmó el 4 de agosto de 2026 que la UI de la subcuenta muestra Custom MCP y Custom APIs al crear el agente.
- La documentación pública de HighLevel para AI Agents en Workflows admite servidores MCP externos, Bearer y HTTP Streamable, con prueba de conexión y descubrimiento de herramientas.
- La visibilidad de la opción en la UI es evidencia de capacidad disponible, pero no prueba que el servidor, dominio, token o herramientas funcionen.

Por tanto, siguen siendo gates de aceptación: `Test Connection`, autenticación exitosa y descubrimiento exacto de nueve herramientas en la subcuenta real.

## Límites de esta entrega

No se hizo lo siguiente:

- desplegar en EasyPanel/Hostinger;
- crear DNS o certificados;
- configurar HighLevel real;
- usar credenciales ALMA reales;
- ejecutar mutaciones contra ALMA;
- modificar/desplegar n8n;
- afirmar entrega remota o funcionamiento productivo.

## Incertidumbres que requieren validación del proveedor

1. URL temporal exacta y si ya incluye `/api`.
2. Token de pruebas y política de expiración/rotación.
3. Zona horaria contractual del campo `fecha` + `horaInicio`/`horaFin`.
4. Status HTTP exactos para cada error; el documento define el envelope, no una matriz HTTP completa.
5. Posibles valores nulos o campos adicionales en respuestas reales.
6. Semántica de `PUT`: el documento muestra todos los campos de agenda, pero no confirma si admite actualizaciones parciales.
7. Soporte real de body JSON en `DELETE` a través del proxy del proveedor.
8. Comportamiento de paginación cuando `next` contiene un host distinto o parámetros extra.
9. Garantía transaccional del proveedor ante dos creaciones simultáneas del mismo slot.
10. Procedimiento de reconciliación por timeout después de una mutación posiblemente aplicada.

Los adaptadores están centralizados para ajustar estas diferencias sin cambiar los esquemas públicos MCP.

## Criterio de finalización real

El proyecto pasa a producción solo cuando existan evidencias de:

- ALMA temporal autorizado y dataset desechable;
- PostgreSQL con backups;
- dominio HTTPS operativo;
- conexión Custom MCP probada en la subcuenta;
- nueve herramientas descubiertas y limitadas por permisos;
- casos positivos/negativos ejecutados sin PII real;
- canary estable y rollback preparado.
