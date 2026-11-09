// Display only. All amounts arrive from the server as integer stroops; we never do money math here.
export const STROOPS_PER_XLM = 10_000_000n

/**
 * Formats integer stroops into an exact XLM decimal string without exponent or precision loss.
 * Examples: 10000000n -> "1", 45000000n -> "4.5", 1n -> "0.0000001", 0n -> "0".
 */
export function stroopsToXlm(stroops) {
  const s = BigInt(stroops ?? 0)
  const isNegative = s < 0n
  const abs = isNegative ? -s : s
  const whole = abs / STROOPS_PER_XLM
  const fraction = (abs % STROOPS_PER_XLM).toString().padStart(7, '0').replace(/0+$/, '')
  const sign = isNegative ? '-' : ''
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`
}

/**
 * Clean numeric string for editable inputs.
 */
export function stroopsToXlmText(stroops) {
  if (stroops === undefined || stroops === null) return ''
  return stroopsToXlm(stroops)
}

/**
 * Formats integer stroops for human display with comma grouping and XLM label.
 * Example: 125000000n -> "12.50 XLM", 10000000000n -> "1,000.00 XLM", 1n -> "0.0000001 XLM".
 */
export function formatXlm(stroops, { minDecimals = 2, maxDecimals = 7, showUnit = true } = {}) {
  const s = BigInt(stroops ?? 0)
  const isNegative = s < 0n
  const abs = isNegative ? -s : s
  const whole = abs / STROOPS_PER_XLM
  const rawFrac = (abs % STROOPS_PER_XLM).toString().padStart(7, '0')
  const trimmedFrac = rawFrac.replace(/0+$/, '')
  const targetLen = Math.max(minDecimals, Math.min(maxDecimals, trimmedFrac.length))
  const frac = rawFrac.slice(0, targetLen).padEnd(minDecimals, '0')
  const groupedWhole = whole.toLocaleString('en-US')
  const formatted = `${isNegative ? '-' : ''}${groupedWhole}.${frac}`
  return showUnit ? `${formatted} XLM` : formatted
}

/**
 * Alias for backward compatibility if any legacy consumer imports formatNaira:
 * formats as XLM so no Naira symbol is ever displayed.
 */
export function formatNaira(stroops) {
  return formatXlm(stroops)
}
