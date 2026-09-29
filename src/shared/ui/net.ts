// Signed net, e.g. "+1.5" / "-3.0".
export const fmtNet = (n: number, dp = 1) => (n >= 0 ? '+' : '') + n.toFixed(dp)

// Text color for a hand or session net: gray when the player didn't VPIP or
// broke even, otherwise green for a win and red for a loss.
export function netTone(net: number, vpip = true): string {
  if (!vpip || net === 0) return 'text-gray-500'
  return net > 0 ? 'text-green-400' : 'text-red-400'
}
