/**
 * Display-side safety net for PDPA tokens. Crypto-free so client components can import it.
 *
 * Replaces <FIN_HASH:…>, <IC_HASH:…>, <EMAIL_HASH:…>, <PHONE_HASH:…> with `label`.
 * <LEAD_ID:n> is deliberately left alone: it is the lead pseudonym the UI shows.
 * Idempotent. Run it on the FULL accumulated text (not per chunk) so a token split
 * across stream chunks is still caught once it completes.
 */
const PDPA_TOKEN_REGEX = /<(?:FIN|IC|EMAIL|PHONE)_HASH:[0-9a-f]{12}>/g

export function scrubPdpaTokens(text: string, label: string): string {
  return text.replace(PDPA_TOKEN_REGEX, label)
}
