import { getSetting, decryptSecret } from './db'

export interface DraftInput {
  jobTitle: string
  company: string
  jobDescription: string
  recipientName: string
}

const SYSTEM = `You write concise, genuine job-application emails on behalf of a candidate.
Rules:
- Use ONLY facts from the candidate profile. Never invent skills, employers, or numbers.
- Reference specifics from the job description so the email is clearly written for this role.
- 120-180 words, plain text, no markdown, no clichés like "I am writing to express my interest".
- Address the recipient by name if provided, otherwise use a neutral greeting.
- End with a short, low-pressure call to action and a sign-off using the candidate's name.
Respond with ONLY a JSON object: {"subject": string, "body": string}`

export async function draftEmail(input: DraftInput): Promise<{ subject: string; body: string }> {
  const key = decryptSecret(getSetting('anthropicKeyEnc'))
  if (!key) throw new Error('Add your Anthropic API key in Settings first.')
  const profile = getSetting('profile')
  if (!profile.trim()) throw new Error('Fill in "About you" in Settings so the draft uses your real background.')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: getSetting('aiModel', 'claude-sonnet-5'),
      max_tokens: 1000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `CANDIDATE PROFILE:\n${profile}\n\nJOB TITLE: ${input.jobTitle}\nCOMPANY: ${input.company}\nRECIPIENT: ${input.recipientName || '(unknown)'}\n\nJOB DESCRIPTION:\n${input.jobDescription.slice(0, 12000)}`
        }
      ]
    })
  })

  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { content: { type: string; text?: string }[] }
  const text = data.content.map((c) => (c.type === 'text' ? c.text ?? '' : '')).join('')
  const json = text.replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(json) as { subject: string; body: string }
  return { subject: parsed.subject, body: parsed.body }
}
