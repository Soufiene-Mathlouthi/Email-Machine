import { describe, expect, it } from 'vitest'
import type { FollowUpConfig } from '@shared/types'
import {
  DAY_MS, DEFAULT_FOLLOWUPS, applyFollowUpUpdate, classifyThread, followUpSubject, nextFollowUp, parseFollowUpConfig
} from '../src/main/followups/rules'

const T0 = Date.UTC(2026, 0, 1)
const cfg = (over: Partial<FollowUpConfig> = {}): FollowUpConfig => ({
  enabled: true,
  enabledAt: T0,
  steps: [{ templateId: 10, delayDays: 4 }, { templateId: 20, delayDays: 7 }],
  ...over
})
const sent = (sentAt: number, step = 0) => ({ step, status: 'sent', sentAt, followupsStopped: false })

describe('nextFollowUp', () => {
  it('returns null when disabled', () => {
    expect(nextFollowUp(sent(T0), [], cfg({ enabled: false }), T0 + 10 * DAY_MS)).toBeNull()
  })
  it('ignores originals sent before follow-ups were enabled', () => {
    expect(nextFollowUp(sent(T0 - 1), [], cfg(), T0 + 10 * DAY_MS)).toBeNull()
  })
  it('is not due before the delay', () => {
    expect(nextFollowUp(sent(T0), [], cfg(), T0 + 4 * DAY_MS - 1)).toBeNull()
  })
  it('returns step 1 once due', () => {
    expect(nextFollowUp(sent(T0), [], cfg(), T0 + 4 * DAY_MS)).toEqual({ step: 1, templateId: 10 })
  })
  it('a step-1 draft blocks step 2', () => {
    const f1 = { step: 1, status: 'draft', sentAt: null, followupsStopped: false }
    expect(nextFollowUp(sent(T0), [f1], cfg(), T0 + 60 * DAY_MS)).toBeNull()
  })
  it('step 2 is due 7 days after step 1 was sent', () => {
    const f1 = sent(T0 + 5 * DAY_MS, 1)
    expect(nextFollowUp(sent(T0), [f1], cfg(), T0 + 12 * DAY_MS - 1)).toBeNull()
    expect(nextFollowUp(sent(T0), [f1], cfg(), T0 + 12 * DAY_MS)).toEqual({ step: 2, templateId: 20 })
  })
  it('skips step 2 when it has no template', () => {
    const c = cfg({ steps: [{ templateId: 10, delayDays: 4 }, { templateId: null, delayDays: 7 }] })
    expect(nextFollowUp(sent(T0), [sent(T0 + DAY_MS, 1)], c, T0 + 90 * DAY_MS)).toBeNull()
  })
  it('stops for replied or stopped originals', () => {
    expect(nextFollowUp({ ...sent(T0), followupsStopped: true }, [], cfg(), T0 + 10 * DAY_MS)).toBeNull()
  })
  it('never goes past step 2', () => {
    expect(nextFollowUp(sent(T0), [sent(T0 + DAY_MS, 1), sent(T0 + 2 * DAY_MS, 2)], cfg(), T0 + 90 * DAY_MS)).toBeNull()
  })
  it('only applies to sent originals', () => {
    expect(nextFollowUp({ ...sent(T0), status: 'failed' }, [], cfg(), T0 + 10 * DAY_MS)).toBeNull()
  })
})

describe('classifyThread', () => {
  const me = 'me@gmail.com'
  it('only my own messages -> none', () => {
    expect(classifyThread(['Me <me@gmail.com>'], me)).toBe('none')
  })
  it('another sender -> replied', () => {
    expect(classifyThread(['Me <me@gmail.com>', '"Jane Doe" <jane@acme.com>'], me)).toBe('replied')
  })
  it('mailer-daemon -> bounced', () => {
    expect(classifyThread(['Me <me@gmail.com>', 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>'], me)).toBe('bounced')
  })
  it('compares case-insensitively and accepts bare addresses', () => {
    expect(classifyThread(['ME@Gmail.com'], me)).toBe('none')
  })
  it('a human reply wins over a bounce', () => {
    expect(classifyThread(['postmaster@acme.com', 'jane@acme.com'], me)).toBe('replied')
  })
})

describe('followUpSubject', () => {
  it('uses Re: <original>', () => {
    expect(followUpSubject('Quick intro')).toBe('Re: Quick intro')
  })
  it('does not double Re:', () => {
    expect(followUpSubject('RE: Quick intro')).toBe('RE: Quick intro')
  })
})

describe('follow-up config', () => {
  it('falls back to defaults on bad JSON', () => {
    expect(parseFollowUpConfig('{nope')).toEqual(DEFAULT_FOLLOWUPS)
  })
  it('clamps delays and drops invalid template ids', () => {
    const c = parseFollowUpConfig(JSON.stringify({ enabled: true, steps: [{ templateId: 3, delayDays: 0 }, { templateId: 'x', delayDays: 2.6 }] }))
    expect(c.steps).toEqual([{ templateId: 3, delayDays: 4 }, { templateId: null, delayDays: 3 }])
  })
  it('stamps enabledAt when switching on', () => {
    expect(applyFollowUpUpdate(DEFAULT_FOLLOWUPS, { ...DEFAULT_FOLLOWUPS, enabled: true }, 123).enabledAt).toBe(123)
  })
  it('keeps enabledAt while staying on, ignoring client values', () => {
    const prev = { ...DEFAULT_FOLLOWUPS, enabled: true, enabledAt: 50 }
    expect(applyFollowUpUpdate(prev, { ...prev, enabledAt: 999 }, 123).enabledAt).toBe(50)
  })
  it('re-enabling after a pause stamps a new enabledAt', () => {
    const off = { ...DEFAULT_FOLLOWUPS, enabled: false, enabledAt: 50 }
    expect(applyFollowUpUpdate(off, { ...off, enabled: true }, 123).enabledAt).toBe(123)
  })
})
