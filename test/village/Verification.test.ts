import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {expect} from 'chai';
import {verifyIgnitionDeployment} from '../../scripts/deployment/verification.js';

function fakeChild() {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let killed = false;
  return {
    child: Object.assign(events, {
      stdout,
      stderr,
      kill: () => {
        killed = true;
        return true;
      },
    }),
    stdout,
    stderr,
    wasKilled: () => killed,
  };
}

describe('Ignition verification process handling', function () {
  it('captures output and succeeds only for exit code zero', async function () {
    const fake = fakeChild();
    const attemptPromise = verifyIgnitionDeployment('celo', 'village-1', {
      timeoutMs: 1_000,
      spawnProcess: () => fake.child as never,
    });
    fake.stdout.write('verified');
    fake.stderr.write(' with warning');
    fake.child.emit('close', 0);

    const attempt = await attemptPromise;
    expect(attempt.status).to.equal('success');
    expect(attempt.output).to.equal('verified with warning');
  });

  it('returns spawn errors as one failed attempt even if close follows', async function () {
    const fake = fakeChild();
    const attemptPromise = verifyIgnitionDeployment('celo', 'village-2', {
      timeoutMs: 1_000,
      spawnProcess: () => fake.child as never,
    });
    fake.child.emit('error', new Error('npx is unavailable'));
    fake.child.emit('close', 0);

    const attempt = await attemptPromise;
    expect(attempt.status).to.equal('failed');
    expect(attempt.output).to.include('npx is unavailable');
  });

  it('returns synchronous spawn failures instead of rejecting', async function () {
    const attempt = await verifyIgnitionDeployment('celo', 'village-3', {
      timeoutMs: 1_000,
      spawnProcess: () => {
        throw new Error('permission denied');
      },
    });

    expect(attempt.status).to.equal('failed');
    expect(attempt.output).to.include('permission denied');
  });

  it('terminates and fails a hung verification process', async function () {
    const fake = fakeChild();
    const attempt = await verifyIgnitionDeployment('celo', 'village-4', {
      timeoutMs: 5,
      spawnProcess: () => fake.child as never,
    });

    expect(attempt.status).to.equal('failed');
    expect(attempt.output).to.include('Verification timed out after 5ms');
    expect(fake.wasKilled()).to.equal(true);
  });
});
