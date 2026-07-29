# Architecture

## Source boundaries

The repository has two production source areas:

- `src/village` contains reusable village contracts.
- `src/profiles/tdf` contains the TDF transfer policy and historical V1-compatible pricing curve.

`src/village/test` contains test-only proxy, Safe, policy, and upgrade implementations. It is excluded from
production security coverage. There is no separate historical source or deployment engine in this branch.

## Contract model

`VillageAccess` is the shared role authority. It uses enumerable access control and delayed default-admin transfer.
The operational roles are:

- `MINTER_ROLE` for CommunityToken mint/burn operations.
- `BOOKING_MANAGER_ROLE` for managed TokenizedStays cancellation.
- `BOOKING_PLATFORM_ROLE` for Presence/Sweat issuance.
- `CITIZEN_OPERATOR_ROLE` for citizenship issuance, operator burn, and lost-wallet recovery.

`CommunityToken` is an ERC-20/ERC-2612 token with pausing, role-based mint/burn, an owner-adjustable maximum supply,
and a replaceable `ITransferPolicy`. A zero policy explicitly disables policy checks. Every mint path enforces
`maxSupply`; the owner may raise it or lower it no further than the current total supply.

`DynamicPriceSale` is an optional buy-only CommunityToken issuer. The caller always pays the quote token and may
choose another recipient. Pricing is delegated to an ERC-165 `IBondingCurve`, and both quotes and purchases use the
CommunityToken's live `totalSupply()`. External mints and burns therefore move the price and remaining capacity by
design; the TDF policy only prevents burns that would leave the V1 sale outside its safe operating supply. A purchase
splits the curve-calculated total payment between the village treasury and Closer; the fee is included in the curve
cost rather than added on top. Fixed launch limits live in proxy storage, while the village owner may replace the
curve, treasury, and atomic fee configuration, pause purchases, or upgrade the sale.

`VillagePresenceToken` and `VillageSweatToken` are non-transferable decaying tokens over the same implementation
base. Their readable balances decay with time while mint/burn accounting and holder checkpoints preserve provenance.

`TokenizedStays` holds CommunityToken deposits and records calendar-day entitlements with a price for each date. It
enforces a fixed 365-day lock window, Gregorian date validity, a bounded booking horizon, pause controls, and
role-authorized managed cancellation. `previewCreateBookings` reports the account's current credited deposit, locked
requirements before and after a proposed batch, and the exact resulting deficit. The allowance path pulls that live
deficit; the permit path signs that same amount. A permit already submitted by a relayer remains usable only when its
resulting allowance covers the live deficit; other failed or stale permits revert atomically. Off-chain booking
workflow state such as confirmation or check-in does not live in this contract.

`VillageCitizenNFT` is a UUPS-upgradeable ERC-721 citizenship credential with Metadata, Enumerable, ERC-5192, and
ERC-4906 support. Credentials are permanently non-transferable and expose no approval path. Suspension and revocation
burn the active token; lost-wallet recovery atomically burns and reissues to a different wallet. Token IDs and opaque
subject references are permanently single-use, while a wallet may receive a fresh credential after burning. Current
holder discovery uses ERC-721 Enumerable; events remain the historical record.

`TDFTransferPolicy` is a replaceable, non-upgradeable policy. While restricted, ordinary transfers must involve the
treasury or an allowed counterparty. Minting remains allowed, while burns must leave at least 5,381 TDF in supply.
That burn floor remains active even when ordinary transfer restrictions are disabled. The policy is deployed
restricted so setup fails closed.

`TDFV1BondingCurve` is stateless, ownerless, and non-upgradeable. Its name records that the implementation preserves
the historical V1 formula, units, evaluation order, and cent rounding. Its 4,109–200,000 TDF domain is a mathematical
input boundary, not the TDF token maximum or sale cap. TDF launches instead use a 5,381 TDF operating floor: it is the
lowest historical V1 quote-vector supply and safely supports the full configured 1–100 TDF purchase range with the
unchanged V1 checked arithmetic. The initial V2 TDF token maximum is 18,600 TDF and the primary sale cap is
15,097.5 TDF.

## Upgrade and storage model

`VillageAccess`, `CommunityToken`, `VillageCitizenNFT`, the decaying tokens, `TokenizedStays`, and `DynamicPriceSale`
use UUPS proxies.
Ignition deploys an implementation and `VillageUUPSProxy` with initializer calldata in the proxy constructor,
eliminating an externally initializable proxy window.

Production implementations:

- disable direct initialization in their constructors;
- authorize upgrades through the contract's owner or default admin;
- keep custom state in ERC-7201 namespaced storage;
- use OpenZeppelin's stateless UUPS and Initializable bases from Contracts 5.6;
- are validated by the OpenZeppelin Hardhat Upgrades plugin before deployment and upgrade preparation.

`TokenizedStays` and `VillageCitizenNFT` use `ReentrancyGuardTransient`, so Cancun support is part of the build
boundary. Upgrade tests use
generation-neutral `*UpgradeMock` implementations. A test reinitializer may use numeric revision `2`; that number is
an initializer revision and is unrelated to product or deployment schemas.

## Deployment architecture

Contract Ignition modules are composed into stable profile modules. Supported profiles are:

- `minimal-village`: VillageAccess only unless extra modules are selected.
- `token-village`: VillageAccess, CommunityToken, and VillageCitizenNFT.
- `tokenized-stays-village`: VillageAccess, CommunityToken, VillageCitizenNFT, and TokenizedStays.
- `tdf`: all village modules plus TDFTransferPolicy, DynamicPriceSale, and a new TDFV1BondingCurve.

Other valid module combinations use `CustomVillageModule_v2_` followed by a fixed seven-bit mask in this stable order:
CommunityToken, VillagePresenceToken, VillageSweatToken, TokenizedStays, TDFTransferPolicy, VillageCitizenNFT, and
DynamicPriceSale. The same contract modules are reused by standalone contract deployment and profiles. Named-profile
module IDs remain unchanged.

Hardhat Ignition is the sole transaction journal and resumption engine. The deployment wrapper adds config
validation, OpenZeppelin validation, ownership handoff, on-chain reconciliation, verification, atomic manifest
publication, and immutable consumer-descriptor generation. It never replaces Ignition's journal.

## Authority model

There is one deployment path. Every contract is initialized to the transaction-sending deployer. The deployer performs
all address-dependent configuration, including role grants and transfer-policy wiring, verifies the result, and only
then initiates two-step ownership/default-admin transfers to `finalOwner`.

When an EOA deployer is also the final owner, no handoff is required and deployment completes immediately. A different
EOA accepts the pending authorities directly; a Safe accepts them in one prepared atomic transaction. Safe Transaction
Service state is advisory and no polling loop is required: a one-time reconciliation reads the contracts themselves,
which are the completion authority. The API operator receives only configured operational roles and has no upgrade
authority. It is never implicitly made a Citizen operator.

## Build boundary

All contracts compile with Solidity 0.8.35, optimizer runs 2000, and the Cancun EVM target. OpenZeppelin Contracts and
Contracts Upgradeable are both pinned to 5.6.1. There are no compiler overrides or older OpenZeppelin aliases in the
current branch.
