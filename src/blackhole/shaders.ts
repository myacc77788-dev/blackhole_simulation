// GLSL ES 3.00 shaders for a Schwarzschild black hole renderer.
// Units: Schwarzschild radius rs = 1  (so M = 0.5, photon sphere = 1.5, ISCO = 3).

export const VERT = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash13(vec3 p){
  p = fract(p*0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
vec3 hash33(vec3 p){
  p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
  return fract(sin(p)*43758.5453123);
}
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x);
  f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i+vec3(0,0,0)), hash13(i+vec3(1,0,0)), f.x),
                 mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x),
                 mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct){
  float a = 0.5, s = 0.0;
  for(int i=0;i<6;i++){
    if(i>=oct) break;
    s += a*vnoise(p);
    p *= 2.03; a *= 0.5;
  }
  return s;
}
// Planckian locus approximation (Tanner Helland fit), returns linear-ish RGB, peak normalized.
vec3 blackbody(float T){
  T = clamp(T, 800.0, 40000.0);
  float t = T / 100.0;
  vec3 c;
  if(t <= 66.0){
    c.r = 255.0;
    c.g = 99.4708025861 * log(t) - 161.1195681661;
    c.b = (t <= 19.0) ? 0.0 : (138.5177312231 * log(t - 10.0) - 305.0447927307);
  } else {
    c.r = 329.698727446 * pow(t - 60.0, -0.1332047592);
    c.g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
    c.b = 255.0;
  }
  c = clamp(c / 255.0, 0.0, 1.0);
  // to approximately linear light
  return pow(c, vec3(2.2));
}
`;

export const SCENE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform mat3  uCamMat;      // right, up, forward
uniform float uFov;
uniform float uSteps;

uniform float uDiskInner;
uniform float uDiskOuter;
uniform float uDiskBright;
uniform float uDiskThick;
uniform float uDiskTemp;
uniform float uDiskNoise;
uniform float uSpin;        // accretion flow speed multiplier
uniform float uDoppler;     // 0..1 blend of relativistic beaming/redshift
uniform float uLensing;     // 0..1 blend of spacetime curvature
uniform float uStars;
uniform float uNebula;
uniform float uJet;

${COMMON}

// ------------------------------------------------------------------ background
vec3 starLayer(vec3 d, float scale, float thresh, float sizeK){
  vec3 p = d * scale;
  vec3 id = floor(p);
  vec3 f = fract(p);
  vec3 r1 = hash33(id + 3.7);
  float present = step(thresh, r1.x);
  vec3 off = 0.2 + 0.6 * hash33(id + 11.3);
  float dist = length(f - off);
  float core = smoothstep(sizeK, 0.0, dist);
  float halo = smoothstep(sizeK * 6.0, 0.0, dist) * 0.12;
  float mag = pow(r1.y, 5.0) * 1.6 + 0.02;
  vec3 col = blackbody(mix(2800.0, 12000.0, pow(r1.z, 0.8)));
  return col * (core + halo) * mag * present;
}

vec3 background(vec3 d){
  vec3 col = vec3(0.0);
  col += starLayer(d, 90.0,  0.86, 0.055) * 1.0;
  col += starLayer(d, 190.0, 0.90, 0.045) * 0.55;
  col += starLayer(d, 420.0, 0.93, 0.040) * 0.28;
  col *= 2.4;

  // galactic band + dust
  vec3 gal = normalize(vec3(0.35, 0.62, -0.70));
  float b = abs(dot(d, gal));
  float band = exp(-b * b * 9.0);
  float n1 = fbm(d * 3.2 + 11.0, 4);
  float n2 = fbm(d * 9.0 - 4.0, 4);
  float dust = smoothstep(0.35, 0.85, n2);
  vec3 neb = mix(vec3(0.11, 0.16, 0.42), vec3(0.42, 0.26, 0.34), n1);
  col += band * neb * (0.055 + 0.16 * n1) * (1.0 - 0.55 * dust) * uNebula;
  // faint unresolved star haze inside the band
  col += band * vec3(0.9, 0.88, 0.82) * 0.012 * (0.4 + n1) * uNebula;
  // deep-field ambient
  col += vec3(0.006, 0.008, 0.016) * uNebula;
  return col * uStars;
}

// ------------------------------------------------------------------ disk
// Novikov-Thorne-like radial temperature profile, normalized to peak = uDiskTemp
// Peak of x^(-3/4)·(1-1/√x)^(1/4) is at x≈1.36 where f≈0.489, hence norm ≈ 2.045
float diskTemp(float r){
  float x = max(r / uDiskInner, 1.0001);
  float f = pow(x, -0.75) * pow(max(1.0 - inversesqrt(x), 0.0), 0.25);
  return uDiskTemp * f * 2.045;
}

float diskDensity(vec3 p, out float radius){
  float r = length(p.xz);
  radius = r;
  if(uDiskBright < 0.002) return 0.0;
  if(r < uDiskInner * 0.92 || r > uDiskOuter) return 0.0;
  // flared scale height
  float h = uDiskThick * (0.35 + 0.85 * r / uDiskInner);
  float vert = exp(-2.2 * (p.y * p.y) / (h * h));
  if(vert < 0.002) return 0.0;

  float t = (r - uDiskInner) / max(uDiskOuter - uDiskInner, 0.001);
  float radial = smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.45, 1.0, t));
  // differential (Keplerian) rotation: shear the noise field
  float w = uTime * uSpin * 14.0 * pow(max(r, 1.2), -1.5);
  float ca = cos(w), sa = sin(w);
  vec3 q = vec3(ca * p.x - sa * p.z, p.y * 2.0, sa * p.x + ca * p.z);
  float n = fbm(q * 0.55 + vec3(0.0, 0.0, uTime * 0.02), 4);
  float turb = mix(1.0, 0.25 + 1.55 * n * n, uDiskNoise);
  // fine spiral streaks
  float ang = atan(q.z, q.x);
  float streak = 0.75 + 0.45 * sin(ang * 7.0 + r * 2.1 + n * 6.0);
  return radial * vert * turb * mix(1.0, streak, 0.35 * uDiskNoise);
}

void main(){
  vec2 uv = (vUv * uRes * 2.0 - uRes) / uRes.y;
  float f = 1.0 / tan(radians(uFov) * 0.5);
  vec3 rd = normalize(uCamMat * vec3(uv, f));
  vec3 pos = uCamPos;

  vec3 hv = cross(pos, rd);
  float h2 = dot(hv, hv) * uLensing;

  vec3 acc = vec3(0.0);
  float trans = 1.0;
  bool captured = false;

  int steps = int(uSteps);
  for(int i = 0; i < 600; i++){
    if(i >= steps) break;
    float r = length(pos);

    // adaptive step: fine near the horizon and near the disk midplane
    float dt = clamp(0.065 * max(r - 0.92, 0.0), 0.005, 0.9);
    if(r < uDiskOuter * 1.5) dt = min(dt, 0.025 + 0.22 * abs(pos.y) + 0.008 * r);

    // ---- volumetric emission at current sample
    float rad;
    float dens = diskDensity(pos, rad);
    if(dens > 0.0005){
      vec3 kobs = -normalize(rd);                    // unit vector emitter -> observer
      vec3 vhat = normalize(cross(vec3(0.0, 1.0, 0.0), vec3(pos.x, 0.0, pos.z)));
      // Relativistic circular orbit velocity in Schwarzschild: β = √(M/(r-2M))
      // With M = 0.5 (rₛ = 1): β = √(0.5/(r-1))   — exact GR expression
      float beta = sqrt(0.5 / max(rad - 1.0, 1e-4));
      beta = min(beta, 0.98);                        // safety cap below photon sphere
      float gam = inversesqrt(max(1.0 - beta * beta, 1e-4));
      float dop = 1.0 / max(gam * (1.0 - dot(vhat * beta, kobs)), 0.05);
      float grav = sqrt(max(1.0 - 1.0 / max(r, 1.001), 0.01));
      float g = mix(1.0, dop * grav, uDoppler);
      g = clamp(g, 0.05, 6.0);

      float T = diskTemp(rad);
      vec3 col = blackbody(T * g);
      // Stefan–Boltzmann: bolometric flux ∝ T⁴, with relativistic correction g⁴
      float lum = pow(T / uDiskTemp, 4.0) * pow(g, 4.0);
      acc += trans * col * lum * dens * uDiskBright * dt * 3.0;
      trans *= exp(-dens * dt * 5.0);
      if(trans < 0.004) break;
    }

    // ---- relativistic jet (optional, along polar axis)
    if(uJet > 0.001){
      float rc = length(pos.xz);
      float ay = abs(pos.y);
      if(ay > uDiskInner * 0.4 && ay < 60.0){
        float cone = uDiskInner * 0.10 + ay * 0.075;
        float j = exp(-(rc * rc) / (cone * cone)) * exp(-ay * 0.045);
        float jn = fbm(vec3(pos.xz * 1.4, pos.y * 0.35 - uTime * 1.6 * sign(pos.y)), 3);
        acc += trans * vec3(0.35, 0.65, 1.25) * j * (0.35 + jn) * uJet * dt * 0.9;
      }
    }

    // ---- geodesic integration (velocity Verlet on d2x/dl2 = -1.5 h^2 x / r^5)
    float rr2 = dot(pos, pos);
    vec3 a0 = -1.5 * h2 * pos / (rr2 * rr2 * sqrt(rr2));
    vec3 np = pos + rd * dt + 0.5 * a0 * dt * dt;
    float nr2 = dot(np, np);
    vec3 a1 = -1.5 * h2 * np / (nr2 * nr2 * sqrt(nr2));
    rd = rd + 0.5 * (a0 + a1) * dt;
    pos = np;

    float nr = sqrt(nr2);
    if(nr < 1.0){ captured = true; break; }
    if(nr > 90.0 && dot(pos, rd) > 0.0) break;
  }

  vec3 col = acc;
  if(!captured) col += trans * background(normalize(rd));

  fragColor = vec4(col, 1.0);
}`;

export const BRIGHT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform float uThreshold;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThreshold, uThreshold * 2.0 + 0.001, l);
  fragColor = vec4(c * k, 1.0);
}`;

export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uDir;   // texel-sized direction
void main(){
  float w[5];
  w[0]=0.227027; w[1]=0.194594; w[2]=0.121621; w[3]=0.054054; w[4]=0.016216;
  vec3 s = texture(uTex, vUv).rgb * w[0];
  for(int i=1;i<5;i++){
    vec2 o = uDir * float(i) * 1.35;
    s += texture(uTex, vUv + o).rgb * w[i];
    s += texture(uTex, vUv - o).rgb * w[i];
  }
  fragColor = vec4(s, 1.0);
}`;

export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomAmt;
uniform float uExposure;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;

vec3 aces(vec3 x){
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}
void main(){
  vec3 c = texture(uScene, vUv).rgb;
  vec3 b = texture(uBloom, vUv).rgb;
  c += b * uBloomAmt;
  c *= uExposure;
  c = aces(c);
  // vignette
  vec2 q = vUv - 0.5;
  float v = 1.0 - uVignette * dot(q, q) * 1.9;
  c *= clamp(v, 0.0, 1.0);
  // subtle sensor grain
  float g = fract(sin(dot(vUv * vec2(1234.5, 987.6) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) * uGrain;
  fragColor = vec4(pow(max(c, 0.0), vec3(1.0/2.2)), 1.0);
}`;
