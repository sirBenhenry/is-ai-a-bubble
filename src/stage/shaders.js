// GLSL for the plate renderer.
//
// A plate is a photograph plus a depth map (how near each part of it is). The depth map is
// read off the Gaussian-splat scene that Apple's SHARP model builds from the photograph
// (see tools/README.md). On screen the photograph becomes a sheet of soft discs standing at
// their true distances; a real camera travels past them.
//
// The discs do not carry the picture. Each one only says "this part of the photograph sits
// HERE in space", and the photograph itself supplies the detail. So a settled plate is the
// photograph, pixel for pixel, however few discs are drawn.
//
// Three passes per plate:
//   1. NEAREST  which surface is in front at each pixel (a soft depth buffer)
//   2. GATHER   front discs write where in the photograph they come from. Each disc is
//               trimmed to its own surface using the depth map, so a foreground disc never
//               drags background pixels along. Discs that are drifting loose write a plain
//               tone instead, and so do the gaps that open behind foreground edges.
//   3. RESOLVE  each pixel looks the photograph up, blurs it by distance from the focal
//               plane, mixes in the plain tones and fades out where nothing covers it

const COMMON = /* glsl */ `
vec4 hash4(vec2 p) {
  vec4 q = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}
float hash1(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash1(i), hash1(i + vec2(1, 0)), u.x),
             mix(hash1(i + vec2(0, 1)), hash1(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  return 0.57 * vnoise(p) + 0.29 * vnoise(p * 2.03 + 17.1) + 0.14 * vnoise(p * 4.01 + 43.7);
}
`;

const VARYINGS = /* glsl */ `
VARY vec2 vUv;        // where in the photograph this disc comes from
VARY vec2 vPos;       // where its centre lands on screen, css px
VARY vec2 vScale;     // photograph uv per css px, at this disc's distance
VARY vec4 vWeight;    // settled weight, loose weight, tone, nearness in the photograph
VARY vec2 vEdge;      // unit direction on screen towards the nearer surface (zero where the scene is smooth)
VARY float vNearness; // nearness from the travelling camera (1 = nearest surfaces)
`;

export const SPLAT_VERT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uDepth;  // nearness in the photograph: 1 nearest .. 0 infinitely far
uniform sampler2D uPhoto;
uniform vec2 uDepthSize;   // depth map texels
uniform float uTexPerPx;   // photo texels per css px
uniform vec4 uWin;         // part of the photograph that carries discs: u0, v0, u1, v1
uniform vec2 uGrid;        // disc columns, rows
uniform vec3 uEye;         // camera position
uniform mat3 uRot;         // world -> camera
uniform float uFocal;      // css px
uniform vec2 uCenter;      // where the optical axis meets the screen, css px (y down)
uniform vec2 uView;        // viewport, css px
uniform float uPointScale; // css px -> buffer px
uniform vec3 uSrc;         // the photograph's camera: focal, centre x, centre y (photo px)
uniform vec2 uSrcSize;     // photo px
uniform float uNear;       // distance at which nearness is 1
uniform vec4 uRect;        // where the whole photograph rests on screen: x, y, w, h (css px)
uniform vec4 uBox;         // the figure's box (css px)
uniform vec4 uSoft;        // dissolving band inside each edge: top, right, bottom, left (css px)
uniform float uSpacing;    // css px between discs at rest
uniform float uPull;       // css px of parallax per unit of nearness, for the camera's present position
uniform float uScatter;    // how far free grains spread along their line of sight (share of their distance)
uniform float uFocus;      // nearness in focus
uniform float uBokeh;      // css px of blur a free grain gains per unit of nearness away from focus
uniform float uPresence;   // 0 dust .. 1 settled
uniform float uTime;
uniform float uSeed;
uniform vec4 uSphere;      // bubble: centre z, radius, pop progress, 1 if this plate is a bubble
uniform vec3 uPuncture;    // bubble: unit vector from the centre to where it is pricked

${VARYINGS.replaceAll('VARY', 'out')}
${COMMON}

void main() {
  float fi = float(gl_VertexID);
  float col = mod(fi, uGrid.x);
  float row = floor(fi / uGrid.x);
  vec4 h = hash4(vec2(col, row) + uSeed * 91.7);

  vec2 cell = (vec2(col, row) + 0.5 + (h.xy - 0.5) * 0.9) / uGrid;
  vec2 uv = mix(uWin.xy, uWin.zw, cell);
  ivec2 top = ivec2(uDepthSize) - 1;
  float n = max(texelFetch(uDepth, clamp(ivec2(uv * uDepthSize), ivec2(0), top), 0).r, 0.002);
  // How steeply nearness changes here: at a foreground edge the camera pulls neighbours apart.
  vec2 e = (uWin.zw - uWin.xy) / uGrid;
  float gx = texelFetch(uDepth, clamp(ivec2((uv + vec2(e.x, 0.0)) * uDepthSize), ivec2(0), top), 0).r
           - texelFetch(uDepth, clamp(ivec2((uv - vec2(e.x, 0.0)) * uDepthSize), ivec2(0), top), 0).r;
  float gy = texelFetch(uDepth, clamp(ivec2((uv + vec2(0.0, e.y)) * uDepthSize), ivec2(0), top), 0).r
           - texelFetch(uDepth, clamp(ivec2((uv - vec2(0.0, e.y)) * uDepthSize), ivec2(0), top), 0).r;
  vec2 slope = vec2(gx, gy);
  float steep = length(slope);
  float stretch = min(1.0 + 0.5 * steep * uPull / uSpacing, 9.0);
  vec2 towardsNear = steep > 0.02 ? slope / steep : vec2(0.0);
  float z = uNear / n;
  vec3 P = vec3((uv * uSrcSize - uSrc.yz) * z / uSrc.x, z);
  vec2 home = uRect.xy + uv * uRect.zw;

  // Edges: the picture thins out inside a band along each soft edge, along a ragged line.
  vec4 inside = vec4(home.y - uBox.y, uBox.x + uBox.z - home.x, uBox.y + uBox.w - home.y, home.x - uBox.x);
  float rag = fbm(home * 0.0065 + uSeed * 3.1);
  vec4 band = max(uSoft, vec4(1.0));
  vec4 m4 = clamp((inside - (rag - 0.28) * uSoft * 0.85) / band, 0.0, 1.0);
  m4 = mix(vec4(1.0), m4 * m4 * (3.0 - 2.0 * m4), step(vec4(1.5), uSoft));
  float mask = m4.x * m4.y * m4.z * m4.w;

  // Each disc settles at its own moment as presence rises; whole regions settle together.
  float clump = fbm(home * 0.0042 + 11.0 + uSeed);
  float when = mix(h.z, clump, 0.9) * 0.72;
  float q = smoothstep(when, when + 0.28, uPresence);
  float edge = 1.0 - smoothstep(0.0, 0.7, mask);
  float away = 1.0 - q;
  float loose = max(edge * 0.85, away);

  // Dust thins out: towards a soft edge, and while the plate is dispersed.
  float survive = mask * mix(1.0, 0.3, pow(away, 1.5));
  float alive = clamp((survive * 1.25 - h.w) / max(survive * 0.25, 0.004), 0.0, 1.0) * step(0.004, uPresence);

  // A free grain leaves the sheet along its own line of sight. From where the photograph
  // was taken it still covers its pixel; only the travelling camera pulls the cloud apart.
  float lift = (h.z - 0.5) * 2.0;
  P *= 1.0 + lift * abs(lift) * loose * uScatter;

  float bright = 1.0;
  if (uSphere.w > 0.5) {
    // Only the bubble, none of its surroundings.
    vec3 C = vec3(0.0, 0.0, uSphere.x);
    vec3 n3 = normalize(P - C);
    alive *= step(0.003, n) * step(length(P - C), uSphere.y * 1.03);
    // Pop: the film retracts from the puncture and what is left flies off as droplets.
    float ang = acos(clamp(dot(n3, uPuncture), -1.0, 1.0)) / 3.14159265;  // 0 at the puncture .. 1 opposite
    float since = max(0.0, uSphere.z * 1.5 - ang - h.z * 0.05);          // time since the rim passed
    float swept = step(1e-4, since);
    vec3 tangent = normalize(n3 - uPuncture * dot(n3, uPuncture) + 1e-4);
    vec3 fly = (tangent * 0.9 + n3 * 0.5 + (h.xyz - 0.5) * 0.7) * since * (0.7 + h.w * 1.4);
    fly.y += since * since * 1.6;                                        // gravity (y is down)
    P += fly * uSphere.y * swept;
    bright = mix(1.0, 0.0, smoothstep(0.0, 0.55, since)) + exp(-since * 26.0) * swept * 1.5;
    alive *= mix(1.0, step(h.x, 0.34), swept);
    loose = max(loose, swept);
  }
  float asDust = smoothstep(0.0, 0.35, loose);         // 0 part of the sheet .. 1 a free grain

  vec3 c = uRot * (P - uEye);
  if (c.z < uNear * 0.04 || alive <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float iz = 1.0 / c.z;

  // Slow eddies carry dispersed grains a little way across the frame.
  float t = uTime * 0.05;
  vec2 eddy = vec2(vnoise(home * 0.0048 + vec2(t, 3.7)), vnoise(home * 0.0048 + vec2(9.2, -t))) - 0.5;
  vec2 drift = (eddy * 1.6 + (h.xy - 0.5) * 0.8) * away * away * min(uBox.z, uBox.w) * 0.1;

  vec2 pos = uCenter + uFocal * c.xy * iz + drift;
  // A disc of the sheet grows as the camera closes in on it, so the sheet stays closed.
  float magnify = z * iz * uFocal * uSrcSize.x / (uSrc.x * uRect.z);
  float sheet = 1.6 * uSpacing * max(1.0, magnify) * stretch;
  // A grain is a point of light. Away from the focal plane it goes soft and faint,
  // as dust does in a shallow-focus photograph.
  float grain = max(0.5 * uSpacing, 1.1 / uPointScale);
  float coc = min(uBokeh * abs(uNear * iz - uFocus), 11.0);
  float radius = min(mix(sheet, grain + coc, asDust), 110.0);
  // The same light over a larger disc: rather than thousands of faint discs piled on each
  // other, fewer of the soft ones are kept, each still visible. (It also bounds the cost.)
  float share = grain / (grain + coc);
  float kept = step(fract(h.w * 7.13 + h.x * 3.71), mix(1.0, max(share * share * 3.0, 0.03), asDust));

  float amp = alive * bright * kept;
  if (amp <= 1e-3) amp = 0.0;
  float tone = textureLod(uPhoto, uv, log2(max(1.0, radius * 0.9 * uTexPerPx))).r;
  vWeight = vec4(0.373 * amp * (1.0 - asDust), 0.55 * amp * asDust * mix(1.0, share, 0.6), tone, n);
  vUv = uv;
  vPos = pos;
  vScale = vec2(c.z * uSrc.x) / (uFocal * z * uSrcSize);
  vNearness = uNear * iz;
  vEdge = towardsNear;

  if (amp <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = vec4(pos.x / uView.x * 2.0 - 1.0, 1.0 - pos.y / uView.y * 2.0, 0.0, 1.0);
  gl_PointSize = max(2.0, 2.0 * radius * uPointScale);
}
`;

// Shared by passes 1 and 2: the disc's footprint, and whether this fragment still lies on
// the disc's own surface according to the depth map.
const FOOTPRINT = /* glsl */ `
uniform sampler2D uDepth;
uniform vec2 uView;
uniform float uPointScale;
${VARYINGS.replaceAll('VARY', 'in')}

// Returns kernel weight (0 outside the disc); sets uvHere and own.
float footprint(out vec2 px, out vec2 uvHere, out float own) {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  px = vec2(gl_FragCoord.x, uView.y * uPointScale - gl_FragCoord.y) / uPointScale;
  uvHere = vUv + (px - vPos) * vScale;
  // Parallax is proportional to a difference in nearness, so that is the measure of
  // "another surface": closer together than this, two surfaces never slide apart visibly.
  own = 1.0 - smoothstep(0.03, 0.07, abs(textureLod(uDepth, uvHere, 0.0).r - vWeight.w));
  if (r2 >= 1.0) return 0.0;
  return (1.0 - r2) * (1.0 - r2);
}
`;

// Pass 1: nearness of the front surface (blended with MAX).
export const NEAREST_FRAG = /* glsl */ `#version 300 es
precision highp float;
${FOOTPRINT}
out vec4 o;
void main() {
  vec2 px, uvHere; float own;
  float k = footprint(px, uvHere, own);
  if (k <= 0.0 || own < 0.5 || vWeight.x < 0.05) discard;
  o = vec4(vNearness, 0.0, 0.0, 1.0);
}
`;

// Pass 2: gather.
export const GATHER_FRAG = /* glsl */ `#version 300 es
precision highp float;
${FOOTPRINT}
uniform sampler2D uNearest;
uniform mat3 uPlane;       // screen px -> photograph uv for a flat scene at middle depth (homogeneous)

layout(location = 0) out vec4 oPlace;   // (uv - flat-scene uv) * weight, weight, all settled coverage
layout(location = 1) out vec4 oTone;    // tone * weight, weight, loose coverage

void main() {
  vec2 px, uvHere; float own;
  float k = footprint(px, uvHere, own);
  if (k <= 0.0) discard;

  // Only the surface in front counts; anything clearly behind it stays hidden.
  float front = texelFetch(uNearest, ivec2(gl_FragCoord.xy), 0).r;
  float seen = smoothstep(front - 0.07, front - 0.03, vNearness);
  float cover = k * vWeight.x;
  float settled = cover * own * seen;
  float loose = k * vWeight.y;
  // Where the camera has opened a gap behind a foreground edge nothing settled lands.
  // There the far side carries on into the gap, folded back on itself at the edge so that
  // it never shows the foreground twice. Its weight only matters where nothing else lands.
  float spill = cover * (1.0 - own) * 0.01 * exp(-5.0 * vWeight.w);
  vec2 off = px - vPos;
  vec2 uvFold = vUv + (off - 2.0 * max(dot(off, vEdge), 0.0) * vEdge) * vScale;

  vec3 flat3 = uPlane * vec3(px, 1.0);
  vec2 flatUv = flat3.xy / flat3.z;
  oPlace = vec4((uvHere - flatUv) * settled + (uvFold - flatUv) * spill, settled + spill, cover);
  oTone = vec4(vWeight.z * loose, loose, loose, 0.0);
}
`;

export const RESOLVE_VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const RESOLVE_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uPlace;
uniform sampler2D uTone;
uniform sampler2D uDepth;
uniform sampler2D uPhoto;
uniform float uPush;       // how far forward the camera has travelled, in units of the nearest depth
uniform float uLod;        // mip level at which one photo texel covers one screen pixel
uniform vec2 uView;        // css px
uniform float uPixelRatio; // css px -> canvas px
uniform mat3 uPlane;
uniform vec4 uRect;
uniform vec2 uPhotoSize;   // photo texels
uniform float uFocus;      // nearness in focus
uniform float uAperture;   // css px of blur per unit of nearness away from focus
uniform float uDefocus;    // extra blur, css px
uniform float uGain;
uniform float uShade;      // how far the picture darkens towards the lower left, where a heading sits
uniform float uGrain;
uniform float uOpacity;
uniform float uOcclude;    // 0 adds light, 1 hides what is behind
uniform float uSeed;

out vec4 o;

${COMMON}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 st = frag / (uView * uPixelRatio);
  vec4 place = texture(uPlace, st);
  vec4 plain = texture(uTone, st);
  float wS = place.b, wT = plain.g;
  float cov = 1.0 - exp(-5.5 * (place.a + plain.b));
  if (cov <= 0.002 || wS + wT <= 1e-8) { o = vec4(0.0); return; }

  float lumS = 0.0;
  if (wS > 1e-8) {
    vec2 px = vec2(frag.x, uView.y * uPixelRatio - frag.y) / uPixelRatio;
    vec3 flat3 = uPlane * vec3(px, 1.0);
    vec2 uv = flat3.xy / flat3.z + place.rg / wS;
    float nHere = textureLod(uDepth, uv, 0.0).r;
    float nNow = nHere / max(0.05, 1.0 - nHere * uPush);          // nearness from where the camera is now
    float blur = uAperture * abs(nNow - uFocus) + uDefocus;        // css px
    if (blur < 0.6) {
      lumS = textureLod(uPhoto, uv, uLod).r;
    } else {
      float lod = max(0.0, log2(blur * uPhotoSize.x / uRect.z * 0.7));
      float rot = ign(frag) * 6.2831853;
      vec2 reach = blur / uRect.zw;
      if (blur < 2.5) {
        // A light blur: four taps are enough, and too small to bleed across an edge.
        for (int i = 0; i < 4; i++) {
          float ang = rot + float(i) * 1.5707963;
          lumS += textureLod(uPhoto, uv + vec2(cos(ang), sin(ang)) * 0.7 * reach, lod).r;
        }
        lumS *= 0.25;
      } else {
        float sum = 0.0;
        for (int i = 0; i < 7; i++) {
          float fi = float(i);
          float ang = rot + fi * 2.39996323;
          vec2 at = uv + vec2(cos(ang), sin(ang)) * sqrt((fi + 0.5) / 7.0) * reach;
          // A blurred background must not gather light from whatever stands in front of it.
          float behind = 1.0 - smoothstep(0.03, 0.07, textureLod(uDepth, at, 0.0).r - nHere);
          lumS += textureLod(uPhoto, at, lod).r * behind;
          sum += behind;
        }
        lumS = sum > 0.5 ? lumS / sum : textureLod(uPhoto, uv, lod).r;
      }
    }
    // Outside the photograph there is nothing to show.
    vec2 inb = smoothstep(vec2(0.0), vec2(0.004), uv) * smoothstep(vec2(0.0), vec2(0.004), 1.0 - uv);
    wS *= inb.x * inb.y;
  }
  float lum = (lumS * wS + plain.r) / max(wS + wT, 1e-7);

  lum *= uGain;
  // Under a heading the photograph itself darkens towards the lower left. A dark panel
  // laid over it would show its edges as it scrolled; this has none.
  vec2 at = vec2(frag.x, uView.y * uPixelRatio - frag.y) / (uView * uPixelRatio);
  lum *= 1.0 - uShade * max(smoothstep(0.34, 0.96, at.y) * 0.9, (1.0 - smoothstep(0.0, 0.62, at.x)) * 0.7);
  // Film grain, strongest in the mid-tones, none in pure black.
  float g = hash1(frag + uSeed * 57.0) - 0.5;
  lum += g * uGrain * (0.25 + 1.5 * lum * (1.0 - lum));
  lum = clamp(lum, 0.0, 1.0);

  cov *= uOpacity;
  o = vec4(vec3(lum * cov), cov * uOcclude);
}
`;
