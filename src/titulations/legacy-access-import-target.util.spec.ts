import {
  isLocalDatabase,
  isSameDatabaseEndpoint,
  parseEnvironmentValue,
} from './legacy-access-import-target.util';

describe('legacy Access import destination', () => {
  it('parses quoted environment values without interpreting credentials', () => {
    expect(
      parseEnvironmentValue(
        '# DATABASE_URL=ignored\nDATABASE_URL="postgresql://role:secret@localhost:5432/msms"',
        'DATABASE_URL',
      ),
    ).toBe('postgresql://role:secret@localhost:5432/msms');
  });

  it('recognizes local database hosts', () => {
    expect(
      isLocalDatabase('postgresql://role:secret@127.0.0.1:5432/msms'),
    ).toBe(true);
    expect(
      isLocalDatabase(
        'postgresql://role:secret@ep-dev-pooler.us-east-1.aws.neon.tech/msms',
      ),
    ).toBe(false);
  });

  it('accepts pooled and direct connection strings for the same dev database', () => {
    expect(
      isSameDatabaseEndpoint(
        'postgresql://role:secret@ep-dev-pooler.us-east-1.aws.neon.tech/msms',
        'postgresql://role:secret@ep-dev.us-east-1.aws.neon.tech/msms',
      ),
    ).toBe(true);
  });

  it('rejects a different branch, database, or role as a dev target', () => {
    const configured =
      'postgresql://role:secret@ep-dev.us-east-1.aws.neon.tech/msms';

    expect(
      isSameDatabaseEndpoint(
        'postgresql://role:secret@ep-production.us-east-1.aws.neon.tech/msms',
        configured,
      ),
    ).toBe(false);
    expect(
      isSameDatabaseEndpoint(
        'postgresql://role:secret@ep-dev.us-east-1.aws.neon.tech/other',
        configured,
      ),
    ).toBe(false);
    expect(
      isSameDatabaseEndpoint(
        'postgresql://other-role:secret@ep-dev.us-east-1.aws.neon.tech/msms',
        configured,
      ),
    ).toBe(false);
  });
});
