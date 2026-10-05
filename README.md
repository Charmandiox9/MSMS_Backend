# MARSYS — Backend

API de MARSYS, plataforma de gestión académica. Está implementada con NestJS, TypeScript, Prisma y PostgreSQL; expone operaciones REST y GraphQL y utiliza autenticación Google OAuth, control de acceso por roles y almacenamiento de archivos compatible con S3.

## Requisitos

- Node.js y pnpm (usa la versión indicada por el proyecto si se configura `packageManager`).
- PostgreSQL accesible desde el entorno local.
- Credenciales de Google OAuth y de almacenamiento para las funciones que las requieran.

## Instalación y configuración local

Desde esta carpeta:

```bash
pnpm install
```

Copia `.env.example` como `.env.development` y completa las variables necesarias. Como mínimo, configura `DATABASE_URL`, `JWT_SECRET`, al menos uno entre `ALLOWED_DOMAINS` y `ALLOWED_EMAILS`, y `FRONTEND_URL`. Para migraciones Prisma, configura también `DIRECT_URL` (si no existe, Prisma usa `DATABASE_URL`). Las demás variables de OAuth, almacenamiento, correo, caché y Google Forms dependen de las funciones que vayas a utilizar. No guardes secretos en el repositorio.

Genera el cliente Prisma y aplica las migraciones existentes:

```bash
pnpm exec prisma generate
pnpm exec prisma migrate deploy
```

En desarrollo local, `prisma migrate deploy` aplica las migraciones pendientes sin crear nuevas. Para crear una migración durante el desarrollo del esquema, usa `pnpm exec prisma migrate dev --name nombre_descriptivo` y conserva la migración en control de versiones.

## Ejecutar

```bash
# Desarrollo con el watcher estándar de NestJS
pnpm start:dev

# Desarrollo con compilación SWC y verificación de tipos
pnpm start:dev:swc

# Compilar y ejecutar la versión de producción
pnpm build
pnpm start:prod
```

`start:dev:swc` es una alternativa de arranque en modo watch que usa el builder SWC para acelerar la compilación. El script `start:dev` estándar se mantiene disponible. La API escucha en el puerto `3001` por defecto; puedes cambiarlo con `PORT`.

## API

- GraphQL: `http://localhost:3001/api/graphql`.
- REST: `http://localhost:3001/api`; los controladores se agrupan por módulos, por ejemplo autenticación, usuarios, gestión académica, dashboard y justificaciones.
- El esquema GraphQL code-first se genera desde los resolvers; no edites manualmente `src/schema.gql`.
- Las operaciones protegidas requieren una sesión válida y los roles/permisos correspondientes.

Para configurar el formulario de justificaciones, Google Apps Script y su conexión al backend, sigue la [guía de Google Forms](docs/justifications/google-forms.md). El endpoint de recepción es `POST /api/justifications/inbox` y requiere `GOOGLE_FORMS_WEBHOOK_SECRET`.

## Verificación

```bash
pnpm build
pnpm test
pnpm test:e2e
pnpm test:stress
```

También están disponibles `pnpm test:watch`, `pnpm test:cov` y `pnpm lint`. Los tests e2e usan la configuración de `test/jest-e2e.json` y no requieren base de datos ni servicios externos. `test:stress` ejecuta pruebas de carga contra un backend ya levantado y se configura con las variables `STRESS_*` de `.env.example`. El detalle de la cobertura y los resultados está en [docs/tests.md](docs/tests.md).

## Estructura principal

- `src/auth`: OAuth, sesión, JWT y autorización.
- `src/users`: cuentas, roles y permisos.
- `src/academic`: semestres, docentes, asignaturas y horarios.
  - `GET /academic/courses/options` entrega días y bloques institucionales.
  - `PATCH /academic/courses/:nrc` permite a administrador y secretaría editar nombre, código, NRC y horarios del semestre activo, con `location` opcional por horario. Conserva las asignaciones docentes y las ayudantías vinculadas; rechaza NRC ocupados y bloques duplicados.
  - El nombre y código se actualizan en el catálogo compartido entre semestres. Los horarios y el NRC se actualizan solo en el semestre activo.
  - El código de asignatura es opcional (`null` si no se conoce), independiente del NRC. Las importaciones de carga docente permiten omitir `courseCode`; los CSV de horarios nunca deducen el código a partir del NRC. Al editar, omitir `code` conserva su valor y enviar `null` o una cadena vacía lo elimina.
  - El CSV de horarios admite `nrc;asignatura;dia;bloque;sala`; omitir `sala` conserva las ubicaciones existentes y una celda vacía las elimina. Las salas se incluyen también en los reportes de asignaturas.
- `src/justifications`: justificaciones y recepción de formularios.
- `src/dashboard`: datos agregados para los paneles.
- `prisma/schema.prisma` y `prisma/migrations`: modelo de datos e historial de cambios.

El modelo de profesores, estudiantes ayudantes y ayudantías, sus reglas de
integridad y sus pruebas SQL se documentan en [la guía académica](docs/academic/assistantships.md).
