# Contrato de la API ALMA

Este documento transcribe el contrato observado en el PDF del proveedor. No agrega campos no documentados.

## Autenticación y formato

```http
Authorization: Token <TOKEN_DE_ACCESO>
Content-Type: application/json
Accept: application/json
```

Éxito:

```json
{"success":true,"message":"","data":{},"errors":[]}
```

Error:

```json
{
  "success": false,
  "message": "datos invalidos",
  "data": {},
  "errors": [{"code":"DATOS_INVALIDOS","detail":"Descripcion del error"}]
}
```

## Base URL

El PDF muestra `https://sitio-de-pruebas.com/api/` y rutas que empiezan por `/api/agendamiento`. El cliente evita duplicar el segmento. `ALMA_BASE_URL` no puede contener credenciales, query ni fragmento; en producción exige HTTPS.

## Paginación

El parámetro es `page` (entero positivo). El `data` paginado contiene:

```json
{"count":120,"next":"https://.../...?page=2","previous":null,"citas":[]}
```

| Endpoint | Tamaño documentado |
|---|---:|
| servicios | 50 |
| especialistas | 50 |
| disponibilidad | 10 |
| citas | 100 |

## 1. Sucursales

`GET /api/agendamiento/sucursales/`

Sin parámetros. `data.sucursales[]`: `id`, `nombre`, `codigo`, `ciudadNombre`.

## 2. Servicios

`GET /api/agendamiento/servicios/?page=2`

`data.servicios[]`: `id`, `nombre`, `duracion` en minutos, `valoracion` booleano.

## 3. Especialistas

`GET /api/agendamiento/especialistas/?servicio=10&page=1`

`servicio` es obligatorio. `data.especialistas[]`: `id`, `nombre`, `apellido`.

## 4. Clientes

`GET /api/agendamiento/clientes/?identificacion=123456789`

`identificacion` es obligatoria. `data.clientes[]`: `id`, `nombre`, `apellido`, `tipoIdentificacion`, `identificacion`, `telefono`, `correo`.

## 5. Disponibilidad

`GET /api/agendamiento/disponibilidad/?sucursal=1&servicio=10&fecha=2026-08-03&especialista=25&page=1`

Obligatorios: `sucursal`, `servicio`, `fecha` (`YYYY-MM-DD`). `especialista` es opcional.

`data.disponibilidad[]`: `especialistaId`, `especialistaNombre`, `especialistaApellido`, `fecha`, `horaInicio`, `horaFin`. El PDF muestra `HH:mm`.

ALMA valida sede/servicio/especialista y excluye cruces con citas `Pendiente`, `En Curso` o `Confirmado`.

## 6. Crear cita

`POST /api/agendamiento/citas/`

Campos de agenda: `sucursal`, `servicio`, `especialista`, `fecha`, `horaInicio`, `horaFin`, `observacion`.

Cliente existente: enviar `cliente`. Cliente por identidad: enviar `tipoIdentificacion`, `identificacion`, `nombre`, `apellido` y opcionalmente `telefono`, `correo`. Si ya existe `identificacion`, ALMA lo reutiliza; si no, requiere como mínimo identificación, nombre y apellido. Datos adicionales no actualizan un cliente cuando se envía `cliente`.

Respuesta `data.cita`: `id`, `estado`, `fecha`, `horaInicio`, `horaFin`, `cliente`, `especialista`, `sucursal`, `servicio`.

## 7. Consultar citas

`GET /api/agendamiento/citas/`

Filtros documentados: `cita`, `cliente`, `documento`, `fecha`, `estado`, `page`.

`data.citas[]` incluye:

- cita: `citaId`, `estado`, `fecha`, `horaInicio`, `horaFin`, `observacion`;
- cliente: `clienteId`, `clienteNombre`, `clienteApellido`, `clienteDocumento`, `clienteTelefono`, `clienteCorreo`;
- especialista: `especialistaId`, `especialistaNombre`, `especialistaApellido`;
- sucursal: `sucursalId`, `sucursalNombre`;
- servicio: `servicioId`, `servicioNombre`.

El ejemplo usa `HH:mm:ss` en este endpoint.

## 8. Reagendar

`PUT /api/agendamiento/citas/{id}/`

Body documentado completo: `sucursal`, `servicio`, `especialista`, `fecha`, `horaInicio`, `horaFin`, `observacion`.

ALMA valida existencia, relaciones y disponibilidad. Respuesta `data.cita`: `id`, `estado`, `fecha`, `horaInicio`, `horaFin`, `especialista`, `sucursal`, `servicio`.

## 9. Cancelar

`DELETE /api/agendamiento/citas/{id}/`

Body opcional: `{ "motivo": "..." }`. Respuesta `data.cita`: `id`, `estado`, `fecha`, `horaInicio`, `horaFin`.

## Códigos documentados

| Código | Significado |
|---|---|
| `DATOS_INVALIDOS` | Parámetros faltantes o formato inválido |
| `SUCURSAL_NO_ENCONTRADA` | Sede inexistente/inactiva |
| `SERVICIO_NO_ENCONTRADO` | Servicio inexistente/no agendable |
| `ESPECIALISTA_NO_ENCONTRADO` | Especialista inexistente/inactivo |
| `CLIENTE_NO_ENCONTRADO` | Cliente indicado inexistente |
| `DATOS_CLIENTE_REQUERIDOS` | No hay ID ni datos mínimos para crear cliente |
| `ESPECIALISTA_NO_ATIENDE_SERVICIO` | Relación servicio/especialista inválida |
| `HORARIO_NO_DISPONIBLE` | Slot inexistente u ocupado |
| `CITA_NO_ENCONTRADA` | Cita inexistente/eliminada |
| `CITA_YA_CANCELADA` | Cita ya cancelada |

## Adaptaciones MCP deliberadas

- El agente no envía los campos de agenda al crear/reagendar; el servidor los extrae de un `slot_token` firmado.
- Consultar citas exige al menos un filtro para limitar exposición de PII.
- Las mutaciones requieren confirmación e idempotencia, aunque ALMA no documenta estos campos.
- Estas protecciones existen en el servidor MCP y no se envían como campos desconocidos a ALMA.
