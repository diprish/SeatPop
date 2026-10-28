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
