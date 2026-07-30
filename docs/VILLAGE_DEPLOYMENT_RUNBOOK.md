# Village deployment runbook

Use [Deployment](./DEPLOYMENT.md) for schema and command details.

## Before deployment

1. Review the source revision and run the full repository checks.
2. Choose a unique, immutable lowercase village slug for the target chain.
3. For a generic village, list only the contracts the village actually needs. Review the dependencies printed by the
   CLI. For TDF, use the dedicated preset input and do not duplicate locked launch constants.
4. Confirm chain ID, API operator, treasury/recipient addresses, token parameters, and final owner.
5. For a Safe owner, verify deployed Safe code, owners, and threshold. Keep deployer and Safe proposer credentials
   separate.
6. Retain the reviewed config as an immutable release record. Back it up and commit it together with the resulting
   real-network Ignition deployment directory and operational manifest.

## Testnet rehearsal

Run the same command, resolved config, ownership route, verification, and optional upgrade flow on Celo Sepolia:

```sh
yarn deploy:village -- --config <config.json> --network celoSepolia
# or
yarn deploy:tdf -- --config <tdf.json> --network celoSepolia
```

Review the printed requested/auto-added/resolved contract sets before transactions. A rerun with the same slug and
resolved spec must reconcile the same addresses. A changed resolved spec under the same chain/slug must fail with a
manifest collision.

## Production deployment

1. Run the appropriate deploy command on `celo`.
2. Inspect `deployments/villages/<chainId>/<slug>.json` and `ignition/deployments/<deployment-id>/`.
3. If ownership is pending, submit or propose it and later reconcile:

```sh
yarn owner:submit -- --manifest <manifest.json> --network celo
yarn owner:status -- --manifest <manifest.json> --network celo
```

4. Require manifest status `complete`, an empty `pendingOwnerActions`, correct live owners/default admin, expected role
   grants and wiring, nonempty bytecode, matching code hashes, and matching ERC-1967 slots.
5. Verify with the explicit Ignition command printed by deployment:

```sh
yarn hardhat --network celo ignition verify <deployment-id>
```

Verification failure does not justify redeployment. Retry the built-in command after resolving explorer/provider
availability.

## Recovery

- If the process stops during deployment, rerun the same command with the same config, network, slug, and Ignition
  directory.
- If Ignition finished but the manifest was not written, rerun; the journal resumes without new deployments.
- A fresh recovery environment needs the reviewed immutable config as well as the Ignition directory and any existing
  manifest. The manifest's config hash cannot reconstruct deployment parameters.
- If the manifest exists and the config hash differs, stop. Choose a new slug only for an intentionally new
  deployment.
- Treat on-chain authority, proxy slots, bytecode, and events as authoritative. Safe Transaction Service state is
  advisory.

## Upgrade

Prepare, submit, and reconcile as three explicit steps:

```sh
yarn upgrade:prepare -- --manifest <manifest.json> --contract <name> \
  --implementation <artifact> --version <version> --network celo
yarn upgrade:submit -- --manifest <manifest.json> --upgrade <name>:<version> --network celo
yarn upgrade:status -- --manifest <manifest.json> --upgrade <name>:<version> --network celo
```

Commit the updated manifest and the upgrade Ignition directory after review.
