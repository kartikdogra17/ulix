import { KeyRound, Moon, Smartphone, Sun } from 'lucide-react'
import { ULIP_MODE, ULIP_PROXY } from '../data'
import { ULIP_BASE, ULIP_ENDPOINTS, ULIP_SYSTEMS } from '../data/ulip/catalogue'
import { useApp } from '../state/app'
import { MODULE_LABEL, lensFor } from '../data/roles'
import { SIGNAL_LABEL } from '../data/fusion'
import { Badge, Button, Card, CardHead, KeyVal } from '../components/ui'

export function SettingsPage() {
  const { session, theme, toggleTheme, installPrompt, signOut } = useApp()
  if (!session) return null

  const lens = lensFor(session.org.role)
  // label and basis do not depend on the data, only on the lens.
  const head = lens.headline([], null)
  const hidden = Object.keys(MODULE_LABEL).filter((to) => !lens.nav.includes(to))
  const pd = lens.pageDefaults
  const opensOn: Array<[string, string]> = ([
    ['Consignments', pd.shipments.note],
    ['Fleet', pd.fleet.note],
    ['Compliance', pd.compliance.note],
    ['Counterparties', pd.parties.note],
  ] as Array<[string, string | undefined]>).filter((r): r is [string, string] => Boolean(r[1]))

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-[13px] text-muted">Organisation, gateway connection and app preferences.</p>
      </header>

      <Card>
        <CardHead title="Organisation" sub="Your ULIP client identity" />
        <div className="px-4 py-2">
          <dl>
            <KeyVal k="Name" v={session.org.name} />
            <KeyVal k="Role" v={session.org.role} />
            <KeyVal k="GSTIN" v={session.org.gstin} mono />
            <KeyVal k="ULIP client id" v={session.org.ulipClientId} mono />
            <KeyVal k="Plan" v={<Badge tone={session.org.plan === 'Production' ? 'ok' : 'warn'}>{session.org.plan}</Badge>} />
            <KeyVal k="Members" v={session.org.members} />
          </dl>
        </div>
      </Card>

      <Card>
        <CardHead title="Role lens"
          sub={`What changes because this organisation is a ${session.org.role}`} />
        <div className="space-y-4 p-4">
          <p className="text-[13px] leading-relaxed text-muted">{lens.remit}</p>

          <div>
            <Label>Leads with</Label>
            <div className="text-[13px] font-medium">{head.label}</div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{head.basis}</p>
          </div>

          <div>
            <Label>Modules advertised</Label>
            <div className="flex flex-wrap gap-1">
              {lens.nav.map((to) => (
                <Badge key={to} tone="neutral">
                  {to === '/' ? lens.towerTitle : MODULE_LABEL[to]}
                </Badge>
              ))}
            </div>
            {hidden.length > 0 && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                Left out of this sidebar: {hidden.map((to) => MODULE_LABEL[to]).join(', ')}.
              </p>
            )}
          </div>

          {opensOn.length > 0 && (
            <div>
              <Label>Modules open on</Label>
              <ul className="space-y-1">
                {opensOn.map(([mod, note]) => (
                  <li key={mod} className="flex flex-wrap gap-x-2 text-[12px] leading-relaxed">
                    <span className="w-28 shrink-0 font-medium">{mod}</span>
                    <span className="min-w-0 text-muted">{note}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                Each of these is shown on the page itself and clears in one click.
              </p>
            </div>
          )}

          <div>
            <Label>Sorted to the top of the queue</Label>
            <div className="flex flex-wrap gap-1">
              {lens.primaryKinds.map((k) => (
                <Badge key={k} tone="brand">{SIGNAL_LABEL[k]}</Badge>
              ))}
            </div>
          </div>

          {lens.mutedKinds.length > 0 && (
            <div>
              <Label>Ranked last — someone else's to fix</Label>
              <div className="flex flex-wrap gap-1">
                {lens.mutedKinds.map((k) => (
                  <Badge key={k} tone="neutral" className="opacity-60">{SIGNAL_LABEL[k]}</Badge>
                ))}
              </div>
            </div>
          )}

          <p className="rounded-lg border border-line bg-surface-2 p-3 text-[11px] leading-relaxed text-faint">
            <span className="font-medium text-muted">This is a lens, not access control.</span>{' '}
            It changes what the platform puts in front of you — the order of the
            sidebar, which conflicts sort to the top, and which single number leads
            the control tower. It filters no records: every route still resolves by
            URL and every signal stays in the queue. What an organisation is actually
            entitled to see is decided by the datasets approved against its ULIP
            account, not by anything held in this browser.
          </p>
        </div>
      </Card>

      <Card>
        <CardHead
          title="Gateway connection"
          sub="Where consignment, vehicle and document data comes from"
          right={<Badge tone={ULIP_MODE === 'live' ? 'ok' : 'warn'} dot>{ULIP_MODE}</Badge>}
        />
        <div className="space-y-3 p-4">
          <dl>
            <KeyVal k="Mode" v={ULIP_MODE === 'live' ? 'Live ULIP gateway' : 'Simulated gateway'} />
            <KeyVal k="Production base" v={ULIP_BASE.production} mono />
            <KeyVal k="Staging base" v={ULIP_BASE.staging} mono />
            <KeyVal k="Proxy" v={ULIP_PROXY} mono />
            <KeyVal k="Catalogue" v={`${ULIP_ENDPOINTS.length} endpoints · ${ULIP_SYSTEMS.length} systems`} />
          </dl>

          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium">
              <KeyRound className="size-3.5 text-brand" /> Going live
            </div>
            <ol className="ml-4 list-decimal space-y-1 text-[12px] leading-relaxed text-muted">
              <li>Register on goulip.in, sign the NDA and submit your use case for the datasets you need.</li>
              <li>Once approved, run the proxy that holds the gateway credentials:
                <pre className="mt-1 overflow-x-auto rounded border border-line bg-surface p-2 font-mono text-[11px]">
ULIP_USERNAME=… ULIP_PASSWORD=… \
  ULIP_ENV=staging node server/ulip-proxy.mjs</pre>
              </li>
              <li>Restart the app with <Mono>VITE_ULIP_MODE=live</Mono>.</li>
            </ol>
            <p className="mt-2 text-[11px] text-faint">
              The browser never receives the ULIP username, password or bearer token —
              only the proxy does.
            </p>
            <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-faint">
              ULIX is independent software built on the Unified Logistics Interface
              Platform. It is not a government service and is not affiliated with NICDC
              Logistics Data Services or DPIIT.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHead title="Preferences" />
        <div className="divide-y divide-line-soft">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <div className="text-[13px] font-medium">Colour theme</div>
              <div className="text-[11px] text-muted">Currently {theme}</div>
            </div>
            <Button size="sm" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              Switch to {theme === 'dark' ? 'light' : 'dark'}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <div className="text-[13px] font-medium">Install as an app</div>
              <div className="text-[11px] text-muted">
                {installPrompt ? 'Add ULIP to your home screen for offline access.' : 'Already installed, or not supported in this browser.'}
              </div>
            </div>
            <Button size="sm" variant={installPrompt ? 'primary' : 'outline'} disabled={!installPrompt}
              onClick={() => installPrompt?.()}>
              <Smartphone className="size-3.5" /> Install
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <div className="text-[13px] font-medium">Sign out</div>
              <div className="text-[11px] text-muted">Ends this local session.</div>
            </div>
            <Button size="sm" variant="danger" onClick={signOut}>Sign out</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

const Label = ({ children }: { children: React.ReactNode }) =>
  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{children}</div>

const Mono = ({ children }: { children: React.ReactNode }) =>
  <code className="rounded bg-surface px-1 font-mono text-[11px]">{children}</code>
