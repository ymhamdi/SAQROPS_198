// Web Worker entry: keeps route searches off the UI thread.

import { handleRequest, type WorkerRequest, type WorkerState } from './workerHandler'

// The app's lib is DOM, not WebWorker; this is the slice of the worker global scope we use.
const ctx = globalThis as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

const state: WorkerState = { prepared: null }

ctx.onmessage = (e) => {
  const { response, transfer } = handleRequest(state, e.data)
  ctx.postMessage(response, transfer)
}
