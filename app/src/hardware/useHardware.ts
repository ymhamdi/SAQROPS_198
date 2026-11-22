// The PC's link to the USB hardware: the Web Serial manager, the recorder and the replay, the packets turned into events for
// the simulation, and the verdict sent to the HUD whenever it changes. Without hardware nothing happens and the app is the
// simulated app it always was.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SimControls } from '../sim/client'
import type { HardwareEvent } from './ingest'
import { EventGate } from './gate'
import { decide, defaultSettings, initialTelemetry, reduceTelemetry, type HwOrigin, type HwSettings, type Telemetry } from './ingest'
import type { HwMessage, HudLevel } from './protocol'
import { buildSampleReplay, parseReplayFile, Recorder, Replayer, replayBanner, type ReplayFile } from './replay'
import { browserSerial, SerialManager, type DeviceStatus, type Role } from './serialManager'
import { H, v } from '../config'
import type { Site } from '../site/site'

export interface HardwareControls {
  supported: boolean
  status: Record<Role, DeviceStatus>
  telemetry: Telemetry
  settings: HwSettings
  setSettings: (patch: Partial<HwSettings>) => void
  connect: (role: Role) => Promise<void>
  disconnect: (role: Role) => Promise<void>
  /** the test button: sends NO-GO to the HUD whatever the verdict */
  testHud: () => Promise<void>
  /** the last order the HUD was sent */
  lastHud: HudLevel | null
  recording: boolean
  recordedCount: number
  toggleRecording: () => void
  /** a recording is playing: the banner to show, or null */
  /** a recording is playing now */
  replaying: boolean
  /** the banner of the recording whose values are on screen: kept after the replay ends, until live packets replace them */
  replayBanner: string | null
  playBuiltIn: () => void
  playFile: (file: File) => Promise<void>
  stopReplay: () => void
  /** a problem to tell the operator (a bad file, a port that would not open) */
  message: string | null
  /** the browser's clock, ticking, to tell a silent device from a talking one */
  nowMs: number
}

export function useHardware(sim: SimControls, site: Site): HardwareControls {
  const simRef = useRef(sim)
  const [settings, setSettingsState] = useState<HwSettings>(defaultSettings)
  const settingsRef = useRef(settings)
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry)
  const [, redraw] = useState(0)
  const [lastHud, setLastHud] = useState<HudLevel | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [replaying, setReplaying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordedCount, setRecordedCount] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const replayingRef = useRef(false)
  const recorder = useRef(new Recorder())
  // What has already been sent to the simulation, so that a stream of identical packets is not a stream of actions. Cleared
  // when the COS clears the dangers, so that a room still hot raises its danger again.
  const gate = useRef(new EventGate())

  useEffect(() => {
    simRef.current = sim
    settingsRef.current = settings
  })

  const dispatch = useCallback((ev: HardwareEvent) => {
    if (gate.current.pass(ev)) simRef.current.act({ type: 'hardware', event: ev })
  }, [])

  const handle = useCallback(
    (role: Role, msg: HwMessage, origin: HwOrigin) => {
      // While a recording plays, the live link is not listened to: the screen must show one thing, labelled as it is.
      if (origin === 'live' && replayingRef.current) return
      // Live packets replace the replayed values: the banner of the replay has nothing left to say.
      if (origin === 'live') setBanner(null)
      setTelemetry((t) => reduceTelemetry(t, msg, origin, site, Date.now()))
      const ev = decide(msg, origin, settingsRef.current, site)
      if (ev) dispatch(ev)
      if (origin === 'live' && recorder.current.active) {
        recorder.current.add(role, msg, Date.now())
        setRecordedCount(recorder.current.count)
      }
    },
    [site, dispatch],
  )

  const manager = useRef<SerialManager | null>(null)
  if (manager.current === null) {
    manager.current = new SerialManager({
      api: browserSerial(),
      baudRate: v(H.hardware.baudRate),
      now: () => Date.now(),
      onMessage: (role, msg) => handleRef.current(role, msg, 'live'),
      onChange: () => redraw((n) => n + 1),
    })
  }
  const handleRef = useRef(handle)
  useEffect(() => {
    handleRef.current = handle
  }, [handle])

  const replayer = useRef<Replayer | null>(null)
  if (replayer.current === null) {
    replayer.current = new Replayer({
      onMessage: (role, msg) => handleRef.current(role, msg, 'replay'),
      onEnd: () => {
        replayingRef.current = false
        setReplaying(false)
        // The values on screen are still the replay's: the banner stays, and says the replay is over.
        setBanner((b) => (b && !b.endsWith(' (rejeu terminé)') ? `${b} (rejeu terminé)` : b))
        manager.current?.setReplay(false)
      },
    })
  }

  // The verdict goes to the HUD whenever it changes (NO-GO, and GO once the COS has re-engaged).
  const verdict = sim.snap?.shown.verdict ?? null
  useEffect(() => {
    if (!verdict) return
    void manager.current?.sendHudAlert(verdict).then((r) => r === 'sent' && setLastHud(verdict))
  }, [verdict])

  // When the COS has cleared the dangers (the PC's re-engage button, or the panel's), a room still hot must be able to raise
  // its danger again: forget what was sent.
  const critical = sim.snap?.hardware.critical.length ?? 0
  const mayday = sim.snap?.hardware.mayday ?? null
  useEffect(() => {
    if (critical === 0) gate.current.clearCritical()
    if (!mayday) gate.current.clearMayday()
  }, [critical, mayday])

  // A simulation reset rebuilds the state with no cylinder pressure: a steady reading must be delivered again (R13), not
  // dropped as « already sent ».
  const hasAri = sim.snap?.hardware.ari != null
  useEffect(() => {
    if (!hasAri) gate.current.clearAri()
  }, [hasAri])

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const r = replayer.current
    return () => r?.stop()
  }, [])

  const startReplay = (file: ReplayFile) => {
    replayingRef.current = true
    gate.current.reset()
    manager.current?.setReplay(true)
    setBanner(replayBanner(file))
    setReplaying(true)
    setMessage(null)
    replayer.current?.start(file)
  }

  return {
    supported: manager.current.supported(),
    status: manager.current.status,
    telemetry,
    settings,
    setSettings: (patch) => setSettingsState((s) => ({ ...s, ...patch })),
    connect: async (role) => {
      const m = manager.current!
      const ok = await m.connect(role)
      setMessage(ok ? null : m.status[role].error)
      // A HUD that connects late is told the verdict as it stands.
      if (ok && role === 'hud' && simRef.current.snap) void m.sendHudAlert(simRef.current.snap.shown.verdict, { force: true }).then((r) => r === 'sent' && setLastHud(simRef.current.snap!.shown.verdict))
    },
    disconnect: (role) => manager.current!.disconnect(role),
    testHud: async () => {
      const r = await manager.current!.sendHudAlert('NO-GO', { force: true })
      if (r === 'sent') setLastHud('NO-GO')
      else setMessage(r === 'no-hud' ? 'Le HUD binôme n’est pas connecté.' : 'L’envoi au HUD a échoué.')
    },
    lastHud,
    recording,
    recordedCount,
    toggleRecording: () => {
      if (recorder.current.active) {
        const file = recorder.current.stop(new Date().toISOString())
        setRecording(false)
        const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
        const a = document.createElement('a')
        a.href = url
        a.download = 'pnr-replay.json'
        a.click()
        URL.revokeObjectURL(url)
      } else {
        recorder.current.start()
        setRecordedCount(0)
        setRecording(true)
      }
    },
    replaying,
    replayBanner: banner,
    playBuiltIn: () => startReplay(buildSampleReplay()),
    playFile: async (file) => {
      const parsed = parseReplayFile(await file.text())
      if (!parsed.ok) setMessage(parsed.error)
      else startReplay(parsed.file)
    },
    stopReplay: () => {
      replayer.current?.stop()
      replayingRef.current = false
      setReplaying(false)
      // Stopped, the values on screen are still the replay's: the banner stays.
      setBanner((b) => (b && !b.endsWith(' (rejeu arrêté)') ? `${b} (rejeu arrêté)` : b))
      manager.current?.setReplay(false)
    },
    message,
    nowMs,
  }
}
