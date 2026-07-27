import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {keccak256, toUtf8Bytes} from 'ethers';
import {canonicalJsonStringify} from './canonical-json.js';
import type {VillageDeploymentManifest} from './village.js';

export interface VillageConsumerDescriptor {
  schemaVersion: 1;
  revision: string;
  deploymentKind: VillageDeploymentManifest['deploymentKind'];
  deploymentProfile: VillageDeploymentManifest['deploymentProfile'];
  villageSlug: string;
  chainId: number;
  network: string;
  configHash: string;
  modules: VillageDeploymentManifest['modules'];
  deploymentStart: VillageDeploymentManifest['deploymentStart'];
  contracts: Record<
    string,
    {
      address: string;
      deploymentName: string;
      revisions: Array<{
        implementationAddress?: string;
        abi: unknown[];
        abiHash: string;
        effectiveFrom: VillageDeploymentManifest['contracts'][string]['revisions'][number]['effectiveFrom'];
      }>;
    }
  >;
  productAliases: Record<string, string>;
}

/** Writes the one immutable integration projection used directly by both API and UI consumers. */
export async function writeConsumerDescriptor(
  manifest: VillageDeploymentManifest,
  outputRoot: string,
): Promise<string> {
  if (manifest.status !== 'complete') {
    throw new Error('Consumer descriptor cannot be generated before ownership handoff is complete');
  }
  const content = {
    schemaVersion: 1 as const,
    deploymentKind: manifest.deploymentKind,
    deploymentProfile: manifest.deploymentProfile,
    villageSlug: manifest.villageSlug,
    chainId: manifest.chainId,
    network: manifest.network,
    configHash: manifest.configHash,
    modules: manifest.modules,
    deploymentStart: manifest.deploymentStart,
    contracts: Object.fromEntries(
      Object.entries(manifest.contracts).map(([name, contract]) => [
        name,
        {
          address: contract.address,
          deploymentName: contract.deploymentName,
          revisions: contract.revisions.map((revision) => ({
            implementationAddress: revision.implementationAddress,
            abi: revision.abi,
            abiHash: revision.abiHash,
            effectiveFrom: revision.effectiveFrom,
          })),
        },
      ]),
    ),
    productAliases: manifest.productAliases ?? {},
  };
  const revision = keccak256(toUtf8Bytes(canonicalJsonStringify(content)));
  const descriptor: VillageConsumerDescriptor = {...content, revision};
  const exportPath = path.join(
    outputRoot,
    'export',
    manifest.deploymentKind === 'profile' ? 'profiles' : 'villages',
    ...(manifest.deploymentKind === 'profile' ? [manifest.deploymentProfile] : []),
    String(manifest.chainId),
    manifest.villageSlug,
    `${revision}.json`,
  );
  const serialized = `${JSON.stringify(descriptor, null, 2)}\n`;

  try {
    const existing = await readFile(exportPath, 'utf8');
    if (existing !== serialized) throw new Error(`Consumer descriptor hash collision at ${exportPath}`);
    return exportPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await mkdir(path.dirname(exportPath), {recursive: true});
  const temporaryPath = `${exportPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, serialized);
  await rename(temporaryPath, exportPath);
  return exportPath;
}

export function outputRootForManifest(manifestPath: string): string {
  const absolute = path.resolve(manifestPath);
  const parts = absolute.split(path.sep);
  const deploymentsIndex = parts.lastIndexOf('deployments');
  if (deploymentsIndex < 1) throw new Error(`Manifest path is outside a deployments directory: ${absolute}`);
  return parts.slice(0, deploymentsIndex).join(path.sep) || path.sep;
}
