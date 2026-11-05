# GDPR compliance record

> Working document for UK GDPR / EU GDPR and PECR. It describes how croot is built to comply. It is
> **not legal advice**. Before launch, a qualified privacy professional should review it together with
> the drafts it points to, and the items under "Open actions" must be completed.

## 1. Roles

| Party | Role | For which data |
| --- | --- | --- |
| Each organisation (e.g. Balance & Beyond) | **Controller** | Its guests' invitations, responses, photos, consent records, anonymous notes |
| croot operator (`PLATFORM_OPERATOR` in `shared/legal.ts`) | **Processor** for the above (Art. 28) | |
| croot operator | **Controller** | Organiser accounts, access requests, platform security logs |
| Hosting provider(s) | Sub-processor | Everything stored or served |

Processing terms: `/legal/terms` (summary draft). The version and date accepted are stored per organisation
(`dpaVersion`, `dpaAcceptedAt`). Requesters acknowledge them on the access form (`TenantRequest.termsVersion`),
and owners confirm them on **Workspace → Privacy**.

## 2. Record of processing activities (Art. 30)

| Activity | Data subjects | Data | Purpose | Lawful basis | Recipients | Retention (default, configurable) |
| --- | --- | --- | --- | --- | --- | --- |
| Invitations | Guests | Name, email, stay dates | Send a personal review link | Legitimate interests (Art. 6(1)(f)) | Organiser team | Never responded: 180 days after the programme or stay |
| Private feedback | Guests | Ratings, comments, keep/change | Improve services | Legitimate interests; every question optional | Organiser team | 24 months after submission |
| Public story, first name, photos | Guests | Story text, first name, images | Publish testimonials | Consent (Art. 6(1)(a)), per item, withdrawable | Public, after approval | Until consent is withdrawn |
| Follow-up contact | Guests | Email | Discuss feedback | Consent | Organiser team | With the response |
| Marketing reuse | Guests | Story, photos | Social media and advertising | Separate consent | Organiser team | Until withdrawn |
| Anonymous notes | Guests (unidentified) | Free text, topic, week received | Concerns raised without a name | Legitimate interests | Organiser team | 24 months |
| Consent and audit records | Guests, organisers | Scope, wording version, actor, time | Accountability (Art. 5(2), 7(1)) | Legal obligation and legitimate interests | Organiser team, operator | Consent: with the response. Audit: 36 months |
| Photo originals | Guests | Original image files | Produce metadata-free web copies | As for photos | Nobody (never served) | 30 days after submission |
| Organiser accounts | Organisers | Name, email, password hash, sign-ins | Provide the service | Contract | Operator | While a member of an organisation |
| Access requests | Prospective organisers | Name, email, org, website, message | Assess and onboard | Pre-contract steps | Operator | Declined: 6 months. Approved: 24 months |

Special-category data is not requested. The guest privacy notice asks guests not to include it.

## 3. Transparency (Arts. 12 to 14)

- Guest privacy notice: `/o/:orgSlug/privacy`, **generated from the organisation's own settings** (controller
  name, address, privacy email, DPO or representative, retention periods), so it always matches what the system does.
  It is linked from the invitation welcome step, the permissions step, the review step, the receipt page, the
  anonymous-note page and every public page footer.
- Platform notice `/legal/privacy`, processing terms `/legal/terms`, cookies `/legal/cookies`, all marked as drafts.
- Consent wording is versioned (`CONSENT_WORDING_VERSION`) and recorded with every consent event.

## 4. Consent (Arts. 4(11), 7)

- Separate switches for public story, first name, each photo, marketing reuse and follow-up contact. **All start off.**
- Nothing is a condition of anything else: private feedback works with every switch off.
- Withdrawal is as easy as giving consent: one click on the receipt page, effective immediately
  (story pages return 410 and photo URLs 404 straight away). The history is kept in `ConsentEvent`.
- Organisers cannot override a declined choice or rewrite a guest's words.

## 5. Data-subject rights

| Right | How |
| --- | --- |
| Access, portability (15, 20) | Guest: receipt page → "Download my data" (JSON). Organiser: Privacy → Guest data requests → Export |
| Erasure (17) | Guest: receipt page → "Delete everything" (immediate). Owner: Privacy → Erase, with a reason. The audit log records the erasure without personal data |
| Rectification (16) | Guest asks for an edit from the receipt page. The organiser reopens the response and the guest edits it |
| Withdraw consent (7(3)) / object (21) | Receipt page switches; or by email to the organiser |
| Restriction (18) | Manual: the organiser unpublishes and pauses (documented procedure, §8) |

Anonymous notes cannot be linked to a person, so they fall outside access and erasure requests. Art. 11 applies, and the notice says so.

## 6. Storage limitation (Art. 5(1)(e))

`server/src/jobs/retention.ts` runs every 6 hours in-process. It uses a Postgres advisory lock, so it is safe
with several instances, and can also be run with `npm run retention`. Each organisation sets its own periods
within the bounds in `shared/legal.ts`. It deletes stale drafts, non-responders and old responses.
For published stories it keeps only the published snapshot: private feedback, other photos, the email
address and stay dates are deleted. It also deletes photo originals, old notes and old audit events, expired
sessions, used setup links, old invitations and old access requests.

## 7. Security (Art. 32) and privacy by design (Art. 25)

- Invitation, receipt, setup and session tokens: 256-bit random values, stored only as SHA-256 hashes, and redacted from logs.
- Passwords: scrypt. Sessions: httpOnly, SameSite=Lax, `__Host-` and Secure in production. CSRF tokens on all mutations.
- Tenant isolation is checked on every admin query. Public endpoints read only publication snapshots.
- Photos are decoded and re-encoded with EXIF/GPS removed. Originals are never served and are deleted after the retention period.
- No analytics or tracking. `Referrer-Policy: no-referrer`. The anonymous-note endpoint reads no cookies and stores no IP or precise time.
- Platform-admin access to any organisation is written to that organisation's audit log.
- Still needed in production: TLS, encrypted backups with a tested restore, and least-privilege database credentials (see README).

## 8. Procedures

**Rights request received by email:** verify the requester through the email address on file, then use
Workspace → Privacy → Guest data requests, and reply within one month. Record the request in your own log.

**Personal data breach:** the processor notifies affected organisations without undue delay (target 48 hours).
The controller assesses risk and notifies the ICO or the relevant EU authority within 72 hours where required, and
informs guests if the risk is high. The audit log and access logs (which record no IPs) support the investigation.

**End of service:** the owner downloads Workspace → Privacy → "Export everything". The platform admin then
uses "Delete organisation…", which removes all rows and files for that organisation.

## 9. DPIA screening

Review collection involves no special-category data, no large-scale monitoring and no automated decisions.
A full DPIA is probably not mandatory, but a short documented screening is recommended. The residual risks are
re-identification in small cohorts (mitigated by week-only timestamps on anonymous notes and an aggregate
threshold on insights) and group photos showing other people (mitigated by a guest warning and organiser approval of each photo).

## Open actions before launch

1. Fill in `PLATFORM_OPERATOR` (legal name, address, privacy email, hosting region) in `shared/legal.ts`.
2. Have the privacy notice, processing terms and cookie texts reviewed, then bump the versions in `shared/legal.ts`.
3. Sign full Art. 28 agreements with each organisation and with the hosting provider. Confirm the hosting region and any transfer safeguards.
4. Each organisation completes Workspace → Privacy (legal name, address, privacy email) and confirms its retention periods.
5. Decide whether croot or an organisation needs a UK or EU representative (Art. 27), or a DPO.
6. Set up encrypted backups, decide their retention so deletions also expire from backups, and test a restore.
