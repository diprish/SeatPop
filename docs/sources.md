# Source discovery (Phase 1)

Researched 2026-10-27. Every robots.txt and terms page below was fetched; claims
marked "unknown" are ones I could not verify. Nothing has been ingested.

Verdicts: **YES** (terms fetched and permit attributed non-commercial use),
**NO-barred** (terms forbid our use), **DECIDE** (unknown or ambiguous terms —
needs your call before we touch the source).

## Approval (2026-10-27)

Approved: 1, 2, 4, 5, 8, 13, 14, 15, 16, 17, 19. All others: not approved.

Conditions:

- #1 (OPL) and #2 (City): one access check each with our honest User-Agent on
  the main listing pages. On 403, bot-wall, or empty content: drop the source,
  record it here, no retry, no bypass. (Status: pending probe run.)
- #19 (Diefenbunker): time zone verified against the event's own page before
  any override — https://diefenbunker.ca/events/halloween-at-the-bunker-2026/
  states "October 31 @ 10:00 am. – 3:00 pm. UTC-4", matching the feed's 10:00
  wall time, so the America/Halifax tag is a misconfiguration and the
  America/Toronto override is applied. Source kept.
- All approved sources: attribution plus official link on every event (by
  construction: source_url per event, source name via source_id); every
  crawl-delay honored by the fetcher (3 s floor).
- Fallback volume target if OPL and City are both blocked: at least 300
  upcoming events across at least 5 categories (down from 1000 / 6).

## Access checks (2026-10-27, `npm run probe`, honest UA)

- #2 (City of Ottawa): **DROPPED**. Listing page returns HTTP 200 with a
  212-byte empty shell (no title, no text, no links) — a bot-wall. Per the
  approval condition: dropped, recorded here, no retry, no bypass. The
  fallback target (300 events / 5 categories) is now active.
- #1 (OPL): **PASSED, upgraded to tier 1**. Listing returns HTTP 200, 123 KB,
  "Find a program or event", with 17 per-event `.ics` links (booking
  subdomain) on page 1. Configured as `ics` + `icsIndex` + subdomains. Caveat:
  booking robots demand crawl-delay 10, and listing pagination means page 1
  only for now.
- ICS feeds re-confirmed live: OAG (16 KB), Farmers' Market (2.5 KB),
  Diefenbunker (10.6 KB, Toronto override applied).
- JSON-LD: **0 Event blocks** on all 7 HTML listings (Nature, War, History,
  GCTC, Chamberfest, OLT + OPL listing). They stay tier-2 stub (0 drafts
  until a later extraction phase) — no upgrades.
- GCTC URL fixed: probed `/season` is a stale 2017-18 page; seed uses
  `/events` (current: Rogers v. Rogers in window, Liars at a Funeral Dec 1).
- OLT listing is thin (1,118 text chars on 191 KB) — possibly JS-rendered;
  noted risk for later extraction.
- Note: the probe ran with a placeholder contact (INGEST_CONTACT_URL unset).
  Set a real contact URL before the real run.

## Dry-run rounds (2026-10-27)

- Round 1: 138 upcoming (OPL page-1 123, OAG 13, OFM 2, Diefenbunker 0 —
  the 0 was a 304: the probe had warmed the shared ETag cache). HTML stubs 0
  as designed. Runner fixed so dry-runs always fetch fresh; `--full` added
  for cache-ignoring real runs.
- OPL pagination: listing shows "1 - 20 of 565" across 29 pages, but both
  `?page=0,N` and `?page=N` return page 1 to stateless fetches (faceted
  browser needs session state; verified 2026-10-27). Single index page only:
  ~20 programs → ~130 upcoming events. OPL ICS files carry no CATEGORIES,
  so all OPL events stay `library`.
- Category ceiling without extraction: 4 (library, arts, markets, museums).
  A 5th category needs tier-2 extraction on a stub source or another feed.

## OPL filter experiment (2026-10-28, `probe:opl`, honest UA)

- Robots re-checked first: booking `crawl-delay 10`, listing and filtered
  query URLs both allow; nothing disallowed. Fetcher honors the 10 s delay.
- Baseline: "Displaying 1 - 20 of 563", 20 per-event links. Filter form is
  GET with 6 selects (category, series, branch, language, age group, date).
- Tried (one URL each, bounded): branch "Other Locations" → 1 event titled
  "Register" (junk slice, skipped); language English → 1-20 of 385,
  different titles (**kept**); age group Adult → 1-20 of 328, different
  titles (**kept**); category 2SLGBTQIA+ → 0 events (empty now, skipped).
- Configured as two extra tier-1 ICS-index sources (same handling as OPL).
  Overlap with the baseline slice is absorbed by dedupe. Cost: each OPL
  slice fetches ~20 ICS files at crawl-delay 10 (~4 min per slice).

## OPL age-group slices (2026-10-29, `probe:opl --age-groups`, honest UA)

- Robots re-checked first: booking `crawl-delay 10`, listing and filtered
  query URLs both allow. Baseline "1 - 20 of 560", GET form, age select
  `field_age_group_target_id` with 9 real options.
- All 9 differ from the baseline (of-counts): Adult 327 (= existing
  Adults slice, not duplicated), 50-plus 165, Baby 36, Child 121,
  Family 116, Newcomers 40, Preschool 32, Teen 75, Toddler 25. **Kept:
  the 8 new ones** as tier-1 ICS-index slice sources, each with its
  facet label as structured evidence. Only "Adults 50-plus" states
  digits, so only it can set ages (unanimous-digit rule; event text
  wins).
- Probe bug fixed same day: age-mode matched bare `/age/i` and caught
  the *language* select first; now `/age_group/i` + regression test.

## Extraction fixes (2026-10-28)

- OLT seed URL `/calendar/` → `/2026-season/`: the calendar page is an empty
  JS shell (menus only, 1,118 text chars); the season page lists 9 dated
  shows (2 in-window). Same approved source, real listing — same fix class
  as GCTC `/season` → `/events`. Existing DB row needs its URL updated
  (seed matches by URL, so re-seeding would duplicate the row).
- Chamberfest listing page yields 0 correctly: dated entries are past posts,
  upcoming concerts are dateless links, and the evidence rule refuses to
  invent dates. Detail-page extraction (`linkPattern /event/20\d\d/`,
  ~9 pages, same $2 budget and evidence rules) explicitly approved to
  unlock the music category.

## Source discovery round 2 (2026-10-29, research only, nothing ingested)

Goal: non-library variety (classes, camps, sports, outdoors, workshops).
Same method as round 1: robots.txt fetched per host, terms read for
automated-access/redistribution/third-party-service bans, unfetchable
items marked unknown, ToS-barred excluded, training ambiguity flagged.

- Open Ottawa (open.ottawa.ca) DOES list Recreation Guide CSV datasets
  via its public Hub API — but only 2020/2022 seasonal vintages
  (unlisted, stale); a "Recreation Guide 2026" query matched 0
  datasets. Licence is named "Open Government Licence – Ottawa v2.0"
  but its text sits on bot-walled ottawa.ca and is unreadable, so it
  cannot clear reuse sight-unseen. NO (stale); revisit if a current
  guide appears AND the licence text is verified.
- City registration (register.ottawa.ca) is an ActiveNet skin
  (anc.ca.apm.activecommunities.com). Active's own Terms of Use ban
  robots/spiders/scraping/data-mining without written consent,
  limit use to personal non-commercial, and ban redistribution and
  derivatives (plus $0.25/page liquidated damages past 1000/day).
  NO-barred. This also bars the registration paths of Sensplex and
  any other ActiveNet user — listing pages on their own domains are
  a separate question each.
- Sensplex, Apex Hockey (Ottawa confirmed: /canada/ottawa/ page, HQ
  here, sessions at Richcraft Sensplex and Nepean Sportsplex),
  Dovercourt, YMCA-YWCA NCR: all DECIDE in the familiar no-ToU
  shape (program/privacy policies only, nothing on automated
  access). Notes: Apex disallows ALL query-string URLs plus its
  calendar/event action paths (location pages allowed); Dovercourt
  registration is login-walled PerfectMind and its newsletter
  mentions an embedded Google Calendar (public-ICS unverified);
  Apex camp details live on leagueapps.com (robots open, terms
  unknown — out of scope unless approved, per the Chamberfest
  detail-page precedent). All four need your call on no-ToU plus
  the training-use flag.
- RA Centre: DECIDE-partial. Robots disallow camps, pa-day and
  march-break camps, upcoming-programs, junior-athletes-events and
  registration forms; drop-in and some program pages are allowed.
  Allowed pages only, never the disallowed paths.
- Barrhaven Bugle: NO-barred. Robots welcome general crawlers but
  explicitly refuse model-training harvesters (GPTBot, ClaudeBot,
  Google-Extended, Applebot-Extended, Meta-ExternalAgent, CCBot
  and more) — same class as #7, and our contributor pipeline may
  train. Terms not sought; the robots refusal decides.
- Corporate retail, all NO-barred on verbatim terms: Apple (no
  page-scrape/robot/spider, no reproduction without written
  consent), Home Depot (no screen scraping or "any activity
  intended to collect, store, reorganize or manipulate data", no
  redistribution; robots.txt itself timed out twice → unknown),
  Mastermind Toys (no copying/distribution without prior written
  consent, personal non-commercial only). Their events are real
  (Home Depot Kids Workshops run free monthly; Mastermind has a
  Store Events page) but barred all the same.
- Round-2 yield if you approve every DECIDE: 5 more tier-2 sources,
  all sports/camps/classes/workshops/outdoors-flavoured, 0 new
  confirmed tier-1 feeds. Nothing ingested; awaiting your approval
  list as in round 1.

## Round-2 approval (2026-10-30)

Approved: 29, 30, 31, 32, 33. All others: not approved.
Conditions:
- Sensplex: drop on any bot-check page; never touch Active/ActiveNet
  booking. Dovercourt: public pages only, never PerfectMind. Apex:
  apexhockey.com pages only, no query-string URL, nothing on
  leagueapps.com. RA: allowed pages only, never disallowed paths.
  Enforcement is structural: same-host link following (off-host
  booking systems unreachable), RFC 9309 robots matching including
  `*`/`$` and query strings (Apex `/*?`, RA program/camp paths).
- `noTrainingRoute` per-source flag (source-config.ts): set on the
  five plus every approved source with no ToU found (OPL + all
  slices, OAG, Farmers, GCTC, Chamberfest, OLT, Diefenbunker).
  Nature/War/History keep Meta (federal copyright terms found).
  Flagged text uses Baseten only in extraction AND enrichment; on
  Baseten errors or cap, skip and retry later — never contributor.
- Attribution + official link on every event; every crawl-delay
  honored (fetcher floor 3 s).
- Under-3 rule: a source yielding fewer than 3 events after one
  extraction attempt is dropped and recorded here. Dry-run outcomes
  (2026-10-30, one attempt each, Baseten extraction): Sensplex 0 —
  DROPPED (no bot-check errors encountered; page fetched fine,
  nothing quotable). Apex 0 — DROPPED. YMCA 1 — DROPPED. RA 0 —
  DROPPED. Dovercourt 3 (plus 3 dropped without evidence) — KEPT,
  exactly at threshold. Dropped sources removed from seed + config;
  table rows updated.

## Table

| # | Name | URL | Feed type | Robots result | Terms-of-use link | Tier | Recommended, and why |
|---|------|-----|-----------|---------------|-------------------|------|----------------------|
| 1 | Ottawa Public Library | https://biblioottawalibrary.ca/en/program | None found (faceted HTML + booking subdomain) | Main robots redirects to open Drupal file; booking subdomain open, crawl-delay 10 | None found (only meeting-room + BiblioCommons account terms) | 2 | DECIDE — ~1800 programs, biggest volume, but no website ToU; worse, booking pages return **HTTP 403 to bots** (hard refuse). Needs your call + an access check. |
| 2 | City of Ottawa | https://ottawa.ca | None found | Open, crawl-delay 5; facet/query URLs disallowed | https://ottawa.ca/en/terms-use — **pages return empty to automated fetch** (possible bot-wall) | 2 | DECIDE — huge volume, but terms unreadable and pages may block our UA. Needs your call + access check. |
| 3 | National Arts Centre | https://nac-cna.ca | None found (HTML calendar + event pages) | Open; AI-training bots explicitly disallowed | Copyright page: no reproduction/redistribution without prior written permission | 2 | NO-barred — redistribution forbidden. |
| 4 | Ottawa Art Gallery | https://oaggao.ca/events/?ical=1 | **ICS confirmed** (real VCALENDAR, America/Toronto, upcoming events) | Open, crawl-delay 10 | None found (privacy + terms URLs 404) | 1 | DECIDE — best tier-1 feed, but no ToU page exists to clear reuse. Needs your call. |
| 5 | Canadian Museum of Nature | https://nature.ca/en/visit-us/whats-on/ | Blog RSS is news-only, not events | Open (search/admin disallowed) | https://nature.ca/en/about-the-museum/terms-conditions/copyright/ — non-commercial + attribution, but "free product by a non-profit" clause is ambiguous for app use | 2 | DECIDE — lean yes with attribution; needs your call on the clause. |
| 6 | Ingenium (3 museums) | https://ingenium.ca (moved from ingeniumcanada.org) | None found | Open, crawl-delay 10, **ai-train=no** reservation | https://ingenium.ca/en/terms-of-use/ — personal use only; other purposes need written permission | 2 | NO-barred — our service use needs permission we don't have. Could ask them (museums often grant). |
| 7 | National Gallery of Canada | https://www.gallery.ca | Unknown | crawl-delay 10, **ai-train=no** reservation | Unknown (not researched after robots signal) | 2 | NO-barred — explicit AI-training reservation; our pipeline may train contributor models. Possible exception: deterministic tier-1-only parsing, never to models. |
| 8 | Canadian War Museum | https://www.warmuseum.ca/events-and-programming | None allowed (`*.json`, `*.xml` disallowed) | Open, crawl-delay 10, feeds disallowed | https://www.warmuseum.ca/copyright — private/non-commercial reproduction allowed with attribution; commercial prohibited | 2 | **YES** — attributed, linked, non-commercial pilot only; revisit if monetized. |
| 9 | NCC | https://ncc-ccn.gc.ca | Unknown | **No robots.txt (404)** | Important-notices: no reproduction/distribution without prior written permission | 2 | NO-barred — redistribution forbidden. |
| 10 | Ottawa Bluesfest | https://ottawabluesfest.ca | None (`*/feed/` disallowed; `?ical=1` 404s) | Open; RSS feeds disallowed | None found | 2 | DECIDE — lean no: no ToU + off-season (July festival, sparse now). |
| 11 | Ottawa Jazz Festival | https://ottawajazzfestival.com | RSS confirmed **news-only** (post dates, not event dates) | Open, crawl-delay 10 | None found (privacy page only) | 2 | DECIDE — lean no: no ToU + off-season (June festival, sparse now). |
| 12 | Canadian Tulip Festival | https://tulipfestival.ca | Events Calendar, currently **0 events** (off-season) | Open | Unknown (not researched; nothing to ingest) | — | NO — empty in our 90-day window. |
| 13 | Ottawa Farmers' Market | https://ottawafarmersmarket.ca/events/?ical=1 | **ICS confirmed** (real VCALENDAR, 2 events) | Open; calendar action-views disallowed, base + ICS allowed | Privacy page only, no ToU | 1 | DECIDE — confirmed tier-1 feed, small volume, no ToU. Needs your call. |
| 14 | GCTC | https://www.gctc.ca | RSS confirmed **post-dates only**; `?format=ical` disallowed | Open (Squarespace; ical/json formats disallowed) | Privacy page only, no ToU | 2 | DECIDE — small season (~6 shows), no ToU. Needs your call. |
| 15 | Ottawa Chamberfest | https://www.chamberfest.com/event/ | None (clean HTML listing; `?ical=1` returns HTML) | Open | None found | 2 | DECIDE — 2+ concerts in window confirmed on listing page, no ToU. Needs your call. |
| 16 | Canadian Museum of History | https://www.historymuseum.ca/events-and-programming | None allowed (`*.json`, `*.xml` disallowed) | Open, crawl-delay 10, feeds disallowed | https://www.historymuseum.ca/copyright — same clean federal terms as War Museum | 2 | **YES** — same conditions as #8. |
| 17 | Ottawa Little Theatre | https://www.ottawalittletheatre.com/calendar/ | None (`?ical=1` returns HTML) | Open; calendar action-views disallowed | Privacy page only, no ToU | 2 | DECIDE — small season, no ToU. Needs your call. |
| 18 | Ottawa Fringe | https://ottawafringe.com | Schedules are **PDFs**; festival over (June), next Feb 2027 out of window | Open | Unknown (not researched; nothing ingestible now) | — | NO — PDF-only + off-season. |
| 19 | Diefenbunker | https://diefenbunker.ca/events/?ical=1 | **ICS confirmed** (real VCALENDAR) | Fully open | None found | 1 | DECIDE — confirmed tier-1, tiny volume; source quirk: times tagged America/Halifax though venue is Ottawa (1h offset baked in). Needs your call. |
| 20 | Dovercourt Recreation | https://dovercourt.org | None found | Open, crawl-delay 10 | None found (program waivers only, not website ToU) | 2 | DECIDE — programs TBD at implementation; no ToU. Needs your call. |
| 21 | Ottawa Tourism | https://ottawatourism.ca/en/event-calendar | Unknown (aggregator) | Open; query-string URLs disallowed | https://ottawatourism.ca/en/terms-use — **§4(f) bans robots/spiders for any purpose**; §6 personal use only | — | NO-barred — automated access explicitly forbidden. |
| 22 | Ottawa 67's (CHL) | https://chl.ca/ohl-67s/schedule/ (schedule page confirmed) | None found | Open, **crawl-delay 20** | Unknown (CHL TV terms only; website ToU not found) | 2 | DECIDE — ~30 home games, big sports volume, no ToU. Needs your call. |
| 23 | Atlético Ottawa (CPL) | https://www.cplsoccer.com/schedule (confirmed in sitemap) | None found | Open | Unknown (404; sitemap has no legal page) | 2 | DECIDE — small volume (playoffs now, then off-season), no ToU. Needs your call. |
| 24 | Ottawa REDBLACKS (CFL) | https://ottawaredblacks.com | Unknown | Open | Unknown (not researched; marginal volume) | 2 | DECIDE — lean no: marginal late-season volume, ToU unknown. |
| 25 | Ottawa Charge (PWHL) | https://www.thepwhl.com | Schedule exists (Dec–Apr season) | Open | https://www.thepwhl.com/en/terms-of-use — personal non-commercial **home use only** | — | NO-barred — third-party service use forbidden. |
| 26 | Ottawa Senators (NHL) | https://www.nhl.com/senators | Unknown | Open | https://www.nhl.com/info/terms-of-service — no robots/scrapers/data mining (confirmed via ToS text) | — | NO-barred — automated access explicitly forbidden. |
| 27 | City open data (Open Ottawa) | https://open.ottawa.ca | CSV Recreation Guides via public Hub API — but only 2020/2022 vintages (unlisted); "Recreation Guide 2026" query matched 0 | Open; dataset paths allowed, crawl-delay 60 | Licence named "Open Government Licence – Ottawa v2.0" but text unreadable (ottawa.ca bot-wall) | 1 (if current) | NO — stale, no current programs dataset. Revisit if a current guide appears AND licence text is verified. |
| 28 | City registration (Register Ottawa / ActiveNet) | https://register.ottawa.ca (ActiveNet skin: anc.ca.apm.activecommunities.com) | Account-based registration listings (ActiveNet) | register.ottawa.ca/robots.txt redirects to a broken ActiveNet URL (no usable robots); activecommunities.com/robots.txt redirects to a marketing page | Active ToU: no robot/spider/scrape/data-mine without written consent; personal non-commercial only; no reproduction/distribution/derivatives; $0.25/page over 1000/day. City's own terms unreadable (bot-wall, no retry). | 2 | NO-barred — Active ToS forbids automated access and redistribution. |
| 29 | Sensplex | https://sensplex.ca | None (HTML program pages: learn-to-skate, Intro 2 Hockey, camps; tournament schedules are PDFs) | Open (Yoast allow-all; only /imunify-bot-check) | Privacy page only (sensplex.ca/privacy); /terms/ 404s — no website ToU | 2 | DROPPED 2026-10-30 — 0 events after one extraction attempt (under-3 rule); no bot-check errors encountered. Was DECIDE (no-ToU). |
| 30 | Apex Hockey (Ottawa) | https://apexhockey.com/canada/ottawa/ | None confirmed (HTML location page; camp detail/booking on leagueapps.com) | Partial: /calendar/action*, /events/action* and ALL query URLs (/*?) disallowed; crawl-delay 3 | Policies page = program participation + privacy only, no automation clause. LeagueApps terms unknown (booking host). Ottawa confirmed: /canada/ottawa/ page, HQ here, sessions at Richcraft Sensplex + Nepean Sportsplex. | 2 | DROPPED 2026-10-30 — 0 events after one extraction attempt (under-3 rule). Was DECIDE (no-ToU). |
| 31 | Dovercourt Recreation | https://dovercourt.org | None confirmed (HTML: swim, camps, sports, workshops, drop-ins; newsletter mentions embedded Google Calendar — public-ICS unverified) | Open, crawl-delay 10 | Program policies on register page + footer privacy lines only; no website ToU | 2 | KEPT 2026-10-30 — 3 events after one extraction attempt, exactly at threshold (3 more dropped without evidence). Was DECIDE (no-ToU). |
| 32 | YMCA-YWCA NCR | https://www.ymcaottawa.ca | None confirmed ("Find Your Fit" schedule finder; NYLD calendars are PDFs) | Open (standard Drupal; admin/user paths only) | Privacy policy only; no ToU | 2 | DROPPED 2026-10-30 — 1 event after one extraction attempt (under-3 rule). Was DECIDE (no-ToU). |
| 33 | RA Centre | https://www.racentre.com | None (HTML program/drop-in pages) | Partial: camps, pa-day/march-break camps, upcoming-programs, junior-athletes-events, registration forms disallowed; drop-in + some program pages allowed; no crawl-delay stated | Policies page = privacy/member policies only; no website ToU | 2 | DROPPED 2026-10-30 — 0 events after one extraction attempt (under-3 rule). Was DECIDE-partial (no-ToU). |
| 34 | Barrhaven Bugle community calendar | https://barrhavenbugle.ca/events/ | None (HTML calendar) | Open for general crawlers BUT explicit training-crawler refusal (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, Meta-ExternalAgent, CCBot, …) | Not sought — robots refusal decides | 2 | NO-barred — explicit AI-training reservation; our contributor pipeline may train (same class as #7). |
| 35 | Apple (Today at Apple / retail) | https://www.apple.com/retail/ | None checked (terms decide) | Open for retail/today paths (shop overlays + CN paths restricted) | Apple Website ToU: no page-scrape/robot/spider/automatic device; no reproduction/distribution without prior written consent | 2 | NO-barred — automated access and redistribution forbidden. |
| 36 | Home Depot workshops | https://www.homedepot.ca/en/home/ideas-how-to/workshops.html | None checked (terms decide); Kids Workshops (free, 2nd Sat/month) confirmed real | Unknown (robots.txt timed out twice) | Home Depot ToU §1: no screen scrape or "any activity intended to collect, store, reorganize or manipulate data"; no reproduction/distribution; personal non-commercial only | 2 | NO-barred — scraping and redistribution forbidden (terms decide regardless of robots). |
| 37 | Mastermind Toys store events | https://www.mastermindtoys.com/pages/store-events | None checked (terms decide) | Open (Shopify public pages/blogs/policies; transactional paths disallowed) | Mastermind ToS: no copying/distribution/reproduction without prior written consent; personal non-commercial only | 2 | NO-barred — redistribution forbidden. |

Not pursued: Winterlude (federal robots fetch timed out; February dates fall outside the 90-day window), open.ottawa.ca (no events dataset found — facilities only), BlackJacks (season over).

## What this means

- Clean YES on fetched terms: **2 sources** (#8 War, #16 History), both tier 2.
- Confirmed tier-1 ICS feeds: **3** (#4 OAG, #13 Farmers' Market, #19 Diefenbunker) — all DECIDE (no ToU page exists).
- Everything else worth having is DECIDE: mostly small nonprofits whose sites publish **no terms of use at all** (only privacy pages), plus OPL/City/67's on access-or-terms questions.
- To reach 8–15 sources with ≥4 tier 1, you must allow some DECIDE rows. My suggested slate if you allow "no ToU found, no contrary terms": OAG (1), Farmers' Market (1), Diefenbunker (1), War (2), History (2), Nature (2), OPL (2), City (2), 67's (2), Chamberfest (2), GCTC (2), OLT (2) = 12 sources, 3 confirmed tier 1. The 4th tier 1 would come from implementation-time JSON-LD verification on an approved HTML source (OAG/OLT/GCTC event pages are the best bets — I cannot see script tags through fetched pages, so JSON-LD is unverifiable until our fetcher runs).

## Method notes (so you can trust the table)

- robots.txt was fetched for every host; "open" means HTTP 200 with no disallow covering event/feed paths (crawl-delays noted, our fetcher honors them).
- "None found" for terms means: a targeted search plus 1–3 direct URL attempts (incl. sitemap scans where available) turned up no website ToU page.
- Feed claims marked "confirmed" were verified by fetching the feed (ICS/RSS bodies seen); "news-only"/"post-dates" verdicts came from reading those feeds.
- JSON-LD cannot be verified through fetched page text (scripts are stripped); any tier-1 JSON-LD claim must be re-verified by our fetcher at implementation.
- 403s, bot-walls, and the OPL booking subdomain refusal were recorded as findings, never bypassed or retried.
