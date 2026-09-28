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

export interface Template {
  id: number
  name: string
  subject: string
  body: string
}

export type TemplateInput = Omit<Template, 'id'> & { id?: number }

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
}

export interface Settings {
  minDelaySec: number
  maxDelaySec: number
  cvPath: string
  apiToken: string
  serverPort: number
  googleClientId: string
  googleClientSecretSet: boolean
  followUps: FollowUpConfig
}

export interface SettingsInput {
  minDelaySec?: number
  maxDelaySec?: number
  cvPath?: string
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
