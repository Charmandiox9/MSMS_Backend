import { normalizePiiSearch } from '../privacy/pii-policy';

export enum TitulationDraftKind {
  DEFENSE_ANNEXES = 'defense-annexes',
  THESIS_SUMMARY = 'thesis-summary',
  LIBRARY_AUTHORIZATION = 'library-authorization',
}

export function availableTitulationDrafts(
  careerName: string,
): TitulationDraftKind[] {
  return normalizePiiSearch(careerName) === 'biologia marina'
    ? [
        TitulationDraftKind.DEFENSE_ANNEXES,
        TitulationDraftKind.THESIS_SUMMARY,
        TitulationDraftKind.LIBRARY_AUTHORIZATION,
      ]
    : [];
}
