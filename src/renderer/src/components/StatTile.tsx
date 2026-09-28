interface StatTileProps {
  label: string
  value: string | number
  tone?: 'default' | 'ok' | 'warn' | 'bad'
  hint?: string
}

export default function StatTile({ label, value, tone = 'default', hint }: StatTileProps) {
  return (
    <div className={`stat-tile tone-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}
