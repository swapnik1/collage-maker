# Collage Maker — PRD v2

**Version** 2.0 · **Date** 2026-09-17 · **Status** Draft · **Builds on** [PRD.md](PRD.md)

## Summary

Collage Maker is free and runs entirely in the browser. v2 adds two on-device
improvements that cost nothing to run, then — only if the tool finds an audience —
a paid AI tier priced to cover its own API bill.

The tool exists to build reputation ahead of later AI products. Reach is the
measure of success; revenue only needs to break even.

## Context

Collage-making is commoditised: Canva and PicCollage are free and dominant. AI
photo curation is commoditised too — Google Photos, Chatbooks and LifeCache all
auto-select and auto-layout today. The money in this space is physical print, a
$3.6B market growing to $5.6B by 2034.

None of that is a market we can win, and winning it is not the goal.

## Decisions

| Decision | Reason |
|---|---|
| Free tier stays complete and local | It is why anyone would recommend the tool |
| AI priced at cost | Covering the bill is the goal, not margin |
| Ship publicly before building any backend | Auth and billing for an audience that does not exist is the expensive mistake |
| Credits, not subscription | People make collages a few times a year |
| No print fulfilment | Real money, but an operations business that teaches us nothing about AI |
| No engine licensing | B2B sales motion, incompatible with free and public |

## Phase 0 — On-device, no backend

| ID | Requirement |
|---|---|
| F1 | Detect faces and salient regions on-device; bias each cell's crop so subjects are not cut off. Sets a starting point only — pan and zoom stay free. |
| F2 | Score photos for sharpness and exposure. Group bursts and near-duplicates, propose the best of each, and always show what was grouped. |
| F3 | Both run in under 5 seconds for 40 photos, and fall back silently to current behaviour on failure. |
| F4 | Deploy to a permanent public URL, with the single-file build offered as a download. |
| F5 | Count sessions, photos per session, and completed exports. No accounts, no per-user tracking, no third-party analytics. |
| F6 | Launch where local-first tools get attention: Hacker News, relevant subreddits, Product Hunt. |

**Gate.** Phase 1 starts only after ~1,000 completed exports from distinct
sessions within 8 weeks of launch. Below that the problem is distribution, and a
paid tier will not fix it.

## Phase 1 — AI features

### Intent

| ID | Requirement |
|---|---|
| A1 | Accept free text describing what the collage is for, with chips for common cases. Resolve it to canvas aspect, print size, DPI, bleed, safe margin and target photo count. |
| A2 | Send text only. No photos are uploaded for this step. |
| A3 | Show the resolved setup and let the user correct any field before anything else runs. |

### Selection

| ID | Requirement |
|---|---|
| A4 | Choose the target number of photos from the Phase 0 shortlist, preferring different moments and subjects over repetition. |
| A5 | Give one short reason per photo, for those kept and those left out. |
| A6 | Nominate a hero photo and an order, and pass both to the existing layout engine. The model never returns geometry. |
| A7 | Upload proxies at ~768px. Never originals, never EXIF location. |
| A8 | Return within 20 seconds for 40 photos, with per-photo progress visible. |
| A9 | Fall back to the Phase 0 shortlist whenever the service is unavailable, over quota, or refuses. |
| A10 | Every decision is visible, reversible in one click, and covered by undo. Nothing is applied automatically. |
| A11 | Reasons describe photographs, never people — no identity, age, appearance or relationship claims. |

### Privacy

| ID | Requirement |
|---|---|
| P1 | Opt in per session, stating what is being sent, at the moment it is sent. |
| P2 | Delete proxies immediately after the response. No retention, no training. |
| P3 | Reword the app's privacy claim to separate the local path from the AI path. The current unqualified promise cannot survive. |
| P4 | The free path keeps working with no account and no network. |

### Billing

| ID | Requirement |
|---|---|
| B1 | Email sign-in, a credit balance, and a metered endpoint. Nothing else. |
| B2 | No collage-specific concepts in the auth, billing or metering layer — it must lift into the next product unchanged. |
| B3 | A failed, refused or degraded session consumes no credit. |
| B4 | Trial credits, so a first session costs nothing. |
| B5 | Per-account rate limit and abuse ceiling. |

## Pricing

A session costs about **$0.15** — roughly 20 shortlisted photos at 768px plus 2K
output tokens, at Claude Opus 5 rates. The Phase 0 shortlist is what keeps it
there.

Stripe's 2.9% + $0.30 per transaction sets the floor, not the API:

| Pack | Fees | API cost | Net |
|---|---|---|---|
| 5 sessions @ $1 | $0.33 | $0.75 | −$0.08 |
| 20 sessions @ $5 | $0.45 | $3.00 | +$1.55 |
| 50 sessions @ $10 | $0.59 | $7.50 | +$1.91 |

Minimum pack $5. Surplus goes to hosting, and the pricing page says so.

## Success measures

| Measure | Target |
|---|---|
| Completed exports from distinct sessions | The headline number, tracked monthly |
| Free-tier time-to-export | No regression, not one added step |
| AI revenue against AI and hosting costs | Break even over a rolling quarter |
| Billing layer reused in the next product | Dropped in unchanged. A rewrite means Phase 1 failed at its main job |
| Rate of users overriding AI picks | Falling. A rise means the picks are getting worse |

## Out of scope

| | Why |
|---|---|
| Print fulfilment | Operations business; nothing transfers to AI products |
| Engine licensing | Different customer, different sales motion |
| Subscriptions | Wrong shape for occasional use |
| Watermarks, export limits, gating any v1 feature | Damages the only thing that makes this worth doing |
| Generating or altering image content | Not what this tool is |

## Open questions

1. Is ~1,000 exports in 8 weeks the right gate? It is a judgement call, and worth fixing before launch rather than negotiating with afterwards.
2. Does the Phase 1 client code live in this repo, given it is MIT and the service is not?
3. What is the next AI product? B2 should be designed against a real second use case, not an imagined one.
