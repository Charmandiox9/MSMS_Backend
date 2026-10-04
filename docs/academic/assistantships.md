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
esquema. Este cambio implementa persistencia; las futuras operaciones de gestión
deben validar perfiles activos, períodos dentro del semestre y conflictos de
horario, aplicar permisos y traducir los errores de integridad a excepciones NestJS.

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
