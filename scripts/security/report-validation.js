import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

export function parseOsvReport(output) {
  if (!output?.trim()) {
    throw new Error('OSV-Scanner produced no report output; refusing to evaluate or update the dependency baseline.');
  }

  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    throw new Error(`OSV-Scanner produced malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!report || typeof report !== 'object' || !Array.isArray(report.results)) {
    throw new Error('OSV-Scanner report must be an object with a results array.');
  }
  for (const [resultIndex, scanResult] of report.results.entries()) {
    if (!scanResult || typeof scanResult !== 'object' || !Array.isArray(scanResult.packages)) {
      throw new Error(`OSV-Scanner result ${resultIndex} must contain a packages array.`);
    }
    for (const [packageIndex, packageResult] of scanResult.packages.entries()) {
      const packageInfo = packageResult?.package;
      if (
        !packageInfo ||
        typeof packageInfo.ecosystem !== 'string' ||
        typeof packageInfo.name !== 'string' ||
        typeof packageInfo.version !== 'string' ||
        !Array.isArray(packageResult.vulnerabilities)
      ) {
        throw new Error(
          `OSV-Scanner result ${resultIndex} package ${packageIndex} has invalid package or vulnerabilities data.`,
        );
      }
    }
  }
  return report;
}

export function unexpectedErcFindingTypes(report, acceptedFindingTypes) {
  const conformance = report?.results?.['erc-conformance'];
  if (
    report?.success !== true ||
    report?.error !== null ||
    !conformance ||
    typeof conformance !== 'object' ||
    Array.isArray(conformance)
  ) {
    throw new Error('Report is not a successful Slither ERC-conformance report.');
  }
  for (const [findingType, findings] of Object.entries(conformance)) {
    if (!Array.isArray(findings)) throw new Error(`Report has invalid findings data for '${findingType}'.`);
  }
  return Object.entries(conformance)
    .filter(([, findings]) => findings.length > 0)
    .map(([findingType]) => findingType)
    .filter((findingType) => !acceptedFindingTypes.includes(findingType));
}

export function loadStorageLayout(artifact, buildInfoRoot = 'artifacts/build-info') {
  if (!artifact.buildInfoId) {
    throw new Error(
      `${artifact.contractName}: artifact has no buildInfoId; recompile with \`hardhat compile --force\`.`,
    );
  }
  const buildInfoPath = path.join(buildInfoRoot, `${artifact.buildInfoId}.output.json`);
  if (!existsSync(buildInfoPath)) throw new Error(`Missing ${buildInfoPath} for ${artifact.contractName}.`);
  const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
  const contracts = buildInfo.output?.contracts ?? {};
  const source =
    contracts[`project/${artifact.sourceName}`]?.[artifact.contractName] ??
    contracts[artifact.sourceName]?.[artifact.contractName];
  if (!source?.storageLayout) {
    throw new Error(
      `${artifact.contractName}: no storageLayout in ${buildInfoPath}; enable the storageLayout compiler output.`,
    );
  }
  return source.storageLayout;
}

export function baselineContractsMissingFromCurrent(baselineContracts, currentContracts) {
  return Object.keys(baselineContracts).filter((contractName) => !currentContracts[contractName]);
}
