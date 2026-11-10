# Real authenticated recovery verification

Verified on 2026-11-02 against the running development API and PostgreSQL.
No intercepted responses, fabricated role claims, injected recovery drafts, or
authentication/middleware changes were used.

## Accounts and setup

Two dedicated Clerk **Development** demo accounts were initially provisioned with
real N3 metadata through Clerk's administrative API, with the creator's approval.
The existing personal N1 account was left unchanged. The unused N2 demo fixture
was removed with approval. No credentials or personal account addresses belong
in this test record.

The role choice matters: N1 and N2 can create an incident but the existing
authorization policy does not allow them to edit its technical fields. The
verification therefore uses two authorized N3 writers, without relaxing policy.
Both separate browser contexts confirmed their distinct expected Clerk user IDs
and real `GET /api/itsm` responses with `200` and `N3 · Technique`.

## Reproduction and observed result

1. Use an isolated fictional incident; the verified record was `INC-2423`,
   named `QA recovery verification L3COZXVF`.
2. Load the same base snapshot in both contexts (observed version **16**).
3. In B's actual edit dialog, change subject and description to LOCAL values,
   plus independently change category to `Réseau`.
4. Delay B's original save request without changing its body. In A's dialog,
   change the subject and description to REMOTE values, plus independently set
   assignee to `Support applicatif`.
5. A's real PUT returned **200**, version **17**. Release B's original
   version-16 PUT unchanged to the server. It returned a real **409**, with
   current version **18** (workspace versions also include audit writes).
6. B displayed three conflict groups: subject, description, and updates.
   Confirmation was disabled until all three choices were explicit. Choose
   **Ma valeur** for subject and **Valeur distante** for description and updates.
7. B's recovery PUT returned **200**, saved version **19**.
8. Reload both contexts. Both actual GETs returned **200/version 19** and both
   ticket detail views showed:
   - subject: `QA recovery verification L3COZXVF — LOCAL L3COZXVF`
   - description: `REMOTE L3COZXVF: fictional A-side description retained for conflict recovery verification.`
   - category: `Réseau` (independent B edit)
   - assignee: `Support applicatif` (independent A edit).
9. No recovery alert remained and B's account-specific recovery draft was absent.
   The request delay handler was removed after the test.

The normal role-change/archival journey is separate from initial demo-fixture
provisioning. The visible history included two identical assignment-change
entries; field selection, persistence, and recovery cleanup passed, but history
deduplication needs separate investigation.
