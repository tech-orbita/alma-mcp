import { AppError } from '../errors.js';

export const ALMA_ROUTES = Object.freeze({
  sucursales: '/api/agendamiento/sucursales/',
  servicios: '/api/agendamiento/servicios/',
  especialistas: '/api/agendamiento/especialistas/',
  clientes: '/api/agendamiento/clientes/',
  disponibilidad: '/api/agendamiento/disponibilidad/',
  citas: '/api/agendamiento/citas/',
});

function pathSegments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

export function buildAlmaUrl(
  baseUrlValue: string,
  route: string,
  query: Readonly<Record<string, string | number | undefined>> = {},
): URL {
  if (/^[a-z][a-z\d+.-]*:/i.test(route) || route.includes('?') || route.includes('#')) {
    throw new AppError({ code: 'RUTA_ALMA_INVALIDA', message: 'La ruta ALMA configurada no es válida.' });
  }

  const baseUrl = new URL(baseUrlValue);
  const base = pathSegments(baseUrl.pathname);
  const target = pathSegments(route);
  if (target.some((segment) => segment === '.' || segment === '..')) {
    throw new AppError({ code: 'RUTA_ALMA_INVALIDA', message: 'La ruta ALMA configurada no es válida.' });
  }

  let merged: string[];
  const baseIsTargetPrefix = base.length <= target.length && base.every((segment, index) => target[index] === segment);
  if (baseIsTargetPrefix) {
    merged = target;
  } else if (base.at(-1) === target[0]) {
    merged = [...base, ...target.slice(1)];
  } else {
    merged = [...base, ...target];
  }

  baseUrl.pathname = `/${merged.map(encodeURIComponent).join('/')}/`;
  baseUrl.search = '';
  baseUrl.hash = '';
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) baseUrl.searchParams.set(key, String(value));
  }
  return baseUrl;
}

export function appointmentRoute(appointmentId: number): string {
  if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) {
    throw new AppError({ code: 'CITA_INVALIDA', message: 'El identificador de la cita no es válido.' });
  }
  return `${ALMA_ROUTES.citas}${appointmentId}/`;
}
