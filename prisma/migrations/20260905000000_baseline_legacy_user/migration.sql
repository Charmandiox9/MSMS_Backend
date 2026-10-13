-- Línea base previa a las migraciones.
-- La base original se creó con `prisma db push` (enum "Role" + tabla "User") antes de
-- versionar migraciones, y 20260906000000_implement_rbac_users_roles_permissions parte
-- renombrando ese enum. Sin esta línea base, `prisma migrate deploy` falla en una base
-- vacía con `type "Role" does not exist`.
-- Es idempotente: en bases existentes (donde "Role" ya es una tabla y "User" existe)
-- no hace nada y Prisma solo la registra como aplicada.

-- CreateEnum
DO $$
BEGIN
    -- Cualquier tipo llamado "Role" (el enum original o el tipo fila de la tabla "Role")
    -- indica que la base ya pasó por esta etapa.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'Role' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "Role" AS ENUM ('SYSTEM_ADMIN', 'FACULTY_ADMIN', 'STAFF', 'PROFESSOR', 'STUDENT', 'VEHICLE_MANAGER', 'LAB_MANAGER', 'TRACKING_MANAGER');
    END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "googleId" TEXT,
    "roles" "Role"[] DEFAULT ARRAY['STUDENT']::"Role"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId");
