BEGIN;

-- CreateEnum
CREATE TYPE "EditorialKind" AS ENUM ('NEWS', 'GUIDE');

-- CreateEnum
CREATE TYPE "EditorialStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EditorialTopic" AS ENUM ('PLATFORM', 'JUSTIFICATIONS', 'DEPARTMENTS_CAREERS', 'SUBJECTS', 'TEACHERS', 'STUDENTS', 'PROJECTS', 'RESEARCH', 'ASSISTANTSHIPS', 'TITULATION', 'REPORTS_CHARTS', 'ADMINISTRATION');

-- CreateEnum
CREATE TYPE "EditorialDestination" AS ENUM ('DASHBOARD', 'JUSTIFICATIONS', 'CAREERS', 'SUBJECTS', 'TEACHERS', 'STUDENTS', 'PROJECTS', 'RESEARCH', 'RESEARCH_OUTPUTS', 'ASSISTANTSHIPS', 'TITULATION', 'REPORTS', 'CHARTS', 'SETTINGS');

-- CreateEnum
CREATE TYPE "EditorialFileKind" AS ENUM ('PDF', 'VIDEO', 'CAPTIONS');

-- CreateEnum
CREATE TYPE "EditorialLanguage" AS ENUM ('ES', 'EN');

-- CreateEnum
CREATE TYPE "EditorialFileStatus" AS ENUM ('PENDING', 'UPLOADING', 'READY', 'DELETING');

-- CreateEnum
CREATE TYPE "EditorialAction" AS ENUM ('CREATED', 'SAVED', 'PUBLISHED', 'ARCHIVED', 'FEATURED', 'UNFEATURED');

-- CreateTable
CREATE TABLE "EditorialEntry" (
    "id" TEXT NOT NULL,
    "kind" "EditorialKind" NOT NULL,
    "status" "EditorialStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstPublishedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "draftId" TEXT,
    "publishedId" TEXT,

    CONSTRAINT "EditorialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialRevision" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "topic" "EditorialTopic",
    "titleEs" TEXT NOT NULL DEFAULT '',
    "summaryEs" TEXT NOT NULL DEFAULT '',
    "bodyEs" TEXT NOT NULL DEFAULT '',
    "titleEn" TEXT,
    "summaryEn" TEXT,
    "bodyEn" TEXT,
    "destination" "EditorialDestination",
    "guideId" TEXT,

    CONSTRAINT "EditorialRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialFile" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "EditorialFileKind" NOT NULL,
    "language" "EditorialLanguage" NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "EditorialFileStatus" NOT NULL DEFAULT 'PENDING',
    "size" INTEGER,
    "duration" DOUBLE PRECISION,
    "videoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialEvent" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "EditorialAction" NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_EditorialFileToEditorialRevision" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EditorialFileToEditorialRevision_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "EditorialEntry_draftId_key" ON "EditorialEntry"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialEntry_publishedId_key" ON "EditorialEntry"("publishedId");

-- CreateIndex
CREATE INDEX "EditorialEntry_status_firstPublishedAt_id_idx" ON "EditorialEntry"("status", "firstPublishedAt", "id");

-- CreateIndex
CREATE INDEX "EditorialEntry_kind_status_firstPublishedAt_id_idx" ON "EditorialEntry"("kind", "status", "firstPublishedAt", "id");

-- CreateIndex
CREATE INDEX "EditorialRevision_guideId_idx" ON "EditorialRevision"("guideId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialRevision_entryId_number_key" ON "EditorialRevision"("entryId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialFile_key_key" ON "EditorialFile"("key");

-- CreateIndex
CREATE INDEX "EditorialFile_entryId_idx" ON "EditorialFile"("entryId");

-- CreateIndex
CREATE INDEX "EditorialFile_videoId_idx" ON "EditorialFile"("videoId");

-- CreateIndex
CREATE INDEX "EditorialFile_updatedAt_idx" ON "EditorialFile"("updatedAt");

-- CreateIndex
CREATE INDEX "EditorialEvent_entryId_createdAt_idx" ON "EditorialEvent"("entryId", "createdAt");

-- CreateIndex
CREATE INDEX "_EditorialFileToEditorialRevision_B_index" ON "_EditorialFileToEditorialRevision"("B");

-- AddForeignKey
ALTER TABLE "EditorialEntry" ADD CONSTRAINT "EditorialEntry_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "EditorialRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialEntry" ADD CONSTRAINT "EditorialEntry_publishedId_fkey" FOREIGN KEY ("publishedId") REFERENCES "EditorialRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialRevision" ADD CONSTRAINT "EditorialRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "EditorialEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialRevision" ADD CONSTRAINT "EditorialRevision_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "EditorialEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialFile" ADD CONSTRAINT "EditorialFile_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "EditorialEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialFile" ADD CONSTRAINT "EditorialFile_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "EditorialFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialEvent" ADD CONSTRAINT "EditorialEvent_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "EditorialEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EditorialFileToEditorialRevision" ADD CONSTRAINT "_EditorialFileToEditorialRevision_A_fkey" FOREIGN KEY ("A") REFERENCES "EditorialFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EditorialFileToEditorialRevision" ADD CONSTRAINT "_EditorialFileToEditorialRevision_B_fkey" FOREIGN KEY ("B") REFERENCES "EditorialRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "EditorialEntry_one_featured_news_idx"
ON "EditorialEntry" ("featured") WHERE "featured";

ALTER TABLE "EditorialEntry" ADD CONSTRAINT "EditorialEntry_featured_is_published_news_check"
CHECK (NOT "featured" OR ("kind" = 'NEWS' AND "status" = 'PUBLISHED'));

INSERT INTO "Permission" ("id", "code", "name", "description", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'EDITORIAL_CONTENT_MANAGE', 'Gestionar novedades y guías',
        'Redactar, previsualizar, publicar y archivar contenido editorial.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'EDITORIAL_CONTENT_MANAGE'
WHERE r."code" = 'SYSTEM_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;
