/**
 * NIGHT SHIFT — the single fullscreen post shader.
 *
 * Runs as the LAST composer pass (after OutputPass), so every value here is display-referred
 * sRGB in 0..1. That is what a surveillance monitor, film grain or a blackout operate on, and
 * it keeps the look predictable: 0.5 in here is a 50 % grey on screen.
 *
 * Two looks share the shader: the world (perception effects: medication blur, chromatic
 * aberration, tunnel vision, breathing warp, heartbeat vignette, grain) and the CCTV monitor
 * (pillarbox, barrel, quantised green-grey luminance, scanlines, bleed, noise, tears, snow).
 * Transitions (static, fluorescent flicker, CRT power on/off, fades, whip) ride on top.
 */
import * as THREE from 'three';

export interface PostFXUniforms {
  tDiffuse: THREE.IUniform<THREE.Texture | null>;
  uResolution: THREE.IUniform<THREE.Vector2>;
  uTexel: THREE.IUniform<THREE.Vector2>;
  uTime: THREE.IUniform<number>;
  uSeed: THREE.IUniform<number>;
  // perception
  uGrain: THREE.IUniform<number>;
  uVignette: THREE.IUniform<number>;
  uChroma: THREE.IUniform<number>;
  uBlur: THREE.IUniform<number>;
  uTunnel: THREE.IUniform<number>;
  uDesat: THREE.IUniform<number>;
  uWarp: THREE.IUniform<number>;
  uWobble: THREE.IUniform<number>;
  uHeartbeat: THREE.IUniform<number>;
  // global
  uBlackout: THREE.IUniform<number>;
  uFade: THREE.IUniform<number>;
  uMode: THREE.IUniform<number>;
  // cctv
  uDegradation: THREE.IUniform<number>;
  uOnline: THREE.IUniform<number>;
  uScanline: THREE.IUniform<number>;
  uScanPeriod: THREE.IUniform<number>;
  uQuant: THREE.IUniform<number>;
  uBleed: THREE.IUniform<number>;
  // transients
  uFlash: THREE.IUniform<number>;
  uStaticAmt: THREE.IUniform<number>;
  uFlicker: THREE.IUniform<number>;
  uTear: THREE.IUniform<number>;
  uPixelate: THREE.IUniform<number>;
  uGlitchChroma: THREE.IUniform<number>;
  uWhip: THREE.IUniform<THREE.Vector2>;
  uShake: THREE.IUniform<THREE.Vector2>;
  /** x = band openness 0..1, y = effect amount, z = line glow, w = scanline roll position */
  uCrt: THREE.IUniform<THREE.Vector4>;
  [uniform: string]: THREE.IUniform<unknown>;
}

export function makePostFXUniforms(): PostFXUniforms {
  return {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    uTime: { value: 0 },
    uSeed: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.28 },
    uChroma: { value: 0 },
    uBlur: { value: 0 },
    uTunnel: { value: 0 },
    uDesat: { value: 0 },
    uWarp: { value: 0 },
    uWobble: { value: 0 },
    uHeartbeat: { value: 0 },
    uBlackout: { value: 0 },
    uFade: { value: 0 },
    uMode: { value: 0 },
    uDegradation: { value: 0.1 },
    uOnline: { value: 1 },
    uScanline: { value: 0.17 },
    uScanPeriod: { value: 3 },
    uQuant: { value: 8 },
    uBleed: { value: 0.55 },
    uFlash: { value: 0 },
    uStaticAmt: { value: 0 },
    uFlicker: { value: 1 },
    uTear: { value: 0 },
    uPixelate: { value: 0 },
    uGlitchChroma: { value: 0 },
    uWhip: { value: new THREE.Vector2(0, 0) },
    uShake: { value: new THREE.Vector2(0, 0) },
    uCrt: { value: new THREE.Vector4(1, 0, 0, 0) },
  };
}

export const POSTFX_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const POSTFX_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform vec2 uTexel;
uniform float uTime;
uniform float uSeed;

uniform float uGrain;
uniform float uVignette;
uniform float uChroma;
uniform float uBlur;
uniform float uTunnel;
uniform float uDesat;
uniform float uWarp;
uniform float uWobble;
uniform float uHeartbeat;

uniform float uBlackout;
uniform float uFade;
uniform float uMode;

uniform float uDegradation;
uniform float uOnline;
uniform float uScanline;
uniform float uScanPeriod;
uniform float uQuant;
uniform float uBleed;

uniform float uFlash;
uniform float uStaticAmt;
uniform float uFlicker;
uniform float uTear;
uniform float uPixelate;
uniform float uGlitchChroma;
uniform vec2 uWhip;
uniform vec2 uShake;
uniform vec4 uCrt;

varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 PHOSPHOR = vec3(0.80, 0.93, 0.86);

// Dave Hoskins style hashes: stable in highp, no sin() precision cliffs.
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 px = vUv * uResolution;
  bool cctv = uMode > 0.5;
  // noise clock: wrapped so hash inputs stay small enough for float precision over a long shift
  float tt = mod(uTime, 512.0);

  // --- screens dead -------------------------------------------------------
  if (uMode > 1.5) {
    float dn = hash12(px + vec2(uSeed, floor(tt * 24.0) * 7.0));
    gl_FragColor = vec4(vec3(dn * 0.012), 1.0);
    return;
  }

  // --- screen-space displacement ----------------------------------------------
  uv += uShake;

  if (uWarp > 0.0005) {
    // slow breathing: two incommensurate sines per axis, very low amplitude
    float wt = uTime * 0.55;
    vec2 w = vec2(
      sin(wt + uv.y * 3.1) * 0.6 + sin(wt * 1.7 + uv.y * 7.3) * 0.4,
      cos(wt * 0.8 + uv.x * 2.7) * 0.6 + sin(wt * 1.3 + uv.x * 5.9) * 0.4);
    uv += w * uWarp * 0.004;
  }

  // CRT band (monitor power on/off): the picture is squeezed into a horizontal band
  float crtMask = 1.0;
  float crtGlow = 0.0;
  float crtOpen = 1.0;
  if (uCrt.y > 0.0005) {
    crtOpen = max(uCrt.x, 0.0015);
    float yc = uv.y - 0.5;
    float halfBand = crtOpen * 0.5;
    float inside = step(abs(yc), halfBand);
    uv.y = 0.5 + yc / crtOpen;
    // horizontal sync hunting while the tube settles
    uv.x += (hash11(floor(uv.y * 90.0) + floor(tt * 40.0) + uSeed) - 0.5) * 0.03 * (1.0 - crtOpen) * uCrt.y;
    float outsidePx = max(abs(yc) - halfBand, 0.0) * uResolution.y;
    float endFade = 1.0 - smoothstep(0.40, 0.5, abs(vUv.x - 0.5));
    crtGlow = uCrt.z * exp(-outsidePx * 0.12) * mix(1.0, endFade, 1.0 - crtOpen);
    crtMask = mix(1.0, inside, uCrt.y);
  }

  // --- CCTV geometry: contained 4:3 box, soft edge, subtle barrel ------------------
  float boxMask = 1.0;
  float cornerVig = 1.0;
  vec2 boxUv = uv;
  if (cctv) {
    float boxAspect = 4.0 / 3.0;
    vec2 boxSize = (aspect >= boxAspect) ? vec2(boxAspect / aspect, 1.0) : vec2(1.0, aspect / boxAspect);
    vec2 d = (uv - 0.5) / boxSize;
    boxUv = d + 0.5;
    vec2 edgePx = (0.5 - abs(d)) * boxSize * uResolution;
    boxMask = smoothstep(-1.0, 2.5, min(edgePx.x, edgePx.y));
    vec2 q = d * vec2(boxAspect, 1.0);
    float r2 = dot(q, q);
    // barrel, renormalised so the corners never sample outside the frame
    d *= (1.0 + 0.055 * r2) / 1.038;
    uv = 0.5 + d * boxSize;
    cornerVig = 1.0 - 0.6 * smoothstep(0.15, 0.75, r2);
  }

  // --- horizontal tear bands (glitch pulses, static, feed degradation) -----------------
  float tearDrive = uTear + (cctv ? uDegradation * 0.35 : 0.0);
  float tearHit = 0.0;
  if (tearDrive > 0.001) {
    float seed = floor(tt * 11.0) + uSeed;
    for (int i = 0; i < 2; i++) {
      float s = seed + float(i) * 17.0;
      float hit = step(1.0 - clamp(tearDrive * 0.6, 0.0, 0.95), hash11(s + 2.0));
      float ty = hash11(s);
      float th = 0.015 + 0.07 * hash11(s + 1.0);
      float inBand = step(ty, uv.y) * step(uv.y, ty + th) * hit;
      uv.x += inBand * (hash11(s + 3.0) - 0.5) * (0.04 + 0.12 * tearDrive);
      tearHit = max(tearHit, inBand);
    }
  }

  // --- pixelate (CCTV skips, glitch resync) -----------------------------------------
  if (uPixelate > 0.5) {
    vec2 cell = uPixelate / uResolution;
    uv = (floor(uv / cell) + 0.5) * cell;
  }

  vec2 dc = uv - 0.5;
  vec2 dA = dc * vec2(aspect, 1.0);
  float r = length(dA);

  // --- sampling ------------------------------------------------------------------
  vec3 col;
  if (cctv) {
    // soft horizontal 3-tap: analogue bandwidth limit + colour bleed
    vec2 o = vec2(uTexel.x * (1.0 + uBleed * 2.0), 0.0);
    vec3 c0 = texture2D(tDiffuse, uv).rgb;
    vec3 c1 = texture2D(tDiffuse, uv - o).rgb;
    vec3 c2 = texture2D(tDiffuse, uv + o).rgb;
    col = c0 * 0.5 + (c1 + c2) * 0.25;
  } else {
    float whipLen = length(uWhip);
    if (whipLen > 0.0002) {
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float f = float(i) / 7.0 - 0.5;
        acc += texture2D(tDiffuse, uv + uWhip * f).rgb;
      }
      col = acc / 8.0;
    } else if (uBlur > 0.002) {
      // medication: radial soft blur, grows away from the centre so the middle stays readable
      vec2 dir = dc * uBlur * 0.035 * (0.35 + r);
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 8; i++) {
        float f = (float(i) + 0.5) / 8.0 - 0.5;
        float w = 1.0 - abs(f) * 1.2;
        acc += texture2D(tDiffuse, uv + dir * f).rgb * w;
        wsum += w;
      }
      col = acc / wsum;
    } else {
      col = texture2D(tDiffuse, uv).rgb;
    }

    float ca = (uChroma * 0.004 + uGlitchChroma * 0.012) * (0.3 + r);
    if (ca > 0.00005) {
      vec2 off = dc * ca;
      float rC = texture2D(tDiffuse, uv + off).r;
      float bC = texture2D(tDiffuse, uv - off).b;
      col.r = mix(col.r, rC, 0.85);
      col.b = mix(col.b, bC, 0.85);
    }

    if (uWobble > 0.0005) {
      // injury: a second, drifting image
      vec2 wo = vec2(uWobble * 0.012, uWobble * 0.004 * sin(uTime * 2.3));
      vec3 c2 = texture2D(tDiffuse, uv + wo).rgb;
      col = mix(col, c2, 0.45);
    }
  }

  // --- look ----------------------------------------------------------------------
  if (cctv) {
    float deg = uDegradation;
    float lum = dot(col, LUMA);
    vec3 chroma = col - lum;
    // AGC: lifted blacks, no true whites
    lum = pow(clamp(lum, 0.0, 1.0), 0.85);
    lum = lum * 0.86 + 0.07;
    // 2-3 bit luminance with dither so the steps crawl like a cheap digitiser
    float dith = (hash12(floor(px * 0.5) + vec2(uSeed, floor(tt * 30.0) * 3.0)) - 0.5);
    // early in the night the digitiser is merely cheap; quantisation and crawl grow with degradation
    float levels = max(uQuant, 2.0) * mix(4.0, 1.0, clamp(deg * 1.4, 0.0, 1.0));
    lum = floor(lum * levels + 0.5 + dith * (0.35 + 0.55 * deg)) / levels;
    col = PHOSPHOR * lum + chroma * uBleed * 0.35;

    // sensor noise proportional to degradation
    float n = hash12(floor(px / vec2(2.0, 1.0)) + vec2(uSeed * 3.0, floor(tt * 30.0) * 11.0));
    col += (n - 0.5) * (0.03 + deg * 0.30);
    // interference bands
    float bandSeed = floor(boxUv.y * 60.0 + tt * 7.0);
    float band = step(0.985 - deg * 0.08, hash11(bandSeed + uSeed));
    col += (hash12(px + bandSeed) - 0.5) * band * (0.25 + deg * 0.4);
    // slow dark hum bar rolling up the frame
    float roll = fract(boxUv.y - uTime * 0.11);
    float rb = (roll - 0.5) * 6.0;
    col *= 1.0 - 0.05 * exp(-rb * rb);

    float sl = 0.5 + 0.5 * sin(px.y * 6.2831853 / uScanPeriod);
    col *= 1.0 - uScanline * sl * (0.6 + 0.4 * deg);
    col *= cornerVig;

    if (uOnline < 0.5) {
      // dead feed: pure snow (the UI draws NO SIGNAL)
      float sn = hash12(floor(px / vec2(2.0, 2.0)) + vec2(uSeed, floor(tt * 28.0) * 13.0));
      float sn2 = hash12(floor(px / vec2(6.0, 2.0)) + vec2(uSeed * 2.0, floor(tt * 15.0) * 7.0));
      float s = mix(sn, sn2, 0.35);
      vec3 snow = PHOSPHOR * (0.12 + 0.62 * s);
      snow *= 1.0 - uScanline * sl * 0.8;
      col = snow * cornerVig;
    }

    col = col * boxMask + (1.0 - boxMask) * vec3(0.004, 0.006, 0.005);
  } else {
    float lum = dot(col, LUMA);
    col = mix(col, vec3(lum), clamp(uDesat, 0.0, 1.0));
  }

  // torn rows carry a little noise and a colour shift
  if (tearHit > 0.0) {
    col += (hash12(px + floor(tt * 11.0)) - 0.5) * 0.15 * tearHit;
    col = mix(col, col.gbr * 0.5 + col * 0.5, tearHit * 0.3);
  }

  // --- vignette / heartbeat / tunnel ---------------------------------------------
  float vig = uVignette * (cctv ? 0.35 : 1.0);
  col *= 1.0 - smoothstep(0.3, 1.1, r) * vig;
  float hb = uHeartbeat * smoothstep(0.25, 1.0, r);
  col = mix(col, col * vec3(0.55, 0.12, 0.10) + vec3(0.03, 0.0, 0.0), hb * 0.75);
  if (uTunnel > 0.001) {
    float radius = mix(1.3, 0.45, uTunnel);
    float t = smoothstep(radius * 0.55, radius, r);
    col *= 1.0 - t * 0.85;
  }

  // --- transients ------------------------------------------------------------------
  col *= uFlicker;
  col = mix(col, col * vec3(0.93, 1.0, 0.96), clamp((uFlicker - 1.0) * 3.0, 0.0, 1.0));

  if (uStaticAmt > 0.001) {
    float sa = clamp(uStaticAmt, 0.0, 1.0);
    float frame = floor(tt * 60.0);
    float sn = hash12(floor(px / vec2(2.0, 1.0)) + vec2(uSeed, frame * 5.0));
    float streak = hash12(vec2(floor(px.y / 3.0), frame));
    float sv = mix(sn, streak, 0.35);
    vec3 noiseCol = (cctv ? PHOSPHOR : vec3(0.92, 0.95, 0.94)) * (0.08 + 0.78 * sv);
    // partial static: whole rows drop to noise before the frame is lost
    float rowGate = step(1.0 - sa, hash12(vec2(floor(px.y / 3.0), frame)));
    col = mix(col, noiseCol, max(rowGate, sa * sa));
  }

  if (uCrt.y > 0.0005) {
    float boost = 1.0 + (1.0 - crtOpen) * 1.6;
    vec3 glowCol = vec3(0.75, 0.9, 1.0);
    col = col * crtMask * boost;
    col += glowCol * crtGlow * 1.4;
    float rollD = (vUv.y - uCrt.w) * 14.0;
    col += glowCol * exp(-rollD * rollD) * 0.22 * uCrt.y;
  }

  col += uFlash * vec3(0.9, 0.95, 1.0);

  col *= 1.0 - clamp(uBlackout, 0.0, 1.0);
  col *= 1.0 - clamp(uFade, 0.0, 1.0);

  // --- film grain (world only; CCTV has its own noise) ---------------------------------
  if (!cctv && uGrain > 0.0001) {
    float g = hash12(px + vec2(uSeed * 7.0, floor(tt * 24.0) * 17.0));
    float lumG = dot(col, LUMA);
    col += (g - 0.5) * uGrain * (0.55 + 0.9 * (1.0 - clamp(lumG * 1.5, 0.0, 1.0)));
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
