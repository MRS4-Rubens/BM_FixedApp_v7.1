import { Writable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import type { Gstr1ExportData, Gstr1B2bRow, Gstr1B2csRow, Gstr1CdnrRow, Gstr1HsnRow } from '@/lib/actions/reports/get-gstr1-data';
import { writeGstr1Workbook } from '@/lib/excel/build-gstr1-report';

class ByteCountingWritable extends Writable {
  bytesWritten = 0;

  override _write(
    chunk: Buffer | Uint8Array,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.bytesWritten += chunk.length;
    callback();
  }
}

async function runBenchmark(): Promise<void> {
  console.log('Generating synthetic dataset (100,000 line items)...');

  const b2bRows: Gstr1B2bRow[] = [];
  const b2csRows: Gstr1B2csRow[] = [];
  const cdnrRows: Gstr1CdnrRow[] = [];
  const hsnRows: Gstr1HsnRow[] = [];

  const invoiceCount = 10000;
  const linesPerInvoice = 9; // 90,000 B2B line items
  const b2csCount = 5000;    // 5,000 B2CS line items
  const cdnrCount = 5000;    // 5,000 CDNR line items

  let totalTaxablePaise = 0;
  let totalTaxPaise = 0;
  let totalInvoiceValuePaise = 0;

  // Generate B2B lines
  for (let i = 1; i <= invoiceCount; i++) {
    const invNum = `INV-2026-${String(i).padStart(6, '0')}`;
    const gstin = `27ABCDE${String(1000 + (i % 8000)).padStart(4, '0')}F1Z${(i % 9) + 1}`;
    const stateCode = '27';
    const placeOfSupply = `${stateCode}-Maharashtra`;
    const rate = [5, 12, 18, 28][i % 4];
    const taxablePerLine = 10000; // ₹100.00
    const taxPerLine = Math.round((taxablePerLine * rate) / 100);
    const invoiceValue = (taxablePerLine + taxPerLine) * linesPerInvoice;

    for (let l = 1; l <= linesPerInvoice; l++) {
      b2bRows.push({
        recipientGstin: gstin,
        receiverName: `Enterprise Buyer ${i % 500}`,
        invoiceNumber: invNum,
        invoiceDate: '01-Nov-2026',
        invoiceValuePaise: invoiceValue,
        placeOfSupply,
        reverseCharge: 'N',
        applicableTaxRatePercent: '',
        invoiceType: 'Regular',
        eCommerceGstin: '',
        ratePercentage: rate,
        taxableValuePaise: taxablePerLine,
        cessAmountPaise: 0,
      });

      totalTaxablePaise += taxablePerLine;
      totalTaxPaise += taxPerLine;
    }
    totalInvoiceValuePaise += invoiceValue;
  }

  // Generate B2CS lines
  for (let i = 1; i <= b2csCount; i++) {
    const rate = [5, 12, 18, 28][i % 4];
    const taxable = 5000; // ₹50.00
    const tax = Math.round((taxable * rate) / 100);

    b2csRows.push({
      type: 'OE',
      placeOfSupply: '29-Karnataka',
      applicableTaxRatePercent: '',
      ratePercentage: rate,
      taxableValuePaise: taxable,
      cessAmountPaise: 0,
      eCommerceGstin: '',
    });

    totalTaxablePaise += taxable;
    totalTaxPaise += tax;
    totalInvoiceValuePaise += taxable + tax;
  }

  // Generate CDNR lines
  for (let i = 1; i <= cdnrCount; i++) {
    const noteNum = `CN-2026-${String(i).padStart(5, '0')}`;
    const gstin = `29XYZAB${String(1000 + (i % 8000)).padStart(4, '0')}C1Z${(i % 9) + 1}`;
    const rate = [5, 12, 18, 28][i % 4];
    const taxable = 2000; // ₹20.00
    const tax = Math.round((taxable * rate) / 100);
    const noteValue = taxable + tax;

    cdnrRows.push({
      recipientGstin: gstin,
      receiverName: `Commercial Customer ${i % 200}`,
      noteNumber: noteNum,
      noteDate: '05-Nov-2026',
      noteType: 'C',
      placeOfSupply: '29-Karnataka',
      reverseCharge: 'N',
      noteSupplyType: 'Regular',
      noteValuePaise: noteValue,
      applicableTaxRatePercent: '',
      ratePercentage: rate,
      taxableValuePaise: taxable,
      cessAmountPaise: 0,
    });
  }

  // Generate HSN summary rows (aggregated by code and rate)
  hsnRows.push({
    hsnSacCode: '998313',
    description: 'IT consulting and support services',
    uqc: 'NA',
    totalQuantity: 100000,
    totalValuePaise: totalInvoiceValuePaise,
    ratePercentage: 18,
    taxableValuePaise: totalTaxablePaise,
    integratedTaxPaise: totalTaxPaise,
    centralTaxPaise: 0,
    stateUtTaxPaise: 0,
    cessAmountPaise: 0,
  });

  const totalLines = b2bRows.length + b2csRows.length + cdnrRows.length;
  console.log(`Dataset generated: ${totalLines.toLocaleString()} line items across ${invoiceCount.toLocaleString()} B2B invoices, ${b2csCount.toLocaleString()} B2CS rows, and ${cdnrCount.toLocaleString()} CDNR rows.`);

  const syntheticData: Gstr1ExportData = {
    business: {
      legal_name: 'Bill Matrix Technologies Private Limited',
      trade_name: 'Bill Matrix',
      gstin: '29ABCDE1234F1Z5',
      state_code: '29',
    },
    label: 'FY-2026-27-FullYear',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    b2b: b2bRows,
    b2cl: [],
    b2cs: b2csRows,
    cdnr: cdnrRows,
    cdnur: [],
    hsn: hsnRows,
    docs: [
      {
        natureOfDocument: 'Invoices for outward supply',
        srNoFrom: 'INV-2026-000001',
        srNoTo: `INV-2026-${String(invoiceCount).padStart(6, '0')}`,
        totalNumber: invoiceCount,
        cancelled: 0,
        netIssued: invoiceCount,
      },
      {
        natureOfDocument: 'Credit Note',
        srNoFrom: 'CN-2026-00001',
        srNoTo: `CN-2026-${String(cdnrCount).padStart(5, '0')}`,
        totalNumber: cdnrCount,
        cancelled: 0,
        netIssued: cdnrCount,
      },
    ],
    summary: {
      b2bCount: invoiceCount,
      b2bTaxablePaise: totalTaxablePaise,
      b2bTaxPaise: totalTaxPaise,
      b2clCount: 0,
      b2clTaxablePaise: 0,
      b2clTaxPaise: 0,
      b2csCount: b2csCount,
      b2csTaxablePaise: b2csCount * 5000,
      b2csTaxPaise: b2csCount * 900,
      cdnrCount: cdnrCount,
      cdnrTaxablePaise: cdnrCount * 2000,
      cdnrTaxPaise: cdnrCount * 360,
      cdnurCount: 0,
      cdnurTaxablePaise: 0,
      cdnurTaxPaise: 0,
      totalTaxablePaise,
      totalCgstPaise: 0,
      totalSgstPaise: 0,
      totalIgstPaise: totalTaxPaise,
      totalTaxPaise,
      totalInvoiceValuePaise,
    },
  };

  // Memory sampling setup
  let peakRss = 0;
  let peakHeapUsed = 0;

  const sampleMemory = () => {
    const mem = process.memoryUsage();
    if (mem.rss > peakRss) peakRss = mem.rss;
    if (mem.heapUsed > peakHeapUsed) peakHeapUsed = mem.heapUsed;
  };

  sampleMemory();
  const timer = setInterval(sampleMemory, 50);

  try {
    // PERF-002b: one phase - the streaming WorkbookWriter builds and writes rows in a single
    // pass, committing each row into the output stream as soon as it is written.
    console.log('Streaming GSTR-1 workbook through ExcelJS WorkbookWriter...');
    const baselineRss = process.memoryUsage().rss;
    const t0 = performance.now();
    const byteCounter = new ByteCountingWritable();
    await writeGstr1Workbook(syntheticData, byteCounter);
    const totalMs = Math.round(performance.now() - t0);
    console.log(`Stream complete in ${totalMs} ms.`);

    clearInterval(timer);
    sampleMemory();

    const toMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);

    console.log('\n================ PERF-002b BENCHMARK RESULTS (streaming WorkbookWriter) ================');
    console.log(`Line items:       ${totalLines.toLocaleString()}`);
    console.log(`B2B invoices:     ${invoiceCount.toLocaleString()}`);
    console.log(`RSS before write: ${toMb(baselineRss)} MB (synthetic dataset already in memory)`);
    console.log(`Total elapsed:    ${totalMs.toLocaleString()} ms (${(totalMs / 1000).toFixed(2)} s)`);
    console.log(`Output size:      ${byteCounter.bytesWritten.toLocaleString()} bytes (${toMb(byteCounter.bytesWritten)} MB)`);
    console.log(`Peak RSS:         ${toMb(peakRss)} MB`);
    console.log(`Peak Heap Used:   ${toMb(peakHeapUsed)} MB`);
    console.log('============================================================\n');

    if (peakRss > 512 * 1024 * 1024) {
      console.warn(`WARNING: Peak RSS exceeded 512 MB (${toMb(peakRss)} MB).`);
    } else {
      console.log(`PASS: Peak RSS is within 512 MB threshold (${toMb(peakRss)} MB).`);
    }

    if (totalMs > 45000) {
      console.warn(`WARNING: Total time exceeded 45 s (${(totalMs / 1000).toFixed(2)} s).`);
    } else {
      console.log(`PASS: Total duration is within 45 s threshold (${(totalMs / 1000).toFixed(2)} s).`);
    }
  } finally {
    clearInterval(timer);
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

