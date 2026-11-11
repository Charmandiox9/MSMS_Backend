# Carreras y mallas

El módulo de main se integró conservando términos, privacidad y edición del semestre activo. REST mantiene consistencia con las operaciones académicas existentes.

`DELETE /api/academic/careers/:id` requiere administración o secretaría y un JSON con `updatedAt`, el valor ISO recibido al listar carreras. Valida UUID y fecha mediante DTO. La operación serializable comprueba la fecha, bloquea estudiantes y ayudantías vinculados, elimina mallas sin estudiantes y finalmente la carrera. Las asignaturas globales permanecen. Los conflictos concurrentes y restricciones referenciales se devuelven como 409; una carrera inexistente devuelve 404. La interfaz pide confirmación y comunica el resultado con Sonner en español e inglés.

Se incorporan las migraciones de main para carreras, cohortes, intentos académicos, importación de mallas y ayudantías históricas. Deben aplicarse mediante el flujo habitual de despliegue; esta integración no ejecuta migraciones contra una base remota.
