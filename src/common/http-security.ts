export function isSessionMutationAllowed(
  method: string,
  cookie: string | undefined,
  origin: string | undefined,
  frontendUrl: string,
): boolean {
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(method) ||
    !/(?:^|;\s*)session=/.test(cookie ?? '')
  )
    return true;
  return origin === new URL(frontendUrl).origin;
}
