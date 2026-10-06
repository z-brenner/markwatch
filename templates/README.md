# Markwatch templates

Every `*.md` file in this folder except this README is a built-in draft template, bundled into the app at build time. Your legal team can also import its own counsel-approved templates at runtime: open **Templates** in the sidebar and use **Import template files (.md)**. An imported template whose `id` matches a built-in **replaces** that built-in for the case, which is the intended way to swap the placeholder language below for approved text. Imported templates are saved inside the case file.

Drafts are **plain text**. Markwatch never renders template content as HTML, so Markdown syntax (`**bold**`, `#` headings) shows up literally. Write plain text.

## File layout

```
---
id: registrar-abuse
title: Registrar abuse report
description: One line shown in the template picker
version: 1
channel: email
classes: phishing_malware
to: "{{registrar.abuseEmail}}"
subject: "Abuse report: {{domain}}"
---
DRAFT. Attorney review required before sending.

Body text with {{merge.fields}}…
```

### Front-matter

A strict, minimal subset of YAML: one `key: value` per line between two `---` lines.

- Values may be bare or double-quoted. Inside double quotes, only `\"` and `\\` escapes are allowed. Quote any value that contains `{{`, `:` or `#`.
- `#` starts a comment at the start of a line, or after whitespace in a bare value.
- No nesting, indentation, lists, single quotes, multi-line values, anchors or flow collections. They are errors with a line number, never guesses.
- Duplicate keys are errors.

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | Lowercase letters, digits and `-`, max 64. The same id as a built-in overrides it. |
| `title` | yes | Name shown in the UI. |
| `channel` | yes | `email`, `portal`, `internal` or `letter`. |
| `classes` | no (warning if empty) | Comma-separated classifications the template is meant for: `phishing_malware`, `copied_content`, `cybersquatting`, `parked_ads`, `for_sale`, `fair_use`, `authorized_noncompliant`, `unrelated`. Unknown values are errors. Routing still decides which templates a class may use. |
| `description` | no | One line. |
| `version` | no | Free text, e.g. `1` or `2026-10-counsel`. |
| `to` | no (warning for email) | Recipients. May contain merge fields; the result is split on `,` and `;`. |
| `subject` | no (warning for email) | Subject line. May contain merge fields. |

Unknown keys are ignored with a warning.

## The banner

The first line of the body must be exactly:

```
DRAFT. Attorney review required before sending.
```

If an imported template omits it, Markwatch adds it to every rendered draft and shows a validation warning.

## Merge fields

```
{{path}}
{{path | optional}}
{{path | hint: "Text shown to the user while the field is unfilled"}}
{{path | lines}}
{{path | lines | optional | hint: "…"}}
```

- `path` is letters, digits and `_`, separated by `.`. Whitespace inside the braces is allowed.
- A tag opens and closes on the same line. A stray `}}`, an unclosed `{{`, an empty tag, a bad path, an unknown or duplicated modifier, or a malformed hint is an error reported with its line number. `{{{{` has no special meaning.
- **Every field is required** unless marked `| optional`.
- `| hint: "…"` sets the text shown in the unfilled marker and in the UI. Inside the quotes only `\"` and `\\` escapes are allowed.
- `| lines` renders a list one item per line, each prefixed `- `. Without it, lists are joined with `, `. A user-typed value under `| lines` is split on line breaks.

### How a field is filled

1. A value the user typed for that path in the draft editor (this wins, even over looked-up data).
2. The value from the case and lookups (the context paths below).
3. Otherwise the field is **unfilled**: it renders as `⟦UNFILLED: <hint or path>⟧`, and export, copy, mailto and .eml stay disabled until the user fills it or dismisses it with a reason. A dismissed field renders as empty text and is listed in the audit log.

A value is empty when it is missing, an empty string or an empty list. An optional empty field renders as empty text.

If a tag stands alone on its line (only whitespace around it) and renders as empty text, the whole line is removed. Multi-line values in a standalone tag keep the line's indentation.

Paths that are not context paths are user-input fields. Name them `input.*` (for example `input.copyrightedWork`); any other unknown path gets a warning, because it is usually a typo.

### `{{sources}}`

Renders one line per looked-up value that the draft actually uses, with where and when it came from, e.g.:

```
- registrar.abuseEmail: RDAP rdap.verisign.com, 2026-10-05T21:04:11Z
- host.abuseEmail: abuse@host.example — RDAP rdap.arin.net, 2026-10-05T21:05:02Z
- host.abuseEmail: abuse@other.example — Abusix Contact DB (cloudflare-dns.com), 2026-10-05T21:05:03Z
```

When the items of a list came from different sources, each item gets its own line.

Values typed by the user are not listed. Data pasted manually after a blocked lookup is labelled as such. Whenever an Abusix contact is used, its line credits the Abusix Contact DB, as Abusix asks. Put a `Sources:` heading above the tag yourself. `{{sources}}` takes no modifiers and cannot be used in `to` or `subject`.

## Context paths

| Path | Meaning |
|---|---|
| `today` | Today's date, YYYY-MM-DD (UTC). |
| `domain` | The reported domain, ASCII/punycode form. |
| `domainUnicode` | The reported domain, Unicode display form. |
| `registrable` | Registrable domain (eTLD+1). |
| `classification.id` | Classification id chosen by the user. |
| `classification.label` | Human-readable classification chosen by the user. |
| `techniques` | Permutation techniques that produced the domain (list). |
| `mark.names` | All marks in the case (list). |
| `mark.primary` | The first mark. |
| `mark.owner` | Mark owner as entered. |
| `mark.primaryDomain` | The mark owner's primary domain. |
| `mark.rights` | `Reg. No. <number> (<jurisdiction>)[, classes <classes>][, first use <firstUse>]`, exactly as entered (list). Never looked up or invented. |
| `sender.name`, `sender.title`, `sender.organization`, `sender.email`, `sender.phone`, `sender.address` | Sender details from the case settings. |
| `registrar.name`, `registrar.ianaId` | Sponsoring registrar and its IANA ID (RDAP). |
| `registrar.abuseEmail`, `registrar.abuseTel` | Registrar abuse contact (RDAP abuse role; lists). |
| `registry.server` | RDAP server that answered. |
| `registration.created`, `registration.expires` | Registration and expiry dates (RDAP). |
| `registration.status` | EPP status values (RDAP; list). |
| `registrant.name`, `registrant.org`, `registrant.email`, `registrant.country` | Registrant data when not redacted (RDAP). |
| `registrant.redacted` | `yes` when RDAP marks registrant data as redacted, otherwise `no`. |
| `host.ips` | IP addresses the domain resolves to (list). |
| `host.networkOrg`, `host.networkName` | Holder and name of those networks (IP RDAP; lists). |
| `host.abuseEmail` | Hosting abuse emails: IP RDAP abuse role plus the Abusix Contact DB (list). |
| `cdn.name`, `cdn.abuseUrl` | CDN or reverse proxy in front of the site, and its abuse URL, if inferred. |
| `dns.ns`, `dns.mx`, `dns.a`, `dns.aaaa` | DNS records (lists). |
| `parking.name`, `parking.complaintUrl` | Parking provider and its trademark complaint URL, if inferred. |
| `ct.latestNotBefore` | Most recent certificate seen in CT logs. |
| `ct.count` | Number of CT certificates (only when the CT lookup succeeded; a blocked lookup never shows 0). |
| `evidence.list` | Evidence linked to the domain: `<name> — SHA-256 <sha256>` (list). |
| `score.total` | Markwatch heuristic score (ranking only, not a finding). |
| `inventory.party`, `inventory.pattern` | Authorized party and matching inventory pattern, if the domain is in the inventory. |
| `urs.eligible` | URS applicability from the TLD, the same rule the route's URS escalation uses: `yes — <note>` (.org, .info, .biz and apparent post-2012 gTLDs, with a note to verify), `no — <note>` (.com, .net and restricted TLDs such as .gov), `verify — <note>` (ccTLDs, internationalized `xn--` TLDs, and legacy gTLDs whose URS status is unverified). |
| `followUp.ack` | Registration Data Policy §10 acknowledgment date: today + 2 business days (weekends skipped, holidays not). Counsel to confirm paragraph numbers in the current policy text. |
| `followUp.response` | Registration Data Policy §10 response date: `followUp.ack` + 30 calendar days. |

## Legal content rules (for built-ins, and recommended for imports)

- Open with the banner line.
- Wrap all legal prose in `[PLACEHOLDER LEGAL LANGUAGE — replace with counsel-approved text: …]`. Counsel-approved imports replace these with approved text.
- Never write facts into a template: registration numbers, dates, ownership and goods/services come only from merge fields (lookups or user input).
- Never assert infringement, bad faith or liability as fact. Built-ins are tested: phrases such as "constitutes infringement", "infringes", "in bad faith", "is liable", "willful", "violates", "unlawful" or "illegal" may appear only inside placeholder brackets. The one exception is a verbatim quotation of policy or statute text on its own line, written as `Policy text: “…”` (curly quotes), and only for quotations the content test lists as verified (currently UDRP ¶4(a)(i)–(iii)).
- Outbound drafts state facts only. They do not state the sender's classification of the domain.
- Notes for the user that must not be sent go inside `[INTERNAL NOTE — DELETE BEFORE SENDING: …]`:
  - Use exactly that prefix, and close the note with `]` on the same or a later line.
  - Do not put `[` or `]` inside a note, including inside merge-field hints, because exports remove notes with the pattern `/\[INTERNAL NOTE — DELETE BEFORE SENDING[^\]]*\]/g`, which stops at the first `]`.
  - In outbound templates (any channel except `internal`), notes hold drafting guidance only. Case strategy that would harm the mark owner if the note were sent by mistake (for example Reverse Domain Name Hijacking risk or price strategy) belongs in the internal UDRP evidence annex, not in an outbound draft.
- The compliance note is internal and neutral and uses no legal-threat vocabulary at all.
- Imported templates are limited to 200 KB of UTF-8 text.

## Rules enforced on import

Markwatch rejects an imported template, with the reason, when:

- it has front-matter or merge-tag errors, contains NUL bytes, or is over 200 KB;
- its `id` is `compliance-note`, or its `classes` include `authorized_noncompliant`, and it breaks any of these:
  - `channel: internal`;
  - no `to:` key at all (not even an empty one);
  - `classes: authorized_noncompliant` and nothing else;
  - none of these words anywhere in its title, description, subject or body, in any letter case: "infringe", "demand", "cease", "liable", "violation", "legal action", "lawsuit", "damages".

So an authorized partner can only ever receive a neutral internal note: no threat template can be attached to that classification, even by import.
