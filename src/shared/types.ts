export interface Account {
  id: number
  label: string
  email: string
  host: string
  port: number
  secure: boolean
  username: string
  hasPassword: boolean
  dailyCap: number
  authType: 'smtp' | 'gmail'
  authError: string
}

export interface AccountInput {
  id?: number
  label: string
  email: string
  host: string
  port: number
  secure: boolean
  username: string
  password?: string
  dailyCap: number
}

export interface Contact {
  id: number
  name: string
  email: string
  company: string
  role: string
  notes: string
}

export type ContactInput = Omit<Contact, 'id'> & { id?: number }

export interface TemplateAttachment {
  id: number
  filename: string
  size: number
}

export interface Template {
  id: number
  name: string
  subject: string
  body: string
  attachments: TemplateAttachment[]
}

/** addFiles are source paths picked by the user; they are copied into the app's own folder on save. */
export interface TemplateInput {
  id?: number
  name: string
  subject: string
  body: string
  addFiles?: string[]
  removeAttachmentIds?: number[]
}

export interface EmailAttachment {
  filename: string
  path: string
}

export interface PickedFile {
  path: string
  filename: string
  size: number
}

export interface Job {
  id: number
  title: string
  company: string
  url: string
  description: string
  contactEmail: string
  createdAt: number
}

export type JobInput = Omit<Job, 'id' | 'createdAt'> & { id?: number }

export type EmailStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'failed'

export interface OutboxEmail {
  id: number
  accountId: number
  contactId: number | null
  jobId: number | null
  toEmail: string
  subject: string
  body: string
  status: EmailStatus
  error: string
  sentAt: number | null
  createdAt: number
  parentId: number | null
  step: number
  repliedAt: number | null
  followupsStopped: boolean
  stopReason: '' | 'replied' | 'manual' | 'bounced'
  attachmentCount: number
}

export interface Settings {
  minDelaySec: number
  maxDelaySec: number
  apiToken: string
  serverPort: number
  googleClientId: string
  googleClientSecretSet: boolean
  followUps: FollowUpConfig
}

export interface SettingsInput {
  minDelaySec?: number
  maxDelaySec?: number
  googleClientId?: string
  googleClientSecret?: string
  followUps?: FollowUpConfig
}

export interface QueueState {
  running: boolean
  nextSendAt: number | null
  current: string | null
  queued: number
}

export interface FollowUpStepConfig {
  templateId: number | null
  delayDays: number
}

export interface FollowUpConfig {
  enabled: boolean
  enabledAt: number | null
  steps: [FollowUpStepConfig, FollowUpStepConfig]
}

export interface FollowUpRunSummary {
  repliesFound: number
  bounces: number
  draftsCreated: number
  cleanedUp: number
}

export const SERVER_PORT = 47821
