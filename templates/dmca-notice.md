---
id: dmca-notice
title: DMCA notice (copyright only)
description: Notification of claimed infringement under 17 U.S.C. § 512(c)(3)(A), for copied text, images or code. Not for trademark complaints.
version: 1
channel: email
classes: copied_content
to: "{{input.designatedAgentEmail | hint: \"Email of the service provider's designated DMCA agent (see the U.S. Copyright Office DMCA Designated Agent Directory)\"}}"
subject: "DMCA notification of claimed infringement: {{domain}}"
---
DRAFT. Attorney review required before sending.

[INTERNAL NOTE — DELETE BEFORE SENDING: The DMCA covers copyright, not trademark. Use this notice only for copied text, images or code in which the owner holds the copyright; a trademark complaint does not belong in a DMCA notice. 17 U.S.C. § 512(f) imposes liability for knowing material misrepresentation in a notice. Before sending, consider whether the use may be fair use (Lenz v. Universal Music Corp., 815 F.3d 1145 (9th Cir. 2016)). Fair use considered by: {{input.fairUseConsideredBy | hint: "Name of the person who considered fair use, and the date"}}]

To the designated agent of {{input.serviceProvider | hint: "Name of the service provider (host or CDN) whose agent receives this notice"}}:

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: introductory paragraph stating that this is a notification under 17 U.S.C. § 512(c)(3) sent on behalf of the copyright owner, {{input.copyrightOwner | hint: "Name of the copyright owner"}}, concerning material at {{domain}}.]

The numbered sections below follow 17 U.S.C. § 512(c)(3)(A). Each heading quotes the statute.

(i) A physical or electronic signature of a person authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.
Signature: {{input.signature | hint: "Physical or electronic signature of the authorized person, e.g. /s/ Full Name"}}
Signer: {{sender.name}}, {{sender.title}}

(ii) Identification of the copyrighted work claimed to have been infringed, or, if multiple copyrighted works at a single online site are covered by a single notification, a representative list of such works at that site.
{{input.copyrightedWork | hint: "Identify the copyrighted work(s): title, description, where the original is published (URL), and any copyright registration number exactly as issued"}}

(iii) Identification of the material that is claimed to be infringing or to be the subject of infringing activity and that is to be removed or access to which is to be disabled, and information reasonably sufficient to permit the service provider to locate the material.
Material: {{input.infringingMaterial | hint: "Describe the material to be removed or disabled"}}
Location (URLs):
{{input.infringingLocation | lines | hint: "Exact URL(s) of the material, one per line"}}

(iv) Information reasonably sufficient to permit the service provider to contact the complaining party, such as an address, telephone number, and, if available, an electronic mail address at which the complaining party may be contacted.
Name: {{sender.name}}
Organization: {{sender.organization}}
Address:
  {{sender.address}}
Telephone: {{sender.phone}}
Email: {{sender.email}}

(v) A statement that the complaining party has a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.
[SIGNER MUST REVIEW — confirm the statement below is true before signing:]
I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.
Reviewed by: {{input.goodFaithStatementReviewedBy | hint: "Signer's name confirming they reviewed and agree with statement (v)"}}

(vi) A statement that the information in the notification is accurate, and under penalty of perjury, that the complaining party is authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.
[SIGNER MUST REVIEW — confirm the statement below is true before signing:]
The information in this notification is accurate, and under penalty of perjury, I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.
Reviewed by: {{input.accuracyStatementReviewedBy | hint: "Signer's name confirming they reviewed and agree with statement (vi)"}}

[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: closing paragraph.]

{{sender.name}}
{{sender.title}}
{{sender.organization}}

Sources:
{{sources}}
