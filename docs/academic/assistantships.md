# Profesores, ayudantes y ayudantías

El modelo extiende `Teacher` y reutiliza `Course`, `AcademicSemester` y
`TeachingAssignment`. Solo contempla ayudantías de asignaturas. Profesores y
estudiantes ayudantes son registros académicos independientes de `User`; su
registro no concede acceso al sistema.

| Modelo | Responsabilidad |
| --- | --- |
| `Teacher` | Profesor existente; agrega actividad y fechas opcionales de ingreso y salida. |
| `TeachingAssistant` | Estudiante ayudante: nombre, correo único, código estudiantil opcional y actividad. |
| `AssistantCourseApproval` | Asignatura aprobada por el estudiante y fecha de aprobación. Una por estudiante/asignatura. |
| `Assistantship` | Asignación del ayudante a una carga docente, fechas y horas semanales opcionales. |
| `AssistantshipSchedule` | Horario semanal de la ayudantía y lugar opcional. |

## Identidad de asignaturas y NRC

`Course` representa la asignatura del catálogo. `TeachingAssignment` identifica
su profesor, semestre y NRC. La ayudantía obtiene estos datos desde la asignación
docente, sin duplicar nombres ni NRC. La aprobación corresponde a `Course`, para
poder reutilizarla cuando cambien el NRC o el semestre.

El NRC debe interpretarse dentro del semestre. El modelo existente permite varios
profesores para el mismo NRC; una ayudantía queda vinculada a una asignación docente
concreta, con un profesor responsable. La unicidad del ayudante se exige por esa
asignación. Si se necesita gestionar equipos docentes como una sola sección,
conviene introducir una entidad de sección académica en una evolución posterior.

Las importaciones deben conservar la identidad de `Course` entre semestres. El
importador actual de horarios utiliza el NRC como código de catálogo cuando no
encuentra una carga previa; esos registros deben conciliarse con la asignatura real
antes de usarlos para registrar aprobaciones históricas.

## Integridad en PostgreSQL

- Una ayudantía exige una aprobación registrada para el mismo estudiante y la
  misma asignatura de su carga docente, mediante claves foráneas compuestas.
- `Assistantship.approvedOn` coincide obligatoriamente con la fecha de la
  aprobación. Esta referencia permite comprobar con un `CHECK` que el inicio es
  posterior a la aprobación, incluso al actualizarla.
- El término opcional no puede preceder al inicio. Las horas semanales deben ser
  positivas y no superar las 168 horas de una semana.
- Los días usan ISO 8601 (lunes = 1, domingo = 7). El horario usa minutos desde
  medianoche en hora local del campus, entre 0 y 1440, con término posterior al
  inicio. Un horario que cruza medianoche se divide en dos registros.
- No se permite duplicar un ayudante en la misma asignación ni repetir un horario
  idéntico. Los solapamientos de horarios requieren validación de negocio.
- No se pueden borrar profesores, estudiantes, cursos, semestres, aprobaciones o
  cargas docentes referenciados por ayudantías. Para conservar el historial se
  deben desactivar los perfiles y cerrar las asignaciones con `endsOn`.
- `joinedOn` y `leftOn` describen el período actual del profesor; no constituyen
  un historial de contratos o reingresos.

Los `CHECK` se definen en la migración SQL porque Prisma no los representa en su
esquema. El módulo `src/assistantships` valida perfiles activos, períodos dentro del
semestre y conflictos de horario, comprueba permisos y traduce los errores de
integridad a excepciones NestJS.

## Gestión mediante GraphQL

Todas las operaciones requieren autenticación y el permiso persistido
`TEACHING_ASSISTANTS_MANAGE`, incluso las consultas y los datos del formulario.
Se usa GraphQL para devolver el registro junto con el estudiante, profesor,
asignatura, semestre y horarios en una consulta tipada, consumida con Apollo.

- `assistantships(filters)`: consulta paginada con búsqueda por estudiante,
  correo, código estudiantil, asignatura, profesor o NRC; filtros por semestre,
  profesor y estado. Los totales reflejan los filtros. La página solicitada se
  ajusta si excede el número de páginas disponible.
- `assistantshipOptions`: semestres y profesores para los filtros.
- `assistantshipAssignments(semesterId)`: cargas con profesores activos y NRC
  para registrar una ayudantía en ese semestre.
- `registerAssistantship(input)`: registra en una transacción serializable al
  estudiante, su aprobación y la ayudantía con sus horarios. Reutiliza perfiles
  por correo sin cambiar sus datos ni reescribir aprobaciones previas. Requiere
  confirmación explícita de la aprobación y fechas de inicio y término dentro
  del semestre. Detecta horarios superpuestos, incluso con otras ayudantías del
  mismo estudiante cuyos períodos coincidan. Los conflictos concurrentes se
  devuelven como errores recuperables para reintentar.

La aprobación se registra a partir de la constancia declarada por el personal
autorizado; no existe integración con notas institucionales. Los estados
`SCHEDULED`, `ACTIVE` y `COMPLETED` se calculan por fechas, incluyendo el día de
término. `ACADEMIC_TIME_ZONE` configura el calendario usado (por defecto,
`America/Santiago`). Se permiten registros históricos de semestres anteriores.

La vista `/dashboard/assistantships` reemplaza el historial anterior, cuya ruta
redirige a la nueva vista. Permite buscar, filtrar y registrar desde un modal.
Los horarios son opcionales y no se implementan edición ni eliminación de
ayudantías en esta versión.

## Migración y verificación

La migración `20261004000000_add_teaching_assistants_and_assistantships` es aditiva;
conserva docentes y cargas existentes. Ejecutar `prisma generate` después de aplicarla.

El historial previo no se reproduce desde cero con `migrate dev`: la migración
`20260906000000_implement_rbac_users_roles_permissions` presupone el tipo `Role`
y la tabla `User` del prototipo, cuyo baseline no está versionado. Para una base
ya inicializada se pueden aplicar las migraciones pendientes con `migrate deploy`.
Una base nueva requiere resolver primero ese baseline; no restablecer una base
con datos para sortear el error.

Las pruebas `src/prisma/assistantships-migration.spec.ts` requieren
`TEST_DATABASE_URL` apuntando a PostgreSQL de pruebas/desarrollo con permiso para
crear esquemas. Aplican las migraciones académicas en un esquema aislado dentro de
una transacción y revierten todo al terminar. Sin esa variable se omiten.

```sh
npm test -- --runInBand src/prisma/assistantships-migration.spec.ts
npm test -- --runInBand
npm run build
```

Documentación de referencia: [migrate deploy](https://docs.prisma.io/docs/cli/v7/migrate/deploy).
