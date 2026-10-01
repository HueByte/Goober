import type { ReactNode } from 'react'

export function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section className="section">
      <header>
        <h3>{title}</h3>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </header>
      {children}
    </section>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = '',
  digits,
  hint,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  digits?: number
  hint?: string
  onChange: (v: number) => void
}) {
  const d = digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2)
  return (
    <label className="slider">
      <span className="slider-top">
        <span>{label}</span>
        <b>
          {value.toFixed(d)}
          {unit}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function Meter({
  label,
  value,
  max = 1,
  tone = 'neutral',
  caption,
}: {
  label: string
  value: number
  max?: number
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
  caption?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const auto: typeof tone =
    tone !== 'neutral' ? tone : pct > 70 ? 'good' : pct > 35 ? 'warn' : 'bad'
  return (
    <div className="meter">
      <span className="meter-top">
        <span>{label}</span>
        <b>{caption ?? `${pct.toFixed(0)}%`}</b>
      </span>
      <span className="meter-track">
        <span className={`meter-fill ${auto}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

export function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="row">
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  )
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>
}

export function fmt(v: number, digits = 1): string {
  if (!isFinite(v)) return '∞'
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return v.toFixed(digits)
}

export function clock(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes))
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  return d > 0 ? `${d}d ${h}h ${String(m).padStart(2, '0')}m` : `${h}h ${String(m).padStart(2, '0')}m`
}
