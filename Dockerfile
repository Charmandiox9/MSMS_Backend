# 1. Base stage (Builder)
FROM node:20-alpine AS builder

WORKDIR /app

# Copiamos los archivos de dependencias y la carpeta prisma
COPY package*.json ./
COPY prisma ./prisma/

# Instalamos las dependencias
RUN npm ci

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

# El comando de inicio por defecto
# Nota: Si necesitas aplicar migraciones en producción, 
# considera usar 'npx prisma migrate deploy' en tu pipeline o entrypoint
CMD ["npm", "run", "start:prod"]
