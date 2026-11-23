BEGIN;

-- AlterTable
ALTER TABLE "EditorialEntry" ADD COLUMN     "featuredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EditorialRevisionRole" (
    "revisionId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "EditorialRevisionRole_pkey" PRIMARY KEY ("revisionId","roleId")
);

-- CreateIndex
CREATE INDEX "EditorialRevisionRole_roleId_revisionId_idx" ON "EditorialRevisionRole"("roleId", "revisionId");

-- AddForeignKey
ALTER TABLE "EditorialRevisionRole" ADD CONSTRAINT "EditorialRevisionRole_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "EditorialRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialRevisionRole" ADD CONSTRAINT "EditorialRevisionRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "EditorialEntry_one_featured_news_idx";
UPDATE "EditorialEntry" SET "featuredAt" = COALESCE("publishedAt", "updatedAt") WHERE "featured";
COMMIT;
