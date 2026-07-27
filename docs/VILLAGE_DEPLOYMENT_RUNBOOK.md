# Village deployment runbook

Use this runbook to deploy one independent contract suite for one village. Repeat it for every additional village.
For all configuration fields and contract-specific rules, use the detailed [Deployment reference](./DEPLOYMENT.md).

> **Production gate:** an independent audit, live Celo Sepolia rehearsals, recovery testing, and an audited pilot are
> still tracked in [Remaining work](./REMAINING_WORK.md). Completing this runbook does not replace those approvals.

## Deployment flow

```text
approve source and schema-1 config
        ↓
rehearse on Celo Sepolia
        ↓
deploy and fully configure from an EOA
        ↓
accept ownership only when final owner differs
        ↓
reconcile live authority and verify
        ↓
activate the automatically generated descriptor
        ↓
archive the deployment record
```

The tooling creates four records:

| Record              | Purpose                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Config              | Reviewed intent for one village, chain, final owner, profile, and module parameters              |
| Ignition journal    | Transaction history used to resume the deployment safely                                         |
| Manifest            | Operator record for addresses, authority, roles, verification, revisions, and pending handoff    |
| Consumer descriptor | Immutable addresses, ABI revisions, and indexing boundaries consumed directly by both API and UI |

## 1. Assign people and addresses

Record:

- **Deployment operator:** controls the funded EOA supplied as `PRIVATE_KEY`.
- **Final owner:** either that same EOA, a different EOA, or preferably a reviewed village Safe for production.
- **Safe proposer:** a Safe owner who can propose the acceptance transaction when the final owner is a Safe.
- **API operator:** receives only configured operational roles and never upgrade authority.
- **Treasuries and recipients:** all recipients required by the selected modules.
- **Release approver:** approves the source revision, config, rehearsal evidence, and production activation.

Using the deployer itself as `finalOwner` is supported and useful for prototypes. A different final owner adds only the
two-step acceptance phase; all roles, counterparties, sale permissions, and policy settings are configured before the
handoff begins.

Never put a private key in the deployment config, commit it, or accept it through a browser or HTTP request.

## 2. Approve the release revision

Use a clean immutable source revision and run:

```sh
mise install
mise run setup
mise run check
```

Provide secrets through an operator secret manager or protected CI environment:

| Variable                    | When needed                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `PRIVATE_KEY`               | Deployment; later acceptance when the final owner is a different EOA |
| `SOURCE_REVISION`           | Recommended outside CI so the approved commit is recorded            |
| `GITHUB_SHA`                | CI alternative to `SOURCE_REVISION`                                  |
| `CELOSCAN_API_KEY`          | Celoscan verification                                                |
| `SAFE_PROPOSER_PRIVATE_KEY` | Proposing the Safe's atomic ownership/default-admin acceptance       |
| `SAFE_API_KEY`              | Only when required by the configured Safe Transaction Service        |
| `SAFE_TX_SERVICE_URL`       | Only when using a non-default Safe Transaction Service               |

Confirm that the deployer EOA has enough native currency for the full deployment and retry. Supported production
network names are `celoSepolia` (`11142220`) and `celo` (`42220`).

## 3. Choose the profile

| Profile                   | Contracts selected automatically                                      |
| ------------------------- | --------------------------------------------------------------------- |
| `minimal-village`         | `VillageAccess`; add only explicitly required modules                 |
| `token-village`           | `VillageAccess`, `CommunityToken`, and `VillageCitizenNFT`            |
| `tokenized-stays-village` | Token village plus `TokenizedStays`                                   |
| `tdf`                     | All village modules plus TDF transfer policy, sale, and bonding curve |

The `modules` array may add supported modules to a non-TDF profile. Do not select modules speculatively: every
contract adds integration and upgrade responsibility. Profile and config are part of deployment identity; do not
edit the original config after deployment and pretend it is the same deployment.

## 4. Create and review the config

Use schema version 1. This is a minimal tokenized-stays example:

```json
{
  "schemaVersion": 1,
  "villageSlug": "example-village",
  "chainId": 11142220,
  "deploymentProfile": "tokenized-stays-village",
  "finalOwner": {
    "type": "safe",
    "address": "0x1111111111111111111111111111111111111111",
    "expectedOwners": ["0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"],
    "expectedThreshold": 2
  },
  "modules": [],
  "apiOperator": "0x4444444444444444444444444444444444444444",
  "communityToken": {
    "name": "Example Community",
    "symbol": "EXAMPLE",
    "initialSupply": "0",
    "maxSupply": "1000000000000000000000000",
    "apiOperatorCanMint": true
  },
  "citizenNft": {
    "name": "Example Village Citizen",
    "symbol": "EXAMPLE CIT",
    "baseURI": "https://example.invalid/citizens/",
    "operators": []
  }
}
```

For a prototype owned by the deployer, use:

```json
"finalOwner": {
  "type": "eoa",
  "address": "<deployer address>"
}
```

Two people should review the production config and confirm:

- slug, chain, profile, and modules match the approved village;
- final-owner address and, for a Safe, expected owners and threshold match live state;
- API/Citizen operators, minters, treasuries, and recipients are distinct where intended;
- all amounts are base-unit decimal strings and have been checked independently;
- Citizen metadata hosting is ready;
- quote token, curve, sale limits, fee, counterparties, and transfer policy are correct where selected;
- the config contains no secrets and is retained as an immutable release record.

## 5. Rehearse on Celo Sepolia

Deploy the same profile and ownership shape that production will use:

```sh
yarn deploy:village -- --config <sepolia-config.json> --network celoSepolia
```

For TDF:

```sh
yarn deploy:tdf -- --config <sepolia-config.json> --network celoSepolia
```

Complete the handoff, verification, descriptor activation, and downstream smoke tests below. The rehearsal succeeds
when:

- the manifest reaches `status: "complete"` and a descriptor is written;
- every expected proxy, implementation, role, treasury, policy, and module link matches config;
- explorer verification succeeds;
- API and UI can activate the descriptor on the correct chain;
- required read and operator workflows work; and
- a restored Ignition journal/manifest reconciles without redeployment.

## 6. Deploy production

```sh
yarn deploy:village -- --config <production-config.json> --network celo
# or
yarn deploy:tdf -- --config <production-config.json> --network celo
```

Bare `yarn deploy` never deploys. Expected operator records are:

```text
deployments/villages/<chainId>/<villageSlug>.json
deployments/profiles/tdf/<chainId>/<villageSlug>.json
ignition/deployments/village-<chainId>-<villageSlug>-<deploymentProfile>/
```

The runner initializes every authority to the deployer, performs and verifies all configuration, then either completes
immediately when the deployer is the final owner or initiates the two-step handoff. If interrupted, rerun the exact
same command, config, and source revision. Ignition resumes its stable journal. Never change the slug or deployment ID
to bypass an interrupted run.

## 7. Complete an optional handoff

Read the generated manifest.

- `status: "complete"` means the final owner already holds every authority. No handoff action is needed.
- `status: "pending-handoff"` means configuration is complete and only ownership/default-admin acceptance remains.

For a different final EOA, configure its key as `PRIVATE_KEY` and run:

```sh
yarn owner:submit -- --manifest <manifest.json> --network <network>
```

For a Safe, configure `SAFE_PROPOSER_PRIVATE_KEY` and run the same command. It proposes one atomic transaction
containing all acceptance calls; it never executes it. Safe owners review and execute it through their normal Safe
process.

After EOA or Safe acceptance, reconcile once:

```sh
yarn owner:status -- --manifest <manifest.json> --network <network>
```

Alternatively rerun the original deployment command. No polling loop is required. Safe service status is informative;
live contract authorities determine completion. Respect any `acceptAfter` timestamp recorded for delayed default-admin
acceptance.

## 8. Verify and locate the descriptor

Verification is attempted automatically. If an explorer was unavailable, retry:

```sh
yarn verify:village -- --manifest <manifest.json>
```

Verification failure does not erase a correctly deployed/reconciled graph.

Once the manifest is complete, the tooling automatically writes:

```text
export/villages/<chainId>/<villageSlug>/<revision>.json
export/profiles/<profile>/<chainId>/<villageSlug>/<revision>.json
```

There is no export command and nothing to update manually. Review the descriptor's `revision`, chain, slug, profile,
contract set, proxy addresses, revision ABIs, and activation boundaries. Re-running reconciliation for unchanged state
returns the same path and bytes.

## 9. Activate the village

Before enabling API/UI writes:

- the manifest is `complete` and the reviewed immutable descriptor exists;
- live roles, authorities, implementations, links, treasuries, and policy/sale configuration reconcile;
- verification succeeded or has an explicitly approved exception;
- API and UI pin the exact descriptor file and `revision` and reject other chain IDs;
- the API operator has only intended roles and enough native currency;
- event indexing starts from `deploymentStart` and uses all ABI revision boundaries;
- finality/reorg handling and one controlled production smoke test pass.

Activation is an explicit product action. Descriptor generation is a correctness gate, not automatic product
activation.

## 10. Archive and recover

Store together in version control and durable backup:

- approved config and source revision;
- Ignition directory and logs;
- deployment manifest and immutable descriptor revision(s);
- verification output;
- Safe transaction hash or EOA acceptance receipts where applicable;
- rehearsal, production approval, activation, and smoke-test evidence.

Do not delete the Ignition journal after publication; it remains the interruption-recovery and operational-evidence
record.

| Situation                                                 | Action                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Deployment command was interrupted                        | Restore the journal if needed and rerun the exact config/command               |
| Journal exists but manifest is missing                    | Rerun the exact config; the wrapper rebuilds it from reconciled state          |
| Manifest reports a config collision                       | Recover the approved config; never edit the manifest to bypass it              |
| Safe handoff is pending                                   | Execute the prepared Safe transaction, then reconcile once; do not redeploy    |
| Verification failed                                       | Retry `verify:village`; do not create another deployment                       |
| Code, proxy, role, authority, or wiring drift is reported | Stop activation and investigate live state and records                         |
| Journal is lost                                           | Restore it from backup; do not invent a new deployment ID for the same village |

For another village, repeat with a new `villageSlug`. Each village has independent proxies, authority, journal,
manifest, descriptor, and upgrade history. Future upgrades use
[Deployment: Upgrades](./DEPLOYMENT.md#upgrades); each reconciled upgrade creates a new immutable descriptor revision.
