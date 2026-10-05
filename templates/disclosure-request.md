---
id: disclosure-request
title: Registration data disclosure request
description: Copy sheet for an ICANN RDRS request, plus a direct request to the registrar under Registration Data Policy §10.
version: 1
channel: portal
classes: cybersquatting, parked_ads, for_sale, phishing_malware
subject: "Request for disclosure of registration data: {{domain}}"
---
DRAFT. Attorney review required before sending.

Domain: {{domain}}
Sponsoring registrar: {{registrar.name | hint: "Sponsoring registrar (RDAP)"}} (IANA ID {{registrar.ianaId | optional}})
Registrant data redacted in RDAP: {{registrant.redacted | optional}}

[INTERNAL NOTE — DELETE BEFORE SENDING: RDRS covers only gTLD registrars that participate voluntarily; it does not cover ccTLDs. If the registrar does not participate, use section B instead.]

========================================================================
A. ICANN RDRS COPY SHEET
Paste each line into the matching field at https://rdrs.icann.org (logged-in portal; there is no API). Verify field names against the live form.
========================================================================

Domain name: {{domain}}
Request category: IP holder
Data elements requested: {{input.dataElements | hint: "Data elements requested, e.g. registrant name, organization, email, telephone, postal address"}}
Priority: {{input.rdrsPriority | hint: "Priority as offered by the form; reserve an urgent priority for imminent threats"}}
Description (maximum 2,000 characters; check the length before pasting):
{{input.rdrsDescription | hint: "Factual description of the request and why the data is needed, at most 2,000 characters"}}
Legal basis: {{input.legalBasis | hint: "Legal basis selected with counsel (choose the matching option on the form)"}}
Attachments: PDF only, at most 5 files, each at most 5 MB. Evidence in this case (SHA-256):
{{evidence.list | lines | optional}}

========================================================================
B. DIRECT REQUEST TO THE REGISTRAR UNDER THE ICANN REGISTRATION DATA POLICY §10
Send through the registrar's published disclosure-request process: {{input.registrarDisclosureContact | hint: "The registrar's published disclosure-request address or web form (registrars must publish one under §10)"}}
========================================================================

To {{registrar.name}}:

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: opening paragraph requesting disclosure of the non-public registration data for {{domain}} under section 10 of the ICANN Registration Data Policy.]

1. Requestor identity and contact details
Name: {{sender.name}}
Title: {{sender.title | optional}}
Organization: {{sender.organization}}
Email: {{sender.email}}
Telephone: {{sender.phone}}
Address:
  {{sender.address}}
Type of entity: {{input.requestorEntityType | hint: "Requestor's entity type, e.g. corporation (mark owner) or law firm acting for the mark owner"}}
Acting for: {{mark.owner}}

2. Data elements requested
{{input.dataElements}}

3. Legal rights and specific rationale
Mark rights relied on (as recorded by the mark owner):
{{mark.rights | lines | hint: "Enter the mark registrations (number and jurisdiction) in the case settings"}}
Rationale for this specific request:
{{input.disclosureRationale | hint: "Why this specific data is needed for this domain (facts only), approved by counsel"}}

4. Good-faith affirmation
{{input.goodFaithAffirmation | hint: "Counsel-approved affirmation that the request is made in good faith"}}

5. Agreement to process the data lawfully
{{input.lawfulProcessingAgreement | hint: "Counsel-approved agreement to process any disclosed data lawfully and only for the stated purpose"}}

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: closing paragraph.]

{{sender.name}}
{{sender.title | optional}}
{{sender.organization}}

[INTERNAL NOTE — DELETE BEFORE SENDING: Follow-up dates if this request is sent today ({{today}}). Under Registration Data Policy §10.5 the registrar acknowledges within 2 business days and responds within 30 calendar days; a denial must give a rationale (§10.6). Acknowledgment expected by: {{followUp.ack}} (weekends skipped; public holidays not accounted for). Response expected by: {{followUp.response}}. Recompute if the request is sent on a later date.]

Sources:
{{sources}}
