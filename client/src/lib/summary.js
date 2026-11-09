import { formatXlm } from './money.js'

// Builds the host's copyable settlement text from server-calculated totals.
export function buildSummary(view) {
  const names = Object.fromEntries(view.participants.map((p) => [p.id, p]))
  const lines = ['Tab — Stellar Bill Summary', view.table.name]
  for (const p of view.totals.participants) {
    const statusInfo = p.settlementStatus === 'confirmed' ? ' [Paid ✓]' : ''
    const memoInfo = p.paymentReference ? ` (Memo: ${p.paymentReference})` : ''
    lines.push(`- ${names[p.participantId]?.name || 'Participant'}: ${formatXlm(p.total)}${memoInfo}${statusInfo}`)
  }
  lines.push(
    `- Unclaimed items: ${view.totals.unclaimed.count}${
      view.totals.unclaimed.count ? ` (${formatXlm(view.totals.unclaimed.total)})` : ''
    }`,
  )
  lines.push(`- Total bill: ${formatXlm(view.totals.bill.total)}`)
  if (view.table.hostWallet) {
    lines.push(`- Host Stellar address: ${view.table.hostWallet}`)
  }
  lines.push('- Payment network: Stellar Testnet (native XLM)')
  return lines.join('\n')
}
