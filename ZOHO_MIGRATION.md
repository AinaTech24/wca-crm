# Migrating from Zoho CRM

Moves Clients, Policies, Claims, Tasks and Meetings out of Zoho and into WCA CRM
via CSV export. Runs as many times as you like — importing the same file twice
updates the same rows instead of creating second copies.

## 1. Export from Zoho

In Zoho: **Setup → Data Administration → Export Data**, one module at a time.

Export these five, and **tick "Record Id"** in the field list for each:

| Zoho module                | Save the file as  |
|----------------------------|-------------------|
| Contacts (or your Clients) | `Contacts.csv`    |
| Policies                   | `Policies.csv`    |
| Claims                     | `Claims.csv`      |
| Tasks                      | `Tasks.csv`       |
| Meetings (or Events)       | `Meetings.csv`    |

Export **all fields**, not a subset — extra columns are ignored and listed in
the report, but a missing one can't be recovered without exporting again.

### Why Record Id matters

It's the only thing that makes a row identifiable across runs. With it, a
re-import updates the row it created last time. Without it, rows are keyed on
their own contents — so if you fix a name in Zoho and re-export, the importer
sees a new record and inserts a duplicate. The run warns when the column is
missing.

Put all five files in one folder, e.g. `zoho-export/`.

## 2. Check the mapping before touching the database

```bash
node import-zoho.js --dir ./zoho-export --inspect
```

Reads nothing but the CSVs — no database, no writes, runs anywhere. It reports
per module:

- **CSV columns not imported** — anything in your export with no home in the
  CRM. Worth reading: a column here is data that won't arrive.
- **CRM fields nothing mapped to** — the reverse; CRM fields your export has no
  column for.
- **dates read as DMY / MDY / ISO** — how dates in that file were interpreted.

If a column you care about is listed as not imported, tell me its name and I'll
add it to the mapping.

## 3. Dry run

```bash
node import-zoho.js --dir ./zoho-export
```

Runs the entire import inside a transaction and rolls it back. Every insert,
constraint and type conversion is exercised for real; nothing is saved. This is
the default — you have to ask for a commit.

Read the report, then look in `zoho-export/_report/`:

- `*-skipped.csv` — rows not imported, with the reason and the full original row
- `*-unlinked.csv` — lookups that couldn't be resolved
- `summary.json` — everything, machine-readable

## 4. Import

```bash
node import-zoho.js --dir ./zoho-export --commit
```

Modules load in dependency order (clients → policies → claims → tasks →
meetings) so each can link to the ones before it.

## 5. Check

Open Clients, Policies and Claims and confirm counts and a few records against
Zoho. If something's wrong, fix the CSV and re-run with `--commit` — corrected
rows overwrite, they don't duplicate.

---

## What it refuses to do

**Guess a date order.** `03/04/2025` is a valid date read either way. The
importer scans each file for a value that can only be read one way — a day past
the 12th — and uses that. If a file has no such value it stops and asks:

```
BLOCKED  Every date reads validly as both DD/MM and MM/DD ...
         Re-run with --date-format DMY (or MDY)
```

Check the format in Zoho (**Setup → Users → your profile → Date Format**) and
pass it. Guessing would shift dates by months across every record and nothing
would ever look broken.

**Guess a relationship.** A policy naming client "Rajesh Patel" when two Rajesh
Patels exist is left unlinked, keeps the name on the record, and appears in
`*-unlinked.csv`. Attaching it to the wrong client is worse than not attaching
it. To fix: make the names distinct in Zoho and re-run, or link the handful by
hand in the CRM.

**Drop a value it doesn't recognise.** A picklist value the CRM doesn't have —
a policy status of "Under Review", say — is stored as-is and reported under
*values kept but off the CRM option list*. Nothing is silently blanked.

## Options

| Flag | Effect |
|---|---|
| `--dir <path>` | Export folder (default `./zoho-export`) |
| `--inspect` | Check the mapping. No database access at all |
| `--commit` | Actually save. Without it, everything rolls back |
| `--module <key>` | Just one: `clients`, `policies`, `claims`, `tasks`, `meetings` |
| `--date-format DMY\|MDY\|ISO` | State the date order instead of detecting it |
| `--file-<key> <path>` | Point a module at a specific file |
| `--report-dir <path>` | Where to write the reports |

## Notes

- **Mobiles** are normalised to bare 10 digits, so `+91 98250 11111` and
  `09825011111` both store as `9825011111`.
- **Amounts** accept `Rs.`/`₹`/`INR`, `/-`, and lakh-crore grouping:
  `Rs. 1,00,00,000/-` → `10000000`.
- **Departments** (Personal vs Commercial Lines) are derived from the product on
  each policy and claim, matching how the rest of the CRM assigns them.
- **Meeting participants** are matched to clients then leads; anyone else is kept
  as a plain name on the meeting. They're rebuilt on each run, so re-importing
  doesn't stack duplicates.
- **Notes and attachments** are not covered. Zoho exports those separately and
  attachments aren't in the CSV at all — say the word if you want them.
