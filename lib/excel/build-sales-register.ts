import type { Writable } from 'node:stream';
import type ExcelJS from 'exceljs';
import type { ExportData, ExportInvoice, ExportCreditNote } from '@/lib/actions/reports/get-export-data';
import { paiseToRupees } from '@/lib/money';
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states';
import { columnsWithoutHeaders, commitDataRow, createStreamingWorkbook } from '@/lib/excel/streaming-workbook';

const getStateNameByCode = (code: string | null) => {
  if (!code) return '';
  const state = INDIAN_GST_STATES.find(s => s.code === code);
  return state ? `${code}-${state.name}` : code;
};

/** Streams the Sales Register workbook (register, HSN summary, credit notes, period summary) into `stream`. */
export async function writeSalesRegisterWorkbook(data: ExportData, stream: Writable): Promise<void> {
  const workbook = createStreamingWorkbook(stream);

  // Reusable currency format (e.g. #,##0.00)
  const currencyFormat = '#,##0.00';

  const addHeaderBlock = (sheet: ExcelJS.Worksheet, title: string) => {
    sheet.mergeCells('A1:D1');
    sheet.getCell('A1').value = data.business.legal_name;
    sheet.getCell('A1').font = { bold: true, size: 14 };

    sheet.mergeCells('A2:D2');
    sheet.getCell('A2').value = `GSTIN: ${data.business.gstin}`;

    sheet.mergeCells('A3:D3');
    sheet.getCell('A3').value = `${title} for: ${data.label}`;

    sheet.mergeCells('A4:D4');
    sheet.getCell('A4').value = `Generated on: ${new Date().toLocaleDateString('en-IN')}`;
  };

  // ---------------------------------------------------------
  // SHEET 1: Sales Register
  // ---------------------------------------------------------
  const sheet1 = workbook.addWorksheet('Sales Register', { views: [{ state: 'frozen', ySplit: 6 }] });
  addHeaderBlock(sheet1, 'Sales Register');

  const sheet1Columns = [
    { header: 'S.No', key: 'sno', width: 8 },
    { header: 'Invoice No', key: 'invoice_number', width: 20 },
    { header: 'Date', key: 'invoice_date', width: 15 },
    { header: 'Customer Name', key: 'customer_name', width: 30 },
    { header: 'Customer GSTIN', key: 'customer_gstin', width: 20 },
    { header: 'Place of Supply', key: 'pos', width: 25 },
    { header: 'Supply Type', key: 'supply_type', width: 15 },
    { header: 'Taxable Value', key: 'taxable', width: 15, style: { numFmt: currencyFormat } },
    { header: 'CGST', key: 'cgst', width: 15, style: { numFmt: currencyFormat } },
    { header: 'SGST/UTGST', key: 'sgst', width: 15, style: { numFmt: currencyFormat } },
    { header: 'IGST', key: 'igst', width: 15, style: { numFmt: currencyFormat } },
    { header: 'Total Tax', key: 'tax', width: 15, style: { numFmt: currencyFormat } },
    { header: 'Invoice Total', key: 'total', width: 15, style: { numFmt: currencyFormat } },
    { header: 'Payment Status', key: 'payment_status', width: 15 },
  ];

  // Put columns on row 6
  sheet1.getRow(6).values = sheet1Columns.map(c => c.header);
  sheet1.getRow(6).font = { bold: true };
  sheet1.getRow(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  // Widths, keys and formats only: header text is already in row 6, and must not overwrite the title block in row 1.
  sheet1.columns = columnsWithoutHeaders(sheet1Columns);
  // Rows 1-6 are final once the column definitions are applied: flush them.
  sheet1.getRow(6).commit();

  let rowCount = 7;
  let t_taxable = 0, t_cgst = 0, t_sgst = 0, t_igst = 0, t_tax = 0, t_total = 0;

  for (let index = 0; index < data.invoices.length; index++) {
    const inv: ExportInvoice = data.invoices[index];
    const supplyType = inv.total_igst_paise > 0 ? 'Inter-State' : 'Intra-State';
    const taxable = paiseToRupees(inv.subtotal_paise);
    const cgst = paiseToRupees(inv.total_cgst_paise);
    const sgst = paiseToRupees(inv.total_sgst_paise);
    const igst = paiseToRupees(inv.total_igst_paise);
    const tax = paiseToRupees(inv.total_tax_paise);
    const total = paiseToRupees(inv.grand_total_paise);

    t_taxable += taxable;
    t_cgst += cgst;
    t_sgst += sgst;
    t_igst += igst;
    t_tax += tax;
    t_total += total;

    const row = sheet1.getRow(rowCount++);
    row.values = {
      sno: index + 1,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      customer_name: inv.customer_name || 'Cash',
      customer_gstin: inv.customer_gstin || 'Unregistered',
      pos: getStateNameByCode(inv.place_of_supply_state_code),
      supply_type: supplyType,
      taxable,
      cgst,
      sgst,
      igst,
      tax,
      total,
      payment_status: inv.payment_status.toUpperCase(),
    };
    await commitDataRow(row, index);
  }

  const sheet1TotalsRow = sheet1.getRow(rowCount);
  sheet1TotalsRow.values = {
    supply_type: 'TOTAL',
    taxable: t_taxable,
    cgst: t_cgst,
    sgst: t_sgst,
    igst: t_igst,
    tax: t_tax,
    total: t_total,
  };
  sheet1TotalsRow.font = { bold: true };
  sheet1.commit();

  // ---------------------------------------------------------
  // SHEET 2: HSN Summary
  // ---------------------------------------------------------
  const sheet2 = workbook.addWorksheet('HSN Summary', { views: [{ state: 'frozen', ySplit: 6 }] });
  addHeaderBlock(sheet2, 'HSN Summary');

  const sheet2Columns = [
    { header: 'HSN/SAC Code', key: 'hsn', width: 15 },
    { header: 'Description', key: 'desc', width: 30 },
    { header: 'UQC', key: 'uqc', width: 10 },
    { header: 'Total Quantity', key: 'qty', width: 15 },
    { header: 'Taxable Value', key: 'taxable', width: 15, style: { numFmt: currencyFormat } },
    { header: 'CGST', key: 'cgst', width: 15, style: { numFmt: currencyFormat } },
    { header: 'SGST/UTGST', key: 'sgst', width: 15, style: { numFmt: currencyFormat } },
    { header: 'IGST', key: 'igst', width: 15, style: { numFmt: currencyFormat } },
    { header: 'Total Tax', key: 'tax', width: 15, style: { numFmt: currencyFormat } },
    { header: 'Total Value', key: 'total', width: 15, style: { numFmt: currencyFormat } },
  ];

  sheet2.getRow(6).values = sheet2Columns.map(c => c.header);
  sheet2.getRow(6).font = { bold: true };
  sheet2.getRow(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  sheet2.columns = columnsWithoutHeaders(sheet2Columns);
  // Rows 1-6 are final once the column definitions are applied: flush them.
  sheet2.getRow(6).commit();

  rowCount = 7;
  let h_taxable = 0, h_cgst = 0, h_sgst = 0, h_igst = 0, h_tax = 0, h_total = 0;

  for (let index = 0; index < data.hsnSummary.length; index++) {
    const hsn = data.hsnSummary[index];
    const taxable = paiseToRupees(hsn.taxable_value_paise);
    const cgst = paiseToRupees(hsn.cgst_paise);
    const sgst = paiseToRupees(hsn.sgst_paise);
    const igst = paiseToRupees(hsn.igst_paise);
    const tax = paiseToRupees(hsn.total_tax_paise);
    const total = paiseToRupees(hsn.total_value_paise);

    h_taxable += taxable;
    h_cgst += cgst;
    h_sgst += sgst;
    h_igst += igst;
    h_tax += tax;
    h_total += total;

    const row = sheet2.getRow(rowCount++);
    row.values = {
      hsn: hsn.hsn_sac_code,
      desc: hsn.description,
      uqc: hsn.unit_of_measurement,
      qty: hsn.total_quantity,
      taxable,
      cgst,
      sgst,
      igst,
      tax,
      total,
    };
    await commitDataRow(row, index);
  }

  const sheet2TotalsRow = sheet2.getRow(rowCount);
  sheet2TotalsRow.values = {
    qty: 'TOTAL',
    taxable: h_taxable,
    cgst: h_cgst,
    sgst: h_sgst,
    igst: h_igst,
    tax: h_tax,
    total: h_total,
  };
  sheet2TotalsRow.font = { bold: true };
  sheet2.commit();

  // ---------------------------------------------------------
  // SHEET 3: Credit Notes
  // ---------------------------------------------------------
  const sheet3 = workbook.addWorksheet('Credit Notes', { views: [{ state: 'frozen', ySplit: 6 }] });
  addHeaderBlock(sheet3, 'Credit Notes');

  const sheet3Columns = [
    { header: 'S.No', key: 'sno', width: 8 },
    { header: 'Credit Note No', key: 'cn_number', width: 20 },
    { header: 'Date', key: 'cn_date', width: 15 },
    { header: 'Supply Type', key: 'supply_type', width: 15 },
    { header: 'Taxable Value', key: 'taxable', width: 15, style: { numFmt: currencyFormat } },
    { header: 'CGST', key: 'cgst', width: 15, style: { numFmt: currencyFormat } },
    { header: 'SGST/UTGST', key: 'sgst', width: 15, style: { numFmt: currencyFormat } },
    { header: 'IGST', key: 'igst', width: 15, style: { numFmt: currencyFormat } },
    { header: 'Total Tax', key: 'tax', width: 15, style: { numFmt: currencyFormat } },
    { header: 'Total Value', key: 'total', width: 15, style: { numFmt: currencyFormat } },
  ];

  sheet3.getRow(6).values = sheet3Columns.map(c => c.header);
  sheet3.getRow(6).font = { bold: true };
  sheet3.getRow(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  sheet3.columns = columnsWithoutHeaders(sheet3Columns);
  // Rows 1-6 are final once the column definitions are applied: flush them.
  sheet3.getRow(6).commit();

  rowCount = 7;
  let c_taxable = 0, c_cgst = 0, c_sgst = 0, c_igst = 0, c_tax = 0, c_total = 0;

  for (let index = 0; index < data.creditNotes.length; index++) {
    const cn: ExportCreditNote = data.creditNotes[index];
    const supplyType = cn.total_igst_paise > 0 ? 'Inter-State' : 'Intra-State';
    const taxable = paiseToRupees(cn.subtotal_paise);
    const cgst = paiseToRupees(cn.total_cgst_paise);
    const sgst = paiseToRupees(cn.total_sgst_paise);
    const igst = paiseToRupees(cn.total_igst_paise);
    const tax = paiseToRupees(cn.total_tax_paise);
    const total = paiseToRupees(cn.grand_total_paise);

    c_taxable += taxable;
    c_cgst += cgst;
    c_sgst += sgst;
    c_igst += igst;
    c_tax += tax;
    c_total += total;

    const row = sheet3.getRow(rowCount++);
    row.values = {
      sno: index + 1,
      cn_number: cn.credit_note_number,
      cn_date: cn.issue_date,
      supply_type: supplyType,
      taxable,
      cgst,
      sgst,
      igst,
      tax,
      total,
    };
    await commitDataRow(row, index);
  }

  const sheet3TotalsRow = sheet3.getRow(rowCount);
  sheet3TotalsRow.values = {
    supply_type: 'TOTAL',
    taxable: c_taxable,
    cgst: c_cgst,
    sgst: c_sgst,
    igst: c_igst,
    tax: c_tax,
    total: c_total,
  };
  sheet3TotalsRow.font = { bold: true };
  sheet3.commit();

  // ---------------------------------------------------------
  // SHEET 4: Summary (period totals are pre-computed, so rows are written top-down)
  // ---------------------------------------------------------
  const sheet4 = workbook.addWorksheet('Summary');

  sheet4.getColumn('A').width = 25;
  sheet4.getColumn('B').width = 20;

  const titleCell = sheet4.getCell('A1');
  titleCell.value = 'Period Summary';
  titleCell.font = { bold: true, size: 16 };

  const totals = data.periodTotals;
  const summaryRows: [label: string, value: ExcelJS.CellValue, isCurrency: boolean][] = [
    ['Period', data.label, false],
    ['Total Invoices', totals.totalInvoices, false],
    ['Total Taxable Value', paiseToRupees(totals.totalTaxableValuePaise), true],
    ['Total CGST', paiseToRupees(totals.totalCgstPaise), true],
    ['Total SGST/UTGST', paiseToRupees(totals.totalSgstPaise), true],
    ['Total IGST', paiseToRupees(totals.totalIgstPaise), true],
    ['Total Tax', paiseToRupees(totals.totalTaxPaise), true],
    ['Total Invoice Value', paiseToRupees(totals.totalInvoiceValuePaise), true],
  ];

  let summaryRowNumber = 3;
  for (const [label, value, isCurrency] of summaryRows) {
    const row = sheet4.getRow(summaryRowNumber++);
    const labelCell = row.getCell(1);
    labelCell.value = label;
    labelCell.font = { bold: true };
    const valueCell = row.getCell(2);
    valueCell.value = value;
    if (isCurrency) valueCell.numFmt = currencyFormat;
    row.commit();
  }
  sheet4.commit();

  await workbook.commit();
}
