# Estudiantes y matrículas

`Student` es un registro académico global con nombre y correo único normalizado
a minúsculas. Es independiente de `User` y `TeachingAssistant`; no crea cuentas
ni concede acceso a la plataforma.

`StudentEnrollment` vincula al estudiante con una asignatura, NRC y semestre.
La clave única `(studentId, semesterId, nrc)` impide duplicar una matrícula.
Los vínculos no dependen de profesores ni de bloques de horario. Las matrículas
históricas se conservan al cambiar de semestre.

## Operaciones REST

REST mantiene el contrato de los endpoints académicos y sus importaciones CSV.
Todas las rutas requieren sesión. Administración y secretaría gestionan;
secretaría, analistas y apoyo docente consultan. Administración accede mediante
el guard global.

| Método y ruta | Operación |
| --- | --- |
| `GET /api/academic/students` | Lista paginada: `page`, `pageSize`, `search` y `nrc`. El filtro NRC y las matrículas mostradas corresponden al semestre activo. |
| `GET /api/academic/students/:id` | Perfil y matrículas actuales. |
| `POST /api/academic/students` | Crea nombre/correo; opcionalmente recibe `semesterId` y `nrcs`. |
| `PATCH /api/academic/students/:id` | Edita datos y, si recibe `nrcs`, reemplaza únicamente los vínculos del semestre activo. |
| `POST /api/academic/students/import-csv` | Recibe `csv` y el `semesterId` mostrado al usuario. |

Sin semestre activo se pueden crear o editar perfiles, pero no matrículas.
Si el semestre cambió desde que se abrió el formulario, se rechaza la operación
y se exige recargar. Cambiar el NRC de una asignatura actualiza las matrículas
correspondientes en el mismo semestre y transacción.

## CSV

UTF-8, con o sin BOM, separado por `;` o `,`. Cabeceras `nombre`/`nombres`/`name`,
`correo`/`email` y `nrc`, `nrcs` o columnas `nrc1`, `nrc2`, etc. Los nombres deben
estar en una línea; se admiten delimitadores entre comillas y comillas escapadas.

```csv
nombre;correo;nrc1;nrc2
Nombre Apellido;estudiante@example.com;NRC_EXISTENTE_1;NRC_EXISTENTE_2
```

- Todos los NRC deben existir en el semestre activo. El archivo no crea asignaturas.
- Se valida todo antes de escribir. Una fila inválida rechaza la carga completa con su número de fila.
- Correos repetidos en el archivo se rechazan; NRC repetidos en una fila se deduplican.
- Reimportar reutiliza al estudiante por correo, actualiza nombres que cambian y agrega matrículas faltantes. No elimina vínculos previos ni históricos.
- La edición manual permite desvincular matrículas del semestre activo.
- Límites: 5000 estudiantes, 2 MB y 500 NRC por estudiante. Esta ruta admite JSON de hasta 8 MB para contemplar la codificación del CSV.

## Pruebas

Servicio, DTO, permisos, CSV y UI; recorridos Playwright de creación, edición,
importación, reimportación y consulta por NRC. La prueba optativa
`src/prisma/students-migration.spec.ts` usa `TEST_DATABASE_URL` y verifica
unicidad, integridad referencial y 1000 matrículas en un esquema aislado dentro
de una transacción que siempre se revierte.
