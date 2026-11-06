SET LOCAL lock_timeout = '15s';--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "subtotal_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "total_cgst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "total_sgst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "total_igst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "total_tax_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "grand_total_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ALTER COLUMN "unit_price_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ALTER COLUMN "discount_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ALTER COLUMN "taxable_value_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ALTER COLUMN "cgst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ALTER COLUMN "sgst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ALTER COLUMN "igst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ALTER COLUMN "line_total_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "subtotal_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "total_cgst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "total_sgst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "total_igst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "total_tax_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_notes" ALTER COLUMN "grand_total_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_note_line_items" ALTER COLUMN "unit_price_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_note_line_items" ALTER COLUMN "discount_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_note_line_items" ALTER COLUMN "taxable_value_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_note_line_items" ALTER COLUMN "cgst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_note_line_items" ALTER COLUMN "sgst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_note_line_items" ALTER COLUMN "igst_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "credit_note_line_items" ALTER COLUMN "line_total_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "amount_paise" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paise_js_safe" CHECK ("invoices"."subtotal_paise" <= 9007199254740991 AND "invoices"."total_cgst_paise" <= 9007199254740991 AND "invoices"."total_sgst_paise" <= 9007199254740991 AND "invoices"."total_igst_paise" <= 9007199254740991 AND "invoices"."total_tax_paise" <= 9007199254740991 AND "invoices"."grand_total_paise" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "ili_paise_js_safe" CHECK ("invoice_line_items"."unit_price_paise" <= 9007199254740991 AND "invoice_line_items"."discount_paise" <= 9007199254740991 AND "invoice_line_items"."taxable_value_paise" <= 9007199254740991 AND "invoice_line_items"."cgst_paise" <= 9007199254740991 AND "invoice_line_items"."sgst_paise" <= 9007199254740991 AND "invoice_line_items"."igst_paise" <= 9007199254740991 AND "invoice_line_items"."line_total_paise" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_paise_js_safe" CHECK ("credit_notes"."subtotal_paise" <= 9007199254740991 AND "credit_notes"."total_cgst_paise" <= 9007199254740991 AND "credit_notes"."total_sgst_paise" <= 9007199254740991 AND "credit_notes"."total_igst_paise" <= 9007199254740991 AND "credit_notes"."total_tax_paise" <= 9007199254740991 AND "credit_notes"."grand_total_paise" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "credit_note_line_items" ADD CONSTRAINT "cnli_paise_js_safe" CHECK ("credit_note_line_items"."unit_price_paise" <= 9007199254740991 AND "credit_note_line_items"."discount_paise" <= 9007199254740991 AND "credit_note_line_items"."taxable_value_paise" <= 9007199254740991 AND "credit_note_line_items"."cgst_paise" <= 9007199254740991 AND "credit_note_line_items"."sgst_paise" <= 9007199254740991 AND "credit_note_line_items"."igst_paise" <= 9007199254740991 AND "credit_note_line_items"."line_total_paise" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_js_safe" CHECK ("payments"."amount_paise" <= 9007199254740991);
