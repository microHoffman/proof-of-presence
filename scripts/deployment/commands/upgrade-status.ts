import path from 'node:path';
import {refreshSafeOwnerActionsStatus} from '../safe-service.js';
import {reconcileExecutedUpgrade} from '../upgrades.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type ManifestUpgrade,
  type VillageDeploymentManifest,
} from '../village.js';

export interface UpgradeStatusOptions {
  manifestPath: string;
  upgrade: string;
  apiKey?: string;
  txServiceUrl?: string;
}

export interface UpgradeStatusContext {
  ethers: any;
  networkName: string;
}

export async function upgradeStatusCommand(
  options: UpgradeStatusOptions,
  context: UpgradeStatusContext,
): Promise<VillageDeploymentManifest> {
  const manifestPath = path.resolve(options.manifestPath);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  if (context.networkName !== manifest.network)
    throw new Error(`Network '${context.networkName}' does not match manifest`);
  const chainId = Number((await context.ethers.provider.getNetwork()).chainId);
  if (chainId !== manifest.chainId) throw new Error(`Connected chain ${chainId} does not match manifest`);

  const upgrade = selectUpgrade(manifest, options.upgrade);
  const reconciliation = await reconcileExecutedUpgrade(manifest.contracts, upgrade, context.ethers.provider);
  if (upgrade.ownerTransaction && (options.apiKey || options.txServiceUrl)) {
    const service = await refreshSafeOwnerActionsStatus(manifest.chainId, upgrade.ownerTransaction, {
      apiKey: options.apiKey,
      txServiceUrl: options.txServiceUrl,
    });
    console.log(`Safe transaction ${service.status}: ${upgrade.ownerTransaction.safeTxHash}`);
    if (service.status === 'executed' && !reconciliation.executed) {
      throw new Error(
        `Safe service reports ${upgrade.contractName} upgrade executed but the proxy slot still uses ` +
          reconciliation.liveImplementation,
      );
    }
  }
  await writeVillageDeploymentManifest(manifestPath, manifest);
  console.log(`${upgrade.status}: ${reconciliation.liveImplementation}`);
  return manifest;
}

function selectUpgrade(manifest: VillageDeploymentManifest, selector: string): ManifestUpgrade {
  const [contractName, version] = selector.split(':');
  const upgrade = manifest.upgrades?.find((item) => item.contractName === contractName && item.version === version);
  if (!upgrade) throw new Error(`Manifest has no upgrade '${selector}'`);
  return upgrade;
}
