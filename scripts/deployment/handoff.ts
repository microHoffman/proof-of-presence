import {getAddress} from 'ethers';
import {
  prepareSafeOwnerActions,
  proposeSafeOwnerActions,
  refreshSafeOwnerActionsStatus,
  type SafeProposalOptions,
  type SafeServiceOptions,
} from './safe-service.js';
import {
  pendingOwnershipHandoffActions,
  reconcileOwnershipHandoff,
  type VillageDeploymentContext,
  type VillageDeploymentManifest,
} from './village.js';

/** Submits only final ownership/default-admin acceptances; deployment configuration is already complete. */
export async function submitOwnershipHandoff(
  manifest: VillageDeploymentManifest,
  context: VillageDeploymentContext,
  safeOptions?: SafeProposalOptions,
): Promise<VillageDeploymentManifest> {
  const reconciled = await reconcileOwnershipHandoff(manifest, context);
  if (reconciled.status === 'complete') return reconciled;
  const actions = await pendingOwnershipHandoffActions(reconciled, context);
  const owner = reconciled.ownership.finalOwner;

  if (owner.type === 'safe') {
    if (!safeOptions) throw new Error('Safe proposal options are required for a Safe handoff');
    const prepare = context.prepareSafeTransaction ?? prepareSafeOwnerActions;
    const prepared = reconciled.handoffTransaction ?? (await prepare(owner, actions, safeOptions.provider));
    if (!prepared) throw new Error('Deployment has no pending ownership handoff actions');
    const propose = context.proposeSafeTransaction ?? proposeSafeOwnerActions;
    return {
      ...reconciled,
      handoffTransaction: await propose(reconciled.chainId, prepared, safeOptions),
    };
  }

  const ownerAddress = getAddress(owner.address);
  const signers = await context.ethers.getSigners();
  const signer = signers.find((candidate: {address: string}) => getAddress(candidate.address) === ownerAddress);
  if (!signer) throw new Error(`Final EOA owner ${ownerAddress} is not available among configured Hardhat signers`);

  const currentTimestamp = Number((await context.ethers.provider.getBlock('latest')).timestamp);
  const delayed = actions.find(
    (action) => action.acceptAfter && Date.parse(action.acceptAfter) / 1000 > currentTimestamp,
  );
  if (delayed) {
    throw new Error(`${delayed.contractName} ownership cannot be accepted before ${delayed.acceptAfter}`);
  }
  for (const action of actions) {
    const transaction = await signer.sendTransaction({to: action.to, data: action.data});
    const receipt = await transaction.wait();
    if (!receipt || Number(receipt.status) !== 1) {
      throw new Error(`${action.contractName}.${action.functionName} failed`);
    }
  }
  return reconcileOwnershipHandoff(reconciled, context);
}

/** Refreshes optional Safe service metadata, then derives handoff completion from live contract authority. */
export async function refreshOwnershipHandoff(
  manifest: VillageDeploymentManifest,
  context: VillageDeploymentContext,
  safeOptions?: SafeServiceOptions,
): Promise<VillageDeploymentManifest> {
  let refreshed = manifest;
  if (manifest.handoffTransaction && safeOptions) {
    refreshed = {
      ...manifest,
      handoffTransaction: await refreshSafeOwnerActionsStatus(
        manifest.chainId,
        manifest.handoffTransaction,
        safeOptions,
      ),
    };
  }
  return reconcileOwnershipHandoff(refreshed, context);
}
