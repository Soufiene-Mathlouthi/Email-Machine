import MailComposer from 'nodemailer/lib/mail-composer'

export interface ComposeInput {
  from: string
  to: string
  subject: string
  text: string
  attachments: { filename: string; path: string }[]
  inReplyTo?: string
  references?: string
}

export const formatFrom = (label: string, email: string): string =>
  label ? `"${label.replace(/"/g, '')}" <${email}>` : email

export function composeMime(m: ComposeInput): Promise<Buffer> {
  const mail = new MailComposer({
    from: m.from,
    to: m.to,
    subject: m.subject,
    text: m.text,
    attachments: m.attachments,
    ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: m.references || m.inReplyTo } : {})
  })
  return new Promise((resolve, reject) => mail.compile().build((err, msg) => (err ? reject(err) : resolve(msg))))
}
