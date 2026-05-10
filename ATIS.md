# ATIS — Account Triangulated Intent Score

A single number per **account** that summarizes how strongly a buying committee is signaling intent, computed by triangulating across three GTM data sources.

## Inputs

| Source | What it measures | Field used |
|---|---|---|
| Interaction Studio | Real-time web behavior — page depth, segment membership, recency | `evergageengagement__c`, `evergagelastactivity__c` |
| Marketo | Accumulated marketing engagement — emails opened, forms filled, content downloaded | `sierra_marketo_score__c` |
| Salesforce | Persona spread, lifecycle stage, status, rep activity | `title`, `sierra_lifecycle_stage_name__c`, `lastactivitydate`, `sierra_suspect_status__c` |

## Computation

Aggregate by normalized company name across an active-in-window contact set, then:

```
base = (sum of IS engagement × 2.0) + (sum of positive MK scores × 0.05)

ATIS = base
       × committee_multiplier  (1.5 if ≥3 contacts, 1.2 if 2, 1.0 if 1)
       × executive_bonus       (1.2 if any C-suite/VP/Director, else 1.0)
       × procurement_bonus     (1.15 if any procurement contact, else 1.0)
```

The weights reflect three judgments:

1. **Real-time web activity is the cleanest intent signal.** IS engagement gets ×2.0; MK score is scaled down ×0.05 because it accumulates indefinitely and isn't a "right now" indicator.
2. **Buying is a committee sport.** Three people researching is qualitatively different from one — the multiplier rewards breadth.
3. **Role coverage matters.** A buyer + an engineer + a procurement contact is the textbook B2B buying committee. Each persona type gets a small boost when present.

## Per-lead intent score

For ranking individuals within an account:

```
lead_intent = ((IS_engagement × 2.0) + (max(MK,0) × 0.05))
              × role_weight       (C-suite 1.5, VP 1.4, Director 1.3,
                                   Procurement 1.4, Manager 1.1,
                                   Engineer 1.0, Other 0.9, Unknown 0.8)
              × recency_boost     (1.0 if today, decays 0.07/day, floor 0.5)
```

## Companion metrics

ATIS by itself answers "who's buying." Two integrity metrics tell you whether the GTM machine is *seeing* it:

- **Pipeline Truth Index (PTI)** — % of top-decile-by-ATIS accounts that have at least one MQL contact in Salesforce. Below ~60% means high-intent accounts are stranded outside the rep work-queue.
- **Cross-System Drift Rate (CSDR)** — % of accounts where IS web-activity timestamp and SF activity timestamp differ by >30 days. High drift means reps are deciding lead quality on stale data.

## Velocity layer

Each account also gets:

- **Prior-week ATIS** — same computation on the 7 days before the window
- **WoW delta %** — acceleration or deceleration
- **`heatedFromCold` flag** — zero prior week, non-zero this week (new awareness)

This is what surfaces the highest-leverage accounts: not the absolute scores, the *change*. An account moving from 0 → 200 ATIS in a week is more actionable than one sitting steady at 400.

## Active-in-window contact set

A contact is "active in window" if either:

- `evergagelastactivity__c` (IS web activity timestamp) falls in the window, OR
- `lastactivitydate` (SF rep activity date) falls in the window.

Two-source filtering catches accounts visible in IS but silent in SF (and vice versa). Junk records — generic-domain emails with no real company name, "(No Company Name)", "NA", own-company internal — are excluded before scoring.

## What it captures that single-system scoring misses

A Marketo score by itself can't see the buying committee. A Salesforce stage by itself can't see real-time intent. An IS engagement number by itself can't see persona coverage or pipeline fit. ATIS is a small composite that fuses all three at the right granularity (account, weekly), with integrity checks attached so you know whether to trust it.

The seven cross-system patterns it reliably surfaces:

| Pattern | Signature | Interpretation |
|---|---|---|
| Researching alone | One IS contact, zero MK, zero SF activity | Early — nurture only |
| Marketing-warm | MK score climbing, IS engagement steady, no SF activity | MQL ready — should be in rep queue |
| Active eval | Multi-contact IS spike + MK pricing-page hits + SF demo logged | Mid-funnel — accelerate |
| Buying committee | 3+ contacts across all 3 systems within 30d + open SF opp | Late stage — exec attention |
| Stranded high-intent | High MK + high IS + DORMANT/Unqualified in SF | Pipeline leak — fix routing |
| Re-engaging closed-lost | SF closed-lost + new IS spike | Re-engagement window opened |
| Going dark | Active SF opp + IS activity dropped to zero across committee | Deal slipping — diagnose |

## Implementation

The whole computation is ~250 lines of JavaScript over a single GraphJin query — no separate ETL, no pre-aggregation, no warehouse views. The workflow lives at `workflows/atis_weekly.js` and accepts:

| Variable | Type | Default | Purpose |
|---|---|---|---|
| `weekStart` | string (ISO date) | `2026-05-01` | Inclusive window start |
| `weekEnd` | string (ISO date) | `2026-05-08` | Exclusive window end |
| `topN` | number | 25 | Top accounts to return |
| `topLeads` | number | 50 | Top individual leads to return |

Output: headline summary metrics, top-N accounts ranked by ATIS, top-N leads ranked by per-lead intent, every detected buying committee with full contact roster.

## Operational cadence

Designed for weekly cadence with three artifacts in front of leadership:

1. Top 20 accounts by ATIS — with WoW delta and contact count
2. Buying-committee triggers fired this week — named accounts that crossed the 3-contact threshold
3. PTI + CSDR trendline — single chart, two metrics; either degrading is a GTM-ops work item

A single re-run produces all three. A renderer (`reports/render_atis_pdf.py`) turns the JSON into a PDF deliverable suitable for executive review.
