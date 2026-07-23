# Integration

## Consumer boundary

Downstream API and UI code should consume a derived export, not Ignition state and not hand-maintained addresses. Build
one from a reconciled deployment manifest:

```sh
yarn export:village -- --manifest <manifest.json> --out <export.json>
```

The export uses schema version `2` and contains:

- `deploymentKind`, `deploymentProfile`, village slug, chain ID, and network;
- proxy/plain-contract addresses and implementation addresses where applicable;
- the ABI for each contract;
- display-only product aliases.

The deployment manifest remains the operator source of truth for ownership, roles, pending actions, verification,
runtime code hashes, upgrades, config hash, and Ignition provenance.

Consumers must:

- reject unsupported `schemaVersion` values;
- require the connected chain ID to equal the export's `chainId`;
- use proxy addresses for upgradeable contracts;
- key deployments by chain, village/profile, and immutable manifest history;
- activate direct-owner deployments only after `status` is `complete`;
- independently confirm deployer-handoff acceptances before activation;
- never infer a schema or deployment kind from an address or ABI.

## Contract clients

Use separate clients for `VillageAccess`, `VillageCitizenNFT`, `CommunityToken`, `TokenizedStays`,
`VillagePresenceToken`, `VillageSweatToken`, and `TDFTransferPolicy`.

VillageCitizenNFT holder discovery is a fixed-block snapshot: read `totalSupply()`, enumerate `tokenByIndex(i)`, and
resolve each `ownerOf(tokenId)`, preferably through multicall. Enumeration order changes after burns, so an index must
never be persisted as token identity. `tokenIdOf(wallet)` returns zero and `citizenshipInfo(wallet)` returns an all-zero
struct when the wallet has no live credential. `locked(tokenId)` is true only for a live token and reverts after burn.
Do not expose transfer or approval controls.

Treat `subjectRef` as an opaque correlation handle generated from a cryptographically secure random source. Never put
personal data, user identifiers, hashes of identifiers, or ciphertext into it. References are not secrets, appear in
events, and can never be reused. Suspension and revocation both remove the live credential; reapproval requires a new
issuance with a fresh token ID and reference. Lost-wallet recovery is one atomic operator transaction.

Booking inputs are `{year, dayOfYear, pricePerDate}`. TokenizedStays records entitlement and deposit state only;
inventory, room assignment, confirmation, check-in, and other product workflow states remain off-chain. Zero-price
dates are valid entitlements and must not be treated as missing.

For CommunityToken payment, prefer an exact, short-lived EIP-2612 permit. An exact `approve` is the compatibility
fallback. Do not create an unlimited approval implicitly.

Presence and Sweat are non-transferable. Their `totalSupply()` derives readable balances across holders, so consumers
should avoid frequent polling and prefer indexed/reconciled views.

## Event and upgrade handling

Index events using `(chainId, contract, transactionHash, logIndex)`, with chain finality and reorg rollback. Relevant
TokenizedStays events include booking creation/cancellation/pruning, deposit/withdrawal, balance reconciliation, and
orphan recovery.
Citizenship history comes from `CitizenshipIssued`, `CitizenshipOperatorBurned`, `CitizenshipSelfBurned`, and
`CitizenshipRecovered` together with ERC-721 `Transfer`. Index `Locked` for ERC-5192 consumers and refresh live token
metadata after `BatchMetadataUpdate`; there is no `Unlocked` lifecycle.

Keep immutable manifest history across upgrades. The proxy address stays stable; the implementation address and
effective ABI revision are auditable through `upgradeHistory` and the chain's ERC-1967 slot. An API operator role
must never be treated as upgrade authority.

## Deployment automation

An automated deployment worker should:

1. generate and validate schema-4 config;
2. use a clean immutable source revision;
3. invoke the supported deployment wrapper with a dedicated deployer;
4. persist the stable Ignition deployment ID and logs;
5. resume after interruption instead of creating a second deployment;
6. use a separate Safe proposer credential for owner actions;
7. reconcile on-chain state before publishing the manifest/export;
8. retain journals and manifests in durable storage.

Private keys must never be accepted from browser or HTTP deployment input.
