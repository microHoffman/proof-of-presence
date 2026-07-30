import path from 'node:path';
import {submitOwnershipHandoff} from '../handoff.js';
import type {SafeProposalOptions} from '../safe-service.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type VillageDeploymentManifest,
} from '../village.js';

export interface OwnerSubmitOptions {
  manifestPath: string;
  safeOptions?: SafeProposalOptions;
}

export interface OwnerSubmitContext {
  ethers: any;
  networkName: string;
}

export async function ownerSubmitCommand(
  options: OwnerSubmitOptions,
  context: OwnerSubmitContext,
): Promise<VillageDeploymentManifest> {
  const manifestPath = path.resolve(options.manifestPath);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const chainId = Number((await context.ethers.provider.getNetwork()).chainId);
  if (chainId !== manifest.chainId) throw new Error(`Manifest chainId ${manifest.chainId} does not match ${chainId}`);

  const updated = await submitOwnershipHandoff(
    manifest,
    {ethers: context.ethers, networkName: context.networkName},
    options.safeOptions,
  );
  await writeVillageDeploymentManifest(manifestPath, updated);
  console.log(updated.status);
  return updated;
}
