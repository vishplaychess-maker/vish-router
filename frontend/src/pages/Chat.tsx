import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowUp, MessageSquare, Square } from 'lucide-react'

import { ChatBubble, RoutingBadge, TypingBubble } from '../components/ChatBubble'
import IOSToggle from '../components/IOSToggle'
import ModelSelector from '../components/ModelSelector'
import { fetchModels } from '../lib/api'
import { sendChat, type ChatMessage, type RoutingMeta } from '../lib/chat'

interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  meta?: RoutingMeta | null
  /** Still streaming and nothing rendered yet — show the typing dots. */
  pending?: boolean
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** Route `/chat` — iMessage-style chat with streaming (PRD §4.3). */
export default function Chat() {
  const [searchParams, setSearchParams] = useSearchParams()

  const [models, setModels] = useState<string[]>([])
  const [modelsError, setModelsError] = useState('')
  const [override, setOverride] = useState<string | null>(null)

  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // ---- model list ---------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController()
    fetchModels(controller.signal)
      .then((list) => setModels(list.map((model) => model.id).sort()))
      .catch((err: Error) => {
        if (!controller.signal.aborted) setModelsError(err.message)
      })
    return () => controller.abort()
  }, [])

  /**
   * The selected model is *derived*: an explicit choice wins, then the
   * `?model=` query param (set by a Model Library row click), then the first
   * available model. Deriving avoids an effect that could ping-pong.
   */
  const modelParam = searchParams.get('model')
  const selectedModel = useMemo(() => {
    const wanted = override ?? modelParam
    if (wanted && models.includes(wanted)) return wanted
    return models[0] ?? ''
  }, [override, modelParam, models])

  const chooseModel = (model: string) => {
    setOverride(model)
    setSearchParams({ model }, { replace: true })
  }

  // ---- composer sizing + autoscroll ---------------------------------------
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  // ---- send / stop --------------------------------------------------------
  const send = async () => {
    const text = input.trim()
    if (!text || !selectedModel || busy) return

    const userMessage: UiMessage = { id: newId(), role: 'user', content: text }
    const assistantId = newId()
    const history = [...messages, userMessage]

    setMessages([...history, { id: assistantId, role: 'assistant', content: '', pending: true }])
    setInput('')
    setError(null)
    setBusy(true)

    const controller = new AbortController()
    abortRef.current = controller

    const apiMessages: ChatMessage[] = history.map(({ role, content }) => ({ role, content }))

    try {
      const { content, meta } = await sendChat({
        model: selectedModel,
        messages: apiMessages,
        stream: streaming,
        signal: controller.signal,
        onMeta: (meta) =>
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, meta } : m))),
        onDelta: (delta) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta, pending: false } : m
            )
          ),
      })

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content, meta, pending: false } : m))
      )
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User pressed Stop: keep whatever streamed, drop the bubble if empty.
        setMessages((prev) =>
          prev
            .map((m) => (m.id === assistantId ? { ...m, pending: false } : m))
            .filter((m) => !(m.id === assistantId && !m.content))
        )
      } else {
        const chatError = err as Error & { code?: string }
        setMessages((prev) => prev.filter((m) => m.id !== assistantId))
        setError({ message: chatError.message, code: chatError.code })
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void send()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const banner = error ?? (modelsError ? { message: modelsError, code: undefined } : null)

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ios-label">Chat</h1>
          <p className="mt-1 text-sm text-ios-label-secondary">
            Routed through the VishRouter gateway
          </p>
        </div>

        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-medium text-ios-label">Streaming</span>
            <IOSToggle checked={streaming} onChange={setStreaming} label="Streaming" />
          </div>
          {/* Render the select only once a valid model is resolved. A controlled
              <select> whose value matches no option lets the browser auto-select
              the first one and fire a spurious `change`, which would overwrite
              the `?model=` the Model Library sent us. */}
          {selectedModel ? (
            <ModelSelector
              models={models}
              value={selectedModel}
              onChange={chooseModel}
              disabled={busy}
            />
          ) : (
            <div className="ios-input max-w-[17rem] text-ios-label-tertiary">Loading models…</div>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="mt-8 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ios-blue-tint text-ios-blue">
              <MessageSquare size={26} />
            </span>
            <h2 className="text-xl font-bold text-ios-label">Start a conversation</h2>
            <p className="max-w-md text-sm text-ios-label-secondary">
              {selectedModel ? (
                <>
                  Messages route through whichever provider is healthiest. Currently using{' '}
                  <span className="font-medium text-ios-label">{selectedModel}</span>.
                </>
              ) : (
                'Waiting for the gateway to report its available models.'
              )}
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="flex flex-col gap-1.5">
            {message.role === 'assistant' && message.meta && <RoutingBadge meta={message.meta} />}
            {message.pending && !message.content ? (
              <TypingBubble />
            ) : (
              <ChatBubble role={message.role}>{message.content}</ChatBubble>
            )}
          </div>
        ))}

        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="sticky bottom-0 z-10 -mx-6 mt-6 bg-gradient-to-t from-ios-bg via-ios-bg to-transparent px-6 pt-4 pb-6">
        {banner && (
          <div className="mb-3 flex items-start gap-3 rounded-ios border border-ios-red/25 bg-ios-red/5 px-4 py-3">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-ios-red" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ios-label">{banner.message}</p>
              {banner.code === 'no_provider_available' && (
                <p className="mt-1 text-xs text-ios-label-secondary">
                  No provider has an API key. Add one to <code className="font-mono">.env</code> and
                  restart the gateway.
                </p>
              )}
            </div>
          </div>
        )}

        <form
          onSubmit={onSubmit}
          className="flex items-end gap-2 rounded-[28px] border border-ios-separator bg-ios-surface p-1.5 pl-5 shadow-ios-sm"
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={!selectedModel}
            placeholder="Message VishRouter…"
            aria-label="Message"
            className="max-h-40 flex-1 resize-none border-none bg-transparent py-2.5 text-sm leading-relaxed text-ios-label outline-none placeholder:text-ios-label-tertiary disabled:opacity-50"
          />

          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop generating"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ios-label text-white transition-colors hover:bg-ios-label/80"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || !selectedModel}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ios-blue text-white transition-colors hover:bg-ios-blue-dark disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp size={18} strokeWidth={2.6} />
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
