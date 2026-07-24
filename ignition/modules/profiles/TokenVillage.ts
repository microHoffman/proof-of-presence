import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from '../contracts/VillageAccess.js';
import CommunityTokenModule from '../contracts/CommunityToken.js';
import VillageCitizenNFTModule from '../contracts/VillageCitizenNFT.js';

export const TOKEN_VILLAGE_MODULE_ID = 'TokenVillageModule';

export default buildModule(TOKEN_VILLAGE_MODULE_ID, (m) => {
  const {villageAccess, villageAccessImplementation, villageAccessProxy} = m.useModule(VillageAccessModule);
  const {communityToken, communityTokenImplementation, communityTokenProxy} = m.useModule(CommunityTokenModule);
  const {citizenNft, citizenNftImplementation, citizenNftProxy} = m.useModule(VillageCitizenNFTModule);
  return {
    villageAccess,
    villageAccessImplementation,
    villageAccessProxy,
    communityToken,
    communityTokenImplementation,
    communityTokenProxy,
    citizenNft,
    citizenNftImplementation,
    citizenNftProxy,
  };
});
