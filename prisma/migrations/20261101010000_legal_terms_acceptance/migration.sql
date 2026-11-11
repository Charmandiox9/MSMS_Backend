BEGIN;

CREATE TABLE "LegalTermsAcceptance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "contentSnapshot" JSONB NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalTermsAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalTermsAcceptance_userId_version_key"
  ON "LegalTermsAcceptance"("userId", "version");
CREATE INDEX "LegalTermsAcceptance_userId_acceptedAt_idx"
  ON "LegalTermsAcceptance"("userId", "acceptedAt");

ALTER TABLE "LegalTermsAcceptance"
  ADD CONSTRAINT "LegalTermsAcceptance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
