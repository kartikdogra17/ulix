import { Compass } from 'lucide-react'
import type { Role } from '../data/roles'

/**
 * Says that a table opened on its role's default view, and offers the way out.
 *
 * Every lensed default renders one of these. A silently pre-filtered table is
 * indistinguishable from missing data — the same failure this project already
 * paid for with screens that flagged everything — so the rule is that an
 * opinion the platform holds on your behalf is always stated and always one
 * click from being dropped.
 */
export function LensDefault({ role, what, onClear }: {
  role: Role; what: string; onClear: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line-soft bg-brand-soft px-3 py-2 text-[12px]">
      <Compass className="size-3.5 shrink-0 text-brand" />
      <span className="min-w-0 text-muted">
        Opened on the <span className="font-medium text-fg">{role}</span> view — {what}.
      </span>
      <button type="button" onClick={onClear}
        className="font-medium text-brand underline-offset-2 hover:underline">
        Show everything
      </button>
    </div>
  )
}
