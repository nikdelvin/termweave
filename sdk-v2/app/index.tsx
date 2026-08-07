import { App } from './App'
import { runTermweaveApp } from '../termweave/sidecar'

await runTermweaveApp(() => <App />)
