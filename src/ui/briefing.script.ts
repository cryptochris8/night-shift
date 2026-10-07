/**
 * The title-screen briefing: what the night asks of you and how it can end. The title shows these
 * lines and a recorded narrator reads them: `node tools/narration.mjs` turns them into
 * src/assets/briefing.mp3 and the cue sheet briefing.cues.ts. Edit a line here, then re-run the
 * tool; tests/briefing.test.ts fails while the recording is stale.
 *
 * Self-contained on purpose (no imports, erasable types only) so the Node tool can import it too.
 */

export interface BriefingLine {
  /** stable key: the narration cache and the cue sheet use it */
  id: string;
  /** on-screen text; *stars* mark emphasis */
  text: string;
  /** spoken form when it differs from the screen (times, abbreviations) */
  say?: string;
  /** the four ending rows carry the ending's title, as the ending screen names it */
  ending?: string;
  /** silence after the line in the recording, seconds */
  gap: number;
}

export interface BriefingBlock {
  kind: 'para' | 'endings';
  lines: BriefingLine[];
}

/** Where each line sits in the recording (seconds) and the hash of the words it was recorded from. */
export interface BriefingCues {
  duration: number;
  lines: Record<string, { start: number; end: number; hash: string }>;
}

export const BRIEFING: BriefingBlock[] = [
  {
    kind: 'para',
    lines: [
      { id: 'who', text: 'One hospital. One night. Three people.', gap: 0.75 },
      {
        id: 'cast',
        text: 'From 10:45 to 1:45 you are *John*, a patient waiting to be seen; *Susie*, the nurse covering the shift; and *Paul*, who keeps the building running.',
        say: 'From ten forty-five to one forty-five, you are John, a patient waiting to be seen. Susie, the nurse covering the shift. And Paul, who keeps the building running.',
        gap: 0.5,
      },
      { id: 'cams', text: 'Through the security cameras, you see the rest.', gap: 0.9 },
    ],
  },
  {
    kind: 'para',
    lines: [{ id: 'clock', text: "Switch between them any time. The clock runs for everyone, even the ones you aren't watching.", gap: 0.9 }],
  },
  {
    kind: 'para',
    lines: [
      {
        id: 'safe',
        text: "*Keep everyone accounted for.* When the ring around someone's portrait starts to fill, they need you. Leave them alone too long and they go missing.",
        gap: 0.9,
      },
    ],
  },
  {
    kind: 'para',
    lines: [
      {
        id: 'truth',
        text: '*Find out what is really happening.* Every Night Seed hides something different: something real, something in their heads, or something worse.',
        gap: 0.55,
      },
      { id: 'senses', text: "Fear, fatigue and medication bend what each of them sees, and the cameras don't always agree.", gap: 0.55 },
      { id: 'choices', text: 'What you choose changes the night, from whether Susie believes John to which rooms Paul keeps powered in the blackout.', gap: 1.0 },
    ],
  },
  {
    kind: 'endings',
    lines: [
      { id: 'endings', text: 'The night ends one of four ways.', gap: 0.6 },
      { id: 'morning', ending: 'Morning Comes', text: 'Everyone makes it through, and nothing is explained.', gap: 0.55 },
      { id: 'rational', ending: 'A Rational Explanation', text: 'Everyone makes it, and three or more clues point to ordinary causes.', gap: 0.55 },
      { id: 'came_through', ending: 'Something Came Through', text: 'Everyone makes it, the night really was something more, and three or more clues prove it.', gap: 0.55 },
      { id: 'missing', ending: 'Someone Missing', text: "Lose anyone, and that's how the night ends.", gap: 1.1 },
    ],
  },
  {
    kind: 'para',
    lines: [{ id: 'close', text: "Clock in when you're ready.", gap: 0 }],
  },
];

export function briefingLines(): BriefingLine[] {
  return BRIEFING.flatMap((b) => b.lines);
}

/** The screen text without emphasis marks. */
export function plainText(text: string): string {
  return text.split('*').join('');
}

/** What the narrator says for a line: its `say`, the ending's title then its text, or the plain text. */
export function spokenText(line: BriefingLine): string {
  if (line.say) return line.say;
  const plain = plainText(line.text);
  return line.ending ? `${line.ending}. ${plain}` : plain;
}

/** FNV-1a, 8 hex chars: the cue sheet stores it per line so a stale recording is caught. */
export function speechHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
