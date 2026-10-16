import { isSessionMutationAllowed } from './http-security';

describe('session mutation origin', () => {
  const front = 'https://marsys.example.test';
  it('allows authenticated same-origin mutations', () =>
    expect(
      isSessionMutationAllowed('POST', 'session=opaque', front, front),
    ).toBe(true));
  it.each([undefined, 'https://attacker.example.test', 'null'])(
    'rejects missing or foreign origin %s with session cookie',
    (origin) =>
      expect(
        isSessionMutationAllowed(
          'POST',
          'other=1; session=opaque',
          origin,
          front,
        ),
      ).toBe(false),
  );
  it('preserves server webhooks without session cookies', () =>
    expect(isSessionMutationAllowed('POST', undefined, undefined, front)).toBe(
      true,
    ));
  it('allows reads', () =>
    expect(
      isSessionMutationAllowed('GET', 'session=opaque', undefined, front),
    ).toBe(true));
});
