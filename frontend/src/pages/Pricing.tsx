import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Sparkles } from 'lucide-react'

import { fetchModels } from '../lib/api'
import { formatContext, formatPrice, toModelRow, type ModelRow } from '../lib/modelCatalog'

/**
 * Route `/pricing`.
 *
 * Plan tiers are placeholder commercial packaging — there is no billing in the
 * gateway. The per-model table below them is the same catalogue data the Model
 * Library uses, so the two pages can never quote different numbers.
 */

interface Plan {
  name: string
  price: string
  period: string
  tagline: string
  cta: string
  features: string[]
  highlighted?: boolean
}

const PLANS: Plan[] = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    tagline: 'For prototypes and side projects.',
    cta: 'Get started',
    features: ['One provider key', 'Automatic failover', '60 requests / minute', 'Community support'],
  },
  {
    name: 'Pro',
    price: '$29',
    period: 'per month',
    tagline: 'For production applications.',
    cta: 'Start free trial',
    features: [
      'Unlimited provider keys',
      'Failover analytics',
      '10,000 requests / minute',
      '99.9% uptime SLA',
      'Email support',
    ],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: 'billed annually',
    tagline: 'For teams with compliance needs.',
    cta: 'Contact sales',
    features: [
      'SSO and SCIM',
      'Audit logs',
      'Dedicated capacity',
      'Custom routing policy',
      'Priority support',
    ],
  },
]

export default function Pricing() {
  const [rows, setRows] = useState<ModelRow[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchModels(controller.signal)
      .then((models) => setRows(models.map(toModelRow).sort((a, b) => a.inputPrice - b.inputPrice)))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-ios-label">Pricing</h1>
        <p className="mt-1 text-sm text-ios-label-secondary">
          One gateway, one bill to reason about — pay for the plan, not per provider.
        </p>
      </header>

      {/* Plan tiers */}
      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard key={plan.name} plan={plan} />
        ))}
      </div>

      <p className="mt-3 text-xs text-ios-label-secondary">
        Plan tiers are placeholder packaging for this build — the gateway itself has no billing.
      </p>

      {/* Per-model rates */}
      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-ios-label">Per-model rates</h2>
            <p className="mt-0.5 text-sm text-ios-label-secondary">
              No markup on tokens — you pay each provider&apos;s published rate.
            </p>
          </div>
          <Link to="/" className="text-[13px] font-semibold text-ios-blue">
            Browse models
          </Link>
        </div>

        <div className="ios-card mt-4 overflow-hidden">
          {failed ? (
            <p className="px-6 py-10 text-center text-sm text-ios-label-secondary">
              Could not load model rates from the gateway.
            </p>
          ) : rows.length === 0 ? (
            <div className="space-y-px p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded-ios bg-ios-fill" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ios-separator text-left">
                    {['Model', 'Provider', 'Context', 'Input / 1M', 'Output / 1M'].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-4 py-3 text-[11px] font-semibold tracking-wider whitespace-nowrap text-ios-label-secondary uppercase"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-ios-separator transition-colors duration-150 last:border-b-0 hover:bg-ios-fill/60"
                    >
                      <td className="px-4 py-3 font-medium text-ios-label">{row.id}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-ios-label-secondary">
                        {row.provider}
                      </td>
                      <td className="px-4 py-3 tabular-nums whitespace-nowrap text-ios-label-secondary">
                        {formatContext(row.contextLength)}
                      </td>
                      <td className="px-4 py-3 tabular-nums whitespace-nowrap text-ios-label">
                        {formatPrice(row.inputPrice)}
                      </td>
                      <td className="px-4 py-3 tabular-nums whitespace-nowrap text-ios-label">
                        {formatPrice(row.outputPrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-3 text-xs text-ios-label-secondary">
          Rates are sample catalogue data — the gateway&apos;s{' '}
          <code className="font-mono">/v1/models</code> endpoint returns model ids only.
        </p>
      </section>
    </div>
  )
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={`ios-card relative flex flex-col p-6 ${
        plan.highlighted ? 'ring-2 ring-ios-blue' : ''
      }`}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-ios-blue px-3 py-1 text-[11px] font-semibold text-white shadow-ios-sm">
          <Sparkles size={12} />
          Most popular
        </span>
      )}

      <h2 className="text-sm font-semibold tracking-wide text-ios-label-secondary uppercase">
        {plan.name}
      </h2>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-4xl font-bold tracking-tight text-ios-label">{plan.price}</span>
        <span className="text-sm text-ios-label-secondary">{plan.period}</span>
      </div>

      <p className="mt-2 text-sm text-ios-label-secondary">{plan.tagline}</p>

      <ul className="mt-5 flex-1 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm text-ios-label">
            <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-ios-blue-tint text-ios-blue">
              <Check size={11} strokeWidth={3.5} />
            </span>
            {feature}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={`mt-6 w-full ${plan.highlighted ? 'ios-btn-primary' : 'ios-btn-secondary'}`}
      >
        {plan.cta}
      </button>
    </div>
  )
}
