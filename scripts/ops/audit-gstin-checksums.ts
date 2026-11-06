import { db } from '../../lib/db/client';
import { customers, businesses } from '../../lib/db/schema';
import { isNotNull } from 'drizzle-orm';
import { isValidGstinChecksum } from '../../lib/gst/gstin';

interface InvalidGstinRecord {
  id: string;
  statePrefix: string;
}

export async function runGstinAudit(): Promise<{
  customersChecked: number;
  customersValid: number;
  customersInvalid: number;
  businessesChecked: number;
  businessesValid: number;
  businessesInvalid: number;
  invalidCustomers: InvalidGstinRecord[];
  invalidBusinesses: InvalidGstinRecord[];
}> {
  const customerRows = await db
    .select({
      id: customers.id,
      gstin: customers.gstin,
    })
    .from(customers)
    .where(isNotNull(customers.gstin));

  let customersValid = 0;
  let customersInvalid = 0;
  const invalidCustomers: InvalidGstinRecord[] = [];

  for (const row of customerRows) {
    const rawGstin = row.gstin;
    if (rawGstin && isValidGstinChecksum(rawGstin)) {
      customersValid += 1;
    } else {
      customersInvalid += 1;
      invalidCustomers.push({
        id: row.id,
        statePrefix: rawGstin ? rawGstin.slice(0, 2) : '??',
      });
    }
  }

  const businessRows = await db
    .select({
      id: businesses.id,
      gstin: businesses.gstin,
    })
    .from(businesses);

  let businessesValid = 0;
  let businessesInvalid = 0;
  const invalidBusinesses: InvalidGstinRecord[] = [];

  for (const row of businessRows) {
    const rawGstin = row.gstin;
    if (rawGstin && isValidGstinChecksum(rawGstin)) {
      businessesValid += 1;
    } else {
      businessesInvalid += 1;
      invalidBusinesses.push({
        id: row.id,
        statePrefix: rawGstin ? rawGstin.slice(0, 2) : '??',
      });
    }
  }

  return {
    customersChecked: customerRows.length,
    customersValid,
    customersInvalid,
    businessesChecked: businessRows.length,
    businessesValid,
    businessesInvalid,
    invalidCustomers,
    invalidBusinesses,
  };
}

async function main(): Promise<void> {
  try {
    process.stdout.write('Starting GSTIN checksum audit...\n');
    const results = await runGstinAudit();

    process.stdout.write(`\n--- Customers ---\n`);
    process.stdout.write(`Total checked: ${results.customersChecked}\n`);
    process.stdout.write(`Valid:         ${results.customersValid}\n`);
    process.stdout.write(`Invalid:       ${results.customersInvalid}\n`);
    if (results.invalidCustomers.length > 0) {
      process.stdout.write(`Invalid customer IDs and state prefixes:\n`);
      for (const rec of results.invalidCustomers) {
        process.stdout.write(`  ID: ${rec.id}, State prefix: ${rec.statePrefix}**\n`);
      }
    }

    process.stdout.write(`\n--- Businesses ---\n`);
    process.stdout.write(`Total checked: ${results.businessesChecked}\n`);
    process.stdout.write(`Valid:         ${results.businessesValid}\n`);
    process.stdout.write(`Invalid:       ${results.businessesInvalid}\n`);
    if (results.invalidBusinesses.length > 0) {
      process.stdout.write(`Invalid business IDs and state prefixes:\n`);
      for (const rec of results.invalidBusinesses) {
        process.stdout.write(`  ID: ${rec.id}, State prefix: ${rec.statePrefix}**\n`);
      }
    }

    process.stdout.write('\nAudit complete.\n');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Audit failed with error: ${message}\n`);
  } finally {
    process.exit(0);
  }
}

if (require.main === module || (typeof process.env.TSX_ENTRY === 'string' && process.env.TSX_ENTRY.includes('audit-gstin-checksums'))) {
  void main();
}
