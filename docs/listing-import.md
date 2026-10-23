# Listing auto-fill

Tracker R32. A landlord starting a listing can paste the link of a listing
they already have elsewhere, or upload its PDF, and the create-listing
wizard is filled from it. Every field says whether it was found in the
source, inferred from it or is missing, with the snippet it came from, and
the owner checks each one before using it. Nothing is saved or published by
an import: only publishing the listing at the end of the wizard writes it
(R25). The code is `backend/app/services/listing_import.py`; the wizard's
part is `frontend/app/components/rental/import/`.

## The endpoints

Both are for landlords (and agents) only; anyone else gets 403 before
anything is read.

| Request | Body |
|---|---|
| `POST /me/listing-imports/url` | JSON `{url, use_ai}`; `use_ai` is optional, false by default |
| `POST /me/listing-imports/pdf` | multipart: `file` (a PDF, at most 10 MB) and optional `use_ai` |

The answer (`ListingImportOut`, `backend/app/schemas/listing_import.py`)
has every field the wizard takes but the photos: `title`, `description`,
`address` (the street line), `suburb`, `state`, `postcode`,
`property_type`, `bedrooms`, `bathrooms`, `price` (dollars a week), `bond`,
`lease_term`, `available_from`, `amenities`, `pets_allowed` and
`floor_area` (square metres). Each is `{value, source, evidence, via}`:

- `source` is `found` (the source states it), `inferred` (worked out from
  what it states, so it may be wrong) or `missing` (the owner types it).
- `evidence` is the snippet the value came from, such as `Bond: $2,600` or
  `numberOfBedrooms: 2`; null when missing.
- `via` is where it was read: `structured_data` (schema.org JSON-LD),
  `page_meta` (OpenGraph and meta tags, the page title), `text` (the text
  rules), `pdf_metadata` (the PDF's own title) or `ai`.

`counts` adds them up, `source_label` and `source_url` say what was read,
and `ai_status`, `message` and `verification` say what happened with the
model (below).

A failure is a 4xx or 5xx whose `detail` is `{code, message}`; the wizard
shows the message and keeps the form as it was.

| Code | Status | When |
|---|---|---|
| `invalid_url` | 422 | not an http(s) link, a user name or password in it, a malformed host |
| `port_not_allowed` | 422 | a port other than 80 or 443 |
| `address_not_allowed` | 422 | the host, or a redirect's, is a private or special address |
| `too_many_redirects` | 422 | more than 3 redirects |
| `blocked` | 422 | a site that refuses automatic reading (below); `detail.sample` is the sample |
| `not_found` | 422 | the site answered 404 or 410 |
| `not_a_listing` | 422 | nothing the source says is a listing's detail |
| `unreadable_pdf`, `no_text`, `invalid_file` | 422 | a damaged or password-protected PDF, one with no text (a scan), no file |
| `too_large` | 413 | a page over 2 MB, a PDF over 10 MB |
| `busy` | 429 | the owner's previous import is still running (one per owner at a time), the site of their last import is still being looked up, or every lookup thread is taken (process-local) |
| `unsupported_content` | 415 | a link that opens anything but HTML or JSON, a file that is no PDF |
| `unreachable` | 502 | no DNS answer, no connection, or the site answered an error |
| `timeout` | 504 | past the time limits |

## Reading a link

The server fetches a URL someone typed, so it goes only where a browser on
the open internet could. `tests/test_listing_import_safety.py` tries each
rule.

- **Links:** http or https, on port 80 or 443, without a user name or
  password. Fragments are not sent.
- **Addresses:** the host is resolved once, and every address it gives must
  be public. Private, loopback, link-local, multicast, reserved,
  unspecified, shared (100.64/10) and site-local addresses are refused, in
  IPv4 and IPv6. An IPv4-mapped IPv6 address counts as its IPv4 address;
  6to4, Teredo and NAT64 addresses are refused. An IP address in the link
  is checked the same way, in every form a resolver reads (`2130706433`,
  `0x7f.1`, `127.1`).
- **No rebinding:** the connection goes to the address that was checked and
  to no other (`_PinnedBackend` refuses any other). The link's host is sent
  as `Host` and as the TLS server name, and the certificate is checked
  against it. Nothing looks the name up again, so a DNS answer that changes
  in between is never used.
- **Redirects:** at most 3, each checked from the start: scheme, port,
  addresses and the sites below.
- **Lookups:** a lookup that does not answer in time is left to finish on
  its own thread, of 8. None waits for a thread: an owner has one lookup
  running at most, and with every thread taken an import is `busy`, so the
  names one account leaves hanging hold up nobody else's import.
- **Time:** 5 seconds to resolve and to connect, 10 seconds for the whole
  fetch, every read and write included. The rules then read at most 200,000
  characters of text, and none of them backtracks through a long run of
  letters, digits or spaces. The structured data is read each node once,
  however many others point at it: 2,000 nodes, 200 items of a list, the
  first 20 offers, price specifications of an offer and addresses, and no
  unit, currency, code, region, type or number longer than 100 characters,
  nor a one-line address longer than 300. So a page or PDF written to stall
  them is read as quickly as any other.
- **Size and type:** at most 2 MB, as sent and as decompressed, of
  `text/html`, `application/xhtml+xml` or JSON. No cookies, proxies or
  credentials are used, and the request says who it is
  (`TenantVoiceListingImport/1.0`).

**Sites that refuse reading** (tracker assumption #7). realestate.com.au and
Domain do not let other sites read their listings, so they are never
fetched. A site that answers 401, 403, 429 or 451, a Cloudflare challenge,
or a page that is a human check (and no listing) is refused the same way.
The answer suggests saving the listing as a PDF or typing the details, and
carries a sample import (`sample`, `demo: true`): a made-up listing read by
the same rules, which the wizard offers with a Demo label
(`docs/demo-features.md`).

## Reading the details

Nothing is made up: a field the source does not give is missing. The rules
run in this order, and a found value replaces an inferred one.

1. **schema.org JSON-LD:** a `Residence`, `Apartment`, `House`,
   `SingleFamilyResidence`, `Accommodation` (or its `Room`, `Suite`), a
   `RealEstateListing`, a `Product` with offers, an `Offer` and its
   `itemOffered`, through `@graph` and `@id` links. `name`, `description`,
   `address` (a `PostalAddress`, or one line), `numberOfBedrooms`,
   `numberOfBathroomsTotal`, `floorSize`, `amenityFeature` (those whose
   `value` is not false), `petsAllowed`, `leaseLength`, and the offer's
   price, currency, period and `availabilityStarts`.
2. **OpenGraph and meta tags:** `og:title` (without the site's name),
   `og:description`, `description`, the page `<title>`,
   `og:street-address`, `og:locality`, `og:region`, `og:postal-code` and
   `product:price:amount`.
3. **Text rules** on the title, the first heading, the description and the
   page text: "3 bed", "Bedrooms: 3", "2 bath", "$650 per week" (pw, p/w,
   /wk), "$1,300 per fortnight", "$2,600 per month", "Bond: $2,600", "12
   month lease", "available from 1 December 2026" (and 01/12/2026,
   2026-12-01), "pets allowed", "no pets", "Pets: not permitted", an
   address such as "5/18 Wilson St, Newtown NSW 2042", and the property
   type named in the title.

What is **inferred**: a weekly rent from a fortnightly, monthly or yearly
one; a price that names no period (taken as weekly up to $5,000, else
left out as a likely sale price); the parts of a one-line address; a state
from the postcode; "available now" as today, and a date without a year as
the next such date; bedrooms from `numberOfRooms`; a house from
`SingleFamilyResidence`; square metres from square feet; a property type
from the title; a value cut to the field's length; and, in a PDF, its first
line as the title and its first paragraph as the description. A price in
another currency, or by the night, is left out.

A page is a listing when its structured data names a home or a listing, or
any detail but the title and description is read; a price with no period
and a type guessed from the title do not count. Otherwise the answer is
`not_a_listing`.

**Photos are never copied.** Neither `og:image` nor any image in the
structured data is read or returned; the owner adds their own photos in the
wizard.

## PDFs

The PDF is read in memory and never stored. The route checks the sign-in and
role before reading the body, refuses a body over 10 MB (plus the form)
before parsing it and counts a streamed one as it arrives, and the file
itself must be at most 10 MB and start as a PDF. pypdf reads the text of
the first 20 pages; a PDF with a password, a damaged one and one with no
text (a scan) each have their own answer. The same text rules read it, the
PDF's title (unless it is a file name or "Untitled") is its title, and its
first paragraph of prose is an inferred description.

## The model (optional)

`use_ai` lets the model read the text for the fields the rules left
missing, through the provider assistant's DeepSeek client
(`docs/ai-recommendations.md` says how to set the key). It is never asked
otherwise, and never for a field the rules found.

- **The paid AI (R18):** the `paid_ai` gate is asked before the model, with
  the account read anew. A pending, rejected or suspended owner gets the
  rule result with `ai_status` `verification_required` and the refusal in
  `verification`; the model is never asked.
- **What it sees:** the text the rules read (the title, heading,
  description and page or PDF text), at most 20,000 bytes of it, and the
  missing fields with their format. Never the owner's details.
- **What it may answer:** `{"fields": {name: {value, evidence}}}`, nothing
  else; an answer of another shape is refused whole (`unavailable`). Each
  field's quote must be in the text, and its value must be the field's
  kind and agree with the quote: the same number or number word, the same
  date read by the date rule, text copied word for word, a weekly rent only
  from a quote that says weekly, a property type or state named as a whole
  word (ACT, NT, SA and WA, which are words too, only in capitals where
  the text has the quote: "the Residential Tenancies Act" names no ACT),
  and pets only as the pets rule reads the quote ("Pets: not permitted" is
  never a yes). Any field that does not is dropped. What it fills is
  `inferred`, `via` `ai`.
- **`ai_status`:** `not_requested`, `not_configured` (no key), `not_needed`
  (nothing missing), `verification_required`, `cooldown` (one reading per
  owner at a time and at most one every 15 seconds, process-local),
  `unavailable` (a failure or an unusable answer: the rule result stands)
  or `applied`.

## In the wizard

- **The entry.** The first step of `/owner/properties/create` offers
  "Import from a link or PDF" (`ListingImport`). The owner pastes a link
  (one without a scheme is taken as https) or chooses a PDF, which is
  checked for its type and size before it is sent, and may tick "Also let
  AI read it".
- **The review** (`ImportReview`) lists every field by the wizard step it is
  on, with its chip (Found, Inferred, Missing), its value and the snippet it
  came from. Fields with a value start ticked. "Use these details" puts the
  ticked ones in the draft (`lib/listing-import.ts`, `importedDraft`):
  allowed pets add "Pet friendly" and the floor area "Floor area 78 m²" to
  the amenities, after the draft's own and up to 40. Nothing is saved.
- **The summary** (`ImportSummary`) then stays on the first step: each field
  found, inferred, missing or not used, by step, kept in `sessionStorage`
  beside the draft until the listing is published.
- **A failure** (`ImportFailureNotice`) names what went wrong and leaves the
  form as it was. After a link fails it offers the PDF instead, and a
  refusing site's sample can be tried, labelled a demo
  (`SampleImportNotice`).

## To confirm

- The sites that refuse reading are named in `BLOCKED_SITES`; others may
  need adding, or may allow reading through a licensed feed (out of scope,
  `docs/SCOPE.md` §9).
- The import reads one page per request and does not check robots.txt: it
  fetches only what the owner pasted, as a browser would.
- The text rules read Australian English listings: dollars, Australian
  states and postcodes, day-first dates.
