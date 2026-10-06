---
id: host-abuse
title: Hosting provider abuse report
description: Abuse report to the network or hosting provider of the IP addresses serving the domain.
version: 1
channel: email
classes: phishing_malware, copied_content
to: "{{host.abuseEmail | hint: \"Hosting abuse email (IP RDAP abuse role or Abusix)\"}}"
subject: "Abuse report: content served at {{domain}}"
---
DRAFT. Attorney review required before sending.

To the abuse team of {{host.networkOrg | hint: "Network holder (IP RDAP)"}},

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: opening paragraph identifying the sender, the brand owner ({{mark.owner}}), and the purpose of this report. State facts only.]

HOSTING DETAILS
Domain: {{domain}}
IP addresses: {{host.ips | hint: "IP addresses the domain resolves to (DNS A/AAAA)"}}
Network holder: {{host.networkOrg}}
Network name: {{host.networkName | optional}}

CDN NOTE
CDN / reverse proxy in front of the site, if any: {{cdn.name | optional}}
CDN abuse process: {{cdn.abuseUrl | optional}}
[INTERNAL NOTE — DELETE BEFORE SENDING: if a CDN is listed above, the IP addresses may belong to the CDN rather than the origin host. Report through the CDN's abuse process as well; CDNs typically forward reports to the origin host without revealing it.]

WHAT WAS OBSERVED
{{input.activityDescription | hint: "Factual description: the URLs involved, what the content is, date and time observed (UTC). Facts only, no conclusions."}}

EVIDENCE (SHA-256 of each file)
{{evidence.list | lines | hint: "Attach evidence (screenshots, captured pages) to the case, or dismiss with a reason"}}

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: paragraph referring to the provider's acceptable use policy and abuse process (counsel to confirm which policy applies).]

REQUESTED ACTION
{{input.requestedAction | hint: "The action you ask the provider to take. Counsel to approve the wording."}}

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: closing paragraph.]

{{sender.name}}
{{sender.title}}
{{sender.organization}}
{{sender.email}}
{{sender.phone | optional}}

Sources:
{{sources}}
