// Small shared building blocks.

export function Logo({ className = '' }) {
  return (
    <a href="/" className={`inline-flex items-center gap-2 font-extrabold tracking-tight ${className}`}>
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="text-xl">Tab</span>
    </a>
  )
}

const variants = {
  primary: 'bg-brand text-white hover:bg-brand/90 shadow-sm',
  secondary: 'bg-white text-ink ring-1 ring-inset ring-line hover:bg-stone-50',
  danger: 'bg-white text-alert ring-1 ring-inset ring-red-200 hover:bg-alert-soft',
  ghost: 'text-muted hover:bg-stone-100 hover:text-ink',
}

export function Button({ variant = 'primary', className = '', type = 'button', busy, children, ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy && <Spinner />}
      {children}
    </button>
  )
}

// `tone="brand"` for the green highlight card; default is white.
export function Card({ tone = 'white', className = '', children, ...props }) {
  const tones = { white: 'bg-white ring-1 ring-line', brand: 'bg-brand text-white' }
  return (
    <section className={`rounded-2xl p-4 shadow-sm sm:p-5 ${tones[tone]} ${className}`} {...props}>
      {children}
    </section>
  )
}

export function Spinner({ className = '' }) {
  return <span className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} aria-hidden="true" />
}

export function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base text-ink placeholder:text-stone-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-stone-50 disabled:text-muted'

export function ErrorNote({ children }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-xl bg-alert-soft px-3 py-2 text-sm font-medium text-alert">
      {children}
    </p>
  )
}
