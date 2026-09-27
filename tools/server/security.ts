import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const randomToken = () => randomBytes(32).toString('base64url')
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** Bind encrypted values to their purpose/owner so ciphertext cannot be moved between tenants. */
export class Vault {
  private key: Buffer
  constructor(hexKey: string) {
    if (!/^[a-f0-9]{64}$/i.test(hexKey)) throw new Error('COMPASS_ENCRYPTION_KEY must be 32 random bytes encoded as hex.')
    this.key = Buffer.from(hexKey, 'hex')
  }
  seal(value: string, context: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(context))
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.')
  }
  open(value: string, context: string): string {
    const [iv, tag, data] = value.split('.').map(p => Buffer.from(p, 'base64url'))
    const cipher = createDecipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(context))
    cipher.setAuthTag(tag)
    return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')
  }
}

export function verifyWebhook(body: Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false
  const expected = createHmac('sha256', secret).update(body).digest()
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))
}

export function sameOrigin(origin: string | undefined, expected: string, csrf: string | undefined, stored: string): boolean {
  return origin === expected && !!csrf && hash(csrf) === hash(stored)
}
