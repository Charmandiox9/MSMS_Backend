import { SetMetadata } from '@nestjs/common';

export const SKIP_TERMS_ACCEPTANCE = 'skipTermsAcceptance';

export const SkipTermsAcceptance = () =>
  SetMetadata(SKIP_TERMS_ACCEPTANCE, true);
