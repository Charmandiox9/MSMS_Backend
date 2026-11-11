# Simulación local de producción con Docker

Ejecutar desde `backend/`, con `frontend/` como carpeta hermana y Docker Linux activo.
La configuración de aplicación y secretos se toma de `.env.production`; las imágenes
se definen en `docker-compose.yml`. Los `.env` de desarrollo no se copian a las imágenes.

```powershell
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f api
```

Abrir http://localhost (puerto configurable mediante `NGINX_HTTP_PORT`). Registrar
el callback exacto de Google en el cliente OAuth. Los servicios de desarrollo
pueden seguir usando sus propios `.env` y puertos.

El build del backend instala dependencias, ejecuta `prisma generate` y `npm run build`.
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
docker compose --env-file .env.production stop
# Eliminar contenedores y red, conservando los volúmenes.
docker compose --env-file .env.production down
```

No usar `down -v` si se necesitan los datos. Las pruebas opcionales se conservan
bajo el perfil `test`; usar `.env.docker-test`, nunca la base con datos reales.
