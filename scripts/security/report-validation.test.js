import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  baselineContractsMissingFromCurrent,
  loadStorageLayout,
  parseOsvReport,
  unexpectedErcFindingTypes,
} from './report-validation.js';

test('OSV reports fail closed on missing or malformed structure', () => {
  assert.throws(() => parseOsvReport(''), /no report output/);
  assert.throws(() => parseOsvReport('{'), /malformed JSON/);
  assert.throws(() => parseOsvReport('{}'), /results array/);
  assert.throws(() => parseOsvReport('{"results":[{}]}'), /packages array/);
  assert.throws(
    () => parseOsvReport('{"results":[{"packages":[{"package":{"ecosystem":"npm","name":"x","version":"1"}}]}]}'),
    /invalid package or vulnerabilities data/,
  );
  assert.deepEqual(parseOsvReport('{"results":[]}'), {results: []});
});

test('ERC reports reject unsuccessful, malformed, and unexpected findings', () => {
  assert.throws(() => unexpectedErcFindingTypes({}, []), /not a successful/);
  assert.throws(
    () => unexpectedErcFindingTypes({success: true, error: null, results: {'erc-conformance': {invalid: {}}}}, []),
    /invalid findings data/,
  );
  const report = {
    success: true,
    error: null,
    results: {'erc-conformance': {accepted: [{}], unexpected: [{}]}},
  };
  assert.deepEqual(unexpectedErcFindingTypes(report, ['accepted']), ['unexpected']);
});

test('storage layout resolution fails closed and accepts both Hardhat source-key forms', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'storage-layout-validation-'));
  const artifact = {buildInfoId: 'build', sourceName: 'src/Example.sol', contractName: 'Example'};
  assert.throws(() => loadStorageLayout({...artifact, buildInfoId: undefined}, root), /has no buildInfoId/);
  assert.throws(() => loadStorageLayout(artifact, root), /Missing/);

  const buildInfoPath = path.join(root, 'build.output.json');
  writeFileSync(buildInfoPath, JSON.stringify({output: {contracts: {}}}));
  assert.throws(() => loadStorageLayout(artifact, root), /no storageLayout/);

  const storageLayout = {storage: [], types: {}};
  writeFileSync(
    buildInfoPath,
    JSON.stringify({
      output: {contracts: {'project/src/Example.sol': {Example: {storageLayout}}}},
    }),
  );
  assert.deepEqual(loadStorageLayout(artifact, root), storageLayout);

  writeFileSync(
    buildInfoPath,
    JSON.stringify({
      output: {contracts: {'src/Example.sol': {Example: {storageLayout}}}},
    }),
  );
  assert.deepEqual(loadStorageLayout(artifact, root), storageLayout);
});

test('reverse artifact-baseline comparison reports contracts no longer analyzed', () => {
  assert.deepEqual(baselineContractsMissingFromCurrent({Current: {}, Removed: {}}, {Current: {}}), ['Removed']);
});
