/**
 * app/[lang]/chat/sanitize-markdown.ts — last-mile markdown guardrail
 * (quick-kayinleong-056).
 *
 * One job: a markdown link whose closing paren never arrived must not reach the screen
 * as literal `[End Financier Info](https://firebasestorage…` text. That is the exact
 * defect in the reported screenshot — the turn was cut off part-way through the third
 * collateral URL, so react-markdown had no link to build and printed the source instead.
 *
 * It happens for two reasons and both end the same way: the stream is mid-flight (normal,
 * for a tick), or the turn died before the URL finished (quick-055's territory). Neither
 * is something the agent should have to look at.
 *
 * The dangling link is REDUCED TO ITS LABEL rather than repaired with a closing paren.
 * A severed URL closed into a valid-looking link is the UI asserting something false —
 * the same rule that made fetchCollateral omit pathless items (quick-050) and that stops
 * repairTruncatedJson from closing a cut URL string. The label alone is true: the document
 * exists, this UI just does not have a whole address for it.
 *
 * Pure and anchored to the END of the content, so it costs one regex per render and can
 * never touch a link that closed properly earlier in the message.
 */

/**
 * A link/image whose `](` opened but whose `)` never arrived, anchored at end-of-string.
 * The label may not contain brackets or newlines, and the URL may not contain a `)` or a
 * newline — so a complete link earlier in the text can never be swallowed.
 */
const DANGLING_LINK_AT_END = /!?\[([^[\]\n]*)\]\([^)\n]*$/

/**
 * Strip a trailing, never-closed markdown link, keeping its label as plain text.
 * Returns `content` unchanged when there is nothing dangling — the common case.
 */
export function sanitizeMarkdown(content: string): string {
  if (!content) return content
  // Cheap reject: no unbalanced `](` tail, nothing to do.
  const open = content.lastIndexOf('](')
  if (open === -1 || content.indexOf(')', open) !== -1) return content
  return content.replace(DANGLING_LINK_AT_END, '$1')
}
