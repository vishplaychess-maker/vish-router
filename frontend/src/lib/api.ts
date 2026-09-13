import { API_BASE_URL } from './config'

/** Shape returned by the gateway's OpenAI-compatible `GET /v1/models`. */
export interface ApiModel {
  id: string
  object: string
  created: number
  owned_by: string
}

export class ApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const MODELS_TIMEOUT_MS = 10_000

/**
 * Fetch the model catalogue from the gateway.
 *
 * Network failures are re-thrown as an ApiError with a message that names the
 * address we tried, because "Failed to fetch" on its own tells a developer
 * nothing about whether the backend is running.
 */
export async function fetchModels(signal?: AbortSignal): Promise<ApiModel[]> {
  const url = `${API_BASE_URL}/v1/models`
  const timeout = AbortSignal.timeout(MODELS_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(url, { signal: combined, headers: { accept: 'application/json' } })
  } catch (error) {
    const err = error as Error
    if (err.name === 'AbortError' && signal?.aborted) throw err // caller cancelled
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new ApiError(`The gateway at ${API_BASE_URL} did not respond within 10s.`)
    }
    throw new ApiError(
      `Cannot reach the gateway at ${API_BASE_URL}. Is the backend running (npm start)?`
    )
  }

  if (!response.ok) {
    throw new ApiError(`The gateway returned HTTP ${response.status} for ${url}.`, response.status)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('The gateway returned a body that is not valid JSON.')
  }

  const data = (payload as { data?: unknown })?.data
  if (!Array.isArray(data)) {
    throw new ApiError('Unexpected response shape: expected an object with a "data" array.')
  }

  return data as ApiModel[]
}
