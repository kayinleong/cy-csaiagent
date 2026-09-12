/**
 * src/config/priority-list.ts — runtime read of the admin "Priority List"
 * (quick-kayinleong-090).
 *
 * The write half is the admin Server Action at
 * app/[lang]/(admin)/priority-list/actions.ts; this is the read half, and it is the
 * exact counterpart of src/llm/provider.ts modelFor() reading appConfig/modelConfig.
 *
 * The doc is Admin-SDK only — firestore.rules denies ALL client access to
 * /appConfig/{configId}, so this must never be called from a client component.
 *
 * FAILS SOFT, ALWAYS. A Firestore outage, missing ADC in offline dev, or an absent
 * doc all resolve to '' — which every consumer treats as "no priority configured"
 * and skips. An admin ordering preference is never worth failing a chat turn over;
 * src/router/index.ts:86-93 is the record of what an unwrapped throw on this path
 * costs (entire turns lost to an empty 500 body).
 *
 * Core/shell rule: this file must NOT import from app/ or next.
 */

import { priorityListRef, PRIORITY_LIST_DOC_ID } from '@/src/firebase/collections'

/**
 * Read the admin's priority-ordering prompt.
 *
 * @returns The stored text, or '' when unset, empty, or unreadable. Never throws.
 */
export async function readPriorityList(): Promise<string> {
  try {
    const snap = await priorityListRef().doc(PRIORITY_LIST_DOC_ID).get()
    const text = snap.data()?.text
    return typeof text === 'string' ? text.trim() : ''
  } catch {
    // Firestore unavailable (offline dev, ADC not configured, transient outage).
    // Fall through to "no priority configured" — see the fail-soft note above.
    return ''
  }
}
