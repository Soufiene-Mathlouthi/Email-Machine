import type { FollowUpConfig } from '@shared/types'

export const DAY_MS = 86_400_000

export const DEFAULT_FOLLOWUPS: FollowUpConfig = {
  enabled: false,
  enabledAt: null,
  steps: [{ templateId: null, delayDays: 4 }, { templateId: null, delayDays: 7 }]
}

export interface SequenceEmail {
  step: number
  status: string
  sentAt: number | null
  followupsStopped: boolean
}

export function nextFollowUp(
  original: SequenceEmail,
  followUps: SequenceEmail[],
  config: FollowUpConfig,
  now: number
): { step: 1 | 2; templateId: number } | null {
  if (!config.enabled || config.enabledAt === null) return null
  if (original.step !== 0 || original.status !== 'sent' || original.followupsStopped || original.sentAt === null) return null
  if (original.sentAt < config.enabledAt) return null

  const n = followUps.reduce((max, f) => Math.max(max, f.step), 0) + 1
  if (n > 2) return null
  const prev = n === 1 ? original : followUps.find((f) => f.step === n - 1)
  if (!prev || prev.status !== 'sent' || prev.sentAt === null) return null

  const stepConfig = config.steps[n - 1]
  if (stepConfig.templateId === null) return null
  if (now < prev.sentAt + stepConfig.delayDays * DAY_MS) return null
  return { step: n as 1 | 2, templateId: stepConfig.templateId }
}

function addressOf(from: string): string {
  const angle = from.match(/<([^>]+)>/)
  return (angle ? angle[1] : from).trim().toLowerCase()
}

export function classifyThread(fromHeaders: string[], selfEmail: string): 'replied' | 'bounced' | 'none' {
  const self = selfEmail.trim().toLowerCase()
  let bounced = false
  for (const header of fromHeaders) {
    const addr = addressOf(header)
    if (!addr || addr === self) continue
    const local = addr.split('@')[0]
    if (local === 'mailer-daemon' || local === 'postmaster') {
      bounced = true
      continue
    }
    return 'replied'
  }
  return bounced ? 'bounced' : 'none'
}

export function followUpSubject(renderedTemplateSubject: string, originalSubject: string): string {
  if (renderedTemplateSubject.trim()) return renderedTemplateSubject.trim()
  const original = originalSubject.trim()
  return /^re:/i.test(original) ? original : `Re: ${original}`
}

const clampDays = (value: unknown, fallback: number): number => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : fallback
}

const templateIdOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null

export function normalizeFollowUpConfig(input: unknown): FollowUpConfig {
  const o = (input && typeof input === 'object' ? input : {}) as Partial<FollowUpConfig>
  const steps = Array.isArray(o.steps) ? o.steps : []
  return {
    enabled: o.enabled === true,
    enabledAt: typeof o.enabledAt === 'number' ? o.enabledAt : null,
    steps: [0, 1].map((i) => ({
      templateId: templateIdOf(steps[i]?.templateId),
      delayDays: clampDays(steps[i]?.delayDays, DEFAULT_FOLLOWUPS.steps[i].delayDays)
    })) as FollowUpConfig['steps']
  }
}

export function parseFollowUpConfig(raw: string): FollowUpConfig {
  try {
    return normalizeFollowUpConfig(raw ? JSON.parse(raw) : {})
  } catch {
    return normalizeFollowUpConfig({})
  }
}

// enabledAt is server-owned: stamped on every off->on switch so re-enabling never floods drafts.
export function applyFollowUpUpdate(prev: FollowUpConfig, next: unknown, now: number): FollowUpConfig {
  const n = normalizeFollowUpConfig(next)
  const switchedOn = n.enabled && (!prev.enabled || prev.enabledAt === null)
  return { ...n, enabledAt: switchedOn ? now : prev.enabledAt }
}
