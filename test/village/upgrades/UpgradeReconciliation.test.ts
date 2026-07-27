import {expect} from 'chai';
import {keccak256, zeroPadValue, ZeroHash} from 'ethers';
import {ethers} from '../../hardhat.js';
import {reconcileExecutedUpgrade} from '../../../scripts/deployment/upgrades.js';
import type {ManifestContract, ManifestUpgrade} from '../../../scripts/deployment/village.js';

describe('Upgrade manifest reconciliation', function () {
  it('updates execution state, implementation address, and runtime code hash from the proxy slot', async function () {
    const [, previous, next, proxy] = await ethers.getSigners();
    const implementationCode = '0x6001600055';
    const contracts = contractRecords(proxy.address, previous.address);
    const upgrade = manifestUpgrade(previous.address, next.address, keccak256(implementationCode));

    const result = await reconcileExecutedUpgrade(contracts, upgrade, {
      getStorage: async () => zeroPadValue(next.address, 32),
      getCode: async () => implementationCode,
      getLogs: async () => [upgradeLog()],
    });

    expect(result).to.deep.equal({liveImplementation: next.address, executed: true});
    expect(upgrade.status).to.equal('executed');
    expect(contracts.CommunityToken.revisions).to.have.length(2);
    expect(contracts.CommunityToken.revisions.at(-1)!.implementationAddress).to.equal(next.address);
    expect(contracts.CommunityToken.revisions.at(-1)!.implementationRuntimeCodeHash).to.equal(
      keccak256(implementationCode),
    );
    expect(contracts.CommunityToken.revisions.at(-1)!.abi).to.deep.equal(upgrade.candidateAbi);
    expect(upgrade.executedAt).to.deep.equal({
      transactionHash: `0x${'22'.repeat(32)}`,
      blockNumber: '12',
      blockHash: `0x${'33'.repeat(32)}`,
      transactionIndex: 1,
      logIndex: 2,
    });
  });

  it('leaves a prepared upgrade unchanged while the proxy still uses the previous implementation', async function () {
    const [, previous, next, proxy] = await ethers.getSigners();
    const contracts = contractRecords(proxy.address, previous.address);
    const upgrade = manifestUpgrade(previous.address, next.address, ZeroHash);

    const result = await reconcileExecutedUpgrade(contracts, upgrade, {
      getStorage: async () => zeroPadValue(previous.address, 32),
      getCode: async () => {
        throw new Error('code must not be read before the implementation changes');
      },
      getLogs: async () => [],
    });

    expect(result).to.deep.equal({liveImplementation: previous.address, executed: false});
    expect(upgrade.status).to.equal('prepared');
    expect(contracts.CommunityToken.revisions.at(-1)!.implementationAddress).to.equal(previous.address);
  });

  it('rejects prepared-code hash mismatches without mutating the manifest', async function () {
    const [, previous, next, proxy] = await ethers.getSigners();
    const contracts = contractRecords(proxy.address, previous.address);
    const upgrade = manifestUpgrade(previous.address, next.address, ZeroHash);
    let failure: Error | undefined;

    try {
      await reconcileExecutedUpgrade(contracts, upgrade, {
        getStorage: async () => zeroPadValue(next.address, 32),
        getCode: async () => '0x6001600055',
        getLogs: async () => [],
      });
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).to.include('does not match prepared hash');
    expect(upgrade.status).to.equal('prepared');
    expect(contracts.CommunityToken.revisions.at(-1)!.implementationAddress).to.equal(previous.address);
    expect(contracts.CommunityToken.revisions.at(-1)!.implementationRuntimeCodeHash).to.equal(ZeroHash);
  });

  it('rejects an implementation that is neither the previous nor prepared candidate', async function () {
    const [, previous, next, proxy, drifted] = await ethers.getSigners();
    const contracts = contractRecords(proxy.address, previous.address);
    const upgrade = manifestUpgrade(previous.address, next.address, ZeroHash);
    let failure: Error | undefined;

    try {
      await reconcileExecutedUpgrade(contracts, upgrade, {
        getStorage: async () => zeroPadValue(drifted.address, 32),
        getCode: async () => '0x6001600055',
        getLogs: async () => [],
      });
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).to.include('is neither the prepared implementation');
    expect(upgrade.status).to.equal('prepared');
    expect(contracts.CommunityToken.revisions.at(-1)!.implementationAddress).to.equal(previous.address);
  });
});

function contractRecords(proxy: string, implementation: string): Record<string, ManifestContract> {
  return {
    CommunityToken: {
      name: 'CommunityToken',
      deploymentName: 'test_CommunityToken',
      address: proxy,
      revisions: [
        {
          implementationAddress: implementation,
          implementationRuntimeCodeHash: ZeroHash,
          abi: [],
          abiHash: ZeroHash,
          effectiveFrom: {
            kind: 'deployment',
            block: {blockNumber: '1', blockHash: ZeroHash},
          },
        },
      ],
    },
  };
}

function manifestUpgrade(
  previousImplementation: string,
  newImplementation: string,
  implementationCodeHash: string,
): ManifestUpgrade {
  return {
    contractName: 'CommunityToken',
    version: 'upgrade-test',
    nextArtifact: 'CommunityTokenUpgradeMock',
    deploymentId: 'upgrade-test',
    moduleId: 'UpgradeImplementationModule',
    previousImplementation,
    newImplementation,
    status: 'prepared',
    validatedAt: '2026-07-18T00:00:00.000Z',
    callData: '0x',
    specHash: ZeroHash,
    implementationCodeHash,
    candidateAbi: [{type: 'function', name: 'newFunction', inputs: [], outputs: []}],
    candidateAbiHash: `0x${'11'.repeat(32)}`,
    preparedAtBlock: {blockNumber: '10', blockHash: ZeroHash},
    ownerAction: {
      to: newImplementation,
      contractName: 'CommunityToken',
      functionName: 'upgradeToAndCall',
      args: [newImplementation, '0x'],
      data: '0x',
      reason: 'test',
    },
  };
}

function upgradeLog() {
  return {
    transactionHash: `0x${'22'.repeat(32)}`,
    blockNumber: 12,
    blockHash: `0x${'33'.repeat(32)}`,
    transactionIndex: 1,
    index: 2,
  };
}
