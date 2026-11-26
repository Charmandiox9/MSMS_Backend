# Simulación local de producción con Docker

Ejecutar desde `backend/`, con `frontend/` como carpeta hermana y Docker Linux activo.
Docker local toma su configuración de `.env.docker-test`. Si aún no existe,
créalo con `node scripts/create-docker-test-env.mjs`. El backend en desarrollo
lee por separado `.env.development`.

Para levantar solo PostgreSQL, Redis y MinIO, incluida la inicialización del bucket:

```powershell
docker compose --env-file .env.docker-test -p marsys-validation up -d db redis minio storage-init
docker compose --env-file .env.docker-test -p marsys-validation ps -a
```

`storage-init` debe terminar con código 0. Para conectar Nest desde Windows,
publica los puertos de PostgreSQL y Redis en `127.0.0.1` con un archivo adicional
de Compose y define en la consola las URLs y claves PII de la base de Docker.
La API de MinIO ya se publica en loopback con `S3_TEST_PORT`. Arrancar Docker
conserva la configuración habitual de `.env.development`.

Para levantar también la aplicación:

```powershell
docker compose --env-file .env.docker-test -p marsys-validation config --quiet
docker compose --env-file .env.docker-test -p marsys-validation up -d --build
docker compose --env-file .env.docker-test -p marsys-validation ps
docker compose --env-file .env.docker-test -p marsys-validation logs -f api
```

Abrir http://localhost (puerto configurable mediante `NGINX_HTTP_PORT`). Registrar
el callback exacto de Google en el cliente OAuth. Los servicios de desarrollo
pueden seguir usando `.env.development` y sus propios puertos.

El build del backend ejecuta `pnpm install --frozen-lockfile`, `pnpm exec prisma generate` y `pnpm run build`.
Al iniciar, espera PostgreSQL saludable, Redis y la inicialización del bucket;
el entrypoint ejecuta `prisma migrate deploy`, el bootstrap opcional y finalmente
`node dist/main.js`. Si migrar falla, no inicia la API. No se migra durante el build:
la imagen se construye sin conexión a la base ni credenciales de runtime.

El target predeterminado `runner` incluye migraciones y es adecuado para esta
simulación con una réplica. `dokploy` conserva el mismo comportamiento.
Para despliegues con migración separada, usar `migration` y el target ligero `runtime`.

El frontend compila con `/api/graphql` y ejecuta el servidor standalone de Next.js.
Nginx espera ambos servicios saludables y expone una única entrada en loopback.
PostgreSQL, Redis y MinIO conservan los datos en volúmenes. Las imágenes históricas
de MinIO fijadas por digest se usan exclusivamente para compatibilidad local.

```powershell
# Detener conservando los datos.
docker compose --env-file .env.docker-test -p marsys-validation stop
# Eliminar contenedores y red, conservando los volúmenes.
docker compose --env-file .env.docker-test -p marsys-validation down
```

No usar `down -v` si se necesitan los datos. Las pruebas opcionales se conservan
bajo el perfil `test`; usar `.env.docker-test`, nunca la base con datos reales.
