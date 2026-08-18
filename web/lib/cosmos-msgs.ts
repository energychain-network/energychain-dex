// Catalogue of EnergyChain native Msg types: proto type URL + scalar field
// layout. Field numbers/types mirror chain/proto/energychain/<module>/v1/tx.proto.
// Used to build the CosmJS signing Registry (see lib/cosmos.ts) and to give the
// UI a typed surface for building messages.

import { FieldSpec, makeType } from './proto';

export interface MsgDef {
  typeUrl: string;
  fields: FieldSpec[];
}

const f = (no: number, name: string, type: FieldSpec['type']): FieldSpec => ({ no, name, type });

// OrderSide enum values (market).
export const OrderSide = { BUY: 1, SELL: 2 } as const;

export const MSGS = {
  // ---- market (order book) ------------------------------------------------
  CreateMarket: {
    typeUrl: '/energychain.market.v1.MsgCreateMarket',
    fields: [
      f(1, 'authority', 'string'), f(2, 'baseDenom', 'string'), f(3, 'quoteDenom', 'string'),
      f(4, 'feeBps', 'uint32'), f(5, 'minBaseQty', 'uint64'), f(6, 'batchInterval', 'int64'),
      f(7, 'requireKyc', 'bool'), f(8, 'policyId', 'string'), f(9, 'operator', 'string'),
    ],
  },
  // Operator escrows params.listing_bond to open a PENDING_BOND market.
  PostBond: {
    typeUrl: '/energychain.market.v1.MsgPostBond',
    fields: [f(1, 'operator', 'string'), f(2, 'marketId', 'uint64')],
  },
  PlaceOrder: {
    typeUrl: '/energychain.market.v1.MsgPlaceOrder',
    fields: [f(1, 'owner', 'string'), f(2, 'marketId', 'uint64'), f(3, 'side', 'enum'), f(4, 'price', 'uint64'), f(5, 'quantity', 'uint64')],
  },
  CancelOrder: {
    typeUrl: '/energychain.market.v1.MsgCancelOrder',
    fields: [f(1, 'owner', 'string'), f(2, 'orderId', 'uint64')],
  },

  // ---- stableusd ----------------------------------------------------------
  CreateDenom: {
    typeUrl: '/energychain.stableusd.v1.MsgCreateDenom',
    fields: [f(1, 'authority', 'string'), f(2, 'id', 'string'), f(3, 'symbol', 'string'), f(4, 'decimals', 'uint32'), f(5, 'pegCurrency', 'string'), f(6, 'admin', 'string'), f(7, 'policyId', 'string')],
  },
  StableMint: {
    typeUrl: '/energychain.stableusd.v1.MsgMint',
    fields: [f(1, 'minter', 'string'), f(2, 'denomId', 'string'), f(3, 'recipient', 'string'), f(4, 'amount', 'uint64')],
  },
  StableBurn: {
    typeUrl: '/energychain.stableusd.v1.MsgBurn',
    fields: [f(1, 'holder', 'string'), f(2, 'denomId', 'string'), f(3, 'amount', 'uint64')],
  },
  StableTransfer: {
    typeUrl: '/energychain.stableusd.v1.MsgTransfer',
    fields: [f(1, 'from', 'string'), f(2, 'denomId', 'string'), f(3, 'to', 'string'), f(4, 'amount', 'uint64')],
  },
  StableRequestRedemption: {
    typeUrl: '/energychain.stableusd.v1.MsgRequestRedemption',
    fields: [f(1, 'holder', 'string'), f(2, 'denomId', 'string'), f(3, 'amount', 'uint64'), f(4, 'memo', 'string')],
  },

  // ---- rwatoken -----------------------------------------------------------
  CreateToken: {
    typeUrl: '/energychain.rwatoken.v1.MsgCreateToken',
    fields: [
      f(1, 'admin', 'string'), f(2, 'symbol', 'string'), f(3, 'name', 'string'), f(4, 'assetClass', 'string'),
      f(5, 'decimals', 'uint32'), f(6, 'settlementDenom', 'string'), f(7, 'policyId', 'string'), f(8, 'requireKyc', 'bool'),
      f(9, 'redemptionPrice', 'uint64'), f(10, 'redemptionDelaySeconds', 'int64'), f(11, 'perHolderCap', 'uint64'), f(12, 'metadataUri', 'string'),
    ],
  },
  RwaMint: {
    typeUrl: '/energychain.rwatoken.v1.MsgMint',
    fields: [f(1, 'admin', 'string'), f(2, 'tokenId', 'uint64'), f(3, 'recipient', 'string'), f(4, 'amount', 'uint64')],
  },
  RwaTransfer: {
    typeUrl: '/energychain.rwatoken.v1.MsgTransfer',
    fields: [f(1, 'from', 'string'), f(2, 'tokenId', 'uint64'), f(3, 'to', 'string'), f(4, 'amount', 'uint64')],
  },
  TakeSnapshot: {
    typeUrl: '/energychain.rwatoken.v1.MsgTakeSnapshot',
    fields: [f(1, 'admin', 'string'), f(2, 'tokenId', 'uint64')],
  },
  CreateDistribution: {
    typeUrl: '/energychain.rwatoken.v1.MsgCreateDistribution',
    fields: [f(1, 'admin', 'string'), f(2, 'tokenId', 'uint64'), f(3, 'snapshotId', 'uint64'), f(4, 'totalAmount', 'uint64')],
  },
  ClaimDistribution: {
    typeUrl: '/energychain.rwatoken.v1.MsgClaimDistribution',
    fields: [f(1, 'holder', 'string'), f(2, 'distributionId', 'uint64')],
  },
  FundPool: {
    typeUrl: '/energychain.rwatoken.v1.MsgFundPool',
    fields: [f(1, 'admin', 'string'), f(2, 'tokenId', 'uint64'), f(3, 'amount', 'uint64')],
  },
  RwaRequestRedemption: {
    typeUrl: '/energychain.rwatoken.v1.MsgRequestRedemption',
    fields: [f(1, 'holder', 'string'), f(2, 'tokenId', 'uint64'), f(3, 'units', 'uint64')],
  },
  RwaExecuteRedemption: {
    typeUrl: '/energychain.rwatoken.v1.MsgExecuteRedemption',
    fields: [f(1, 'executor', 'string'), f(2, 'redemptionId', 'uint64')],
  },

  // ---- offering -----------------------------------------------------------
  CreateOffering: {
    typeUrl: '/energychain.offering.v1.MsgCreateOffering',
    fields: [
      f(1, 'issuer', 'string'), f(2, 'tokenId', 'uint64'), f(3, 'unitPrice', 'uint64'), f(4, 'softCap', 'uint64'),
      f(5, 'hardCap', 'uint64'), f(6, 'startTime', 'int64'), f(7, 'endTime', 'int64'), f(8, 'totalTranches', 'uint32'),
      f(9, 'requiredInjection', 'uint64'), f(10, 'injectionInterval', 'int64'),
    ],
  },
  Subscribe: {
    typeUrl: '/energychain.offering.v1.MsgSubscribe',
    fields: [f(1, 'investor', 'string'), f(2, 'offeringId', 'uint64'), f(3, 'amount', 'uint64')],
  },
  ClaimAllocation: {
    typeUrl: '/energychain.offering.v1.MsgClaimAllocation',
    fields: [f(1, 'investor', 'string'), f(2, 'offeringId', 'uint64')],
  },
  ClaimReturns: {
    typeUrl: '/energychain.offering.v1.MsgClaimReturns',
    fields: [f(1, 'investor', 'string'), f(2, 'offeringId', 'uint64')],
  },
  ClaimRefund: {
    typeUrl: '/energychain.offering.v1.MsgClaimRefund',
    fields: [f(1, 'investor', 'string'), f(2, 'offeringId', 'uint64')],
  },
  InjectReturn: {
    typeUrl: '/energychain.offering.v1.MsgInjectReturn',
    fields: [f(1, 'issuer', 'string'), f(2, 'offeringId', 'uint64'), f(3, 'amount', 'uint64')],
  },
  ReleaseTranche: {
    typeUrl: '/energychain.offering.v1.MsgReleaseTranche',
    fields: [f(1, 'issuer', 'string'), f(2, 'offeringId', 'uint64')],
  },

  // ---- mincast ------------------------------------------------------------
  MincastCreateMarket: {
    typeUrl: '/energychain.mincast.v1.MsgCreateMarket',
    fields: [
      f(1, 'admin', 'string'), f(2, 'denom', 'string'), f(3, 'name', 'string'), f(4, 'settlementDenom', 'string'),
      f(5, 'initialPrice', 'uint64'), f(6, 'mintFeeBps', 'uint32'), f(7, 'meltFeeBps', 'uint32'), f(8, 'policyId', 'string'), f(9, 'requireKyc', 'bool'),
    ],
  },
  MincastMint: {
    typeUrl: '/energychain.mincast.v1.MsgMint',
    fields: [f(1, 'buyer', 'string'), f(2, 'marketId', 'uint64'), f(3, 'payAmount', 'uint64'), f(4, 'minUnitsOut', 'uint64')],
  },
  MincastMelt: {
    typeUrl: '/energychain.mincast.v1.MsgMelt',
    fields: [f(1, 'seller', 'string'), f(2, 'marketId', 'uint64'), f(3, 'units', 'uint64'), f(4, 'minSettlementOut', 'uint64')],
  },
  MincastTransfer: {
    typeUrl: '/energychain.mincast.v1.MsgTransfer',
    fields: [f(1, 'from', 'string'), f(2, 'marketId', 'uint64'), f(3, 'to', 'string'), f(4, 'amount', 'uint64')],
  },
  MincastOpenInvest: {
    typeUrl: '/energychain.mincast.v1.MsgOpenInvest',
    fields: [f(1, 'investor', 'string'), f(2, 'marketId', 'uint64'), f(3, 'units', 'uint64'), f(4, 'termSeconds', 'int64'), f(5, 'apyBps', 'uint32')],
  },
  MincastCloseInvest: {
    typeUrl: '/energychain.mincast.v1.MsgCloseInvest',
    fields: [f(1, 'caller', 'string'), f(2, 'investId', 'uint64')],
  },
  MincastCancelInvest: {
    typeUrl: '/energychain.mincast.v1.MsgCancelInvest',
    fields: [f(1, 'investor', 'string'), f(2, 'investId', 'uint64')],
  },
  MincastInjectTreasury: {
    typeUrl: '/energychain.mincast.v1.MsgInjectTreasury',
    fields: [f(1, 'funder', 'string'), f(2, 'marketId', 'uint64'), f(3, 'amount', 'uint64')],
  },
  MincastFundReward: {
    typeUrl: '/energychain.mincast.v1.MsgFundReward',
    fields: [f(1, 'funder', 'string'), f(2, 'marketId', 'uint64'), f(3, 'amount', 'uint64')],
  },

  // ---- bridge (cross-chain mint/burn) -------------------------------------
  // Lock BURNS the native stablecoin to withdraw to an external chain; Release
  // MINTS it 1:1 for an attested inbound deposit (permissionless trigger).
  BridgeLock: {
    typeUrl: '/energychain.bridge.v1.MsgLock',
    fields: [f(1, 'sender', 'string'), f(2, 'assetId', 'uint64'), f(3, 'amount', 'uint64'), f(4, 'destChainId', 'uint64'), f(5, 'destAddr', 'string')],
  },
  BridgeRelease: {
    typeUrl: '/energychain.bridge.v1.MsgRelease',
    fields: [f(1, 'caller', 'string'), f(2, 'inboundId', 'uint64')],
  },
} satisfies Record<string, MsgDef>;

export type MsgKey = keyof typeof MSGS;

// registryEntries returns [typeUrl, GeneratedType] pairs for CosmJS Registry.
export function registryEntries(): [string, ReturnType<typeof makeType>][] {
  return Object.values(MSGS).map((d) => [d.typeUrl, makeType(d.fields)]);
}
