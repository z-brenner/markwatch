---
id: compliance-note
title: Internal compliance note
description: Neutral internal note to the relationship owner about an authorized partner's domain that does not follow brand guidelines.
version: 1
channel: internal
classes: authorized_noncompliant
subject: "Brand guideline check: {{domain}}"
---
DRAFT. Attorney review required before sending.

To: {{input.relationshipOwner | hint: "Name of the internal relationship owner for this partner"}}
From: {{sender.name}}, {{sender.organization}}
Date: {{today}}

Subject: Brand guideline check for {{domain}}

Hello {{input.relationshipOwner}},

During a routine review of domains that resemble {{mark.primary}}, we noticed {{domain}}. Our records list it as belonging to an authorized partner:

Partner: {{inventory.party | hint: "Authorized partner name (from the inventory)"}}
Inventory entry: {{inventory.pattern | optional}}

What we noticed:
{{input.observation | hint: "Neutral, factual description of what differs from the brand guidelines, with dates observed"}}

Relevant guideline or agreement section: {{input.guidelineReference | hint: "Which brand guideline or agreement section this relates to"}}

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: short, neutral summary of the relevant terms of the partner agreement, if counsel wants one included.]

Suggested next step: {{input.suggestedNextStep | hint: "e.g. a friendly reminder to the partner contact, or a call to align on the guidelines"}}

Supporting files (SHA-256):
{{evidence.list | lines | optional}}

Could you let us know how you would like to proceed? We are happy to help with the conversation.

Thanks,
{{sender.name}}
{{sender.title}}
{{sender.email}}
