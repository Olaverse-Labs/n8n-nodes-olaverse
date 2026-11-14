# n8n-nodes-olaverse

An [n8n](https://n8n.io) community node for [Olaverse Lab](https://www.olaverselab.com): document extraction with
calibrated confidence, decisions, language identification in 608 languages, diacritic restoration and question
generation in 324 languages: multilingual, including the languages other tools skip.

Turn receipts, invoices, mobile-money messages and forms into structured fields in your workflows (from an email
attachment straight into a spreadsheet), triage support messages, and route text by language.

## Install

In n8n: **Settings → Community Nodes → Install**, and enter `n8n-nodes-olaverse`.
See n8n's [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

Create an API key in the [Olaverse console](https://console.olaverselab.com) (new accounts get $1 of free credit),
then add an **Olaverse API** credential in n8n with that key. Testing the credential makes one tiny language check
(about $0.0003).

## Operations

**Document**

- **Extract:** turn a document into JSON shaped like your template, with a calibrated confidence (0–1) for every
  field. The document can be **text**, or a **JPEG/PNG image** from a previous node's binary data (an email
  attachment, an uploaded photo or a scan). Text over 60,000 characters runs as a long-document job: split,
  extracted in parallel and merged. For a PDF, extract its text first (for example with n8n's *Extract from File*
  node) and pass it as text.

  Template leaves name a type: `verbatim-string`, `string`, `number`, `integer`, `date`, `date-time`, `boolean`,
  `["a", "b"]` (pick one), `["string"]` (a list) or `[{...}]` (a list of objects, e.g. line items).

**Text**

- **Decide:** answer typed questions about a message or record (`noul` yes/no, `choice`, `score`) with a calibrated
  probability for every answer. 19 languages, including English, Pidgin, Hausa, Yorùbá, Igbo, Swahili and Arabic.
- **Detect Language:** the language of a text among 608, accurate on very short text.
- **Restore Diacritics:** tone marks, accents and Arabic vowel marks back in Yorùbá, Igbo, Hausa, Arabic and 7 more.
- **Generate Questions:** the questions a passage answers, in 324 languages, in its own language or another (Question
  Language); a set number from 1 to 5, or let the model decide how many.

## Example workflows

**Receipts from email to a spreadsheet**

1. **Gmail Trigger** (or **Email Trigger (IMAP)**): new emails with attachments, with *Download Attachments* on.
2. **Olaverse** → Document → Extract: Input *Image (Binary)*, field `attachment_0`, template
   `{"merchant": "verbatim-string", "date": "date", "total": "number", "currency": "verbatim-string"}`.
3. **IF**: `{{ $json.confidence.total }}` is at least `0.95`.
4. **Google Sheets** → Append row with `{{ $json.data.merchant }}`, `{{ $json.data.date }}`, `{{ $json.data.total }}`
   on the true branch; a **Slack** message asking someone to check it on the false branch.

**Support messages triaged by language and intent**

1. **Webhook** (or your helpdesk's trigger): a new message.
2. **Olaverse** → Text → Detect Language, on the message text.
3. **Olaverse** → Text → Decide, with State `{{ $('Webhook').item.json.body.message }}` and questions
   `{"refund": {"type": "noul", "instructions": "The customer is asking for money back."},
     "team": {"type": "choice", "instructions": "Which team should handle this?",
              "criteria": {"billing": "payments and refunds", "delivery": "orders in transit"}}}`.
4. **Switch** on `{{ $json.answers.team.choice }}` to route the ticket; flag it as urgent when
   `{{ $json.answers.refund.noul }}` is above `0.9`.

## Using the confidence

Every extracted field comes with a confidence. A common pattern: an **IF** node after Olaverse that sends fields
under 0.95 to a person for review and lets the rest through. Check a threshold on a sample of your own documents
before automating on it.

## Pricing

Calls are billed to your Olaverse key at the [usual prices](https://docs.olaverselab.com/reference/models/). A
one-page receipt costs about $0.0015.

## Resources

- [Olaverse docs](https://docs.olaverselab.com)
- [API reference: document extraction](https://docs.olaverselab.com/api/extraction/)
- [n8n community nodes](https://docs.n8n.io/integrations/#community-nodes)

## Licence

MIT
