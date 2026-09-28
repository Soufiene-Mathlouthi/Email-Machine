import { describe, expect, it } from 'vitest'
import { composeMime, formatFrom } from '../src/main/mime'

const base = { from: 'Me <me@gmail.com>', to: 'jane@acme.com', subject: 'Re: Quick intro', text: 'Hi Jane', attachments: [] }

describe('composeMime', () => {
  it('adds threading headers for replies', async () => {
    const raw = (await composeMime({ ...base, inReplyTo: '<m1@x>', references: '<m1@x>' })).toString()
    expect(raw).toMatch(/^In-Reply-To: <m1@x>\r?$/m)
    expect(raw).toMatch(/^References: <m1@x>\r?$/m)
    expect(raw).toMatch(/^Subject: Re: Quick intro\r?$/m)
    expect(raw).toContain('Hi Jane')
  })
  it('omits threading headers for a first email', async () => {
    const raw = (await composeMime(base)).toString()
    expect(raw).not.toMatch(/^In-Reply-To:/m)
  })
})

describe('formatFrom', () => {
  it('quotes the label and strips quotes from it', () => {
    expect(formatFrom('Sam "The" Rivera', 'sam@x.com')).toBe('"Sam The Rivera" <sam@x.com>')
  })
  it('falls back to the bare address', () => {
    expect(formatFrom('', 'sam@x.com')).toBe('sam@x.com')
  })
})
