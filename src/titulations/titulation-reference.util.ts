import type { TitulationDraftKind } from './titulation-drafts';

export function createTitulationReference(id: string, createdAt: Date): string {
  return `TIT-${createdAt.getFullYear()}-${id.slice(0, 8).toUpperCase()}`;
}

export function createTitulationDraftFilename(
  id: string,
  createdAt: Date,
  kind: TitulationDraftKind,
): string {
  return `${createTitulationReference(id, createdAt)}-${kind}.docx`;
}
