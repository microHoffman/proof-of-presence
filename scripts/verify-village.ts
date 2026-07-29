#!/usr/bin/env tsx
import path from 'node:path';
import {readVillageDeploymentManifest} from './deployment/village.js';
import {recordIgnitionVerification, verifyIgnitionDeployment} from './deployment/verification.js';

function manifestArgument(argv: string[]): string | undefined {
  if (argv.includes('--help') || argv.includes('-h')) return undefined;
  let manifest: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument !== '--manifest') throw new Error(`Unknown argument '${argument}'`);
    if (manifest !== undefined) throw new Error('--manifest may only be provided once');
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error('--manifest requires a path');
    manifest = value;
  }
  return manifest;
}

async function main(): Promise<void> {
  const argument = manifestArgument(process.argv.slice(2));
  if (!argument) {
    console.log('Usage: tsx scripts/verify-village.ts --manifest <manifest.json>');
    if (!process.argv.includes('--help') && !process.argv.includes('-h')) throw new Error('--manifest is required');
    return;
  }
  const manifestPath = path.resolve(argument);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const attempt = await verifyIgnitionDeployment(manifest.network, manifest.deploymentTool.deploymentId);
  await recordIgnitionVerification(manifestPath, attempt);
  console.log(`Ignition verification ${attempt.status} for ${manifest.deploymentTool.deploymentId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
