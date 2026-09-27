# Pruebas del backend (unitarias, E2E y estrés)

Informe de la tarea **"Pruebas Unitarias, E2E, Estrés"**: pruebas funcionales, de permisos y de carga de archivos del backend de MARSYS.

- **Rama:** `justifications` (base `f6a5d1b`).
- **Fecha de ejecución:** 26/09/2026.
- **Entorno:** Node + TypeScript 5.9.3, Jest 30, NestJS 11, Prisma 7.

## Resumen

| Nivel     | Comando               | Suites            | Tests | Resultado                                                                                                                            |
| --------- | --------------------- | ----------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Unitarias | `npm test`            | 26 (23 ✅ · 3 ❌) | 186   | **177 pasan · 9 fallan**                                                                                                             |
| E2E       | `npm run test:e2e`    | 4 (4 ✅)          | 235   | **235 pasan · 0 fallan**                                                                                                             |
| Estrés    | `npm run test:stress` | 10 escenarios     | —     | **Backend real: 8/9 dentro de los umbrales** (falla `justifications-list`; el de escritura se omitió) · Validación en memoria: 10/10 |
| Build     | `npm run build`       | —                 | —     | ✅ Compila                                                                                                                           |

Antes de esta tarea había 17 suites unitarias con 70 tests y 1 test E2E. Los 9 tests unitarios que fallan son intencionales: comprueban comportamientos que hoy son incorrectos (sección [Tests que fallan](#tests-que-fallan-9)). Van a pasar cuando se corrija el código.

> ⚠️ Jenkins corre `npm run test`. Si estos tests se integran sin corregir los problemas, el pipeline queda en rojo.

## Cómo ejecutar

```bash
npm test                 # unitarias
npm run test:e2e         # E2E (no necesita base de datos ni servicios externos)
npm run test:stress      # estrés, contra un backend ya levantado (ver sección Estrés)
```

## Qué se probó

### Funcionales

- **Flujo de justificaciones:** recepción del formulario → bandeja → abrir → decidir → notificar. Incluye:
  - respuestas repetidas del formulario (idempotencia por `externalResponseId`);
  - resolución de la asignatura por NRC y _fallback_ al nombre enviado;
  - bloques de horario según el día de la inasistencia, con _fallback_ histórico y sin domingos;
  - profesores del semestre activo o, si no hay, los históricos;
  - historial de estados, doble decisión y motivo de rechazo obligatorio;
  - filtros por estado.
- **Académico:** importación CSV de la carga docente, de la nómina de profesores y de horarios. Cubre separadores `,` y `;`, comillas, días y bloques válidos, columnas faltantes, filas incompletas, fechas inválidas y semestre activo.
- **Usuarios:** precargas, asignar y revocar roles, protección del último administrador, auto-desactivación y auto-eliminación, conservación de cuentas con historial, invalidación de caché.
- **Dashboard, notificaciones (Resend) y sesiones** (Redis/caché y guard de sesión en desarrollo y producción).

### Permisos

- **Matriz por endpoint** (`src/auth/route-permissions.spec.ts`): recorre todos los controllers y compara el acceso de cada handler (público, autenticado o roles) con la matriz esperada. Si alguien agrega o cambia una ruta sin actualizarla, el test falla.
- **Coherencia con la matriz RBAC sembrada:** cada rol que tiene un permiso en la migración `20260906010000_seed_rbac_permission_matrix` debe poder usar los endpoints de ese permiso.
- **E2E por ruta** (26 rutas): sin sesión → 401; usuario desactivado → 401; rol incorrecto → 403 con su mensaje; rol correcto y `SYSTEM_ADMIN` → sin 401/403.
- **Tokens:** firmado con otro secreto, expirado, de un usuario inexistente, con `alg: none`, y con roles inyectados en el payload. Todos se rechazan; los roles se leen de la base de datos, no del token.
- **Endpoints públicos:** `/api`, `/api/auth/session` y `/api/auth/logout`.

### Carga de archivos

- **URLs firmadas de subida:** la key siempre es `uploads/<uuid>.<ext>`. Se descarta el nombre original, así que no se puede usar `../` para escribir en otra ruta del bucket, y se sanean los caracteres de la extensión. Se verifican el content type firmado y la expiración (60–3600 s; si el valor es inválido se usa 900).
- **URLs de descarga de evidencia:** se resuelve la key con o sin el prefijo del bucket.
- **Validación de entrada:** límites de 255 y 150 caracteres, campos vacíos, tipos incorrectos y propiedades extra.
- **Webhook de Google Forms:** secreto en el header actual o en el legado, sin secreto, secreto incorrecto y backend sin secreto configurado.
- **Sin almacenamiento configurado:** responde 503, no 500.
- **URL firmada real:** en E2E se genera una URL firmada con AWS SigV4 contra un bucket ficticio y se verifican el host, el path, `X-Amz-Expires` y `X-Amz-Signature`.

## Infraestructura de pruebas

- **E2E aislado** (`test/support/`):
  - `test-app.ts` levanta `AppModule` completo con el prefijo `/api` y el mismo `ValidationPipe` que `main.ts` (hay que mantenerlos sincronizados).
  - `PrismaService` se reemplaza por una base en memoria (`in-memory-prisma.ts`), y `NotificationsService` y `StorageService` por dobles de prueba.
  - La autenticación usa una cookie JWT firmada en el test.
  - `e2e-env.ts` (configurado en `test/jest-e2e.json`) fija todas las variables de entorno. Como `ConfigModule` no sobrescribe variables ya definidas, así los tests no leen las credenciales de `.env.development`.
  - El `app.e2e-spec.ts` original se conectaba a la base de datos real; ahora usa este arnés.
- **Estrés** (`test/stress/`): `run.ts` es el runner, `scenarios.ts` define los escenarios y `autocannon.d.ts` tiene tipos mínimos, porque autocannon no publica los suyos.

## Tests que fallan (9)

### 1. Auto-desactivación y auto-eliminación en producción (2 tests)

`src/users/users.controller.spec.ts` › _UsersController con el usuario autenticado de cada entorno_

- ❌ impide desactivar la propia cuenta en producción (sesión)
- ❌ impide eliminar la propia cuenta en producción (sesión)

En producción, `SessionAuthGuard` deja en `request.user` la sesión `{ sub, email, roles }`, sin `id`. `UsersController` usa `actor.id`, que queda `undefined`. Por eso el chequeo "no puedes desactivarte ni eliminarte a ti mismo" no se aplica. En desarrollo (JWT, `{ id, ... }`) sí funciona: los casos equivalentes pasan.

```
Received promise resolved instead of rejected
Resolved to value: {"isActive": false, "success": true}
Resolved to value: {"success": true}
```

### 2. Decisiones simultáneas (1 test)

`src/justifications/justifications.service.spec.ts` › _JustificationsService decisiones concurrentes_

- ❌ solo una de dos decisiones simultáneas sobre la misma justificación se aplica

`decide()` verifica que el estado sea `PENDING` fuera de la transacción. Si dos coordinadores deciden al mismo tiempo, ambas decisiones pasan el chequeo y se aplican: la segunda sobrescribe a la primera y el estudiante recibe dos correos contradictorios. El test usa una base en memoria que respeta el filtro por estado, igual que PostgreSQL.

```
Expected length: 1
Received length: 2
→ ACCEPTED (coordinator-1) y luego REJECTED "Fuera de plazo" (coordinator-2), ambas "fulfilled"
```

### 3. Falla de correo después de guardar la decisión (1 test)

`src/justifications/justifications.service.spec.ts` › _JustificationsService flujo completo › decide_

- ❌ devuelve la decisión guardada aunque falle el envío de correos

La decisión se guarda (commit) y después se envían los correos. Si Resend falla, la API responde con error aunque la decisión ya quedó registrada, y el cliente puede creer que no se guardó.

```
Received promise rejected instead of resolved
Rejected to value: [Error: No se pudo enviar la notificación (500)]
```

### 4. Permisos del seed que no llegan al endpoint (5 tests)

`src/auth/route-permissions.spec.ts` › _Coherencia entre la matriz RBAC sembrada y los endpoints_

| Test                                                                                               | Roles con el permiso que reciben 403                       |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| ❌ todo rol con `JUSTIFICATIONS_VIEW` puede usar `JustificationsController.list`                   | `ACADEMIC_PROCESS_ANALYST`                                 |
| ❌ todo rol con `JUSTIFICATIONS_VIEW` puede usar `JustificationsController.evidenceUrl`            | `ACADEMIC_PROCESS_ANALYST`                                 |
| ❌ todo rol con `ACADEMIC_RECORDS_VIEW` puede usar `AcademicController.listTeachers`               | `ACADEMIC_PROCESS_ANALYST`, `TEACHING_SUPPORT_COORDINATOR` |
| ❌ todo rol con `ACADEMIC_RECORDS_VIEW` puede usar `AcademicCoursesController.listCourseSchedules` | `ACADEMIC_PROCESS_ANALYST`, `TEACHING_SUPPORT_COORDINATOR` |
| ❌ todo rol con `ACADEMIC_RECORDS_VIEW` puede usar `AcademicSemestersController.listSemesters`     | `ACADEMIC_PROCESS_ANALYST`, `TEACHING_SUPPORT_COORDINATOR` |

Los guards solo revisan códigos de rol (`@Roles`); la tabla de permisos no se usa en tiempo de ejecución. La relación entre endpoint y permiso de estos tests es una interpretación: por ejemplo, que `GET /academic/teachers` corresponde a `ACADEMIC_RECORDS_VIEW` ("Consultar docentes, asignaturas…"). El equipo debe confirmar si el seed o los `@Roles` son la fuente de verdad.

## Estrés

Herramienta: [autocannon](https://github.com/mcollina/autocannon) 8 (devDependency). El runner ejecuta cada escenario, cuenta como error cualquier status distinto al esperado y termina con código 1 si algún escenario supera los umbrales.

### Configuración

| Variable                | Por defecto                 | Uso                                                                                               |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `STRESS_BASE_URL`       | `http://localhost:3001/api` | Backend objetivo                                                                                  |
| `STRESS_ALLOW_REMOTE`   | —                           | Obligatoria (`true`) para un host distinto de localhost. **Nunca contra producción.**             |
| `STRESS_AUTH_COOKIE`    | —                           | Cookie de sesión (`token=<jwt>` o `session=<id>`); sin ella se omiten los escenarios autenticados |
| `STRESS_FORMS_SECRET`   | —                           | Secreto del webhook; sin él se omiten los escenarios de Forms                                     |
| `STRESS_ALLOW_WRITES`   | —                           | `true` para ejecutar el escenario que **crea registros** en la bandeja                            |
| `STRESS_NRC`            | `STRESS-NRC`                | NRC de los envíos de prueba                                                                       |
| `STRESS_SCENARIOS`      | todos                       | Lista separada por comas                                                                          |
| `STRESS_DURATION`       | `20`                        | Segundos por escenario                                                                            |
| `STRESS_CONNECTIONS`    | `25`                        | Conexiones concurrentes                                                                           |
| `STRESS_MAX_P99_MS`     | `1000`                      | Umbral de latencia p99                                                                            |
| `STRESS_MAX_ERROR_RATE` | `0.01`                      | Umbral de respuestas inesperadas, errores y timeouts                                              |

Ejemplo:

```bash
STRESS_BASE_URL=http://localhost:3001/api \
STRESS_AUTH_COOKIE="token=<jwt>" \
STRESS_FORMS_SECRET=<secreto> \
npm run test:stress
```

### Escenarios

| Escenario                 | Solicitud                                                                       | Status esperado | Requiere                             |
| ------------------------- | ------------------------------------------------------------------------------- | --------------- | ------------------------------------ |
| `health`                  | `GET /`                                                                         | 200             | —                                    |
| `auth-rejection`          | `GET /justifications` sin sesión                                                | 401             | —                                    |
| `session`                 | `GET /auth/session`                                                             | 200             | cookie                               |
| `justifications-list`     | `GET /justifications`                                                           | 200             | cookie                               |
| `justifications-pending`  | `GET /justifications?status=PENDING`                                            | 200             | cookie                               |
| `inbox-list`              | `GET /justifications/inbox`                                                     | 200             | cookie (coordinador)                 |
| `presigned-upload`        | `POST /storage/presigned-upload`                                                | 201             | cookie                               |
| `forms-presigned-upload`  | `POST /storage/presigned-upload/forms`                                          | 201             | secreto                              |
| `forms-webhook-rejection` | `POST /justifications/inbox` con secreto incorrecto                             | 401             | —                                    |
| `forms-inbox-write`       | `POST /justifications/inbox` con `externalResponseId` únicos `stress-<runId>-*` | 201             | secreto + `STRESS_ALLOW_WRITES=true` |

Los registros que crea `forms-inbox-write` quedan en la bandeja como no leídos, con `studentEmail = stress-test@alumnos.ucn.cl`, y se pueden identificar por el prefijo `stress-` para limpiarlos.

### Resultados contra el backend real

Corrida del 26/09/2026 contra el backend compilado (`node dist/main.js`, `NODE_ENV=development`) en `localhost:3001`, conectado a la **base de datos de desarrollo (Neon PostgreSQL, AWS us-east-1)**.

- **Carga:** 10 conexiones durante 10 s por escenario. Es más baja que el default para no saturar la BD compartida.
- **Solo lectura:** no se activó `STRESS_ALLOW_WRITES`, así que `forms-inbox-write` se omitió y no se creó ningún registro.
- **Autenticación:** JWT de un usuario `SYSTEM_ADMIN` activo, firmado localmente con el `JWT_SECRET` de desarrollo.
- **Volumen de datos:** 9 justificaciones (6 ACCEPTED, 3 REJECTED, 0 PENDING), 0 entradas no leídas en la bandeja, 3 asignaciones docentes, 3 horarios y 3 usuarios.

| Escenario                 | req/s  | p50          | p99          | máx      | Status      | Resultado             |
| ------------------------- | ------ | ------------ | ------------ | -------- | ----------- | --------------------- |
| `health`                  | 12.046 | 0 ms         | 2 ms         | 10 ms    | 200×120.444 | ✅                    |
| `auth-rejection`          | 11.840 | 0 ms         | 1 ms         | 9 ms     | 401×130.242 | ✅                    |
| `session`                 | 6.579  | 1 ms         | 5 ms         | 9 ms     | 200×72.374  | ✅                    |
| `justifications-list`     | **2**  | **3.651 ms** | **4.828 ms** | 4.828 ms | 200×20      | ❌ p99 > 1000 ms      |
| `justifications-pending`  | 60     | 134 ms       | 851 ms       | 964 ms   | 200×598     | ✅                    |
| `inbox-list`              | 73     | 134 ms       | 178 ms       | 235 ms   | 200×727     | ✅                    |
| `presigned-upload`        | 1.995  | 4 ms         | 10 ms        | 39 ms    | 201×21.938  | ✅                    |
| `forms-presigned-upload`  | 2.704  | 3 ms         | 6 ms         | 23 ms    | 201×29.744  | ✅                    |
| `forms-webhook-rejection` | 6.884  | 1 ms         | 4 ms         | 13 ms    | 401×75.726  | ✅                    |
| `forms-inbox-write`       | —      | —            | —            | —        | —           | ○ omitido (escritura) |

**Resultado: 8/9 escenarios dentro de los umbrales.** No hubo errores, timeouts ni status inesperados en ningún escenario, y el log del backend no registró errores.

Latencia secuencial (una solicitud a la vez, 5 repeticiones):

| Endpoint                             | Filas devueltas | Latencia                                         |
| ------------------------------------ | --------------- | ------------------------------------------------ |
| `GET /justifications`                | 9               | 3.257 ms (primera, en frío) · luego 957–1.019 ms |
| `GET /justifications?status=PENDING` | 0               | 148–150 ms                                       |
| `GET /justifications/inbox`          | 0               | 144–149 ms                                       |

#### Hallazgo: `GET /justifications` no escala

- **Con solo 9 justificaciones**, una solicitud aislada ya tarda alrededor de 1 s. Con 10 usuarios concurrentes sube a 3,6 s (p50) y el endpoint atiende 2 req/s. En el servidor, cada solicitud tardó entre 3.363 y 3.983 ms.
- **Causa:** por cada justificación se hacen consultas adicionales: profesores del NRC y bloques de horario, y cada una se repite sobre el histórico si el semestre activo no tiene resultados. Cada consulta cuesta unos 148 ms de ida y vuelta a Neon. Con concurrencia, las consultas se encolan en el pool de conexiones.
- **Cómo crece:** el costo aumenta linealmente con el número de justificaciones, y el endpoint no pagina, así que devuelve todas. Con el volumen de un semestre real el tiempo de respuesta crecería de forma proporcional.
- **Por qué los otros listados se ven bien:** `justifications-pending` e `inbox-list` pasan porque en esta BD devuelven 0 filas; su latencia es la de una sola consulta. Tienen el mismo patrón de consultas por fila (`inbox-list` busca bloques por cada entrada), así que se comportarían igual con datos.
- **El resto está sano:** los escenarios sin base de datos (autenticación, rechazo de webhook y firma de URLs) sostienen entre 2.000 y 12.000 req/s con p99 ≤ 10 ms. El JWT no consulta la BD en cada solicitud porque `JwtStrategy` cachea el usuario 60 s.

### Validación del runner (base en memoria)

El runner se validó contra la app de prueba (`AppModule` con la base en memoria de `test/support/`) levantada en `127.0.0.1`, con **10 conexiones durante 2 s por escenario**. Estas cifras validan los scripts y el costo de la capa HTTP, guards y validación. **No representan el rendimiento con PostgreSQL ni R2 reales**, porque las consultas son en memoria y no hay latencia de red. Los resultados contra el backend real están en la sección anterior.

| Escenario                 | req/s  | p50  | p99  | máx   | Status                           | Resultado |
| ------------------------- | ------ | ---- | ---- | ----- | -------------------------------- | --------- |
| `health`                  | 9.956  | 0 ms | 2 ms | 16 ms | 200×19.908                       | ✅        |
| `auth-rejection`          | 10.000 | 0 ms | 1 ms | 10 ms | 401×20.000                       | ✅        |
| `session`                 | 6.124  | 1 ms | 4 ms | 9 ms  | 200×12.246                       | ✅        |
| `justifications-list`     | 5.522  | 1 ms | 5 ms | 9 ms  | 200×11.043                       | ✅        |
| `justifications-pending`  | 5.484  | 1 ms | 6 ms | 13 ms | 200×10.968                       | ✅        |
| `inbox-list`              | 5.738  | 1 ms | 5 ms | 7 ms  | 200×11.475                       | ✅        |
| `presigned-upload`        | 4.706  | 1 ms | 6 ms | 11 ms | 201×9.411                        | ✅        |
| `forms-presigned-upload`  | 8.676  | 0 ms | 4 ms | 6 ms  | 201×17.348                       | ✅        |
| `forms-webhook-rejection` | 4.620  | 1 ms | 5 ms | 24 ms | 401×9.238                        | ✅        |
| `forms-inbox-write`       | 3.421  | 2 ms | 6 ms | 25 ms | 201×6.841 (6.851 filas escritas) | ✅        |

Observaciones de la validación:

1. **Primera corrida: 0/10 (404 en todo).** En autocannon, el `path` de cada request reemplaza al de la URL base, así que se perdía `/api`. Se corrigió en `run.ts` anteponiendo el path base. Los umbrales del runner detectaron el problema.
2. **Segunda corrida: 8/10.** `forms-webhook-rejection` dio 4 req/s con p99 de 1.908 ms, y `forms-inbox-write` no completó solicitudes. La causa era el arnés: el rechazo del webhook hace `console.warn` en cada request, y dentro de Jest cada `console` es muy lento. Con `console.warn` silenciado, ambos escenarios pasan (fila correspondiente de la tabla). Fuera de Jest esto no aplica: contra el backend real, `forms-webhook-rejection` sostuvo 6.884 req/s.
3. Los escenarios de listado (`justifications-list`, `inbox-list`) hacen consultas adicionales por cada fila (profesores y bloques), así que su costo crece con el volumen de datos. Con la base en memoria no se nota; contra PostgreSQL real se confirmó (ver hallazgo).

## Cambios de configuración y dependencias

| Archivo              | Cambio                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tsconfig.json`      | Se quitó el cambio local sin commitear `"ignoreDeprecations": "6.0"`: TypeScript 5.9.3 no lo acepta (error TS5103) y hacía fallar las 17 suites.                               |
| `package.json`       | Nuevo script `test:stress` y devDependency `autocannon@^8.0.0`.                                                                                                                |
| `package-lock.json`  | Agrega autocannon (lo usa `npm ci` en Jenkins; validado con `npm ci --dry-run`). npm 11 además podó entradas _peer_ opcionales de `chokidar`/`readdirp` sin cambiar versiones. |
| `pnpm-lock.yaml`     | Regenerado por pnpm: agrega autocannon y `@swc/core`/`@swc/cli`, que ya estaban en `package.json` pero faltaban en el lockfile. Formato `lockfileVersion 9.0` sin cambios.     |
| `test/jest-e2e.json` | `setupFiles` con `test/support/e2e-env.ts`.                                                                                                                                    |
| `.env.example`       | Variables `STRESS_*` documentadas (comentadas) según la regla 8 de `AGENTS.md`. `.env.development` no se modificó ni se versiona.                                              |
| `README.md`          | Sección "Verificación": `pnpm test:stress` y enlace a este documento.                                                                                                          |

## Limitaciones conocidas

- **ESLint no analiza ningún spec del repo:** `tsconfig.json` excluye `**/*spec.ts` y `test/`, y el _project service_ de typescript-eslint los rechaza. Pasa también con los specs existentes. Los archivos nuevos se formatearon con Prettier (`.prettierrc` del proyecto); los specs existentes ampliados no se reformatearon, para no reescribir código de otros.
- **Estrés:** la corrida real fue solo de lectura, con 10 conexiones, y contra la BD de desarrollo con pocos datos (9 justificaciones). Faltan dos cosas: el escenario de escritura (`forms-inbox-write`), que requiere `STRESS_ALLOW_WRITES=true` y limpiar después los registros `stress-*`, y una corrida en pre-producción con un volumen de datos representativo.
- **Producción en E2E:** los tests E2E corren con autenticación JWT (modo no productivo). El modo producción (sesión en Redis) se cubre con tests unitarios de `SessionAuthGuard` y `SessionService`.
- **Sesiones en producción:** una sesión ya creada no se revalida contra `isActive`, así que un usuario desactivado conserva el acceso hasta que expira (24 h). No se agregó un test porque depende de cómo se decida resolverlo (consultar la BD, invalidar sesiones, etc.).

## Detalle completo de tests

Estado de cada test tal como lo reporta Jest. _Origen_ indica si el archivo es nuevo, si existía y se amplió, o si existía sin cambios.

### Unitarias (`npm test`) — 186 tests

#### `src/academic/academic.controller.spec.ts`

Nuevo · ✅ 4 pasan · ❌ 0 fallan

|     | Test                                                                                       |
| --- | ------------------------------------------------------------------------------------------ |
| ✅  | Controladores académicos › AcademicController delega consultas e importaciones al servicio |
| ✅  | Controladores académicos › AcademicCoursesController delega horarios al servicio           |
| ✅  | Controladores académicos › AcademicSemestersController delega la activación de semestres   |
| ✅  | Controladores académicos › valida los DTO de importación y semestre                        |

#### `src/academic/academic.service.spec.ts`

Nuevo · ✅ 24 pasan · ❌ 0 fallan

|     | Test                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------- |
| ✅  | AcademicService › activateSemester › activa el semestre indicado y desactiva los demás en una transacción             |
| ✅  | AcademicService › activateSemester › rechaza un rango donde el término no es posterior al inicio                      |
| ✅  | AcademicService › activateSemester › rechaza fechas inválidas                                                         |
| ✅  | AcademicService › importCsv › importa filas separadas por coma o punto y coma y respeta valores entre comillas        |
| ✅  | AcademicService › importCsv › rechaza un CSV sin filas de datos                                                       |
| ✅  | AcademicService › importCsv › indica la columna obligatoria que falta                                                 |
| ✅  | AcademicService › importCsv › rechaza filas incompletas                                                               |
| ✅  | AcademicService › importCsv › rechaza fechas de semestre inválidas                                                    |
| ✅  | AcademicService › importTeacherRoster › asigna cada NRC distinto al profesor usando la asignatura del semestre activo |
| ✅  | AcademicService › importTeacherRoster › usa el horario cargado cuando el NRC aún no tiene asignación                  |
| ✅  | AcademicService › importTeacherRoster › rechaza un NRC que no existe en el semestre activo                            |
| ✅  | AcademicService › importTeacherRoster › exige un semestre activo                                                      |
| ✅  | AcademicService › importTeacherRoster › exige columnas de nombre, correo y NRC                                        |
| ✅  | AcademicService › importTeacherRoster › rechaza filas sin NRC                                                         |
| ✅  | AcademicService › importTeacherRoster › rechaza un CSV sin filas                                                      |
| ✅  | AcademicService › importCourseSchedules › normaliza día y bloque y reutiliza la asignatura por NRC                    |
| ✅  | AcademicService › importCourseSchedules › crea la asignatura cuando el NRC no tiene asignación docente                |
| ✅  | AcademicService › importCourseSchedules › rechaza bloques fuera del catálogo                                          |
| ✅  | AcademicService › importCourseSchedules › rechaza días inválidos, incluido el domingo                                 |
| ✅  | AcademicService › importCourseSchedules › indica la columna obligatoria que falta                                     |
| ✅  | AcademicService › importCourseSchedules › rechaza filas incompletas                                                   |
| ✅  | AcademicService › importCourseSchedules › exige un semestre activo                                                    |
| ✅  | AcademicService › consultas › lista profesores con sus asignaciones del semestre activo                               |
| ✅  | AcademicService › consultas › lista horarios solo del semestre activo                                                 |

#### `src/app.controller.spec.ts`

Existente, sin cambios · ✅ 1 pasan · ❌ 0 fallan

|     | Test                                                |
| --- | --------------------------------------------------- |
| ✅  | AppController › root › should return "Hello World!" |

#### `src/auth/auth.controller.spec.ts`

Existente, sin cambios · ✅ 2 pasan · ❌ 0 fallan

|     | Test                                                   |
| --- | ------------------------------------------------------ |
| ✅  | AuthController › should be defined                     |
| ✅  | AuthController › clears the HTTP-only cookie on logout |

#### `src/auth/auth.service.spec.ts`

Existente, sin cambios · ✅ 9 pasan · ❌ 0 fallan

|     | Test                                                                                |
| --- | ----------------------------------------------------------------------------------- |
| ✅  | AuthService › should be defined                                                     |
| ✅  | AuthService › includes role codes in the JWT payload                                |
| ✅  | AuthService › builds the session payload from the assigned role codes               |
| ✅  | AuthService › includes the Google avatar when available                             |
| ✅  | AuthService › rechaza al usuario existente pero inactivo, sin actualizarlo          |
| ✅  | AuthService › enlaza el googleId de un usuario activo existente que aún no lo tenía |
| ✅  | AuthService › crea un usuario nuevo si no existe                                    |
| ✅  | AuthService › applies and consumes a preloaded email roles on first login           |
| ✅  | AuthService › creates authenticated users without assigning an inferred role        |

#### `src/auth/guards/jwt-auth.guard.spec.ts`

Existente, sin cambios · ✅ 2 pasan · ❌ 0 fallan

|     | Test                                                                          |
| --- | ----------------------------------------------------------------------------- |
| ✅  | JwtAuthGuard › permite el acceso sin autenticar cuando el endpoint es público |
| ✅  | JwtAuthGuard › delega en la autenticación JWT en entornos no productivos      |

#### `src/auth/guards/roles.guard.spec.ts`

Existente, sin cambios · ✅ 6 pasan · ❌ 0 fallan

|     | Test                                                                    |
| --- | ----------------------------------------------------------------------- |
| ✅  | RolesGuard › permite el acceso cuando el endpoint es público            |
| ✅  | RolesGuard › permite el acceso cuando el endpoint no declara roles      |
| ✅  | RolesGuard › permite el acceso al administrador del sistema             |
| ✅  | RolesGuard › permite el acceso cuando el usuario tiene un rol requerido |
| ✅  | RolesGuard › deniega el acceso sin un rol requerido                     |
| ✅  | RolesGuard › resuelve al usuario también en contexto GraphQL            |

#### `src/auth/guards/session-auth.guard.spec.ts`

Nuevo · ✅ 7 pasan · ❌ 0 fallan

|     | Test                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------- |
| ✅  | SessionAuthGuard › producción › adjunta la sesión almacenada al request usando la cookie session      |
| ✅  | SessionAuthGuard › producción › lee la cookie desde el header cuando cookie-parser no está disponible |
| ✅  | SessionAuthGuard › producción › rechaza cuando no hay cookie o la sesión expiró                       |
| ✅  | SessionAuthGuard › producción › no acepta un JWT de desarrollo como sesión                            |
| ✅  | SessionAuthGuard › desarrollo › verifica el JWT de la cookie token                                    |
| ✅  | SessionAuthGuard › desarrollo › rechaza cuando no hay token                                           |
| ✅  | SessionAuthGuard › desarrollo › propaga el error de un JWT inválido                                   |

#### `src/auth/role-redirect/role-redirect.util.spec.ts`

Existente, sin cambios · ✅ 3 pasan · ❌ 0 fallan

|     | Test                                                                                  |
| --- | ------------------------------------------------------------------------------------- |
| ✅  | resolveRedirectRoute › resuelve la ruta para los roles configurables del MVP          |
| ✅  | resolveRedirectRoute › en un usuario multi-rol, resuelve a /dashboard                 |
| ✅  | resolveRedirectRoute › un usuario sin roles cae a la ruta de sin acceso, no a la raíz |

#### `src/auth/route-permissions.spec.ts`

Nuevo · ✅ 7 pasan · ❌ 5 fallan

|     | Test                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅  | Matriz de permisos por endpoint › cada endpoint declara exactamente el acceso esperado                                                                 |
| ✅  | Matriz de permisos por endpoint › los endpoints públicos que reciben datos externos validan un secreto de webhook                                      |
| ❌  | Coherencia entre la matriz RBAC sembrada y los endpoints › todo rol con JUSTIFICATIONS_VIEW puede usar JustificationsController.list                   |
| ❌  | Coherencia entre la matriz RBAC sembrada y los endpoints › todo rol con JUSTIFICATIONS_VIEW puede usar JustificationsController.evidenceUrl            |
| ✅  | Coherencia entre la matriz RBAC sembrada y los endpoints › todo rol con JUSTIFICATIONS_CREATE puede usar JustificationsController.listInbox            |
| ✅  | Coherencia entre la matriz RBAC sembrada y los endpoints › todo rol con JUSTIFICATIONS_CREATE puede usar JustificationsController.open                 |
| ❌  | Coherencia entre la matriz RBAC sembrada y los endpoints › todo rol con ACADEMIC_RECORDS_VIEW puede usar AcademicController.listTeachers               |
| ❌  | Coherencia entre la matriz RBAC sembrada y los endpoints › todo rol con ACADEMIC_RECORDS_VIEW puede usar AcademicCoursesController.listCourseSchedules |
| ❌  | Coherencia entre la matriz RBAC sembrada y los endpoints › todo rol con ACADEMIC_RECORDS_VIEW puede usar AcademicSemestersController.listSemesters     |
| ✅  | Coherencia entre la matriz RBAC sembrada y los endpoints › todo rol con ACADEMIC_RECORDS_MANAGE puede usar AcademicController.importCsv                |
| ✅  | Coherencia entre la matriz RBAC sembrada y los endpoints › todo rol con USERS_MANAGE puede usar UsersController.list                                   |
| ✅  | Coherencia entre la matriz RBAC sembrada y los endpoints › todo rol con ROLES_MANAGE puede usar UsersController.assign                                 |

#### `src/auth/session.service.spec.ts`

Nuevo · ✅ 2 pasan · ❌ 0 fallan

|     | Test                                                                              |
| --- | --------------------------------------------------------------------------------- |
| ✅  | SessionService › crea una sesión con un identificador aleatorio y TTL de 24 horas |
| ✅  | SessionService › lee y elimina sesiones usando el prefijo de clave                |

#### `src/auth/strategies/google.strategy.spec.ts`

Existente, sin cambios · ✅ 4 pasan · ❌ 0 fallan

|     | Test                                                                                              |
| --- | ------------------------------------------------------------------------------------------------- |
| ✅  | GoogleStrategy › rechaza con UnauthorizedException si el correo de Google no está verificado      |
| ✅  | GoogleStrategy › rechaza con ForbiddenException si el correo verificado no está en la whitelist   |
| ✅  | GoogleStrategy › valida y devuelve el usuario cuando el correo está verificado y autorizado       |
| ✅  | GoogleStrategy › propaga el error via done() si validateGoogleUser rechaza (ej. usuario inactivo) |

#### `src/auth/strategies/jwt.strategy.spec.ts`

Existente, sin cambios · ✅ 3 pasan · ❌ 0 fallan

|     | Test                                                                                 |
| --- | ------------------------------------------------------------------------------------ |
| ✅  | JwtStrategy › retorna el usuario desde la base de datos y lo cachea en un cache miss |
| ✅  | JwtStrategy › retorna el usuario desde el caché sin consultar la base de datos       |
| ✅  | JwtStrategy › lanza UnauthorizedException si el usuario no existe o está inactivo    |

#### `src/auth/whitelist/whitelist.service.spec.ts`

Existente, sin cambios · ✅ 6 pasan · ❌ 0 fallan

|     | Test                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------ |
| ✅  | WhitelistService › permite un correo cuyo dominio está en ALLOWED_DOMAINS                                    |
| ✅  | WhitelistService › permite un correo excepción listado en ALLOWED_EMAILS aunque su dominio no esté permitido |
| ✅  | WhitelistService › rechaza un correo que no está ni en el dominio ni en la lista de excepciones              |
| ✅  | WhitelistService › compara de forma case-insensitive y hace trim                                             |
| ✅  | WhitelistService › falla al construirse si ALLOWED_DOMAINS y ALLOWED_EMAILS están ambas vacías               |
| ✅  | WhitelistService › falla al construirse si ambas variables no están definidas                                |

#### `src/common/utils/execution-context.util.spec.ts`

Existente, sin cambios · ✅ 2 pasan · ❌ 0 fallan

|     | Test                                                                 |
| --- | -------------------------------------------------------------------- |
| ✅  | getRequestFromContext › retorna el request desde el contexto HTTP    |
| ✅  | getRequestFromContext › retorna el request desde el contexto GraphQL |

#### `src/dashboard/dashboard.controller.spec.ts`

Nuevo · ✅ 1 pasan · ❌ 0 fallan

|     | Test                                                              |
| --- | ----------------------------------------------------------------- |
| ✅  | DashboardController › delega cada panel en su método del servicio |

#### `src/dashboard/dashboard.service.spec.ts`

Nuevo · ✅ 4 pasan · ❌ 0 fallan

|     | Test                                                                                         |
| --- | -------------------------------------------------------------------------------------------- |
| ✅  | DashboardService › resume usuarios, roles y justificaciones pendientes para el administrador |
| ✅  | DashboardService › cuenta solo datos del semestre activo para secretaría académica           |
| ✅  | DashboardService › cuenta todas las justificaciones para el analista de procesos             |
| ✅  | DashboardService › incluye la bandeja no leída para el coordinador de apoyo docente          |

#### `src/justifications/justifications.controller.spec.ts`

Existente, sin cambios · ✅ 9 pasan · ❌ 0 fallan

|     | Test                                                                                             |
| --- | ------------------------------------------------------------------------------------------------ |
| ✅  | JustificationsController › should be defined                                                     |
| ✅  | JustificationsController › listInbox › returns inbox list from service                           |
| ✅  | JustificationsController › list › calls service with status filter when provided                 |
| ✅  | JustificationsController › list › calls service without filter when status is invalid or omitted |
| ✅  | JustificationsController › open › delegates to service with authenticated user id                |
| ✅  | JustificationsController › decide › calls decide service method with validated decision          |
| ✅  | JustificationsController › evidenceUrl › fetches presigned evidence download url                 |
| ✅  | JustificationsController › receiveFormSubmission › rejects submissions with invalid secret       |
| ✅  | JustificationsController › receiveFormSubmission › accepts submissions with valid header secret  |

#### `src/justifications/justifications.service.spec.ts`

Existente, ampliado · ✅ 27 pasan · ❌ 2 fallan

|     | Test                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅  | JustificationsService › should be defined                                                                                                        |
| ✅  | JustificationsService › listInbox › returns unread inbox entries ordered by creation date with schedule blocks                                   |
| ✅  | JustificationsService › listJustifications › returns justifications with associated teachers and schedule blocks                                 |
| ✅  | JustificationsService › getEvidenceUrl › throws NotFoundException when justification does not exist                                              |
| ✅  | JustificationsService › getEvidenceUrl › generates presigned download url for existing evidence                                                  |
| ✅  | JustificationsService › decide › throws BadRequestException if decision status is invalid                                                        |
| ✅  | JustificationsService › decide › throws BadRequestException if rejection is missing reason                                                       |
| ✅  | JustificationsService › decide › approves justification, updates status and sends notifications                                                  |
| ✅  | JustificationsService flujo completo › receiveFormSubmission › usa la asignatura del semestre activo según el NRC y es idempotente por respuesta |
| ✅  | JustificationsService flujo completo › receiveFormSubmission › usa el nombre enviado por el formulario si el NRC no está en el semestre activo   |
| ✅  | JustificationsService flujo completo › receiveFormSubmission › rechaza un NRC desconocido sin nombre de asignatura                               |
| ✅  | JustificationsService flujo completo › receiveFormSubmission › rechaza una fecha de inasistencia inválida                                        |
| ✅  | JustificationsService flujo completo › openInboxEntry › crea la justificación pendiente, registra el historial y marca la entrada como leída     |
| ✅  | JustificationsService flujo completo › openInboxEntry › devuelve la justificación existente si la entrada ya fue abierta                         |
| ✅  | JustificationsService flujo completo › openInboxEntry › rechaza entradas inexistentes                                                            |
| ✅  | JustificationsService flujo completo › decide › rechaza justificaciones inexistentes o ya resueltas                                              |
| ✅  | JustificationsService flujo completo › decide › rechaza con motivo, guarda historial y notifica solo al estudiante                               |
| ✅  | JustificationsService flujo completo › decide › rechaza un motivo de rechazo compuesto solo por espacios                                         |
| ✅  | JustificationsService flujo completo › decide › no guarda motivo de rechazo al aprobar                                                           |
| ✅  | JustificationsService flujo completo › decide › usa profesores históricos del NRC si no hay asignación en el semestre activo                     |
| ✅  | JustificationsService flujo completo › decide › aprueba aunque no haya profesores asociados, notificando al estudiante                           |
| ❌  | JustificationsService flujo completo › decide › devuelve la decisión guardada aunque falle el envío de correos                                   |
| ✅  | JustificationsService flujo completo › bloques de horario › consulta el día de la fecha UTC 2026-09-21T00:00:00Z (Lunes)                         |
| ✅  | JustificationsService flujo completo › bloques de horario › consulta el día de la fecha UTC 2026-09-23T00:00:00Z (Miércoles)                     |
| ✅  | JustificationsService flujo completo › bloques de horario › consulta el día de la fecha UTC 2026-09-26T23:59:59Z (Sábado)                        |
| ✅  | JustificationsService flujo completo › bloques de horario › no busca bloques para un domingo                                                     |
| ✅  | JustificationsService flujo completo › bloques de horario › usa el horario histórico si el semestre activo no tiene bloques                      |
| ✅  | JustificationsService flujo completo › bloques de horario › devuelve una lista vacía si falla la consulta de horarios                            |
| ❌  | JustificationsService decisiones concurrentes › solo una de dos decisiones simultáneas sobre la misma justificación se aplica                    |

#### `src/notifications/notifications.service.spec.ts`

Nuevo · ✅ 4 pasan · ❌ 0 fallan

|     | Test                                                                                     |
| --- | ---------------------------------------------------------------------------------------- |
| ✅  | NotificationsService › no llama a Resend si falta la configuración                       |
| ✅  | NotificationsService › envía el correo a Resend con autorización y remitente configurado |
| ✅  | NotificationsService › lanza un error con el status cuando Resend rechaza el envío       |
| ✅  | NotificationsService › tolera respuestas de Resend que no son JSON                       |

#### `src/prisma/prisma.service.spec.ts`

Existente, sin cambios · ✅ 1 pasan · ❌ 0 fallan

|     | Test                              |
| --- | --------------------------------- |
| ✅  | PrismaService › should be defined |

#### `src/prisma/rbac-migration.spec.ts`

Existente, sin cambios · ✅ 4 pasan · ❌ 0 fallan

|     | Test                                                                                              |
| --- | ------------------------------------------------------------------------------------------------- |
| ✅  | RBAC migration › seeds only the four roles defined for the MVP                                    |
| ✅  | RBAC migration › does not materialize roles from the previous prototype                           |
| ✅  | RBAC permission matrix migration › seeds explicit authorization capabilities for the MVP          |
| ✅  | RBAC permission matrix migration › does not give support staff automated justification processing |

#### `src/storage/storage.controller.spec.ts`

Nuevo · ✅ 7 pasan · ❌ 0 fallan

|     | Test                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| ✅  | StorageController › genera una URL de subida para usuarios autenticados                                                   |
| ✅  | StorageController › createFormsPresignedUpload › acepta el secreto en el header actual o en el legado, ignorando espacios |
| ✅  | StorageController › createFormsPresignedUpload › prioriza el header actual sobre el legado                                |
| ✅  | StorageController › createFormsPresignedUpload › rechaza la solicitud sin secreto                                         |
| ✅  | StorageController › createFormsPresignedUpload › rechaza la solicitud secreto incorrecto                                  |
| ✅  | StorageController › createFormsPresignedUpload › rechaza la solicitud secreto vacío                                       |
| ✅  | StorageController › createFormsPresignedUpload › rechaza todo si el backend no tiene secreto configurado                  |

#### `src/storage/storage.service.spec.ts`

Existente, ampliado · ✅ 15 pasan · ❌ 0 fallan

|     | Test                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------ |
| ✅  | StorageService › rechaza una configuración R2 incompleta                                                     |
| ✅  | StorageService › indica que R2 no está habilitado cuando el proveedor no es R2                               |
| ✅  | StorageService › createPresignedUpload › genera una key única bajo uploads/ con el content type solicitado   |
| ✅  | StorageService › createPresignedUpload › descarta el nombre original y caracteres peligrosos de la extensión |
| ✅  | StorageService › createPresignedUpload › permite archivos sin extensión                                      |
| ✅  | StorageService › createPresignedUpload › usa R2_PRESIGNED_URL_EXPIRES_IN=60 como 60 segundos                 |
| ✅  | StorageService › createPresignedUpload › usa R2_PRESIGNED_URL_EXPIRES_IN=3600 como 3600 segundos             |
| ✅  | StorageService › createPresignedUpload › usa R2_PRESIGNED_URL_EXPIRES_IN=0 como 900 segundos                 |
| ✅  | StorageService › createPresignedUpload › usa R2_PRESIGNED_URL_EXPIRES_IN=3601 como 900 segundos              |
| ✅  | StorageService › createPresignedUpload › usa R2_PRESIGNED_URL_EXPIRES_IN=12.5 como 900 segundos              |
| ✅  | StorageService › createPresignedUpload › usa R2_PRESIGNED_URL_EXPIRES_IN=no-numero como 900 segundos         |
| ✅  | StorageService › createPresignedDownload › firma la key existente sin barra inicial                          |
| ✅  | StorageService › createPresignedDownload › prueba la key con el prefijo del bucket si la original no existe  |
| ✅  | StorageService › createPresignedDownload › prueba la key sin el prefijo del bucket si la original no existe  |
| ✅  | StorageService › createPresignedDownload › firma la key normalizada si ninguna variante existe               |

#### `src/users/users.controller.spec.ts`

Existente, ampliado · ✅ 6 pasan · ❌ 2 fallan

|     | Test                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------- |
| ✅  | AssignRoleDto › accepts a seeded role identifier with UUID structure                                                   |
| ✅  | AssignRoleDto › rejects role identifiers that are not UUID-shaped                                                      |
| ✅  | PreloadUserDto › normalizes the email and accepts one or more seeded role identifiers                                  |
| ✅  | PreloadUserDto › requires a valid email and at least one distinct role                                                 |
| ✅  | UsersController con el usuario autenticado de cada entorno › impide desactivar la propia cuenta en desarrollo (JWT)    |
| ❌  | UsersController con el usuario autenticado de cada entorno › impide desactivar la propia cuenta en producción (sesión) |
| ✅  | UsersController con el usuario autenticado de cada entorno › impide eliminar la propia cuenta en desarrollo (JWT)      |
| ❌  | UsersController con el usuario autenticado de cada entorno › impide eliminar la propia cuenta en producción (sesión)   |

#### `src/users/users.service.spec.ts`

Existente, ampliado · ✅ 17 pasan · ❌ 0 fallan

|     | Test                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------- |
| ✅  | UsersService preloaded users › stores a normalized email with its selected roles without creating a user account |
| ✅  | UsersService preloaded users › rejects an email that already belongs to a user                                   |
| ✅  | UsersService preloaded users › rejects role IDs that do not resolve to configured roles                          |
| ✅  | UsersService preloaded users › rejects emails that the sign-in whitelist would block                             |
| ✅  | UsersService account administration › assignRole › asigna el rol de forma idempotente                            |
| ✅  | UsersService account administration › assignRole › rechaza usuarios o roles inexistentes                         |
| ✅  | UsersService account administration › revokeRole › impide revocar el último rol de administrador activo          |
| ✅  | UsersService account administration › revokeRole › revoca el rol de administrador si quedan otros activos        |
| ✅  | UsersService account administration › revokeRole › rechaza un rol inexistente                                    |
| ✅  | UsersService account administration › setActive › impide que un usuario se desactive a sí mismo                  |
| ✅  | UsersService account administration › setActive › impide desactivar al último administrador activo               |
| ✅  | UsersService account administration › setActive › desactiva la cuenta e invalida el usuario cacheado             |
| ✅  | UsersService account administration › setActive › rechaza usuarios inexistentes                                  |
| ✅  | UsersService account administration › permanentlyDelete › impide que un usuario se elimine a sí mismo            |
| ✅  | UsersService account administration › permanentlyDelete › impide eliminar al último administrador activo         |
| ✅  | UsersService account administration › permanentlyDelete › conserva cuentas con actividad en justificaciones      |
| ✅  | UsersService account administration › permanentlyDelete › elimina cuentas sin actividad e invalida el caché      |

### E2E (`npm run test:e2e`) — 235 tests

#### `test/app.e2e-spec.ts`

Existente, ampliado · ✅ 1 pasan · ❌ 0 fallan

|     | Test                             |
| --- | -------------------------------- |
| ✅  | AppController (e2e) › /api (GET) |

#### `test/justifications.e2e-spec.ts`

Nuevo · ✅ 17 pasan · ❌ 0 fallan

|     | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅  | Flujo de justificaciones (e2e) › recibe la respuesta del formulario con el secreto del webhook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅  | Flujo de justificaciones (e2e) › no duplica la entrada si el formulario reenvía la misma respuesta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ✅  | Flujo de justificaciones (e2e) › muestra la entrada no leída con los bloques del día de la inasistencia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ✅  | Flujo de justificaciones (e2e) › abre la entrada y crea una justificación pendiente con profesores y bloques                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ✅  | Flujo de justificaciones (e2e) › abrir otra vez la misma entrada no crea una segunda justificación                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ✅  | Flujo de justificaciones (e2e) › la bandeja queda vacía y la justificación aparece como pendiente para secretaría                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ✅  | Flujo de justificaciones (e2e) › rechaza la decisión inválida {"status":"REJECTED"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ✅  | Flujo de justificaciones (e2e) › rechaza la decisión inválida {"status":"PENDING"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ✅  | Flujo de justificaciones (e2e) › rechaza la decisión inválida {"status":"APPROVED"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ✅  | Flujo de justificaciones (e2e) › rechaza la decisión inválida {"status":"ACCEPTED","reasonCategory":"VACACIONES"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ✅  | Flujo de justificaciones (e2e) › rechaza la decisión inválida {"status":"ACCEPTED","extra":true}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ✅  | Flujo de justificaciones (e2e) › rechaza la decisión inválida {"status":"REJECTED","rejectionReason":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"} |
| ✅  | Flujo de justificaciones (e2e) › aprueba la justificación y notifica al estudiante y al profesor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ✅  | Flujo de justificaciones (e2e) › no permite decidir dos veces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ✅  | Flujo de justificaciones (e2e) › filtra por estado e ignora estados desconocidos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ✅  | Flujo de justificaciones (e2e) › responde 404 al abrir una entrada inexistente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅  | Flujo de justificaciones (e2e) › rechaza un NRC desconocido sin nombre de asignatura                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

#### `test/permissions.e2e-spec.ts`

Nuevo · ✅ 191 pasan · ❌ 0 fallan

<details>
<summary>Ver los 191 tests</summary>

|     | Test                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅  | Permisos por endpoint (e2e) › GET /api/users › responde 401 sin sesión                                                                                                                           |
| ✅  | Permisos por endpoint (e2e) › GET /api/users › responde 401 a un usuario desactivado aunque sea administrador                                                                                    |
| ✅  | Permisos por endpoint (e2e) › GET /api/users › aplica la regla de acceso para secretary                                                                                                          |
| ✅  | Permisos por endpoint (e2e) › GET /api/users › aplica la regla de acceso para analyst                                                                                                            |
| ✅  | Permisos por endpoint (e2e) › GET /api/users › aplica la regla de acceso para coordinator                                                                                                        |
| ✅  | Permisos por endpoint (e2e) › GET /api/users › aplica la regla de acceso para noRole                                                                                                             |
| ✅  | Permisos por endpoint (e2e) › GET /api/users › permite el acceso al administrador del sistema                                                                                                    |
| ✅  | Permisos por endpoint (e2e) › GET /api/users/preloads › responde 401 sin sesión                                                                                                                  |
| ✅  | Permisos por endpoint (e2e) › GET /api/users/preloads › responde 401 a un usuario desactivado aunque sea administrador                                                                           |
| ✅  | Permisos por endpoint (e2e) › GET /api/users/preloads › aplica la regla de acceso para secretary                                                                                                 |
| ✅  | Permisos por endpoint (e2e) › GET /api/users/preloads › aplica la regla de acceso para analyst                                                                                                   |
| ✅  | Permisos por endpoint (e2e) › GET /api/users/preloads › aplica la regla de acceso para coordinator                                                                                               |
| ✅  | Permisos por endpoint (e2e) › GET /api/users/preloads › aplica la regla de acceso para noRole                                                                                                    |
| ✅  | Permisos por endpoint (e2e) › GET /api/users/preloads › permite el acceso al administrador del sistema                                                                                           |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/preloads › responde 401 sin sesión                                                                                                                 |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/preloads › responde 401 a un usuario desactivado aunque sea administrador                                                                          |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/preloads › aplica la regla de acceso para secretary                                                                                                |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/preloads › aplica la regla de acceso para analyst                                                                                                  |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/preloads › aplica la regla de acceso para coordinator                                                                                              |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/preloads › aplica la regla de acceso para noRole                                                                                                   |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/preloads › permite el acceso al administrador del sistema                                                                                          |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/preloads/00000000-0000-0000-0000-000000000001 › responde 401 sin sesión                                                                          |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/preloads/00000000-0000-0000-0000-000000000001 › responde 401 a un usuario desactivado aunque sea administrador                                   |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/preloads/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para secretary                                                         |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/preloads/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para analyst                                                           |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/preloads/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para coordinator                                                       |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/preloads/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para noRole                                                            |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/preloads/00000000-0000-0000-0000-000000000001 › permite el acceso al administrador del sistema                                                   |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/00000000-0000-0000-0000-000000000001/roles › responde 401 sin sesión                                                                               |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/00000000-0000-0000-0000-000000000001/roles › responde 401 a un usuario desactivado aunque sea administrador                                        |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/00000000-0000-0000-0000-000000000001/roles › aplica la regla de acceso para secretary                                                              |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/00000000-0000-0000-0000-000000000001/roles › aplica la regla de acceso para analyst                                                                |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/00000000-0000-0000-0000-000000000001/roles › aplica la regla de acceso para coordinator                                                            |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/00000000-0000-0000-0000-000000000001/roles › aplica la regla de acceso para noRole                                                                 |
| ✅  | Permisos por endpoint (e2e) › POST /api/users/00000000-0000-0000-0000-000000000001/roles › permite el acceso al administrador del sistema                                                        |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001/roles/00000000-0000-0000-0000-000000000001 › responde 401 sin sesión                                        |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001/roles/00000000-0000-0000-0000-000000000001 › responde 401 a un usuario desactivado aunque sea administrador |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001/roles/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para secretary                       |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001/roles/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para analyst                         |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001/roles/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para coordinator                     |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001/roles/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para noRole                          |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001/roles/00000000-0000-0000-0000-000000000001 › permite el acceso al administrador del sistema                 |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/users/00000000-0000-0000-0000-000000000001/status › responde 401 sin sesión                                                                             |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/users/00000000-0000-0000-0000-000000000001/status › responde 401 a un usuario desactivado aunque sea administrador                                      |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/users/00000000-0000-0000-0000-000000000001/status › aplica la regla de acceso para secretary                                                            |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/users/00000000-0000-0000-0000-000000000001/status › aplica la regla de acceso para analyst                                                              |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/users/00000000-0000-0000-0000-000000000001/status › aplica la regla de acceso para coordinator                                                          |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/users/00000000-0000-0000-0000-000000000001/status › aplica la regla de acceso para noRole                                                               |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/users/00000000-0000-0000-0000-000000000001/status › permite el acceso al administrador del sistema                                                      |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001 › responde 401 sin sesión                                                                                   |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001 › responde 401 a un usuario desactivado aunque sea administrador                                            |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para secretary                                                                  |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para analyst                                                                    |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para coordinator                                                                |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para noRole                                                                     |
| ✅  | Permisos por endpoint (e2e) › DELETE /api/users/00000000-0000-0000-0000-000000000001 › permite el acceso al administrador del sistema                                                            |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers › responde 401 sin sesión                                                                                                               |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers › responde 401 a un usuario desactivado aunque sea administrador                                                                        |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers › aplica la regla de acceso para secretary                                                                                              |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers › aplica la regla de acceso para analyst                                                                                                |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers › aplica la regla de acceso para coordinator                                                                                            |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers › aplica la regla de acceso para noRole                                                                                                 |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers › permite el acceso al administrador del sistema                                                                                        |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers/00000000-0000-0000-0000-000000000001 › responde 401 sin sesión                                                                          |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers/00000000-0000-0000-0000-000000000001 › responde 401 a un usuario desactivado aunque sea administrador                                   |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para secretary                                                         |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para analyst                                                           |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para coordinator                                                       |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers/00000000-0000-0000-0000-000000000001 › aplica la regla de acceso para noRole                                                            |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/teachers/00000000-0000-0000-0000-000000000001 › permite el acceso al administrador del sistema                                                   |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-csv › responde 401 sin sesión                                                                                                   |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-csv › responde 401 a un usuario desactivado aunque sea administrador                                                            |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-csv › aplica la regla de acceso para secretary                                                                                  |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-csv › aplica la regla de acceso para analyst                                                                                    |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-csv › aplica la regla de acceso para coordinator                                                                                |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-csv › aplica la regla de acceso para noRole                                                                                     |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-csv › permite el acceso al administrador del sistema                                                                            |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-roster › responde 401 sin sesión                                                                                                |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-roster › responde 401 a un usuario desactivado aunque sea administrador                                                         |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-roster › aplica la regla de acceso para secretary                                                                               |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-roster › aplica la regla de acceso para analyst                                                                                 |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-roster › aplica la regla de acceso para coordinator                                                                             |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-roster › aplica la regla de acceso para noRole                                                                                  |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/teachers/import-roster › permite el acceso al administrador del sistema                                                                         |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/courses › responde 401 sin sesión                                                                                                                |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/courses › responde 401 a un usuario desactivado aunque sea administrador                                                                         |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/courses › aplica la regla de acceso para secretary                                                                                               |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/courses › aplica la regla de acceso para analyst                                                                                                 |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/courses › aplica la regla de acceso para coordinator                                                                                             |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/courses › aplica la regla de acceso para noRole                                                                                                  |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/courses › permite el acceso al administrador del sistema                                                                                         |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/courses/import-csv › responde 401 sin sesión                                                                                                    |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/courses/import-csv › responde 401 a un usuario desactivado aunque sea administrador                                                             |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/courses/import-csv › aplica la regla de acceso para secretary                                                                                   |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/courses/import-csv › aplica la regla de acceso para analyst                                                                                     |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/courses/import-csv › aplica la regla de acceso para coordinator                                                                                 |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/courses/import-csv › aplica la regla de acceso para noRole                                                                                      |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/courses/import-csv › permite el acceso al administrador del sistema                                                                             |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/semesters › responde 401 sin sesión                                                                                                              |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/semesters › responde 401 a un usuario desactivado aunque sea administrador                                                                       |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/semesters › aplica la regla de acceso para secretary                                                                                             |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/semesters › aplica la regla de acceso para analyst                                                                                               |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/semesters › aplica la regla de acceso para coordinator                                                                                           |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/semesters › aplica la regla de acceso para noRole                                                                                                |
| ✅  | Permisos por endpoint (e2e) › GET /api/academic/semesters › permite el acceso al administrador del sistema                                                                                       |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/semesters/activate › responde 401 sin sesión                                                                                                    |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/semesters/activate › responde 401 a un usuario desactivado aunque sea administrador                                                             |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/semesters/activate › aplica la regla de acceso para secretary                                                                                   |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/semesters/activate › aplica la regla de acceso para analyst                                                                                     |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/semesters/activate › aplica la regla de acceso para coordinator                                                                                 |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/semesters/activate › aplica la regla de acceso para noRole                                                                                      |
| ✅  | Permisos por endpoint (e2e) › POST /api/academic/semesters/activate › permite el acceso al administrador del sistema                                                                             |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/system-admin › responde 401 sin sesión                                                                                                          |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/system-admin › responde 401 a un usuario desactivado aunque sea administrador                                                                   |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/system-admin › aplica la regla de acceso para secretary                                                                                         |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/system-admin › aplica la regla de acceso para analyst                                                                                           |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/system-admin › aplica la regla de acceso para coordinator                                                                                       |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/system-admin › aplica la regla de acceso para noRole                                                                                            |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/system-admin › permite el acceso al administrador del sistema                                                                                   |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-secretary › responde 401 sin sesión                                                                                                    |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-secretary › responde 401 a un usuario desactivado aunque sea administrador                                                             |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-secretary › aplica la regla de acceso para secretary                                                                                   |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-secretary › aplica la regla de acceso para analyst                                                                                     |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-secretary › aplica la regla de acceso para coordinator                                                                                 |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-secretary › aplica la regla de acceso para noRole                                                                                      |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-secretary › permite el acceso al administrador del sistema                                                                             |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-process-analyst › responde 401 sin sesión                                                                                              |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-process-analyst › responde 401 a un usuario desactivado aunque sea administrador                                                       |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-process-analyst › aplica la regla de acceso para secretary                                                                             |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-process-analyst › aplica la regla de acceso para analyst                                                                               |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-process-analyst › aplica la regla de acceso para coordinator                                                                           |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-process-analyst › aplica la regla de acceso para noRole                                                                                |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/academic-process-analyst › permite el acceso al administrador del sistema                                                                       |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/teaching-support-coordinator › responde 401 sin sesión                                                                                          |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/teaching-support-coordinator › responde 401 a un usuario desactivado aunque sea administrador                                                   |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/teaching-support-coordinator › aplica la regla de acceso para secretary                                                                         |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/teaching-support-coordinator › aplica la regla de acceso para analyst                                                                           |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/teaching-support-coordinator › aplica la regla de acceso para coordinator                                                                       |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/teaching-support-coordinator › aplica la regla de acceso para noRole                                                                            |
| ✅  | Permisos por endpoint (e2e) › GET /api/dashboard/teaching-support-coordinator › permite el acceso al administrador del sistema                                                                   |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/inbox › responde 401 sin sesión                                                                                                            |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/inbox › responde 401 a un usuario desactivado aunque sea administrador                                                                     |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/inbox › aplica la regla de acceso para secretary                                                                                           |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/inbox › aplica la regla de acceso para analyst                                                                                             |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/inbox › aplica la regla de acceso para coordinator                                                                                         |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/inbox › aplica la regla de acceso para noRole                                                                                              |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/inbox › permite el acceso al administrador del sistema                                                                                     |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications › responde 401 sin sesión                                                                                                                  |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications › responde 401 a un usuario desactivado aunque sea administrador                                                                           |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications › aplica la regla de acceso para secretary                                                                                                 |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications › aplica la regla de acceso para analyst                                                                                                   |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications › aplica la regla de acceso para coordinator                                                                                               |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications › aplica la regla de acceso para noRole                                                                                                    |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications › permite el acceso al administrador del sistema                                                                                           |
| ✅  | Permisos por endpoint (e2e) › POST /api/justifications/inbox/00000000-0000-0000-0000-000000000001/open › responde 401 sin sesión                                                                 |
| ✅  | Permisos por endpoint (e2e) › POST /api/justifications/inbox/00000000-0000-0000-0000-000000000001/open › responde 401 a un usuario desactivado aunque sea administrador                          |
| ✅  | Permisos por endpoint (e2e) › POST /api/justifications/inbox/00000000-0000-0000-0000-000000000001/open › aplica la regla de acceso para secretary                                                |
| ✅  | Permisos por endpoint (e2e) › POST /api/justifications/inbox/00000000-0000-0000-0000-000000000001/open › aplica la regla de acceso para analyst                                                  |
| ✅  | Permisos por endpoint (e2e) › POST /api/justifications/inbox/00000000-0000-0000-0000-000000000001/open › aplica la regla de acceso para coordinator                                              |
| ✅  | Permisos por endpoint (e2e) › POST /api/justifications/inbox/00000000-0000-0000-0000-000000000001/open › aplica la regla de acceso para noRole                                                   |
| ✅  | Permisos por endpoint (e2e) › POST /api/justifications/inbox/00000000-0000-0000-0000-000000000001/open › permite el acceso al administrador del sistema                                          |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/justifications/00000000-0000-0000-0000-000000000001/decision › responde 401 sin sesión                                                                  |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/justifications/00000000-0000-0000-0000-000000000001/decision › responde 401 a un usuario desactivado aunque sea administrador                           |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/justifications/00000000-0000-0000-0000-000000000001/decision › aplica la regla de acceso para secretary                                                 |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/justifications/00000000-0000-0000-0000-000000000001/decision › aplica la regla de acceso para analyst                                                   |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/justifications/00000000-0000-0000-0000-000000000001/decision › aplica la regla de acceso para coordinator                                               |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/justifications/00000000-0000-0000-0000-000000000001/decision › aplica la regla de acceso para noRole                                                    |
| ✅  | Permisos por endpoint (e2e) › PATCH /api/justifications/00000000-0000-0000-0000-000000000001/decision › permite el acceso al administrador del sistema                                           |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/00000000-0000-0000-0000-000000000001/evidence-url › responde 401 sin sesión                                                                |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/00000000-0000-0000-0000-000000000001/evidence-url › responde 401 a un usuario desactivado aunque sea administrador                         |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/00000000-0000-0000-0000-000000000001/evidence-url › aplica la regla de acceso para secretary                                               |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/00000000-0000-0000-0000-000000000001/evidence-url › aplica la regla de acceso para analyst                                                 |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/00000000-0000-0000-0000-000000000001/evidence-url › aplica la regla de acceso para coordinator                                             |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/00000000-0000-0000-0000-000000000001/evidence-url › aplica la regla de acceso para noRole                                                  |
| ✅  | Permisos por endpoint (e2e) › GET /api/justifications/00000000-0000-0000-0000-000000000001/evidence-url › permite el acceso al administrador del sistema                                         |
| ✅  | Permisos por endpoint (e2e) › POST /api/storage/presigned-upload › responde 401 sin sesión                                                                                                       |
| ✅  | Permisos por endpoint (e2e) › POST /api/storage/presigned-upload › responde 401 a un usuario desactivado aunque sea administrador                                                                |
| ✅  | Permisos por endpoint (e2e) › POST /api/storage/presigned-upload › aplica la regla de acceso para secretary                                                                                      |
| ✅  | Permisos por endpoint (e2e) › POST /api/storage/presigned-upload › aplica la regla de acceso para analyst                                                                                        |
| ✅  | Permisos por endpoint (e2e) › POST /api/storage/presigned-upload › aplica la regla de acceso para coordinator                                                                                    |
| ✅  | Permisos por endpoint (e2e) › POST /api/storage/presigned-upload › aplica la regla de acceso para noRole                                                                                         |
| ✅  | Permisos por endpoint (e2e) › POST /api/storage/presigned-upload › permite el acceso al administrador del sistema                                                                                |
| ✅  | Permisos por endpoint (e2e) › tokens › rechaza un token firmado con otro secreto                                                                                                                 |
| ✅  | Permisos por endpoint (e2e) › tokens › rechaza un token expirado                                                                                                                                 |
| ✅  | Permisos por endpoint (e2e) › tokens › rechaza un token de un usuario inexistente                                                                                                                |
| ✅  | Permisos por endpoint (e2e) › tokens › rechaza un token con algoritmo none                                                                                                                       |
| ✅  | Permisos por endpoint (e2e) › tokens › ignora los roles incluidos en el token y usa los de la base de datos                                                                                      |
| ✅  | Permisos por endpoint (e2e) › endpoints públicos › GET /api responde sin sesión                                                                                                                  |
| ✅  | Permisos por endpoint (e2e) › endpoints públicos › GET /api/auth/session devuelve la sesión del token                                                                                            |
| ✅  | Permisos por endpoint (e2e) › endpoints públicos › GET /api/auth/session responde 401 sin token                                                                                                  |
| ✅  | Permisos por endpoint (e2e) › endpoints públicos › POST /api/auth/logout limpia la cookie                                                                                                        |

</details>

#### `test/uploads.e2e-spec.ts`

Nuevo · ✅ 26 pasan · ❌ 0 fallan

|     | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload › entrega una URL firmada de subida con key aleatoria bajo uploads/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload › no permite elegir la ruta del objeto mediante el nombre de archivo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload › requiere sesión                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload › rechaza el cuerpo inválido {"contentType":"application/pdf"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload › rechaza el cuerpo inválido {"fileName":"a.pdf","contentType":""}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload › rechaza el cuerpo inválido {"fileName":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf","contentType":"application/pdf"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload › rechaza el cuerpo inválido {"fileName":"a.pdf","contentType":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload › rechaza el cuerpo inválido {"fileName":"a.pdf","contentType":"application/pdf","bucket":"otro"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload › rechaza el cuerpo inválido {"fileName":123,"contentType":"application/pdf"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload/forms › entrega una URL firmada al puente de Google Forms con el secreto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload/forms › acepta el header legado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload/forms › rechaza la solicitud sin secreto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload/forms › rechaza la solicitud con secreto incorrecto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ✅  | Carga de archivos (e2e) › POST /api/storage/presigned-upload/forms › rechaza la solicitud con una sesión válida pero sin secreto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ✅  | Carga de archivos (e2e) › POST /api/justifications/inbox (registro de evidencias) › rechaza envíos sin secreto aunque el cuerpo sea válido                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ✅  | Carga de archivos (e2e) › POST /api/justifications/inbox (registro de evidencias) › rechaza el envío inválido {"studentEmail":"no-es-correo"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ✅  | Carga de archivos (e2e) › POST /api/justifications/inbox (registro de evidencias) › rechaza el envío inválido {"evidenceKey":""}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ✅  | Carga de archivos (e2e) › POST /api/justifications/inbox (registro de evidencias) › rechaza el envío inválido {}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ✅  | Carga de archivos (e2e) › POST /api/justifications/inbox (registro de evidencias) › rechaza el envío inválido {"nrc":"111111111111111111111111111111111111111111111111111"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ✅  | Carga de archivos (e2e) › POST /api/justifications/inbox (registro de evidencias) › rechaza el envío inválido {"reason":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"} |
| ✅  | Carga de archivos (e2e) › POST /api/justifications/inbox (registro de evidencias) › rechaza el envío inválido {"status":"ACCEPTED"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ✅  | Carga de archivos (e2e) › POST /api/justifications/inbox (registro de evidencias) › rechaza una fecha de inasistencia inválida                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ✅  | Carga de archivos (e2e) › GET /api/justifications/:id/evidence-url › entrega una URL de descarga firmada a coordinator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ✅  | Carga de archivos (e2e) › GET /api/justifications/:id/evidence-url › entrega una URL de descarga firmada a secretary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ✅  | Carga de archivos (e2e) › GET /api/justifications/:id/evidence-url › responde 404 para una justificación inexistente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ✅  | Carga de archivos sin almacenamiento configurado (e2e) › responde 503 en lugar de un error interno                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
