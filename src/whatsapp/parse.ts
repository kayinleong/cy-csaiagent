/**
 * src/whatsapp/parse.ts
 *
 * Portable parser for WhatsApp chat exports (the `_chat.txt` inside the export .zip).
 * Core/shell rule: no imports from app/ or next — pure, unit-testable.
 *
 * Handles the Android export shape:
 *   `DD/MM/YYYY, h:mm am/pm - Sender: message`
 *   `DD/MM/YYYY, HH:MM - Sender: message`
 * System lines (joins/leaves/encryption/admin notices) have no `Sender:` and are
 * counted but excluded from the transcript. Multi-line messages (continuation lines
 * with no date prefix) are folded into the preceding message. Media references
 * (`<attached: file>`, `IMG-….jpg (file attached)`, `<Media omitted>`) are extracted.
 */

export interface WaMessage {
  ts: string;
  sender: string;
  text: string;
  /** attachment filename, when the message is a media reference */
  media?: string;
}

export interface WaParsed {
  groupName: string;
  participants: string[];
  messages: WaMessage[];
  systemLineCount: number;
  /** attachment filenames referenced in the chat (best-effort) */
  mediaRefs: string[];
}

// `DD/MM/YY[YY], H:MM[:SS] [am/pm] - rest`
const LINE_RE = /^‎?(\d{1,2}\/\d{1,2}\/\d{2,4},\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?)\s+-\s+([\s\S]*)$/i;
// `Sender: message` — sender is a short, colon-free prefix
const SENDER_RE = /^([^:\n]{1,80}?):\s([\s\S]*)$/;

const MEDIA_FILE_RE = /([\w.\-()' ]+?\.(?:jpg|jpeg|png|webp|gif|mp4|mov|3gp|m4a|aac|opus|ogg|pdf|docx?|xlsx?|pptx?))\b/i;

function detectMedia(text: string): string | undefined {
  const attached = text.match(/<attached:\s*([^>]+)>/i);
  if (attached) return attached[1].trim();
  const fileAttached = text.match(new RegExp(MEDIA_FILE_RE.source + "\\s*\\(file attached\\)", "i"));
  if (fileAttached) return fileAttached[1].trim();
  const bare = text.match(MEDIA_FILE_RE);
  if (bare) return bare[1].trim();
  return undefined;
}

export function parseWhatsApp(raw: string): WaParsed {
  const lines = raw.split(/\r?\n/);
  const messages: WaMessage[] = [];
  const participants = new Set<string>();
  const mediaRefs: string[] = [];
  let systemLineCount = 0;
  let groupName = "";
  let cur: WaMessage | null = null;
  const flush = () => {
    if (cur) messages.push(cur);
    cur = null;
  };

  for (const rawLine of lines) {
    const m = rawLine.match(LINE_RE);
    if (!m) {
      // continuation of the previous message
      if (cur) cur.text += "\n" + rawLine;
      continue;
    }
    const ts = m[1];
    const rest = m[2].replace(/^‎/, "");

    const created = rest.match(/created group ["“](.+?)["”]/);
    if (created) groupName = created[1];

    const sm = rest.match(SENDER_RE);
    // A colon-bearing line that isn't a known system-notice → a real message.
    if (sm && !/^(You're now|Messages and calls are|This message was)/i.test(rest)) {
      flush();
      const sender = sm[1].trim();
      participants.add(sender);
      let text = sm[2];
      const media = detectMedia(text) || (/<?media omitted>?/i.test(text) ? "(media omitted)" : undefined);
      if (media && media !== "(media omitted)") {
        mediaRefs.push(media);
        text = `[media: ${media}]`;
      } else if (media === "(media omitted)") {
        text = "[media omitted]";
      }
      cur = media ? { ts, sender, text, media } : { ts, sender, text };
    } else {
      // system line (joins / left / encryption / admin / icon change …)
      flush();
      systemLineCount++;
    }
  }
  flush();

  return { groupName, participants: [...participants], messages, systemLineCount, mediaRefs };
}

/** Clean transcript for KB ingestion — one line per message, system noise dropped. */
export function toTranscript(p: WaParsed): string {
  const header = p.groupName ? `WhatsApp group: ${p.groupName}\nParticipants: ${p.participants.join(", ")}\n\n` : "";
  return header + p.messages.map((m) => `[${m.ts}] ${m.sender}: ${m.text}`).join("\n");
}

/**
 * Bounded sample for the project classifier — group name, participants, and the
 * first/last N real messages (keeps the LLM prompt small vs. the full transcript).
 */
export function toClassificationSample(p: WaParsed, n = 40): string {
  const head = p.messages.slice(0, n);
  const tail = p.messages.length > n * 2 ? p.messages.slice(-n) : [];
  const fmt = (m: WaMessage) => `${m.sender}: ${m.text}`.slice(0, 300);
  const parts = [
    `Group name: ${p.groupName || "(unknown)"}`,
    `Participants (${p.participants.length}): ${p.participants.slice(0, 30).join(", ")}`,
    `Messages: ${p.messages.length}, media: ${p.mediaRefs.length}`,
    "",
    "--- first messages ---",
    ...head.map(fmt),
  ];
  if (tail.length) parts.push("", "--- latest messages ---", ...tail.map(fmt));
  return parts.join("\n");
}
