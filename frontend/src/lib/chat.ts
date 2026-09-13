import { API_BASE_URL, ROUTING_HEADERS } from './config'

export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: Role
  content: string
}

/** How the gateway actually served a request, read from its response headers. */
export interface RoutingMeta {
  provider: string | null
  upstreamModel: string | null
  modelResolvedVia: string | null
  fallbackUsed: boolean
  attempts: number | null
}

export class ChatError extends Error {
  readonly status?: number
  readonly code?: string

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message)
    this.name = 'ChatError'
    this.status = options.status
    this.code = options.code
  }
}

function metaFrom(headers: Headers): RoutingMeta {
  const attempts = headers.get(ROUTING_HEADERS.attempts)
  return {
    provider: headers.get(ROUTING_HEADERS.provider),
    upstreamModel: headers.get(ROUTING_HEADERS.upstreamModel),
    modelResolvedVia: headers.get(ROUTING_HEADERS.modelResolvedVia),
    fallbackUsed: headers.get(ROUTING_HEADERS.fallbackUsed) === 'true',
    attempts: attempts === null ? null : Number(attempts),
  }
}

/**
 * Turn a non-2xx response into an error carrying the gateway's own message.
 * The backend always answers with the OpenAI envelope
 * `{ error: { message, type, param, code } }`, so surfacing it verbatim gives
 * the user something actionable ("no provider is available to serve ...")
 * instead of a bare "HTTP 503".
 */
async function toChatError(response: Response): Promise<ChatError> {
  let message = `The gateway returned HTTP ${response.status}.`
  let code: string | undefined

  try {
    const body = await response.json()
    if (typeof body?.error?.message === 'string') message = body.error.message
    if (typeof body?.error?.code === 'string') code = body.error.code
  } catch {
    // Non-JSON body — keep the generic message.
  }

  return new ChatError(message, { status: response.status, code })
}

export interface SendChatOptions {
  model: string
  messages: ChatMessage[]
  stream: boolean
  signal?: AbortSignal
  /** Called for each streamed token so the bubble can grow live. */
  onDelta?: (delta: string) => void
  /** Called once the response headers arrive, before any content. */
  onMeta?: (meta: RoutingMeta) => void
}

/**
 * POST /v1/chat/completions, streaming or not.
 *
 * Both paths return the finished text plus the routing metadata; the streaming
 * path additionally reports each token through `onDelta`.
 */
export async function sendChat({
  model,
  messages,
  stream,
  signal,
  onDelta,
  onMeta,
}: SendChatOptions): Promise<{ content: string; meta: RoutingMeta }> {
  const url = `${API_BASE_URL}/v1/chat/completions`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map(({ role, content }) => ({ role, content })),
        ...(stream ? { stream: true } : {}),
      }),
      signal,
    })
  } catch (error) {
    const err = error as Error
    if (err.name === 'AbortError') throw err
    throw new ChatError(`Cannot reach the gateway at ${API_BASE_URL}. Is the backend running?`)
  }

  if (!response.ok) throw await toChatError(response)

  const meta = metaFrom(response.headers)
  onMeta?.(meta)

  if (!stream) {
    const json = await response.json()
    const content: string = json?.choices?.[0]?.message?.content ?? ''
    return { content, meta }
  }

  // ---- Server-Sent Events -------------------------------------------------
  const reader = response.body?.getReader()
  if (!reader) throw new ChatError('The gateway returned no stream body.')

  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let boundary: number
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        if (payload === '[DONE]') return { content, meta }

        let chunk: {
          error?: { message?: string; code?: string }
          choices?: { delta?: { content?: string } }[]
        }
        try {
          chunk = JSON.parse(payload)
        } catch {
          continue // tolerate a partial or malformed frame
        }

        // A mid-stream failure arrives as an error frame, not a bad status.
        if (chunk.error) {
          throw new ChatError(chunk.error.message ?? 'The stream failed mid-response.', {
            code: chunk.error.code,
          })
        }

        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          content += delta
          onDelta?.(delta)
        }
      }
    }
  }

  return { content, meta }
}
