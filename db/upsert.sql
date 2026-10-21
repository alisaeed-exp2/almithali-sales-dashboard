-- Adds new invoice lines and refreshes changed ones (for example a corrected quantity or price).
-- Never deletes. Lines that are identical are left untouched.
-- $1..$11 are parallel arrays (one entry per line), $12 is the upload id.
WITH incoming AS (
  SELECT *
  FROM unnest($1::text[], $2::text[], $3::date[], $4::text[], $5::text[], $6::numeric[], $7::numeric[],
              $8::numeric[], $9::numeric[], $10::text[], $11::text[])
    AS t(line_key, journal_entry, invoice_date, partner, product, quantity, unit_price, subtotal, total, reference, partner_city)
),
written AS (
  INSERT INTO sales_lines AS v
    (line_key, journal_entry, invoice_date, partner, product, quantity, unit_price, subtotal, total, reference, partner_city,
     first_upload_id, last_upload_id)
  SELECT line_key, journal_entry, invoice_date, partner, product, quantity, unit_price, subtotal, total, reference, partner_city,
         $12, $12
  FROM incoming
  ON CONFLICT (line_key) DO UPDATE SET
    journal_entry  = EXCLUDED.journal_entry,
    invoice_date   = EXCLUDED.invoice_date,
    partner        = EXCLUDED.partner,
    product        = EXCLUDED.product,
    quantity       = EXCLUDED.quantity,
    unit_price     = EXCLUDED.unit_price,
    subtotal       = EXCLUDED.subtotal,
    total          = EXCLUDED.total,
    reference      = EXCLUDED.reference,
    partner_city   = EXCLUDED.partner_city,
    last_upload_id = EXCLUDED.last_upload_id,
    updated_at     = now()
  WHERE (v.journal_entry, v.invoice_date, v.partner, v.product, v.quantity, v.unit_price, v.subtotal, v.total, v.reference, v.partner_city)
        IS DISTINCT FROM
        (EXCLUDED.journal_entry, EXCLUDED.invoice_date, EXCLUDED.partner, EXCLUDED.product, EXCLUDED.quantity, EXCLUDED.unit_price,
         EXCLUDED.subtotal, EXCLUDED.total, EXCLUDED.reference, EXCLUDED.partner_city)
  RETURNING (xmax = 0) AS is_new
)
SELECT count(*) FILTER (WHERE is_new)::int     AS inserted,
       count(*) FILTER (WHERE NOT is_new)::int AS updated
FROM written;
