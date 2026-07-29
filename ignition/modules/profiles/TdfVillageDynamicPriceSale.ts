import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import TdfDynamicPriceSaleModule from './TdfDynamicPriceSale.js';
import TdfVillageModule from './TdfVillage.js';

export const TDF_VILLAGE_DYNAMIC_PRICE_SALE_MODULE_ID = 'TdfVillageDynamicPriceSaleModule';

/** Sale-enabled TDF root graph composed from the reusable core TDF graph and its primary-sale graph. */
export default buildModule(TDF_VILLAGE_DYNAMIC_PRICE_SALE_MODULE_ID, (m) => {
  const village = m.useModule(TdfVillageModule);
  const sale = m.useModule(TdfDynamicPriceSaleModule);
  return {...village, ...sale};
});
