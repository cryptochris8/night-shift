/**
 * Shared plumbing between the document modal (documents.ts) and its per-kind renderers.
 */
import type { DocumentView, Services, SfxName } from '../core/contracts';
import type { RNG } from '../core/rng';

export interface SequenceStep {
  /** ms to wait before running this step */
  delay: number;
  run: () => void;
}

export interface DocContext {
  s: Services;
  doc: DocumentView;
  /** deterministic per seed — used for typing cadence and delays */
  rng: RNG;
  now12: string;
  now24: string;
  reducedMotion: boolean;
  /** play a UI / diegetic one-shot (non-spatial, quiet) */
  sfx(name: SfxName, volume?: number): void;
  /** staged reveal; the modal fast-forwards it on the first close press */
  sequence(steps: SequenceStep[]): void;
  /** register a keyboard-navigable widget (breaker handle, rocker, button) */
  focusable(el: HTMLElement, activate: () => void): void;
  /** refresh focusables after a re-render */
  clearFocusables(): void;
}

export type KindRenderer = (ctx: DocContext, host: HTMLElement) => void;

/** Split a subtitle like "MRN 0048 · DOB 03/14/1988 | 36 M" into pills. */
export function splitMeta(text: string | undefined): string[] {
  if (!text) return [];
  return text.split(/\s*(?:·|\||—|•)\s*/).map((t) => t.trim()).filter(Boolean);
}

/** "Label: value" → [label, value] or null. */
export function splitField(line: string): [string, string] | null {
  const m = line.match(/^([^:]{1,40}):\s+(.*)$/);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

export function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

export function span(cls: string, text?: string): HTMLSpanElement {
  const e = document.createElement('span');
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Typewriter steps for one element's text (2 chars per step). */
export function typeSteps(target: HTMLElement, text: string, msPerStep: number, onDone?: () => void): SequenceStep[] {
  const steps: SequenceStep[] = [];
  const chunk = 2;
  for (let i = chunk; i < text.length + chunk; i += chunk) {
    const upto = Math.min(text.length, i);
    steps.push({ delay: msPerStep, run: () => { target.textContent = text.slice(0, upto); } });
  }
  if (onDone) steps.push({ delay: 0, run: onDone });
  return steps;
}

/** Redacted text: black bars the same length as the words. */
export function redact(host: HTMLElement, text: string): void {
  for (const word of text.split(/(\s+)/)) {
    if (!word.trim()) {
      host.appendChild(document.createTextNode(word));
      continue;
    }
    const bar = span('ns-redact', word);
    host.appendChild(bar);
  }
}
