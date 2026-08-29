export const CRT_REFERENCE_MODEL = 'Philips 28PW6006'
export const CRT_REFERENCE_NOMINAL_DIAGONAL_MM = 711.2
export const CRT_REFERENCE_VISIBLE_DIAGONAL_MM = 660
export const CRT_REFERENCE_ASPECT_WIDTH = 16
export const CRT_REFERENCE_ASPECT_HEIGHT = 9
const CRT_REFERENCE_ASPECT_DIAGONAL = Math.hypot(
  CRT_REFERENCE_ASPECT_WIDTH,
  CRT_REFERENCE_ASPECT_HEIGHT,
)
export const CRT_REFERENCE_PICTURE_WIDTH_MM =
  (CRT_REFERENCE_VISIBLE_DIAGONAL_MM * CRT_REFERENCE_ASPECT_WIDTH) / CRT_REFERENCE_ASPECT_DIAGONAL
export const CRT_REFERENCE_PICTURE_HEIGHT_MM =
  (CRT_REFERENCE_VISIBLE_DIAGONAL_MM * CRT_REFERENCE_ASPECT_HEIGHT) / CRT_REFERENCE_ASPECT_DIAGONAL
export const CRT_REFERENCE_RASTER_HEIGHT = 240
export const CRT_REFERENCE_RASTER_WIDTH =
  (CRT_REFERENCE_RASTER_HEIGHT * CRT_REFERENCE_ASPECT_WIDTH) / CRT_REFERENCE_ASPECT_HEIGHT
export const CRT_REFERENCE_MM_PER_RASTER_PIXEL =
  CRT_REFERENCE_PICTURE_HEIGHT_MM / CRT_REFERENCE_RASTER_HEIGHT

export const CRT_TUBE_RADIUS_MM = (CRT_REFERENCE_NOMINAL_DIAGONAL_MM / 2) * 1.7
export const CRT_REFERENCE_BARREL_COEFFICIENT = 0.01386136580657748
export const CRT_BARREL_APERTURE_GAIN = 2
export const CRT_BARREL_COEFFICIENT = CRT_REFERENCE_BARREL_COEFFICIENT * CRT_BARREL_APERTURE_GAIN
export const CRT_HORIZONTAL_EDGE_CURVATURE_SCALE = 0.82
export const CRT_BOTTOM_EDGE_HORIZONTAL_CURVATURE_SCALE = 0.6
export const CRT_CHROMA_RED_TO_BLUE_EDGE_RASTER_PIXELS = 0.5
export const CRT_CHROMA_VISIBILITY = 0.45
export const CRT_CHROMA_RED_TO_BLUE_EDGE_MM =
  CRT_CHROMA_RED_TO_BLUE_EDGE_RASTER_PIXELS * CRT_REFERENCE_MM_PER_RASTER_PIXEL
export const CRT_CHROMA_SHIFT_RASTER_PIXELS = CRT_CHROMA_RED_TO_BLUE_EDGE_RASTER_PIXELS / 2
export const CRT_BLOOM_DIAMETER_MM = 1
export const CRT_BLOOM_RADIUS_MM = CRT_BLOOM_DIAMETER_MM / 2
export const CRT_BLOOM_RADIUS_RASTER_PIXELS =
  CRT_BLOOM_RADIUS_MM / CRT_REFERENCE_MM_PER_RASTER_PIXEL
export const CRT_BLOOM_CARDINAL_WEIGHT = 0.05
export const CRT_SCANLINE_PITCH_RASTER_PIXELS = 1
export const CRT_SCANLINE_DARKENING = 0.15

export type Point = Readonly<{ x: number; y: number }>

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0
}

export function mapCrtDestinationToSource(
  destinationUv: Point,
  drawableWidth: number,
  drawableHeight: number,
): Point | undefined {
  if (
    !finitePositive(drawableWidth) ||
    !finitePositive(drawableHeight) ||
    !Number.isFinite(destinationUv.x) ||
    !Number.isFinite(destinationUv.y)
  ) {
    return undefined
  }

  const aspect = drawableWidth / drawableHeight
  const centeredX = (destinationUv.x * 2 - 1) * aspect
  const centeredY = destinationUv.y * 2 - 1
  const radiusSquared = centeredX * centeredX + centeredY * centeredY
  const radialScale = 1 + CRT_BARREL_COEFFICIENT * radiusSquared
  const horizontalApertureScale = 1 / (1 + CRT_BARREL_COEFFICIENT * aspect * aspect)
  const verticalApertureScale = 1 / (1 + CRT_BARREL_COEFFICIENT)
  let horizontalEdgeCurvatureScale = CRT_HORIZONTAL_EDGE_CURVATURE_SCALE
  if (centeredY < 0) {
    const bottomAmount = Math.min(-centeredY, 1)
    const bottomCurvatureScale = 1 - (1 - CRT_BOTTOM_EDGE_HORIZONTAL_CURVATURE_SCALE) * bottomAmount
    horizontalEdgeCurvatureScale *= bottomCurvatureScale
  }
  const verticalScale =
    1 +
    CRT_BARREL_COEFFICIENT *
      (centeredY * centeredY + centeredX * centeredX * horizontalEdgeCurvatureScale)
  const sourceX = ((centeredX * radialScale * horizontalApertureScale) / aspect + 1) * 0.5
  const sourceY = (centeredY * verticalScale * verticalApertureScale + 1) * 0.5

  if (sourceX < 0 || sourceX > 1 || sourceY < 0 || sourceY > 1) return undefined
  return { x: sourceX, y: sourceY }
}

export function relativeLuminance(rgb: NormalizedRgb) {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}

export function crtBrightPassThreshold(background: NormalizedRgb) {
  return Math.max(0.5, relativeLuminance(background) + 0.1)
}

const glslFloat = (value: number) => value.toPrecision(17)

export const crtVertexShaderSource = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
out vec2 v_destinationUv;

void main() {
  v_destinationUv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

export const crtFragmentShaderSource = `#version 300 es
precision highp float;

uniform sampler2D u_terminal;
uniform vec2 u_drawableSize;
uniform vec3 u_background;
uniform float u_brightPassThreshold;

in vec2 v_destinationUv;
out vec4 outColor;

const float BARREL_K = ${glslFloat(CRT_BARREL_COEFFICIENT)};
const float HORIZONTAL_EDGE_CURVATURE_SCALE = ${glslFloat(CRT_HORIZONTAL_EDGE_CURVATURE_SCALE)};
const float BOTTOM_EDGE_HORIZONTAL_CURVATURE_SCALE = ${glslFloat(CRT_BOTTOM_EDGE_HORIZONTAL_CURVATURE_SCALE)};
const float CRT_RASTER_HEIGHT = ${glslFloat(CRT_REFERENCE_RASTER_HEIGHT)};
const float CHROMA_SHIFT_RASTER_PIXELS = ${glslFloat(CRT_CHROMA_SHIFT_RASTER_PIXELS)};
const float CHROMA_VISIBILITY = ${glslFloat(CRT_CHROMA_VISIBILITY)};
const float BLOOM_RADIUS_RASTER_PIXELS = ${glslFloat(CRT_BLOOM_RADIUS_RASTER_PIXELS)};
const float BLOOM_CARDINAL_WEIGHT = ${glslFloat(CRT_BLOOM_CARDINAL_WEIGHT)};
const float SCANLINE_PITCH_RASTER_PIXELS = ${glslFloat(CRT_SCANLINE_PITCH_RASTER_PIXELS)};
const float SCANLINE_DARKENING = ${glslFloat(CRT_SCANLINE_DARKENING)};
const float TWO_PI = 6.28318530717958647692;

vec2 crtRasterSize() {
  float aspect = u_drawableSize.x / u_drawableSize.y;
  return vec2(CRT_RASTER_HEIGHT * aspect, CRT_RASTER_HEIGHT);
}

vec2 destinationToSource(vec2 destinationUv) {
  float aspect = u_drawableSize.x / u_drawableSize.y;
  vec2 centered = destinationUv * 2.0 - 1.0;
  centered.x *= aspect;
  float radialScale = 1.0 + BARREL_K * dot(centered, centered);
  float horizontalApertureScale = 1.0 / (1.0 + BARREL_K * aspect * aspect);
  float verticalApertureScale = 1.0 / (1.0 + BARREL_K);
  float horizontalEdgeCurvatureScale = HORIZONTAL_EDGE_CURVATURE_SCALE;
  if (centered.y < 0.0) {
    float bottomAmount = clamp(-centered.y, 0.0, 1.0);
    float bottomCurvatureScale = mix(
      1.0,
      BOTTOM_EDGE_HORIZONTAL_CURVATURE_SCALE,
      bottomAmount
    );
    horizontalEdgeCurvatureScale *= bottomCurvatureScale;
  }
  float verticalScale = 1.0 + BARREL_K * (
    centered.y * centered.y + centered.x * centered.x * horizontalEdgeCurvatureScale
  );
  centered.x *= radialScale * horizontalApertureScale;
  centered.y *= verticalScale * verticalApertureScale;
  centered.x /= aspect;
  return centered * 0.5 + 0.5;
}

bool outsideUnitSquare(vec2 uv) {
  return any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));
}

vec3 sampleTerminal(vec2 sourceUv) {
  return outsideUnitSquare(sourceUv) ? u_background : texture(u_terminal, sourceUv).rgb;
}

float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float brightPass(vec3 color) {
  return clamp(
    (luminance(color) - u_brightPassThreshold) / max(1.0 - u_brightPassThreshold, 0.0001),
    0.0,
    1.0
  );
}

float scanlineDarkBand(vec2 sourceUv) {
  float sourceRasterY = sourceUv.y * CRT_RASTER_HEIGHT;
  float scanlineRadians = sourceRasterY * TWO_PI / SCANLINE_PITCH_RASTER_PIXELS;
  float antialiasWidth = max(fwidth(scanlineRadians), 0.0001);
  return smoothstep(-antialiasWidth, antialiasWidth, -sin(scanlineRadians));
}

void main() {
  vec2 sourceUv = destinationToSource(v_destinationUv);
  float scanlineDarkness = scanlineDarkBand(sourceUv);
  if (outsideUnitSquare(sourceUv)) {
    outColor = vec4(u_background, 1.0);
    return;
  }

  // Keep each component separable: a horizontal source line gets one constant Y
  // displacement across its full width, and a vertical line gets one constant X
  // displacement across its full height. Normalizing a radial vector would make those
  // components vary along a line and let its RGB copies converge into the base curve.
  vec2 chromaSourceOffset = (sourceUv * 2.0 - 1.0) *
    CHROMA_SHIFT_RASTER_PIXELS / crtRasterSize();

  vec2 redSourceUv = sourceUv + chromaSourceOffset;
  vec2 blueSourceUv = sourceUv - chromaSourceOffset;

  vec3 center = sampleTerminal(sourceUv);
  vec3 shiftedColor = vec3(
    sampleTerminal(redSourceUv).r,
    center.g,
    sampleTerminal(blueSourceUv).b
  );
  vec3 color = mix(center, shiftedColor, CHROMA_VISIBILITY);

  vec2 bloomStep = BLOOM_RADIUS_RASTER_PIXELS / crtRasterSize();
  vec3 bloom = vec3(0.0);
  vec3 neighbor = sampleTerminal(sourceUv + vec2(bloomStep.x, 0.0));
  bloom += neighbor * brightPass(neighbor);
  neighbor = sampleTerminal(sourceUv - vec2(bloomStep.x, 0.0));
  bloom += neighbor * brightPass(neighbor);
  neighbor = sampleTerminal(sourceUv + vec2(0.0, bloomStep.y));
  bloom += neighbor * brightPass(neighbor);
  neighbor = sampleTerminal(sourceUv - vec2(0.0, bloomStep.y));
  bloom += neighbor * brightPass(neighbor);

  vec3 emittedColor = clamp(color + bloom * BLOOM_CARDINAL_WEIGHT, 0.0, 1.0);
  emittedColor *= 1.0 - SCANLINE_DARKENING * scanlineDarkness;
  outColor = vec4(emittedColor, 1.0);
}
`
import type { NormalizedRgb } from '../../color'
