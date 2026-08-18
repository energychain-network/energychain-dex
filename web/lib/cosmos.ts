// Cosmos (Keplr + CosmJS) connection and signing for the EnergyChain native
// modules. The browser signs locally with Keplr and broadcasts through the
// CometBFT RPC; reads go through the dex-api REST mirror (lib/native-api.ts).

import { GasPrice, calculateFee, type DeliverTxResponse } from '@cosmjs/stargate';
import { Registry, makeAuthInfoBytes, type OfflineSigner, type OfflineDirectSigner, type EncodeObject } from '@cosmjs/proto-signing';
import { Comet38Client } from '@cosmjs/tendermint-rpc';
import { fromBase64, toBase64, toHex } from '@cosmjs/encoding';
import { TxBody, TxRaw, SignDoc } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing';
import { PubKey as Secp256k1PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys';
import { QueryAccountRequest, QueryAccountResponse } from 'cosmjs-types/cosmos/auth/v1beta1/query';
import { BaseAccount } from 'cosmjs-types/cosmos/auth/v1beta1/auth';
import { MsgSubmitProposal } from 'cosmjs-types/cosmos/gov/v1/tx';
import type { Any } from 'cosmjs-types/google/protobuf/any';
import { registryEntries } from './cosmos-msgs';

// This Cosmos EVM chain assigns uint64 account numbers that routinely exceed
// JavaScript's 53-bit safe integer (e.g. 14615341747968491101). CosmJS's
// default account parser converts account_number via Uint64.toNumber() and
// throws "Number can only safely store up to 53 bits", so we cannot use
// SigningStargateClient.signAndBroadcast (which calls getSequence internally).
// Instead we fetch the account ourselves (keeping account_number as a bigint),
// build the SignDoc with full precision, and sign DIRECT via the wallet.
const ETHSECP256K1_PUBKEY_TYPE = '/cosmos.evm.crypto.v1.ethsecp256k1.PubKey';

// Some wallets (notably OKX) return the signature as unpadded base64 or
// base64url, which @cosmjs/encoding fromBase64 rejects ("Length must be a
// multiple of 4"). Normalize to standard padded base64 before decoding.
function decodeSignature(s: string): Uint8Array {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  const rem = b.length % 4;
  if (rem) b += '='.repeat(4 - rem);
  return fromBase64(b);
}

export const COSMOS = {
  chainId: process.env.NEXT_PUBLIC_DEX_COSMOS_CHAIN_ID || 'energychain_9001-1',
  rpc: process.env.NEXT_PUBLIC_DEX_COSMOS_RPC || 'http://localhost:26657',
  rest: process.env.NEXT_PUBLIC_DEX_COSMOS_REST || 'http://localhost:1317',
  prefix: process.env.NEXT_PUBLIC_BECH32_PREFIX || 'energy',
  denom: process.env.NEXT_PUBLIC_NATIVE_DENOM || 'uecy',
  display: process.env.NEXT_PUBLIC_NATIVE_DISPLAY || 'ecy',
  decimals: Number(process.env.NEXT_PUBLIC_NATIVE_DECIMALS || 18),
  gasPrice: process.env.NEXT_PUBLIC_GAS_PRICE || '0.025uecy',
  // Fixed gas per message. This chain (Cosmos EVM) returns a simulate gas value
  // that overflows JS's 53-bit safe integer, so 'auto' gas estimation throws
  // "Number can only safely store up to 53 bits". We mirror the CLI/loadgen
  // approach of a fixed gas limit instead of simulating.
  gasPerMsg: Number(process.env.NEXT_PUBLIC_GAS_PER_MSG || 1000000),
};

// Build a shared registry once with all native + default message types.
let _registry: Registry | null = null;
function registry(): Registry {
  if (_registry) return _registry;
  const reg = new Registry();
  for (const [typeUrl, type] of registryEntries()) {
    // CosmJS GeneratedType has a wider type; our codec satisfies the runtime
    // contract (encode().finish()).
    reg.register(typeUrl, type as never);
  }
  reg.register('/cosmos.gov.v1.MsgSubmitProposal', MsgSubmitProposal);
  _registry = reg;
  return reg;
}

/** Gov module account — MsgCreateMarket.authority must be this address. */
export async function fetchGovModuleAddress(): Promise<string> {
  const r = await fetch(`${COSMOS.rest}/cosmos/auth/v1beta1/module_accounts/gov`);
  if (!r.ok) throw new Error('无法查询 gov 模块地址');
  const j = await r.json();
  const acct = j.account;
  return acct?.base_account?.address || acct?.value?.address || acct?.address || '';
}

/** Wrap one or more module Msgs in a gov v1 proposal (proposer signs & deposits). */
export async function submitGovProposal(
  session: CosmosSession,
  title: string,
  summary: string,
  inner: EncodeObject[],
  depositAmount = '20000000',
): Promise<DeliverTxResponse> {
  const reg = registry();
  const messages: Any[] = inner.map((m) => ({
    typeUrl: m.typeUrl,
    value: reg.encode(m),
  }));
  const proposal = MsgSubmitProposal.fromPartial({
    messages,
    initialDeposit: [{ denom: COSMOS.denom, amount: depositAmount }],
    proposer: session.address,
    metadata: '',
    title,
    summary,
  });
  return signAndBroadcast(session, [{ typeUrl: '/cosmos.gov.v1.MsgSubmitProposal', value: proposal }], title);
}

// Keplr ChainInfo so the wallet can add EnergyChain on first connect.
function chainInfo() {
  const { chainId, rpc, rest, prefix, denom, display, decimals } = COSMOS;
  return {
    chainId,
    chainName: 'EnergyChain',
    rpc,
    rest,
    bip44: { coinType: 60 }, // Cosmos EVM (Ethermint) uses coin type 60
    bech32Config: {
      bech32PrefixAccAddr: prefix,
      bech32PrefixAccPub: `${prefix}pub`,
      bech32PrefixValAddr: `${prefix}valoper`,
      bech32PrefixValPub: `${prefix}valoperpub`,
      bech32PrefixConsAddr: `${prefix}valcons`,
      bech32PrefixConsPub: `${prefix}valconspub`,
    },
    currencies: [{ coinDenom: display, coinMinimalDenom: denom, coinDecimals: decimals }],
    feeCurrencies: [
      // gasPriceStep is uecy per gas. The chain's feemarket min_gas_price is
      // 0.001 uecy/gas, so any of these steps clears the minimum fee.
      { coinDenom: display, coinMinimalDenom: denom, coinDecimals: decimals, gasPriceStep: { low: 0.001, average: 0.0025, high: 0.025 } },
    ],
    stakeCurrency: { coinDenom: display, coinMinimalDenom: denom, coinDecimals: decimals },
    features: ['eth-address-gen', 'eth-key-sign'],
  };
}

declare global {
  interface Window {
    keplr?: any;
    leap?: any;
    getOfflineSigner?: (chainId: string) => OfflineSigner;
  }
}

export interface CosmosSession {
  address: string;
  signer: OfflineSigner;
}

// connect prompts Keplr (or Leap) to add + enable the chain and returns the
// primary account + offline signer.
export async function connect(): Promise<CosmosSession> {
  const wallet = (typeof window !== 'undefined' && (window.keplr || window.leap)) as any;
  if (!wallet) throw new Error('未检测到 Keplr / Leap 钱包，请先安装浏览器扩展');
  try {
    await wallet.experimentalSuggestChain(chainInfo());
  } catch {
    // Some wallets reject suggest for already-known chains; ignore.
  }
  await wallet.enable(COSMOS.chainId);
  // NOTE: do not pass signOptions here — OKX's getOfflineSigner mishandles it
  // and corrupts signDirect. The fee is kept above the chain minimum via the
  // gasPriceStep in chainInfo() instead.
  const signer: OfflineSigner = wallet.getOfflineSigner(COSMOS.chainId);
  const accounts = await signer.getAccounts();
  if (!accounts.length) throw new Error('钱包未返回账户');
  return { address: accounts[0].address, signer };
}

let _comet: Comet38Client | null = null;
async function comet(): Promise<Comet38Client> {
  if (!_comet) _comet = await Comet38Client.connect(COSMOS.rpc);
  return _comet;
}

// fetchAccount reads account_number + sequence directly from the chain via an
// ABCI query, decoding with cosmjs-types (bigint) so large account numbers do
// not overflow. Works for the plain BaseAccount this chain uses.
async function fetchAccount(address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const c = await comet();
  const data = QueryAccountRequest.encode({ address }).finish();
  const res = await c.abciQuery({ path: '/cosmos.auth.v1beta1.Query/Account', data });
  if (res.code) throw new Error(res.log || `账户查询失败 (code ${res.code})`);
  const acct = QueryAccountResponse.decode(res.value).account;
  if (!acct) throw new Error('账户不存在或尚未激活，请先领取 gas');
  const base = BaseAccount.decode(acct.value);
  return { accountNumber: base.accountNumber, sequence: base.sequence };
}

// signAndBroadcast signs the given messages with a fixed gas fee and broadcasts
// via RPC, using a manual DIRECT sign flow that preserves the chain's 64-bit
// account number (see note above).
export async function signAndBroadcast(
  session: CosmosSession,
  messages: EncodeObject[],
  memo = '',
): Promise<DeliverTxResponse> {
  const signer = session.signer as OfflineDirectSigner;
  const [account] = await signer.getAccounts();
  if (!account) throw new Error('钱包未返回账户');

  const { accountNumber, sequence } = await fetchAccount(session.address);
  const reg = registry();

  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: messages.map((m) => ({ typeUrl: m.typeUrl, value: reg.encode(m) })),
      memo,
    }),
  ).finish();

  // The chain derives addresses from eth_secp256k1 keys, so the pubkey must be
  // wrapped in the Cosmos EVM ethsecp256k1 type (not the standard secp256k1).
  const pubkeyAny: Any = {
    typeUrl: ETHSECP256K1_PUBKEY_TYPE,
    value: Secp256k1PubKey.encode({ key: account.pubkey }).finish(),
  };

  const gas = COSMOS.gasPerMsg * Math.max(1, messages.length);
  const fee = calculateFee(gas, GasPrice.fromString(COSMOS.gasPrice));
  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey: pubkeyAny, sequence: Number(sequence) }],
    fee.amount,
    Number(fee.gas),
    undefined,
    undefined,
    SignMode.SIGN_MODE_DIRECT,
  );

  const signDoc = SignDoc.fromPartial({ bodyBytes, authInfoBytes, chainId: COSMOS.chainId, accountNumber });
  const { signature, signed } = await signer.signDirect(session.address, signDoc);

  const txBytes = TxRaw.encode(
    TxRaw.fromPartial({
      bodyBytes: signed.bodyBytes,
      authInfoBytes: signed.authInfoBytes,
      signatures: [decodeSignature(signature.signature)],
    }),
  ).finish();

  return broadcastAndConfirm(txBytes);
}

// broadcastAndConfirm submits the tx and waits for inclusion WITHOUT CosmJS's
// high-level broadcastTx. That path decodes the committed tx's event attributes
// as base64, but this chain runs CometBFT 0.38, whose RPC returns attribute
// key/value as PLAIN strings (e.g. "spender"); @cosmjs 0.32 then throws
// "Invalid string. Length must be a multiple of 4" on every *successful* tx
// (rejected txs have no events, which is why the fee error masked this).
// We broadcast via broadcast_tx_sync (its response carries no events) and poll
// the raw /tx RPC, reading only code/log/gas as plain JSON.
async function broadcastAndConfirm(txBytes: Uint8Array): Promise<DeliverTxResponse> {
  const c = await comet();
  const sync = await c.broadcastTxSync({ tx: txBytes });
  if (sync.code !== 0) {
    throw new Error(`交易被拒绝 (code ${sync.code}): ${sync.log || sync.codespace || '未知错误'}`);
  }
  const hashHex = toHex(sync.hash).toUpperCase();
  const hashB64 = toBase64(sync.hash);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    let tr: { code?: number; log?: string; gas_used?: string; gas_wanted?: string } | undefined;
    let height = 0;
    let index = 0;
    try {
      const resp = await fetch(COSMOS.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tx', params: { hash: hashB64, prove: false } }),
      });
      const j = await resp.json();
      if (j?.result?.tx_result) {
        tr = j.result.tx_result;
        height = Number(j.result.height || 0);
        index = Number(j.result.index || 0);
      }
    } catch {
      // RPC hiccup / tx not indexed yet — keep polling.
    }
    if (!tr) continue;
    const code = Number(tr.code || 0);
    const rawLog = tr.log || '';
    if (code !== 0) throw new Error(`交易失败 (code ${code}): ${rawLog}`);
    return {
      code: 0,
      height,
      txIndex: index,
      transactionHash: hashHex,
      events: [],
      rawLog,
      msgResponses: [],
      gasUsed: BigInt(tr.gas_used || 0),
      gasWanted: BigInt(tr.gas_wanted || 0),
    } as unknown as DeliverTxResponse;
  }
  throw new Error(`交易已广播但未在 30 秒内确认，哈希 ${hashHex}`);
}

// msg builds an EncodeObject for the registry from a type URL + value.
export function msg(typeUrl: string, value: Record<string, unknown>): EncodeObject {
  return { typeUrl, value };
}
