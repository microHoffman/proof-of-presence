# Deployment

For the end-to-end operational checklist—from release approval and testnet rehearsal through activation and
handover—follow the [Village deployment runbook](./VILLAGE_DEPLOYMENT_RUNBOOK.md). This document is the detailed
configuration and command reference.

## Configuration

Every deployment starts from a strict schema-1 JSON config. Unknown fields, missing schema versions, invalid
addresses, and profile/module inconsistencies are rejected before the network deployment graph runs.

Example TDF config:

```json
{
  "schemaVersion": 1,
  "villageSlug": "example-village",
  "chainId": 11142220,
  "deploymentProfile": "tdf",
  "finalOwner": {
    "type": "safe",
    "address": "0x1111111111111111111111111111111111111111",
    "expectedOwners": ["0x2222222222222222222222222222222222222222"],
    "expectedThreshold": 1
  },
  "modules": [],
  "apiOperator": "0x3333333333333333333333333333333333333333",
  "communityToken": {
    "name": "Example Community",
    "symbol": "EXAMPLE",
    "initialSupply": "5381000000000000000000",
    "maxSupply": "18600000000000000000000",
    "initialRecipient": "0x5555555555555555555555555555555555555555",
    "apiOperatorCanMint": true
  },
  "citizenNft": {
    "name": "Example Village Citizen",
    "symbol": "EXAMPLE CIT",
    "baseURI": "https://example.invalid/citizens/",
    "operators": ["0x5555555555555555555555555555555555555555"]
  },
  "presenceToken": {
    "name": "Example Presence",
    "symbol": "PRES",
    "decayRatePerDay": "288617"
  },
  "sweatToken": {
    "name": "Example Contribution",
    "symbol": "CONTRIB",
    "decayRatePerDay": "288617"
  },
  "tdfTransferPolicy": {
    "treasury": "0x4444444444444444444444444444444444444444",
    "allowedCounterparties": [],
    "restrictionsEnabled": true
  },
  "dynamicPriceSale": {
    "quoteToken": "0x6666666666666666666666666666666666666666",
    "villageTreasury": "0x7777777777777777777777777777777777777777",
    "closerFeeRecipient": "0x8888888888888888888888888888888888888888",
    "closerFeeBps": 500,
    "saleCap": "15097500000000000000000",
    "minimumPurchase": "1000000000000000000",
    "maximumPurchase": "100000000000000000000",
    "purchaseGranularity": "1000000000000000000",
    "maximumRecipientBalance": "915000000000000000000"
  }
}
```

Use decimal strings for integers that may exceed JavaScript's safe integer range. The selected RPC chain ID must
match `chainId`. `finalOwner` is the only ownership setting. The deployer is inferred from the transaction signer:
it may be the same EOA as the final owner, a temporary EOA handing authority to another EOA, or a temporary EOA
handing authority to a Safe. `expectedOwners` and `expectedThreshold` optionally validate the live Safe before any
deployment transaction is sent.

`token-village`, `tokenized-stays-village`, and `tdf` automatically include `VillageCitizenNFT`;
`minimal-village` remains unchanged. Every deployment that selects CitizenNFT requires a nonempty
`citizenNft.baseURI`. Its default name is the title-cased deployment slug plus `Citizen`, its default symbol is the
deployment slug plus `CIT`, and its operators default to an empty list. Citizen operators come only from
`citizenNft.operators` or explicit `initialRoleGrants`; they are never inferred from `apiOperator`.

A TDF profile requires both treasury recipients and a standard 18-decimal quote token, enables every module, and
deploys `TDFV1BondingCurve` automatically; omit `bondingCurve` in a TDF config. The historical curve retains its
nominal 4,109 TDF mathematical boundary, but TDF deployment requires at least 5,381 TDF. That operating floor is the
lowest historical V1 quote-vector supply and keeps every configured whole-token purchase from 1 through 100 TDF
within the unchanged V1 checked arithmetic. The TDF transfer policy prevents burns below the same floor. TDF uses a
token maximum of 18,600 TDF, sale cap of 15,097.5 TDF, and current recipient-balance limit of 915 TDF. If omitted,
`closerFeeBps` defaults to 500 (5%) for TDF.

For a non-TDF sale, select `dynamicPriceSale` explicitly, supply an already deployed ERC-165 `IBondingCurve` address,
and configure `closerFeeBps` explicitly. The curve's declared quote-token decimals must match the quote token.
CommunityToken `maxSupply` is required whenever that token is selected. It is owner-adjustable after deployment, but
cannot be zero or lower than current total supply; reconciliation treats a value different from config as drift.

## Deployment, configuration, and handoff

Deploy a profile:

```sh
yarn deploy:village -- --config config.json --network celoSepolia
yarn deploy:tdf -- --config config.json --network celoSepolia
```

Deploy one allowlisted contract and its required dependencies:

```sh
yarn deploy:contract -- --contract TDFTransferPolicy --config config.json --network celoSepolia
yarn deploy:contract -- --contract VillageCitizenNFT --config config.json --network celoSepolia
```

Standalone contract deployment requires `deploymentProfile: "minimal-village"` in the input config. The command
rejects profile-locked configurations instead of discarding their validation rules when it selects the requested
contract module and required dependencies.

Canonical manifest paths are:

- `deployments/villages/<chainId>/<villageSlug>.json`
- `deployments/profiles/tdf/<chainId>/<villageSlug>.json`
- `deployments/contracts/<chainId>/<villageSlug>/<contract>.json`

Ignition state is under `ignition/deployments/<deploymentId>/`. For real networks, retain the exact config, source
revision, Ignition journal, manifest, descriptor, and verification output in version control and durable backup.
Localhost and ephemeral Hardhat outputs remain ignored.

There is one ownership workflow:

1. Every contract initializes to the deployer.
2. The deployer executes and verifies all address-dependent setup, including the sale's `MINTER_ROLE`, transfer-policy
   counterparties and restriction flag, and every configured initial role.
3. If the deployer is the final owner, the deployment is immediately complete.
4. Otherwise, the deployer initiates every two-step ownership/default-admin transfer. The manifest becomes
   `pending-handoff`; configuration is already complete and only acceptance remains.

For a different final EOA, run `owner:submit` with that EOA's signer. For a Safe, configure
`SAFE_PROPOSER_PRIVATE_KEY`, run `owner:submit` once to propose one atomic acceptance transaction, and let the Safe
owners execute it through their normal process:

```sh
yarn owner:submit -- --manifest <manifest.json> --network <network>
```

After acceptance, either rerun the original deployment command or perform a one-time reconciliation:

```sh
yarn owner:status -- --manifest <manifest.json> --network <network>
```

No continuous status monitoring is needed. Safe Transaction Service state is optional and advisory; the status command
does not depend on it unless service options are explicitly supplied. Live `owner()`, pending-owner, and
`VillageAccess` default-admin state determine completion. Rerunning the same config resumes the stable Ignition
deployment ID and reconciles live state. Reusing a manifest path with a different config hash fails.

Verification is retryable and never changes whether a successfully reconciled deployment exists:

```sh
yarn verify:village -- --manifest <manifest.json>
```

## Consumer descriptors

When live reconciliation proves that the final owner holds every authority, the deployment tooling automatically
writes one immutable schema-1 descriptor for both API and UI consumers:

- `export/villages/<chainId>/<villageSlug>/<revision>.json`
- `export/profiles/<deploymentProfile>/<chainId>/<villageSlug>/<revision>.json`

`revision` is a deterministic content hash. Reconciliation of the same state reuses the same file and bytes; a
contract upgrade produces a new immutable descriptor instead of rewriting the old one. A `pending-handoff`
deployment does not produce a descriptor.

Each descriptor contains deployment identity, chain and network, normalized modules, `deploymentStart`, proxy/plain
contract addresses, and every contract revision. The initial ABI revision is effective from `deploymentStart`; each
upgrade revision records its exact `Upgraded` event. Revisions also contain ABI hashes and implementation addresses
where applicable. The descriptor deliberately excludes operator-only ownership actions, local paths, code hashes, and
timestamps.

Consumers should pin the reviewed descriptor file and its `revision`; no manual ABI/address export or post-deployment
file editing is required.

## Upgrades

Prepare a validated implementation and owner action:

```sh
yarn upgrade:prepare -- --manifest <manifest.json> --contract CommunityToken \
  --implementation CommunityTokenNext --version release-2026-08 --network celoSepolia \
  --call initializeUpgrade --call-args '[42,false]'
```

The command compares the current and next implementation storage layouts, deploys the candidate through Ignition,
records its runtime code hash and ABI, and prepares `upgradeToAndCall`. Owner submission/status commands accept
`--upgrade <contract>:<version>`. Reconciliation verifies the ERC-1967 slot and the exact `Upgraded` event, appends
the new ABI revision with its activation boundary, and automatically writes the new immutable descriptor. Live proxy
state must reconcile before another candidate can be prepared.

## Deployment schemas

This repository starts with and supports only:

- config schema `1`;
- manifest schema `1`, recording `configSchemaVersion: 1`;
- consumer descriptor schema `1`.

`schemaVersion` is a JSON wire-format discriminator. It is independent of Solidity versions, proxy implementation
revisions, `reinitializer(n)`, and Ignition's journal format. Parsing requires the exact literal `1`; there is no
default, alias, or compatibility code for earlier draft shapes because no deployment used them. Increase a schema
version only when a future breaking JSON field, type, invariant, or meaning requires it.
