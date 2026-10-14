BEGIN;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailHash" TEXT,
ADD COLUMN     "googleIdHash" TEXT,
ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Teacher" ADD COLUMN     "emailHash" TEXT,
ADD COLUMN     "employeeCodeHash" TEXT,
ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rutHash" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "emailHash" TEXT,
ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TeachingAssistant" ADD COLUMN     "emailHash" TEXT,
ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "studentCodeHash" TEXT;

-- AlterTable
ALTER TABLE "JustificationInbox" ADD COLUMN     "externalResponseIdHash" TEXT,
ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "studentEmailHash" TEXT;

-- AlterTable
ALTER TABLE "Justification" ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceResponseIdHash" TEXT,
ADD COLUMN     "studentEmailHash" TEXT;

-- AlterTable
ALTER TABLE "JustificationStatusHistory" ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PreloadedUser" ADD COLUMN     "emailHash" TEXT,
ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProjectParticipant" ADD COLUMN     "nameHash" TEXT,
ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Research" ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ResearchParticipant" ADD COLUMN     "nameHash" TEXT,
ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ResearchOutput" ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ResearchOutputAuthor" ADD COLUMN     "piiVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleIdHash_key" ON "User"("googleIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_emailHash_key" ON "Teacher"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_employeeCodeHash_key" ON "Teacher"("employeeCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_rutHash_key" ON "Teacher"("rutHash");

-- CreateIndex
CREATE UNIQUE INDEX "Student_emailHash_key" ON "Student"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssistant_emailHash_key" ON "TeachingAssistant"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssistant_studentCodeHash_key" ON "TeachingAssistant"("studentCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "JustificationInbox_externalResponseIdHash_key" ON "JustificationInbox"("externalResponseIdHash");

-- CreateIndex
CREATE INDEX "JustificationInbox_studentEmailHash_idx" ON "JustificationInbox"("studentEmailHash");

-- CreateIndex
CREATE UNIQUE INDEX "Justification_sourceResponseIdHash_key" ON "Justification"("sourceResponseIdHash");

-- CreateIndex
CREATE INDEX "Justification_studentEmailHash_idx" ON "Justification"("studentEmailHash");

-- CreateIndex
CREATE UNIQUE INDEX "PreloadedUser_emailHash_key" ON "PreloadedUser"("emailHash");

-- CreateIndex
CREATE INDEX "ProjectParticipant_nameHash_idx" ON "ProjectParticipant"("nameHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectParticipant_projectId_nameHash_role_key" ON "ProjectParticipant"("projectId", "nameHash", "role");

-- CreateIndex
CREATE INDEX "ResearchParticipant_nameHash_idx" ON "ResearchParticipant"("nameHash");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchParticipant_researchId_nameHash_role_key" ON "ResearchParticipant"("researchId", "nameHash", "role");

-- Fine-grained repository permissions supplement the existing academic matrix.
INSERT INTO "Permission" ("id", "code", "name", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'ACADEMIC_REPOSITORY_VIEW', 'Consultar repositorio académico y profesores hora', 'Profesores, proyectos, investigaciones y pagos PH', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ACADEMIC_REPOSITORY_MANAGE', 'Gestionar repositorio académico y profesores hora', 'Crear y editar profesores, proyectos, investigaciones y pagos PH', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."code" IN ('SYSTEM_ADMIN', 'ACADEMIC_SECRETARY', 'ACADEMIC_PROCESS_ANALYST')
AND p."code" IN ('ACADEMIC_REPOSITORY_VIEW', 'ACADEMIC_REPOSITORY_MANAGE')
ON CONFLICT DO NOTHING;

-- No keys or plaintext-to-ciphertext conversions belong in SQL migrations.
-- Run scripts/backfill-pii.ts in the approved maintenance environment afterwards.
COMMIT;
