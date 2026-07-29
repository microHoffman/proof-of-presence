import {spawn} from 'node:child_process';
import {closeSync, mkdtempSync, openSync, readFileSync} from 'node:fs';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect} from 'chai';

function runWorker(script: string, args: readonly string[]): Promise<{code: number | null; output: string}> {
  return new Promise((resolve, reject) => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'cli-validation-output-'));
    const outputPath = path.join(outputDirectory, 'worker.log');
    const outputDescriptor = openSync(outputPath, 'w');
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: process.cwd(),
      timeout: 30_000,
      stdio: ['ignore', outputDescriptor, outputDescriptor],
    });
    child.on('error', (error) => {
      closeSync(outputDescriptor);
      reject(error);
    });
    child.on('close', (code) => {
      closeSync(outputDescriptor);
      resolve({code, output: readFileSync(outputPath, 'utf8')});
    });
  });
}

async function rejectionMessage(promise: Promise<{code: number | null; output: string}>): Promise<string> {
  const result = await promise;
  expect(result.code).not.to.equal(0);
  return result.output;
}

describe('Deployment CLI validation', function () {
  it('rejects inherited object keys as unsupported contract modules', async function () {
    const message = await rejectionMessage(
      runWorker('scripts/deploy-contract.ts', ['--contract', 'toString', '--config', 'unused.json']),
    );
    expect(message).to.include("Unsupported contract Module 'toString'");
  });

  it('rejects non-minimal profiles for standalone contract deployment', async function () {
    const root = await mkdtemp(path.join(tmpdir(), 'standalone-profile-validation-'));
    const configPath = path.join(root, 'config.json');
    await writeFile(
      configPath,
      `${JSON.stringify({
        schemaVersion: 1,
        villageSlug: 'standalone-profile-validation',
        chainId: 31337,
        deploymentProfile: 'token-village',
        finalOwner: {type: 'eoa', address: '0x0000000000000000000000000000000000000001'},
        modules: [],
        apiOperator: '0x0000000000000000000000000000000000000002',
        communityToken: {maxSupply: '1000'},
        citizenNft: {baseURI: 'ipfs://citizens/'},
      })}\n`,
    );

    const message = await rejectionMessage(
      runWorker('scripts/deploy-contract.ts', ['--contract', 'CommunityToken', '--config', configPath]),
    );
    expect(message).to.include("Single-contract deployment requires deploymentProfile 'minimal-village'");
  });

  for (const [name, args, expected] of [
    ['unknown first argument', ['typo'], "Unknown argument 'typo'"],
    ['missing manifest value', ['--manifest'], '--manifest requires a path'],
    ['trailing argument', ['--manifest', 'manifest.json', '--typo'], "Unknown argument '--typo'"],
    ['removed submit option', ['--submit'], "Unknown argument '--submit'"],
  ] as const) {
    it(`rejects ${name}`, async function () {
      const message = await rejectionMessage(runWorker('scripts/verify-village.ts', args));
      expect(message).to.include(expected);
    });
  }
});
