import { useEffect, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'

import CodeBlock from '../components/CodeBlock'
import { API_BASE_URL } from '../lib/config'

/**
 * Route `/docs`.
 *
 * A Markdown-style documentation layout: sticky table of contents with
 * scroll-spy, prose sections, code samples and reference tables.
 *
 * The content documents the endpoints this project actually implements, so it
 * is accurate rather than lorem ipsum — but it is deliberately short, and the
 * three "Coming soon" entries mark where deeper guides will go.
 */

const SECTIONS = [
  { id: 'overview', title: 'Overview' },
  { id: 'quick-start', title: 'Quick start' },
  { id: 'authentication', title: 'Authentication' },
  { id: 'chat-completions', title: 'Chat completions' },
  { id: 'streaming', title: 'Streaming' },
  { id: 'routing', title: 'Routing & failover' },
  { id: 'metadata', title: 'Response metadata' },
  { id: 'errors', title: 'Errors' },
] as const

/** Inline code chip. */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-ios-fill px-1.5 py-0.5 font-mono text-[12.5px] text-ios-label">
      {children}
    </code>
  )
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-ios border border-ios-blue/20 bg-ios-blue-tint/60 px-4 py-3">
      <Info size={16} className="mt-0.5 shrink-0 text-ios-blue" />
      <div className="text-sm leading-relaxed text-ios-label">{children}</div>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-bold tracking-tight text-ios-label">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ios-label-secondary">
        {children}
      </div>
    </section>
  )
}

function RefTable({ head, rows }: { head: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <div className="ios-card mt-4 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ios-separator text-left">
              {head.map((cell) => (
                <th
                  key={cell}
                  scope="col"
                  className="px-4 py-2.5 text-[11px] font-semibold tracking-wider whitespace-nowrap text-ios-label-secondary uppercase"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={index}
                className="border-b border-ios-separator last:border-b-0"
              >
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`px-4 py-2.5 align-top ${
                      cellIndex === 0 ? 'font-mono text-[12.5px] whitespace-nowrap text-ios-label' : 'text-ios-label-secondary'
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Docs() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id)

  /**
   * Scroll-spy.
   *
   * Computed from scroll position rather than an IntersectionObserver band:
   * a band matches several sections at once, and — more importantly — the last
   * section can never reach a band near the top because the document runs out
   * of scroll. So the rule is "the last section whose heading has passed the
   * navbar", with an explicit override once the page is scrolled to the end.
   */
  useEffect(() => {
    const NAV_OFFSET = 120

    const updateActive = () => {
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2

      if (atBottom) {
        setActiveId(SECTIONS[SECTIONS.length - 1].id)
        return
      }

      // Annotated: SECTIONS is `as const`, so SECTIONS[0].id would infer as the
      // literal 'overview' and reject every later assignment.
      let current: string = SECTIONS[0].id
      for (const section of SECTIONS) {
        const element = document.getElementById(section.id)
        if (element && element.getBoundingClientRect().top <= NAV_OFFSET) current = section.id
      }
      setActiveId(current)
    }

    updateActive()
    window.addEventListener('scroll', updateActive, { passive: true })
    window.addEventListener('resize', updateActive)
    return () => {
      window.removeEventListener('scroll', updateActive)
      window.removeEventListener('resize', updateActive)
    }
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ios-label">Documentation</h1>
        <p className="mt-1 text-sm text-ios-label-secondary">
          Everything needed to point an existing OpenAI client at VishRouter.
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        {/* Table of contents */}
        <aside className="lg:w-56 lg:shrink-0">
          <nav className="ios-card p-2 lg:sticky lg:top-20" aria-label="On this page">
            <p className="px-3 py-2 text-[11px] font-semibold tracking-wider text-ios-label-secondary uppercase">
              On this page
            </p>
            <ul>
              {SECTIONS.map((section) => {
                const active = section.id === activeId
                return (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      aria-current={active ? 'true' : undefined}
                      className={`block rounded-[10px] px-3 py-1.5 text-[13px] transition-colors duration-150 ${
                        active
                          ? 'bg-ios-blue-tint font-semibold text-ios-blue'
                          : 'text-ios-label-secondary hover:bg-ios-fill hover:text-ios-label'
                      }`}
                    >
                      {section.title}
                    </a>
                  </li>
                )
              })}
            </ul>
          </nav>
        </aside>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <article className="max-w-3xl space-y-10">
            <Section id="overview" title="Overview">
              <p>
                VishRouter is a lightweight AI gateway. It exposes a single
                OpenAI-compatible endpoint and routes each request to OpenAI, Anthropic or
                DeepSeek — translating between their wire formats and failing over automatically
                when a provider is rate-limited or unavailable.
              </p>
              <RefTable
                head={['Endpoint', 'Purpose']}
                rows={[
                  ['POST /v1/chat/completions', 'Chat completion, streaming or buffered'],
                  ['GET /v1/models', 'Models available for routing'],
                  ['GET /v1/usage', 'Usage summary for the authenticated key'],
                  ['GET /health', 'Liveness and per-provider readiness'],
                ]}
              />
              <p>
                The base URL for a local install is <Code>{`${API_BASE_URL}/v1`}</Code>.
              </p>
            </Section>

            <Section id="quick-start" title="Quick start">
              <p>Install, create a VishRouter client key, add a provider key, and start the gateway.</p>
              <CodeBlock
                code={`npm install\ncp .env.example .env\nopenssl rand -hex 32       # put this in VISHROUTER_API_KEYS=local:<key>\n# add OPENAI_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY\nnpm start                 # listening on http://127.0.0.1:3000`}
              />
              <p>
                Any OpenAI SDK can be pointed at it by changing the base URL — no other client
                changes are required.
              </p>
              <CodeBlock
                label="node"
                code={`import OpenAI from 'openai'\n\nconst client = new OpenAI({\n  baseURL: '${API_BASE_URL}/v1',\n  apiKey: process.env.VISHROUTER_API_KEY,\n})\n\nconst reply = await client.chat.completions.create({\n  model: 'gpt-3.5-turbo',\n  messages: [{ role: 'user', content: 'Hello' }],\n})`}
              />
            </Section>

            <Section id="authentication" title="Authentication">
              <p>
                Provider credentials live in <Code>.env</Code> on the server and are never sent to
                clients. A provider whose key is empty is simply skipped, which is why the gateway
                can run with only one key configured.
              </p>
              <Callout>
                Chat and usage endpoints require a VishRouter bearer key by default. The dashboard
                keeps the key only in sessionStorage, so use the API KEY button once per tab session.
              </Callout>
            </Section>

            <Section id="chat-completions" title="Chat completions">
              <CodeBlock
                code={`curl ${API_BASE_URL}/v1/chat/completions \\\n  -H 'authorization: Bearer YOUR_VISHROUTER_KEY' \\\n  -H 'content-type: application/json' \\\n  -d '{\n    "model": "gpt-3.5-turbo",\n    "messages": [{ "role": "user", "content": "Hello" }]\n  }'`}
              />
              <RefTable
                head={['Field', 'Type', 'Notes']}
                rows={[
                  ['model', 'string', 'Required. Must be a model the gateway knows.'],
                  ['messages', 'array', 'Required. Standard OpenAI chat messages.'],
                  ['stream', 'boolean', 'Server-Sent Events when true. Defaults to false.'],
                  ['temperature', 'number', 'Optional, 0–2.'],
                  ['max_tokens', 'integer', 'Optional. Defaulted for providers that require it.'],
                ]}
              />
            </Section>

            <Section id="streaming" title="Streaming">
              <p>
                Set <Code>stream: true</Code> to receive Server-Sent Events using the OpenAI chunk
                format, terminated by <Code>data: [DONE]</Code>.
              </p>
              <CodeBlock
                code={`curl -N ${API_BASE_URL}/v1/chat/completions \\\n  -H 'authorization: Bearer YOUR_VISHROUTER_KEY' \\\n  -H 'content-type: application/json' \\\n  -d '{\n    "model": "gpt-3.5-turbo",\n    "messages": [{ "role": "user", "content": "Count to three" }],\n    "stream": true\n  }'`}
              />
              <p>
                Failover only happens <em>before</em> the first byte. If every provider fails
                up-front you get a normal JSON error with a real status code; a failure after
                streaming has begun arrives as an error frame followed by <Code>[DONE]</Code>.
              </p>
            </Section>

            <Section id="routing" title="Routing & failover">
              <p>
                A request is routed to whichever provider natively serves the model, then to the
                first healthy provider in <Code>fallbackOrder</Code>. The model name is translated
                on the way, so a request for <Code>gpt-3.5-turbo</Code> that lands on DeepSeek is
                sent as <Code>deepseek-chat</Code>.
              </p>
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>native — the provider serves that exact model id</li>
                <li>native-prefix — the provider serves that model family</li>
                <li>equivalence — <Code>modelEquivalents</Code> names the capability twin</li>
                <li>provider-default — that provider&apos;s own default model</li>
              </ol>
              <p>
                Rate limits, 5xx responses, timeouts and network errors trigger the next provider.
                Client errors such as <Code>400</Code> do not — the request is malformed and would
                fail everywhere.
              </p>
            </Section>

            <Section id="metadata" title="Response metadata">
              <p>Every response reports how it was actually served.</p>
              <RefTable
                head={['Header', 'Example', 'Meaning']}
                rows={[
                  ['x-vishrouter-provider', 'deepseek', 'Provider that served the request'],
                  ['x-vishrouter-upstream-model', 'deepseek-chat', 'Model sent upstream'],
                  [
                    'x-vishrouter-model-resolved-via',
                    'equivalence',
                    'Which resolution rule matched',
                  ],
                  ['x-vishrouter-fallback-used', 'true', 'Whether failover occurred'],
                  ['x-vishrouter-attempts', '2', 'Provider attempts made'],
                ]}
              />
              <p>
                Buffered responses also include an <Code>x_vishrouter</Code> object in the body with
                the same detail plus a per-attempt record.
              </p>
            </Section>

            <Section id="errors" title="Errors">
              <p>
                Failures use the OpenAI error envelope, so existing SDKs surface them correctly.
              </p>
              <CodeBlock
                label="json"
                code={`{\n  "error": {\n    "message": "\\"messages\\" must contain at least one message.",\n    "type": "invalid_request_error",\n    "param": "messages",\n    "code": "invalid_request"\n  }\n}`}
              />
              <RefTable
                head={['Status', 'Code', 'Cause']}
                rows={[
                  ['400', 'invalid_request', 'Validation failed'],
                  ['400', 'invalid_json', 'Malformed JSON body'],
                  ['404', 'model_not_found', 'No provider serves that model'],
                  ['429', 'all_providers_failed', 'Every provider was rate-limited'],
                  ['503', 'no_provider_available', 'No provider has an API key'],
                ]}
              />
            </Section>
          </article>
        </div>
      </div>
    </div>
  )
}
