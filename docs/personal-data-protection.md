# Protección de datos personales

## Alcance y acceso

Administración del sistema, secretaría docente y análisis de procesos académicos
pueden leer, crear, editar e importar profesores y gestionar tarifas y contratos
PH. Los permisos `ACADEMIC_REPOSITORY_VIEW` y `ACADEMIC_REPOSITORY_MANAGE` se
asignan a esos tres roles. El analista mantiene los límites de otros módulos;
esta autorización no permite administrar usuarios ni decidir justificaciones.

## Cifrado y cobertura

El cifrado de aplicación usa AES-256-GCM, nonce aleatorio de 96 bits y tag de
128 bits. El contexto autenticado identifica modelo/campo; las cachés también
autentican su clave. Cada sobre incluye la versión y el identificador de clave.
No se descifra en SQL y no se admite una lectura alternativa en claro.

`src/privacy/pii-policy.ts` contiene el inventario de campos protegido:

| Registros                       | Campos con cifrado de aplicación                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Usuarios y precargas            | Nombre, correo, identificador Google, avatar                                                   |
| Profesores                      | Nombre, correo, código de funcionario, RUT, unidad, título profesional e institución de egreso |
| Estudiantes                     | Nombre, correo                                                                                 |
| Ayudantes                       | Nombre, correo, código estudiantil                                                             |
| Justificaciones y bandeja       | Correo, motivo, categoría, rechazo, clave de evidencia, identificador de respuesta             |
| Historial de justificaciones    | Notas                                                                                          |
| Proyectos y participantes       | Notas, carpeta, nombres, contacto y género                                                     |
| Investigaciones y participantes | Descripción, nombres                                                                           |
| Resultados académicos y autoría | Notas, nombres, afiliación                                                                     |

Otros datos vinculados a personas, incluyendo fechas, grado/certificación,
horas, relaciones y pagos, conservan tipos nativos para las reglas académicas
y cálculos. Su protección en reposo depende del cifrado de la infraestructura;
no llevan cifrado adicional por columna en esta entrega. Debe mantenerse esa
cobertura para todas las copias y respaldos. [Neon documenta AES-256 para datos
y respaldos y TLS para conexiones](https://neon.com/docs/security/security-overview).
Las evidencias usan R2, que [cifra objetos y metadatos automáticamente con
AES-256](https://developers.cloudflare.com/r2/reference/data-security/).
Si se cambia de proveedor, esa cobertura debe verificarse antes de cargar PII.

Las claves residen en variables de entorno o el gestor de secretos. Se exige
una clave de cifrado de 32 bytes y otra independiente para HMAC-SHA-256.
SHA-256 sin clave no es cifrado ni protege adecuadamente identificadores de
espacio reducido como el RUT. El índice HMAC permite igualdad/unicidad, no
anonimiza el dato. Se mantiene fuera de respuestas de API.

Las búsquedas parciales leen únicamente los campos de identidad requeridos,
descifran en memoria y verifican el texto sin tildes; después filtran por IDs.
No se conservan nombres en claro, prefijos ni claves de ordenación legibles.
Los listados paginados usan fecha de creación e ID para orden estable. Los
reportes completos se ordenan por nombre después de descifrar. Este método
prioriza confidencialidad; para padrones grandes requiere medir el costo de
lectura/descifrado antes de incorporar otro índice.

Las extensiones cubren escrituras y consultas Prisma normales, `createMany`,
upserts, transacciones, relaciones y escrituras anidadas. SQL crudo, clientes
Prisma sin esta extensión y conexiones externas no deben usarse para datos
personales, excepto la herramienta explícita de conversión. Los campos nuevos
requieren actualizar el inventario y sus pruebas.

Los cachés de sesiones y usuarios contienen sobres autenticados. Los JWT
contienen solo `sub`, además de los metadatos propios de firma/expiración.
`/api/auth/session` reconstruye correo, roles y avatar desde la cuenta activa
mediante ActiveUserService, con su caché cifrada de 60 segundos. No devuelve
las claims del JWT ni reutiliza privilegios antiguos de la sesión como permisos.
Los logs omiten correos, búsquedas en URL, motivos y errores crudos de datos.
Las respuestas a usuarios autorizados y exportaciones siguen mostrando los
datos necesarios; requieren HTTPS y almacenamiento seguro por su destinatario.

## Activación controlada

### Instalación con base nueva en Dokploy

Si PostgreSQL comienza vacío, ejecutar las migraciones directamente. No importar
datos de Neon ni ejecutar el backfill de registros anteriores. Generar claves nuevas
del entorno, preservarlas desde el primer registro y preparar al administrador
mediante `node dist/maintenance/bootstrap-admin.js` dentro del contenedor configurado.
La precarga usa Prisma con cifrado PII y whitelist; no se inserta correo en claro
mediante SQL. Véase `deployment-dokploy.md` para migraciones, almacenamiento y pruebas.

### Instalaciones con datos existentes

La migración SQL añade índices HMAC y una marca de conversión; **no convierte
datos ni almacena claves**. La aplicación bloquea el inicio si encuentra filas
sin convertir. No desplegar esta versión antes de completar el procedimiento.

1. Preparar respaldo recuperable y revisar duplicados tras normalizar correos,
   RUT y códigos. Las coincidencias se rechazan; no se fusionan automáticamente.
2. Configurar claves en el gestor de secretos. En local,
   `node scripts/create-pii-keys.mjs` crea `.env.pii` sin imprimir secretos ni
   sobrescribir un archivo existente. El archivo está excluido de Git; debe
   restringirse mediante permisos del sistema y respaldarse por separado.
3. En la base autorizada y con la aplicación en mantenimiento, aplicar las
   migraciones pendientes con `prisma migrate deploy`.
4. Ejecutar `ts-node --transpile-only scripts/backfill-pii.ts --apply`. La opción
   explícita evita una ejecución accidental; requiere autorización sobre esa base. Trabaja en lotes
   transaccionales de 100, es reanudable y solo informa modelos y cantidades.
   Los clientes externos y scripts antiguos deben permanecer detenidos.
5. Drenar o eliminar de forma controlada las cachés anteriores con prefijos
   `user:` y `auth:session:`. La versión nueva usa prefijos distintos; los datos
   viejos pueden permanecer hasta sus TTL de 60 segundos y 24 horas.
6. Verificar lectura, búsqueda exacta, unicidad e importaciones en un entorno
   aislado; iniciar la aplicación y comprobar el guard de conversión.

No se ejecuta la conversión ni se aplican cambios a la base externa como parte
de generar el código. La herramienta no imprime errores Prisma que puedan
contener valores originales. No borrar claves al revertir un despliegue: una
versión antigua que espera texto claro no puede leer las columnas ya cifradas.

Para rotación, añadir una nueva clave al anillo y cambiar la activa, manteniendo
las anteriores. `scripts/backfill-pii.ts --apply --rotate` recifra todos los registros en
una ventana de mantenimiento. Conservar las claves hasta convertir registros,
cachés y respaldos. No cambiar la clave HMAC sin reindexar todo el conjunto.

## Registro de aplicación en Neon — 14 de octubre de 2026

Las migraciones `20261014000000_academic_repository_and_hourly_teaching` y
`20261014010000_encrypt_personal_data_and_repository_access` se aplicaron al
proyecto `msms-db` (`green-river-32361484`), rama `main`
(`br-gentle-forest-auyode57`), base `neondb`, con autorización del usuario.
Prisma confirmó las 18 migraciones al día, 17 tarifas, 14 modelos con marca de
conversión y seis asignaciones de permisos para los tres roles.

Se conservó el snapshot previo `snap-cold-union-aug5mqju`
(`before-academic-pii-migrations-20261014`). La rama aislada
`validate-academic-pii-20261014` (`br-spring-breeze-au03cmp5`) permitió validar
las migraciones, la conversión de datos existentes, el inicio del cliente
Prisma, búsquedas de usuarios y escrituras cifradas transaccionales.

Neon tenía una columna nullable `Teacher.academicDegree` de tipo TEXT,
fuera de la historia de migraciones, sin valores registrados. La migración
conserva esa columna y convierte su tipo al enum esperado. Valores no
compatibles provocarían una reversión completa, sin borrarse silenciosamente.
La validación real también permitió corregir el manejo de selectores
compuestos: el DMMF de Prisma 7 no expone `uniqueFields` en ejecución.
El compute de la rama de prueba quedó deshabilitado al terminar; la rama
permanece disponible para revisión.

La conversión de `main` se completó el **14 de octubre de 2026**, con autorización
explícita del usuario, usando las mismas claves de `.env.pii`. Antes de convertir,
la comprobación mostró 61 registros pendientes, claves válidas y ninguna otra
conexión activa. Se convirtieron 3 usuarios, 2 profesores, 1 ayudante, 14 entradas
de bandeja, 14 justificaciones y 27 entradas de historial. Los otros modelos
estaban vacíos. No se eliminaron registros ni se reemplazaron las claves.

Como la cuenta no permitió otro snapshot por su límite, se conservó una rama
de respaldo previa sin compute: `before-pii-conversion-20261014`
(`br-shiny-violet-aufx41r2`). Las claves tienen una copia local adicional en
`.env.pii.backup.20261014`; ambos archivos están excluidos de Git. La rama previa
y el snapshot anterior requieren los controles de acceso y conservación
correspondientes.

La verificación posterior confirmó cero filas pendientes en los 14 modelos,
inicialización completa de Nest, descifrado autenticado de los 61 registros
y búsqueda de usuarios mediante el índice HMAC. Las URLs locales de `.env` y
`.env.development` usan `sslmode=verify-full` para mantener verificación TLS
explícita y eliminar el aviso de `pg-connection-string`. Los demás entornos
que accedan a esta base deben configurar las **mismas claves**, y los clientes
anteriores que escribían texto claro deben permanecer detenidos hasta actualizarse.

## Ley 21.719

La [ley oficial](https://www.bcn.cl/leychile/navegar?idNorma=1209272) entra en
vigencia el 1 de diciembre de 2026. Su artículo 14 quinquies exige seguridad
adecuada al riesgo y contempla seudonimización, cifrado, restauración y evaluación
periódica. No prescribe SHA-256 como técnica de cifrado.

Esta implementación aporta controles técnicos. El cumplimiento integral también
requiere definir y acreditar finalidad/base de tratamiento, minimización,
conservación, derechos de titulares, respuesta a incidentes y las condiciones de
proveedores/transferencias. La institución debe resolver esas obligaciones; los
tests de software no equivalen a una certificación legal.
