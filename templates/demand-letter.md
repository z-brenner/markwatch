---
id: demand-letter
title: Letter to the registrant
description: Letter to the domain registrant. Every assertion is placeholder language for counsel; remedies are chosen by the user.
version: 1
channel: letter
classes: cybersquatting, parked_ads, for_sale
to: "{{registrant.email | optional}}"
subject: "Regarding the domain name {{domain}}"
---
DRAFT. Attorney review required before sending.

[INTERNAL NOTE — DELETE BEFORE SENDING: (1) Review this domain's route warnings and the internal evidence outline with counsel before sending this letter. (2) If RDAP shows the registrant as redacted ({{registrant.redacted | optional}}), obtain the registrant's name and address through the disclosure request first. (3) Every bracketed placeholder must be replaced with counsel-approved text or removed.]

{{today}}

To: {{registrant.name | hint: "Registrant name (redacted in RDAP? obtain it through a disclosure request and enter it here)"}}
{{registrant.org | optional}}
{{input.addresseeAddress | hint: "Registrant postal or email address"}}

Re: the domain name {{domain}}

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: opening paragraph identifying the sender and the mark owner, {{mark.owner}}, and the purpose of the letter.]

THE MARK OWNER'S RIGHTS (as recorded by the mark owner)
Mark(s): {{mark.names}}
{{mark.rights | lines | hint: "Enter the mark registrations (number and jurisdiction) in the case settings"}}

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: description of the mark owner's rights and use of the mark(s), for counsel to write.]

THE DOMAIN NAME
Domain: {{domain}}
Registrar: {{registrar.name | optional}}
Registration created: {{registration.created | optional}}
Nameservers: {{dns.ns | optional}}
Parking provider: {{parking.name | optional}}

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: counsel's characterization of the registration and use of the domain name, if any. Do not state conclusions that counsel has not approved.]

REQUESTED ACTIONS
{{input.requestedActions | lines | hint: "The actions you request, one per line, chosen with counsel (e.g. transfer of the domain name, deactivation)"}}

Please respond by {{input.responseDeadline | hint: "Response deadline (date) chosen with counsel"}}.

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: paragraph describing next steps, if counsel wants any mentioned, e.g. UDRP / ACPA 15 U.S.C. § 1125(d) — counsel to decide whether to mention any escalation path at all.]

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: closing and reservation of rights.]

{{sender.name}}
{{sender.title}}
{{sender.organization}}
{{sender.address}}
{{sender.email}}
{{sender.phone | optional}}

Sources:
{{sources}}
