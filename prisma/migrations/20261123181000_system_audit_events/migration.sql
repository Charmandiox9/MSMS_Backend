-- CreateEnum
CREATE TYPE "SystemAuditAction" AS ENUM ('PRELOAD_CREATED', 'PRELOAD_CANCELLED', 'ROLE_ASSIGNED', 'ROLE_REVOKED', 'ACCOUNT_ACTIVATED', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_DELETED');

-- CreateTable
CREATE TABLE "SystemAuditEvent" (
    "id" TEXT NOT NULL,
    "action" "SystemAuditAction" NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "roleCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemAuditEvent_createdAt_id_idx" ON "SystemAuditEvent"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "SystemAuditEvent_action_createdAt_id_idx" ON "SystemAuditEvent"("action", "createdAt" DESC, "id" DESC);
