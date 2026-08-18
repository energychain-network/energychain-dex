'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useWalletClient,
} from 'wagmi';
import { isAddress, parseUnits, formatEther, getAddress } from 'viem';
import QRCode from 'qrcode';
import { ERC20_ABI } from '@/lib/abi';
import { energyChain } from '@/lib/chain';
import {
  displaySymbol,
  fmtNum,
  fromBaseUnits,
  shortAddr,
  toBaseUnits,
} from '@/lib/format';
import { TokenPicker, NATIVE_TOKEN, type SimpleToken } from '@/components/token-picker';
import { trackTx } from '@/lib/tx-store';
import { useAddressBook } from '@/lib/address-book';

// The wallet page bundles two flows that always travel together in production
// DEX UIs: a "Receive" panel (your address as a QR code so a counterparty can
// pay you) and a "Send" panel for outbound transfers. We deliberately keep it
// simple — no batching, no scheduled sends — so the surface area is small and
// signing prompts are predictable. Anything fancier belongs in the swap page.

type Tab = 'receive' | 'send';

export default function WalletPage() {
  const [tab, setTab] = useState<Tab>('receive');
  const { isConnected } = useAccount();
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Wallet</h1>
          <p className="mt-1 text-sm text-ink-400">
            Receive funds from other users or send ECY / ERC-20 tokens directly to any address.
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-white/5 bg-white/[0.02] p-1">
          <TabBtn active={tab === 'receive'} onClick={() => setTab('receive')}>Receive</TabBtn>
          <TabBtn active={tab === 'send'} onClick={() => setTab('send')}>Send</TabBtn>
        </div>
      </header>

      {!isConnected && (
        <div className="card p-8 text-center text-ink-300">
          Connect your wallet to receive payments or send tokens.
        </div>
      )}

      {isConnected && (
        <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          {tab === 'receive' ? <ReceivePanel /> : <SendPanel />}
          <BalancesPanel />
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-1.5 text-sm transition ${
        active ? 'bg-white/10 text-ink-100' : 'text-ink-300 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  );
}

// -------------------- RECEIVE --------------------

function ReceivePanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const [dataUrl, setDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // ERC-681 payment URI (most wallets recognise this and prefill the address).
  const uri = useMemo(() => (address ? `ethereum:${address}@${chainId}` : ''), [address, chainId]);

  useEffect(() => {
    if (!uri) return;
    let alive = true;
    QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 280,
      color: { dark: '#0a0a12', light: '#f5f6ff' },
    })
      .then((d) => { if (alive) setDataUrl(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [uri]);

  function copy() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (!address) return null;
  return (
    <section className="card p-6">
      <h3 className="text-sm font-medium">Your receive address</h3>
      <div className="mt-5 flex flex-col items-center gap-4">
        <div className="rounded-2xl bg-ink-50 p-3 shadow-soft">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt="Address QR code" width={280} height={280} />
          ) : (
            <div className="grid h-[280px] w-[280px] place-items-center text-ink-950 text-xs">Generating QR…</div>
          )}
        </div>
        <button
          onClick={copy}
          className="group flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-sm hover:bg-white/[0.05]"
          title="Copy address"
        >
          <span className="mono text-xs text-ink-200">{address}</span>
          <span className={`text-xs ${copied ? 'text-bull' : 'text-ink-400 group-hover:text-ink-200'}`}>
            {copied ? '✓ copied' : 'copy'}
          </span>
        </button>
        <p className="text-center text-xs text-ink-400">
          This address is shared between native ECY and every ERC-20 on EnergyChain.
          Senders should use chain id <span className="mono">{chainId}</span>
          {chainId !== energyChain.id && (
            <span className="text-bear"> — currently your wallet is on a different chain than the DEX.</span>
          )}
          .
        </p>
      </div>
    </section>
  );
}

// -------------------- SEND --------------------

type TxState = 'idle' | 'estimating' | 'pending' | 'mining' | 'success' | 'error';

function SendPanel() {
  const { address } = useAccount();
  const pc = usePublicClient();
  const { data: wc } = useWalletClient({ chainId: energyChain.id });

  const [token, setToken] = useState<SimpleToken>(NATIVE_TOKEN);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [recipientLabel, setRecipientLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [state, setState] = useState<TxState>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);

  const recordSend = useAddressBook((s) => s.recordSend);
  const removeBookEntry = useAddressBook((s) => s.remove);
  const bookEntries = useAddressBook((s) => (address ? s.list(address) : []));

  const isNative = token.address.toLowerCase() === NATIVE_TOKEN.address.toLowerCase();

  // Native ECY balance via wagmi.
  const native = useBalance({ address });
  // ERC-20 balance via direct contract read.
  const erc20Bal = useReadContract({
    address: !isNative ? (token.address as `0x${string}`) : undefined,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !isNative && !!address },
  });

  const balance: bigint = isNative
    ? (native.data?.value ?? 0n)
    : ((erc20Bal.data as bigint | undefined) ?? 0n);

  const decimals = isNative ? (native.data?.decimals ?? 18) : token.decimals;
  const symbol = displaySymbol(token.symbol);

  // Recipient validation: we treat all-lower / all-upper / valid EIP-55
  // checksum as acceptable, but reject mixed-case strings whose checksum
  // bytes don't line up — that's the canonical typo signal that has
  // protected wallet users since 2017.
  const trimmedRecipient = recipient.trim();
  const looksLikeAddr = /^0x[0-9a-fA-F]{40}$/.test(trimmedRecipient);
  const isMixedCase =
    looksLikeAddr && /[a-f]/.test(trimmedRecipient.slice(2)) && /[A-F]/.test(trimmedRecipient.slice(2));
  let recipientChecksumOk = true;
  let canonicalRecipient: `0x${string}` | null = null;
  let recipientWarning: string | undefined;
  if (looksLikeAddr) {
    try {
      canonicalRecipient = getAddress(trimmedRecipient) as `0x${string}`;
    } catch {
      canonicalRecipient = null;
      if (isMixedCase) {
        recipientChecksumOk = false;
        recipientWarning = 'Address has invalid EIP-55 checksum — double-check for typos.';
      } else {
        canonicalRecipient = trimmedRecipient.toLowerCase() as `0x${string}`;
      }
    }
  }
  const recipientValid = !!canonicalRecipient && isAddress(canonicalRecipient) && recipientChecksumOk;
  const sendingToSelf = !!(canonicalRecipient && address && canonicalRecipient.toLowerCase() === address.toLowerCase());
  if (!recipientWarning && sendingToSelf) {
    recipientWarning = 'You are sending to your own wallet address.';
  }

  let amountWei: bigint = 0n;
  let amountValid = false;
  let amountErr = '';
  try {
    amountWei = amount ? toBaseUnits(amount, decimals) : 0n;
    if (amount && amountWei <= 0n) amountErr = 'Amount must be positive';
    else if (amountWei > balance) amountErr = 'Insufficient balance';
    else amountValid = amountWei > 0n;
  } catch { amountErr = 'Invalid amount'; }

  function setMax() {
    // For the native asset we hold back ~0.005 ECY for gas so the send doesn't
    // immediately fail with "insufficient funds for gas". For ERC-20 the user
    // pays gas in native, so the full balance is safe to send.
    if (isNative) {
      const reserve = parseUnits('0.005', 18);
      const m = balance > reserve ? balance - reserve : 0n;
      setAmount(fromBaseUnits(m.toString(), 18, 8));
    } else {
      setAmount(fromBaseUnits(balance.toString(), decimals, 8));
    }
  }

  async function send() {
    if (!wc || !pc || !address) return;
    if (!recipientValid || !amountValid || !canonicalRecipient) return;
    const to = canonicalRecipient;
    setState('estimating'); setMsg(null); setHash(null);
    try {
      let txHash: `0x${string}`;
      if (isNative) {
        // Optional dry-run via estimateGas so we surface obvious revert reasons
        // before MetaMask pops up.
        await pc.estimateGas({
          account: address,
          to,
          value: amountWei,
        });
      } else {
        await pc.simulateContract({
          account: address,
          address: token.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [to, amountWei],
        });
      }
      setState('pending');
      const rcpt = await trackTx({
        kind: 'send',
        title: `Send ${amount} ${symbol}`,
        description: `To ${shortAddr(to, 4)}`,
        chainId: pc.chain?.id,
        run: async () => {
          if (isNative) {
            const h = await wc.sendTransaction({
              to,
              value: amountWei,
            });
            return { hash: h, wait: pc.waitForTransactionReceipt({ hash: h }) };
          }
          const sim = await pc.simulateContract({
            account: address,
            address: token.address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'transfer',
            args: [to, amountWei],
          });
          const h = await wc.writeContract(sim.request);
          return { hash: h, wait: pc.waitForTransactionReceipt({ hash: h }) };
        },
      });
      txHash = (rcpt as { transactionHash: `0x${string}` }).transactionHash;
      setHash(txHash);
      setState('mining');
      if (rcpt.status === 'success') {
        setState('success');
        setMsg(`Sent ${amount} ${symbol} → ${shortAddr(to, 4)}`);
        // Persist to the per-owner address book so this recipient appears as
        // a quick-pick chip next time the user opens this page.
        recordSend(address, to, recipientLabel.trim() || undefined);
        setAmount('');
        setRecipientLabel('');
        setTimeout(() => { native.refetch(); erc20Bal.refetch?.(); }, 1500);
      } else {
        setState('error');
        setMsg('Transaction reverted on-chain.');
      }
    } catch (e: any) {
      setState('error');
      setMsg(e?.shortMessage || e?.message || 'Send failed');
    }
  }

  return (
    <section className="card p-6 space-y-4">
      <h3 className="text-sm font-medium">Send tokens</h3>

      <Field label="Token">
        <button
          onClick={() => setPickerOpen(true)}
          className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 text-left hover:bg-white/[0.05]"
        >
          <div className="flex items-center gap-2">
            <Avatar label={symbol} />
            <div>
              <div className="text-sm font-medium">{symbol}</div>
              <div className="text-xs text-ink-400">{token.name}</div>
            </div>
          </div>
          <span className="text-xs text-ink-400">change ▾</span>
        </button>
        <div className="mt-1.5 flex items-center justify-between text-xs text-ink-400">
          <span>Available</span>
          <button onClick={setMax} className="hover:text-energy-400">
            {fmtNum(fromBaseUnits(balance.toString(), decimals, 8))} {symbol} · MAX
          </button>
        </div>
      </Field>

      <Field
        label="Recipient address"
        hint={recipient && !looksLikeAddr ? 'Enter a valid 0x… address' : recipientWarning}
      >
        <input
          autoComplete="off"
          spellCheck={false}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          placeholder="0x…"
          className={`input mono text-sm ${
            recipient && !recipientChecksumOk ? 'border-bear/40' : ''
          }`}
        />
        {canonicalRecipient && recipient !== canonicalRecipient && recipientChecksumOk && (
          // Auto-suggest the EIP-55 checksummed form so the user can replace
          // an all-lowercase paste with the canonical mixed-case address.
          <button
            type="button"
            onClick={() => setRecipient(canonicalRecipient as string)}
            className="mt-1 text-[11px] text-energy-400 hover:underline"
          >
            Use checksum address: <span className="mono">{shortAddr(canonicalRecipient, 6)}</span>
          </button>
        )}
        {bookEntries.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-ink-500">Recent</span>
            {bookEntries.slice(0, 6).map((entry) => (
              <span
                key={entry.address}
                className="group inline-flex items-center gap-1 rounded-full border border-white/5 bg-white/[0.03] pl-2 pr-1 py-0.5 text-[11px]"
              >
                <button
                  type="button"
                  className="mono text-ink-200 hover:text-energy-400"
                  title={entry.address}
                  onClick={() => setRecipient(entry.address)}
                >
                  {entry.label ? entry.label : shortAddr(entry.address, 4)}
                </button>
                <button
                  type="button"
                  aria-label="Remove from address book"
                  className="rounded-full px-1 text-ink-500 opacity-0 transition group-hover:opacity-100 hover:text-bear"
                  onClick={() => address && removeBookEntry(address, entry.address)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </Field>

      <Field label="Label (optional)">
        <input
          value={recipientLabel}
          onChange={(e) => setRecipientLabel(e.target.value.slice(0, 32))}
          placeholder="e.g. Alice — payroll"
          className="input text-sm"
        />
      </Field>

      <Field label="Amount" hint={amountErr || undefined}>
        <div className="flex items-stretch overflow-hidden rounded-xl border border-white/5 bg-white/[0.02]">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.0"
            className="flex-1 bg-transparent px-3 py-2.5 text-base outline-none"
          />
          <button onClick={setMax} className="px-3 text-xs text-energy-400 hover:bg-white/5">
            MAX
          </button>
        </div>
      </Field>

      <button
        onClick={send}
        disabled={!recipientValid || !amountValid || state === 'pending' || state === 'mining' || state === 'estimating'}
        className="btn-primary w-full"
      >
        {state === 'estimating' && 'Estimating…'}
        {state === 'pending' && 'Awaiting signature…'}
        {state === 'mining' && 'Mining…'}
        {(state === 'idle' || state === 'success' || state === 'error') && (
          recipientValid && amountValid
            ? `Send ${amount || ''} ${symbol}`
            : !recipient
              ? 'Enter recipient'
              : !recipientValid
                ? 'Invalid address'
                : 'Enter amount'
        )}
      </button>

      {msg && (
        <div className={`rounded-xl border px-3 py-2 text-xs ${
          state === 'error'
            ? 'border-bear/20 bg-bear/10 text-bear-400'
            : 'border-bull/20 bg-bull/10 text-bull-400'
        }`}>
          {msg}
          {hash && (
            <div className="mt-1 mono text-[10px] text-ink-300">
              tx: <a className="hover:text-ink-100" href={`${process.env.NEXT_PUBLIC_DEX_EXPLORER_URL || 'http://localhost:3000'}/tx/${hash}`} target="_blank" rel="noreferrer">{hash}</a>
            </div>
          )}
        </div>
      )}

      <TokenPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(t) => { setToken(t); setAmount(''); }}
      />
    </section>
  );
}

// -------------------- BALANCES SIDEBAR --------------------

function BalancesPanel() {
  const { address } = useAccount();
  const native = useBalance({ address });

  // We surface ECY plus a small set of well-known tokens. Anything beyond that
  // can be sent by pasting an address into the Send picker; we don't attempt
  // an exhaustive scan because that would require an indexer endpoint.
  type Row = { sym: string; bal: string; addr?: string };
  const rows: Row[] = [];
  rows.push({
    sym: 'ECY',
    bal: native.data ? `${fromBaseUnits(native.data.value.toString(), native.data.decimals, 6)}` : '—',
  });

  return (
    <aside className="space-y-4">
      <div className="card p-5">
        <h3 className="text-sm font-medium">Account</h3>
        <div className="mt-3 space-y-2 text-sm">
          <Row k="Address" v={address ? <span className="mono text-xs">{address}</span> : '—'} />
          <Row k="Network" v={energyChain.name} />
          <Row k="Native balance" v={native.data ? `${formatEther(native.data.value).slice(0, 10)} ECY` : '—'} />
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-medium">Tips</h3>
        <ul className="mt-3 space-y-2 text-xs text-ink-300">
          <li>· Native <span className="font-medium text-ink-100">ECY</span> is sent with a plain transfer (no approval).</li>
          <li>· ERC-20 tokens use <span className="font-mono">transfer(to, amount)</span> directly — no router involved.</li>
          <li>· To receive an ERC-20 the recipient must add the token in their wallet (Import token by address).</li>
          <li>· The QR code uses ERC-681 (<span className="font-mono">ethereum:…@chainId</span>) so most wallets prefill correctly.</li>
        </ul>
      </div>
    </aside>
  );
}

// -------------------- SHARED LITTLE PARTS --------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-ink-400">{label}</span>
        {hint && <span className="text-bear">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-400 text-xs">{k}</span>
      <span className="text-ink-100 text-right break-all">{v}</span>
    </div>
  );
}

function Avatar({ label }: { label: string }) {
  let h = 0; for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
  return (
    <span className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: `hsl(${h},60%,45%)` }}>
      {label.slice(0, 2).toUpperCase() || '??'}
    </span>
  );
}
