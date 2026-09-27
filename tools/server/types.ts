import { z } from 'zod'

export const SettingsInput = z.object({
  repositoryId: z.number().int().positive(),
  installationId: z.number().int().positive(),
  provider: z.enum(['bob', 'openai']),
  apiKey: z.string().trim().min(10).max(4096),
  model: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/).default('gpt-4.1-mini'),
  maxBobcoins: z.number().positive().max(1).default(0.5),
  maxOutputTokens: z.number().int().min(256).max(4096).default(2048),
  dailyRuns: z.number().int().min(1).max(100).default(5),
  acceptLicense: z.boolean().default(false),
  consent: z.literal(true),
}).strict().refine(s => s.provider !== 'bob' || s.acceptLicense, 'Bob license acceptance is required.')
export type SettingsInput = z.infer<typeof SettingsInput>
export interface Repository {
  id: number
  fullName: string
  installationId: number
  private: boolean
}
export interface Settings extends Omit<SettingsInput, 'apiKey' | 'consent'> {
  fullName: string
  private: boolean
  encryptedKey: string
  ownerId: number
  enabled: boolean
  generation: string
  consentAt: string
}
export interface Session {
  userId: number
  login: string
  encryptedToken: string
  csrf: string
  expires: number
}
export type Stage = 'queued' | 'gathering' | 'analyzing' | 'posting' | 'posted' | 'failed' | 'skipped' | 'interrupted'
export interface Job {
  id: number
  repositoryId: number
  installationId: number
  fullName: string
  pr: number
  sha: string
  baseSha: string
  generation: string
  stage: Stage
  message: string
  createdAt: string
  startedAt: string | null
  inferenceAt: string | null
  checkId: number | null
  usage: string | null
}
