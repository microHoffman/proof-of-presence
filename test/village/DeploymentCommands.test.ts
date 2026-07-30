import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect} from 'chai';
import hre from 'hardhat';
import {upgrades as createUpgradesApi} from '@openzeppelin/hardhat-upgrades';
import {connection, ethers} from '../hardhat.js';
import {parseVillageDeploymentConfig} from '../../scripts/deployment/config.js';
import {ownerStatusCommand} from '../../scripts/deployment/commands/owner-status.js';
import {ownerSubmitCommand} from '../../scripts/deployment/commands/owner-submit.js';
import {prepareUpgradeCommand} from '../../scripts/deployment/commands/prepare-upgrade.js';
import {upgradeStatusCommand} from '../../scripts/deployment/commands/upgrade-status.js';
import {upgradeSubmitCommand} from '../../scripts/deployment/commands/upgrade-submit.js';
import {deployVillage, readVillageDeploymentManifest} from '../../scripts/deployment/village.js';

const upgradesApi = await createUpgradesApi(hre, connection);

function deploymentContext(outputRoot: string) {
  return {ethers, upgrades: upgradesApi, ignition: connection.ignition, networkName: 'default', outputRoot};
}

function upgradeContext() {
  return {
    ethers,
    upgrades: upgradesApi,
    ignition: connection.ignition,
    provider: connection.provider,
    networkName: 'default',
  };
}

async function deployAccess(slug: string, finalOwnerIndex = 0) {
  const signers = await ethers.getSigners();
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'village-command-'));
  const spec = parseVillageDeploymentConfig({
    schemaVersion: 2,
    villageSlug: slug,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    contracts: ['VillageAccess'],
    finalOwner: {type: 'eoa', address: signers[finalOwnerIndex].address},
    apiOperator: signers[2].address,
  });
  return {
    ...(await deployVillage(spec, deploymentContext(outputRoot))),
    deployer: signers[0],
    finalOwner: signers[finalOwnerIndex],
  };
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

describe('Deployment operator commands', function () {
  it('submits and reconciles an EOA ownership handoff without publishing a consumer descriptor', async function () {
    const {manifestPath, finalOwner} = await deployAccess('command-complete-handoff', 1);
    const pending = await readVillageDeploymentManifest(manifestPath);
    expect(pending.status).to.equal('pending-handoff');
    expect(pending.pendingOwnerActions).to.have.length(1);

    const completed = await ownerSubmitCommand({manifestPath}, {ethers, networkName: 'default'});
    expect(completed.status).to.equal('complete');
    expect(completed.pendingOwnerActions).to.deep.equal([]);
    const access = await ethers.getContractAt('VillageAccess', completed.contracts.VillageAccess.address);
    expect(await access.defaultAdmin()).to.equal(finalOwner.address);
    expect(await ownerStatusCommand({manifestPath}, {ethers, networkName: 'default'})).to.deep.equal(completed);
  });

  it('prepares, submits, and reconciles an EOA-owned UUPS upgrade', async function () {
    const {manifestPath} = await deployAccess('command-submit-upgrade');
    const prepared = await prepare(manifestPath, 'eoa-submit');
    const upgrade = prepared.upgrades![0];
    expect(upgrade).to.include({
      contractName: 'VillageAccess',
      nextArtifact: 'VillageAccessUpgradeMock',
      status: 'prepared',
    });
    expect(upgrade).not.to.have.any.keys('candidateAbi', 'candidateAbiHash', 'verification');

    const executed = await upgradeSubmitCommand(
      {manifestPath, upgrade: 'VillageAccess:eoa-submit'},
      {ethers, networkName: 'default'},
    );
    expect(executed.upgrades![0].status).to.equal('executed');
    expect(executed.contracts.VillageAccess.artifact).to.equal('VillageAccessUpgradeMock');
    expect(executed.contracts.VillageAccess.implementation?.address).to.equal(upgrade.newImplementation);
    expect(executed.upgrades![0].executedAt?.transactionHash).to.match(/^0x[0-9a-f]{64}$/);
  });

  it('reconciles an externally executed prepared upgrade from the proxy slot and Upgraded event', async function () {
    const {manifestPath, deployer} = await deployAccess('command-external-upgrade');
    const prepared = await prepare(manifestPath, 'external');
    const upgrade = prepared.upgrades![0];
    const access = await ethers.getContractAt('VillageAccess', prepared.contracts.VillageAccess.address, deployer);
    await (await access.upgradeToAndCall(upgrade.newImplementation, '0x')).wait();

    const reconciled = await upgradeStatusCommand(
      {manifestPath, upgrade: 'VillageAccess:external'},
      {ethers, networkName: 'default'},
    );
    expect(reconciled.upgrades![0].status).to.equal('executed');
    expect(reconciled.contracts.VillageAccess.implementation).to.deep.equal({
      address: upgrade.newImplementation,
      runtimeCodeHash: upgrade.implementationCodeHash,
    });
  });

  it('rejects command execution on the wrong chain without rewriting the manifest', async function () {
    const {manifestPath} = await deployAccess('command-wrong-chain');
    const manifest = await readVillageDeploymentManifest(manifestPath);
    const wrongChainPath = path.join(path.dirname(manifestPath), 'wrong-chain.json');
    const serialized = `${JSON.stringify({...manifest, chainId: 42220}, null, 2)}\n`;
    await writeFile(wrongChainPath, serialized);

    let failure: Error | undefined;
    try {
      await ownerStatusCommand({manifestPath: wrongChainPath}, {ethers, networkName: 'default'});
    } catch (error) {
      failure = error as Error;
    }
    expect(failure?.message).to.include('Connected chain 31337 does not match manifest chain 42220');
    expect(await readFile(wrongChainPath, 'utf8')).to.equal(serialized);
  });
});
