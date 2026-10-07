'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BatteryMedium,
  Box,
  Droplets,
  Fan,
  Gauge,
  Navigation,
  OctagonX,
  Radar,
  RotateCcw,
  ScanEye,
  Terminal,
  Waves,
} from 'lucide-react'

type Page = 'DASHBOARD' | 'DEMO'
type Mode = 'SWEEP' | 'REMEDIATE' | 'RTB' | 'HALT' | 'E-STOP' | 'DOCKED'
type LogLevel = 'info' | 'ok' | 'warn' | 'alert'
type LogEntry = { id: number; t: string; msg: string; level: LogLevel }
type Point = { x: number; y: number }

const TICK_MS = 50
const SPEED = 3
const METERS_PER_UNIT = 0.25
const TURBIDITY_LIMIT = 250
const BIN_LIMIT = 90
const OBSTACLE_LIMIT = 15

const ZONE = '8,5 92,3 97,30 93,57 7,58 3,31'
const DOCK: Point = { x: 7, y: 54 }
const LANES = [10, 18, 26, 34, 42, 50]
const PATH: Point[] = [
  DOCK,
  ...LANES.flatMap((y, i) =>
    i % 2 === 0
      ? [
          { x: 12, y },
          { x: 88, y },
        ]
      : [
          { x: 88, y },
          { x: 12, y },
        ],
  ),
]
const SEGMENTS = PATH.slice(1).map((p, i) => Math.hypot(p.x - PATH[i].x, p.y - PATH[i].y))
const CUMULATIVE = SEGMENTS.reduce<number[]>((acc, len) => [...acc, acc[acc.length - 1] + len], [0])
const PATH_LENGTH = CUMULATIVE[CUMULATIVE.length - 1]
const PATH_D = PATH.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')

function locate(s: number) {
  const clamped = Math.max(0, Math.min(PATH_LENGTH, s))
  let i = 0
  while (i < SEGMENTS.length - 1 && CUMULATIVE[i + 1] < clamped) i++
  const a = PATH[i]
  const b = PATH[i + 1]
  const k = SEGMENTS[i] === 0 ? 0 : (clamped - CUMULATIVE[i]) / SEGMENTS[i]
  const heading = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, segment: i, heading: (heading + 360) % 360 }
}

const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false })

const glass = 'rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl'

export default function HydroNavDashboard() {
  const [page, setPage] = useState<Page>('DASHBOARD')
  const [estop, setEstop] = useState(false)
  const [sensors, setSensors] = useState({ turbidity: 42, bin: 18, obstacle: 80, battery: 96 })
  const [actuators, setActuators] = useState({ conveyor: true, pump: false })
  const [nav, setNav] = useState({ s: 0, dir: 1, speed: 0, heading: 0, headingCont: 0, segment: 0 })
  const [hotspots, setHotspots] = useState<Point[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logId = useRef(0)

  const alert = sensors.turbidity > TURBIDITY_LIMIT
  const rtb = sensors.bin > BIN_LIMIT
  const collision = sensors.obstacle < OBSTACLE_LIMIT
  const docked = rtb && nav.s <= 0.01
  const mode: Mode = estop
    ? 'E-STOP'
    : collision
      ? 'HALT'
      : docked
        ? 'DOCKED'
        : rtb
          ? 'RTB'
          : alert
            ? 'REMEDIATE'
            : 'SWEEP'
  const motorsActive = mode === 'SWEEP' || mode === 'RTB'
  const pos = locate(nav.s)

  const pushLog = (msg: string, level: LogLevel = 'info') => {
    const entry = { id: logId.current++, t: stamp(), msg, level }
    setLogs((prev) => [...prev.slice(-199), entry])
  }

  const live = useRef({ mode, actuators })
  live.current = { mode, actuators }

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    pushLog('SYS BOOT // EDGE NODE ONLINE', 'ok')
    pushLog('LINK ESTABLISHED @ 20 Hz', 'ok')
    pushLog('SWEEP PATTERN LOADED: BOUSTROPHEDON x6')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      const { mode: m, actuators: a } = live.current
      const dt = TICK_MS / 1000
      setNav((prev) => {
        const moving = m === 'SWEEP' || m === 'RTB'
        const dir = m === 'RTB' ? -1 : prev.dir === 0 ? 1 : prev.dir
        const speed = prev.speed + ((moving ? SPEED : 0) - prev.speed) * 0.15
        let s = prev.s + (m === 'RTB' ? -1 : dir) * speed * dt
        let nextDir = dir
        if (m === 'SWEEP' && s >= PATH_LENGTH) {
          s = PATH_LENGTH
          nextDir = -1
        } else if (m === 'SWEEP' && s <= 0) {
          s = 0
          nextDir = 1
        }
        s = Math.max(0, Math.min(PATH_LENGTH, s))
        const loc = locate(s)
        const target = m === 'RTB' || nextDir === -1 ? (loc.heading + 180) % 360 : loc.heading
        const delta = ((((target - prev.heading) % 360) + 540) % 360) - 180
        const step = delta * 0.2
        return {
          s,
          dir: m === 'RTB' ? prev.dir : nextDir,
          speed,
          heading: (prev.heading + step + 360) % 360,
          headingCont: prev.headingCont + step,
          segment: loc.segment,
        }
      })
      setSensors((prev) => ({
        ...prev,
        battery: Math.max(0, prev.battery - (m === 'SWEEP' || m === 'RTB' ? 0.0025 : 0.0006) - (a.pump ? 0.002 : 0)),
        bin: a.conveyor && m === 'SWEEP' ? Math.min(100, prev.bin + 0.015) : prev.bin,
      }))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  const prevFlags = useRef({ alert, rtb, collision, docked })
  useEffect(() => {
    const prev = prevFlags.current
    if (alert !== prev.alert) {
      if (alert) {
        pushLog(`TURBIDITY SPIKE ${Math.round(sensors.turbidity)} NTU // HOTSPOT LOGGED`, 'alert')
        pushLog('DRIVE HOLD // NEUTRALIZER PUMP DEPLOYED', 'alert')
        setActuators((p) => ({ ...p, pump: true }))
        setHotspots((h) => [...h, { x: pos.x, y: pos.y }])
      } else {
        pushLog('WATER NOMINAL // PUMP RETRACTED // RESUME SWEEP', 'ok')
        setActuators((p) => ({ ...p, pump: false }))
      }
    }
    if (rtb !== prev.rtb) {
      if (rtb) {
        pushLog('BIN FULL // ABORTING SWEEP // RTB', 'warn')
        setActuators((p) => ({ ...p, conveyor: false }))
      } else {
        pushLog('BIN CLEARED // CONVEYOR ONLINE', 'ok')
        setActuators((p) => ({ ...p, conveyor: true }))
      }
    }
    if (collision !== prev.collision) {
      pushLog(
        collision ? `COLLISION OVERRIDE // OBSTACLE ${Math.round(sensors.obstacle)} cm // MOTORS CUT` : 'PATH CLEAR // MOTORS RE-ARMED',
        collision ? 'alert' : 'ok',
      )
    }
    if (docked && !prev.docked) pushLog('DOCKED // PAYLOAD OFFLOAD READY', 'ok')
    prevFlags.current = { alert, rtb, collision, docked }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert, rtb, collision, docked])

  const prevSegment = useRef(nav.segment)
  useEffect(() => {
    if (nav.segment !== prevSegment.current && mode === 'SWEEP') {
      pushLog(`WP ${String(nav.segment).padStart(2, '0')}/${SEGMENTS.length} // ${(nav.speed * METERS_PER_UNIT).toFixed(2)} m/s`)
    }
    prevSegment.current = nav.segment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.segment])

  const toggleEstop = () => {
    setEstop((v) => {
      pushLog(v ? 'E-STOP RELEASED // SYSTEMS RE-ARMED' : 'E-STOP ENGAGED // ALL ACTUATORS CUT', v ? 'ok' : 'alert')
      return !v
    })
  }

  const toggleActuator = (key: 'conveyor' | 'pump') => {
    const next = !actuators[key]
    setActuators((p) => ({ ...p, [key]: next }))
    pushLog(`MANUAL ${key.toUpperCase()} → ${next ? 'ON' : 'OFF'}`, 'warn')
  }

  const resetDemo = () => {
    setEstop(false)
    setSensors({ turbidity: 42, bin: 18, obstacle: 80, battery: 96 })
    setActuators({ conveyor: true, pump: false })
    setHotspots([])
    pushLog('DEMO RESET // BASELINE RESTORED', 'ok')
  }

  const effectiveActuators = {
    conveyor: actuators.conveyor && !estop,
    pump: actuators.pump && !estop,
    motors: motorsActive,
  }

  return (
    <div className="min-h-dvh bg-[#0B0F19] text-slate-200 selection:bg-cyan-400/30">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.08),transparent_60%)]"
      />
      <Header page={page} setPage={setPage} estop={estop} onEstop={toggleEstop} />
      <main className="relative mx-auto max-w-[1600px] px-3 pb-4 pt-3 sm:px-5">
        <AnimatePresence mode="wait">
          {page === 'DASHBOARD' ? (
            <motion.div
              key="dash"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <Dashboard
                sensors={sensors}
                nav={nav}
                pos={pos}
                mode={mode}
                alert={alert}
                collision={collision}
                hotspots={hotspots}
                actuators={effectiveActuators}
              />
            </motion.div>
          ) : (
            <motion.div
              key="demo"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <Demo
                sensors={sensors}
                setSensors={setSensors}
                actuators={actuators}
                onToggle={toggleActuator}
                onReset={resetDemo}
                mode={mode}
                logs={logs}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}

function Header({
  page,
  setPage,
  estop,
  onEstop,
}: {
  page: Page
  setPage: (p: Page) => void
  estop: boolean
  onEstop: () => void
}) {
  const tabs: { id: Page; label: string }[] = [
    { id: 'DASHBOARD', label: 'LIVE DASHBOARD' },
    { id: 'DEMO', label: 'JURY DEMO' },
  ]
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0F19]/70 backdrop-blur-xl">
      <div className="mx-auto flex h-12 max-w-[1600px] items-center justify-between gap-3 px-3 sm:px-5">
        <div className="flex items-center gap-2">
          <Waves className="size-5 text-cyan-400" aria-hidden />
          <span className="hidden font-mono text-sm font-semibold tracking-[0.25em] text-white sm:inline">HYDRO-NAV</span>
        </div>

        <nav aria-label="Pages" className="flex rounded-full border border-white/10 bg-white/5 p-1">
          {tabs.map((t) => {
            const active = page === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setPage(t.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative rounded-full px-3 py-1 font-mono text-[11px] tracking-widest transition-colors sm:px-4 ${
                  active ? 'text-[#0B0F19]' : 'text-slate-400 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full bg-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.6)]"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative">{t.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 font-mono text-[11px] tracking-widest text-emerald-400 md:flex">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            LINK ACTIVE
          </div>
          <button
            type="button"
            onClick={onEstop}
            aria-pressed={estop}
            aria-label={estop ? 'Release emergency stop' : 'Emergency stop'}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] font-bold tracking-widest text-white transition ${
              estop
                ? 'animate-pulse bg-red-500 shadow-[0_0_24px_rgba(239,68,68,0.8)]'
                : 'bg-red-600/90 hover:bg-red-500 hover:shadow-[0_0_18px_rgba(239,68,68,0.6)]'
            }`}
          >
            <OctagonX className="size-4" aria-hidden />
            <span className="hidden sm:inline">E-STOP</span>
          </button>
        </div>
      </div>
    </header>
  )
}

const modeStyle: Record<Mode, string> = {
  SWEEP: 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10',
  REMEDIATE: 'text-red-300 border-red-500/50 bg-red-500/15',
  RTB: 'text-amber-300 border-amber-400/40 bg-amber-400/10',
  DOCKED: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
  HALT: 'text-red-300 border-red-500/50 bg-red-500/15',
  'E-STOP': 'text-red-200 border-red-500 bg-red-500/30',
}

function ModeBadge({ mode }: { mode: Mode }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.2em] ${modeStyle[mode]}`}>
      {mode}
    </span>
  )
}

function Dashboard({
  sensors,
  nav,
  pos,
  mode,
  alert,
  collision,
  hotspots,
  actuators,
}: {
  sensors: { turbidity: number; bin: number; obstacle: number; battery: number }
  nav: { speed: number; heading: number; headingCont: number }
  pos: Point
  mode: Mode
  alert: boolean
  collision: boolean
  hotspots: Point[]
  actuators: { conveyor: boolean; pump: boolean; motors: boolean }
}) {
  return (
    <div className="grid gap-3 lg:h-[calc(100dvh-4.5rem)] lg:grid-cols-[3fr_7fr]">
      <div className="flex flex-col gap-3 lg:min-h-0">
        <PowerCard battery={sensors.battery} bin={sensors.bin} />
        <TurbidityCard value={sensors.turbidity} />
        <KinematicsCard pos={pos} heading={nav.heading} headingCont={nav.headingCont} speed={nav.speed} actuators={actuators} />
      </div>
      <div className="flex flex-col gap-3 lg:min-h-0">
        <VisionFeed mode={mode} alert={alert} collision={collision} />
        <TacticalMap pos={pos} heading={nav.headingCont} hotspots={hotspots} mode={mode} />
      </div>
    </div>
  )
}

function CardTitle({ icon: Icon, label, right }: { icon: typeof Gauge; label: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-slate-500">
        <Icon className="size-3.5 text-cyan-400/80" aria-hidden />
        {label}
      </div>
      {right}
    </div>
  )
}

function Ring({ value, color, label, sub }: { value: number; color: string; label: string; sub: string }) {
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative size-24">
        <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden>
          <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
          <motion.circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={c}
            animate={{ strokeDashoffset: c * (1 - value / 100) }}
            transition={{ type: 'spring', stiffness: 80, damping: 20 }}
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-lg font-semibold text-white">{Math.round(value)}</span>
          <span className="font-mono text-[9px] text-slate-500">{sub}</span>
        </div>
      </div>
      <span className="font-mono text-[10px] tracking-[0.25em] text-slate-500">{label}</span>
    </div>
  )
}

function PowerCard({ battery, bin }: { battery: number; bin: number }) {
  const batteryColor = battery < 20 ? '#ef4444' : '#34d399'
  const binColor = bin > BIN_LIMIT ? '#f59e0b' : '#22d3ee'
  return (
    <section className={`${glass} p-4`} aria-label="Power and payload">
      <CardTitle icon={BatteryMedium} label="POWER" right={<span className="font-mono text-[10px] text-slate-500">{(3.3 + battery * 0.009).toFixed(2)}V</span>} />
      <div className="flex justify-around">
        <Ring value={battery} color={batteryColor} label="BATTERY" sub="%" />
        <Ring value={bin} color={binColor} label="BIN" sub="%" />
      </div>
    </section>
  )
}

function TurbidityCard({ value }: { value: number }) {
  const tone =
    value > TURBIDITY_LIMIT
      ? { dot: 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.9)]', text: 'text-red-400', tag: 'CONTAMINATED' }
      : value >= 50
        ? { dot: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.8)]', text: 'text-amber-300', tag: 'MODERATE' }
        : { dot: 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]', text: 'text-cyan-300', tag: 'CLEAN' }
  return (
    <section
      className={`${glass} p-4 transition-colors ${value > TURBIDITY_LIMIT ? 'border-red-500/50 bg-red-500/10' : ''}`}
      aria-label="Turbidity"
    >
      <CardTitle icon={Droplets} label="TURBIDITY" right={<span className={`size-2.5 rounded-full ${tone.dot}`} />} />
      <div className="flex items-end justify-between">
        <p className={`font-mono text-4xl font-semibold tabular-nums ${tone.text}`}>
          {Math.round(value)}
          <span className="ml-2 text-sm text-slate-500">NTU</span>
        </p>
        <span className={`font-mono text-[10px] tracking-[0.2em] ${tone.text}`}>{tone.tag}</span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className={`h-full ${value > TURBIDITY_LIMIT ? 'bg-red-500' : value >= 50 ? 'bg-amber-400' : 'bg-cyan-400'}`}
          animate={{ width: `${(value / 1000) * 100}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
    </section>
  )
}

function KinematicsCard({
  pos,
  heading,
  headingCont,
  speed,
  actuators,
}: {
  pos: Point
  heading: number
  headingCont: number
  speed: number
  actuators: { conveyor: boolean; pump: boolean; motors: boolean }
}) {
  const rows = [
    ['X', `${(pos.x * METERS_PER_UNIT).toFixed(2)}m`],
    ['Y', `${(pos.y * METERS_PER_UNIT).toFixed(2)}m`],
    ['HDG', `${Math.round(heading).toString().padStart(3, '0')}°`],
    ['SPD', `${(speed * METERS_PER_UNIT).toFixed(2)}`],
  ]
  const chips = [
    { icon: Navigation, on: actuators.motors, label: 'Drive' },
    { icon: Box, on: actuators.conveyor, label: 'Conveyor' },
    { icon: Fan, on: actuators.pump, label: 'Pump' },
  ]
  return (
    <section className={`${glass} flex-1 p-4`} aria-label="Kinematics">
      <CardTitle icon={Gauge} label="KINEMATICS" />
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="size-28 shrink-0" role="img" aria-label={`Heading ${Math.round(heading)} degrees`}>
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.08)" />
          {Array.from({ length: 36 }).map((_, i) => (
            <line
              key={i}
              x1="50"
              y1="6"
              x2="50"
              y2={i % 9 === 0 ? 13 : 9}
              stroke={i % 9 === 0 ? 'rgba(34,211,238,0.7)' : 'rgba(255,255,255,0.15)'}
              strokeWidth={i % 9 === 0 ? 1.2 : 0.6}
              transform={`rotate(${i * 10} 50 50)`}
            />
          ))}
          {['N', 'E', 'S', 'W'].map((d, i) => (
            <text
              key={d}
              x={50 + Math.sin((i * Math.PI) / 2) * 30}
              y={50 - Math.cos((i * Math.PI) / 2) * 30 + 3}
              textAnchor="middle"
              className="fill-slate-500 font-mono"
              fontSize="8"
            >
              {d}
            </text>
          ))}
          <g style={{ transform: `rotate(${headingCont}deg)`, transformOrigin: '50px 50px', transition: 'transform 120ms linear' }}>
            <polygon points="50,14 54,50 50,46 46,50" fill="#22d3ee" style={{ filter: 'drop-shadow(0 0 4px #22d3ee)' }} />
            <polygon points="50,86 54,50 50,54 46,50" fill="rgba(255,255,255,0.15)" />
          </g>
          <circle cx="50" cy="50" r="2.5" fill="#0B0F19" stroke="#22d3ee" />
        </svg>
        <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-[9px] tracking-[0.25em] text-slate-500">{k}</dt>
              <dd className="font-mono text-sm tabular-nums text-white">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <ul className="mt-4 flex gap-2">
        {chips.map(({ icon: Icon, on, label }) => (
          <li
            key={label}
            title={label}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-1.5 transition-colors ${
              on ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300' : 'border-white/5 bg-white/[0.02] text-slate-600'
            }`}
          >
            <Icon className={`size-3.5 ${on && label === 'Pump' ? 'animate-spin' : ''}`} aria-hidden />
            <span className="sr-only">
              {label} {on ? 'active' : 'idle'}
            </span>
            <span aria-hidden className={`size-1.5 rounded-full ${on ? 'bg-cyan-400' : 'bg-slate-700'}`} />
          </li>
        ))}
      </ul>
    </section>
  )
}
/*
function VisionFeed({ mode, alert, collision }: { mode: Mode; alert: boolean; collision: boolean }) {
  const [box, setBox] = useState({ x: 55, y: 45, w: 14, h: 18, conf: 98 })
  useEffect(() => {
    const id = setInterval(() => {
      setBox((b) => ({
        x: Math.max(8, Math.min(78, b.x + (Math.random() - 0.5) * 30)),
        y: Math.max(12, Math.min(62, b.y + (Math.random() - 0.5) * 18)),
        w: 11 + Math.random() * 6,
        h: 14 + Math.random() * 8,
        conf: 93 + Math.round(Math.random() * 6),
      }))
    }, 1400)
    return () => clearInterval(id)
  }, [])
  const center = box.x + box.w / 2
  const steer = center < 42 ? 'LEFT' : center > 58 ? 'RIGHT' : 'HOLD'
  const SteerIcon = steer === 'LEFT' ? ArrowLeft : steer === 'RIGHT' ? ArrowRight : ArrowUp
  const offline = mode === 'E-STOP'

  return (
    <section className={`${glass} flex flex-col overflow-hidden lg:min-h-0 lg:flex-1`} aria-label="Vision AI feed">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-slate-500">
          <ScanEye className="size-3.5 text-cyan-400/80" aria-hidden />
          VISION AI
          <span className="flex items-center gap-1 text-red-400">
            <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
            REC
          </span>
        </div>
        <ModeBadge mode={mode} />
      </div>
      <div className="relative aspect-video w-full overflow-hidden bg-black lg:aspect-auto lg:flex-1">
        <img
          src="/images/rover-cam.png"
          alt="Rover forward camera view of the water surface"
          className={`absolute inset-0 size-full object-cover transition ${offline ? 'opacity-20 grayscale' : 'opacity-70'}`}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.25)_0px,rgba(0,0,0,0.25)_1px,transparent_1px,transparent_3px)]"
        />
        {alert && <div aria-hidden className="absolute inset-0 animate-pulse bg-red-500/10" />}

        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative size-16">
            <span className="absolute left-1/2 top-0 h-5 w-px -translate-x-1/2 bg-cyan-300/70" />
            <span className="absolute bottom-0 left-1/2 h-5 w-px -translate-x-1/2 bg-cyan-300/70" />
            <span className="absolute left-0 top-1/2 h-px w-5 -translate-y-1/2 bg-cyan-300/70" />
            <span className="absolute right-0 top-1/2 h-px w-5 -translate-y-1/2 bg-cyan-300/70" />
            <span className="absolute inset-[26px] rounded-full border border-cyan-300/70" />
          </div>
        </div>

        {!offline && (
          <motion.div
            className="absolute rounded-sm border border-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.5)]"
            animate={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
            transition={{ type: 'spring', stiffness: 60, damping: 14 }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded-sm bg-cyan-400 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#0B0F19]">
              PET BOTTLE [{box.conf}%]
            </span>
            {['left-0 top-0 border-l-2 border-t-2', 'right-0 top-0 border-r-2 border-t-2', 'bottom-0 left-0 border-b-2 border-l-2', 'bottom-0 right-0 border-b-2 border-r-2'].map(
              (c) => (
                <span key={c} aria-hidden className={`absolute size-2 border-cyan-300 ${c}`} />
              ),
            )}
          </motion.div>
        )}

        <div className="absolute left-3 top-3 font-mono text-[10px] leading-relaxed text-cyan-200/70">
          <p>YOLOv8n · INT8</p>
          <p>{offline ? '-- FPS' : '30 FPS · 18ms'}</p>
        </div>

        <AnimatePresence>
          {(collision || offline) && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <span className="animate-pulse rounded-lg border border-red-500 bg-red-500/20 px-5 py-2 font-mono text-lg font-bold tracking-[0.3em] text-red-300 backdrop-blur">
                {offline ? 'E-STOP' : 'COLLISION OVERRIDE'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {!offline && !collision && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/80 to-transparent pb-3 pt-8 font-mono text-xs tracking-[0.3em] text-cyan-300">
            <SteerIcon className="size-4" aria-hidden />
            STEER {steer}
          </div>
        )}
      </div>
    </section>
  )
} */
function VisionFeed({ mode, alert, collision }: { mode: Mode; alert: boolean; collision: boolean }) {
  // Ensure the /video endpoint is used to get the raw MJPEG stream, not the admin panel
  const STREAM_URL = "http://10.201.134.83:8080/video";
  
  const [box, setBox] = useState({ x: 55, y: 45, w: 14, h: 18, conf: 98 })
  
  useEffect(() => {
    const id = setInterval(() => {
      setBox((b) => ({
        x: Math.max(8, Math.min(78, b.x + (Math.random() - 0.5) * 30)),
        y: Math.max(12, Math.min(62, b.y + (Math.random() - 0.5) * 18)),
        w: 11 + Math.random() * 6,
        h: 14 + Math.random() * 8,
        conf: 93 + Math.round(Math.random() * 6),
      }))
    }, 1400)
    return () => clearInterval(id)
  }, [])
  
  const center = box.x + box.w / 2
  const steer = center < 42 ? 'LEFT' : center > 58 ? 'RIGHT' : 'HOLD'
  const SteerIcon = steer === 'LEFT' ? ArrowLeft : steer === 'RIGHT' ? ArrowRight : ArrowUp
  const offline = mode === 'E-STOP'

  return (
    <section className={`${glass} flex flex-col overflow-hidden lg:min-h-0 lg:flex-1`} aria-label="Vision AI feed">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-slate-500">
          <ScanEye className="size-3.5 text-cyan-400/80" aria-hidden />
          VISION AI
          <span className="flex items-center gap-1 text-red-400">
            <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
            REC
          </span>
        </div>
        <ModeBadge mode={mode} />
      </div>
      
      <div className="relative aspect-video w-full overflow-hidden bg-black lg:aspect-auto lg:flex-1">
        {/* LIVE STREAM INTEGRATION */}
        <img
          src={STREAM_URL}
          alt="Live phone camera feed"
          crossOrigin="anonymous"
          className={`absolute inset-0 size-full object-cover transition ${offline ? 'opacity-20 grayscale' : 'opacity-100'}`}
          onError={(e) => {
            console.error("Stream failed to load. Check mobile hotspot connection and IP address.");
            e.currentTarget.style.display = 'none';
          }}
        />
        
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.25)_0px,rgba(0,0,0,0.25)_1px,transparent_1px,transparent_3px)]"
        />
        {alert && <div aria-hidden className="absolute inset-0 animate-pulse bg-red-500/10" />}

        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative size-16">
            <span className="absolute left-1/2 top-0 h-5 w-px -translate-x-1/2 bg-cyan-300/70" />
            <span className="absolute bottom-0 left-1/2 h-5 w-px -translate-x-1/2 bg-cyan-300/70" />
            <span className="absolute left-0 top-1/2 h-px w-5 -translate-y-1/2 bg-cyan-300/70" />
            <span className="absolute right-0 top-1/2 h-px w-5 -translate-y-1/2 bg-cyan-300/70" />
            <span className="absolute inset-[26px] rounded-full border border-cyan-300/70" />
          </div>
        </div>

        {!offline && (
          <motion.div
            className="absolute rounded-sm border border-cyan-400 shadow-[0_0_14px_rgba(34,211,238,0.5)]"
            animate={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
            transition={{ type: 'spring', stiffness: 60, damping: 14 }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded-sm bg-cyan-400 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#0B0F19]">
              PET BOTTLE [{box.conf}%]
            </span>
            {['left-0 top-0 border-l-2 border-t-2', 'right-0 top-0 border-r-2 border-t-2', 'bottom-0 left-0 border-b-2 border-l-2', 'bottom-0 right-0 border-b-2 border-r-2'].map(
              (c) => (
                <span key={c} aria-hidden className={`absolute size-2 border-cyan-300 ${c}`} />
              ),
            )}
          </motion.div>
        )}

        <div className="absolute left-3 top-3 font-mono text-[10px] leading-relaxed text-cyan-200/70 bg-slate-950/80 p-1.5 rounded">
          <p>IP: 10.201.134.83</p>
          <p>{offline ? '-- FPS' : 'LOCAL NETWORK FEED'}</p>
        </div>

        <AnimatePresence>
          {(collision || offline) && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <span className="animate-pulse rounded-lg border border-red-500 bg-red-500/20 px-5 py-2 font-mono text-lg font-bold tracking-[0.3em] text-red-300 backdrop-blur">
                {offline ? 'E-STOP' : 'COLLISION OVERRIDE'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {!offline && !collision && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/80 to-transparent pb-3 pt-8 font-mono text-xs tracking-[0.3em] text-cyan-300">
            <SteerIcon className="size-4" aria-hidden />
            STEER {steer}
          </div>
        )}
      </div>
    </section>
  )
}
function TacticalMap({ pos, heading, hotspots, mode }: { pos: Point; heading: number; hotspots: Point[]; mode: Mode }) {
  return (
    <section className={`${glass} flex flex-col overflow-hidden lg:min-h-0 lg:flex-1`} aria-label="Tactical map">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-slate-500">
          <Radar className="size-3.5 text-cyan-400/80" aria-hidden />
          TACTICAL MAP
        </div>
        <span className="font-mono text-[10px] text-slate-500">
          <span className="text-red-400">{hotspots.length}</span> HOTSPOTS
        </span>
      </div>
      <div className="relative aspect-[5/3] w-full lg:aspect-auto lg:flex-1">
        <svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 size-full" role="img" aria-label="Coverage path map">
          <defs>
            <pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="0.25" fill="rgba(148,163,184,0.25)" />
            </pattern>
            <radialGradient id="rover-glow">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="100" height="60" fill="url(#dots)" />
          <polygon points={ZONE} fill="rgba(34,211,238,0.03)" stroke="rgba(34,211,238,0.35)" strokeWidth="0.3" />
          <path d={PATH_D} fill="none" stroke="#22d3ee" strokeOpacity="0.55" strokeWidth="0.35" strokeDasharray="1.2 0.9" />
          {PATH.slice(1).map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="0.6" fill="#fb923c" />
          ))}
          <rect x={DOCK.x - 2} y={DOCK.y - 2} width="4" height="4" fill="none" stroke="#34d399" strokeWidth="0.3" />
          {hotspots.map((h, i) => (
            <g key={i}>
              <circle cx={h.x} cy={h.y} r="2.6" fill="rgba(239,68,68,0.15)">
                <animate attributeName="r" values="1.5;3.2;1.5" dur="2s" repeatCount="indefinite" />
              </circle>
              <circle cx={h.x} cy={h.y} r="1" fill="#ef4444" />
            </g>
          ))}
          <circle cx={pos.x} cy={pos.y} r="5" fill="url(#rover-glow)" />
          <g transform={`translate(${pos.x} ${pos.y}) rotate(${heading})`}>
            <polygon
              points="0,-2.2 1.6,1.6 0,0.8 -1.6,1.6"
              fill={mode === 'REMEDIATE' || mode === 'HALT' || mode === 'E-STOP' ? '#ef4444' : '#38bdf8'}
              stroke="#e0f2fe"
              strokeWidth="0.2"
            />
          </g>
        </svg>
      </div>
    </section>
  )
}

function Demo({
  sensors,
  setSensors,
  actuators,
  onToggle,
  onReset,
  mode,
  logs,
}: {
  sensors: { turbidity: number; bin: number; obstacle: number; battery: number }
  setSensors: React.Dispatch<React.SetStateAction<{ turbidity: number; bin: number; obstacle: number; battery: number }>>
  actuators: { conveyor: boolean; pump: boolean }
  onToggle: (k: 'conveyor' | 'pump') => void
  onReset: () => void
  mode: Mode
  logs: LogEntry[]
}) {
  return (
    <div className="grid gap-3 lg:h-[calc(100dvh-4.5rem)] lg:grid-cols-[2fr_3fr]">
      <section className={`${glass} flex flex-col gap-6 p-5`} aria-label="Sensor overrides">
        <div className="flex items-center justify-between">
          <ModeBadge mode={mode} />
          <button
            type="button"
            onClick={onReset}
            aria-label="Reset demo"
            className="rounded-full border border-white/10 p-2 text-slate-400 transition hover:border-cyan-400/50 hover:text-cyan-300"
          >
            <RotateCcw className="size-4" aria-hidden />
          </button>
        </div>

        <Slider
          id="sim-turbidity"
          label="TURBIDITY INJECT"
          unit="NTU"
          min={0}
          max={1000}
          value={sensors.turbidity}
          threshold={TURBIDITY_LIMIT}
          danger={sensors.turbidity > TURBIDITY_LIMIT}
          onChange={(v) => setSensors((s) => ({ ...s, turbidity: v }))}
        />
        <Slider
          id="sim-bin"
          label="BIN PAYLOAD"
          unit="%"
          min={0}
          max={100}
          value={sensors.bin}
          threshold={BIN_LIMIT}
          danger={sensors.bin > BIN_LIMIT}
          onChange={(v) => setSensors((s) => ({ ...s, bin: v }))}
        />
        <Slider
          id="sim-obstacle"
          label="OBSTACLE PROXIMITY"
          unit="cm"
          min={0}
          max={100}
          value={sensors.obstacle}
          threshold={OBSTACLE_LIMIT}
          danger={sensors.obstacle < OBSTACLE_LIMIT}
          onChange={(v) => setSensors((s) => ({ ...s, obstacle: v }))}
        />

        <div className="mt-auto grid grid-cols-2 gap-3">
          <Toggle label="CONVEYOR" icon={Box} on={actuators.conveyor} onClick={() => onToggle('conveyor')} />
          <Toggle label="PUMP" icon={Fan} on={actuators.pump} onClick={() => onToggle('pump')} />
        </div>
      </section>

      <LogTerminal logs={logs} />
    </div>
  )
}

function Slider({
  id,
  label,
  unit,
  min,
  max,
  value,
  threshold,
  danger,
  onChange,
}: {
  id: string
  label: string
  unit: string
  min: number
  max: number
  value: number
  threshold: number
  danger: boolean
  onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  const thresholdPct = ((threshold - min) / (max - min)) * 100
  const color = danger ? '#ef4444' : '#22d3ee'
  return (
    <div>
      <div className="mb-3 flex items-end justify-between">
        <label htmlFor={id} className="font-mono text-[10px] tracking-[0.25em] text-slate-500">
          {label}
        </label>
        <span className={`font-mono text-2xl font-semibold tabular-nums ${danger ? 'text-red-400' : 'text-white'}`}>
          {Math.round(value)}
          <span className="ml-1 text-xs text-slate-500">{unit}</span>
        </span>
      </div>
      <div className="relative flex h-5 items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-white/5" />
        <div
          className="absolute left-0 h-1.5 rounded-full transition-colors"
          style={{ width: `${pct}%`, background: color, boxShadow: `0 0 12px ${color}` }}
        />
        <div aria-hidden className="absolute h-3.5 w-px bg-amber-400/80" style={{ left: `${thresholdPct}%` }} />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="hydro-range relative z-10 w-full"
          style={{ ['--thumb' as string]: color }}
        />
      </div>
    </div>
  )
}

function Toggle({ label, icon: Icon, on, onClick }: { label: string; icon: typeof Box; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`flex items-center justify-between rounded-xl border px-3 py-3 transition ${
        on ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      <span className={`flex items-center gap-2 font-mono text-[11px] tracking-[0.2em] ${on ? 'text-cyan-300' : 'text-slate-500'}`}>
        <Icon className="size-4" aria-hidden />
        {label}
      </span>
      <span className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${on ? 'justify-end bg-cyan-400' : 'justify-start bg-white/10'}`}>
        <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} className="size-4 rounded-full bg-white shadow" />
      </span>
    </button>
  )
}

function LogTerminal({ logs }: { logs: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])
  const levelColor: Record<LogLevel, string> = useMemo(
    () => ({ info: 'text-slate-400', ok: 'text-emerald-400', warn: 'text-amber-300', alert: 'text-red-400 font-semibold' }),
    [],
  )
  return (
    <section
      className="flex h-[60vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 lg:h-auto lg:min-h-0"
      aria-label="Event terminal"
    >
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.25em] text-slate-500">
          <Terminal className="size-3.5 text-cyan-400/80" aria-hidden />
          /dev/hydro-nav
        </div>
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-red-500/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-emerald-400/70" />
        </div>
      </div>
      <div ref={ref} role="log" aria-live="polite" className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
        {logs.map((l) => (
          <motion.p
            key={l.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18 }}
            className={`${levelColor[l.level]} ${l.level === 'alert' ? '-mx-2 rounded bg-red-500/10 px-2' : ''}`}
          >
            <span className="text-slate-600">[{l.t}]</span> {l.msg}
          </motion.p>
        ))}
        <p className="text-cyan-400">
          <span className="text-slate-600">$</span> <span className="animate-pulse">▋</span>
        </p>
      </div>
    </section>
  )
}
