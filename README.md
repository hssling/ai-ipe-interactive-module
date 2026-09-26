# Using AI as a catalyst for interprofessional learning

This repository hosts the interactive module for the FAIMER Group 2 November 2026 mentored learning web session. It remains usable offline in one browser, and the deployed version adds a secure Supabase completion register.

## Use

Open the published site in a modern browser. Learners can either keep work in their browser or sign in with an email magic link to save a private learner record. When all evidence is complete, they submit it to an assigned facilitator. A facilitator or Learning Compass administrator reviews the record and issues a unique registered certificate; only then does the PDF download unlock.

## Deployment configuration

The public site never contains a service-role key. GitHub Pages generates `config.js` from two repository secrets:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

The `supabase/` directory contains the migration and public certificate-verification Edge Function. The schema relies on the existing Learning Compass `profiles`, `student_profiles`, and administrator roles. Existing administrators can review completion records immediately; additional facilitators are added to `public.ai_ipe_module_facilitators` by an administrator.

## Privacy

Do not enter patient details, personal contact details, or restricted workplace information. A learner's full name is stored only in the protected completion register when they choose to request an official certificate. Certificate verification deliberately returns only the certificate holder, module, issue date, and verifier.

## Boundary

This educational module does not provide clinical advice. Institutional AI, privacy, academic integrity, and data-retention policies remain authoritative.
