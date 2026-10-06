---
id: udrp-annex
title: UDRP evidence annex outline
description: Internal outline of the evidence for a possible UDRP complaint, organized by the three UDRP paragraph 4(a) elements.
version: 1
channel: internal
classes: cybersquatting, parked_ads, for_sale, phishing_malware
subject: "UDRP evidence annex outline: {{domain}}"
---
DRAFT. Attorney review required before sending.

INTERNAL WORKING DOCUMENT — evidence outline for counsel. Nothing here is a finding; every prompt is a question for counsel to answer from the evidence.

Disputed domain name: {{domain}}
Unicode form: {{domainUnicode | optional}}
Registrar: {{registrar.name | optional}}
Registration created: {{registration.created | optional}}
Sender's classification: {{classification.label}}
Prepared on: {{today}}

URS NOTE
URS eligibility from the TLD (verify before relying on it): {{urs.eligible}}
The URS remedy is suspension only, never transfer, and the standard is clear and convincing evidence. Counsel to decide between UDRP and URS.

EVIDENCE INDEX (file name — SHA-256)
{{evidence.list | lines | hint: "Attach evidence files to the case so they are indexed here by hash, or dismiss with a reason"}}

------------------------------------------------------------------------
ELEMENT 1 — UDRP ¶4(a)(i)
Policy text: “(i) your domain name is identical or confusingly similar to a trademark or service mark in which the complainant has rights; and”
------------------------------------------------------------------------
Mark rights (as recorded by the mark owner):
{{mark.rights | lines | hint: "Enter the mark registrations (number and jurisdiction) in the case settings"}}
Mark(s): {{mark.names}}
How the domain was generated from the mark (Markwatch techniques): {{techniques | optional}}
Prompts for counsel:
- Which registrations and evidence of use support standing? Which exhibits show them?
- How does the domain compare with the mark, side by side? (typo, added word, TLD)
[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: counsel's analysis of the first element.]

------------------------------------------------------------------------
ELEMENT 2 — UDRP ¶4(a)(ii)
Policy text: “(ii) you have no rights or legitimate interests in respect of the domain name; and”
------------------------------------------------------------------------
Registrant name (if published): {{registrant.name | optional}}
Registrant organization (if published): {{registrant.org | optional}}
Registrant data redacted: {{registrant.redacted | optional}}
Authorization status: {{input.authorizationStatus | hint: "Has the mark owner ever licensed or authorized the registrant? State the facts as known"}}
Prompts for counsel:
- Is there evidence of a bona fide offering of goods or services under the name (¶4(c)(i))?
- Is there evidence the registrant is commonly known by the name (¶4(c)(ii))?
- Is there evidence of noncommercial or fair use, such as criticism or a fan site (¶4(c)(iii))?
[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: counsel's analysis of the second element.]

------------------------------------------------------------------------
ELEMENT 3 — UDRP ¶4(a)(iii) (see the non-exclusive examples in ¶4(b))
Policy text: “(iii) your domain name has been registered and is being used in bad faith.”
------------------------------------------------------------------------
Observed facts (from lookups; see Sources):
Registration created: {{registration.created | optional}}
Nameservers: {{dns.ns | optional}}
Parking provider: {{parking.name | optional}}
Mail exchangers: {{dns.mx | optional}}
Latest certificate in CT logs: {{ct.latestNotBefore | optional}}
Observations recorded by the user:
{{input.useObservations | lines | hint: "What the domain is used for (parked page with links, offer to sell, copy of your site, mail only), with dates observed, one per line"}}
Prompts for counsel:
- Is there an offer to sell the domain, and for how much (¶4(b)(i))?
- Is there a pattern of similar registrations by the same registrant (¶4(b)(ii))?
- Are there pay-per-click links or content referring to the mark owner or its competitors (¶4(b)(iv))?
- When did the current holder acquire the domain? The RDAP creation date is not necessarily the acquisition date; a transfer to a new holder is generally treated as a new registration (WIPO Overview 3.0 §3.9). Compare the acquisition date with the first-use and registration dates in the mark rights above. If the current holder held the domain before the mark rights arose, discuss the Reverse Domain Name Hijacking risk before any contact or complaint.
- If the domain is offered for sale: contacting the registrant can raise the asking price, and a letter that reads as an inquiry can look like a negotiation. Capture the listing and any price before any contact, and decide with counsel whether to send a letter at all.
[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: counsel's analysis of the third element.]

Sources:
{{sources}}
