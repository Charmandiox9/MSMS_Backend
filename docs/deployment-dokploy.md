# Producción con Dokploy y PostgreSQL nuevo

Validación local: **15 de octubre de 2026**. El destino es una base **vacía**, sin datos de Neon. Las migraciones crean el esquema y los catálogos del sistema; no se importa la base anterior ni se ejecuta el backfill PII.

## Arquitectura de producción

```text
Internet -> Traefik/Dokploy HTTPS
              /api/runtime-config -> frontend:3001
              /api y /api/*       -> backend:3001
              resto              -> frontend:3001
backend -> PostgreSQL y Redis autenticado, por red interna
backend -> endpoint interno S3 para operaciones
navegador/Apps Script -> endpoint público S3 HTTPS para URLs firmadas
```

El Compose de este repositorio permite probar localmente ambos repositorios hermanos, con Nginx como entrada. En Dokploy se recomienda desplegar **dos Applications independientes**, PostgreSQL/Redis como recursos nativos y storage como recurso separado. No hace falta poner Nginx delante de Traefik. La carpeta raíz no es un repositorio Git.

## 1. Servidor, DNS y acceso

1. Preparar Linux compatible, SSH con clave y acceso de recuperación. Para dimensionamiento inicial, evaluar 4 vCPU/8 GB RAM con SSD; es una hipótesis que debe ajustarse a métricas, volumen de evidencias y concurrencia. Separar builds si compiten con la aplicación.
2. Instalar una versión estable revisada de Dokploy siguiendo la [documentación oficial](https://docs.dokploy.com/docs/core/installation). Traefik requiere libres 80/443; el panel inicial usa 3000.
3. Crear inmediatamente administrador del panel, MFA y dominio HTTPS del panel. Después de probarlo, retirar su publicación directa en 3000 según la documentación.
4. Configurar DNS de aplicación y storage, si se autoaloja. No publicar un registro AAAA sin servicio IPv6 operativo.
5. Restringir SSH/panel por IP o VPN. Aplicar también firewall del proveedor: publicar puertos Docker puede eludir reglas simples de UFW. PostgreSQL, Redis y la consola S3 deben quedar internos/restringidos.
6. Configurar cifrado en reposo para volúmenes y copias, rotación de logs, alertas de disco, reinicios, latencia y certificados. La red Docker privada no cifra el transporte.

## 2. PostgreSQL vacío y Redis

1. Crear proyecto MARSYS y entornos separados staging/production.
2. Crear recurso PostgreSQL, elegir una versión mantenida y probada (la prueba local usa PostgreSQL 17), contraseña aleatoria y volumen persistente. No habilitar puerto externo.
3. Copiar Internal Credentials. Usar el hostname real del recurso; `localhost` dentro de un contenedor no apunta a PostgreSQL.
4. Configurar `DATABASE_URL` y `DIRECT_URL` hacia **la misma base nueva**. Codificar caracteres especiales de credenciales para URI. Si hay pooler, usar conexión directa para migraciones.
5. No copiar los parámetros TLS de Neon a un PostgreSQL sin certificados. Si se requiere TLS, configurarlo y verificarlo realmente; nunca declarar `rediss://`/`sslmode=verify-full` sin soporte del servidor.
6. Crear Redis separado con contraseña/ACL, volumen y persistencia AOF/RDB según la pérdida de sesiones aceptable. Configurar memoria y política de expulsión; el Compose probado usa AOF y `noeviction`.
7. Guardar su URL interna en `REDIS_URL`, con `CACHE_TYPE=redis`. Las sesiones utilizan exclusivamente el store Redis; no tienen fallback a memoria.
8. Verificar que ambos recursos son alcanzables desde la red de la Application backend. La pertenencia al mismo proyecto visual no demuestra conectividad; redes aisladas Compose no unen automáticamente recursos nativos. [Conexiones internas](https://docs.dokploy.com/docs/core/databases/connection).

Reservar permisos administrativos de PostgreSQL para el paso de migraciones. Estas crean la extensión `unaccent`; preparar los privilegios correspondientes. La cuenta de aplicación debe recibir solo los permisos que necesita.

## 3. Claves de una instalación nueva

Preparar **claves nuevas de este entorno**, independientes de JWT y entre sí. `scripts/create-pii-keys.mjs` genera un `.env.pii` sin imprimir claves y sin sobrescribir archivos existentes. Ejecutarlo en un directorio seguro nuevo si ya existe el `.env.pii` de desarrollo/Neon; importar después los valores al gestor de secretos de Dokploy.

Conservar por separado y cifrados `PII_ACTIVE_KEY_ID`, todo el anillo `PII_ENCRYPTION_KEYS` y `PII_BLIND_INDEX_KEY`. Respaldar también configuración y credenciales de recuperación. Aunque la base comience vacía, las claves pasan a ser imprescindibles al crear el primer registro. No regenerarlas al redeploy.

## 4. Almacenamiento privado

El backend admite `STORAGE_PROVIDER=r2`, `s3` o `minio`. `none` permite desarrollo sin storage, pero readiness no estará disponible. No se utiliza un prefijo Nginx `/storage` para sustituir el endpoint S3.

Para S3/MinIO:

| Variable | Uso |
| --- | --- |
| `S3_ENDPOINT` | Endpoint interno para HeadBucket/HeadObject y operaciones del servidor |
| `S3_PUBLIC_ENDPOINT` | URL alcanzable por navegador y Apps Script; HTTPS en producción |
| `S3_REGION` | Región esperada por el proveedor; por defecto `us-east-1` |
| `S3_BUCKET_NAME` | Bucket privado |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Credencial de aplicación, diferente de la administrativa |
| `S3_PRESIGNED_URL_EXPIRES_IN` | 1–3600 segundos; valor predeterminado 900 |

1. Elegir una distribución/servicio mantenido, fijar imagen/digest, revisar licencia y procedimiento de actualización. **MinIO Community está archivado y declara que ya no se mantiene**; la imagen histórica seleccionada explícitamente en el generador local es solo para pruebas de compatibilidad. [Repositorio oficial](https://github.com/minio/minio).
2. Si se autoaloja, crear recurso Compose separado con volumen persistente y configuración de la edición mantenida elegida. Seguir sus instrucciones de instalación, credenciales y licenciamiento; no asumir que el ejemplo Community sirve para AIStor.
3. Asociar un dominio HTTPS al puerto de la API S3 (habitualmente 9000). La consola (habitualmente 9001) queda restringida por VPN u otro control administrativo.
4. Crear bucket privado y cuenta con lectura/escritura de objetos, listado y consulta de bucket necesarios. No usar las credenciales root en la Application.
5. Configurar CORS del storage para el origen real de MARSYS y los métodos/cabeceras que requieran las subidas firmadas. Verificar el preflight desde el navegador.
6. Las URLs se firman directamente con `S3_PUBLIC_ENDPOINT`. No cambiar host, puerto o ruta después de firmar: puede invalidar SigV4.
7. Probar carga firmada, lectura firmada, expiración y rechazo anónimo; configurar respaldo externo de objetos y cifrado en reposo. Un volumen local no es un backup.

Si se conserva R2, utilizar las variables `R2_*` de `.env.example`; la integración existente se mantiene. No se necesitan migraciones de objetos cuando la instalación comienza sin datos.

## 5. Build reproducible y migraciones

El Dockerfile backend tiene dos destinos operativos: `runner` (predeterminado, sin dependencias de desarrollo ni CLI Prisma) y `migration` (CLI Prisma). Ambos usan el mismo lockfile y código. Cada réplica arranca únicamente Nest; **no ejecuta migraciones al iniciar**. La imagen Node está fijada por digest; actualizar `NODE_IMAGE` deliberadamente y repetir la validación para recibir parches del sistema/runtime.

Desde el checkout de backend:

```bash
docker build --target migration -t marsys-migration:VERSION .
docker build --target runner -t marsys-backend:VERSION .
```

En un flujo con registry, publicar ambas imágenes con el mismo SHA/digest de release y configurar acceso del servidor Dokploy. Como alternativa, construir en el servidor desde un checkout del mismo commit. No usar una imagen migradora de otra revisión.

Antes de desplegar el backend, ejecutar **una sola vez por release**, en el servidor y red correctos:

```bash
docker run --rm --network RED_INTERNA \
  --env-file /ruta/restringida/migrations.env \
  marsys-migration:VERSION
```

`migrations.env` contiene `DATABASE_URL`/`DIRECT_URL` del destino nuevo. En archivos consumidos por `docker run --env-file`, usar valores sin comillas externas; el formato no es idéntico al `.env` interpolado por Compose. No imprimir el archivo en logs. Revisar el resultado y el estado de migraciones; si falla, no habilitar la nueva Application. Nunca usar `db push` ni `migrate dev` en producción.

En la prueba local, **las 21 migraciones existentes se aplicaron desde cero**, sin cambiar ningún SQL histórico ni el esquema Prisma. Repetir `migrate deploy` después no encuentra migraciones pendientes.

## 6. Backend y primer administrador

1. Crear Application backend desde su repo con Dockerfile/contexto raíz (destino predeterminado runner), o seleccionar la imagen de release del registry.
2. Cargar variables privadas de `.env.example`: `NODE_ENV=production`, `PORT=3001`, URLs PostgreSQL/Redis, claves PII, `JWT_SECRET`, OAuth, whitelist, secreto Forms, storage y correo.
3. Establecer `FRONTEND_URL=https://DOMINIO_APP` sin barra final y `GOOGLE_CALLBACK_URL=https://DOMINIO_APP/api/auth/google/callback`. Configurar exactamente ese callback en Google Cloud.
4. Al menos una de `ALLOWED_DOMAINS`/`ALLOWED_EMAILS` debe contener valores reales autorizados. El OAuth no promueve automáticamente al primer visitante.
5. `NO_ACCESS_ROUTE=/no-access`. Configurar `ACADEMIC_TIME_ZONE=America/Santiago` y los datos reales de Resend para notificaciones.
6. Mantener `TRUST_PROXY` vacío salvo que se hayan definido los IP/CIDR reales de proxies confiables. Nunca usar confianza universal. Producción limita CORS al origen frontend y rechaza mutaciones con cookie de sesión y origen ajeno/ausente; los webhooks sin cookie usan su secreto.
7. Configurar healthcheck de `/api/health/ready` sobre puerto 3001. Comprueba PostgreSQL, roundtrip de Redis y acceso al bucket privado; devuelve error genérico sin credenciales. `/api/health/live` solo indica vida del proceso. La imagen ya incluye un healthcheck con Node, sin depender de curl.
8. Con migraciones aplicadas, preparar al administrador inicial mediante **un comando de mantenimiento explícito** dentro del contenedor backend:

```bash
node dist/maintenance/bootstrap-admin.js
```

El comando lee `BOOTSTRAP_ADMIN_EMAIL`, valida el correo contra la whitelist y crea una precarga cifrada con rol `SYSTEM_ADMIN`. Es idempotente para esa precarga, se serializa mediante lock de PostgreSQL y rechaza crear otro administrador si ya existe uno activo. No crea una sesión ni un endpoint de bootstrap público. En el primer OAuth válido, el flujo normal consume la precarga y asigna el rol. Quitar la variable de bootstrap después de verificar el acceso inicial.

Para ejecutarlo antes de publicar la Application también se puede usar un contenedor runner de mantenimiento con su red y variables reales. Nunca ejecutar este comando en el host confiando accidentalmente en el `.env` de Neon/desarrollo.

## 7. Frontend y dominios Dokploy

1. Crear Application frontend desde su repositorio independiente, Dockerfile/contexto raíz y puerto interno **3001**.
2. Pasar `NEXT_PUBLIC_API_URL=/api/graphql` como **build argument** y como variable pública del entorno. El Dockerfile ya declara ese ARG antes de `next build`; el enlace de Google necesita el valor compilado.
3. El paquete Geist incorpora las fuentes localmente; la construcción ya no descarga Google Fonts. No introducir secretos en variables `NEXT_PUBLIC_*`.
4. En Domains configurar HTTPS/Let’s Encrypt, sin Strip Path ni prefijo interno añadido:

| Host | Path | Destino | Puerto | Precedencia |
| --- | --- | --- | --- | --- |
| DOMINIO_APP | `/api/runtime-config` | frontend | 3001 | Mayor, por ejemplo 300 |
| DOMINIO_APP | `/api` | backend | 3001 | Intermedia, por ejemplo 200 |
| DOMINIO_APP | `/` | frontend | 3001 | Menor, por ejemplo 100 |

Revisar los routers generados en Advanced: la ruta de runtime-config es una excepción de Next, no de Nest. Si hay prioridades explícitas, mantener el orden indicado. No habilitar Advanced→Ports para publicar Node directamente. [Dominios Dokploy](https://docs.dokploy.com/docs/core/domains).

5. Probar HTTP→HTTPS, certificado, login, callback, sesión y logout. No cachear respuestas autenticadas ni GraphQL privado en CDN/proxy.

## 8. Nginx local, réplicas y límites

`docker-compose.yml` está pensado para los checkouts backend/frontend hermanos. No puede asumirse que un clon Git aislado de Dokploy incluya `../frontend`. Solo publica Nginx y S3 en **127.0.0.1** para las pruebas; no es una exposición pública TLS.

Nginx ahora enruta todo REST/GraphQL, conserva `/api`, exceptúa runtime-config y usa el puerto frontend 3001. Resuelve cambios de DNS de servicios Docker y distribuye entre réplicas de `api`. Los límites por ruta corresponden a importaciones: CSV docente/asignaturas 100 MB, estudiantes 8 MB, Excel 18 MB; no se aplica rate limit a todos los assets. Los logs evitan query strings, que pueden contener códigos OAuth.

En Dokploy, utilizar Traefik directamente con las Applications. Si se añade Nginx detrás de otro proxy, diseñar su confianza en IP/protocolo y TLS antes de reutilizar la configuración local: esta usa el protocolo de su conexión directa.

Comenzar con una réplica. Para escalar:

- Mantener sesiones y cachés en Redis, mismas claves y misma imagen en todas las réplicas.
- Configurar réplicas/healthchecks/update policy en Advanced y verificar ambos destinos. Dos réplicas en la misma VM no toleran perder la VM.
- Presupuestar conexiones PostgreSQL por réplica y durante rolling updates.
- La cola usa `SKIP LOCKED`, heartbeat de actividad y espera del trabajo en curso durante apagado ordenado. Configurar grace period suficiente; el timeout del orquestador puede matar trabajos largos. Revisar idempotencia/recuperación ante terminaciones forzadas; no se promete ejecución exactamente una vez.
- Para réplicas Next, revisar caché/ISR compartida, build ID y claves de Server Actions si se usan. Redis del backend no coordina automáticamente Next.

## 9. Backups y apertura de producción

1. Configurar destino S3 **externo a la VM** en Dokploy, con cifrado, retención y credenciales mínimas; ejecutar Test.
2. PostgreSQL → Backup: elegir base, cron y prefijo. Definir RPO/RTO antes de elegir frecuencia; un dump diario no satisface pérdida máxima de minutos.
3. Restaurar periódicamente a otra base y comprobar que las claves originales permiten leer/buscar datos cifrados. El ensayo local ya restauró un dump custom a una base distinta y validó descifrado.
4. Respaldar objetos, políticas y claves por separado. El dump no incluye evidencias; una copia en el mismo servidor no protege de perderlo.
5. Probar recuperación del panel/configuración, alertas y renovación de TLS. Rollback de una imagen no revierte migraciones.

Antes de abrir: OAuth real, correo real, webhook Forms, evidencias, permisos 401/403, cargas representativas, backups externos, restauración y acceso desde otra máquina. TLS/firewall del servidor y proveedores externos siguen requiriendo validación allí.

## 10. Reproducir la validación local

Desde backend, con ambos repositorios hermanos y Docker Linux activo:

```bash
node scripts/create-docker-test-env.mjs
docker compose --env-file .env.docker-test -p marsys-validation build
docker compose --env-file .env.docker-test -p marsys-validation up -d
docker compose --env-file .env.docker-test -p marsys-validation exec -T nginx nginx -t
docker compose --env-file .env.docker-test -p marsys-validation exec -T api node dist/maintenance/bootstrap-admin.js
docker compose --env-file .env.docker-test -p marsys-validation build backend-tests frontend-tests
docker compose --env-file .env.docker-test -p marsys-validation run --rm --no-deps backend-tests
docker compose --env-file .env.docker-test -p marsys-validation run --rm --no-deps backend-tests npm run test:e2e -- --runInBand
docker compose --env-file .env.docker-test -p marsys-validation run --rm --no-deps frontend-tests
```

El generador no sobrescribe `.env.docker-test`, no imprime secretos y solo usa identidades sintéticas `example.test`. No usar sus credenciales, OAuth ficticio ni la imagen histórica S3 en producción. Los tests SQL usan schemas privados con rollback dentro de la base de prueba; las pruebas unitarias no reciben las credenciales de runtime.

La primera vez, validar sesión real de la app sin contactar Google:

```bash
docker compose --env-file .env.docker-test -p marsys-validation cp test/docker/session-smoke.cjs api:/tmp/session-smoke.cjs
docker compose --env-file .env.docker-test -p marsys-validation exec -T api node /tmp/session-smoke.cjs
docker compose --env-file .env.docker-test -p marsys-validation cp --index 1 api:/tmp/marsys-smoke.json .audit-smoke-result.json
node test/docker/http-smoke.mjs
```

El script de sesión exige la base desechable y cero usuarios la primera vez: crea una identidad sintética mediante el servicio interno, consume la precarga y verifica el cifrado. No constituye una prueba del callback real de Google. Para repetirlo en esa misma base usar `exec -e SMOKE_REUSE_USER=true`; no usarlo en otra base. El archivo `.audit-smoke-result.json` es privado y está excluido de Git/Docker; HTTP smoke revoca la sesión al finalizar.

Para dejar de consumir recursos sin perder datos: `docker compose --env-file .env.docker-test -p marsys-validation stop`. No usar `down -v` si se quieren conservar las bases/objetos de prueba.

Si Docker Desktop falla al exportar con `parent snapshot ... does not exist`, es un fallo del almacenamiento/caché de BuildKit, no un error de TypeScript. En esta validación se resolvió creando un builder `docker-container` exclusivo con `docker buildx create --name marsys-validation-builder --driver docker-container --bootstrap`, construyendo con `docker buildx build --builder marsys-validation-builder --load --target runner -t marsys-backend:local .` y eliminando solo ese builder al terminar. No se limpiaron imágenes ni volúmenes de otros proyectos.

## Resultados y límites

Validación local: builds Linux correctos, 21 migraciones desde cero, **571 pruebas unitarias/SQL**, **276 E2E HTTP** y **275 pruebas frontend** correctas. También se probaron dos réplicas API, TTL/cifrado/revocación de sesiones, reinicios, URLs firmadas, CORS del bucket privado, readiness ante caída del storage y restauración de PostgreSQL con descifrado PII.

La auditoría npm de dependencias de producción dio cero avisos en frontend y cero altos/críticos en backend. Permanecen dos avisos moderados de la cadena ExcelJS/uuid; no se aplicó una bajada mayor de ExcelJS ni un override incompatible de uuid para ocultarlos. Evaluar una actualización compatible y el camino afectado antes de la aprobación de seguridad. La imagen de mantenimiento incluye herramientas adicionales y no debe publicarse como servicio web.

La prueba local no instala Dokploy ni valida un servidor remoto, certificados, correo entregado ni credenciales OAuth reales. El endpoint local es `http://localhost`; no existe un bypass de autenticación para entrar con la cuenta sintética. Los respaldos locales prueban restaurabilidad, pero no sustituyen un destino externo ante pérdida de la VM.
