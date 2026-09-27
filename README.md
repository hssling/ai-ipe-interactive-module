# Using AI as a catalyst for interprofessional learning

This standalone repository hosts the interactive module for the FAIMER Group 2 November 2026 mentored learning web session. It is intentionally separate from the `learning-compass` source repository. It remains usable offline in one browser, and the deployed version adds a secure Supabase completion register.

## Use

Open the published site in a modern browser. Learners can either keep work in their browser or sign in with an email magic link to save a private learner record. When all evidence is complete, they submit it to an assigned facilitator. A facilitator or module administrator reviews the record and issues a unique registered certificate; only then does the PDF download unlock.

## Deployment configuration

The public site never contains a service-role key. GitHub Pages generates `config.js` from two repository secrets:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

The `supabase/` directory contains the migrations and the public certificate-verification Edge Function. The module runs on its own Supabase project (`mdsxlbeqghivgltxpify`), fully separate from Learning Compass, with its own accounts: every sign-in gets a row in `public.module_profiles` (role `learner`). The project owner makes someone an administrator in SQL (`update public.module_profiles set role = 'admin' where user_id = …`); administrators then add facilitators to `public.ai_ipe_module_facilitators`.

## Learning data and end-of-course reporting

Authenticated learners automatically save a progress record, completion percentage, activity milestones, last-activity time and submission time. The assessment panel records explicit pre- and post-assessment attempts (scores only, not individual answers). Low-volume engagement events capture sessions, saves, activity completion, resource/video use, slide progress, submission and certificate download.

Administrators and assigned facilitators see a **Course analytics and report** panel after sign-in. It provides registered/engaged/submitted/approved counts, completion and on-time rates, pre/post knowledge and confidence change, feedback averages, activity timeliness and active-day/session measures. The panel exports both a learner-level CSV and a JSON course report. Activity deadlines are defined in `public.ai_ipe_module_schedule` using India Standard Time for the November 2026 run.

Apply migrations in filename order, including `20260927110000_learning_analytics_reporting.sql`, before enabling the report panel in production. The analytics views use `security_invoker` and the same learner/reviewer RLS boundaries as the underlying tables.

This repository is the deployment/source-of-truth boundary for the module. Do not copy its HTML, assets, or module migration into `learning-compass`; coordinate any shared identity/schema changes as a separately reviewed Supabase migration.

## Privacy

Do not enter patient details, personal contact details, or restricted workplace information. A learner's full name is stored only in the protected completion register when they choose to request an official certificate. Certificate verification deliberately returns only the certificate holder, module, issue date, and verifier.

Browser-only learner entries are stored in local browser storage and are not encrypted at rest. The secure register is optional and requires email sign-in; external videos and reference links require network access.

## Boundary

This educational module does not provide clinical advice. Institutional AI, privacy, academic integrity, and data-retention policies remain authoritative.
