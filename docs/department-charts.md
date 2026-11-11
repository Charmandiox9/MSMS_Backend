# Departamento de proyectos y publicaciones

Project.departmentId y ResearchOutput.departmentId son vínculos opcionales a Career; la migración 20261111193000_add_repository_departments agrega columnas nulas, índices y FK restrictivas sin inferir asignaciones anteriores. Los formularios consultan las carreras existentes. El backend valida UUID y existencia de la carrera; omitir el campo conserva la asignación en una edición y enviar null la elimina. Se mantienen los controles de concurrencia y permisos del repositorio.

academicCharts expone projectsByDepartment y publicationsByDepartment. Los agregados cuentan una sola vez cada registro, muestran carreras con cero registros y usan una etiqueta vacía para el grupo sin asignar (el frontend la traduce). Proyectos respeta año y rango de fecha de inicio; publicaciones respeta año e incluye ARTICLE, BOOK y BOOK_CHAPTER, excluyendo INTELLECTUAL_PROPERTY. El semestre filtra contratos PH. Las asignaciones no se deducen de unidad académica ni autorías.

La eliminación de una carrera con proyectos/publicaciones asociados se bloquea por integridad referencial, sin eliminar registros del repositorio. Aplicar la migración antes de poner en servicio este backend. No se han ejecutado migraciones sobre la base remota durante esta tarea.
