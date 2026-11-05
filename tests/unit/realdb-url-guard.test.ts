import { describe, expect, it } from 'vitest';
import {
  parseDbIdentity,
  validateTestDatabaseUrl,
} from '@/tests/realdb/helpers/url-guard';

describe('RealDB URL Guard (TEST-002)', () => {
  it('throws helpful error when TEST_DATABASE_URL is not set', () => {
    expect(() => validateTestDatabaseUrl(undefined)).toThrow(
      'TEST_DATABASE_URL is not set. Real-database tests never skip.',
    );
    expect(() => validateTestDatabaseUrl('')).toThrow(
      'TEST_DATABASE_URL is not set. Real-database tests never skip.',
    );
  });

  it('throws on malformed database connection string', () => {
    expect(() => validateTestDatabaseUrl('not-a-valid-url')).toThrow();
  });

  it('refuses test URL targeting same host and database as DATABASE_URL', () => {
    const prodUrl = 'postgresql://user:pass@ep-cool-flower-123456.us-east-2.aws.neon.tech/bill_matrix_prod';
    const testUrl = 'postgresql://user:pass@ep-cool-flower-123456.us-east-2.aws.neon.tech/bill_matrix_prod';

    expect(() =>
      validateTestDatabaseUrl(testUrl, {
        DATABASE_URL: prodUrl,
        TEST_DATABASE_IS_DISPOSABLE: '1',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow('REFUSING TO RUN: TEST_DATABASE_URL targets the same host and database');
  });

  it('normalises Neon pooled host (-pooler) and refuses matching endpoint+db', () => {
    const prodPooledUrl =
      'postgresql://user:pass@ep-cool-flower-123456-pooler.us-east-2.aws.neon.tech/bill_matrix_prod';
    const testDirectUrl =
      'postgresql://user:pass@ep-cool-flower-123456.us-east-2.aws.neon.tech/bill_matrix_prod';

    expect(() =>
      validateTestDatabaseUrl(testDirectUrl, {
        DATABASE_URL: prodPooledUrl,
        TEST_DATABASE_IS_DISPOSABLE: '1',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow('REFUSING TO RUN: TEST_DATABASE_URL targets the same host and database');
  });

  it('allows same host if database is different', () => {
    const prodUrl = 'postgresql://user:pass@ep-cool-flower-123456.us-east-2.aws.neon.tech/bill_matrix_prod';
    const testUrl = 'postgresql://user:pass@ep-cool-flower-123456.us-east-2.aws.neon.tech/disposable_test_branch';

    const validated = validateTestDatabaseUrl(testUrl, {
      DATABASE_URL: prodUrl,
      TEST_DATABASE_IS_DISPOSABLE: '1',
    } as unknown as NodeJS.ProcessEnv);

    expect(validated).toBe(testUrl);
  });

  it('allows localhost and local IP addresses without TEST_DATABASE_IS_DISPOSABLE=1', () => {
    const local1 = 'postgresql://postgres:postgres@localhost:54329/bm_test';
    const local2 = 'postgresql://postgres:postgres@127.0.0.1:5432/bm_test';
    const local3 = 'postgresql://postgres:postgres@[::1]:5432/bm_test';

    expect(validateTestDatabaseUrl(local1, {} as NodeJS.ProcessEnv)).toBe(local1);
    expect(validateTestDatabaseUrl(local2, {} as NodeJS.ProcessEnv)).toBe(local2);
    expect(validateTestDatabaseUrl(local3, {} as NodeJS.ProcessEnv)).toBe(local3);
  });

  it('refuses remote host unless TEST_DATABASE_IS_DISPOSABLE=1 is explicitly set', () => {
    const remoteUrl = 'postgresql://user:pass@remote-postgres.example.com:5432/test_db';

    expect(() => validateTestDatabaseUrl(remoteUrl, {} as NodeJS.ProcessEnv)).toThrow(
      'REFUSING TO RUN against a non-local host. If this is a DISPOSABLE Neon branch, set TEST_DATABASE_IS_DISPOSABLE=1.',
    );

    expect(
      validateTestDatabaseUrl(remoteUrl, {
        TEST_DATABASE_IS_DISPOSABLE: '1',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(remoteUrl);
  });

  it('ignores unset or garbage DATABASE_URL safely', () => {
    const localUrl = 'postgresql://postgres:postgres@localhost:54329/bm_test';
    expect(
      validateTestDatabaseUrl(localUrl, {
        DATABASE_URL: 'garbage-invalid-string',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(localUrl);
  });
});

