import { KeyRound, Moon, Smartphone, Sun } from 'lucide-react'
import { ULIP_MODE, ULIP_PROXY } from '../data'
import { ULIP_BASE, ULIP_ENDPOINTS, ULIP_SYSTEMS } from '../data/ulip/catalogue'
import { useApp } from '../state/app'
import { Badge, Button, Card, CardHead, KeyVal } from '../components/ui'

export function SettingsPage() {
  const { session, theme, toggleTheme, installPrompt, signOut } = useApp()
  if (!session) return null

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

const Mono = ({ children }: { children: React.ReactNode }) =>
  <code className="rounded bg-surface px-1 font-mono text-[11px]">{children}</code>
