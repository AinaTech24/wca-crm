import bcrypt from 'bcryptjs';
import db from './pgdb.js';

export async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT DEFAULT 'admin',
      org_name TEXT DEFAULT 'WeCare Assurance'
    );

    -- Outbound email/WhatsApp credentials, kept server-side only: the client
    -- never sees smtp_pass/wa_token back, and never has to send them with
    -- every send-email/send-whatsapp request.
    CREATE TABLE IF NOT EXISTS integration_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      email_enabled INTEGER DEFAULT 0,
      smtp_host TEXT, smtp_port TEXT, smtp_secure TEXT DEFAULT 'TLS',
      smtp_user TEXT, smtp_pass TEXT, smtp_from_name TEXT, smtp_from_email TEXT,
      wa_enabled INTEGER DEFAULT 0,
      wa_provider TEXT DEFAULT 'WhatsApp Business API',
      wa_phone_id TEXT, wa_business_id TEXT, wa_token TEXT
    );

    -- Notification feed backing the bell icon in the top bar — every row is
    -- a real business event (RFQ created, renewal due, etc.), inserted by
    -- the route handlers themselves and pushed live over the existing SSE
    -- bus. No static/seeded content: this table starts empty and only ever
    -- fills from real mutations.
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      entity TEXT NOT NULL,
      kind TEXT NOT NULL,
      icon TEXT DEFAULT 'bell',
      tone TEXT DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      ref_table TEXT,
      ref_id INTEGER,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      client_name TEXT NOT NULL,
      group_head_name TEXT,
      group_code TEXT,
      email TEXT,
      mobile TEXT,
      pan_no TEXT,
      dob TEXT,
      anniversary TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      pincode TEXT,
      occupation TEXT,
      owner TEXT DEFAULT 'Admin User',
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS agencies (
      id SERIAL PRIMARY KEY,
      agency_name TEXT NOT NULL,
      type TEXT DEFAULT 'GI',
      contact_person TEXT,
      mobile TEXT,
      email TEXT,
      city TEXT
    );

    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      company_name TEXT NOT NULL,
      type TEXT DEFAULT 'GI'
    );

    CREATE TABLE IF NOT EXISTS policies (
      id SERIAL PRIMARY KEY,
      policy_status TEXT DEFAULT 'Proposal',
      policy_type TEXT DEFAULT 'Fresh',
      renewable TEXT DEFAULT 'Yes',
      insurance_line TEXT DEFAULT 'GI',
      insured_name TEXT NOT NULL,
      client_id INTEGER,
      group_head_name TEXT,
      policy_number TEXT,
      agency_name TEXT,
      ba_name TEXT,
      sm_name TEXT,
      company_name TEXT,
      insurance_type TEXT,
      product_name TEXT,
      login_date TEXT,
      period_from TEXT,
      period_to TEXT,
      addon_name TEXT,
      reg_no TEXT,
      sum_assured REAL DEFAULT 0,
      net_premium REAL DEFAULT 0,
      gst_amount REAL DEFAULT 0,
      final_premium REAL DEFAULT 0,
      payment_type TEXT,
      payment_ref TEXT,
      payment_date TEXT,
      total_amount REAL DEFAULT 0,
      remarks TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS claims (
      id SERIAL PRIMARY KEY,
      policy_id INTEGER,
      client_name TEXT,
      company_name TEXT,
      claim_no TEXT,
      claim_date TEXT,
      claim_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'Pending',
      remarks TEXT
    );

    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      lead_name TEXT NOT NULL,
      mobile TEXT,
      email TEXT,
      product_interest TEXT,
      source TEXT,
      status TEXT DEFAULT 'New',
      assigned_to TEXT,
      followup_date TEXT,
      remarks TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    -- Zoho-style activity trail hanging off a lead: tasks, notes and
    -- meetings share one table because they're the same shape (who, when,
    -- what) and a single table makes the merged "all activity" timeline a
    -- plain ORDER BY instead of a three-way union.
    CREATE TABLE IF NOT EXISTS lead_activities (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                 -- 'task' | 'note' | 'meeting'
      title TEXT,                         -- task subject / meeting title
      body TEXT,                          -- note text / description
      due_date TEXT,                      -- task due date / meeting date
      meeting_time TEXT,
      location TEXT,
      status TEXT DEFAULT 'Open',         -- tasks: Open | In Progress | Done
      priority TEXT DEFAULT 'Medium',
      owner TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    -- Standalone Meeting module (distinct from the lightweight meeting
    -- entries logged against a lead in lead_activities).
    CREATE TABLE IF NOT EXISTS meetings (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      meeting_type TEXT DEFAULT 'New',        -- New | Existing (business)
      location TEXT,
      from_date TEXT, from_time TEXT,
      to_date TEXT, to_time TEXT,
      owner TEXT,
      notify_participants INTEGER DEFAULT 0,  -- do reminders go to participants too, or owner only
      status TEXT DEFAULT 'Scheduled',
      minutes TEXT,                           -- minutes of meeting, captured once Completed
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    -- Participants are polymorphic (an existing client, a lead, or an
    -- internal user). Name/email/mobile are denormalised on purpose so a
    -- past meeting still reads correctly if the client or lead is later
    -- renamed or deleted.
    CREATE TABLE IF NOT EXISTS meeting_participants (
      id SERIAL PRIMARY KEY,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,                     -- client | lead | user
      ref_id INTEGER,
      name TEXT,
      email TEXT,
      mobile TEXT
    );

    -- One row per reminder, so a meeting can carry several at different
    -- lead times. The sent flag is what stops the scheduler re-firing one.
    CREATE TABLE IF NOT EXISTS meeting_reminders (
      id SERIAL PRIMARY KEY,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      offset_minutes INTEGER NOT NULL,        -- how long before the start time
      sent INTEGER DEFAULT 0,
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS lookups (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      extra TEXT
    );

    CREATE TABLE IF NOT EXISTS endorsements (
      id SERIAL PRIMARY KEY,
      policy_number TEXT,
      insured_name TEXT,
      company_name TEXT,
      endorsement_no TEXT,
      endorsement_type TEXT,
      endorsement_date TEXT,
      premium_effect REAL DEFAULT 0,
      remarks TEXT
    );

    CREATE TABLE IF NOT EXISTS commissions (
      id SERIAL PRIMARY KEY,
      kind TEXT DEFAULT 'payin',
      policy_number TEXT,
      insured_name TEXT,
      company_name TEXT,
      agency_name TEXT,
      base_premium REAL DEFAULT 0,
      rate REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      status TEXT DEFAULT 'Pending',
      entry_date TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      assigned_to TEXT,
      priority TEXT DEFAULT 'Medium',
      due_date TEXT,
      status TEXT DEFAULT 'Open',
      remarks TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS fd_transactions (
      id SERIAL PRIMARY KEY,
      client_name TEXT,
      scheme_name TEXT,
      company_name TEXT,
      fd_number TEXT,
      amount REAL DEFAULT 0,
      interest_rate REAL DEFAULT 0,
      tenure_months INTEGER DEFAULT 0,
      start_date TEXT,
      maturity_date TEXT,
      maturity_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'Active'
    );

    CREATE TABLE IF NOT EXISTS company_emails (
      id SERIAL PRIMARY KEY,
      company_name TEXT NOT NULL,
      claim_email TEXT,
      support_phone TEXT
    );

    CREATE TABLE IF NOT EXISTS templates (
      id SERIAL PRIMARY KEY,
      tkey TEXT UNIQUE NOT NULL,
      subject TEXT,
      body TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS quotations (
      id SERIAL PRIMARY KEY,
      quote_no TEXT,
      client_name TEXT NOT NULL,
      mobile TEXT,
      insurance_line TEXT DEFAULT 'GI',
      product TEXT,
      sum_assured REAL DEFAULT 0,
      options TEXT DEFAULT '[]',
      selected_insurer TEXT,
      selected_premium REAL DEFAULT 0,
      status TEXT DEFAULT 'Draft',
      valid_till TEXT,
      assigned_to TEXT,
      remarks TEXT,
      rfq_id INTEGER,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS rfqs (
      id SERIAL PRIMARY KEY,
      rfq_no TEXT,
      client_name TEXT NOT NULL,
      mobile TEXT,
      email TEXT,
      insurance_line TEXT DEFAULT 'GI',
      category TEXT DEFAULT 'Motor',
      product TEXT,
      policy_nature TEXT DEFAULT 'New',
      policy_type TEXT,
      sum_assured REAL DEFAULT 0,
      requested_idv REAL DEFAULT 0,
      add_ons TEXT DEFAULT '[]',
      details TEXT DEFAULT '{}',
      requirement TEXT,
      expected_premium REAL DEFAULT 0,
      insurers TEXT DEFAULT '[]',
      status TEXT DEFAULT 'Draft',
      priority TEXT DEFAULT 'Medium',
      due_date TEXT,
      quotation_id INTEGER,
      assigned_to TEXT,
      remarks TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );
  `);

  // --- lightweight migrations (add columns if missing) ---
  // Postgres supports IF NOT EXISTS on ADD COLUMN natively, so unlike the old
  // SQLite version there's no need to hand-check PRAGMA table_info first.
  await db.exec(`
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT '';
    -- Renewal engine: track the outcome of each renewal cycle per policy.
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS renewal_status TEXT DEFAULT 'Pending';
    -- Link a quotation back to the RFQ it was generated from.
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS rfq_id INTEGER;
    -- Claim register: link to policy + attach supporting documents (JSON array of {name, doc}).
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS policy_id INTEGER;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS documents TEXT DEFAULT '[]';
    -- Line-aware claims: 'Motor' | 'WC' | ... plus a JSON blob of line-specific fields
    -- (WC = injured employee, disability type, EC Act compensation, medical expenses…).
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_type TEXT DEFAULT 'Motor';
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS details TEXT DEFAULT '{}';
    -- Motor-grade RFQ intake fields.
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Motor';
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS policy_nature TEXT DEFAULT 'New';
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS policy_type TEXT;
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS requested_idv REAL DEFAULT 0;
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS add_ons TEXT DEFAULT '[]';
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS details TEXT DEFAULT '{}';
    -- Lead module intake fields. (The older assigned_to column predates
    -- this and is superseded by lead_owner — kept only so existing rows
    -- aren't silently truncated.)
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_date TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS expected_business_type TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_name TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_owner TEXT;
    -- Set only when source = 'Client Referral' — the existing client who referred.
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_client_id INTEGER;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral_client_name TEXT;

    -- Task module. The tasks table predates it with a thin set of columns;
    -- these fill it out. related_* is the polymorphic "Task For" lookup
    -- (a client or a lead), with the name denormalised so a completed task
    -- still reads correctly if that record is later renamed or removed.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS related_kind TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS related_id INTEGER;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS related_name TEXT;
    -- Single reminder, expressed as days before the due date (0 = on the day).
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_days INTEGER;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_sent INTEGER DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_sent_at TEXT;

    -- Policy module. The rest of the intake maps onto columns that already
    -- exist and that the dashboard/renewal engine read, so they're reused
    -- rather than duplicated: Plan -> product_name, Policy -> insurance_type,
    -- Policy Holder -> insured_name/client_id, Policy No -> policy_number,
    -- Basic Premium -> net_premium, Total Premium -> final_premium,
    -- Policy Start/Renewal Date -> period_from/period_to, Status ->
    -- policy_status, Payment Mode -> payment_type, Owner -> assigned_to.
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS client_email TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS associate TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS exchange_rate REAL DEFAULT 1;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS policy_mode TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS term_years TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS ppt_years TEXT;
    -- Life-side dates and nominee block.
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS commencement_date TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS maturity_date TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS nominee_name TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS nominee_age TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS nominee_relation TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS cumulative_bonus REAL DEFAULT 0;
    -- Product-specific: motor, then health.
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS ncb_pct TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS members_covered TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS room_rent TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS ped_waiting TEXT;
    -- Outcome + document.
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS policy_with_us TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS lost_reason TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS active_status TEXT DEFAULT 'Active';
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS policy_doc TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS policy_doc_name TEXT;

    -- Claim module intake + claim-flow tracking. The existing columns already
    -- cover part of it (client_name = Insured Name, claim_date = intimation
    -- date, claim_amount, status, remarks = Note, documents, claim_type,
    -- and details keeps the line-specific assessment blob).
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_title TEXT;
    -- 'Corporate' (the WCFW form) or 'Personal' — drives which claim-flow
    -- fields apply.
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_category TEXT DEFAULT 'Corporate';
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS client_id INTEGER;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS policy_type TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS policy_no TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS vehicle_no TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS patient_name TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS doctor_name TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS hospital_name TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS admission_date TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS discharge_date TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS associates TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS owner TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS intimation_no TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS file_received_date TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS process_date TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS settlement_date TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS settlement_amount REAL DEFAULT 0;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS deduction REAL DEFAULT 0;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS exchange_rate REAL DEFAULT 1;
    -- Claim Flow Required Details.
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS approved_amount REAL DEFAULT 0;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS approval_date TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS survey_date TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS surveyor_name TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS reinspection_date TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS reinspection_reason TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS delivery_location TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS delivery_date TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS pending_documents TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS required_documents TEXT;
    ALTER TABLE claims ADD COLUMN IF NOT EXISTS mode_of_transfer TEXT;

    -- Client module. Name/mobile/email/pan_no/dob/occupation/owner/address
    -- already exist and are reused.
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_category TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_status TEXT DEFAULT 'Active';
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_date TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS aadhar_no TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS review_frequency TEXT;
    -- Carried over when a lead is converted, so the origin survives.
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS lead_source TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS lead_id INTEGER;
    -- Self-referential: the client who referred this one.
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS referred_by_client_id INTEGER;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS referred_by_client_name TEXT;
    -- Family grouping. family_head_id is also self-referential; the server
    -- walks the chain on save to reject cycles.
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS family_type TEXT DEFAULT 'Individual';
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS family_head_id INTEGER;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS family_head_name TEXT;
    -- Repeatable nominee rows, as JSON: [{name, relation, dob, share_pct, mobile}]
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS nominees TEXT DEFAULT '[]';
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS country TEXT;

    -- Departments: Personal Lines vs Commercial Lines, with separate heads
    -- and teams. Users carry the department they belong to; 'Both' (the
    -- default, so nothing is hidden from existing accounts) plus admins and
    -- department heads see across both.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'Both';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_head INTEGER DEFAULT 0;

    -- Stamped on save from the product/claim type, so the split is derived
    -- from what was actually sold rather than typed in by hand.
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS department TEXT;
    ALTER TABLE leads    ADD COLUMN IF NOT EXISTS department TEXT;
    ALTER TABLE rfqs     ADD COLUMN IF NOT EXISTS department TEXT;
    ALTER TABLE claims   ADD COLUMN IF NOT EXISTS department TEXT;

    CREATE INDEX IF NOT EXISTS idx_policies_department ON policies (department);
    CREATE INDEX IF NOT EXISTS idx_leads_department ON leads (department);
    CREATE INDEX IF NOT EXISTS idx_rfqs_department ON rfqs (department);
    CREATE INDEX IF NOT EXISTS idx_claims_department ON claims (department);
  `);

  await db.exec(`
    -- Generic notes + attachments, keyed by (parent_kind, parent_id) so the
    -- same tables serve clients today and any other record later, rather
    -- than a per-module copy of the same two shapes.
    CREATE TABLE IF NOT EXISTS record_notes (
      id SERIAL PRIMARY KEY,
      parent_kind TEXT NOT NULL,
      parent_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      owner TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS record_attachments (
      id SERIAL PRIMARY KEY,
      parent_kind TEXT NOT NULL,
      parent_id INTEGER NOT NULL,
      file_name TEXT,
      file_type TEXT,
      file_size INTEGER DEFAULT 0,
      data TEXT,
      owner TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    -- Every outbound send is recorded, successful or not, so "Sent Emails"
    -- is a real audit trail rather than a guess.
    CREATE TABLE IF NOT EXISTS email_log (
      id SERIAL PRIMARY KEY,
      to_addr TEXT,
      subject TEXT,
      body_preview TEXT,
      parent_kind TEXT,
      parent_id INTEGER,
      status TEXT DEFAULT 'Sent',
      error TEXT,
      sent_by TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE INDEX IF NOT EXISTS idx_record_notes_parent ON record_notes (parent_kind, parent_id);
    CREATE INDEX IF NOT EXISTS idx_record_attachments_parent ON record_attachments (parent_kind, parent_id);
    CREATE INDEX IF NOT EXISTS idx_email_log_to ON email_log (to_addr);
    CREATE INDEX IF NOT EXISTS idx_clients_family_head ON clients (family_head_id);
  `);

  await db.exec(`
    -- Vartify WhatsApp provider settings. Token and webhook secret are
    -- treated like smtp_pass: stored server-side and never echoed back.
    ALTER TABLE integration_settings ADD COLUMN IF NOT EXISTS wa_vartify_token TEXT;
    ALTER TABLE integration_settings ADD COLUMN IF NOT EXISTS wa_vartify_base TEXT DEFAULT 'https://vartify.in/api/v1';
    ALTER TABLE integration_settings ADD COLUMN IF NOT EXISTS wa_webhook_secret TEXT;
    ALTER TABLE integration_settings ADD COLUMN IF NOT EXISTS wa_webhook_id TEXT;

    -- Vartify's contact id, kept against our record so sends and history
    -- lookups don't have to re-resolve the phone number every time.
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS vartify_contact_id INTEGER;
    ALTER TABLE leads   ADD COLUMN IF NOT EXISTS vartify_contact_id INTEGER;

    -- Every WhatsApp message in or out, so a record's timeline works without
    -- a round trip to Vartify and inbound replies are captured as they land.
    CREATE TABLE IF NOT EXISTS wa_messages (
      id SERIAL PRIMARY KEY,
      direction TEXT NOT NULL,              -- in | out
      phone_e164 TEXT,
      contact_id INTEGER,                   -- Vartify contact id
      conversation_id TEXT,
      provider_message_id TEXT,
      body TEXT,
      template_name TEXT,
      status TEXT,                          -- sent | delivered | read | failed | received
      error TEXT,
      parent_kind TEXT,                     -- client | lead
      parent_id INTEGER,
      sent_by TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE INDEX IF NOT EXISTS idx_wa_messages_parent ON wa_messages (parent_kind, parent_id);
    CREATE INDEX IF NOT EXISTS idx_wa_messages_phone ON wa_messages (phone_e164);
    -- Delivery-status webhooks arrive after the send, and are matched back by
    -- the provider's message id.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_messages_pmid ON wa_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;
  `);

  // GSTIN lives on the client so a renewal can fill it in from the record
  // rather than asking for it again on every RFQ.
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS gstin TEXT;`);

  // Payment is tracked on the RFQ rather than needing a gateway: the link is
  // whatever the insurer issues, pasted in, and paid_at is stamped when the
  // money lands. A gateway webhook can set the same two columns later.
  await db.exec(`
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS payment_link TEXT;
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS paid_at TEXT;
  `);

  // Which modules a user may open. NULL or empty means every module — so
  // existing accounts keep full access rather than being locked out the moment
  // this ships, and an admin opts people down rather than up.
  await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS module_access TEXT;`);

  // Each user's own address. Mail sent on someone's behalf goes out from their
  // mailbox only, so the CRM needs to know whose address that is. Unique
  // case-insensitively, and only among filled-in values: most accounts start
  // with none.
  await db.exec(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (LOWER(email)) WHERE NULLIF(email, '') IS NOT NULL;
  `);

  // The journey of an RFQ in real time: when it went out for quotes, when each
  // insurer answered, when the client was sent the comparison and when they
  // decided. Rows are only ever appended, so the elapsed time between two of
  // them is a fact rather than something recomputed from editable fields.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS rfq_timeline (
      id SERIAL PRIMARY KEY,
      rfq_id INTEGER NOT NULL,
      event TEXT NOT NULL,
      insurer TEXT DEFAULT '',
      note TEXT DEFAULT '',
      actor TEXT DEFAULT '',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS rfq_timeline_rfq ON rfq_timeline (rfq_id, occurred_at);
  `);

  // The client layout in use carries considerably more than the CRM did:
  // identifiers from the other systems this office runs, a secondary address,
  // and a Yes/No per product line. The product flags are columns rather than a
  // blob so they can be filtered and reported on — "clients with no health
  // cover" is the question this data exists to answer.
  await db.exec(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS salutation TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS can_iin_no TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS finnsys_id TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS added_by TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS risk_profile TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_name TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS social_lead_id TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS exchange_rate TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS send_goal_sheet TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS tin_number TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS currency TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS file_email TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_code TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS tin_updated TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_record_id TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS guardian_name TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS nominee_minor_guardian TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS other_city TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS other_state TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS other_zip TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS other_country TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS courier_ok TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS sip TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS lumpsum TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS life_insurance TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS super_top_up TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS personal_accident TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS health_insurance TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS ulip TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS travel_insurance TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS siso TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS corporate_insurance TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS vehicle_insurance TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS pms TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS critical_illness TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS goal_gps TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS demat_account TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS fhp_qualified TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS iifl_account TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS model_portfolio TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS description TEXT;
    -- Both arrive on the contact exports: a free label, and the age as it was on the sheet.
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS tag TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS age_in_years TEXT;
  `);

  // The WCFW layout records when a claim was intimated as well as its
  // intimation number; only the number had a column.
  await db.exec(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS intimation_date TEXT;`);

  await db.exec(`
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS not_approved_reason TEXT;
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS lead_id INTEGER;
  `);

  // Amounts were created as REAL, a 4-byte float with about seven significant
  // digits: a sum assured of 12,34,56,789 or a premium of 1,234,567.89 is stored
  // rounded, so imported figures stopped matching the sheet. DOUBLE PRECISION holds
  // every amount a spreadsheet can carry exactly. Existing values are converted via
  // their text form, which is the shortest decimal that round-trips (a plain cast
  // would keep only six digits). Runs only for columns still REAL, so it is a no-op
  // after the first start.
  const realCols = await db.prepare(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND data_type = 'real'`).all();
  for (const { table_name, column_name } of realCols) {
    await db.exec(`ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" TYPE DOUBLE PRECISION
      USING ROUND(${'"' + column_name + '"'}::text::numeric, 4)::double precision`);
  }

  // ---- automatic email ----
  // Master switch, off unless turned on: automatic mail goes to real clients,
  // so it shouldn't start the moment the code ships.
  // renewal_mail_sent stores the expiry it was sent for rather than a flag, so
  // a renewed policy (new period_to) re-arms itself with no extra bookkeeping.
  await db.exec(`
    ALTER TABLE integration_settings ADD COLUMN IF NOT EXISTS auto_mail_enabled INTEGER DEFAULT 0;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS renewal_mail_sent TEXT;
  `);

  // ---- RFQ quote workflow ----
  // quote_send_date is when the comparison is meant to reach the client; the
  // sweep in index.js reminds on it and quote_sent_at stops the reminder once
  // it has actually gone out, so a shared quote can't keep nagging.
  await db.exec(`
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS quote_send_date TEXT;
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS quote_sent_at TEXT;
    ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS quote_reminder_sent INTEGER DEFAULT 0;
  `);

  // ---- Zoho migration bookkeeping ----
  // The originating Zoho record id, kept so the importer (server/import-zoho.js)
  // can upsert instead of insert: re-running a file updates the same rows, and
  // a run that dies halfway is safe to repeat. It also lets later modules link
  // to earlier ones by id rather than by name.
  //
  // Unique rather than partial-unique: NULLs are distinct in Postgres, so rows
  // created in the CRM itself are unaffected and don't collide with each other.
  await db.exec(`
    ALTER TABLE clients  ADD COLUMN IF NOT EXISTS zoho_id TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS zoho_id TEXT;
    -- Group Health: is the cover for an employee (plus spouse / kids), or for someone
    -- who is not an employee (counts of spouse / children / parents). dependants is JSON.
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS employee_type TEXT;
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS dependants TEXT;
    ALTER TABLE claims   ADD COLUMN IF NOT EXISTS zoho_id TEXT;
    ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS zoho_id TEXT;
    ALTER TABLE meetings ADD COLUMN IF NOT EXISTS zoho_id TEXT;
    ALTER TABLE leads    ADD COLUMN IF NOT EXISTS zoho_id TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_zoho  ON clients  (zoho_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_policies_zoho ON policies (zoho_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_zoho   ON claims   (zoho_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_zoho    ON tasks    (zoho_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_zoho ON meetings (zoho_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_zoho    ON leads    (zoho_id);
  `);

  // Demo/sample business data (fictional companies, clients, policies, RFQs,
  // ...) is opt-in via SEED_DEMO_DATA — on by default for a nice local-dev
  // experience out of the box, explicitly turned off in production so real
  // deployments don't launch with fictional data in front of real users.
  const seedDemoData = process.env.SEED_DEMO_DATA !== 'false';

  if (seedDemoData) {
    // One-time: enrich the demo motor RFQ so the rich form/PDF has real content.
    const motor = await db.prepare("SELECT * FROM rfqs WHERE rfq_no = 'RFQ-2001'").get();
    if (motor && (!motor.details || motor.details === '{}' || motor.details === null)) {
      await db.prepare(`UPDATE rfqs SET email=?, category=?, policy_nature=?, policy_type=?, requested_idv=?, add_ons=?, details=?, insurers=? WHERE id=?`)
        .run('dutia.dharmesh@example.com', 'Motor', 'Rollover', 'Package (Comprehensive)', 900000,
          JSON.stringify(['Zero Depreciation', 'Engine Protection', 'Roadside Assistance', 'Return to Invoice', 'NCB Protection']),
          JSON.stringify({ vehicle_class: 'Private Car', reg_no: 'GJ01 AB 1234', make: 'Honda', model: 'City', variant: 'VX CVT', mfg_year: '2021', reg_date: '2021-05-14', rto: 'Rajkot (GJ-03)', fuel: 'Petrol', cc: '1498', seating: '5', engine_no: 'L15B7-1234567', chassis_no: 'MAKGD1234M1234567', ncb_pct: '25', prev_insurer: 'ICICI Lombard', prev_policy_no: '3005/ABC/2025', prev_expiry: '2026-07-28', claim_taken: 'No' }),
          JSON.stringify([
            { insurer: 'Tata AIG General Insurance Co. Ltd.', email: 'motor@tataaig.example.com', status: 'Quoted', idv: 905000, od_premium: 8200, tp_premium: 7890, addon_premium: 3900, premium: 11990, remark: 'Best price, zero-dep incl.' },
            { insurer: 'Go Digit General Insurance Limited', email: 'motor@godigit.example.com', status: 'Quoted', idv: 890000, od_premium: 8600, tp_premium: 7890, addon_premium: 4100, premium: 12480, remark: 'Fast claim TAT' },
            { insurer: 'Bajaj General Insurance Limited', email: 'motor@bajajgi.example.com', status: 'Awaited', idv: 0, od_premium: 0, tp_premium: 0, addon_premium: 0, premium: 0, remark: '' },
          ]), motor.id);
    }
  }

  await seed(seedDemoData);

  if (seedDemoData) {
    // One-time demo variety so conversion / persistency aren't all zero.
    const anyOutcome = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE renewal_status NOT IN ('Pending','')").get()).c;
    if (Number(anyOutcome) === 0) {
      const renewable = await db.prepare("SELECT id FROM policies WHERE renewable = 'Yes' ORDER BY period_to LIMIT 4").all();
      const setSt = db.prepare('UPDATE policies SET renewal_status = ? WHERE id = ?');
      const demo = ['Renewed', 'Lost', 'Renewed'];
      for (const [i, r] of renewable.entries()) { if (demo[i]) await setSt.run(demo[i], r.id); }
    }
  }
}

async function seed(seedDemoData) {
  const userCount = (await db.prepare('SELECT COUNT(*) c FROM users').get()).c;
  if (Number(userCount) === 0) {
    // Falls back to the old published demo credentials only for local dev
    // convenience — set ADMIN_USERNAME/ADMIN_PASSWORD in .env for anything
    // that isn't a throwaway local instance.
    const adminUser = process.env.ADMIN_USERNAME || 'WCA_ADMIN';
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin@123';
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('⚠️  ADMIN_PASSWORD not set — seeding the well-known demo password. Set ADMIN_USERNAME/ADMIN_PASSWORD in .env before exposing this instance.');
    }
    const hash = bcrypt.hashSync(adminPass, 10);
    await db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)')
      .run(adminUser, hash, 'Admin User', 'admin');
  }
  // Keep org branding current for existing rows (idempotent).
  await db.prepare("UPDATE users SET org_name = 'WeCare Assurance' WHERE org_name IS NULL OR org_name != 'WeCare Assurance'").run();

  if (!seedDemoData) return;

  if (Number((await db.prepare('SELECT COUNT(*) c FROM companies').get()).c) === 0) {
    const insC = db.prepare('INSERT INTO companies (company_name, type) VALUES (?,?)');
    for (const c of ['Bajaj General Insurance Limited', 'Go Digit General Insurance Limited', 'Tata AIG General Insurance Co. Ltd.',
      'HDFC ERGO General Insurance', 'ICICI Lombard General Insurance', 'New India Assurance']) await insC.run(c, 'GI');
    for (const c of ['LIC of India', 'HDFC Life Insurance', 'SBI Life Insurance', 'Max Life Insurance']) await insC.run(c, 'LI');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM agencies').get()).c) === 0) {
    const insA = db.prepare('INSERT INTO agencies (agency_name, type, contact_person, mobile, city) VALUES (?,?,?,?,?)');
    await insA.run('WCA Prime Agency', 'GI', 'Rakesh Shah', '9820011223', 'Ahmedabad');
    await insA.run('WCA Life Partners', 'LI', 'Nita Mehta', '9820033445', 'Surat');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM clients').get()).c) === 0) {
    const insCl = db.prepare(`INSERT INTO clients
      (client_name, group_head_name, group_code, email, mobile, pan_no, city, occupation)
      VALUES (?,?,?,?,?,?,?,?)`);
    const sample = [
      ['Shades & Styles Design Studio', 'Padariya Mihirkumar K', 'P00300', '', '9429570043', 'AABCS1234K', 'Ahmedabad', 'Business'],
      ['Kayra Art Gallary', 'Padariya Mihirkumar K', 'P00300', '', '9429570043', 'AACCK5678L', 'Ahmedabad', 'Business'],
      ['Niyati Parekh', 'Padariya Mihirkumar K', 'P00300', 'niyati@example.com', '9429570043', 'AKPPP9012M', 'Ahmedabad', 'Service'],
      ['Nakum Raju Ranchhodbhai', 'Nakum Group', 'N00110', '', '9909191963', 'BXKPN3456N', 'Rajkot', 'Service'],
      ['Megha Bakhda', 'Bakhda Family', 'B00087', 'megha@example.com', '9426904053', 'CLRPB7890P', 'Rajkot', 'Professional'],
      ['Dutia Dharmesh N.', 'Dutia Group', 'D00045', '', '9350844180', 'DXTPD1122Q', 'Vadodara', 'Business'],
    ];
    for (const r of sample) await insCl.run(...r);
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM policies').get()).c) === 0) {
    const insP = db.prepare(`INSERT INTO policies
      (policy_status, insurance_line, insured_name, company_name, product_name, policy_number,
       period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const today = new Date().toISOString().slice(0, 10);
    await insP.run('Policy', 'GI', 'Nakum Raju Ranchhodbhai', 'Bajaj General Insurance Limited', 'Global Personal Guard Policy', '*12-8428-0000767291-00', today, 1600000, 3251, '', 'Personal Accident');
    await insP.run('Policy', 'GI', 'Megha Bakhda', 'Go Digit General Insurance Limited', 'Pvt Car - OD Only', '*D210554038', today, 1200000, 9243, 'GJ03NB2970', 'Motor');
    await insP.run('Policy', 'GI', 'Megha Bakhda', 'Tata AIG General Insurance Co. Ltd.', 'Pvt Car - Liability', '*6201730826', today, 0, 1, 'GJ03NB2970', 'Motor');
    await insP.run('Policy', 'GI', 'Dutia Dharmesh N.', 'Bajaj General Insurance Limited', 'Bajaj Allianz Extra Care Plus 5 Lac Deductible', '*12-8432-0000080786-17', today, 1000000, 14474, '', 'Health');
    // Life Insurance policies (so LI reports have data)
    await insP.run('Policy', 'LI', 'Niyati Parekh', 'LIC of India', 'Jeevan Anand', 'LIC-9001234', today, 500000, 24500, '', 'Endowment');
    await insP.run('Policy', 'LI', 'Megha Bakhda', 'HDFC Life Insurance', 'Click 2 Protect Super', 'HDFC-7788221', today, 10000000, 12800, '', 'Term');
    await insP.run('Policy', 'LI', 'Nakum Raju Ranchhodbhai', 'SBI Life Insurance', 'Smart Wealth Builder', 'SBI-5566102', today, 1500000, 60000, '', 'ULIP');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM claims').get()).c) === 0) {
    const insCla = db.prepare('INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status) VALUES (?,?,?,?,?,?)');
    for (let i = 0; i < 7; i++) await insCla.run('Sample Client ' + (i + 1), 'Bajaj General Insurance Limited', 'CLM' + (1000 + i), '2026-07-01', 25000 + i * 1000, 'Settled');
    for (let i = 0; i < 7; i++) await insCla.run('Sample Client ' + (i + 8), 'Go Digit General Insurance Limited', 'CLM' + (2000 + i), '2026-07-05', 40000 + i * 1500, 'Pending');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM leads').get()).c) === 0) {
    const insL = db.prepare('INSERT INTO leads (lead_name, mobile, email, product_interest, source, status, assigned_to, followup_date) VALUES (?,?,?,?,?,?,?,?)');
    await insL.run('Ramesh Patel', '9812345678', 'ramesh@example.com', 'Motor Insurance', 'Website', 'New', 'Admin User', '2026-07-20');
    await insL.run('Sunita Desai', '9823456789', 'sunita@example.com', 'Health Insurance', 'Referral', 'Contacted', 'Admin User', '2026-07-18');
    await insL.run('Amit Joshi', '9834567890', '', 'Life Insurance', 'Walk-in', 'Follow Up', 'Admin User', '2026-07-15');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM lookups').get()).c) === 0) {
    const insLk = db.prepare('INSERT INTO lookups (category, name) VALUES (?,?)');
    const data = {
      make: ['Maruti Suzuki', 'Hyundai', 'Tata Motors', 'Mahindra', 'Toyota', 'Honda', 'Kia', 'Hero MotoCorp', 'Bajaj Auto', 'TVS', 'Ashok Leyland', 'Aston Martin'],
      model: ['Swift', 'Baleno', 'Creta', 'Nexon', 'Scorpio', 'Innova', 'Seltos', 'Splendor', 'Pulsar', 'Apache'],
      'risk-type': ['Own Damage', 'Third Party', 'Comprehensive', 'Fire', 'Theft', 'Natural Calamity'],
      occupancy: ['Residential', 'Commercial', 'Industrial', 'Warehouse', 'Office', 'Retail Shop'],
      'add-on-master': ['Zero Depreciation', 'Engine Protect', 'Roadside Assistance', 'Return to Invoice', 'NCB Protection', 'Consumables Cover'],
      'content-master': ['Policy Document', 'Renewal Notice', 'Welcome Letter', 'Claim Form', 'KYC Form'],
      hpa: ['HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Mahindra', 'Bajaj Finance'],
      'product-master': ['Private Car Package', 'Two Wheeler Package', 'Health Optima', 'Family Floater', 'Personal Accident', 'Home Shield', 'Shopkeeper Policy', 'Travel Secure'],
      'fd-scheme-master': ['Cumulative FD 12M', 'Non-Cumulative FD 24M', 'Senior Citizen FD 36M', 'Tax Saver FD 60M'],
    };
    for (const [cat, names] of Object.entries(data)) for (const n of names) await insLk.run(cat, n);
  }

  // Vehicle make -> model -> variant catalogue for the RFQ Motor cascading dropdowns.
  // Runs independently of the block above (existence-checked per row) so it also
  // backfills databases that were already seeded before this catalogue existed.
  {
    const hasLookup = db.prepare('SELECT 1 FROM lookups WHERE category = ? AND name = ?');
    const insLookup = db.prepare('INSERT INTO lookups (category, name) VALUES (?,?)');
    const addLookup = async (category, name) => { if (!(await hasLookup.get(category, name))) await insLookup.run(category, name); };
    const modelCat = (make) => 'model:' + encodeURIComponent(make);
    const variantCat = (make, model) => 'variant:' + encodeURIComponent(make) + ':' + encodeURIComponent(model);

    const VEHICLE_CATALOGUE = {
      'Maruti Suzuki': { Swift: ['LXI', 'VXI', 'ZXI', 'ZXI+'], Baleno: ['Sigma', 'Delta', 'Zeta', 'Alpha'], Dzire: ['LXI', 'VXI', 'ZXI', 'ZXI+'], 'Wagon R': ['LXI', 'VXI', 'ZXI'], Ertiga: ['LXI', 'VXI', 'ZXI', 'ZXI+'], Brezza: ['LXI', 'VXI', 'ZXI', 'ZXI+'] },
      Hyundai: { Creta: ['E', 'EX', 'S', 'SX', 'SX(O)'], Venue: ['E', 'S', 'SX', 'SX(O)'], i20: ['Era', 'Magna', 'Sportz', 'Asta'], Verna: ['EX', 'S', 'SX', 'SX(O)'], 'Grand i10 Nios': ['Era', 'Magna', 'Sportz', 'Asta'] },
      'Tata Motors': { Nexon: ['XE', 'XM', 'XT', 'XZ', 'XZ+'], Punch: ['Pure', 'Adventure', 'Accomplished', 'Creative'], Altroz: ['XE', 'XM', 'XT', 'XZ'], Harrier: ['Smart', 'Pure', 'Adventure', 'Fearless'], Tiago: ['XE', 'XM', 'XT', 'XZ'] },
      Mahindra: { Scorpio: ['S3', 'S5', 'S7', 'S11'], XUV700: ['MX', 'AX3', 'AX5', 'AX7'], Thar: ['AX', 'LX'], Bolero: ['B4', 'B6'], XUV300: ['W4', 'W6', 'W8'] },
      Toyota: { Innova: ['G', 'GX', 'VX', 'ZX'], Fortuner: ['4x2 MT', '4x2 AT', '4x4 AT', 'Legender'], Glanza: ['E', 'S', 'G', 'V'] },
      Honda: { City: ['SV', 'V', 'VX', 'ZX'], Amaze: ['E', 'S', 'VX'], Elevate: ['SV', 'V', 'VX', 'ZX'] },
      Kia: { Seltos: ['HTE', 'HTK', 'HTX', 'GTX'], Sonet: ['HTE', 'HTK', 'HTX', 'GTX'], Carens: ['Premium', 'Prestige', 'Prestige Plus', 'Luxury'] },
      'Hero MotoCorp': { Splendor: ['Plus', 'Plus XTEC', 'Pro'], Passion: ['Pro', 'XTEC'], 'HF Deluxe': ['Standard', 'Eco'] },
      'Bajaj Auto': { Pulsar: ['125', '150', '180', '220F', 'NS200'], Platina: ['100', '110'], Avenger: ['Street 160', 'Cruise 220'] },
      TVS: { Apache: ['RTR 160', 'RTR 180', 'RTR 200 4V', 'RR 310'], Jupiter: ['Standard', 'ZX'], Ntorq: ['Race', 'Race XP'] },
    };
    for (const [make, models] of Object.entries(VEHICLE_CATALOGUE)) {
      await addLookup('make', make);
      for (const [model, variants] of Object.entries(models)) {
        await addLookup(modelCat(make), model);
        for (const variant of variants) await addLookup(variantCat(make, model), variant);
      }
    }

    // Policy Purchase — RM / Sub Agent / Agency Code starter lookups.
    for (const n of ['Admin User', 'Rakesh Shah', 'Nita Mehta', 'Priya Sharma']) await addLookup('rm-master', n);
    for (const n of ['Ramesh Traders', 'Suresh Associates', 'Mahesh Insurance Consultants']) await addLookup('sub-agent-master', n);
    for (const n of ['AGY-GJ-001', 'AGY-GJ-002', 'AGY-MH-001']) await addLookup('agency-code', n);
    // Claim Register — generic (Motor-path) claim's loss-type classifier.
    for (const n of ['Motor', 'Non-Motor']) await addLookup('claim-loss-type', n);
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM endorsements').get()).c) === 0) {
    const insE = db.prepare('INSERT INTO endorsements (policy_number, insured_name, company_name, endorsement_no, endorsement_type, endorsement_date, premium_effect, remarks) VALUES (?,?,?,?,?,?,?,?)');
    await insE.run('*D210554038', 'Megha Bakhda', 'Go Digit General Insurance Limited', 'END-1001', 'Nominee Change', '2026-07-02', 0, 'Nominee updated');
    await insE.run('*12-8432-0000080786-17', 'Dutia Dharmesh N.', 'Bajaj General Insurance Limited', 'END-1002', 'Sum Insured Increase', '2026-07-08', 1200, 'SI increased by 1L');
    await insE.run('*6201730826', 'Megha Bakhda', 'Tata AIG General Insurance Co. Ltd.', 'END-1003', 'Address Change', '2026-07-10', 0, 'Communication address updated');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM commissions').get()).c) === 0) {
    const insCm = db.prepare('INSERT INTO commissions (kind, policy_number, insured_name, company_name, agency_name, base_premium, rate, amount, status, entry_date) VALUES (?,?,?,?,?,?,?,?,?,?)');
    await insCm.run('payin', '*12-8428-0000767291-00', 'Nakum Raju Ranchhodbhai', 'Bajaj General Insurance Limited', 'WCA Prime Agency', 3251, 15, 487.65, 'Received', '2026-07-05');
    await insCm.run('payin', '*D210554038', 'Megha Bakhda', 'Go Digit General Insurance Limited', 'WCA Prime Agency', 9243, 12.5, 1155.38, 'Pending', '2026-07-06');
    await insCm.run('payout', '*12-8432-0000080786-17', 'Dutia Dharmesh N.', 'Bajaj General Insurance Limited', 'WCA Prime Agency', 14474, 8, 1157.92, 'Paid', '2026-07-07');
    await insCm.run('payout', '*6201730826', 'Megha Bakhda', 'Tata AIG General Insurance Co. Ltd.', 'WCA Prime Agency', 1, 10, 0.1, 'Pending', '2026-07-08');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM tasks').get()).c) === 0) {
    const insT = db.prepare('INSERT INTO tasks (title, assigned_to, priority, due_date, status) VALUES (?,?,?,?,?)');
    await insT.run('Call Megha Bakhda for motor renewal', 'Admin User', 'High', '2026-07-14', 'Open');
    await insT.run('Collect KYC from Nakum Raju', 'Admin User', 'Medium', '2026-07-16', 'Open');
    await insT.run('Send policy copy to Dutia Dharmesh', 'Admin User', 'Low', '2026-07-13', 'Done');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM fd_transactions').get()).c) === 0) {
    const insFd = db.prepare(`INSERT INTO fd_transactions (client_name, scheme_name, company_name, fd_number, amount, interest_rate, tenure_months, start_date, maturity_date, maturity_amount, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    await insFd.run('Niyati Parekh', 'Cumulative FD 12M', 'Bajaj Finance', 'FD-100234', 200000, 7.5, 12, '2026-01-15', '2027-01-15', 215000, 'Active');
    await insFd.run('Megha Bakhda', 'Senior Citizen FD 36M', 'HDFC Bank', 'FD-100235', 500000, 8.1, 36, '2025-06-10', '2028-06-10', 631500, 'Active');
    await insFd.run('Nakum Raju Ranchhodbhai', 'Tax Saver FD 60M', 'SBI', 'FD-100236', 150000, 6.8, 60, '2024-04-01', '2029-04-01', 201000, 'Active');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM quotations').get()).c) === 0) {
    const insQ = db.prepare(`INSERT INTO quotations (quote_no, client_name, mobile, insurance_line, product, sum_assured, options, selected_insurer, selected_premium, status, valid_till, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    await insQ.run('QT-1001', 'Megha Bakhda', '9426904053', 'GI', 'Private Car - Comprehensive', 850000,
      JSON.stringify([{ insurer: 'Go Digit General Insurance Limited', premium: 12480, remark: 'Zero-dep incl.' }, { insurer: 'Bajaj General Insurance Limited', premium: 13150, remark: 'RSA add-on' }, { insurer: 'Tata AIG General Insurance Co. Ltd.', premium: 11990, remark: 'Best price' }]),
      'Tata AIG General Insurance Co. Ltd.', 11990, 'Sent', '2026-08-15', 'Admin User', 'Client comparing zero-dep options');
    await insQ.run('QT-1002', 'Niyati Parekh', '9429570043', 'GI', 'Family Health Floater 10L', 1000000,
      JSON.stringify([{ insurer: 'HDFC ERGO General Insurance', premium: 24800, remark: 'No room-rent cap' }, { insurer: 'Bajaj General Insurance Limited', premium: 22100, remark: '10% co-pay' }]),
      'Bajaj General Insurance Limited', 22100, 'Accepted', '2026-08-20', 'Admin User', 'Awaiting KYC to issue');
    await insQ.run('QT-1003', 'Nakum Raju Ranchhodbhai', '9909191963', 'LI', 'Term Plan 1 Cr', 10000000,
      JSON.stringify([{ insurer: 'SBI Life Insurance', premium: 14500, remark: '30yr term' }, { insurer: 'HDFC Life Insurance', premium: 15200, remark: 'CI rider' }, { insurer: 'LIC of India', premium: 16800, remark: '' }]),
      'SBI Life Insurance', 14500, 'Draft', '2026-09-01', 'Admin User', '');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM rfqs').get()).c) === 0) {
    const insR = db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, insurance_line, product, sum_assured, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    await insR.run('RFQ-2001', 'Dutia Dharmesh N.', '9350844180', 'GI', 'Private Car - Comprehensive', 900000,
      'Renewal of Honda City 2021, IDV ~9L, NCB 25%, zero-dep + RSA add-ons required', 13000,
      JSON.stringify([{ insurer: 'Tata AIG General Insurance Co. Ltd.', status: 'Quoted', premium: 11990 }, { insurer: 'Go Digit General Insurance Limited', status: 'Quoted', premium: 12480 }, { insurer: 'Bajaj General Insurance Limited', status: 'Awaited', premium: 0 }]),
      'Quotes Received', 'High', '2026-07-28', 'Admin User', 'Client wants best zero-dep price');
    await insR.run('RFQ-2002', 'Kayra Art Gallary', '9429570043', 'GI', 'Fire & Burglary (SFSP)', 2500000,
      'Shop contents + stock cover, Rajkot; burglary add-on', 18000,
      JSON.stringify([{ insurer: 'HDFC ERGO General Insurance', status: 'Awaited', premium: 0 }, { insurer: 'Bajaj General Insurance Limited', status: 'Awaited', premium: 0 }]),
      'Sent', 'Medium', '2026-08-02', 'Admin User', 'Awaiting insurer response');
    await insR.run('RFQ-2003', 'Nakum Raju Ranchhodbhai', '9909191963', 'LI', 'Term Plan 1 Cr', 10000000,
      'Age 38, non-smoker, 30-year term, CI rider optional', 15000,
      JSON.stringify([]),
      'Draft', 'Low', '2026-08-10', 'Admin User', 'Collecting income proof');
  }

  // --- Workmen's Compensation demo data (idempotent — added even to existing DBs) ---
  if (!(await db.prepare("SELECT 1 FROM policies WHERE policy_number = 'WC/2026/0098'").get())) {
    await db.prepare(`INSERT INTO policies (policy_status, insurance_line, insured_name, company_name, product_name, policy_number, period_from, period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('Policy', 'GI', 'Shakti Fabrication Works', 'ICICI Lombard General Insurance', "Workmen's Compensation Policy", 'WC/2026/0098', '2026-06-01', '2027-05-31', 0, 20150, '', 'Workmen Compensation');
  }
  if (!(await db.prepare("SELECT 1 FROM rfqs WHERE client_name = 'Shakti Fabrication Works'").get())) {
    const wcDetails = {
      business: 'MS fabrication & structural steel works', work_type: 'Manufacturing', location: 'GIDC Lodhika, Rajkot', gst: '24ABCDE1234F1Z5',
      table: 'Table B (WC Act + Common Law)',
      wage_cats: [
        { cat: 'Skilled', count: 8, wages: 1536000 },
        { cat: 'Semi-skilled', count: 12, wages: 1728000 },
        { cat: 'Unskilled', count: 15, wages: 1620000 },
        { cat: 'Supervisor', count: 2, wages: 600000 },
      ],
      total_employees: 37, wage_roll: 5484000, medical_ext: 'Yes', med_limit: 100000,
      prev_insurer: 'The New India Assurance', prev_policy_no: 'WC/2025/1187', prev_expiry: '2026-08-05', claims_3yr: '1 minor (₹18,000)',
    };
    const wcInsurers = [
      { insurer: 'ICICI Lombard General Insurance', email: 'commercial@icicilombard.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 3.2, wc_basic: 17550, wc_medical: 1400, addon_premium: 1200, premium: 20150, addons_incl: ['Medical Extension', 'Occupational Disease', 'Sub-contractors'], selected: true, quote_doc: '', quote_name: '', remark: 'Best rate; ODC incl.' },
      { insurer: 'The New India Assurance', email: 'wc@newindia.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 3.75, wc_basic: 20565, wc_medical: 1600, addon_premium: 0, premium: 22165, addons_incl: ['Medical Extension', 'Occupational Disease', 'Sub-contractors', 'Terrorism'], selected: false, quote_doc: '', quote_name: '', remark: 'PSU, full add-ons' },
      { insurer: 'Bajaj General Insurance Limited', email: 'claims@bajajgi.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 3.5, wc_basic: 19194, wc_medical: 1500, addon_premium: 1000, premium: 21694, addons_incl: ['Medical Extension', 'Occupational Disease', 'Terrorism'], selected: false, quote_doc: '', quote_name: '', remark: '' },
    ];
    await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'RFQ-WC-2101', 'Shakti Fabrication Works', '9825012345', 'accounts@shaktifab.example.com', 'GI', 'Workmen Compensation', "Workmen's Compensation",
      'New', 'Table B (WC Act + Common Law)', 0, 0,
      JSON.stringify(['Medical Extension', 'Occupational Disease', 'Sub-contractors', 'Terrorism']),
      JSON.stringify(wcDetails), 'WC cover for 37 workmen, wage roll ₹54.84L, medical extension ₹1L, ODC required', 19000,
      JSON.stringify(wcInsurers), 'Quotes Received', 'High', '2026-08-01', 'Admin User', 'Factory WC — compare rate per mille & ODC');
  }
  if (!(await db.prepare("SELECT 1 FROM claims WHERE claim_no = 'WC-CLM-1001'").get())) {
    const wcClaimDetails = { employee_name: 'Ramesh Solanki', designation: 'Welder (Skilled)', monthly_wages: 18000, age: 34, accident_date: '2026-07-09', injury_nature: 'Fracture — left hand, machine injury', body_part: 'Left hand', disability_type: 'Temporary Total (TTD)', loss_pct: 0, medical_expenses: 24000 };
    const wcPolicyId = (await db.prepare("SELECT id FROM policies WHERE policy_number='WC/2026/0098'").get())?.id || null;
    await db.prepare(`INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, claim_type, policy_id, details, documents)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'Shakti Fabrication Works', 'ICICI Lombard General Insurance', 'WC-CLM-1001', '2026-07-12', 46875, 'Pending', 'WC',
      wcPolicyId, JSON.stringify(wcClaimDetails), '[]');
  }

  // --- Group Personal Accident (GPA) demo data ---
  if (!(await db.prepare("SELECT 1 FROM policies WHERE policy_number = 'GPA/2026/0450'").get())) {
    await db.prepare(`INSERT INTO policies (policy_status, insurance_line, insured_name, company_name, product_name, policy_number, period_from, period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('Policy', 'GI', 'Zenith Software LLP', 'HDFC ERGO General Insurance', 'Group Personal Accident', 'GPA/2026/0450', '2026-04-01', '2027-03-31', 120000000, 78500, '', 'Group Personal Accident');
  }
  if (!(await db.prepare("SELECT 1 FROM rfqs WHERE client_name = 'Zenith Software LLP'").get())) {
    const gpaDetails = {
      business: 'IT / software services', risk_group: 'Risk Group I (clerical / admin)', location: 'GIFT City, Gandhinagar', gst: '24ZENIT1234K1Z2', csi_basis: '60× Monthly Salary',
      member_cats: [
        { cat: 'Directors / Management', count: 5, csi: 5000000 },
        { cat: 'Officers / Executives', count: 40, csi: 2000000 },
        { cat: 'Clerical / Admin', count: 15, csi: 1000000 },
      ],
      total_members: 60, total_csi: 120000000, medical_ext: 'Yes', med_limit: 100000, ttd_weekly: 5000,
      prev_insurer: 'ICICI Lombard General Insurance', prev_policy_no: 'GPA/2025/0221', prev_expiry: '2026-03-31', claims_3yr: 'Nil',
    };
    const gpaInsurers = [
      { insurer: 'HDFC ERGO General Insurance', email: 'corporate@hdfcergo.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 0.55, wc_basic: 66000, wc_medical: 7500, addon_premium: 5000, premium: 78500, addons_incl: ['Temporary Total Disablement (Weekly)', 'Medical Extension', 'Ambulance Charges'], selected: true, quote_doc: '', quote_name: '', remark: 'Best rate; TTD incl.' },
      { insurer: 'ICICI Lombard General Insurance', email: 'commercial@icicilombard.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 0.60, wc_basic: 72000, wc_medical: 8000, addon_premium: 6000, premium: 86000, addons_incl: ['Temporary Total Disablement (Weekly)', 'Medical Extension', 'Ambulance Charges', 'Terrorism'], selected: false, quote_doc: '', quote_name: '', remark: 'All extensions' },
      { insurer: 'Bajaj General Insurance Limited', email: 'claims@bajajgi.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 0.58, wc_basic: 69600, wc_medical: 7800, addon_premium: 4000, premium: 81400, addons_incl: ['Temporary Total Disablement (Weekly)', 'Medical Extension', 'Terrorism'], selected: false, quote_doc: '', quote_name: '', remark: '' },
    ];
    await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'RFQ-GPA-2201', 'Zenith Software LLP', '9825033445', 'hr@zenithsoft.example.com', 'GI', 'Group Personal Accident', 'Group Personal Accident',
      'New', 'Flat Sum Insured', 0, 0,
      JSON.stringify(['Temporary Total Disablement (Weekly)', 'Medical Extension', 'Ambulance Charges', 'Terrorism']),
      JSON.stringify(gpaDetails), 'GPA for 60 staff, total CSI ₹12 Cr, AD/PTD/PPD + TTD & medical extension', 80000,
      JSON.stringify(gpaInsurers), 'Quotes Received', 'High', '2026-08-05', 'Admin User', 'Software co. — Risk Group I, compare rate per mille');
  }
  if (!(await db.prepare("SELECT 1 FROM claims WHERE claim_no = 'GPA-CLM-1001'").get())) {
    const gpaClaimDetails = { member_name: 'Anita Rao', designation: 'Officer / Executive', csi: 2000000, age: 41, accident_date: '2026-07-06', injury_nature: 'Road accident — hand fracture', disability_type: 'Permanent Partial (PPD)', loss_pct: 30, weeks: 0, medical_expenses: 40000, benefit: 600000 };
    const gpaPolicyId = (await db.prepare("SELECT id FROM policies WHERE policy_number='GPA/2026/0450'").get())?.id || null;
    await db.prepare(`INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, claim_type, policy_id, details, documents) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'Zenith Software LLP', 'HDFC ERGO General Insurance', 'GPA-CLM-1001', '2026-07-10', 640000, 'Under Investigation', 'GPA',
      gpaPolicyId, JSON.stringify(gpaClaimDetails), '[]');
  }

  // --- Group Health Insurance (GHI / Group Mediclaim) demo data ---
  if (!(await db.prepare("SELECT 1 FROM policies WHERE policy_number = 'GHI/2026/0771'").get())) {
    await db.prepare(`INSERT INTO policies (policy_status, insurance_line, insured_name, company_name, product_name, policy_number, period_from, period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('Policy', 'GI', 'Orbit Retail Pvt Ltd', 'ICICI Lombard General Insurance', 'Group Mediclaim Floater', 'GHI/2026/0771', '2026-05-01', '2027-04-30', 500000, 1350000, '', 'Group Health');
  }
  if (!(await db.prepare("SELECT 1 FROM rfqs WHERE client_name = 'Orbit Retail Pvt Ltd'").get())) {
    const ghiDetails = {
      business: 'Retail chain', location: 'Ahmedabad', gst: '24ORBIT5678L1Z9',
      family_def: 'Employee + Spouse + 2 Kids (1+3)', si_per_family: '500000', total_employees: 120, total_lives: 420,
      room_rent: '1% of SI / day', copay: 10, ped_waiver: 'Yes', maternity_limit: 50000,
      prev_insurer: 'The New India Assurance', prev_policy_no: 'GMC/2025/3391', prev_expiry: '2026-08-20', claims_3yr: '78% incurred claims ratio',
    };
    const ghiInsurers = [
      { insurer: 'ICICI Lombard General Insurance', email: 'grouphealth@icicilombard.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 10500, wc_basic: 1260000, wc_medical: 0, addon_premium: 90000, premium: 1350000, addons_incl: ['Maternity Cover', 'Pre-existing Waiver Day-1', 'Corporate Buffer', 'Ambulance'], selected: true, quote_doc: '', quote_name: '', remark: 'Best per-family rate' },
      { insurer: 'Star Health & Allied Insurance', email: 'corporate@starhealth.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 11000, wc_basic: 1320000, wc_medical: 0, addon_premium: 60000, premium: 1380000, addons_incl: ['Maternity Cover', 'Pre-existing Waiver Day-1', 'Ambulance'], selected: false, quote_doc: '', quote_name: '', remark: '' },
      { insurer: 'Care Health Insurance', email: 'groups@careinsurance.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 11500, wc_basic: 1380000, wc_medical: 0, addon_premium: 40000, premium: 1420000, addons_incl: ['Maternity Cover', 'Corporate Buffer'], selected: false, quote_doc: '', quote_name: '', remark: 'Wide hospital network' },
    ];
    await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'RFQ-GHI-2301', 'Orbit Retail Pvt Ltd', '9825066778', 'admin@orbitretail.example.com', 'GI', 'Group Health Insurance', 'Group Mediclaim',
      'Renewal', 'Family Floater', 500000, 0,
      JSON.stringify(['Maternity Cover', 'Pre-existing Waiver Day-1', 'Corporate Buffer', 'Ambulance']),
      JSON.stringify(ghiDetails), 'Group mediclaim 1+3 floater ₹5L, 120 families / 420 lives, maternity + PED day-1', 1350000,
      JSON.stringify(ghiInsurers), 'Quotes Received', 'High', '2026-08-10', 'Admin User', 'Retail chain renewal — compare per-family premium & maternity');
  }
  if (!(await db.prepare("SELECT 1 FROM claims WHERE claim_no = 'GHI-CLM-1001'").get())) {
    const ghiClaimDetails = { patient_name: 'Rohan Mehta', relationship: 'Self', hospital: 'Sterling Hospital, Ahmedabad', ailment: 'Appendectomy', admit_date: '2026-07-05', discharge_date: '2026-07-08', room_category: 'Single Private AC', claim_mode: 'Cashless', tpa: 'MDIndia', claimed_amount: 68000, approved_amount: 61200 };
    const ghiPolicyId = (await db.prepare("SELECT id FROM policies WHERE policy_number='GHI/2026/0771'").get())?.id || null;
    await db.prepare(`INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, claim_type, policy_id, details, documents) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'Orbit Retail Pvt Ltd', 'ICICI Lombard General Insurance', 'GHI-CLM-1001', '2026-07-05', 61200, 'Settled', 'GHI',
      ghiPolicyId, JSON.stringify(ghiClaimDetails), '[]');
  }

  // --- Fire & Property (SFSP) demo data ---
  if (!(await db.prepare("SELECT 1 FROM policies WHERE policy_number = 'FIRE/2026/1203'").get())) {
    await db.prepare(`INSERT INTO policies (policy_status, insurance_line, insured_name, company_name, product_name, policy_number, period_from, period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('Policy', 'GI', 'Sunrise Textile Mills', 'The New India Assurance', 'Fire & Special Perils', 'FIRE/2026/1203', '2026-06-01', '2027-05-31', 50000000, 70500, '', 'Fire & Property');
  }
  if (!(await db.prepare("SELECT 1 FROM rfqs WHERE client_name = 'Sunrise Textile Mills'").get())) {
    const fireDetails = { business: 'Textile manufacturing & warehousing', occupancy: 'Industrial / Factory', construction: 'Pucca (RCC)', location: 'GIDC Vatva, Ahmedabad', bank: 'HDFC Bank',
      asset_schedule: [{ asset: 'Building', si: 20000000 }, { asset: 'Plant & Machinery', si: 15000000 }, { asset: 'Stock / Inventory', si: 12000000 }, { asset: 'Furniture, Fixtures & Fittings', si: 3000000 }], total_si: 50000000,
      prev_insurer: 'ICICI Lombard General Insurance', prev_policy_no: 'FIRE/2025/0987', prev_expiry: '2026-05-31', claims_3yr: 'Nil' };
    const fireInsurers = [
      { insurer: 'The New India Assurance', email: 'fire@newindia.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 1.25, wc_basic: 62500, wc_medical: 0, addon_premium: 8000, premium: 70500, addons_incl: ['STFI (Storm, Tempest, Flood)', 'Earthquake', 'Terrorism', 'Business Interruption (Loss of Profit)'], selected: true, quote_doc: '', quote_name: '', remark: 'Best rate; full perils' },
      { insurer: 'ICICI Lombard General Insurance', email: 'commercial@icicilombard.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 1.35, wc_basic: 67500, wc_medical: 0, addon_premium: 6000, premium: 73500, addons_incl: ['STFI (Storm, Tempest, Flood)', 'Earthquake', 'Terrorism'], selected: false, quote_doc: '', quote_name: '', remark: '' },
      { insurer: 'Bajaj General Insurance Limited', email: 'claims@bajajgi.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 1.32, wc_basic: 66000, wc_medical: 0, addon_premium: 7000, premium: 73000, addons_incl: ['STFI (Storm, Tempest, Flood)', 'Earthquake', 'Business Interruption (Loss of Profit)'], selected: false, quote_doc: '', quote_name: '', remark: '' },
    ];
    await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'RFQ-FIRE-2401', 'Sunrise Textile Mills', '9825077889', 'accounts@sunrisetextile.example.com', 'GI', 'Fire & Property', 'Fire & Special Perils', 'New', 'Standard Fire & Special Perils', 50000000, 0,
      JSON.stringify(['STFI (Storm, Tempest, Flood)', 'Earthquake', 'Terrorism', 'Business Interruption (Loss of Profit)']),
      JSON.stringify(fireDetails), 'Fire & special perils on factory — SI ₹5 Cr, STFI + EQ + terrorism + BI', 72000,
      JSON.stringify(fireInsurers), 'Quotes Received', 'High', '2026-08-01', 'Admin User', 'Textile factory — compare rate per mille & BI');
  }
  if (!(await db.prepare("SELECT 1 FROM claims WHERE claim_no = 'FIRE-CLM-1001'").get())) {
    const fireClaimDetails = { peril: 'Fire', cause: 'Short circuit in godown', affected_asset: 'Stock / Inventory', estimated_loss: 800000, salvage: 50000, assessed_amount: 720000, surveyor: 'M/s Reliable Surveyors' };
    const firePolicyId = (await db.prepare("SELECT id FROM policies WHERE policy_number='FIRE/2026/1203'").get())?.id || null;
    await db.prepare(`INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, claim_type, policy_id, details, documents) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'Sunrise Textile Mills', 'The New India Assurance', 'FIRE-CLM-1001', '2026-07-08', 720000, 'Approved', 'Fire',
      firePolicyId, JSON.stringify(fireClaimDetails), '[]');
  }

  // --- Marine Cargo demo data ---
  if (!(await db.prepare("SELECT 1 FROM policies WHERE policy_number = 'MAR/2026/0567'").get())) {
    await db.prepare(`INSERT INTO policies (policy_status, insurance_line, insured_name, company_name, product_name, policy_number, period_from, period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('Policy', 'GI', 'Global Exports Pvt Ltd', 'ICICI Lombard General Insurance', 'Marine Cargo (Open Policy)', 'MAR/2026/0567', '2026-07-01', '2027-06-30', 10000000, 18000, '', 'Marine Cargo');
  }
  if (!(await db.prepare("SELECT 1 FROM rfqs WHERE client_name = 'Global Exports Pvt Ltd'").get())) {
    const marDetails = { goods: 'Ceramic tiles (fragile)', packing: 'Wooden crates', consignment_si: 10000000, from: 'Morbi, Gujarat', to: 'JNPT, Mumbai (export)', mode: 'Multimodal', marine_basis: 'Open Policy (Annual)', cover_basis: 'ICC (A) — All Risks', voyage_date: '2026-08-01',
      prev_insurer: 'Tata AIG General Insurance Co. Ltd.', prev_policy_no: 'MAR/2025/0321', prev_expiry: '2026-06-30', claims_3yr: '1 breakage claim (₹45,000)' };
    const marInsurers = [
      { insurer: 'ICICI Lombard General Insurance', email: 'marine@icicilombard.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 1.6, wc_basic: 16000, wc_medical: 0, addon_premium: 2000, premium: 18000, addons_incl: ['War & SRCC', 'Warehouse-to-Warehouse'], selected: true, quote_doc: '', quote_name: '', remark: 'Best rate; W-to-W incl.' },
      { insurer: 'Tata AIG General Insurance Co. Ltd.', email: 'marine@tataaig.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 1.75, wc_basic: 17500, wc_medical: 0, addon_premium: 1500, premium: 19000, addons_incl: ['War & SRCC', 'Warehouse-to-Warehouse'], selected: false, quote_doc: '', quote_name: '', remark: '' },
      { insurer: 'The New India Assurance', email: 'marine@newindia.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 1.8, wc_basic: 18000, wc_medical: 0, addon_premium: 1000, premium: 19000, addons_incl: ['Warehouse-to-Warehouse'], selected: false, quote_doc: '', quote_name: '', remark: 'PSU' },
    ];
    await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'RFQ-MAR-2501', 'Global Exports Pvt Ltd', '9825088990', 'logistics@globalexports.example.com', 'GI', 'Marine Cargo', 'Marine Cargo', 'New', 'Open Policy (Annual)', 10000000, 0,
      JSON.stringify(['War & SRCC', 'Warehouse-to-Warehouse']),
      JSON.stringify(marDetails), 'Marine open policy — tiles Morbi→JNPT, SI ₹1 Cr, ICC(A), war + W-to-W', 18000,
      JSON.stringify(marInsurers), 'Quotes Received', 'Medium', '2026-08-03', 'Admin User', 'Tile exporter — ICC(A) all risks');
  }
  if (!(await db.prepare("SELECT 1 FROM claims WHERE claim_no = 'MAR-CLM-1001'").get())) {
    const marClaimDetails = { loss_type: 'Partial Loss', place: 'In transit near Morbi', cause: 'Breakage of tiles — rough handling', survey_ref: 'SVY/2026/MAR/112', claimed_amount: 60000, assessed_amount: 52000 };
    const marPolicyId = (await db.prepare("SELECT id FROM policies WHERE policy_number='MAR/2026/0567'").get())?.id || null;
    await db.prepare(`INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, claim_type, policy_id, details, documents) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'Global Exports Pvt Ltd', 'ICICI Lombard General Insurance', 'MAR-CLM-1001', '2026-07-11', 52000, 'Settled', 'Marine',
      marPolicyId, JSON.stringify(marClaimDetails), '[]');
  }

  // --- Liability (Professional Indemnity) demo data ---
  if (!(await db.prepare("SELECT 1 FROM policies WHERE policy_number = 'PI/2026/0089'").get())) {
    await db.prepare(`INSERT INTO policies (policy_status, insurance_line, insured_name, company_name, product_name, policy_number, period_from, period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('Policy', 'GI', 'MediCare Diagnostics LLP', 'HDFC ERGO General Insurance', 'Professional Indemnity', 'PI/2026/0089', '2026-08-01', '2027-07-31', 10000000, 51000, '', 'Liability');
  }
  if (!(await db.prepare("SELECT 1 FROM rfqs WHERE client_name = 'MediCare Diagnostics LLP'").get())) {
    const liabDetails = { liability_type: 'Professional Indemnity', business: 'Diagnostic laboratory & pathology', limit_aoa: 5000000, limit_aoy: 10000000, turnover: 40000000, retroactive_date: '2022-08-01', jurisdiction: 'India',
      prev_insurer: 'ICICI Lombard General Insurance', prev_policy_no: 'PI/2025/0055', prev_expiry: '2026-07-31', claims_3yr: 'Nil' };
    const liabInsurers = [
      { insurer: 'HDFC ERGO General Insurance', email: 'liability@hdfcergo.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 4.5, wc_basic: 45000, wc_medical: 0, addon_premium: 6000, premium: 51000, addons_incl: ['Retroactive Cover', 'Legal Defense Costs', 'Cyber Liability'], selected: true, quote_doc: '', quote_name: '', remark: 'Best terms; cyber incl.' },
      { insurer: 'ICICI Lombard General Insurance', email: 'liability@icicilombard.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 4.8, wc_basic: 48000, wc_medical: 0, addon_premium: 5000, premium: 53000, addons_incl: ['Retroactive Cover', 'Legal Defense Costs'], selected: false, quote_doc: '', quote_name: '', remark: '' },
      { insurer: 'Tata AIG General Insurance Co. Ltd.', email: 'liability@tataaig.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 5.0, wc_basic: 50000, wc_medical: 0, addon_premium: 4000, premium: 54000, addons_incl: ['Retroactive Cover', 'Cyber Liability'], selected: false, quote_doc: '', quote_name: '', remark: '' },
    ];
    await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'RFQ-LIAB-2601', 'MediCare Diagnostics LLP', '9825099001', 'admin@medicarediag.example.com', 'GI', 'Liability', 'Professional Indemnity', 'New', 'Claims-made', 10000000, 0,
      JSON.stringify(['Retroactive Cover', 'Legal Defense Costs', 'Cyber Liability']),
      JSON.stringify(liabDetails), 'Professional Indemnity for diagnostics lab — AOY ₹1 Cr, retroactive + cyber', 50000,
      JSON.stringify(liabInsurers), 'Quotes Received', 'High', '2026-08-06', 'Admin User', 'Pathology lab PI — compare retroactive & cyber');
  }
  if (!(await db.prepare("SELECT 1 FROM claims WHERE claim_no = 'LIAB-CLM-1001'").get())) {
    const liabClaimDetails = { claimant: 'Patient — Mr. R. Shah', claim_nature: 'Alleged misdiagnosis / report error', incident_date: '2026-06-20', alleged_amount: 1500000, defense_costs: 200000, assessed_amount: 800000 };
    const liabPolicyId = (await db.prepare("SELECT id FROM policies WHERE policy_number='PI/2026/0089'").get())?.id || null;
    await db.prepare(`INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, claim_type, policy_id, details, documents) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'MediCare Diagnostics LLP', 'HDFC ERGO General Insurance', 'LIAB-CLM-1001', '2026-06-20', 800000, 'Under Defense', 'Liability',
      liabPolicyId, JSON.stringify(liabClaimDetails), '[]');
  }

  // --- Group Term Life demo data ---
  if (!(await db.prepare("SELECT 1 FROM policies WHERE policy_number = 'GTL/2026/0334'").get())) {
    await db.prepare(`INSERT INTO policies (policy_status, insurance_line, insured_name, company_name, product_name, policy_number, period_from, period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('Policy', 'LI', 'Apex Manufacturing Ltd', 'HDFC Life Insurance', 'Group Term Life', 'GTL/2026/0334', '2026-09-01', '2027-08-31', 500000000, 415000, '', 'Group Term Life');
  }
  if (!(await db.prepare("SELECT 1 FROM rfqs WHERE client_name = 'Apex Manufacturing Ltd'").get())) {
    const gtlDetails = { business: 'Auto components manufacturing', sa_basis: '36× Annual Salary', location: 'Pune', fcl: 5000000,
      life_cats: [{ cat: 'Directors / Management', count: 10, sa: 20000000 }, { cat: 'Officers / Executives', count: 50, sa: 4000000 }, { cat: 'Field / Skilled Staff', count: 100, sa: 1000000 }], total_members: 160, total_sa: 500000000,
      prev_insurer: 'SBI Life Insurance', prev_policy_no: 'GTL/2025/0210', prev_expiry: '2026-08-31', claims_3yr: '2 claims (₹90L)' };
    const gtlInsurers = [
      { insurer: 'HDFC Life Insurance', email: 'group@hdfclife.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 0.75, wc_basic: 375000, wc_medical: 0, addon_premium: 40000, premium: 415000, addons_incl: ['Accidental Death Benefit (ADB)', 'Permanent Total Disability', 'Critical Illness'], selected: true, quote_doc: '', quote_name: '', remark: 'Best rate; full riders' },
      { insurer: 'SBI Life Insurance', email: 'group@sbilife.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 0.8, wc_basic: 400000, wc_medical: 0, addon_premium: 30000, premium: 430000, addons_incl: ['Accidental Death Benefit (ADB)', 'Permanent Total Disability'], selected: false, quote_doc: '', quote_name: '', remark: 'Incumbent' },
      { insurer: 'ICICI Prudential Life Insurance', email: 'group@iciciprulife.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 0.82, wc_basic: 410000, wc_medical: 0, addon_premium: 25000, premium: 435000, addons_incl: ['Accidental Death Benefit (ADB)', 'Critical Illness'], selected: false, quote_doc: '', quote_name: '', remark: '' },
    ];
    await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'RFQ-GTL-2701', 'Apex Manufacturing Ltd', '9825011002', 'hr@apexmfg.example.com', 'LI', 'Group Term Life', 'Group Term Life', 'Renewal', 'Flat Sum Assured', 500000000, 0,
      JSON.stringify(['Accidental Death Benefit (ADB)', 'Permanent Total Disability', 'Critical Illness']),
      JSON.stringify(gtlDetails), 'Group term life — 160 members, total SA ₹50 Cr, ADB + PTD + CI riders', 415000,
      JSON.stringify(gtlInsurers), 'Quotes Received', 'High', '2026-08-12', 'Admin User', 'Manufacturer GTL renewal — compare rate per mille & riders');
  }
  if (!(await db.prepare("SELECT 1 FROM claims WHERE claim_no = 'GTL-CLM-1001'").get())) {
    const gtlClaimDetails = { member_name: 'Suresh Iyer', age: 52, death_date: '2026-07-02', cause: 'Illness', nominee: 'Lata Iyer (spouse)', sa: 4000000, adb: 'No', benefit: 4000000 };
    const gtlPolicyId = (await db.prepare("SELECT id FROM policies WHERE policy_number='GTL/2026/0334'").get())?.id || null;
    await db.prepare(`INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, claim_type, policy_id, details, documents) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'Apex Manufacturing Ltd', 'HDFC Life Insurance', 'GTL-CLM-1001', '2026-07-02', 4000000, 'Settled', 'GTL',
      gtlPolicyId, JSON.stringify(gtlClaimDetails), '[]');
  }

  // --- Retail Health (family floater) demo data ---
  if (!(await db.prepare("SELECT 1 FROM policies WHERE policy_number = 'RH/2026/0912'").get())) {
    await db.prepare(`INSERT INTO policies (policy_status, insurance_line, insured_name, company_name, product_name, policy_number, period_from, period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('Policy', 'GI', 'Rahul Mehta', 'Star Health & Allied Insurance', 'Family Health Optima Floater', 'RH/2026/0912', '2026-07-01', '2027-06-30', 1000000, 28500, '', 'Health');
  }
  if (!(await db.prepare("SELECT 1 FROM rfqs WHERE client_name = 'Rahul Mehta' AND category = 'Retail Health'").get())) {
    const rhDetails = { rh_type: 'Family Floater', si_per_family: '1000000',
      health_members: [{ relation: 'Self', age: 42 }, { relation: 'Spouse', age: 39 }, { relation: 'Son', age: 12 }, { relation: 'Daughter', age: 8 }], total_members: 4, eldest_age: 42,
      ped: 'No', room_rent: 'Single Private AC', copay: 0, ported: 'No', prev_insurer: 'HDFC ERGO General Insurance', prev_policy_no: 'RH/2025/0455', prev_expiry: '2026-06-30', claims_3yr: 'Nil' };
    const rhAddons = ['Restoration of SI', 'No Room Rent Capping', 'NCB / Cumulative Bonus Protect', 'Annual Health Check-up'];
    const rhInsurers = [
      { insurer: 'Star Health & Allied Insurance', email: 'retail@starhealth.example.com', status: 'Quoted', txn: 'Quote', wc_rate: '', wc_basic: 27000, wc_medical: 0, addon_premium: 1500, premium: 28500, addons_incl: rhAddons, selected: true, quote_doc: '', quote_name: '', remark: 'Best price; full add-ons' },
      { insurer: 'HDFC ERGO General Insurance', email: 'retail@hdfcergo.example.com', status: 'Quoted', txn: 'Quote', wc_rate: '', wc_basic: 29000, wc_medical: 0, addon_premium: 1500, premium: 30500, addons_incl: ['Restoration of SI', 'No Room Rent Capping', 'Annual Health Check-up'], selected: false, quote_doc: '', quote_name: '', remark: '' },
      { insurer: 'Care Health Insurance', email: 'retail@careinsurance.example.com', status: 'Quoted', txn: 'Quote', wc_rate: '', wc_basic: 30000, wc_medical: 0, addon_premium: 1000, premium: 31000, addons_incl: ['Restoration of SI', 'No Room Rent Capping'], selected: false, quote_doc: '', quote_name: '', remark: 'Wide network' },
    ];
    await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'RFQ-RH-2801', 'Rahul Mehta', '9825022113', 'rahul.mehta@example.com', 'GI', 'Retail Health', 'Health Floater (Family Floater)', 'New', 'Family Floater', 1000000, 0,
      JSON.stringify(rhAddons), JSON.stringify(rhDetails), 'Family floater ₹10L for 4 members (eldest 42), restoration + no room cap', 29000,
      JSON.stringify(rhInsurers), 'Quotes Received', 'Medium', '2026-08-04', 'Admin User', 'Family floater — compare restoration & room rent');
  }
  if (!(await db.prepare("SELECT 1 FROM claims WHERE claim_no = 'RH-CLM-1001'").get())) {
    const rhClaimDetails = { patient_name: 'Aarav Mehta', relationship: 'Son', hospital: 'Rainbow Children Hospital', ailment: 'Dengue fever', admit_date: '2026-07-04', discharge_date: '2026-07-08', room_category: 'Single Private AC', claim_mode: 'Cashless', tpa: 'Medi Assist', claimed_amount: 45000, approved_amount: 45000 };
    const rhPolicyId = (await db.prepare("SELECT id FROM policies WHERE policy_number='RH/2026/0912'").get())?.id || null;
    await db.prepare(`INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, claim_type, policy_id, details, documents) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'Rahul Mehta', 'Star Health & Allied Insurance', 'RH-CLM-1001', '2026-07-04', 45000, 'Settled', 'Health',
      rhPolicyId, JSON.stringify(rhClaimDetails), '[]');
  }

  // --- Householder's Package demo data ---
  if (!(await db.prepare("SELECT 1 FROM policies WHERE policy_number = 'HOME/2026/0345'").get())) {
    await db.prepare(`INSERT INTO policies (policy_status, insurance_line, insured_name, company_name, product_name, policy_number, period_from, period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('Policy', 'GI', 'Kunal Shah', 'ICICI Lombard General Insurance', "Householder's Package", 'HOME/2026/0345', '2026-06-01', '2027-05-31', 8500000, 9200, '', 'Householder');
  }
  if (!(await db.prepare("SELECT 1 FROM rfqs WHERE client_name = 'Kunal Shah'").get())) {
    const homeDetails = { property_type: 'Owned', building_type: 'Bungalow', year_built: '2015', location: 'Satellite, Ahmedabad', pin: '380015',
      home_schedule: [{ section: 'Building / Structure', si: 5000000 }, { section: 'Home Contents', si: 2000000 }, { section: 'Jewellery & Valuables', si: 1000000 }, { section: 'Electronic Appliances', si: 500000 }], total_si: 8500000,
      prev_insurer: 'Bajaj General Insurance Limited', prev_policy_no: 'HOME/2025/0221', prev_expiry: '2026-05-31', claims_3yr: 'Nil' };
    const homeAddons = ['Burglary & Theft', 'All-Risk (Jewellery)', 'Public Liability', 'STFI'];
    const homeInsurers = [
      { insurer: 'ICICI Lombard General Insurance', email: 'retail@icicilombard.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 1.0, wc_basic: 8500, wc_medical: 0, addon_premium: 700, premium: 9200, addons_incl: homeAddons, selected: true, quote_doc: '', quote_name: '', remark: 'Best rate; all sections' },
      { insurer: 'HDFC ERGO General Insurance', email: 'retail@hdfcergo.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 1.05, wc_basic: 8925, wc_medical: 0, addon_premium: 600, premium: 9525, addons_incl: ['Burglary & Theft', 'All-Risk (Jewellery)', 'STFI'], selected: false, quote_doc: '', quote_name: '', remark: '' },
      { insurer: 'Bajaj General Insurance Limited', email: 'claims@bajajgi.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 1.1, wc_basic: 9350, wc_medical: 0, addon_premium: 500, premium: 9850, addons_incl: ['Burglary & Theft', 'Public Liability', 'STFI'], selected: false, quote_doc: '', quote_name: '', remark: '' },
    ];
    await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'RFQ-HOME-2901', 'Kunal Shah', '9825033114', 'kunal.shah@example.com', 'GI', 'Householder', "Householder's Package", 'New', "Householder's Package", 8500000, 0,
      JSON.stringify(homeAddons), JSON.stringify(homeDetails), "Householder's package — SI ₹85L (building + contents + jewellery), burglary + all-risk", 9500,
      JSON.stringify(homeInsurers), 'Quotes Received', 'Low', '2026-08-05', 'Admin User', 'Bungalow — compare jewellery all-risk');
  }
  if (!(await db.prepare("SELECT 1 FROM claims WHERE claim_no = 'HOME-CLM-1001'").get())) {
    const homeClaimDetails = { peril: 'Burglary / Theft', cause: 'House break-in during vacation', affected_asset: 'Jewellery & Valuables', estimated_loss: 300000, salvage: 0, assessed_amount: 250000, surveyor: 'M/s City Surveyors' };
    const homePolicyId = (await db.prepare("SELECT id FROM policies WHERE policy_number='HOME/2026/0345'").get())?.id || null;
    await db.prepare(`INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, claim_type, policy_id, details, documents) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'Kunal Shah', 'ICICI Lombard General Insurance', 'HOME-CLM-1001', '2026-07-09', 250000, 'Approved', 'Home',
      homePolicyId, JSON.stringify(homeClaimDetails), '[]');
  }

  // --- Engineering (Contractors All Risks) demo data ---
  if (!(await db.prepare("SELECT 1 FROM policies WHERE policy_number = 'CAR/2026/0078'").get())) {
    await db.prepare(`INSERT INTO policies (policy_status, insurance_line, insured_name, company_name, product_name, policy_number, period_from, period_to, sum_assured, final_premium, reg_no, insurance_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('Policy', 'GI', 'BuildWell Infra Pvt Ltd', 'The New India Assurance', 'Contractors All Risks (CAR)', 'CAR/2026/0078', '2026-09-01', '2027-12-31', 250000000, 202500, '', 'Engineering');
  }
  if (!(await db.prepare("SELECT 1 FROM rfqs WHERE client_name = 'BuildWell Infra Pvt Ltd'").get())) {
    const engDetails = { eng_type: 'Contractors All Risks (CAR)', business: 'Construction of RCC flyover', project_value: 250000000, location: 'Ring Road, Surat', commencement: '2026-09-01', period_months: 18, testing_period: 0,
      prev_insurer: 'ICICI Lombard General Insurance', prev_policy_no: 'CAR/2025/0044', prev_expiry: '2026-08-31', claims_3yr: '1 claim (₹12L)' };
    const engAddons = ['Third Party Liability', 'Debris Removal', 'Surrounding Property', 'Earthquake'];
    const engInsurers = [
      { insurer: 'The New India Assurance', email: 'engineering@newindia.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 0.75, wc_basic: 187500, wc_medical: 0, addon_premium: 15000, premium: 202500, addons_incl: engAddons, selected: true, quote_doc: '', quote_name: '', remark: 'Best rate; TPL + EQ' },
      { insurer: 'ICICI Lombard General Insurance', email: 'engineering@icicilombard.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 0.78, wc_basic: 195000, wc_medical: 0, addon_premium: 14000, premium: 209000, addons_incl: ['Third Party Liability', 'Debris Removal', 'Surrounding Property'], selected: false, quote_doc: '', quote_name: '', remark: '' },
      { insurer: 'The Oriental Insurance', email: 'engineering@orientalinsurance.example.com', status: 'Quoted', txn: 'Quote', wc_rate: 0.80, wc_basic: 200000, wc_medical: 0, addon_premium: 12000, premium: 212000, addons_incl: ['Third Party Liability', 'Debris Removal', 'Earthquake'], selected: false, quote_doc: '', quote_name: '', remark: 'PSU' },
    ];
    await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'RFQ-ENG-3001', 'BuildWell Infra Pvt Ltd', '9825044115', 'projects@buildwell.example.com', 'GI', 'Engineering', 'Contractors All Risks (CAR)', 'New', 'Project Policy', 250000000, 0,
      JSON.stringify(engAddons), JSON.stringify(engDetails), 'CAR for RCC flyover — project value ₹25 Cr, 18 months, TPL + EQ + surrounding property', 205000,
      JSON.stringify(engInsurers), 'Quotes Received', 'High', '2026-08-08', 'Admin User', 'Infra project — compare rate per mille & TPL limit');
  }
  if (!(await db.prepare("SELECT 1 FROM claims WHERE claim_no = 'ENG-CLM-1001'").get())) {
    const engClaimDetails = { peril: 'Flood / Inundation (STFI)', cause: 'Monsoon flooding of construction site', affected_asset: 'Under-construction span & shuttering', estimated_loss: 5000000, salvage: 200000, assessed_amount: 4200000, surveyor: 'M/s Engineering Surveyors' };
    const engPolicyId = (await db.prepare("SELECT id FROM policies WHERE policy_number='CAR/2026/0078'").get())?.id || null;
    await db.prepare(`INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, claim_type, policy_id, details, documents) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'BuildWell Infra Pvt Ltd', 'The New India Assurance', 'ENG-CLM-1001', '2026-07-07', 4200000, 'Under Assessment', 'Engineering',
      engPolicyId, JSON.stringify(engClaimDetails), '[]');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM company_emails').get()).c) === 0) {
    const insCe = db.prepare('INSERT INTO company_emails (company_name, claim_email, support_phone) VALUES (?,?,?)');
    await insCe.run('Bajaj General Insurance Limited', 'claims@bajajgi.example.com', '1800-000-111');
    await insCe.run('Go Digit General Insurance Limited', 'claims@godigit.example.com', '1800-000-222');
    await insCe.run('Tata AIG General Insurance Co. Ltd.', 'claims@tataaig.example.com', '1800-000-333');
    await insCe.run('HDFC ERGO General Insurance', 'claims@hdfcergo.example.com', '1800-000-444');
  }

  if (Number((await db.prepare('SELECT COUNT(*) c FROM templates').get()).c) === 0) {
    const insTpl = db.prepare('INSERT INTO templates (tkey, subject, body, updated_at) VALUES (?,?,?,?)');
    const now = '2026-07-13';
    await insTpl.run('gi-renewal-mail-template', 'Your {product} policy is due for renewal',
      'Dear {client},\n\nYour policy {policy_no} with {company} expires on {expiry}. Please renew to stay protected.\n\nRegards,\nWCA Insurance', now);
    await insTpl.run('li-renewal-mail-template', 'Premium due reminder for your life policy',
      'Dear {client},\n\nThe premium for your life policy {policy_no} is due on {expiry}. Kindly pay to keep your policy in force.\n\nRegards,\nWCA Insurance', now);
    await insTpl.run('policy-copy-email-template', 'Your policy document - {policy_no}',
      'Dear {client},\n\nPlease find attached the policy document for {policy_no} ({product}).\n\nRegards,\nWCA Insurance', now);
    await insTpl.run('welcome-mail-template', 'Welcome to WCA Insurance',
      'Dear {client},\n\nWelcome aboard! Your account has been created. Download our app to track your policies anytime.\n\nRegards,\nWCA Insurance', now);
  }
}

export default db;
