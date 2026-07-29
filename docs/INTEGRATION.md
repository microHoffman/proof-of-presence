# Integration

## Consumer boundary

The API and UI consume the same immutable descriptor written automatically after a deployment or upgrade has been
fully reconciled. They do not read Ignition state, the operator manifest, build artifacts, or hand-maintained address
and ABI files.

Descriptor paths are:

- `export/villages/<chainId>/<villageSlug>/<revision>.json`
- `export/profiles/<deploymentProfile>/<chainId>/<villageSlug>/<revision>.json`

The schema-1 descriptor contains:

- deployment kind/profile, village slug, chain ID, network, config hash, and selected modules;
- the exact earliest successful deployment block and block hash;
- each proxy/plain-contract address and deployment name;
- every implementation revision's address, ABI, and ABI hash, with the initial revision effective from
  `deploymentStart` and every later revision tied to an exact `Upgraded` event;
- display-only product aliases;
- a deterministic content-hash `revision`.

Consumers must reject any schema other than `1`, require the connected chain ID to match, use proxy addresses for
upgradeable contracts, and pin an explicitly reviewed descriptor path and `revision`. The deployment tool creates a
descriptor only after live authority reconciliation succeeds, so consumers need no ownership-status polling. A
later upgrade creates a new descriptor file; it never modifies a previously activated revision.

The UI normally needs the proxy address and latest contract revision. The API/indexer retains every revision and
selects the ABI by its activation boundary when decoding historical logs. The descriptor itself is the direct
API/UI input; no second generated or copied ABI file is required.

## Contract clients

Use separate clients for `VillageAccess`, `VillageCitizenNFT`, `CommunityToken`, `DynamicPriceSale`,
`TokenizedStays`, `VillagePresenceToken`, `VillageSweatToken`, `TDFTransferPolicy`, and, for TDF,
`TDFV1BondingCurve`.

VillageCitizenNFT holder discovery is a fixed-block snapshot: read `totalSupply()`, enumerate `tokenByIndex(i)`, and
resolve each `ownerOf(tokenId)`, preferably through multicall. Enumeration order changes after burns, so an index must
never be persisted as token identity. `tokenIdOf(wallet)` returns zero and `citizenshipInfo(wallet)` returns an
all-zero struct when the wallet has no live credential. `locked(tokenId)` is true only for a live token and reverts
after burn. Do not expose transfer or approval controls.

Treat `subjectRef` as an opaque correlation handle generated from a cryptographically secure random source. Never put
personal data, user identifiers, hashes of identifiers, or ciphertext into it. References are public and permanently
single-use. Suspension and revocation both remove the live credential; reapproval requires a fresh token ID and
reference. Lost-wallet recovery is one atomic operator transaction.

The sale exposes two aggregate reads:

- `saleConfiguration()` returns token, quote token, curve, treasury, fee, and fixed launch limits.
- `saleStatus()` returns live total supply, token maximum, effective cap, and remaining capacity.

Use `currentPrice()` for display and `quotePurchase(amount)` for execution preparation. Before
`buy(amount, recipient, maxPayment, deadline)`, approve the DynamicPriceSale for the exact intended quote-token amount.
Use a short deadline and user-approved `maxPayment`; invalidate cached quotes when supply or the bonding curve changes.
The caller is always the payer, while `recipient` receives the CommunityToken. Do not implicitly create an unlimited
approval.

Presence and Sweat are non-transferable. Their `totalSupply()` derives readable balances across holders, so consumers
should prefer indexed/reconciled views to frequent polling and distinguish raw issued value from currently decayed
balance.

## Booking and deposit integration

Booking inputs are `{year, dayOfYear, pricePerDate}`. TokenizedStays records entitlement and deposit state only;
inventory, room assignment, confirmation, check-in, and other product workflow states remain off-chain. Zero-price
dates are valid entitlements.

Deposit reads are already supported:

- `depositedBalanceOf(account)` returns the account's total credited deposit, including the portion currently locked.
- `getDepositState(account)` returns the credited deposit, current required locked amount, currently withdrawable
  amount, cached latest booking year, and current maximum booking year.
- `previewCreateBookings(account, bookings)` validates the proposed batch and returns `depositedBalance`,
  `requiredLockedBalanceBefore`, `requiredLockedBalanceAfter`, and `depositDeficit`.

The exact required top-up is:

```text
depositDeficit = max(requiredLockedBalanceAfter - depositedBalance, 0)
```

It is not the booking batch's total price, the account's total deposit, or the resulting locked balance.

For the allowance flow:

1. Call `previewCreateBookings` immediately before authorization.
2. If `depositDeficit` is zero, call `createBookings` without approval.
3. Otherwise replace the TokenizedStays allowance with exactly `depositDeficit`; do not add it to an old allowance.
4. Re-run the preview after approval, because another transaction may have changed deposits or bookings.
5. Submit `createBookings`. The contract calculates the live deficit and transfers only that amount.

For the EIP-2612 flow, sign exactly the previewed nonzero deficit with a short deadline, then call
`createBookingsWithPermit(bookings, deadline, v, r, s)`. The function deliberately has no caller-supplied permit
amount: it recalculates the live deficit and uses that value in `permit`. If a relayer already submitted the signature,
the call continues only when the resulting allowance still covers the live deficit. Otherwise a stale or invalid
signature reverts the complete booking transaction atomically. A zero-deficit batch uses `createBookings`, not the
permit entry point.

The API should return the contract preview to the UI instead of independently recreating locking arithmetic. The UI
may display it but must refresh it around wallet authorization. Any residual allowance from a replaced/dropped flow
should be visible and revocable.

## Event and upgrade handling

Index events using `(chainId, contract, transactionHash, logIndex)`, with chain finality and reorg rollback. Start from
the descriptor's `deploymentStart`. For each log, choose the last contract revision whose deployment block or
`Upgraded` event is at or before the log's exact block/transaction/log position.

Relevant TokenizedStays events include booking creation/cancellation/pruning, deposit/withdrawal, balance
reconciliation, and orphan recovery. Citizenship history comes from `CitizenshipIssued`,
`CitizenshipOperatorBurned`, `CitizenshipSelfBurned`, and `CitizenshipRecovered` together with ERC-721 `Transfer`.
Index `Locked` for ERC-5192 consumers and refresh live token metadata after `BatchMetadataUpdate`.

The proxy address stays stable across upgrades. Never use only the latest ABI to decode all history, and never treat
an API operator role as upgrade authority.
