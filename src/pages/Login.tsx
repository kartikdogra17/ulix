import { useState } from 'react'
import { ArrowRight, Boxes, ShieldCheck } from 'lucide-react'
import { DEMO_ORGS, useApp } from '../state/app'
import { ULIP_ENDPOINTS, ULIP_SYSTEMS } from '../data/ulip/catalogue'
import { Button, Field, Input, Select } from '../components/ui'
import { cn } from '../lib/cn'

const MINISTRIES = new Set(ULIP_ENDPOINTS.map((e) => e.ministry))

export function Login() {
  const { signIn } = useApp()
  const [name, setName] = useState('Ananya Deshmukh')
  const [orgId, setOrgId] = useState(DEMO_ORGS[0].id)

  const org = DEMO_ORGS.find((o) => o.id === orgId)!
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    signIn({
      name: name.trim() || 'Operations User',
      email: `${(name.trim() || 'ops').split(' ')[0].toLowerCase()}@${org.name.split(' ')[0].toLowerCase()}.in`,
      role: org.role === 'Regulator' ? 'Logistics Analyst' : 'Control Tower Lead',
      org,
    })
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-bg-deep p-10 lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{ backgroundImage:
            'radial-gradient(60% 50% at 30% 20%, color-mix(in srgb, var(--c-brand) 16%, transparent), transparent 70%), radial-gradient(50% 45% at 80% 75%, color-mix(in srgb, var(--c-accent) 18%, transparent), transparent 70%)' }} />
        <div className="relative flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-brand text-brand-fg">
            <Boxes className="size-5" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">ULIP</div>
            <div className="text-[11px] text-muted">Unified Logistics Interface Platform</div>
          </div>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight">
            One window onto every consignment, vehicle and document in your network.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            Multimodal visibility, fleet intelligence and compliance built on the
            government data ULIP already brokers — FASTag, VAHAN, SARATHI, e-Way Bill,
            FOIS, ICEGATE, PCS and more, behind one authenticated gateway.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-6 border-t border-line pt-6">
            {[
              ['Endpoints', ULIP_ENDPOINTS.length],
              ['Source systems', ULIP_SYSTEMS.length],
              ['Ministries', MINISTRIES.size],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dd className="tnum text-2xl font-semibold tracking-tight">{v as number}</dd>
                <dt className="mt-0.5 text-[11px] uppercase tracking-wide text-faint">{k as string}</dt>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-[11px] leading-relaxed text-faint">
          Catalogue generated from the integration documents published on goulip.in.
          This build ships a simulated gateway; production access requires an approved
          ULIP account and signed NDA.
        </p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center px-5 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="grid size-9 place-items-center rounded-xl bg-brand text-brand-fg">
              <Boxes className="size-5" strokeWidth={2.4} />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">ULIP</div>
              <div className="text-[11px] text-muted">Unified Logistics Interface Platform</div>
            </div>
          </div>

          <h2 className="text-xl font-semibold tracking-tight">Sign in to the control tower</h2>
          <p className="mt-1.5 text-[13px] text-muted">
            Pick the organisation you operate as. Every screen adapts to its role.
          </p>

          <div className="mt-7 space-y-4">
            <Field label="Your name">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>

            <Field label="Organisation" hint={`${org.role} · ${org.plan} client · ${org.members} members`}>
              <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {DEMO_ORGS.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} — {o.role}</option>
                ))}
              </Select>
            </Field>

            <div className={cn('rounded-lg border border-line bg-surface-2 p-3 text-[12px] leading-relaxed text-muted')}>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-fg">
                <ShieldCheck className="size-3.5 text-ok" /> No credentials needed
              </div>
              This is a demonstration sign-in. Real ULIP access uses a gateway
              username and password held server-side by the proxy — never in the browser.
            </div>

            <Button type="submit" variant="primary" className="w-full">
              Enter control tower <ArrowRight className="size-4" />
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
