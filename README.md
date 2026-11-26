# MARSYS — Backend

API de MARSYS, plataforma de gestión académica. Está implementada con NestJS, TypeScript, Prisma y PostgreSQL; expone operaciones REST y GraphQL y utiliza autenticación Google OAuth, control de acceso por roles y almacenamiento de archivos compatible con S3.

## Requisitos

- Node.js 22 o superior y la versión de pnpm fijada en `package.json`. Jenkins usa Corepack para ejecutar esa versión.
- PostgreSQL accesible desde el entorno local.
- Credenciales de Google OAuth y de almacenamiento para las funciones que las requieran.

## Instalación y configuración local

Desde esta carpeta:

```bash
pnpm install --frozen-lockfile
```

Al agregar o actualizar una dependencia con `pnpm add` o `pnpm update`, registra juntos `package.json` y `pnpm-lock.yaml`. Si editas el manifiesto a mano, sincroniza con `pnpm install --lockfile-only` y verifica con `pnpm install --frozen-lockfile`. Jenkins y Dokploy usan el mismo lockfile.

Copia `.env.example` como `.env.development` y completa las variables del entorno de desarrollo, incluidas las claves PII compatibles con la base elegida. Nest, Prisma y las herramientas de mantenimiento locales leen este archivo. Las variables ya exportadas tienen prioridad. Prisma usa `DIRECT_URL` para migraciones cuando está definida y, en su defecto, usa `DATABASE_URL`. Producción y las pruebas reciben sus variables desde el entorno del proceso. Guarda los secretos fuera de Git.

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

## Docker local

Usa `.env.docker-test` para Docker local. Si el archivo aún no existe, créalo con `node scripts/create-docker-test-env.mjs`. Para levantar solo PostgreSQL, Redis, MinIO y la inicialización del bucket, ejecuta desde `backend/`:

```powershell
docker compose --env-file .env.docker-test -p marsys-validation up -d db redis minio storage-init
```

La guía de [simulación local de producción con Docker](docs/docker-local.md) incluye también los comandos para revisar el estado y los logs, y para detener los servicios conservando los datos.

## API

- GraphQL: `http://localhost:3001/api/graphql`.
- REST: `http://localhost:3001/api`; los controladores se agrupan por módulos, por ejemplo autenticación, usuarios, gestión académica, dashboard y justificaciones.
- El esquema GraphQL code-first se genera desde los resolvers; no edites manualmente `src/schema.gql`.
- Las operaciones protegidas requieren una sesión válida y los roles/permisos correspondientes.

Para configurar el formulario de justificaciones, Google Apps Script y su conexión al backend, sigue la [guía de Google Forms](docs/justifications/google-forms.md). El endpoint de recepción es `POST /api/justifications/inbox` y requiere `GOOGLE_FORMS_WEBHOOK_SECRET`.

La [guía de Google Forms para postulaciones de ayudantía](docs/assistantships/google-forms.md) incluye el formato y el Apps Script para conectar el formulario institucional.

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
  - Las aprobaciones de justificaciones envían un mensaje por rol (alumno, profesor y ayudante), incluso cuando comparten correo. Se deduplican direcciones dentro de cada rol; los rechazos se notifican solo al alumno.
- `src/dashboard`: datos agregados para los paneles.
- `prisma/schema.prisma` y `prisma/migrations`: modelo de datos e historial de cambios.

El modelo de profesores, estudiantes ayudantes y ayudantías, sus reglas de
integridad y sus pruebas SQL se documentan en [la guía académica](docs/academic/assistantships.md).
