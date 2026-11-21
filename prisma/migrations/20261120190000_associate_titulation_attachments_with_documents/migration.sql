CREATE TYPE "TitulationDocumentKind" AS ENUM (
  'DEFENSE_ANNEXES',
  'THESIS_SUMMARY',
  'LIBRARY_FORM',
  'ACTA',
  'EVALUATIONS'
);

ALTER TABLE "TitulationAttachment"
ADD COLUMN "documentKind" "TitulationDocumentKind";
