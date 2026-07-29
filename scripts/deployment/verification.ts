import {spawn} from 'node:child_process';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type VillageDeploymentManifest,
} from './village.js';

export interface IgnitionVerificationAttempt {
  status: 'success' | 'failed' | 'skipped';
  attemptedAt: string;
  network: string;
  deploymentId: string;
  command: string[];
  output: string;
}

interface VerificationChildProcess {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface IgnitionVerificationOptions {
  timeoutMs?: number;
  spawnProcess?: (command: string, args: string[]) => VerificationChildProcess;
}

const IGNITION_VERIFICATION_TIMEOUT_MS = 10 * 60_000;

function spawnVerificationProcess(command: string, args: string[]): VerificationChildProcess {
  return spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
}

/**
 * Runs the same best-effort Ignition verification task for initial submission and later retries.
 * Explorer failures are returned as attempts rather than thrown so deployment completion does not depend on explorer uptime.
 */
export async function verifyIgnitionDeployment(
  network: string,
  deploymentId: string,
  options: IgnitionVerificationOptions = {},
): Promise<IgnitionVerificationAttempt> {
  const command = ['npx', '--no-install', 'hardhat', '--network', network, 'ignition', 'verify', deploymentId];
  if (['default', 'localhost'].includes(network)) {
    return {
      status: 'skipped',
      attemptedAt: new Date().toISOString(),
      network,
      deploymentId,
      command,
      output: 'Verification is skipped for ephemeral/local networks.',
    };
  }

  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    let child: VerificationChildProcess;
    const finish = (status: IgnitionVerificationAttempt['status']) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        status,
        attemptedAt: new Date().toISOString(),
        network,
        deploymentId,
        command,
        output,
      });
    };
    const timeout = setTimeout(() => {
      output += `\nVerification timed out after ${options.timeoutMs ?? IGNITION_VERIFICATION_TIMEOUT_MS}ms.`;
      finish('failed');
      child.kill('SIGTERM');
    }, options.timeoutMs ?? IGNITION_VERIFICATION_TIMEOUT_MS);

    try {
      child = (options.spawnProcess ?? spawnVerificationProcess)(command[0], command.slice(1));
    } catch (error) {
      output += error instanceof Error ? error.message : String(error);
      finish('failed');
      return;
    }
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      output += `\n${error.message}`;
      finish('failed');
    });
    child.on('close', (code) => {
      finish(code === 0 ? 'success' : 'failed');
    });
  });
}

export async function recordIgnitionVerification(
  manifestPath: string,
  attempt: IgnitionVerificationAttempt,
): Promise<VillageDeploymentManifest> {
  const manifest = await readVillageDeploymentManifest(manifestPath);
  manifest.verification.attempts.push({
    status: attempt.status,
    attemptedAt: attempt.attemptedAt,
    network: attempt.network,
    deploymentId: attempt.deploymentId,
    command: attempt.command,
    // Keep the useful command tail without allowing explorer output to grow the manifest indefinitely.
    summary: attempt.output.trim().slice(-2_000),
  });
  await writeVillageDeploymentManifest(manifestPath, manifest);
  return manifest;
}

export async function attemptAutomaticVerification(
  manifestPath: string,
  manifest: VillageDeploymentManifest,
): Promise<IgnitionVerificationAttempt> {
  const attempt = await verifyIgnitionDeployment(manifest.network, manifest.deploymentTool.deploymentId);
  await recordIgnitionVerification(manifestPath, attempt);
  return attempt;
}
