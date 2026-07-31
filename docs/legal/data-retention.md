# Data Retention Policy

Status: living document — this is the human-readable mirror of
`apps/web/lib/legal/data-retention.ts`, the runtime source of truth the
Privacy Policy renders from. **If you change a retention period, update both
files** — this document is not auto-generated from the code.

Established as part of the GDPR + Cookie Consent Platform milestone. Periods
below reflect an explicit product/legal decision made for that milestone,
except where a Bulgarian or EU legal obligation dictates a different period
(noted per row).

| Data category | Retention period | Legal basis |
| --- | --- | --- |
| Account and profile data (name, email, phone, organization membership, role) | Until account deletion | Performance of a contract |
| Organization billing/invoicing details | Until account deletion, **except** specific financial/accounting records that Bulgarian accounting and tax legislation (the Accountancy Act and the Tax-Insurance Procedure Code) requires to be kept longer — those are kept for the legally required period instead | Performance of a contract; legal obligation where applicable |
| Plant operational and telemetry data (device readings, daily production/consumption) | Life of the FusionSolar connection, plus up to 12 months after disconnection or account deletion, unless a longer period is legally required or requested by the customer | Performance of a contract; legitimate interest (post-relationship support) |
| Public electricity market price data | Indefinite | Not personal data |
| Automation decision log (`AutomationEvent`) | 24 months | Legitimate interest (explainability/auditability of automated decisions) |
| Administrative audit log (`AuditLog`) | 24 months | Legitimate interest (security/accountability) |
| Cookie/consent decision history (`ConsentLog`) | 24 months **per recorded decision** — earlier decisions are never discarded just because a newer one exists | Legal obligation (GDPR accountability principle — demonstrating consent) |
| Support impersonation sessions (`ImpersonationSession`) | 24 months | Legitimate interest (security/accountability) |
| Email verification tokens | 24 hours or until used | Account security |
| Password reset tokens | 60 minutes or until used | Account security |
| Deleted-account audit record (`AccountDeletionRecord`) | Indefinite — contains no personal data (see below), so the normal time limits don't apply | Legal obligation (demonstrating a deletion request was honored) without retaining the deleted personal data |

## Note on the deleted-account audit record

When a user deletes their own account (Settings → Danger Zone), Voltessa
records that a deletion happened without retaining anything that could
identify who it was. The record contains only: a timestamp, a fixed action
type (`account_deleted`), an actor type (`self_service`), an internal
correlation id (for support/debugging), and a schema version. It holds no
name, email, phone, address, IP address, user agent, or profile field, and
cannot be used to reconstruct or re-identify the deleted individual. See
`AccountDeletionRecord` in `apps/web/prisma/schema.prisma` and
`app/(platform)/settings/actions.ts`'s `deleteAccount()`.

## Note on financial/accounting records

Voltessa does not currently generate or store invoice documents within this
application (`BillingInformation` holds the customer's own invoicing
contact/tax details, not invoice records themselves). If Voltessa's own
accounting process later begins issuing and storing invoices, confirm the
exact statutory retention period with the company's accountant before
citing a specific number of years in the Privacy Policy — Bulgarian
accounting and tax law (the Accountancy Act's document-retention rules and
the Tax-Insurance Procedure Code's audit-relevant record rules) applies to
those specific documents, not to this schedule's default account-deletion
timelines.

## Enforcement

This document and `lib/legal/data-retention.ts` describe the **retention
policy** as disclosed to users. As of this milestone, retention is not yet
technically *enforced* by an automated purge job for `AutomationEvent`,
`AuditLog`, `ConsentLog`, or `ImpersonationSession` — these tables do not yet
have a scheduled deletion process once their 24-month window elapses.
Building that enforcement (most likely a new Scaleway systemd timer,
following the existing pattern documented in
`docs/infrastructure/scaleway-production.md`) is explicit follow-up work, not
included in this milestone's scope.
