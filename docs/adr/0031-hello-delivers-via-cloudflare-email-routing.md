# 31. `hello@` delivers via Cloudflare Email Routing

Date: 2026-08-07
Status: Accepted

Resolves ticket
[#128](https://github.com/lukefredrickson/personal-site/issues/128), under the
real-content PRD
[#125](https://github.com/lukefredrickson/personal-site/issues/125).

## Context

The home page's links row publishes `mailto:hello@lukefredrickson.dev`. Nothing
receives it. The `.dev` zone carries no MX record, so a sending server falls
back to the implicit-MX rule and tries the apex address — which is
Cloudflare's proxied HTTP edge, and does not answer on port 25. Mail to the
address the site invites people to use fails at connect.

What the address has to do is narrow: reach Luke, from a domain that reads as
his, without publishing his personal Gmail on a public page and without standing
up a mailbox to check. Sending *as* `hello@` is not part of the job — the link
is an inbound contact point, and every reply is a human writing back from
whatever client they already live in.

## Decision

**Cloudflare Email Routing on the `lukefredrickson.dev` zone**, with one custom
address rule: `hello@` → `lukeefredrickson@gmail.com`. Cloudflare accepts mail
at the edge and forwards it; there is no mailbox and no storage. It is free, and
the DNS it needs lands in the zone Cloudflare already serves authoritatively, so
mail delivery and the site's own records stay in one place.

**No catch-all.** Only `hello@` routes. Everything else at the domain bounces,
which is the fail-closed direction: a catch-all quietly absorbs every address a
scraper invents and forwards the resulting spam into the same Gmail inbox that
holds real mail. One published address is the entire surface area, so the rule
matches it exactly.

**No mail changes in the repo.** The `mailto:` href in `index.astro` is already
correct and stays untouched. This is account configuration end to end — the only
thing the repo can hold is the record of it.

## Alternatives considered

- **Hosted mailbox (Google Workspace, Fastmail)** — a real inbox at the domain,
  send-as included. Rejected: a monthly bill and a second mail identity to
  check, for a link that gets mail rarely. Email Routing is the subset of that
  product actually needed, at no cost.
- **Publish the Gmail address directly** — free and works today. Rejected: the
  domain address is the point. It keeps the personal address off a page that is
  scraped continuously, and it is a layer of indirection — where `hello@` lands
  can change later without editing the site.
- **Contact form → Worker → email API (Resend, MailChannels)** — a form instead
  of a `mailto:`. Rejected on cost of ownership: it needs an endpoint, which
  means server rendering or a function on a deliberately static site (ADR 0001),
  plus an API key, plus spam handling — and it puts a form between a visitor and
  a message their own mail client composes better.
- **Email Workers** — bind incoming mail to Worker code and forward from there.
  Same product, more power: this address needs a routing rule, not a program.
- **Gmail "send mail as" via SMTP relay** — solves the sending half. Orthogonal:
  it does nothing about receiving, which is the half that is broken.

## Consequences

- **Receive-only.** A reply typed in Gmail goes out from the Gmail address, so
  the domain hides it from the *page*, not from a correspondent who writes and
  gets an answer. Wiring Gmail's "send mail as" back through `hello@` is a
  separate, later choice — noted, not taken.
- **The zone's mail delivery is spoken for.** Email Routing owns the apex MX
  records, so the domain cannot simultaneously receive at another provider.
  Nothing else wants it.
- **Forwarding interacts with sender authentication.** Cloudflare rewrites the
  envelope sender (SRS) so the forwarded hop passes SPF at Gmail. Mail from
  senders with strict DMARC alignment can still fare worse forwarded than
  direct; this is inherent to forwarding, not to this choice.
- **The SPF include is receive-side.** It authorizes Cloudflare's forwarding
  path, not the site or anything else, to send as the domain. Because nothing
  legitimately sends as `@lukefredrickson.dev`, a strict `_dmarc` policy is
  available later at no cost to real mail — deliberately not added here, since a
  DMARC record with no mail flow to observe is a rule nobody is reading reports
  for.
- **Account state, not version control.** Like the Redirect Rules in ADR 0004,
  this configuration lives in a dashboard and can be silently changed there.
  The notes below are its only diffable record.

## Implementation notes

Account state, not in git. This section is the source of truth for setting this
up, and for recreating it if the zone is ever rebuilt.

### Enabling

Cloudflare dashboard → **Compute → Email Service → Email Routing**, onboard
`lukefredrickson.dev`. The `cloudflare-api` MCP token is scoped to DNS +
Workers, so it cannot reach the Email Routing surface — this is dashboard work,
as the Redirect Rules were.

### DNS

Cloudflare adds these itself at onboarding; do not hand-author them.

| Type | Name | Value |
| --- | --- | --- |
| MX | `@` | `route1.mx.cloudflare.net` |
| MX | `@` | `route2.mx.cloudflare.net` |
| MX | `@` | `route3.mx.cloudflare.net` |
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT | `cf2024-1._domainkey` | Cloudflare-managed DKIM key |

Priorities are assigned by Cloudflare. These are unproxied records and coexist
with the apex Worker custom domain (`A`/`AAAA`) and the `_atproto` TXT — MX and
TXT do not collide with either. Propagation is typically minutes.

### Destination and rule

1. **Destination Addresses** → add `lukeefredrickson@gmail.com`. Cloudflare
   emails it a verification link; a rule pointing at an unverified destination
   stays disabled, so this step comes first.
2. **Routing Rules** → custom address `hello`, action *Send to an email*,
   destination the verified Gmail address.
3. Leave **Catch-all** disabled.

### Verifying

Send a message to `hello@lukefredrickson.dev` from an address outside the
account and confirm it lands in Gmail — including a check of Spam, since the
first forwarded message from a new domain is the one most likely to be filed
there.
