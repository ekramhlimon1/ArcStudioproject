/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet, sepolia, baseSepolia, arbitrumSepolia } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(sepolia.id, sepolia.rpcUrls.default.http[0])
registerChain(baseSepolia.id, baseSepolia.rpcUrls.default.http[0])
registerChain(arbitrumSepolia.id, arbitrumSepolia.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcTestnet, sepolia, baseSepolia, arbitrumSepolia, mainnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})

export { arcTestnet, sepolia, baseSepolia, arbitrumSepolia }
