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

### Integración con los flujos académicos

- Cada ayudantía tiene un NRC propio (`Assistantship.nrc`), independiente del NRC
  de su asignatura. El formulario reemplaza el código estudiantil por este dato;
  los códigos estudiantiles históricos permanecen en el perfil del estudiante.
- `updateAssistantship` actualiza el registro y reemplaza sus horarios en una sola
  transacción, conserva la validación de aprobación y excluye el propio registro
  al comprobar cruces. Los NRC históricos sin dato propio se muestran sin inventar uno.
- Secretaría puede gestionar ayudantías. El analista puede consultarlas mediante
  `ACADEMIC_RECORDS_VIEW`; las mutaciones requieren `TEACHING_ASSISTANTS_MANAGE`.
- `/academic/courses` integra los horarios de ayudantías del semestre activo,
  identificados con `kind: ASSISTANTSHIP`, sus períodos, ubicaciones y ayudantes.
- Los dashboards de todos los roles incluyen ayudantías y ayudantes del semestre activo.
- `/academic/reports` permite consultar profesores, asignaturas, cargas docentes,
  estudiantes ayudantes, ayudantías y semestres. `/academic/reports/export` entrega
  el mismo conjunto filtrado para CSV; exige `REPORTS_EXPORT` y la consulta exige
  `REPORTS_VIEW`. El archivo incluye todas las filas filtradas, no solo la página visible.

### Justificaciones y correos

El webhook acepta `absenceBlocks` opcional, por ejemplo `["A", "B"]`, con los códigos
del catálogo institucional. Se conserva el dato al abrir la entrada. Al aprobar
una justificación se notifica a los ayudantes activos de la asignatura cuyo horario
coincida con el día UTC de la fecha y cuyo período cubra la inasistencia. Si viene un
bloque, también debe coincidir exactamente con su intervalo; si no viene, se consideran
todas las ayudantías de ese día. El rechazo solo se comunica al solicitante.
Los destinatarios se deduplican y no se envían justificativos adjuntos a ayudantes.

El formulario utiliza los bloques institucionales A–H, incluido C2, definidos en
`src/academic/schedule-blocks.ts`. `assistantshipOptions.blocks` entrega sus códigos
y horas en minutos; el selector muestra ese horario y guarda el intervalo completo.
La importación de horarios de asignaturas utiliza el mismo catálogo de códigos.
Los horarios históricos conservan sus horas registradas aunque el catálogo cambie.

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
