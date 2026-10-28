ALTER TABLE "credit_note_line_items" ADD COLUMN IF NOT EXISTS "original_line_item_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_note_line_items_original_line_item_id_invoice_line_items_id_fk' AND conrelid = 'public.credit_note_line_items'::regclass) THEN
    ALTER TABLE "credit_note_line_items" ADD CONSTRAINT "credit_note_line_items_original_line_item_id_invoice_line_items_id_fk" FOREIGN KEY ("original_line_item_id") REFERENCES "public"."invoice_line_items"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_note_line_items_original_line_item_id_idx" ON "credit_note_line_items" USING btree ("original_line_item_id");--> statement-breakpoint
ALTER TABLE "credit_note_line_items" DISABLE TRIGGER "bm_credit_note_line_items_guard";--> statement-breakpoint
UPDATE "credit_note_line_items" AS cnli
SET "original_line_item_id" = m.ili_id
FROM (
  SELECT c2.id AS cnli_id, (array_agg(ili.id))[1] AS ili_id
  FROM "credit_note_line_items" c2
  JOIN "credit_notes" cn ON cn.id = c2.credit_note_id
  JOIN "invoice_line_items" ili
    ON ili.invoice_id = cn.original_invoice_id
   AND ili.description = c2.description
   AND ili.hsn_sac_code = c2.hsn_sac_code
   AND ili.unit_price_paise = c2.unit_price_paise
   AND ili.tax_rate_percentage = c2.tax_rate_percentage
  WHERE c2.original_line_item_id IS NULL
  GROUP BY c2.id
  HAVING count(*) = 1
) AS m
WHERE cnli.id = m.cnli_id AND cnli."original_line_item_id" IS NULL;--> statement-breakpoint
ALTER TABLE "credit_note_line_items" ENABLE TRIGGER "bm_credit_note_line_items_guard";--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bm_guard_cnli_original_line() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.original_line_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.invoice_line_items ili
      JOIN public.credit_notes cn ON cn.id = NEW.credit_note_id
      WHERE ili.id = NEW.original_line_item_id
        AND ili.invoice_id = cn.original_invoice_id
    ) THEN
      RAISE EXCEPTION 'BM_LINK_VIOLATION: credit note line must reference a line of the credit note''s original invoice'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bm_cnli_original_line_guard" ON "credit_note_line_items";--> statement-breakpoint
CREATE TRIGGER "bm_cnli_original_line_guard" BEFORE INSERT OR UPDATE OF "original_line_item_id", "credit_note_id" ON "credit_note_line_items" FOR EACH ROW EXECUTE FUNCTION public.bm_guard_cnli_original_line();--> statement-breakpoint
-- Intentionally never VALIDATEd: legacy rows may remain NULL; enforced for every new/updated row.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cnli_original_line_required' AND conrelid = 'public.credit_note_line_items'::regclass) THEN
    ALTER TABLE "credit_note_line_items" ADD CONSTRAINT "cnli_original_line_required" CHECK ("credit_note_line_items"."original_line_item_id" IS NOT NULL) NOT VALID;
  END IF;
END $$;
