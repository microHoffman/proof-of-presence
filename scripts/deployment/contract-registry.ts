/**
 * Canonical deployment and UUPS workflow metadata.
 *
 * Ignition still owns dependency ordering; this registry owns only stable contract identity,
 * upgrade-authority semantics, and the upgrade test implementation paired with each UUPS module.
 */
export const UUPS_CONTRACTS = {
  VillageAccess: {authority: 'default-admin', upgradeTestImplementation: 'VillageAccessUpgradeMock'},
  CommunityToken: {authority: 'ownable', upgradeTestImplementation: 'CommunityTokenUpgradeMock'},
  VillagePresenceToken: {authority: 'ownable', upgradeTestImplementation: 'PresenceTokenUpgradeMock'},
  VillageSweatToken: {authority: 'ownable', upgradeTestImplementation: 'SweatTokenUpgradeMock'},
  TokenizedStays: {authority: 'ownable', upgradeTestImplementation: 'TokenizedStaysUpgradeMock'},
  VillageCitizenNFT: {authority: 'ownable', upgradeTestImplementation: 'VillageCitizenNFTUpgradeMock'},
  DynamicPriceSale: {authority: 'ownable', upgradeTestImplementation: 'DynamicPriceSaleUpgradeMock'},
} as const;

export type UupsContractName = keyof typeof UUPS_CONTRACTS;

export const UUPS_CONTRACT_NAMES = Object.keys(UUPS_CONTRACTS) as UupsContractName[];
export const CONTRACT_NAMES = ['TDFTransferPolicy', ...UUPS_CONTRACT_NAMES] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];
