# Almithali Factory — Sales Dashboard (Next.js)

Interactive, drill-down sales dashboard for Almithali Factory, built from the Odoo **journal items** export
(`account.move.line`, one row per invoice line), in English (`/en`) and Arabic (`/ar`, right-to-left).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start   # production
```

Requires Node 20+, `DATABASE_URL` (PostgreSQL) and `UPLOAD_PASSWORD` (see `.env.example`).

## The export

Columns (exactly as Odoo exports them): `Journal Entry`, `Invoice/Bill Date`, `Partner`, `Product`, `Quantity`,
`Unit Price`, `Subtotal`, `Total`, `Journal Entry/Reference`, `Journal Entry/Partner/City`.

- A line is identified by **Journal Entry + Product**: re-uploading the same invoice refreshes its lines instead of adding them twice. The same product twice on one invoice is merged (quantities and amounts added).
- Blank rows and zero-value lines without a product (the tax/receivable lines Odoo adds to every invoice) are ignored; the upload dialog counts them.
- Dates are read as Odoo's US format (`10/21/2026`, month first); day-first dates are recognised when the day is above 12.

## What's derived

| Field | How |
|---|---|
| Channel | Reference like `S60797` → **B2B**; route reference like `AHC019/1167` → **B2C** |
| Sales route | Part of the reference before `/` (`RC011/2568` → `RC011`); all B2B sales are "B2B direct" |
| City | Customer city, case-normalised (`DAMMAM` = `Dammam`); empty or `0` → Unknown |
| Product code / category | From `[FGP-BK-00184]`: `BK` Bakery, `EP` Sweets & pastries, `WP` Cakes & muffins |
| Brand | From the product name: Ideal, Loavin Bake, Healthy, otherwise Other |
| Net / VAT / Gross | Net = `Subtotal`; Gross = `Total` (incl. 15% VAT); VAT = Total − Subtotal |

Channel, route and city are SQL functions (`am_channel`, `am_route`, `am_city` in `db/schema.sql`) mirrored in `src/lib/normalize.ts`.

## Data: PostgreSQL, append-only uploads, summaries

Built for millions of invoice lines.

- **`sales_lines`** — one row per invoice line with exactly the export's columns. Never deleted by the app.
- **`daily_summary`** — day × channel × route × customer × city × product × unit price.
- **`monthly_summary`** — the same rolled up by month. Whole months in a date range read this table; only partial months at the edges read the daily summary.
- **`invoices`** — one row per invoice (counts, the invoice list, invoice search).
- **`products`** — derived product attributes. **`uploads`** — upload log. **`dirty_months`** — months waiting for the monthly roll-up after an upload (refreshed when the upload finishes, or by the next page load if an upload was stopped).

**Uploading** (header button, protected by `UPLOAD_PASSWORD`): export the journal items from Odoo as **CSV** (Excel works for smaller files). The browser streams the file and sends batches of up to 5,000 lines to `/api/upload/start` → `/chunk` → `/finish`; each batch is its own transaction. A failed or stopped upload resumes by uploading the same file again (saved lines count as unchanged).

**Rebuild totals** (upload dialog → Maintenance, or `POST /api/admin/rebuild`): recalculates every derived table from `sales_lines` after rows were edited directly in the database.

**Search** is resolved to the customers, products, routes and cities whose names match, then applied as indexed filters.

**API**: `/api/query` (aggregates for every panel, cross-filtered), `/api/invoices` and `/api/lines` (paged, sorted on the server), `/api/export?f=…` (streamed CSV of all lines matching the filters).

### Measured (local PostgreSQL 16, 2.45 million realistic lines, 339,000 invoices)

- Totals reconcile to the cent between `sales_lines`, both summaries and `invoices` for 27 date-range/filter combinations.
- A 153,000-line month uploads through the real chunked upload in 22 s; a 218-line day in 0.2 s.
- Full rebuild of all derived tables: about 60 s.
- Dashboard panels: 0.1–0.6 s each; whole first screen about 2 s all-time, 0.2 s for a search; invoice and line pages 0.01–0.2 s.

## Features

- **Filters**: channel, route, city, customer, category, brand, product (multi-select with counts), date range with presets from the latest date in the data, search, removable chips.
- **Measure switch**: net sales, gross (incl. VAT), units.
- **KPIs**: net, gross + VAT, invoices, average invoice value, units sold, B2B share (click → B2B profile).
- **Auto insights**: customer concentration (HHI), best seller, B2B vs B2C and unit prices, price spread for the same product, zero-price units, leading route, cities (incl. missing city), category mix, invoice size, best day/week/month — each links to its drill-down.
- **Cross-filtering**: click any bar, donut slice, legend row or matrix cell.
- **Drill-downs**: arrow on any bar opens a profile drawer (KPIs, rank, trend, unit prices charged, breakdowns, invoices) → **invoice** (all its lines) → **line**. The drill-down explorer walks five paths (Channel, Geography, Customer, Product, Route) down to invoices. Time-chart columns zoom into that period.
- **Tables**: price list in use, customer scorecard, sales-route performance, invoices (with invoice-number finder), invoice lines (exportable).
- Almithali branding (plum and wheat gold from the logo), Lora / Nunito Sans / Tajawal, full RTL mirroring; every string in `src/messages/en.json` and `ar.json`.

## Structure

```
db/                 schema.sql (tables, SQL helpers), upsert.sql
scripts/db-init.mjs applies the schema before each deploy
src/app/            [locale] page + layout, API routes, globals.css (brand tokens), fonts
src/components/     Dashboard, FilterBar, KpiCards, Insights, DrillExplorer, Drawer (entity / invoice / line),
                    InvoiceTable, LineTable, SortTable, UploadDialog, charts/
src/lib/            db (writes, summaries), query (reads), sale-rows (export → rows), normalize (derived fields),
                    insights, csv-stream, upload-client, format, i18n
public/brand/       Almithali logo (background removed), icons
```

## Deploy

See below (filled in on first deploy).
