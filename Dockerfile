# 1. Base stage (Builder)
FROM node:20-alpine AS builder

WORKDIR /app

# Copiamos los archivos de dependencias y la carpeta prisma
COPY package*.json ./
COPY prisma ./prisma/

# Instalamos las dependencias dentro de Alpine para que npm resuelva también
# los paquetes opcionales nativos de Linux usados por el contenedor.
RUN npm install

# Generamos el Prisma Client
RUN npx prisma generate

# Copiamos el resto del código
COPY . .

# Construimos la aplicación NestJS
RUN npm run build

# 2. Production stage
FROM node:20-alpine

WORKDIR /app

# Copiamos las dependencias instaladas y los compilados del paso anterior
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# Aplicamos las migraciones pendientes antes de iniciar NestJS.
# Si una migración falla, el contenedor no arranca con un esquema inconsistente.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]
