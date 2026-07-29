import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import type {IgnitionModule, IgnitionModuleResult} from '@nomicfoundation/ignition-core';
import type {NormalizedModules} from '../../../scripts/deployment/village.js';
import VillageAccessModule from '../contracts/VillageAccess.js';
import CommunityTokenModule from '../contracts/CommunityToken.js';
import DynamicPriceSaleModule from '../contracts/DynamicPriceSale.js';
import VillagePresenceTokenModule from '../contracts/VillagePresenceToken.js';
import VillageSweatTokenModule from '../contracts/VillageSweatToken.js';
import TokenizedStaysModule from '../contracts/TokenizedStays.js';
import VillageCitizenNFTModule from '../contracts/VillageCitizenNFT.js';
import TDFTransferPolicyModule from '../contracts/TDFTransferPolicy.js';
import MinimalVillageModule from './MinimalVillage.js';
import TokenVillageModule from './TokenVillage.js';
import TokenizedStaysVillageModule from './TokenizedStaysVillage.js';
import TdfCommunityTokenModule from './TdfCommunityToken.js';
import TdfExternalDynamicPriceSaleModule from './TdfExternalDynamicPriceSale.js';
import TdfTokenizedStaysModule from './TdfTokenizedStays.js';
import TdfVillageModule from './TdfVillage.js';
import TdfVillageDynamicPriceSaleModule from './TdfVillageDynamicPriceSale.js';

function deploymentBits(modules: NormalizedModules): string {
  // Stable seven-bit order: community, presence, sweat, stays, TDF policy, citizen, sale.
  return [
    modules.communityToken,
    modules.presenceToken,
    modules.sweatToken,
    modules.tokenizedStays,
    modules.tdfTransferPolicy,
    modules.citizenNft,
    modules.dynamicPriceSale,
  ]
    .map((enabled) => (enabled ? '1' : '0'))
    .join('');
}

/**
 * Selects a static, stable graph while still supporting village-specific module combinations.
 * Known profiles reuse named Modules; other combinations receive a deterministic ID so reruns resume the same journal.
 */
export function selectVillageProfileModule(modules: NormalizedModules, tdfProfile = false): IgnitionModule {
  const bits = deploymentBits(modules);
  if (!modules.dynamicPriceSale) {
    if (bits === '0000100') return TDFTransferPolicyModule;
    if (bits === '0000000') return MinimalVillageModule;
    if (bits === '1000010') return TokenVillageModule;
    if (bits === '1001010') return TokenizedStaysVillageModule;
    if (bits === '1111110') return TdfVillageModule;
  }
  if (bits === '1111111' && tdfProfile) return TdfVillageDynamicPriceSaleModule;

  return buildModule(`CustomVillageModule_v2_${bits}`, (m) => {
    const results: IgnitionModuleResult<string> = {};
    Object.assign(results, m.useModule(VillageAccessModule));
    if (modules.communityToken && modules.tdfTransferPolicy) {
      Object.assign(results, m.useModule(modules.tokenizedStays ? TdfTokenizedStaysModule : TdfCommunityTokenModule));
    } else if (modules.communityToken) {
      Object.assign(results, m.useModule(CommunityTokenModule));
    }
    if (modules.presenceToken) Object.assign(results, m.useModule(VillagePresenceTokenModule));
    if (modules.sweatToken) Object.assign(results, m.useModule(VillageSweatTokenModule));
    if (modules.citizenNft) Object.assign(results, m.useModule(VillageCitizenNFTModule));
    if (modules.tokenizedStays && !modules.tdfTransferPolicy) {
      Object.assign(results, m.useModule(TokenizedStaysModule));
    }
    if (modules.tdfTransferPolicy && !modules.communityToken) {
      Object.assign(results, m.useModule(TDFTransferPolicyModule));
    }
    if (modules.dynamicPriceSale) {
      Object.assign(
        results,
        m.useModule(modules.tdfTransferPolicy ? TdfExternalDynamicPriceSaleModule : DynamicPriceSaleModule),
      );
    }
    return results;
  });
}
