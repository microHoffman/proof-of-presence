import {mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect} from 'chai';
import hre from 'hardhat';
import {upgrades as createUpgradesApi} from '@openzeppelin/hardhat-upgrades';
import {connection, ethers} from '../hardhat.js';
import {ownerStatusCommand} from '../../scripts/deployment/commands/owner-status.js';
import {ownerSubmitCommand} from '../../scripts/deployment/commands/owner-submit.js';
import {prepareUpgradeCommand} from '../../scripts/deployment/commands/prepare-upgrade.js';
import {
  deployVillage,
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type VillageDeploymentConfig,
} from '../../scripts/deployment/village.js';

const upgradesApi = await createUpgradesApi(hre, connection);

function upgradeContext() {
  return {
    ethers,
    upgrades: upgradesApi,
    ignition: connection.ignition,
    provider: connection.provider,
    networkName: 'default',
  };
}

async function deployAccess(slug: string) {
  const [owner, apiOperator] = await ethers.getSigners();
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'village-command-'));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const config: VillageDeploymentConfig = {
    schemaVersion: 1,
    villageSlug: slug,
    chainId,
    deploymentProfile: 'minimal-village',
    finalOwner: {type: 'eoa', address: owner.address},
    modules: [],
    apiOperator: apiOperator.address,
  };
  const result = await deployVillage(config, {
    ethers,
    upgrades: upgradesApi,
    ignition: connection.ignition,
    networkName: 'default',
    outputRoot,
  });
  return {...result, owner};
}

async function deployCitizenNft(slug: string) {
  const [owner, apiOperator] = await ethers.getSigners();
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'village-command-'));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const config: VillageDeploymentConfig = {
    schemaVersion: 1,
    villageSlug: slug,
    chainId,
    deploymentProfile: 'minimal-village',
    finalOwner: {type: 'eoa', address: owner.address},
    modules: ['citizenNft'],
    apiOperator: apiOperator.address,
    citizenNft: {baseURI: 'https://citizen.example/metadata/'},
  };
  const result = await deployVillage(config, {
    ethers,
    upgrades: upgradesApi,
    ignition: connection.ignition,
    networkName: 'default',
    outputRoot,
  });
  return {...result, owner};
}

async function deployAccessForHandoff(slug: string) {
  const [, finalOwner, apiOperator] = await ethers.getSigners();
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'village-command-'));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const config: VillageDeploymentConfig = {
    schemaVersion: 1,
    villageSlug: slug,
    chainId,
    deploymentProfile: 'minimal-village',
    finalOwner: {type: 'eoa', address: finalOwner.address},
    modules: [],
    apiOperator: apiOperator.address,
  };
  const result = await deployVillage(config, {
    ethers,
    upgrades: upgradesApi,
    ignition: connection.ignition,
    networkName: 'default',
    outputRoot,
  });
  return {...result, outputRoot, chainId};
}

async function prepare(manifestPath: string, version: string) {
  return prepareUpgradeCommand(
    {
      manifestPath,
      contractName: 'VillageAccess',
      implementation: 'VillageAccessUpgradeMock',
      version,
    },
    upgradeContext(),
  );
}

describe('Deployment commands', function () {
  it('writes the consumer descriptor when an EOA handoff completes', async function () {
    const {manifestPath, outputRoot, chainId} = await deployAccessForHandoff('command-complete-handoff');
    const completed = await ownerSubmitCommand({manifestPath}, {ethers, networkName: 'default'});

    expect(completed.status).to.equal('complete');
    const descriptorDirectory = path.join(
      outputRoot,
      'export',
      'villages',
      String(chainId),
      'command-complete-handoff',
    );
    const descriptorFiles = await readdir(descriptorDirectory);
    expect(descriptorFiles).to.have.length(1);
    const descriptor = JSON.parse(await readFile(path.join(descriptorDirectory, descriptorFiles[0]), 'utf8'));
    expect(descriptor.schemaVersion).to.equal(1);
    expect(descriptor.revision).to.match(/^0x[0-9a-f]{64}$/);
  });

  it('prepares an upgrade with its implementation code hash', async function () {
    const {manifestPath} = await deployAccess('command-prepare-upgrade');
    const manifest = await prepare(manifestPath, 'prepared-test');

    expect(manifest.upgradeHistory).to.have.length(1);
    expect(manifest.upgradeHistory![0]).to.include({
      contractName: 'VillageAccess',
      version: 'prepared-test',
      status: 'prepared',
    });
    expect(manifest.upgradeHistory![0].implementationCodeHash).to.match(/^0x[0-9a-f]{64}$/);
    expect(manifest.upgradeHistory![0].candidateAbi).to.be.an('array').and.not.empty;
    expect(manifest.upgradeHistory![0].candidateAbiHash).to.match(/^0x[0-9a-f]{64}$/);
    expect(manifest.upgradeHistory![0].preparedAtBlock.blockNumber).to.match(/^\d+$/);
  });

  it('prepares and submits a VillageCitizenNFT upgrade through the canonical UUPS registry', async function () {
    const {manifestPath} = await deployCitizenNft('command-prepare-citizen-upgrade');
    const prepared = await prepareUpgradeCommand(
      {
        manifestPath,
        contractName: 'VillageCitizenNFT',
        implementation: 'VillageCitizenNFTUpgradeMock',
        version: 'citizen-prepared-test',
      },
      upgradeContext(),
    );

    expect(prepared.upgradeHistory).to.have.length(1);
    expect(prepared.upgradeHistory![0]).to.include({
      contractName: 'VillageCitizenNFT',
      nextArtifact: 'VillageCitizenNFTUpgradeMock',
      status: 'prepared',
    });

    const executed = await ownerSubmitCommand(
      {manifestPath, upgrade: 'VillageCitizenNFT:citizen-prepared-test'},
      {ethers, networkName: 'default'},
    );
    expect(executed.upgradeHistory![0].status).to.equal('executed');
    expect(executed.contracts.VillageCitizenNFT.revisions.at(-1)!.implementationAddress).to.equal(
      executed.upgradeHistory![0].newImplementation,
    );
    expect(executed.contracts.VillageCitizenNFT.revisions).to.have.length(2);
    expect(executed.upgradeHistory![0].executedAt?.transactionHash).to.match(/^0x[0-9a-f]{64}$/);
  });

  it('rejects owner status on the wrong chain without rewriting the manifest', async function () {
    const {manifestPath} = await deployAccess('command-wrong-chain');
    const manifest = await readVillageDeploymentManifest(manifestPath);
    const wrongChainPath = path.join(path.dirname(manifestPath), 'wrong-chain.json');
    const wrongChain = `${JSON.stringify({...manifest, chainId: 42220}, null, 2)}\n`;
    await writeFile(wrongChainPath, wrongChain);

    for (const upgrade of [undefined, 'VillageAccess:prepared-test']) {
      let failure: Error | undefined;
      try {
        await ownerStatusCommand({manifestPath: wrongChainPath, upgrade}, {ethers, networkName: 'default'});
      } catch (error) {
        failure = error as Error;
      }
      expect(failure?.message).to.include('Connected chain 31337 does not match manifest chain 42220');
      expect(await readFile(wrongChainPath, 'utf8')).to.equal(wrongChain);
    }
  });

  it('reconciles an externally executed prepared upgrade', async function () {
    const {manifestPath, owner} = await deployAccess('command-reconcile-upgrade');
    const prepared = await prepare(manifestPath, 'external-execution');
    const upgrade = prepared.upgradeHistory![0];
    const access = await ethers.getContractAt('VillageAccess', prepared.contracts.VillageAccess.address, owner);
    await (await access.upgradeToAndCall(upgrade.newImplementation, '0x')).wait();

    const reconciled = await prepare(manifestPath, 'next-release');
    expect(reconciled.upgradeHistory![0].status).to.equal('executed');
    expect(reconciled.contracts.VillageAccess.revisions.at(-1)!.implementationAddress).to.equal(
      upgrade.newImplementation,
    );
    expect(reconciled.contracts.VillageAccess.revisions.at(-1)!.implementationRuntimeCodeHash).to.equal(
      upgrade.implementationCodeHash,
    );
  });

  it('submits and reconciles a prepared EOA-owned upgrade', async function () {
    const {manifestPath, descriptorPath} = await deployAccess('command-submit-upgrade');
    await prepare(manifestPath, 'eoa-submit');

    const executed = await ownerSubmitCommand(
      {manifestPath, upgrade: 'VillageAccess:eoa-submit'},
      {ethers, networkName: 'default'},
    );
    const upgrade = executed.upgradeHistory![0];
    expect(upgrade.status).to.equal('executed');
    expect(executed.contracts.VillageAccess.revisions.at(-1)!.implementationAddress).to.equal(
      upgrade.newImplementation,
    );
    expect(executed.contracts.VillageAccess.revisions.at(-1)!.implementationRuntimeCodeHash).to.equal(
      upgrade.implementationCodeHash,
    );
    const descriptorDirectory = path.dirname(descriptorPath!);
    const descriptorFiles = await readdir(descriptorDirectory);
    expect(descriptorFiles).to.have.length(2);
    const upgradedDescriptorPath = path.join(
      descriptorDirectory,
      descriptorFiles.find((file) => path.join(descriptorDirectory, file) !== descriptorPath)!,
    );
    const upgradedDescriptor = JSON.parse(await readFile(upgradedDescriptorPath, 'utf8'));
    expect(upgradedDescriptor.contracts.VillageAccess.revisions).to.have.length(2);
    expect(upgradedDescriptor.contracts.VillageAccess.revisions.at(-1).abiHash).to.equal(upgrade.candidateAbiHash);
  });

  it('rejects untracked implementation drift before deploying another candidate', async function () {
    const {manifestPath, owner} = await deployAccess('command-drift-upgrade');
    const prepared = await prepare(manifestPath, 'untracked-execution');
    const upgrade = prepared.upgradeHistory![0];
    const access = await ethers.getContractAt('VillageAccess', prepared.contracts.VillageAccess.address, owner);
    await (await access.upgradeToAndCall(upgrade.newImplementation, '0x')).wait();

    prepared.upgradeHistory = [];
    await writeVillageDeploymentManifest(manifestPath, prepared);
    const staleManifest = await readFile(manifestPath, 'utf8');
    let ignitionCalled = false;
    let failure: Error | undefined;
    try {
      await prepareUpgradeCommand(
        {
          manifestPath,
          contractName: 'VillageAccess',
          implementation: 'VillageAccessUpgradeMock',
          version: 'must-not-deploy',
        },
        {
          ...upgradeContext(),
          ignition: {
            deploy: async () => {
              ignitionCalled = true;
              throw new Error('unexpected deployment');
            },
          },
        },
      );
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).to.include('does not match manifest');
    expect(ignitionCalled).to.equal(false);
    expect(await readFile(manifestPath, 'utf8')).to.equal(staleManifest);
  });
});
