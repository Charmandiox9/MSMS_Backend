import { resolveCareer } from './career-match';

describe('resolveCareer', () => {
  const careers = [
    { id: 'first', code: 'BM1', name: 'Ingeniería Marina' },
    { id: 'second', code: 'BM2', name: 'Ingenieria Marina' },
  ];

  it('does not resolve ambiguous or partial names', () => {
    expect(resolveCareer(careers, null, 'Ing. Marina')).toBeUndefined();
    expect(resolveCareer(careers, null, 'Marina')).toBeUndefined();
  });

  it('uses a unique code before the imported name', () => {
    expect(resolveCareer(careers, ' bm2 ', 'Ing. Marina')).toBe(careers[1]);
  });
});
