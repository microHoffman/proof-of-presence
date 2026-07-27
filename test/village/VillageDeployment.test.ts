import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect} from 'chai';
import hre from 'hardhat';
import {upgrades as createUpgradesApi} from '@openzeppelin/hardhat-upgrades';
import {OperationType} from '@safe-global/types-kit';
import {id, MaxUint256, parseEther, ZeroAddress} from 'ethers';
import {connection, ethers} from '../hardhat.js';
import {runTsxWorker} from '../helpers/child-process.js';
import {parseVillageDeploymentConfig} from '../../scripts/deployment/config.js';
import {submitOwnershipHandoff} from '../../scripts/deployment/handoff.js';
import {
  deployVillage,
  parseVillageDeploymentManifest,
  ROLE_IDS,
  type VillageDeploymentConfig,
} from '../../scripts/deployment/village.js';

const upgradesApi = await createUpgradesApi(hre, connection);

function deploymentContext(outputRoot: string) {
  return {ethers, upgrades: upgradesApi, ignition: connection.ignition, networkName: 'default', outputRoot};
}

async function outputRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'village-deployment-'));
}

async function chainId(): Promise<number> {
  return Number((await ethers.provider.getNetwork()).chainId);
}

function baseConfig(
  slug: string,
  owner: string,
  apiOperator: string,
  overrides: Partial<VillageDeploymentConfig> = {},
): VillageDeploymentConfig {
  const config: VillageDeploymentConfig = {
    schemaVersion: 1,
    villageSlug: slug,
    chainId: 31337,
    deploymentProfile: 'minimal-village',
    finalOwner: {type: 'eoa', address: owner},
    modules: [],
    apiOperator,
    citizenNft: {baseURI: 'https://citizen.example/'},
    communityToken: {maxSupply: MaxUint256.toString()},
    ...overrides,
  };
  if (overrides.communityToken) {
    config.communityToken = {maxSupply: MaxUint256.toString(), ...overrides.communityToken};
  }
  return config;
}

describe('Village deployment entrypoint', function () {
  it('prints help for bare npm deploy instead of deploying', async function () {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
    const helpScript = await readFile(path.join(process.cwd(), 'scripts/print-deploy-help.js'), 'utf8');
    expect(packageJson.scripts.deploy).to.equal('node ./scripts/print-deploy-help.js');
    expect(helpScript).to.include('Bare deploy is intentionally non-transactional');
  });

  it('completes immediately when the deployer is the final owner', async function () {
    const [owner, apiOperator, other] = await ethers.getSigners();
    const config = baseConfig('same-eoa-minimal-test', owner.address, apiOperator.address, {
      chainId: await chainId(),
    });
    const context = deploymentContext(await outputRoot());
    const result = await deployVillage(config, context);
    const access = await ethers.getContractAt('VillageAccess', result.manifest.contracts.VillageAccess.address);

    expect(result.manifest.status).to.equal('complete');
    expect(result.manifest.schemaVersion).to.equal(1);
    expect(result.manifest.configSchemaVersion).to.equal(1);
    expect(result.manifest.deploymentKind).to.equal('village');
    expect(result.manifest.ownership).to.deep.include({
      deployer: owner.address,
      finalOwner: {type: 'eoa', address: owner.address},
    });
    expect(await access.defaultAdmin()).to.equal(owner.address);
    expect(await access.hasRole(ROLE_IDS.DEFAULT_ADMIN_ROLE, other.address)).to.equal(false);
    expect(result.manifest.contracts.VillageAccess.revisions[0].abi).to.be.an('array').and.not.empty;
    expect(result.manifest).not.to.have.property('transactions');
    expect(result.manifest).not.to.have.property('abis');
    expect(result.manifest).not.to.have.property('proxyImplementations');
    expect(result.manifest.deploymentTool).not.to.have.property('selectedFiles');

    expect(() =>
      parseVillageDeploymentManifest({...result.manifest, unexpectedOuterJournal: {step: 'complete'}}),
    ).to.throw('Unrecognized key');
    expect(() => parseVillageDeploymentManifest({...result.manifest, schemaVersion: 2})).to.throw();
    const {deploymentKind: _deploymentKind, ...withoutDeploymentKind} = result.manifest;
    expect(() => parseVillageDeploymentManifest({...withoutDeploymentKind, generation: 'village'})).to.throw();
  });

  it('deploys CitizenNFT in token profiles with explicit operators, defaults, and a descriptor', async function () {
    const [owner, apiOperator, citizenOperator, citizen] = await ethers.getSigners();
    const root = await outputRoot();
    const config = baseConfig('citizen-profile', owner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'token-village',
      citizenNft: {
        baseURI: 'https://citizen.example/metadata/',
        operators: [citizenOperator.address, citizenOperator.address],
      },
    });
    const result = await deployVillage(config, deploymentContext(root));
    const access = await ethers.getContractAt('VillageAccess', result.manifest.contracts.VillageAccess.address);
    const citizenNft = await ethers.getContractAt(
      'VillageCitizenNFT',
      result.manifest.contracts.VillageCitizenNFT.address,
    );

    expect(result.manifest.modules.citizenNft).to.equal(true);
    expect(await citizenNft.name()).to.equal('Citizen Profile Citizen');
    expect(await citizenNft.symbol()).to.equal('citizen-profile CIT');
    expect(await citizenNft.baseURI()).to.equal('https://citizen.example/metadata/');
    expect(await citizenNft.owner()).to.equal(owner.address);
    expect(await citizenNft.roleAuthority()).to.equal(await access.getAddress());
    expect(await access.hasRole(ROLE_IDS.CITIZEN_OPERATOR_ROLE, citizenOperator.address)).to.equal(true);
    expect(await access.hasRole(ROLE_IDS.CITIZEN_OPERATOR_ROLE, apiOperator.address)).to.equal(false);
    expect(await access.hasRole(ROLE_IDS.CITIZEN_OPERATOR_ROLE, owner.address)).to.equal(false);
    await citizenNft.connect(citizenOperator).issue(citizen.address, id('fresh-opaque-reference'));
    expect(await citizenNft.tokenIdOf(citizen.address)).to.equal(1);

    const descriptor = JSON.parse(await readFile(result.descriptorPath!, 'utf8'));
    expect(descriptor.schemaVersion).to.equal(1);
    expect(descriptor.contracts.VillageCitizenNFT.address).to.equal(await citizenNft.getAddress());
    expect(descriptor.contracts.VillageCitizenNFT.revisions[0].abi).to.be.an('array').and.not.empty;
  });

  it('rejects a conflicting manifest for an existing village deployment', async function () {
    const [owner, apiOperator, otherOperator] = await ethers.getSigners();
    const config = baseConfig('manifest-collision-test', owner.address, apiOperator.address, {
      chainId: await chainId(),
    });
    const context = deploymentContext(await outputRoot());
    await deployVillage(config, context);
    await deployVillage(parseVillageDeploymentConfig(config), context);

    let collision: Error | undefined;
    try {
      await deployVillage({...config, apiOperator: otherOperator.address}, context);
    } catch (error) {
      collision = error as Error;
    }
    expect(collision?.message).to.include('Deployment manifest collision');
  });

  it('deploys through the public CLI entrypoint', async function () {
    const [owner, apiOperator] = await ethers.getSigners();
    const root = await outputRoot();
    const config = baseConfig('cli-village-test', owner.address, apiOperator.address, {chainId: await chainId()});
    const configPath = path.join(root, 'config.json');
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await runTsxWorker(
      'scripts/deploy-village.ts',
      ['--config', configPath, '--network', 'default', '--output-root', root],
      {cwd: process.cwd()},
    );
    const manifestPath = path.join(
      root,
      'deployments',
      'villages',
      String(config.chainId),
      `${config.villageSlug}.json`,
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(manifest.status).to.equal('complete');
    expect(manifest.contracts.VillageAccess.revisions[0].abi).to.be.an('array').and.not.empty;
  });

  it('automatically writes an immutable consumer descriptor for a complete deployment', async function () {
    const [owner, apiOperator] = await ethers.getSigners();
    const root = await outputRoot();
    const config = baseConfig('consumer-descriptor-test', owner.address, apiOperator.address, {
      chainId: await chainId(),
    });
    const result = await deployVillage(config, deploymentContext(root));
    const descriptor = JSON.parse(await readFile(result.descriptorPath!, 'utf8'));
    expect(descriptor.schemaVersion).to.equal(1);
    expect(descriptor.deploymentKind).to.equal('village');
    expect(descriptor.revision).to.match(/^0x[0-9a-f]{64}$/);
    expect(path.basename(result.descriptorPath!)).to.equal(`${descriptor.revision}.json`);
    expect(descriptor.contracts.VillageAccess.revisions[0].abi).to.be.an('array').and.not.empty;
    const rerun = await deployVillage(config, deploymentContext(root));
    expect(rerun.descriptorPath).to.equal(result.descriptorPath);
    expect(await readFile(rerun.descriptorPath!, 'utf8')).to.equal(await readFile(result.descriptorPath!, 'utf8'));
  });

  it('keeps deploy:contract as a thin standalone target wrapper', async function () {
    const [owner, apiOperator, treasury] = await ethers.getSigners();
    const root = await outputRoot();
    const config = baseConfig('standalone-policy-test', owner.address, apiOperator.address, {
      chainId: await chainId(),
      tdfTransferPolicy: {treasury: treasury.address},
    });
    const configPath = path.join(root, 'config.json');
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await runTsxWorker(
      'scripts/deploy-contract.ts',
      ['--contract', 'TDFTransferPolicy', '--config', configPath, '--network', 'default', '--output-root', root],
      {cwd: process.cwd()},
    );
    const manifestPath = path.join(
      root,
      'deployments',
      'contracts',
      String(config.chainId),
      config.villageSlug,
      'tdftransfer-policy.json',
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(Object.keys(manifest.contracts)).to.deep.equal(['TDFTransferPolicy']);
    expect(manifest.status).to.equal('complete');
    expect(manifest.contracts.TDFTransferPolicy.constructorArgs).to.deep.equal([treasury.address, owner.address]);
  });

  it('permits standalone CitizenNFT deployment with only its required VillageAccess dependency', async function () {
    const [owner, apiOperator, citizenOperator] = await ethers.getSigners();
    const root = await outputRoot();
    const config = baseConfig('standalone-citizen-test', owner.address, apiOperator.address, {
      chainId: await chainId(),
      citizenNft: {baseURI: 'ipfs://standalone-citizens/', operators: [citizenOperator.address]},
    });
    const configPath = path.join(root, 'config.json');
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await runTsxWorker(
      'scripts/deploy-contract.ts',
      ['--contract', 'VillageCitizenNFT', '--config', configPath, '--network', 'default', '--output-root', root],
      {cwd: process.cwd()},
    );
    const manifestPath = path.join(
      root,
      'deployments',
      'contracts',
      String(config.chainId),
      config.villageSlug,
      'village-citizen-nft.json',
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(Object.keys(manifest.contracts).sort()).to.deep.equal(['VillageAccess', 'VillageCitizenNFT']);
    expect(manifest.modules).to.deep.equal({
      communityToken: false,
      presenceToken: false,
      sweatToken: false,
      tokenizedStays: false,
      tdfTransferPolicy: false,
      citizenNft: true,
      dynamicPriceSale: false,
    });
    expect(manifest.contracts.VillageCitizenNFT.initializerArgs[2]).to.equal('ipfs://standalone-citizens/');
  });

  it('runs OpenZeppelin preflight before calling Ignition', async function () {
    const [owner, apiOperator] = await ethers.getSigners();
    let ignitionCalled = false;
    const config = baseConfig('unsafe-preflight', owner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'token-village',
    });
    let failure: Error | undefined;
    try {
      await deployVillage(config, {
        ethers,
        upgrades: {
          validateImplementation: async () => {
            throw new Error('unsafe implementation');
          },
        },
        ignition: {
          deploy: async () => {
            ignitionCalled = true;
          },
        },
        networkName: 'default',
        outputRoot: await outputRoot(),
      });
    } catch (error) {
      failure = error as Error;
    }
    expect(failure?.message).to.equal('unsafe implementation');
    expect(ignitionCalled).to.equal(false);
  });

  it('installs an existing external policy during generic CommunityToken initialization', async function () {
    const [owner, apiOperator] = await ethers.getSigners();
    const policy = await ethers.deployContract('TransferPolicyMock');
    await policy.waitForDeployment();
    const config = baseConfig('external-policy', owner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'token-village',
      communityToken: {transferPolicy: await policy.getAddress()},
    });

    const result = await deployVillage(config, deploymentContext(await outputRoot()));
    const token = await ethers.getContractAt('CommunityToken', result.manifest.contracts.CommunityToken.address);

    expect(result.manifest.status).to.equal('complete');
    expect(await token.transferPolicy()).to.equal(await policy.getAddress());
    expect(result.manifest.contracts.CommunityToken.initializerArgs?.[6]).to.equal(await policy.getAddress());
  });

  it('deploys a generic DynamicPriceSale and reconciles its post-deployment minter grant', async function () {
    const [owner, apiOperator, payer, recipient, villageTreasury, closerFeeRecipient] = await ethers.getSigners();
    const quoteToken = await ethers.deployContract('QuoteTokenMock', [18]);
    const curve = await ethers.deployContract('BondingCurveMock', [18, parseEther('2')]);
    await Promise.all([quoteToken.waitForDeployment(), curve.waitForDeployment()]);
    const config = baseConfig('generic-dynamic-sale', owner.address, apiOperator.address, {
      chainId: await chainId(),
      modules: ['communityToken', 'dynamicPriceSale'],
      communityToken: {maxSupply: parseEther('1000').toString()},
      dynamicPriceSale: {
        quoteToken: await quoteToken.getAddress(),
        bondingCurve: await curve.getAddress(),
        villageTreasury: villageTreasury.address,
        closerFeeRecipient: closerFeeRecipient.address,
        closerFeeBps: 250,
        saleCap: parseEther('900').toString(),
        minimumPurchase: parseEther('1').toString(),
        maximumPurchase: parseEther('100').toString(),
        purchaseGranularity: parseEther('1').toString(),
        maximumRecipientBalance: parseEther('200').toString(),
      },
    });
    const context = deploymentContext(await outputRoot());
    const result = await deployVillage(config, context);

    expect(result.manifest.status).to.equal('complete');
    expect(result.manifest.contracts).not.to.have.property('TDFV1BondingCurve');

    const sale = await ethers.getContractAt('DynamicPriceSale', result.manifest.contracts.DynamicPriceSale.address);
    const token = await ethers.getContractAt('CommunityToken', result.manifest.contracts.CommunityToken.address);
    const amount = parseEther('5');
    const totalPayment = parseEther('10');
    await quoteToken.mint(payer.address, totalPayment);
    const payerQuoteToken = await ethers.getContractAt('QuoteTokenMock', await quoteToken.getAddress(), payer);
    await payerQuoteToken.approve(await sale.getAddress(), totalPayment);
    await sale.connect(payer).buy(amount, recipient.address, totalPayment, MaxUint256);

    expect(await token.balanceOf(recipient.address)).to.equal(amount);
    expect(await quoteToken.balanceOf(closerFeeRecipient.address)).to.equal(parseEther('0.25'));
    expect(await quoteToken.balanceOf(villageTreasury.address)).to.equal(parseEther('9.75'));
  });

  it('keeps a custom internally wired TDF token restricted until its explicit enable action', async function () {
    const [owner, apiOperator, treasury, member, other] = await ethers.getSigners();
    const config = baseConfig('custom-internal-policy', owner.address, apiOperator.address, {
      chainId: await chainId(),
      modules: ['communityToken', 'tdfTransferPolicy'],
      communityToken: {
        initialSupply: parseEther('1').toString(),
        initialRecipient: member.address,
      },
      tdfTransferPolicy: {treasury: treasury.address, restrictionsEnabled: false},
    });
    const context = deploymentContext(await outputRoot());

    const result = await deployVillage(config, context);
    const token = await ethers.getContractAt('CommunityToken', result.manifest.contracts.CommunityToken.address);
    const policy = await ethers.getContractAt('TDFTransferPolicy', result.manifest.contracts.TDFTransferPolicy.address);

    expect(result.manifest.status).to.equal('complete');
    expect(await token.transferPolicy()).to.equal(await policy.getAddress());
    expect(await policy.transfersRestricted()).to.equal(false);
    await token.connect(member).transfer(other.address, 1);
  });

  it('deploys and completes the same-EOA-owner TDF flow through the public entrypoint', async function () {
    const [owner, apiOperator, treasury, member, other, closerFeeRecipient] = await ethers.getSigners();
    const quoteToken = await ethers.deployContract('QuoteTokenMock', [18]);
    await quoteToken.waitForDeployment();
    const config = baseConfig('same-eoa-owner', owner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'tdf',
      communityToken: {
        name: 'TDF Community',
        symbol: 'TDFC',
        initialSupply: parseEther('5381').toString(),
        maxSupply: parseEther('18600').toString(),
        initialRecipient: member.address,
        apiOperatorCanMint: true,
      },
      presenceToken: {decayRatePerDay: 288_617},
      sweatToken: {decayRatePerDay: 288_617},
      tdfTransferPolicy: {treasury: treasury.address},
      dynamicPriceSale: {
        quoteToken: await quoteToken.getAddress(),
        villageTreasury: treasury.address,
        closerFeeRecipient: closerFeeRecipient.address,
        saleCap: parseEther('15097.5').toString(),
        minimumPurchase: parseEther('1').toString(),
        maximumPurchase: parseEther('100').toString(),
        purchaseGranularity: parseEther('1').toString(),
        maximumRecipientBalance: parseEther('915').toString(),
      },
    });
    const context = deploymentContext(await outputRoot());
    const result = await deployVillage(config, context);
    expect(result.manifest.status).to.equal('complete');
    const token = await ethers.getContractAt('CommunityToken', result.manifest.contracts.CommunityToken.address);
    const policy = await ethers.getContractAt('TDFTransferPolicy', result.manifest.contracts.TDFTransferPolicy.address);
    expect(await token.transferPolicy()).to.equal(await policy.getAddress());
    expect(result.manifest.contracts.CommunityToken.initializerArgs?.[6]).to.equal(await policy.getAddress());
    expect(await policy.transfersRestricted()).to.equal(true);
    await expect(token.connect(member).transfer(other.address, 1)).to.be.revertedWithCustomError(
      token,
      'TransferBlockedByPolicy',
    );
    await token.connect(member).transfer(treasury.address, parseEther('1'));
    await token.connect(treasury).transfer(member.address, parseEther('1'));

    const completed = result.manifest;
    const stays = await ethers.getContractAt('TokenizedStays', completed.contracts.TokenizedStays.address);
    const presence = await ethers.getContractAt(
      'VillagePresenceToken',
      completed.contracts.VillagePresenceToken.address,
    );
    const sweat = await ethers.getContractAt('VillageSweatToken', completed.contracts.VillageSweatToken.address);
    expect(await token.transferPolicy()).to.equal(completed.contracts.TDFTransferPolicy.address);
    expect(await policy.transfersRestricted()).to.equal(true);
    expect(await policy.allowedCounterparty(await stays.getAddress())).to.equal(true);
    expect(
      await (
        await ethers.getContractAt('VillageAccess', completed.contracts.VillageAccess.address)
      ).hasRole(ROLE_IDS.MINTER_ROLE, completed.contracts.DynamicPriceSale.address),
    ).to.equal(true);
    expect(completed.contracts.TDFV1BondingCurve.authority).to.equal('ownerless');
    const sale = await ethers.getContractAt('DynamicPriceSale', completed.contracts.DynamicPriceSale.address);
    const saleConfiguration = await sale.saleConfiguration();
    expect(saleConfiguration.communityToken).to.equal(await token.getAddress());
    expect(saleConfiguration.quoteToken).to.equal(await quoteToken.getAddress());
    expect(saleConfiguration.bondingCurve).to.equal(completed.contracts.TDFV1BondingCurve.address);
    expect(saleConfiguration.closerFeeBps).to.equal(500n);

    expect(await policy.MINIMUM_OPERATING_SUPPLY()).to.equal(parseEther('5381'));
    await expect(token.connect(member).burn(1)).to.be.revertedWithCustomError(token, 'TransferBlockedByPolicy');
    await token.connect(apiOperator).mint(member.address, 1);
    await token.connect(member).burn(1);

    await expect(token.connect(member).transfer(other.address, 1)).to.be.revertedWithCustomError(
      token,
      'TransferBlockedByPolicy',
    );
    await token.connect(member).transfer(treasury.address, parseEther('1'));
    await token.connect(treasury).transfer(member.address, parseEther('1'));

    const bookingDayId = (await stays.currentDayId()) + 30n;
    const [year, dayOfYear] = await stays.fromDayId(bookingDayId);
    const price = parseEther('5');
    await expect(
      stays.connect(member).createBookings([{year, dayOfYear, pricePerDate: price}]),
    ).to.be.revertedWithCustomError(token, 'ERC20InsufficientAllowance');
    await token.connect(member).approve(await stays.getAddress(), price);
    await stays.connect(member).createBookings([{year, dayOfYear, pricePerDate: price}]);
    expect(await stays.requiredLockedBalance(member.address)).to.equal(price);
    expect(await stays.depositedBalanceOf(member.address)).to.equal(price);

    await stays.connect(member).cancelBookings([{year, dayOfYear}]);
    await stays.connect(member).withdrawMax();
    expect(await stays.depositedBalanceOf(member.address)).to.equal(0n);
    expect(await token.balanceOf(member.address)).to.equal(parseEther('5381'));

    await presence.connect(apiOperator).mint(member.address, parseEther('1'), 0);
    await sweat.connect(apiOperator).mint(member.address, parseEther('2'), 0);
    expect(await presence.nonDecayedBalanceOf(member.address)).to.equal(parseEther('1'));
    expect(await sweat.nonDecayedBalanceOf(member.address)).to.equal(parseEther('2'));
  });

  it('configures contracts before initiating a Safe handoff', async function () {
    const [deployer, safeOwnerA, safeOwnerB, apiOperator, treasury] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('SafeMock', deployer);
    const safe = await factory.deploy();
    await safe.waitForDeployment();
    await (
      await safe.setup(
        [safeOwnerA.address, safeOwnerB.address],
        2,
        ZeroAddress,
        '0x',
        ZeroAddress,
        ZeroAddress,
        0,
        ZeroAddress,
      )
    ).wait();

    const safeAddress = await safe.getAddress();
    const config = baseConfig('safe-ownership-handoff', safeAddress, apiOperator.address, {
      chainId: await chainId(),
      finalOwner: {
        type: 'safe',
        address: safeAddress,
        expectedOwners: [safeOwnerA.address, safeOwnerB.address],
        expectedThreshold: 2,
      },
      modules: ['tdfTransferPolicy'],
      tdfTransferPolicy: {treasury: treasury.address, restrictionsEnabled: false},
    });
    let prepareCalls = 0;
    const context = {
      ...deploymentContext(await outputRoot()),
      prepareSafeTransaction: async (owner: any, actions: any[]) => {
        prepareCalls += 1;
        expect(owner.address).to.equal(safeAddress);
        expect(actions.map(({functionName}) => functionName)).to.deep.equal(['acceptOwnership']);
        return {
          safeAddress,
          safeTxHash: `0x${'11'.repeat(32)}`,
          data: {
            to: actions[0].to,
            value: '0',
            data: actions[0].data,
            operation: OperationType.Call,
            safeTxGas: '0',
            baseGas: '0',
            gasPrice: '0',
            gasToken: ZeroAddress,
            refundReceiver: ZeroAddress,
            nonce: 0,
          },
        };
      },
      proposeSafeTransaction: async (_chainId: number, prepared: any) => ({
        ...prepared,
        proposal: {status: 'submitted' as const, submittedAt: new Date().toISOString()},
      }),
    };
    const result = await deployVillage(config, context);

    expect(result.manifest.status).to.equal('pending-handoff');
    expect(result.manifest.handoffTransaction).to.equal(undefined);
    expect(result.manifest.manualActions).to.have.length(1);
    expect(result.manifest.manualActions[0].recipient).to.equal(safeAddress);
    const policy = await ethers.getContractAt('TDFTransferPolicy', result.manifest.contracts.TDFTransferPolicy.address);
    expect(await policy.transfersRestricted()).to.equal(false);
    expect(await policy.owner()).to.equal(deployer.address);
    expect(await policy.pendingOwner()).to.equal(safeAddress);

    const submitted = await submitOwnershipHandoff(result.manifest, context, {
      provider: {request: async () => undefined},
      signer: `0x${'11'.repeat(32)}`,
    });
    expect(prepareCalls).to.equal(1);
    expect(submitted.handoffTransaction?.proposal?.status).to.equal('submitted');
    expect(submitted.status).to.equal('pending-handoff');
  });

  it('completes deployer handoff after configuration and records manual acceptance calls', async function () {
    const [deployer, finalOwner, apiOperator, treasury, member, closerFeeRecipient] = await ethers.getSigners();
    const quoteToken = await ethers.deployContract('QuoteTokenMock', [18]);
    await quoteToken.waitForDeployment();
    const config = baseConfig('handoff-full', finalOwner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'tdf',
      finalOwner: {type: 'eoa', address: finalOwner.address},
      communityToken: {
        name: 'Handoff TDF',
        symbol: 'HTDF',
        initialSupply: parseEther('5381').toString(),
        maxSupply: parseEther('18600').toString(),
        initialRecipient: member.address,
      },
      presenceToken: {decayRatePerDay: 288_617},
      sweatToken: {decayRatePerDay: 288_617},
      tdfTransferPolicy: {treasury: treasury.address},
      dynamicPriceSale: {
        quoteToken: await quoteToken.getAddress(),
        villageTreasury: treasury.address,
        closerFeeRecipient: closerFeeRecipient.address,
        saleCap: parseEther('15097.5').toString(),
        minimumPurchase: parseEther('1').toString(),
        maximumPurchase: parseEther('100').toString(),
        purchaseGranularity: parseEther('1').toString(),
        maximumRecipientBalance: parseEther('915').toString(),
      },
    });
    const result = await deployVillage(config, deploymentContext(await outputRoot()));

    expect(result.manifest.status).to.equal('pending-handoff');
    expect(result.manifest.manualActions).to.have.length(8);
    expect(result.manifest.manualActions.map(({contractName}) => contractName)).to.include('VillageCitizenNFT');
    expect(result.manifest.manualActions.map(({functionName}) => functionName)).to.include.members([
      'acceptOwnership',
      'acceptDefaultAdminTransfer',
    ]);
    expect(result.manifest.manualActions.every(({recipient}) => recipient === finalOwner.address)).to.equal(true);

    const token = await ethers.getContractAt('CommunityToken', result.manifest.contracts.CommunityToken.address);
    const policy = await ethers.getContractAt('TDFTransferPolicy', result.manifest.contracts.TDFTransferPolicy.address);
    expect(await token.owner()).to.equal(deployer.address);
    expect(await token.pendingOwner()).to.equal(finalOwner.address);
    expect(await token.transferPolicy()).to.equal(await policy.getAddress());
    expect(await policy.transfersRestricted()).to.equal(true);
  });

  it('accepts an externally completed handoff on a later deployment reconciliation', async function () {
    const [, finalOwner, apiOperator] = await ethers.getSigners();
    const root = await outputRoot();
    const config = baseConfig('accepted-handoff', finalOwner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'token-village',
      finalOwner: {type: 'eoa', address: finalOwner.address},
    });
    const context = deploymentContext(root);
    const first = await deployVillage(config, context);
    expect(first.manifest.status).to.equal('pending-handoff');
    const accepted = await submitOwnershipHandoff(first.manifest, context);
    expect(accepted.status).to.equal('complete');

    const second = await deployVillage(config, context);
    const token = await ethers.getContractAt('CommunityToken', second.manifest.contracts.CommunityToken.address);
    const access = await ethers.getContractAt('VillageAccess', second.manifest.contracts.VillageAccess.address);
    expect(second.manifest.status).to.equal('complete');
    expect(await token.owner()).to.equal(finalOwner.address);
    expect(await token.pendingOwner()).to.equal(ZeroAddress);
    expect(await access.defaultAdmin()).to.equal(finalOwner.address);
  });

  it('validates a final Safe without requiring its signer during deployment', async function () {
    const [deployer, safeOwnerA, safeOwnerB, apiOperator] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('SafeMock', deployer);
    const safe = await factory.deploy();
    await safe.waitForDeployment();
    await (
      await safe.setup(
        [safeOwnerA.address, safeOwnerB.address],
        2,
        ZeroAddress,
        '0x',
        ZeroAddress,
        ZeroAddress,
        0,
        ZeroAddress,
      )
    ).wait();
    const config = baseConfig('safe-handoff', await safe.getAddress(), apiOperator.address, {
      chainId: await chainId(),
      finalOwner: {
        type: 'safe',
        address: await safe.getAddress(),
        expectedOwners: [safeOwnerA.address, safeOwnerB.address],
        expectedThreshold: 2,
      },
    });
    const result = await deployVillage(config, deploymentContext(await outputRoot()));
    expect(result.manifest.status).to.equal('pending-handoff');
    expect(result.manifest.manualActions).to.have.length(1);
    expect(result.manifest.manualActions[0].recipient).to.equal(await safe.getAddress());
  });
});
