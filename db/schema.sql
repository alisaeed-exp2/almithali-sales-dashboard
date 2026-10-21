-- Almithali Factory sales: one row per invoice line (Odoo account.move.line export).
-- Uploads only add or refresh rows; sales lines are never deleted.
-- Safe to run repeatedly: every statement is idempotent.

CREATE TABLE IF NOT EXISTS uploads (
  id            SERIAL PRIMARY KEY,
  file_name     TEXT        NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows_in_file  INTEGER     NOT NULL DEFAULT 0,
  inserted      INTEGER     NOT NULL DEFAULT 0,
  updated       INTEGER     NOT NULL DEFAULT 0,
  unchanged     INTEGER     NOT NULL DEFAULT 0,
  skipped       INTEGER     NOT NULL DEFAULT 0,
  state         TEXT        NOT NULL DEFAULT 'completed', -- in_progress | completed
  chunks        INTEGER     NOT NULL DEFAULT 0,
  completed_at  TIMESTAMPTZ
);

-- The ten data columns are exactly the export's. line_key = "Journal Entry | Product" identifies a line:
-- re-uploading the same invoice refreshes its lines instead of adding them again.
CREATE TABLE IF NOT EXISTS sales_lines (
  line_key        TEXT          PRIMARY KEY,
  journal_entry   TEXT          NOT NULL,               -- "Journal Entry"            e.g. INV25279897 (RC011/2568)
  invoice_date    DATE          NOT NULL,               -- "Invoice/Bill Date"
  partner         TEXT          NOT NULL DEFAULT '',    -- "Partner"
  product         TEXT          NOT NULL DEFAULT '',    -- "Product"                  e.g. [FGP-BK-00184] Ideal Mafrood Bread …
  quantity        NUMERIC(14,3) NOT NULL DEFAULT 0,     -- "Quantity"
  unit_price      NUMERIC(14,4) NOT NULL DEFAULT 0,     -- "Unit Price"
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,     -- "Subtotal" (net, before VAT)
  total           NUMERIC(14,2) NOT NULL DEFAULT 0,     -- "Total"    (incl. VAT)
  reference       TEXT          NOT NULL DEFAULT '',    -- "Journal Entry/Reference"  RC011/2568 = B2C route sale, S60797 = B2B
  partner_city    TEXT          NOT NULL DEFAULT '',    -- "Journal Entry/Partner/City"
  first_upload_id INTEGER       REFERENCES uploads(id),
  last_upload_id  INTEGER       REFERENCES uploads(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Derived attributes, defined once in SQL so the summary, the filters and the line lists agree.
-- Channel: a reference like S60797 is a B2B sale; a route reference like AHC019/1167 is B2C.
CREATE OR REPLACE FUNCTION am_channel(ref text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN btrim(coalesce(ref, '')) ~* '^S[0-9]+$' THEN 'B2B' WHEN btrim(coalesce(ref, '')) = '' THEN 'Unknown' ELSE 'B2C' END
$$;
-- Sales route: the part of the reference before "/" (RC011/2568 → RC011); every B2B sale is "B2B direct".
CREATE OR REPLACE FUNCTION am_route(ref text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN btrim(coalesce(ref, '')) ~* '^S[0-9]+$' THEN 'B2B direct'
              WHEN btrim(coalesce(ref, '')) = '' THEN 'Unknown'
              ELSE upper(btrim(split_part(ref, '/', 1))) END
$$;
-- City: "DAMMAM" and "Dammam" are one city; "0" or empty means not recorded.
CREATE OR REPLACE FUNCTION am_city(c text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN btrim(coalesce(c, '')) IN ('', '0') THEN 'Unknown' ELSE initcap(lower(btrim(c))) END
$$;

CREATE INDEX IF NOT EXISTS sales_lines_date_idx    ON sales_lines (invoice_date);
CREATE INDEX IF NOT EXISTS sales_lines_partner_idx ON sales_lines (partner);
CREATE INDEX IF NOT EXISTS sales_lines_product_idx ON sales_lines (product);
CREATE INDEX IF NOT EXISTS sales_lines_entry_idx   ON sales_lines (journal_entry);
CREATE INDEX IF NOT EXISTS sales_lines_route_idx   ON sales_lines (am_route(reference));

-- Product attributes parsed from the product name (code, category from the code, brand from the name).
CREATE TABLE IF NOT EXISTS products (
  product  TEXT PRIMARY KEY,
  code     TEXT NOT NULL DEFAULT '',
  name     TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Other',
  brand    TEXT NOT NULL DEFAULT 'Other'
);

-- Daily roll-up the dashboard reads instead of individual lines. Rebuilt for the affected days
-- after every upload batch, so it always matches sales_lines.
CREATE TABLE IF NOT EXISTS daily_summary (
  day        DATE          NOT NULL,
  channel    TEXT          NOT NULL,
  route      TEXT          NOT NULL,
  partner    TEXT          NOT NULL,
  city       TEXT          NOT NULL,
  product    TEXT          NOT NULL,
  unit_price NUMERIC(14,4) NOT NULL,
  lines      INTEGER       NOT NULL,
  qty        NUMERIC(18,3) NOT NULL,
  net        NUMERIC(18,2) NOT NULL,
  gross      NUMERIC(18,2) NOT NULL,
  PRIMARY KEY (day, channel, route, partner, city, product, unit_price)
);
CREATE INDEX IF NOT EXISTS daily_summary_partner_idx ON daily_summary (partner);
CREATE INDEX IF NOT EXISTS daily_summary_product_idx ON daily_summary (product);
CREATE INDEX IF NOT EXISTS daily_summary_route_idx   ON daily_summary (route);

-- Monthly roll-up of daily_summary. Whole months in a date range read this table; only the partial months at
-- the edges of a range read daily_summary. Months touched by an upload are queued in dirty_months and refreshed
-- when the upload finishes (or by the next dashboard query, if an upload was stopped half-way).
CREATE TABLE IF NOT EXISTS monthly_summary (
  month      DATE          NOT NULL,   -- first day of the month
  channel    TEXT          NOT NULL,
  route      TEXT          NOT NULL,
  partner    TEXT          NOT NULL,
  city       TEXT          NOT NULL,
  product    TEXT          NOT NULL,
  unit_price NUMERIC(14,4) NOT NULL,
  lines      INTEGER       NOT NULL,
  qty        NUMERIC(18,3) NOT NULL,
  net        NUMERIC(18,2) NOT NULL,
  gross      NUMERIC(18,2) NOT NULL,
  first_day  DATE          NOT NULL,
  last_day   DATE          NOT NULL,
  PRIMARY KEY (month, channel, route, partner, city, product, unit_price)
);
CREATE INDEX IF NOT EXISTS monthly_summary_partner_idx ON monthly_summary (partner);
CREATE INDEX IF NOT EXISTS monthly_summary_product_idx ON monthly_summary (product);
CREATE INDEX IF NOT EXISTS monthly_summary_route_idx   ON monthly_summary (route);

CREATE TABLE IF NOT EXISTS dirty_months (month DATE PRIMARY KEY);

-- One row per invoice (built from its lines): invoice counts, the paged invoice list and invoice search.
CREATE TABLE IF NOT EXISTS invoices (
  journal_entry TEXT          PRIMARY KEY,
  invoice_date  DATE          NOT NULL,
  reference     TEXT          NOT NULL,
  partner       TEXT          NOT NULL,
  city          TEXT          NOT NULL,
  channel       TEXT          NOT NULL,
  route         TEXT          NOT NULL,
  lines         INTEGER       NOT NULL,
  qty           NUMERIC(18,3) NOT NULL,
  net           NUMERIC(18,2) NOT NULL,
  gross         NUMERIC(18,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_date_idx    ON invoices (invoice_date);
CREATE INDEX IF NOT EXISTS invoices_partner_idx ON invoices (partner);
CREATE INDEX IF NOT EXISTS invoices_route_idx   ON invoices (route);

-- Replaced by the invoices table.
DROP TABLE IF EXISTS invoice_summary;
