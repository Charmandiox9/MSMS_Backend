CREATE TABLE "TitulationAttachment" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(128) NOT NULL,
    "size" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TitulationAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TitulationAttachment_storageKey_key"
    ON "TitulationAttachment"("storageKey");

CREATE INDEX "TitulationAttachment_processId_createdAt_idx"
    ON "TitulationAttachment"("processId", "createdAt");

CREATE INDEX "TitulationAttachment_createdById_idx"
    ON "TitulationAttachment"("createdById");

ALTER TABLE "TitulationAttachment"
    ADD CONSTRAINT "TitulationAttachment_processId_fkey"
    FOREIGN KEY ("processId") REFERENCES "TitulationProcess"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TitulationAttachment"
    ADD CONSTRAINT "TitulationAttachment_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
