import {expect} from 'chai';
import {delayedOwnershipAcceptance} from '../../scripts/deployment/handoff.js';
import type {ManualAction} from '../../scripts/deployment/village.js';

function action(acceptAfter?: string): ManualAction {
  return {
    kind: 'ownership-acceptance',
    to: '0x0000000000000000000000000000000000000001',
    contractName: 'VillageAccess',
    functionName: 'acceptDefaultAdminTransfer',
    args: [],
    data: '0x',
    reason: 'Complete ownership handoff',
    recipient: '0x0000000000000000000000000000000000000002',
    acceptAfter,
  };
}

describe('Ownership handoff delay validation', function () {
  it('rejects malformed acceptance timestamps', function () {
    expect(() => delayedOwnershipAcceptance([action('not-a-date')], 1_000)).to.throw(
      "VillageAccess has an unparseable acceptAfter 'not-a-date'",
    );
  });

  it('returns only actions whose valid acceptance timestamp is still in the future', function () {
    expect(delayedOwnershipAcceptance([action('1970-01-01T00:16:39.000Z')], 1_000)).to.equal(undefined);
    const delayed = action('1970-01-01T00:16:41.000Z');
    expect(delayedOwnershipAcceptance([delayed], 1_000)).to.equal(delayed);
  });
});
