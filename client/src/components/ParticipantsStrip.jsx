import Avatar from './Avatar.jsx'

export default function ParticipantsStrip({ participants, meId }) {
  return (
    <section aria-label="People at this table" className="flex items-center gap-3">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">At the table</span>
      {participants.length === 0 ? (
        <span className="text-sm text-muted">Nobody yet</span>
      ) : (
        <ul className="flex min-w-0 flex-wrap gap-1.5" data-testid="participants">
          {participants.map((p) => (
            <li key={p.id} className="flex items-center gap-1.5 rounded-full bg-white py-0.5 pl-0.5 pr-2.5 text-sm ring-1 ring-line">
              <Avatar person={p} size={24} />
              <span className="max-w-[9rem] truncate font-medium">{p.name}</span>
              {p.id === meId && <span className="text-xs text-brand">(you)</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
