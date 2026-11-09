import { colorFor, initials } from '../lib/people.js'

export default function Avatar({ person, size = 28, ring = false }) {
  return (
    <span
      title={person.name}
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${ring ? 'ring-2 ring-white' : ''}`}
      style={{ width: size, height: size, background: colorFor(person.id), fontSize: size * 0.38 }}
    >
      {initials(person.name)}
    </span>
  )
}
