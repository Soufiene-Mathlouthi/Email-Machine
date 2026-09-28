import { describe, expect, it, vi } from 'vitest'
import { DAY_MS } from '../src/main/followups/rules'
import { deleteEmails, runFollowUpsOnce, stopSequences } from '../src/main/followups/engine'
import { memoryDb } from './helpers'

const T0 = Date.UTC(2026, 0, 1)

function setup(enabled = true) {
  const db = memoryDb()
  db.prepare(
    "INSERT INTO accounts (id, label, email, host, username, auth_type) VALUES (1, 'Me', 'me@gmail.com', 'gmail-api', 'me@gmail.com', 'gmail')"
  ).run()
  db.prepare(
    "INSERT INTO templates (id, name, subject, body) VALUES (10, 'F1', '', 'Hi {{firstName}}, following up about {{company}}.'), (20, 'F2', 'Last check-in', 'Bye {{name}}')"
  ).run()
  db.prepare("INSERT INTO contacts (id, name, email, company, role) VALUES (5, 'Jane Doe', 'jane@acme.com', 'Acme', 'PM')").run()
  db.prepare("INSERT INTO settings (key, value) VALUES ('followUps', ?)").run(JSON.stringify({
    enabled, enabledAt: T0, steps: [{ templateId: 10, delayDays: 4 }, { templateId: 20, delayDays: 7 }]
  }))
  const original = Number(db.prepare(
    `INSERT INTO emails (account_id, contact_id, to_email, subject, body, status, sent_at, created_at, thread_id, message_id)
     VALUES (1, 5, 'jane@acme.com', 'Quick intro', 'Hello', 'sent', ?, ?, 't1', '<m1@x>')`
  ).run(T0, T0).lastInsertRowid)
  return { db, original }
}

const noThreads = async () => ['Me <me@gmail.com>']

describe('runFollowUpsOnce', () => {
  it('keeps the Re: subject even when the template has its own subject, so the thread holds', async () => {
    const { db, original } = setup()
    db.prepare("UPDATE templates SET subject = 'Checking in' WHERE id = 10").run()
    await runFollowUpsOnce({ db, now: T0 + 4 * DAY_MS, getThreadSenders: noThreads })
    expect(db.prepare('SELECT subject FROM emails WHERE parent_id = ?').get(original)).toEqual({ subject: 'Re: Quick intro' })
  })

  it('creates a step-1 draft with contact variables and a Re: subject when due', async () => {
    const { db, original } = setup()
    const s = await runFollowUpsOnce({ db, now: T0 + 4 * DAY_MS, getThreadSenders: noThreads })
    expect(s.draftsCreated).toBe(1)
    expect(db.prepare('SELECT to_email, subject, body, status, step, parent_id FROM emails WHERE parent_id = ?').get(original)).toEqual({
      to_email: 'jane@acme.com', subject: 'Re: Quick intro', body: 'Hi Jane, following up about Acme.',
      status: 'draft', step: 1, parent_id: original
    })
  })

  it('does not create a duplicate draft on the next run', async () => {
    const { db } = setup()
    await runFollowUpsOnce({ db, now: T0 + 4 * DAY_MS, getThreadSenders: noThreads })
    const s = await runFollowUpsOnce({ db, now: T0 + 5 * DAY_MS, getThreadSenders: noThreads })
    expect(s.draftsCreated).toBe(0)
  })

  it('does nothing when follow-ups are disabled', async () => {
    const { db } = setup(false)
    expect((await runFollowUpsOnce({ db, now: T0 + 30 * DAY_MS, getThreadSenders: noThreads })).draftsCreated).toBe(0)
  })

  it('marks a reply and deletes the pending follow-up', async () => {
    const { db, original } = setup()
    await runFollowUpsOnce({ db, now: T0 + 4 * DAY_MS, getThreadSenders: noThreads })
    db.prepare("UPDATE emails SET status = 'queued' WHERE parent_id = ?").run(original)
    const replied = async () => ['Me <me@gmail.com>', 'Jane <jane@acme.com>']
    const s = await runFollowUpsOnce({ db, now: T0 + 5 * DAY_MS, getThreadSenders: replied })
    expect(s).toMatchObject({ repliesFound: 1, cleanedUp: 1, draftsCreated: 0 })
    expect(db.prepare('SELECT replied_at, followups_stopped, stop_reason FROM emails WHERE id = ?').get(original)).toEqual({
      replied_at: T0 + 5 * DAY_MS, followups_stopped: 1, stop_reason: 'replied'
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM emails WHERE parent_id = ?').get(original)).toEqual({ n: 0 })
  })

  it('stops the sequence on a bounce', async () => {
    const { db, original } = setup()
    const bounced = async () => ['mailer-daemon@googlemail.com']
    const s = await runFollowUpsOnce({ db, now: T0 + DAY_MS, getThreadSenders: bounced })
    expect(s.bounces).toBe(1)
    expect(db.prepare('SELECT stop_reason FROM emails WHERE id = ?').get(original)).toEqual({ stop_reason: 'bounced' })
  })

  it('keeps going when one thread check fails', async () => {
    const { db } = setup()
    const log = vi.fn()
    const s = await runFollowUpsOnce({
      db, now: T0 + 4 * DAY_MS, log, getThreadSenders: async () => { throw new Error('boom') }
    })
    expect(log).toHaveBeenCalledOnce()
    expect(s.draftsCreated).toBe(1)
  })

  it('skips reply checks for accounts that need reconnecting', async () => {
    const { db } = setup()
    db.prepare("UPDATE accounts SET auth_error = 'expired'").run()
    const check = vi.fn(noThreads)
    await runFollowUpsOnce({ db, now: T0 + DAY_MS, getThreadSenders: check })
    expect(check).not.toHaveBeenCalled()
  })
})

describe('deleteEmails', () => {
  it('deleting a follow-up draft stops the sequence so it is not recreated', async () => {
    const { db, original } = setup()
    await runFollowUpsOnce({ db, now: T0 + 4 * DAY_MS, getThreadSenders: noThreads })
    const followUp = (db.prepare('SELECT id FROM emails WHERE parent_id = ?').get(original) as { id: number }).id
    deleteEmails(db, [followUp])
    const s = await runFollowUpsOnce({ db, now: T0 + 5 * DAY_MS, getThreadSenders: noThreads })
    expect(s.draftsCreated).toBe(0)
    expect(db.prepare('SELECT stop_reason FROM emails WHERE id = ?').get(original)).toEqual({ stop_reason: 'manual' })
  })

  it('never deletes an email that is being sent', () => {
    const { db, original } = setup()
    db.prepare("UPDATE emails SET status = 'sending' WHERE id = ?").run(original)
    deleteEmails(db, [original])
    expect(db.prepare('SELECT COUNT(*) AS n FROM emails WHERE id = ?').get(original)).toEqual({ n: 1 })
  })
})

describe('stopSequences', () => {
  it('resolves a follow-up id to its original and cleans up', async () => {
    const { db, original } = setup()
    await runFollowUpsOnce({ db, now: T0 + 4 * DAY_MS, getThreadSenders: noThreads })
    const followUp = (db.prepare('SELECT id FROM emails WHERE parent_id = ?').get(original) as { id: number }).id
    stopSequences(db, [followUp], 'manual', T0 + 5 * DAY_MS)
    expect(db.prepare('SELECT followups_stopped, stop_reason, replied_at FROM emails WHERE id = ?').get(original)).toEqual({
      followups_stopped: 1, stop_reason: 'manual', replied_at: null
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM emails WHERE parent_id = ?').get(original)).toEqual({ n: 0 })
  })
})
