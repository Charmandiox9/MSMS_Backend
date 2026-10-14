# Repositorio académico y profesores hora

## Modelos y planillas de referencia

La migración `20261014000000_academic_repository_and_hourly_teaching` amplía
`Teacher` sin reemplazar profesores, asignaciones ni semestres existentes.

- `Project`: año informado, facultad, unidad, resolución, código opcional único, título,
  clasificación, fuente, programa, concurso, ámbito, participación, estado,
  oficialización, fechas originales/revisadas/cierre, carpeta y notas. Los montos
  originales de aportes VRA, VRIDT, recuperación, facultad, depreciación y
  rentabilidad se conservan como decimales opcionales con moneda explícita.
- `ProjectParticipant`: director y demás participantes, rol y vínculo opcional
  con un profesor global. Admite participantes externos por nombre y los campos
  opcionales de correo/género del registro de proyectos internos.
- `Research` y `ResearchParticipant`: investigación y equipo; vínculo opcional
  uno a uno con el proyecto que la financia o administra.
- `ResearchOutput`, `ResearchOutputAuthor` y `ResearchOutputProject`: artículos,
  libros, capítulos y propiedad intelectual. Incluyen DOI, revista, ISSN/ISBN,
  cuartil, factor de impacto numérico, publicación, indexación, editorial, lugar,
  participación estudiantil/internacional, tipo y fase de propiedad intelectual.
  La autoría tiene orden y enlaces opcionales a profesores o estudiantes;
  un resultado puede reconocer varios proyectos.

Los proyectos e investigaciones tienen pantallas CRUD en
`/dashboard/projects` y `/dashboard/research`, disponibles para administración,
secretaría docente y análisis de procesos académicos. La navegación lateral y
los accesos de Información académica incluyen ambas páginas. No se importan
automáticamente las planillas: las fechas inválidas y montos desconocidos deben
resolverse antes de una futura importación.

## CRUD de proyectos e investigaciones

La API REST usa `/api/academic/projects` y `/api/academic/research`: GET para
listados paginados y GET `/:id` para detalle, POST para crear, PUT `/:id` para
reemplazar campos editables y DELETE `/:id` para eliminar. Mantiene el contrato
de mantenimiento académico existente. Todos los endpoints validan sesión y
los tres roles de repositorio, incluyendo escrituras y eliminación.

Los listados admiten `page`, `pageSize` (máximo 100) y `search` por título,
código o unidad; investigaciones también busca por área. Proyectos añade
`reportingYear` y `status`. Descripciones, notas y nombres de participantes
cifrados no se usan como filtros SQL. El detalle incluye el equipo y vínculos.

El formulario de proyectos cubre identificación, origen, fechas, siete montos
decimales, moneda, documentación y participantes. Vacío significa desconocido,
incluyendo montos: no se convierte a cero. Los importes viajan como strings
decimales de hasta dos cifras decimales; registrar cualquier monto exige moneda.
Las fechas se validan en el backend. Investigaciones registra descripción,
área, fechas, equipo y un proyecto opcional; la base asegura un vínculo único.

Un participante puede ser externo o vincularse a un profesor global existente.
El backend obtiene del padrón el nombre del profesor, valida el equipo completo
y evita repetir nombre/rol. Proyectos admite correo/género opcional; esos campos
no pertenecen al participante de investigación. Omitir `participants` en una
actualización conserva el equipo; `[]` lo vacía explícitamente. Crear o actualizar
el registro y su equipo es una transacción serializable mediante PrismaService,
que cifra PII y mantiene los índices de unicidad protegidos.

PUT exige `expectedUpdatedAt`; DELETE lo exige en la query. Una versión obsoleta
produce 409 para evitar sobrescribir cambios concurrentes. No se elimina un
proyecto con investigación o resultados vinculados, ni una investigación con
resultados. Los participantes propios se retiran con el registro; los profesores
globales se conservan. La interfaz exige confirmación antes de eliminar.

Los estados de carga, vacío, error y reintento, formularios y notificaciones
usan next-intl en español e inglés. Sonner informa guardado/eliminación pendientes,
éxitos y errores. Los diálogos conservan el foco del teclado y lo devuelven al
cerrarse, y las vistas admiten escritorio, móvil y ambos temas.

Este CRUD reutiliza el esquema ya migrado, sin otra migración. La conversión PII
de `main` se completó el 14 de octubre de 2026 con autorización explícita;
el registro de verificación figura en `personal-data-protection.md`. Cada entorno
que use esta base requiere las mismas claves. Generar estas páginas no despliega
automáticamente el backend ni el frontend.

## Perfil y contratos PH

El perfil global añade RUT normalizado con dígito verificador, unidad académica,
grado y certificación. Las fechas de ingreso/salida ya existentes se exponen en
el formulario. Email continúa siendo obligatorio para mantener la identidad y
los flujos actuales; el Excel de PH no lo proporciona.

`HourlyPayRate` configura por semestre el valor mensual por hora directa.
La categoría distingue nuevo, antiguo, buceo principal y buceo secundario.
Las combinaciones de grado/certificación son únicas y se validan.

`HourlyTeachingContract` vincula un contrato al NRC docente existente y a la
tarifa del mismo semestre mediante claves foráneas compuestas. Conserva
componente, paralelo, horas directas, inicio, cierre y una copia del valor de
tarifa aplicado. Los montos calculados no se duplican en la base.

La migración carga las 17 tarifas de la hoja `Hoja 3` de la planilla PH en el
semestre activo que exista al aplicarla. Si no hay semestre activo, no carga
tarifas. Cada semestre nuevo requiere configurar sus propias tarifas desde
**Profesores → Tarifas PH**. Los valores se mantienen en la base, no en la lógica
del cálculo. Cambiar una tarifa no revaloriza contratos registrados.

## Cálculo confirmado

- Valor mensual = horas directas × tarifa mensual por hora directa.
- Las fechas incluyen tanto el inicio como el cierre.
- Cada mes completo paga 30 días, incluyendo febrero.
- El día 31 se trata como día 30. En meses parciales se cuenta el intervalo
  inclusivo entre días comerciales. Un cierre en el último día calendario se
  considera día 30.
- Pago parcial = valor mensual × días comerciales / 30.
- Cada pago mensual se redondea a pesos enteros, mitad hacia arriba.
  El total es la suma de esos pagos mensuales.
- El intervalo debe pertenecer a los meses del semestre activo. Se permiten
  fechas anteriores/posteriores al inicio/cierre académico dentro de esos mismos
  meses, como los contratos de agosto del Excel.

El caso fuente de 3 horas, tarifa 52.000 y fechas 17/08/2026–19/12/2026 produce
72.800, 156.000, 156.000, 156.000 y 98.800: total 639.600.

## Transporte y permisos

Se usa REST para conservar el contrato de mantenimiento docente existente:

| Endpoint | Función | Acceso |
| --- | --- | --- |
| `GET /api/academic/hourly-payments/rates` | Semestre activo y tarifas | Secretaría, analista, administración |
| `POST /api/academic/hourly-payments/rates` | Crear/actualizar una combinación de tarifa | Secretaría, analista, administración |
| `POST /api/academic/hourly-payments/preview` | Calcular contratos sin guardar | Secretaría, analista, administración |
| `GET /api/academic/hourly-payments/teachers/:id` | Contratos activos de un docente con cálculo | Secretaría, analista, administración |
| `POST /api/academic/teachers` | Crear perfil, vínculos y contratos en una transacción | Secretaría, analista, administración |
| `PATCH /api/academic/teachers/:id` | Actualizar perfil, vínculos y contratos en una transacción | Secretaría, analista, administración |

`hourlyContracts` es opcional en los endpoints docentes. Si se omite, se preservan
todos los contratos. Si se envía, representa el conjunto completo de contratos
del docente en el semestre activo; un arreglo vacío los retira explícitamente.
Los contratos existentes llevan `id`; nunca se acepta un contrato perteneciente
a otro docente o semestre. Cada línea indica `nrc`, `payRateId`, `component`,
`parallel`, `directHours`, `startsOn` y `endsOn`.

El editor carga los contratos antes de permitir guardarlos y espera una
previsualización válida. Los valores y reglas se calculan exclusivamente en el
backend. Los cambios se guardan con aislamiento serializable: un error revierte
también el perfil, los vínculos y las eliminaciones de contratos omitidos.

## Migración

La migración es aditiva, usa una transacción e incluye restricciones para fechas,
horas positivas, tarifas, moneda de proyectos, impacto numérico y autoría.
Se generó desde el esquema anterior con `prisma migrate diff`, porque
`migrate dev --create-only` no logró completar la conexión en el entorno inicial.
No se ejecuta ningún reset.

Aplicar en la base autorizada con `prisma migrate deploy`; generar el cliente
con `prisma generate`. El estado de aplicación se informa por separado en la
entrega: disponer del SQL no significa que esté aplicado.

La protección de datos y el procedimiento de activación se describen en [Protección de datos personales](personal-data-protection.md). Los tres roles del repositorio pueden consultar, crear y editar.
