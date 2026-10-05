---
id: registrar-abuse
title: Registrar abuse report
description: DNS-abuse report to the sponsoring registrar's abuse contact (phishing or malware).
version: 1
channel: email
classes: phishing_malware
to: "{{registrar.abuseEmail | hint: \"Registrar abuse email (RDAP abuse role)\"}}"
subject: "Abuse report: {{domain}}"
---
DRAFT. Attorney review required before sending.

To the abuse team of {{registrar.name}},

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: opening paragraph identifying the sender, the brand owner ({{mark.owner}}), and the purpose of this report. State facts only; do not characterize the registrant's conduct.]

REPORTED DOMAIN
Domain: {{domain}}
Unicode form: {{domainUnicode | optional}}
Sponsoring registrar: {{registrar.name}} (IANA ID {{registrar.ianaId | hint: "Registrar IANA ID (RDAP publicIds)"}})
Registration created: {{registration.created | optional}}
Registration status: {{registration.status | optional}}
Sender's classification: {{classification.label}}

OBSERVED DNS AND HOSTING
Nameservers: {{dns.ns | hint: "Nameservers (DNS NS lookup)"}}
IPv4 addresses: {{dns.a | optional}}
IPv6 addresses: {{dns.aaaa | optional}}
Mail exchangers: {{dns.mx | optional}}
Network holder: {{host.networkOrg | optional}}
CDN / reverse proxy: {{cdn.name | optional}}

WHAT WAS OBSERVED
{{input.activityDescription | hint: "Factual description of what was observed: URLs, what the page does, date and time observed (UTC). Facts only, no conclusions."}}

EVIDENCE (SHA-256 of each file)
{{evidence.list | lines | hint: "Attach evidence (screenshots, captured pages) to the case, or dismiss with a reason"}}

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: paragraph referring to the registrar's obligations under its ICANN Registrar Accreditation Agreement to take action on reports of DNS abuse [counsel to confirm the applicable provision, e.g. the abuse-report section of the RAA as amended by the DNS abuse amendments, and quote its current text].]

REQUESTED ACTION
{{input.requestedAction | hint: "The action you ask the registrar to take (e.g. investigate and act under its abuse policy). Counsel to approve the wording."}}

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: closing paragraph and any reservation-of-rights language counsel requires.]

{{sender.name}}
{{sender.title}}
{{sender.organization}}
{{sender.email}}
{{sender.phone | optional}}

Sources:
{{sources}}
