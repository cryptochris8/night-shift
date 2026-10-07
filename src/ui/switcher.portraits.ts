/**
 * Procedural monochrome portraits for the security-console cards.
 * Each is a featureless silhouette (face kept in shadow) with an outfit cue:
 * John — civilian hoodie, Susie — scrubs V-neck and a bun, Paul — EVS cap and polo.
 */
import type { CharacterId } from '../core/types';

const INK = '#c3cbc5';
const SHADOW = '#2a3230';
const DEEP = '#121715';

function head(cx: number, cy: number, rx: number, ry: number): string {
  // skull + a soft shadow over the face so there are never features to read
  return (
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${INK}"/>` +
    `<path d="M${cx - rx * 0.78} ${cy + ry * 0.05} Q${cx} ${cy + ry * 1.25} ${cx + rx * 0.78} ${cy + ry * 0.05} ` +
    `Q${cx + rx * 0.6} ${cy + ry * 0.45} ${cx} ${cy + ry * 0.62} Q${cx - rx * 0.6} ${cy + ry * 0.45} ${cx - rx * 0.78} ${cy + ry * 0.05}Z" fill="${SHADOW}" opacity="0.55"/>`
  );
}

function neck(cx: number, top: number, w: number, h: number): string {
  return `<rect x="${cx - w / 2}" y="${top}" width="${w}" height="${h}" fill="${INK}"/>`;
}

function johnSVG(): string {
  return (
    // hood behind the head (ragged top edge)
    `<path d="M14 66 L14 44 Q14 31 22 27 L25 22 Q28 14 32 15 Q37 13 40 21 L43 27 Q50 31 50 44 L50 66Z" fill="${SHADOW}"/>` +
    head(32, 27, 9.6, 11.2) +
    // messy hair: irregular cap with a few tufts
    `<path d="M22.6 24.5 Q22 14.5 31 15 Q35 12.6 38.4 16.4 Q42.8 17 41.6 25 Q39.8 20.4 35.6 21.2 Q32.2 18.2 28.4 21.6 Q25 20.2 22.6 24.5Z" fill="${INK}"/>` +
    neck(32, 36, 7.5, 7) +
    // hoodie body with a wide open collar and drawstrings
    `<path d="M8 66 L8 52 Q9 44.5 19 42.5 L27 40.5 Q32 47 37 40.5 L45 42.5 Q55 44.5 56 52 L56 66Z" fill="${INK}"/>` +
    `<path d="M22 42 Q32 52 42 42 L40 44.5 Q32 55 24 44.5Z" fill="${DEEP}" opacity="0.8"/>` +
    `<path d="M29 48 L28 60 M35 48 L36 60" stroke="${DEEP}" stroke-width="0.9" opacity="0.7"/>`
  );
}

function susieSVG(): string {
  return (
    // bun at the back of the head
    `<circle cx="39.5" cy="15.5" r="5.2" fill="${INK}"/>` +
    head(32, 26, 9.2, 11) +
    // hair pulled back smoothly
    `<path d="M23 25 Q22.5 14 32 14.5 Q40.5 14 41.2 24.5 Q38.5 18.8 32.3 19.4 Q26.2 19.2 23 25Z" fill="${INK}"/>` +
    neck(32, 35, 7, 7) +
    // scrubs body, V-neck
    `<path d="M9 66 L9 52 Q10 44 20 42 L27 40 L32 50 L37 40 L44 42 Q54 44 55 52 L55 66Z" fill="${INK}"/>` +
    `<path d="M26.4 40.4 L32 50.4 L37.6 40.4 L35.8 40.9 L32 47.6 L28.2 40.9Z" fill="${DEEP}" opacity="0.9"/>` +
    // stethoscope draped around the neck
    `<path d="M25.5 43 Q24 56 29 60 M38.5 43 Q40.5 54 36.5 58" stroke="${DEEP}" stroke-width="1.1" fill="none" opacity="0.75"/>` +
    `<circle cx="29.6" cy="60.8" r="2" fill="${DEEP}" opacity="0.8"/>` +
    // badge reel on the chest
    `<rect x="39" y="52" width="4.2" height="5.4" fill="${DEEP}" opacity="0.6"/>`
  );
}

function paulSVG(): string {
  return (
    head(32, 27.5, 9.4, 10.8) +
    // cap: crown + brim
    `<path d="M22 25.5 Q22 15.5 32 15.5 Q42 15.5 42 25.5 L42.8 26.8 L21.2 26.8Z" fill="${INK}"/>` +
    `<path d="M21 26.6 L47.5 27.4 Q47.6 29.4 45 29.2 L22 28.4Z" fill="${INK}"/>` +
    `<path d="M22.3 26.9 L41.8 26.9 L41.4 28.6 L22.6 28.4Z" fill="${SHADOW}" opacity="0.5"/>` +
    neck(32, 36.5, 7.6, 6.5) +
    // polo body with collar points and a placket
    `<path d="M8 66 L8 52.5 Q9 45 19 43 L26.5 41 L32 46.5 L37.5 41 L45 43 Q55 45 56 52.5 L56 66Z" fill="${INK}"/>` +
    `<path d="M26.5 41 L32 46.5 L28.4 48.6 L25.2 42.4Z M37.5 41 L32 46.5 L35.6 48.6 L38.8 42.4Z" fill="${DEEP}" opacity="0.8"/>` +
    `<path d="M32 47 L32 56" stroke="${DEEP}" stroke-width="0.9" opacity="0.7"/>` +
    // radio clipped to the shoulder strap
    `<rect x="44" y="48" width="4.4" height="7.5" fill="${DEEP}" opacity="0.85"/>` +
    `<rect x="45.6" y="45" width="1.2" height="3.4" fill="${DEEP}" opacity="0.85"/>`
  );
}

export function portraitSVG(id: CharacterId): string {
  const body = id === 'john' ? johnSVG() : id === 'susie' ? susieSVG() : paulSVG();
  return (
    `<svg class="ns-portrait" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">` +
    `<defs><clipPath id="ns-pclip-${id}"><circle cx="32" cy="32" r="30"/></clipPath></defs>` +
    `<circle cx="32" cy="32" r="30" fill="#0a0e0c"/>` +
    `<g clip-path="url(#ns-pclip-${id})">${body}</g>` +
    `<circle cx="32" cy="32" r="30" fill="none" stroke="rgba(185,240,201,0.35)" stroke-width="0.8"/>` +
    `</svg>`
  );
}

/** Small surveillance-camera glyph for the CCTV card. */
export function cctvGlyphSVG(): string {
  return (
    `<svg class="ns-portrait ns-portrait--cctv" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">` +
    `<circle cx="32" cy="32" r="30" fill="#0a0e0c"/>` +
    `<path d="M14 26 L44 18 L47 29 L17 37Z" fill="${INK}"/>` +
    `<path d="M44 20.5 L52 22 L51 31 L46.5 29Z" fill="${INK}"/>` +
    `<circle cx="49" cy="25.6" r="2.1" fill="${DEEP}"/>` +
    `<path d="M24 36 L22 46 L16 46 L16 48.5 L30 48.5 L30 46 L25.5 46 L27.5 35.2Z" fill="${INK}" opacity="0.9"/>` +
    `<rect x="12" y="23" width="4" height="9" fill="${INK}" opacity="0.8"/>` +
    `<circle cx="20.5" cy="28.6" r="1.1" fill="#ff6a4a"/>` +
    `<circle cx="32" cy="32" r="30" fill="none" stroke="rgba(185,240,201,0.35)" stroke-width="0.8"/>` +
    `</svg>`
  );
}

/** Initial letter used for floor-plan dots. */
export function initialOf(id: CharacterId): string {
  return id === 'john' ? 'J' : id === 'susie' ? 'S' : 'P';
}
