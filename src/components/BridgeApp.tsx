import { useState, useRef, useCallback } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { AppKit, BridgeChain, isRetryableError } from '@circle-fin/app-kit'
import type { BridgeResult, AppKitActions } from '@circle-fin/app-kit'
import type { EIP1193Provider } from 'viem'
import { ArrowDownUp, ExternalLink, CheckCircle2, Circle, Loader2, AlertCircle, ArrowRight } from 'lucide-react'
import { NetworkEthereum, NetworkBase, NetworkArbitrumOne } from '@web3icons/react'
import { buildTxExplorerUrl } from '@/onchain-facts'

// ─── Kit instance (singleton) ───────────────────────────────────────────────
const appKit = new AppKit()

// ─── Supported chains ────────────────────────────────────────────────────────
interface BridgeChainDef {
  id: number
  kitName: BridgeChain
  label: string
  icon: React.ReactNode
}

const CHAINS: BridgeChainDef[] = [
  {
    id: 5042002,
    kitName: BridgeChain.Arc_Testnet,
    label: 'Arc Testnet',
    icon: <span className="text-[10px] font-bold leading-none tracking-tight">ARC</span>,
  },
  {
    id: 11155111,
    kitName: BridgeChain.Ethereum_Sepolia,
    label: 'Eth Sepolia',
    icon: <NetworkEthereum variant="branded" size={20} />,
  },
  {
    id: 84532,
    kitName: BridgeChain.Base_Sepolia,
    label: 'Base Sepolia',
    icon: <NetworkBase variant="branded" size={20} />,
  },
  {
    id: 421614,
    kitName: BridgeChain.Arbitrum_Sepolia,
    label: 'Arb Sepolia',
    icon: <NetworkArbitrumOne variant="branded" size={20} />,
  },
]

// ─── Step display ─────────────────────────────────────────────────────────────
type StepName = 'approve' | 'burn' | 'fetchAttestation' | 'mint'
type StepState = 'idle' | 'pending' | 'success' | 'error'

interface StepInfo {
  name: StepName
  label: string
  txHash?: string
  explorerUrl?: string
  state: StepState
}

const STEP_LABELS: Record<StepName, string> = {
  approve:          'Approve USDC',
  burn:             'Burn on source',
  fetchAttestation: 'Wait for attestation',
  mint:             'Mint on destination',
}

type TxPhase = 'idle' | 'bridging' | 'success' | 'error'

// ─── Component ────────────────────────────────────────────────────────────────
export default function BridgeApp() {
  const { connector, chainId: walletChainId, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()

  const [fromChainId, setFromChainId] = useState(11155111)
  const [toChainId, setToChainId]     = useState(5042002)
  const [amount, setAmount]           = useState('1.00')
  const [phase, setPhase]             = useState<TxPhase>('idle')
  const [steps, setSteps]             = useState<StepInfo[]>([])
  const [errorMsg, setErrorMsg]       = useState('')
  const [events, setEvents]           = useState<string[]>([])

  const resultRef = useRef<BridgeResult | null>(null)

  // ─── Swap source/dest ───────────────────────────────────────────────────
  const handleSwap = () => {
    setFromChainId(toChainId)
    setToChainId(fromChainId)
  }

  // ─── Bridge ──────────────────────────────────────────────────────────────
  const handleBridge = useCallback(async () => {
    if (!connector || !isConnected) return

    const fromChain = CHAINS.find(c => c.id === fromChainId)!
    const toChain   = CHAINS.find(c => c.id === toChainId)!

    const amtNum = parseFloat(amount)
    if (isNaN(amtNum) || amtNum <= 0) {
      setErrorMsg('Enter a valid amount greater than 0.')
      return
    }

    const initSteps: StepInfo[] = (['approve', 'burn', 'fetchAttestation', 'mint'] as StepName[]).map(n => ({
      name: n, label: STEP_LABELS[n], state: 'idle',
    }))
    setSteps(initSteps)
    setPhase('bridging')
    setErrorMsg('')
    setEvents([])

    // ── Event listeners ──────────────────────────────────────────────────
    const onStar: (payload: AppKitActions[keyof AppKitActions]) => void = (payload) => {
      const p = payload as { action?: string }
      const label = typeof p.action === 'string' ? p.action : JSON.stringify(p).slice(0, 80)
      setEvents(prev => [...prev.slice(-49), label])
    }
    appKit.on('*', onStar)

    const onApprove: (payload: AppKitActions['bridge.approve']) => void = (p) => {
      if (p.protocol === 'cctp' && p.values.state === 'success') {
        setSteps(prev => prev.map(s =>
          s.name === 'approve' ? { ...s, state: 'success', txHash: p.values.txHash } : s
        ))
      } else {
        setSteps(prev => prev.map(s => s.name === 'approve' ? { ...s, state: 'pending' } : s))
      }
    }
    appKit.on('bridge.approve', onApprove)

    const onBurn: (payload: AppKitActions['bridge.burn']) => void = (p) => {
      if (p.values.state === 'success') {
        setSteps(prev => prev.map(s =>
          s.name === 'burn' ? {
            ...s,
            state: 'success',
            txHash: p.values.txHash,
            explorerUrl: buildTxExplorerUrl(fromChainId, p.values.txHash ?? ''),
          } : s
        ))
      } else {
        setSteps(prev => prev.map(s => s.name === 'burn' ? { ...s, state: 'pending' } : s))
      }
    }
    appKit.on('bridge.burn', onBurn)

    const onAttestation: (payload: AppKitActions['bridge.fetchAttestation']) => void = (p) => {
      if (p.protocol === 'cctp') {
        setSteps(prev => prev.map(s =>
          s.name === 'fetchAttestation' ? {
            ...s,
            state: (p.values.state === 'success' ? 'success' : 'pending'),
          } : s
        ))
      }
    }
    appKit.on('bridge.fetchAttestation', onAttestation)

    const onMint: (payload: AppKitActions['bridge.mint']) => void = (p) => {
      if (p.values.state === 'success') {
        setSteps(prev => prev.map(s =>
          s.name === 'mint' ? {
            ...s,
            state: 'success',
            txHash: p.values.txHash,
            explorerUrl: buildTxExplorerUrl(toChainId, p.values.txHash ?? ''),
          } : s
        ))
      } else {
        setSteps(prev => prev.map(s => s.name === 'mint' ? { ...s, state: 'pending' } : s))
      }
    }
    appKit.on('bridge.mint', onMint)

    const cleanup = () => {
      appKit.off('*', onStar)
      appKit.off('bridge.approve', onApprove)
      appKit.off('bridge.burn', onBurn)
      appKit.off('bridge.fetchAttestation', onAttestation)
      appKit.off('bridge.mint', onMint)
    }

    try {
      // Switch to source chain if needed
      if (walletChainId !== fromChainId) {
        await switchChainAsync({
          chainId: fromChainId,
        })
      }

      const provider = await connector.getProvider() as EIP1193Provider
      const adapter  = await createViemAdapterFromProvider({ provider })

      // Mark first step pending
      setSteps(prev => prev.map((s, i) => i === 0 ? { ...s, state: 'pending' } : s))

      let result = await appKit.bridge({
        from: { adapter, chain: fromChain.kitName },
        to:   { adapter, chain: toChain.kitName },
        amount: amtNum.toFixed(2),
      })

      if (result.state === 'error') {
        const failedStep = result.steps?.find(s => s.state === 'error')
        if (failedStep?.error && isRetryableError(failedStep.error)) {
          result = await appKit.retryBridge(result, { from: adapter, to: adapter })
        }
      }

      resultRef.current = result

      if (result.state === 'success') {
        // Sync final step states from result
        setSteps(prev => prev.map(s => {
          const rs = result.steps?.find(r => r.name === s.name)
          if (!rs) return s
          return {
            ...s,
            state: rs.state === 'success' ? 'success' : s.state,
            txHash: s.txHash ?? rs.txHash,
          }
        }))
        setPhase('success')
      } else {
        const failedStep = result.steps?.find(s => s.state === 'error')
        setErrorMsg(failedStep ? `Failed at: ${failedStep.name}` : 'Bridge failed. Try again.')
        setSteps(prev => prev.map(s => {
          const rs = result.steps?.find(r => r.name === s.name)
          return rs ? { ...s, state: rs.state as StepState } : s
        }))
        setPhase('error')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const isRejection = msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('denied')
      if (isRejection) {
        setPhase('idle')
        setSteps([])
      } else {
        setErrorMsg(msg.slice(0, 200))
        setPhase('error')
      }
    } finally {
      cleanup()
    }
  }, [connector, isConnected, walletChainId, fromChainId, toChainId, amount, switchChainAsync])

  const handleReset = () => {
    setPhase('idle')
    setSteps([])
    setErrorMsg('')
    setEvents([])
    resultRef.current = null
  }

  const fromChain = CHAINS.find(c => c.id === fromChainId)!
  const toChain   = CHAINS.find(c => c.id === toChainId)!
  const sameChain = fromChainId === toChainId

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-4 py-10"
      style={{ background: 'var(--bg-gradient)' }}
    >
      {/* Header */}
      <div className="w-full max-w-md mb-6 flex items-center justify-between">
        <div>
          <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>
            USDC Bridge
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Powered by Circle CCTP
          </p>
        </div>
        <ConnectKitButton />
      </div>

      {/* Main card */}
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-4 shadow-lg"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(16px)',
        }}
      >
        {/* From */}
        <ChainRow
          label="From"
          selected={fromChainId}
          exclude={toChainId}
          onChange={setFromChainId}
          chains={CHAINS}
          disabled={phase === 'bridging'}
        />

        {/* Swap button */}
        <div className="flex justify-center -my-1">
          <button
            onClick={handleSwap}
            disabled={phase === 'bridging'}
            className="rounded-full p-2 transition-all hover:scale-110 active:scale-95 disabled:opacity-40"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
            aria-label="Swap chains"
          >
            <ArrowDownUp size={16} />
          </button>
        </div>

        {/* To */}
        <ChainRow
          label="To"
          selected={toChainId}
          exclude={fromChainId}
          onChange={setToChainId}
          chains={CHAINS}
          disabled={phase === 'bridging'}
        />

        {/* Amount */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>
            Amount (USDC)
          </label>
          <div
            className="flex items-center rounded-xl px-4 py-3 gap-2"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
          >
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              disabled={phase === 'bridging'}
              className="flex-1 bg-transparent text-xl font-semibold tabular-nums outline-none min-w-0"
              style={{ color: 'var(--ink)', fontFamily: "'Space Grotesk', sans-serif" }}
              placeholder="0.00"
            />
            <span className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>USDC</span>
          </div>
          <div className="flex gap-2 mt-2">
            {['1', '5', '10'].map(v => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                disabled={phase === 'bridging'}
                className="text-xs px-3 py-1 rounded-full transition-colors disabled:opacity-40"
                style={{
                  background: amount === v ? 'var(--accent)' : 'var(--surface-muted)',
                  color: amount === v ? '#0d1b2f' : 'var(--muted)',
                  border: '1px solid var(--border)',
                }}
              >
                ${v}
              </button>
            ))}
          </div>
        </div>

        {/* Route preview */}
        <div
          className="rounded-xl px-4 py-3 flex items-center gap-3 text-sm"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <ChainBadge chain={fromChain} />
          <ArrowRight size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <ChainBadge chain={toChain} />
          <div className="ml-auto text-right">
            <div className="font-semibold tabular-nums display" style={{ color: 'var(--ink)' }}>
              {parseFloat(amount) > 0 ? parseFloat(amount).toFixed(2) : '—'} USDC
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>~8–20 sec</div>
          </div>
        </div>

        {/* CTA */}
        {phase === 'idle' || phase === 'error' ? (
          <button
            onClick={() => { void handleBridge() }}
            disabled={!isConnected || sameChain || parseFloat(amount) <= 0}
            className="w-full py-4 rounded-xl font-semibold text-sm tracking-wide transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            {!isConnected ? 'Connect wallet to bridge' : sameChain ? 'Select different chains' : 'Bridge USDC'}
          </button>
        ) : phase === 'bridging' ? (
          <button
            disabled
            className="w-full py-4 rounded-xl font-semibold text-sm tracking-wide opacity-70 flex items-center justify-center gap-2"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            <Loader2 size={16} className="animate-spin" />
            Bridging…
          </button>
        ) : (
          <button
            onClick={handleReset}
            className="w-full py-4 rounded-xl font-semibold text-sm tracking-wide transition-all active:scale-[0.98]"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          >
            Bridge again
          </button>
        )}

        {/* Error */}
        {errorMsg && (
          <div
            className="rounded-xl px-4 py-3 flex gap-2 items-start text-sm"
            style={{ background: 'rgba(232,109,122,0.10)', border: '1px solid rgba(232,109,122,0.30)', color: 'var(--danger)' }}
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Step tracker */}
      {steps.length > 0 && (
        <div
          className="w-full max-w-md mt-4 rounded-2xl p-5 space-y-3"
          style={{
            background: 'var(--surface-strong)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
            Transfer steps
          </h2>
          {steps.map((step, i) => (
            <StepRow key={step.name} step={step} index={i} />
          ))}

          {phase === 'success' && (
            <div
              className="mt-2 rounded-xl px-4 py-3 flex items-center gap-2 text-sm font-semibold"
              style={{ background: 'rgba(141,216,159,0.12)', border: '1px solid rgba(141,216,159,0.30)', color: 'var(--success)' }}
            >
              <CheckCircle2 size={16} />
              USDC arrived on {toChain.label}.
            </div>
          )}
        </div>
      )}

      {/* Live events log */}
      {events.length > 0 && (
        <div
          className="w-full max-w-md mt-4 rounded-2xl p-5"
          style={{
            background: 'var(--surface-strong)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>
            Kit events
          </h2>
          <div
            className="mono text-xs rounded-xl p-3 space-y-0.5 max-h-32 overflow-y-auto"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
          >
            {events.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChainRow({
  label,
  selected,
  exclude,
  onChange,
  chains,
  disabled,
}: {
  label: string
  selected: number
  exclude: number
  onChange: (id: number) => void
  chains: BridgeChainDef[]
  disabled: boolean
}) {
  return (
    <div>
      <span className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <div className="flex gap-2 flex-wrap">
        {chains.map(c => (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            disabled={disabled || c.id === exclude}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: selected === c.id ? 'var(--accent)' : 'var(--surface-muted)',
              color: selected === c.id ? '#0d1b2f' : 'var(--ink-2)',
              border: selected === c.id ? '1px solid transparent' : '1px solid var(--border)',
            }}
          >
            <span className="w-5 h-5 flex items-center justify-center">{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ChainBadge({ chain }: { chain: BridgeChainDef }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 h-5 flex items-center justify-center">{chain.icon}</span>
      <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{chain.label}</span>
    </div>
  )
}

function StepRow({ step, index }: { step: StepInfo; index: number }) {
  const icon = () => {
    if (step.state === 'success') return <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
    if (step.state === 'pending') return <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} />
    if (step.state === 'error')   return <AlertCircle size={18} style={{ color: 'var(--danger)' }} />
    return <Circle size={18} style={{ color: 'var(--subtle)' }} />
  }

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0">{icon()}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>
            {index + 1}.
          </span>
          <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
            {step.label}
          </span>
        </div>
        {step.txHash && (
          <a
            href={step.explorerUrl ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-xs flex items-center gap-1 mt-0.5 hover:underline"
            style={{ color: 'var(--muted)' }}
          >
            {step.txHash.slice(0, 10)}…{step.txHash.slice(-6)}
            <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  )
}
