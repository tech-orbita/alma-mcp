import { pathToFileURL } from 'node:url';
import express, { type Request, type Response } from 'express';

interface MockAppointment {
  id: number;
  estado: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  observacion: string;
  cliente: number;
  especialista: number;
  sucursal: number;
  servicio: number;
}

const ok = (data: unknown, message = '') => ({ success: true, message, data, errors: [] });
const fail = (code: string, detail: string, message: string) => ({
  success: false,
  message,
  data: {},
  errors: [{ code, detail }],
});

function padTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createMockAlmaApp(expectedToken = 'local-alma-token-not-for-production') {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const clients = [
    {
      id: 50,
      nombre: 'Carlos',
      apellido: 'Lopez',
      tipoIdentificacion: 'CC',
      identificacion: '123456789',
      telefono: '3001234567',
      correo: 'cliente@correo.com',
    },
  ];
  const appointments: MockAppointment[] = [];
  let nextAppointmentId = 100;
  let nextClientId = 51;

  app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'alma-mock' }));
  app.use('/api/agendamiento', (request, response, next) => {
    if (request.header('authorization') !== `Token ${expectedToken}`) {
      response.status(401).json(fail('NO_AUTORIZADO', 'Token inválido', 'autenticación requerida'));
      return;
    }
    next();
  });

  app.get('/api/agendamiento/sucursales/', (_request, response) => {
    response.json(ok({ sucursales: [{ id: 1, nombre: 'Sede Principal', codigo: '001', ciudadNombre: 'Medellin' }] }));
  });
  app.get('/api/agendamiento/servicios/', (_request, response) => {
    response.json(ok({ count: 1, next: null, previous: null, servicios: [{ id: 10, nombre: 'Consulta inicial', duracion: 30, valoracion: false }] }));
  });
  app.get('/api/agendamiento/especialistas/', (request, response) => {
    if (request.query['servicio'] !== '10') {
      response.status(400).json(fail('DATOS_INVALIDOS', 'Debe enviar el servicio a consultar', 'servicio requerido'));
      return;
    }
    response.json(ok({ count: 1, next: null, previous: null, especialistas: [{ id: 25, nombre: 'Ana', apellido: 'Perez' }] }));
  });
  app.get('/api/agendamiento/clientes/', (request, response) => {
    const identificacion = stringValue(request.query['identificacion']);
    response.json(ok({ clientes: clients.filter((client) => client.identificacion === identificacion) }));
  });
  app.get('/api/agendamiento/disponibilidad/', (request, response) => {
    const fecha = stringValue(request.query['fecha']);
    const occupied = appointments.some(
      (appointment) =>
        appointment.fecha === fecha &&
        appointment.horaInicio === '09:00' &&
        !appointment.estado.toLowerCase().includes('cancel'),
    );
    const disponibilidad = occupied
      ? []
      : [{ especialistaId: 25, especialistaNombre: 'Ana', especialistaApellido: 'Perez', fecha, horaInicio: '09:00', horaFin: '09:30' }];
    response.json(ok({ count: disponibilidad.length, next: null, previous: null, disponibilidad }));
  });

  app.get('/api/agendamiento/citas/', (request, response) => {
    const citas = appointments
      .filter((appointment) => {
        if (request.query['cita'] !== undefined && appointment.id !== Number(request.query['cita'])) return false;
        if (request.query['cliente'] !== undefined && appointment.cliente !== Number(request.query['cliente'])) return false;
        const client = clients.find((candidate) => candidate.id === appointment.cliente);
        if (request.query['documento'] !== undefined && client?.identificacion !== request.query['documento']) return false;
        if (request.query['fecha'] !== undefined && appointment.fecha !== request.query['fecha']) return false;
        if (request.query['estado'] !== undefined && appointment.estado !== request.query['estado']) return false;
        return true;
      })
      .map((appointment) => {
        const client = clients.find((candidate) => candidate.id === appointment.cliente);
        if (client === undefined) throw new Error('Fixture ALMA inconsistente: cliente no encontrado');
        return {
          citaId: appointment.id,
          estado: appointment.estado,
          fecha: appointment.fecha,
          horaInicio: padTime(appointment.horaInicio),
          horaFin: padTime(appointment.horaFin),
          observacion: appointment.observacion,
          clienteId: client.id,
          clienteNombre: client.nombre,
          clienteApellido: client.apellido,
          clienteDocumento: client.identificacion,
          clienteTelefono: client.telefono,
          clienteCorreo: client.correo,
          especialistaId: 25,
          especialistaNombre: 'Ana',
          especialistaApellido: 'Perez',
          sucursalId: 1,
          sucursalNombre: 'Sede Principal',
          servicioId: 10,
          servicioNombre: 'Consulta inicial',
        };
      });
    response.json(ok({ count: citas.length, next: null, previous: null, citas }));
  });

  app.post('/api/agendamiento/citas/', (request: Request, response: Response) => {
    const input = request.body as Record<string, unknown>;
    const duplicate = appointments.some(
      (appointment) =>
        appointment.fecha === input['fecha'] &&
        appointment.horaInicio === input['horaInicio'] &&
        appointment.especialista === input['especialista'] &&
        !appointment.estado.toLowerCase().includes('cancel'),
    );
    if (duplicate) {
      response.status(409).json(fail('HORARIO_NO_DISPONIBLE', 'El horario ya no está disponible', 'horario no disponible'));
      return;
    }

    let cliente = typeof input['cliente'] === 'number' ? input['cliente'] : undefined;
    if (cliente === undefined) {
      const identificacion = stringValue(input['identificacion']);
      const existing = clients.find((candidate) => candidate.identificacion === identificacion);
      cliente = existing?.id;
      if (cliente === undefined) {
        const created = {
          id: nextClientId++,
          nombre: stringValue(input['nombre']),
          apellido: stringValue(input['apellido']),
          tipoIdentificacion: stringValue(input['tipoIdentificacion']),
          identificacion,
          telefono: stringValue(input['telefono']),
          correo: stringValue(input['correo']),
        };
        clients.push(created);
        cliente = created.id;
      }
    }

    const appointment: MockAppointment = {
      id: nextAppointmentId++,
      estado: 'Pendiente',
      fecha: stringValue(input['fecha']),
      horaInicio: stringValue(input['horaInicio']),
      horaFin: stringValue(input['horaFin']),
      observacion: stringValue(input['observacion']),
      cliente,
      especialista: Number(input['especialista']),
      sucursal: Number(input['sucursal']),
      servicio: Number(input['servicio']),
    };
    appointments.push(appointment);
    response.status(201).json(ok({ cita: { ...appointment, observacion: undefined } }));
  });

  app.put('/api/agendamiento/citas/:id/', (request, response) => {
    const appointment = appointments.find((candidate) => candidate.id === Number(request.params.id));
    if (appointment === undefined) {
      response.status(404).json(fail('CITA_NO_ENCONTRADA', 'La cita no existe', 'cita no encontrada'));
      return;
    }
    const input = request.body as Record<string, unknown>;
    appointment.sucursal = Number(input['sucursal']);
    appointment.servicio = Number(input['servicio']);
    appointment.especialista = Number(input['especialista']);
    appointment.fecha = stringValue(input['fecha']);
    appointment.horaInicio = stringValue(input['horaInicio']);
    appointment.horaFin = stringValue(input['horaFin']);
    appointment.observacion =
      input['observacion'] === undefined ? appointment.observacion : stringValue(input['observacion']);
    response.json(ok({
      cita: {
        id: appointment.id,
        estado: appointment.estado,
        fecha: appointment.fecha,
        horaInicio: appointment.horaInicio,
        horaFin: appointment.horaFin,
        especialista: appointment.especialista,
        sucursal: appointment.sucursal,
        servicio: appointment.servicio,
      },
    }));
  });

  app.delete('/api/agendamiento/citas/:id/', (request, response) => {
    const appointment = appointments.find((candidate) => candidate.id === Number(request.params.id));
    if (appointment === undefined) {
      response.status(404).json(fail('CITA_NO_ENCONTRADA', 'La cita no existe', 'cita no encontrada'));
      return;
    }
    if (appointment.estado === 'Cancelado') {
      response.status(409).json(fail('CITA_YA_CANCELADA', 'La cita ya está cancelada', 'cita ya cancelada'));
      return;
    }
    appointment.estado = 'Cancelado';
    response.json(ok({ cita: { id: appointment.id, estado: appointment.estado, fecha: appointment.fecha, horaInicio: appointment.horaInicio, horaFin: appointment.horaFin } }));
  });

  return { app, appointments };
}

const executedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  const port = Number(process.env['MOCK_ALMA_PORT'] ?? 4010);
  const token = process.env['ALMA_API_TOKEN'] ?? 'local-alma-token-not-for-production';
  createMockAlmaApp(token).app.listen(port, '0.0.0.0', () => {
    process.stdout.write(`ALMA mock local escuchando en ${port}.\n`);
  });
}
