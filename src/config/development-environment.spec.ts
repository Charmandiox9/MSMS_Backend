import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { loadDevelopmentEnvironment } from './development-environment';

jest.mock('node:fs', () => ({ existsSync: jest.fn() }));
jest.mock('node:process', () => ({ loadEnvFile: jest.fn() }));

describe('loadDevelopmentEnvironment', () => {
  beforeEach(() => jest.mocked(existsSync).mockReturnValue(true));
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('loads the single development file', () => {
    jest.replaceProperty(process, 'env', { NODE_ENV: 'development' });

    loadDevelopmentEnvironment();

    expect(existsSync).toHaveBeenCalledWith('.env.development');
    expect(loadEnvFile).toHaveBeenCalledWith('.env.development');
  });

  it.each(['production', 'test'])(
    'uses only injected variables in %s',
    (mode) => {
      jest.replaceProperty(process, 'env', { NODE_ENV: mode });

      loadDevelopmentEnvironment();

      expect(existsSync).not.toHaveBeenCalled();
      expect(loadEnvFile).not.toHaveBeenCalled();
    },
  );

  it('allows injected variables when there is no local file', () => {
    jest.replaceProperty(process, 'env', {});
    jest.mocked(existsSync).mockReturnValue(false);

    loadDevelopmentEnvironment();

    expect(loadEnvFile).not.toHaveBeenCalled();
  });
});
