# Remaining work

Last reconciled: 2026-07-26

The contract and deployment implementation is complete for the current architecture. Remaining items are live-network
rehearsal, independent review, API/UI integration, product decisions, and rollout.

## Contract repository

- Rehearse automatic verification and retry behavior on Celo Sepolia, including proxy/implementation presentation and
  provider-specific failures.
- Rehearse the EOA-to-Safe ownership handoff and a Safe-owned UUPS upgrade on Celo Sepolia, including optional
  reinitializer calldata, one-time reconciliation, and automatic descriptor revision generation.
- Run the standard pull-request suite (including the ten-year scale test) plus the manual deep fuzz/invariant,
  coverage, Aderyn, Wake, and targeted mutation suites against the release candidate.
- Triage every current static-analysis and OSV finding, then freeze an immutable audit revision.
- Obtain an independent audit covering contracts, storage/upgrades, authority, booking/deposit invariants, citizenship
  issuance, burn and recovery, permanent subject-reference consumption, sale pricing and payments, transfer policy,
  deployment recovery, and manifest/descriptor trust boundaries.

Already complete: schema-1-only deployment input, deployer-first configuration, optional same-EOA ownership, atomic
Safe handoff preparation, exact deployment/upgrade activation boundaries, per-revision ABIs, and automatic immutable
consumer descriptors. These no longer need separate remaining-work entries.

## Product decision

Choose whether the UI ever offers persistent token approval for CommunityToken deposits or DynamicPriceSale
quote-token purchases. Recommended defaults are permit-first with exact approval fallback for bookings and exact
approval before each sale purchase. If persistent approval is offered, it must be explicit, explain spender risk,
show the allowance, and provide revocation.

## API integration

The following work preserves the API's existing booking, CommunityToken, Presence, and Sweat scope:

- Add one explicit activation step for a reviewed immutable schema-1 consumer descriptor. Reject wrong schemas/chains,
  config or address collisions, and revision changes; retain immutable activation history. Ownership status monitoring
  is unnecessary because descriptors are generated only after live handoff reconciliation.
- Build clients only from the activated descriptor. At activation verify deployed code and critical wiring; before an
  operator write verify the live role and pause state and simulate the call.
- Retain every contract ABI revision, begin indexing with the initial revision at `deploymentStart`, and use each
  later revision's exact upgrade-event boundary for historical event decoding.
- Expose `previewCreateBookings` results to the UI, including the exact `depositDeficit`, plus
  `depositedBalanceOf`/`getDepositState` reads. Do not recreate the contract's 365-day locking calculation in the API.
- Persist idempotent operator intents and transaction state so retry, nonce replacement, receipt recovery, finality,
  and reorg rollback cannot duplicate issuance, burn, recovery, or booking actions.
- Treat on-chain bookings as entitlement and deposit state, not inventory or payment confirmation. Correlate with
  backend pricing/inventory and synchronize zero-price bookings, deposits, withdrawals, cancellations, and pruning.
- Keep an authoritative Presence/Sweat issuance-lot ledger, including `daysAgo` and burn-bucket inputs. Expose raw and
  currently decayed balances distinctly and reconcile them against on-chain state.
- Index current-scope business events plus role, ownership, pause, policy/configuration, metadata, and upgrade events
  with backfill, finality, and reorg rollback.

## UI integration

The following work preserves the UI's existing wallet, booking, CommunityToken, Presence, and Sweat scope:

- Build typed clients from the activated schema-1 descriptor, use the latest revision for writes, support optional
  modules, block writes on the wrong chain, and react to account, chain, and disconnect changes.
- Use `previewCreateBookings` immediately before authorization. For a nonzero deficit, sign a short-lived permit for
  exactly that deficit or replace the allowance with exactly that deficit; never approve the total deposit/locked
  amount or add to an old allowance. Skip authorization when zero and refresh the preview after approval.
- Submit `createBookingsWithPermit(bookings, deadline, v, r, s)` only for a nonzero deficit; use `createBookings` for
  the allowance or zero-deficit path. Surface and allow revocation of any residual allowance.
- Complete the booking/deposit lifecycle: zero-price dates, credited/locked/withdrawable state, top-up, withdrawal,
  cancellation/pruning, and a clear distinction between on-chain entitlement and off-chain confirmation.
- Handle rejected, replaced, dropped, reverted, included, and finalized transactions, recover receipts after reload,
  and map contract custom errors to useful messages.
- Use bigint/contract decimals and the contract's UTC date helpers. Show raw versus currently decayed Presence/Sweat
  balances and do not expose transfer or approval controls for non-transferable tokens.
- Keep access, CommunityToken, stays, Presence, Sweat, transfer-policy, and curve clients separate, and show relevant
  pause/policy state before enabling writes.

## New Functionality

These items expand API/UI product scope rather than preserving compatibility.

### API

- Integrate VillageCitizenNFT issuance, operator burn, lost-wallet recovery, permanent subject-reference history, and
  metadata ownership/serving.
- Integrate DynamicPriceSale configuration and purchase-event indexing.
- If booking price/inventory must become authoritative on-chain, add a backend-signed quote flow; the current contract
  intentionally accepts caller-supplied prices.

### UI

- Add VillageCitizenNFT discovery and lifecycle views, including self-burn and authorized operator workflows.
- Add DynamicPriceSale quote, bounded approval, deadline, purchase, receipt, pause, and sold-out handling.
- If selected as a product feature, add explicit persistent-approval controls with allowance visibility and
  revocation.

An API deployment worker and UI deployment-administration console are intentionally not listed: the simple operator
CLI/runbook is sufficient unless future deployment volume creates a demonstrated product need.

## Operations and rollout

- Pin and monitor RPC, Safe Transaction Service, explorer, and Sourcify endpoints per network.
- Separate and rotate deployer, Safe proposer, and API operator secrets; bound gas funding and document emergency
  authority runbooks.
- Prove a fresh operator environment can restore backed-up Ignition journals/manifests and resume without
  redeployment.
- Rehearse the complete deploy/handoff/verify/import/issue/recover/revoke/quote/buy/book/cancel/token/index/upgrade
  flow on Celo Sepolia, including external-service outages.
- Operate one audited pilot village with explicit success and error-budget criteria before broader rollout.
