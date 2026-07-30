# Remaining work

Last reconciled: 2026-07-29

The contract and deployment implementation is complete for the current architecture. Remaining items are
live-network rehearsal, independent review, concrete consumer integration, product decisions, and rollout.

## Contract repository

- Rehearse built-in Ignition verification on Celo Sepolia, including proxy/implementation presentation and
  provider-specific failures.
- Rehearse EOA-to-Safe ownership handoff and a Safe-owned UUPS upgrade using the separate prepare, submit, and status
  commands.
- Prove a fresh operator environment can restore the reviewed config, Ignition directory, and any existing manifest
  and resume without redeployment.
- Run the standard release suite plus manual deep fuzz/invariant, coverage, Aderyn, Wake, and targeted mutation
  suites against the release candidate.
- Triage static-analysis and dependency findings, freeze an audit revision, and obtain an independent audit.

## Consumer integration

No API/UI descriptor is generated today. When a concrete consumer release exists:

- define the smallest versioned projection it needs from committed manifests and Hardhat/Ignition artifacts;
- decide whether historical ABI revisions are actually required for indexing;
- verify chain, deployed code, critical wiring, roles, pause state, and proxy implementations at activation;
- keep transaction retry/finality/reorg handling and application workflow state outside the deployment manifest.

## Product and rollout

- Decide whether the UI ever offers persistent token approval; prefer permit-first or exact approvals.
- Integrate CitizenNFT and DynamicPriceSale only when their product flows are ready.
- Separate and rotate deployer, Safe proposer, and API operator secrets; bound gas funding.
- Operate one audited pilot village with explicit success and error-budget criteria before broader rollout.
