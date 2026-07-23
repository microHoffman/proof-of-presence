import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from '../contracts/VillageAccess.js';
import CommunityTokenModule from '../contracts/CommunityToken.js';
import TokenizedStaysModule from '../contracts/TokenizedStays.js';
import VillageCitizenNFTModule from '../contracts/VillageCitizenNFT.js';

export const TOKENIZED_STAYS_VILLAGE_MODULE_ID = 'TokenizedStaysVillageModule';

export default buildModule(TOKENIZED_STAYS_VILLAGE_MODULE_ID, (m) => {
  const {villageAccess, villageAccessImplementation, villageAccessProxy} = m.useModule(VillageAccessModule);
  const {communityToken, communityTokenImplementation, communityTokenProxy} = m.useModule(CommunityTokenModule);
  const {tokenizedStays, tokenizedStaysImplementation, tokenizedStaysProxy} = m.useModule(TokenizedStaysModule);
  const {citizenNft, citizenNftImplementation, citizenNftProxy} = m.useModule(VillageCitizenNFTModule);
  return {
    villageAccess,
    villageAccessImplementation,
    villageAccessProxy,
    communityToken,
    communityTokenImplementation,
    communityTokenProxy,
    tokenizedStays,
    tokenizedStaysImplementation,
    tokenizedStaysProxy,
    citizenNft,
    citizenNftImplementation,
    citizenNftProxy,
  };
});
