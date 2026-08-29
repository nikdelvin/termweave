import { App } from './App'
import { startTermweaveSidecar } from '../termweave/sidecar-runtime'

await startTermweaveSidecar(() => <App />)
