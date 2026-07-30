import path from 'node:path';
import {getAddress} from 'ethers';
import {proposeSafeOwnerActions, type SafeProposalOptions} from '../safe-service.js';
import {reconcileExecutedUpgrade} from '../upgrades.js';
import {readUpgradeAuthority} from '../uups-contracts.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type ManifestUpgrade,
  type VillageDeploymentManifest,
} from '../village.js';

export interface UpgradeSubmitOptions {
  manifestPath: string;
  upgrade: string;
  safeOptions?: SafeProposalOptions;
}

export interface UpgradeSubmitContext {
  ethers: any;
  networkName: string;
}

export async function upgradeSubmitCommand(
  options: UpgradeSubmitOptions,
  context: UpgradeSubmitContext,
): Promise<VillageDeploymentManifest> {
  const manifestPath = path.resolve(options.manifestPath);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  await validateConnectedManifest(manifest, context);
  const upgrade = selectUpgrade(manifest, options.upgrade);
  const reconciliation = await reconcileExecutedUpgrade(manifest.contracts, upgrade, context.ethers.provider);
  if (reconciliation.executed) {
    await writeVillageDeploymentManifest(manifestPath, manifest);
    console.log(`Upgrade ${options.upgrade} was already executed and is now reconciled`);
    return manifest;
  }

  if (upgrade.ownerTransaction) {
    if (!options.safeOptions) throw new Error('SAFE_PROPOSER_PRIVATE_KEY is required for a Safe-owned upgrade');
    const proposal = await proposeSafeOwnerActions(manifest.chainId, upgrade.ownerTransaction, options.safeOptions);
    console.log(`Safe transaction ${proposal.status}: ${upgrade.ownerTransaction.safeTxHash}`);
  } else {
    await submitEoaUpgrade(upgrade, manifest, context.ethers);
  }
  await writeVillageDeploymentManifest(manifestPath, manifest);
  console.log(`Upgrade owner action submitted for ${options.upgrade}`);
  return manifest;
}

async function submitEoaUpgrade(
  upgrade: ManifestUpgrade,
  manifest: VillageDeploymentManifest,
  ethers: any,
): Promise<void> {
  const record = manifest.contracts[upgrade.contractName];
  const authority = (await readUpgradeAuthority(upgrade.contractName, record.address, ethers)).current;
  const signers = await ethers.getSigners();
  const signer = signers.find((candidate: {address: string}) => getAddress(candidate.address) === authority);
  if (!signer) throw new Error(`Current upgrade authority ${authority} is not an available Hardhat signer`);
  const transaction = await signer.sendTransaction({to: upgrade.ownerAction.to, data: upgrade.ownerAction.data});
  const receipt = await transaction.wait();
  if (!receipt || Number(receipt.status) !== 1) throw new Error('Upgrade owner action failed');
  const reconciliation = await reconcileExecutedUpgrade(manifest.contracts, upgrade, ethers.provider);
  if (!reconciliation.executed) {
    throw new Error(
      `${upgrade.contractName} upgrade transaction succeeded but the proxy slot still uses ` +
        reconciliation.liveImplementation,
    );
  }
}

function selectUpgrade(manifest: VillageDeploymentManifest, selector: string): ManifestUpgrade {
  const [contractName, version] = selector.split(':');
  const upgrade = manifest.upgrades?.find((item) => item.contractName === contractName && item.version === version);
  if (!upgrade) throw new Error(`Manifest has no upgrade '${selector}'`);
  if (upgrade.status !== 'prepared') throw new Error(`Upgrade '${selector}' is not prepared`);
  return upgrade;
}

async function validateConnectedManifest(
  manifest: VillageDeploymentManifest,
  context: UpgradeSubmitContext,
): Promise<void> {
  if (context.networkName !== manifest.network)
    throw new Error(`Network '${context.networkName}' does not match manifest`);
  const chainId = Number((await context.ethers.provider.getNetwork()).chainId);
  if (chainId !== manifest.chainId) throw new Error(`Connected chain ${chainId} does not match manifest`);
}
