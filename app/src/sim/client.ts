// The PC drives the simulation worker: play/pause at ×N, actions, and the latest snapshot.

import { useCallback, useEffect, useRef, useState } from 'react'
import { H, v } from '../config'
import type { Action, Request, RequestBody, Response, Snapshot } from './protocol'

export interface SimControls {
  snap: Snapshot | null
  playing: boolean
  speed: number
  error: string | null
  setPlaying: (p: boolean) => void
  setSpeed: (s: number) => void
  act: (a: Action) => void
  step: (n: number) => void
  reset: () => void
}

const FRAME_MS = 100

export function useSim(): SimControls {
  const worker = useRef<Worker | null>(null)
  const busy = useRef(false)
  const nextId = useRef(1)
  const owed = useRef(0)
  const queue = useRef<RequestBody[]>([])
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(10)
  const [error, setError] = useState<string | null>(null)

  const pump = useCallback(() => {
    const w = worker.current
    if (!w || busy.current) return
    const req: RequestBody | null = queue.current.shift() ?? (owed.current >= 1 ? { type: 'step', n: Math.floor(owed.current) } : null)
    if (!req) return
    if (req.type === 'step') owed.current -= req.n
    busy.current = true
    w.postMessage({ ...req, id: nextId.current++ } as Request)
  }, [])

  useEffect(() => {
    // A fresh worker owes nothing: React runs this effect twice in development (StrictMode), and a request sent to the
    // first, terminated worker would otherwise leave `busy` set forever.
    busy.current = false
    queue.current = []
    owed.current = 0
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<Response>) => {
      busy.current = false
      if (e.data.ok) setSnap(e.data.snapshot)
      else setError(e.data.error)
      pump()
    }
    // A worker that fails to load or throws reports here, not in the page console: show it.
    w.onerror = (e) => {
      busy.current = false
      setError(`Le moteur de simulation n'a pas démarré : ${e.message || 'erreur de chargement du worker'}`)
      console.error('simulation worker error', e)
    }
    w.onmessageerror = () => setError('Message illisible reçu du moteur de simulation')
    queue.current.push({ type: 'reset', seed: v(H.sim.seed) })
    pump()
    return () => {
      w.terminate()
      worker.current = null
      busy.current = false
    }
  }, [pump])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      // Never let a slow frame pile up more than a second of backlog.
      owed.current = Math.min(owed.current + (speed * FRAME_MS) / 1000, speed)
      pump()
    }, FRAME_MS)
    return () => window.clearInterval(id)
  }, [playing, speed, pump])

  return {
    snap,
    playing,
    speed,
    error,
    setPlaying,
    setSpeed,
    act: (a) => {
      queue.current.push({ type: 'act', action: a })
      pump()
    },
    step: (n) => {
      queue.current.push({ type: 'step', n })
      pump()
    },
    reset: () => {
      owed.current = 0
      queue.current.push({ type: 'reset', seed: v(H.sim.seed) })
      pump()
    },
  }
}
