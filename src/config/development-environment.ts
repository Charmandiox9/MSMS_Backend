import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

export const developmentEnvironmentFile = '.env.development';

export function ignoreDevelopmentEnvironmentFile() {
  return (
    process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
  );
}

export function loadDevelopmentEnvironment() {
  if (
    !ignoreDevelopmentEnvironmentFile() &&
    existsSync(developmentEnvironmentFile)
  ) {
    loadEnvFile(developmentEnvironmentFile);
  }
}
