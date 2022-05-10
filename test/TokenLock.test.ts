import {expect} from './chai-setup';
import {deployments, getUnnamedAccounts, ethers, network, getNamedAccounts} from 'hardhat';
import {TDFToken, TokenLock} from '../typechain';
import {setupUser, setupUsers} from './utils';
import {Contract} from 'ethers';
import {parseEther} from 'ethers/lib/utils';
import {addDays, getUnixTime} from 'date-fns';
import {parse} from 'path';
const BN = ethers.BigNumber;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMock(name: string, deployer: string, args: Array<any>): Promise<Contract> {
  await deployments.deploy(name, {from: deployer, args: args});
  return ethers.getContract(name, deployer);
}

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer, TDFTokenBeneficiary} = accounts;

  const token: TDFToken = await ethers.getContract('TDFToken', deployer);
  const contracts = {
    TDFToken: token,
    TokenLock: <TokenLock>await getMock('TokenLock', deployer, [token.address, 1]),
  };

  const tokenBeneficiary = await setupUser(TDFTokenBeneficiary, contracts);

  const conf = {
    ...contracts,
    users: await setupUsers(users, contracts),
    deployer: await setupUser(deployer, contracts),
    TDFTokenBeneficiary: tokenBeneficiary,
    accounts,
  };
  // fund users with TDF token
  await Promise.all(
    users.map((e) => {
      return conf.TDFTokenBeneficiary.TDFToken.transfer(e, parseEther('10000'));
    })
  );
  return conf;
});

const incDays = async (days: number) => {
  // suppose the current block has a timestamp of 01:00 PM
  await network.provider.send('evm_increaseTime', [days * 86400]);
  await network.provider.send('evm_mine');
};

const buildDates = (initDate: Date, amount: number) => {
  const acc = [];
  for (let i = 0; i < amount; i++) {
    acc.push(getUnixTime(addDays(initDate, i)));
  }
  return acc;
};
const buildDate = (offset: number) => {
  const initDate = Date.now();
  return getUnixTime(addDays(initDate, offset));
};

const timeTravelTo = async (time: number) => {
  await network.provider.send('evm_setNextBlockTimestamp', [time]);
  await network.provider.send('evm_mine');
};

const setupHelpers = async ({
  stakeContract,
  tokenContract,
  user,
  admin,
}: {
  stakeContract: TokenLock;
  tokenContract: TDFToken;
  user: {address: string; TokenLock: TokenLock};
  admin?: {address: string; TokenLock: TokenLock};
}) => {
  return {
    testBalances: async (TK: string, tkU: string, u: string) => {
      expect(await tokenContract.balanceOf(stakeContract.address)).to.eq(parseEther(TK));
      expect(await stakeContract.balanceOf(user.address)).to.eq(parseEther(tkU));
      expect(await tokenContract.balanceOf(user.address)).to.eq(parseEther(u));
    },
    testStake: async (locked: string, unlocked: string) => {
      expect(await stakeContract.lockedAmount(user.address)).to.eq(parseEther(locked));
      expect(await stakeContract.unlockedAmount(user.address)).to.eq(parseEther(unlocked));
    },
    testDeposits: async (examples: [string, number][]) => {
      const deposits = await stakeContract.depositsFor(user.address);
      for (let i = 0; i < deposits.length; i++) {
        expect(deposits[i].amount).to.eq(parseEther(examples[i][0]));
        expect(deposits[i].timestamp).to.eq(BN.from(examples[i][1]));
      }
    },
    deposit: async (amount: string) => {
      await expect(user.TokenLock.deposit(parseEther(amount)))
        .to.emit(stakeContract, 'DepositedTokens')
        .withArgs(user.address, parseEther(amount));
    },
    withdrawMax: {
      success: async (amount: string) => {
        await expect(user.TokenLock.withdrawMax())
          .to.emit(stakeContract, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      none: async () => {
        await expect(user.TokenLock.withdrawMax()).to.not.emit(stakeContract, 'WithdrawnTokens');
      },
    },
    withdraw: {
      success: async (amount: string) => {
        await expect(user.TokenLock.withdraw(parseEther(amount)))
          .to.emit(stakeContract, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      reverted: async (amount: string) => {
        await expect(user.TokenLock.withdraw(parseEther(amount))).to.be.revertedWith('NOT_ENOUGHT_UNLOCKABLE_BALANCE');
      },
    },
    restakeMax: async () => {
      await user.TokenLock.restakeMax();
    },
    restake: {
      reverted: async (amount: string) => {
        await expect(user.TokenLock.restake(parseEther(amount))).to.be.revertedWith('NOT_ENOUGHT_UNLOCKABLE_BALANCE');
      },
      success: async (amount: string) => {
        await user.TokenLock.restake(parseEther(amount));
      },
    },
    restakeOrDepositAtFor: async (amount: string, initLockAt: number) => {
      if (admin) {
        await admin.TokenLock.restakeOrDepositAtFor(user.address, parseEther(amount), initLockAt);
      } else {
        throw 'No admin Set';
      }
    },
  };
};

describe('TokenLock', () => {
  it('lock and unlockMax', async () => {
    const {users, TokenLock, TDFToken} = await setup();

    const user = users[0];
    const {testBalances, deposit, withdrawMax} = await setupHelpers({
      stakeContract: TokenLock,
      tokenContract: TDFToken,
      user: user,
    });

    expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther('10000'));
    await testBalances('0', '0', '10000');

    await user.TDFToken.approve(user.TokenLock.address, parseEther('10'));
    await deposit('1');

    await testBalances('1', '1', '9999');

    await withdrawMax.none();
    await testBalances('1', '1', '9999');

    await incDays(1);
    await deposit('1');
    await testBalances('2', '2', '9998');
    await withdrawMax.success('1');
    await testBalances('1', '1', '9999');

    await incDays(1);
    await withdrawMax.success('1');
    await testBalances('0', '0', '10000');

    await expect(user.TokenLock.withdrawMax()).to.be.revertedWith('NOT_ENOUGHT_BALANCE');
  });
  it('lock and unlock', async () => {
    const {users, TokenLock, TDFToken} = await setup();

    const user = users[0];
    const {testBalances, deposit, withdraw, withdrawMax} = await setupHelpers({
      stakeContract: TokenLock,
      tokenContract: TDFToken,
      user: user,
    });

    expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther('10000'));
    await testBalances('0', '0', '10000');

    await user.TDFToken.approve(user.TokenLock.address, parseEther('10'));

    ///////////////////////////////////////////////
    //                DAY 0
    // ------------------------------------------
    // Before: NOTHING
    // During:
    //     - lock 1 token
    // After:
    //     - 1 token unlockable
    ///////////////////////////////////////////////
    await deposit('1');
    await testBalances('1', '1', '9999');
    await withdraw.reverted('0.5');
    // Does not change the balances, nothing to unlock
    await testBalances('1', '1', '9999');

    ///////////////////////////////////////////////
    //  DAY 1
    ///////////////////////////////////////////////
    await incDays(1);
    await deposit('1');

    await testBalances('2', '2', '9998');

    expect(await TokenLock.unlockedAmount(user.address)).to.eq(parseEther('1'));
    // we only have available 1
    // we are not able to redeem more than 1
    // So trying to remove more will be reverted
    await withdraw.reverted('1.5');
    // With the balances unchaded
    await testBalances('2', '2', '9998');
    // remove in lower bound of pocket
    await withdraw.success('0.5');
    await testBalances('1.5', '1.5', '9998.5');

    ///////////////////////////////////////////////
    //  DAY 2
    // --------------------------------------------
    // Now we have two buckets
    // 1) with 0.5
    // 2) with 1
    // remove in the upper bound
    // 0.5 + 0.75 = 1.25
    // reminder of 0.25
    ///////////////////////////////////////////////
    await incDays(1);
    await withdraw.success('1.25');

    await testBalances('0.25', '0.25', '9999.75');
    // Add more balance to stress test
    await deposit('1.5');

    await testBalances('1.75', '1.75', '9998.25');
    await withdrawMax.success('0.25');
    await testBalances('1.5', '1.5', '9998.50');
    await incDays(1);
    ///////////////////////////////////////////////
    //  DAY 3
    // Unlock all
    ///////////////////////////////////////////////
    await withdraw.success('1.3');

    await testBalances('0.2', '0.2', '9999.8');
    await withdrawMax.success('0.2');
    await testBalances('0', '0', '10000');
  });

  it('restakeMax', async () => {
    const {users, TokenLock, TDFToken} = await setup();
    const user = users[0];

    const {testBalances, testStake, deposit, restakeMax, withdrawMax} = await setupHelpers({
      stakeContract: TokenLock,
      tokenContract: TDFToken,
      user: user,
    });

    expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther('10000'));
    await testBalances('0', '0', '10000');

    await user.TDFToken.approve(user.TokenLock.address, parseEther('10'));
    await deposit('1');

    await testBalances('1', '1', '9999');
    await testStake('1', '0');
    await incDays(1);
    await deposit('0.5');
    await testBalances('1.5', '1.5', '9998.5');
    await testStake('0.5', '1');
    await restakeMax();
    await testBalances('1.5', '1.5', '9998.5');
    await testStake('1.5', '0');
    await incDays(1);
    await withdrawMax.success('1.5');
    await testBalances('0', '0', '10000');
    await testStake('0', '0');
  });
  it('restake(uint256 amount)', async () => {
    const {users, TokenLock, TDFToken} = await setup();
    const user = users[0];
    const {testBalances, testStake, deposit, restakeMax, restake, withdraw, withdrawMax} = await setupHelpers({
      stakeContract: TokenLock,
      tokenContract: TDFToken,
      user: user,
    });

    expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther('10000'));
    await testBalances('0', '0', '10000');

    await user.TDFToken.approve(user.TokenLock.address, parseEther('10'));
    ///////////////////////////////////////////////
    //                DAY 0
    ///////////////////////////////////////////////
    await deposit('1');

    await testBalances('1', '1', '9999');
    await testStake('1', '0');
    // Restake max without any untied amount
    await restakeMax();
    // Results in nothing changes
    await testBalances('1', '1', '9999');
    await testStake('1', '0');

    await incDays(1);
    ///////////////////////////////////////////////
    //                DAY 1
    ///////////////////////////////////////////////
    await deposit('0.5');

    await testBalances('1.5', '1.5', '9998.5');
    await testStake('0.5', '1');
    // Trying to restake more than unlocked will revert
    await restake.reverted('1.5');
    await testBalances('1.5', '1.5', '9998.5');
    await testStake('0.5', '1');
    await incDays(1);
    ///////////////////////////////////////////////
    //                DAY 2
    ///////////////////////////////////////////////
    await testBalances('1.5', '1.5', '9998.5');
    await testStake('0', '1.5');

    await restake.success('0.5');
    await testBalances('1.5', '1.5', '9998.5');
    await testStake('0.5', '1');
    await withdraw.success('0.25');
    // await user.TokenLock.withdraw(parseEther('0.25'));
    await testBalances('1.25', '1.25', '9998.75');
    await testStake('0.5', '0.75');
    await withdrawMax.success('0.75');
    await testBalances('0.5', '0.5', '9999.5');
    await testStake('0.5', '0');
    ///////////////////////////////////////////////
    //                DAY 3
    ///////////////////////////////////////////////
    await incDays(1);
    await withdrawMax.success('0.5');
    await testBalances('0', '0', '10000');
    await testStake('0', '0');
  });

  it('restakeOrDepositAt', async () => {
    const {users, TokenLock, TDFToken, deployer} = await setup();
    const user = users[0];
    const {testBalances, testStake, testDeposits, restakeOrDepositAtFor, withdraw, withdrawMax} = await setupHelpers({
      stakeContract: TokenLock,
      tokenContract: TDFToken,
      user: user,
      admin: deployer,
    });

    expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther('10000'));
    await testBalances('0', '0', '10000');

    // await user.TDFToken.approve(deployer.address, parseEther('10'));
    await user.TDFToken.approve(TokenLock.address, parseEther('10'));

    let initLockAt = buildDate(3);

    ///////////////////////////////////////////////
    //                DAY 0
    // --------------------------------------------
    // With 0 stake, restake transfers Token to contract
    ///////////////////////////////////////////////
    await restakeOrDepositAtFor('1', initLockAt);
    await testBalances('1', '1', '9999');

    await testDeposits([['1', initLockAt]]);
    await testStake('1', '0');

    ///////////////////////////////////////////////
    //                DAY 1
    // --------------------------------------------
    // Can not unstake since we staked in the future
    ///////////////////////////////////////////////
    await incDays(1);
    await withdraw.reverted('0.5');
    await testBalances('1', '1', '9999');
    await testDeposits([['1', initLockAt]]);
    await testStake('1', '0');
    ///////////////////////////////////////////////
    //                DAY 4
    // --------------------------------------------
    // Can withdraw 1
    //
    ///////////////////////////////////////////////
    await incDays(4);

    await withdraw.success('0.5');
    await testBalances('0.5', '0.5', '9999.5');
    await testDeposits([['0.5', initLockAt]]);
    await testStake('0', '0.5');

    // ------ Can reStake to the future current staked

    initLockAt = buildDate(6);
    await restakeOrDepositAtFor('0.5', initLockAt);

    await testBalances('0.5', '0.5', '9999.5');
    await testDeposits([['0.5', initLockAt]]);
    await testStake('0.5', '0');
    // can not unstake
    await withdrawMax.none();
    await testBalances('0.5', '0.5', '9999.5');
    await testDeposits([['0.5', initLockAt]]);
    await testStake('0.5', '0');
    ///////////////////////////////////////////////
    //                DAY 4 - CONT Restake locked
    // --------------------------------------------
    // mixed restake (token transfer, restake)
    // locked 0.5
    ///////////////////////////////////////////////
    initLockAt = buildDate(8);
    await restakeOrDepositAtFor('1', initLockAt);
    await testBalances('1', '1', '9999');
    await testStake('1', '0');
    await testDeposits([
      ['0.5', initLockAt],
      ['0.5', initLockAt],
    ]);
  });

  it('getters', async () => {});

  it('ownable', async () => {});

  it('pausable', async () => {});
});
