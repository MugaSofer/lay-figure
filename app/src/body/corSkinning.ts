// Optimized Centers of Rotation skinning (Le & Hodgins 2016) as a patch on three's skinning shader chunks.
// Each vertex rotates by the weight-blended bone rotation (quaternion blend) about its centre of rotation,
// and that centre moves by ordinary linear blend skinning:  v' = R (v - c) + LBS(c).
// Vertices owned by a single bone have c = v, which reduces to plain LBS. Normals rotate by R.
// Chosen in Phase 0 over LBS and DQS (review/phase0/REPORT.md, section B).
import type { Material, WebGLProgramParametersWithUniforms } from 'three';

const PARS = /* glsl */ `
attribute vec3 corPoint;
vec4 corQuat(mat3 m) {
  float t = m[0][0] + m[1][1] + m[2][2];
  vec4 q;
  if (t > 0.0) {
    float s = sqrt(t + 1.0) * 2.0;
    q = vec4((m[1][2] - m[2][1]) / s, (m[2][0] - m[0][2]) / s, (m[0][1] - m[1][0]) / s, 0.25 * s);
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    float s = sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2.0;
    q = vec4(0.25 * s, (m[1][0] + m[0][1]) / s, (m[2][0] + m[0][2]) / s, (m[1][2] - m[2][1]) / s);
  } else if (m[1][1] > m[2][2]) {
    float s = sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2.0;
    q = vec4((m[1][0] + m[0][1]) / s, 0.25 * s, (m[2][1] + m[1][2]) / s, (m[2][0] - m[0][2]) / s);
  } else {
    float s = sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2.0;
    q = vec4((m[2][0] + m[0][2]) / s, (m[2][1] + m[1][2]) / s, 0.25 * s, (m[0][1] - m[1][0]) / s);
  }
  return q;
}
mat3 corMat(vec4 q) {
  float x = q.x, y = q.y, z = q.z, w = q.w;
  return mat3(
    1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w),
    2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w),
    2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y));
}
`;

// Blended rotation of the vertex's bones (sign-aligned to the first bone), shared by normal and position.
const BLEND = /* glsl */ `
  vec4 corQX = corQuat(mat3(boneMatX));
  vec4 corQY = corQuat(mat3(boneMatY));
  vec4 corQZ = corQuat(mat3(boneMatZ));
  vec4 corQW = corQuat(mat3(boneMatW));
  vec4 corQ = corQX * skinWeight.x
    + (dot(corQX, corQY) < 0.0 ? -corQY : corQY) * skinWeight.y
    + (dot(corQX, corQZ) < 0.0 ? -corQZ : corQZ) * skinWeight.z
    + (dot(corQX, corQW) < 0.0 ? -corQW : corQW) * skinWeight.w;
  mat3 corR = corMat(normalize(corQ));
`;

const NORMAL = /* glsl */ `
#if defined(USE_SKINNING) && !defined(COR_OFF)
${BLEND}
  objectNormal = mat3(bindMatrixInverse) * (corR * (mat3(bindMatrix) * objectNormal));
  #ifdef USE_TANGENT
    objectTangent = mat3(bindMatrixInverse) * (corR * (mat3(bindMatrix) * objectTangent));
  #endif
#elif defined(USE_SKINNING)
  #include <skinnormal_vertex>
#endif
`;

const POSITION = /* glsl */ `
#if defined(USE_SKINNING) && !defined(COR_OFF)
  #ifndef CORR_DONE
${BLEND}
  #endif
  vec4 corC = bindMatrix * vec4(corPoint, 1.0);
  vec4 corLbsC = boneMatX * corC * skinWeight.x + boneMatY * corC * skinWeight.y
    + boneMatZ * corC * skinWeight.z + boneMatW * corC * skinWeight.w;
  vec3 corV = (bindMatrix * vec4(transformed, 1.0)).xyz;
  transformed = (bindMatrixInverse * vec4(corR * (corV - corC.xyz) + corLbsC.xyz, 1.0)).xyz;
#elif defined(USE_SKINNING)
  #include <skinning_vertex>
#endif
`;

/** Patch a material (any built-in, or a ShaderMaterial using three's skinning chunks) to skin with CoR.
 *  The mesh's geometry needs a `corPoint` attribute (centre of rotation in bind space). */
export function useCorSkinning(material: Material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev?.call(material, shader, renderer);
    const hasNormal = shader.vertexShader.includes('#include <skinnormal_vertex>');
    shader.vertexShader = shader.vertexShader
      .replace('#include <skinning_pars_vertex>', '#include <skinning_pars_vertex>\n#ifdef USE_SKINNING\n' + PARS + '#endif\n')
      .replace('#include <skinnormal_vertex>', NORMAL + '\n#define CORR_DONE\n')
      .replace('#include <skinning_vertex>', hasNormal ? POSITION : POSITION.replace('#ifndef CORR_DONE', '#if 1'));
  };
  material.customProgramCacheKey = () => (material.defines?.COR_OFF ? 'lbs-skinning' : 'cor-skinning');
  material.needsUpdate = true;
}

/** Switch between CoR (default) and plain linear blend skinning, for comparison. */
export function setCorEnabled(material: Material, on: boolean) {
  const m = material as Material & { defines?: Record<string, unknown> };
  m.defines = { ...(m.defines ?? {}) };
  if (on) delete m.defines.COR_OFF; else m.defines.COR_OFF = '';
  m.needsUpdate = true;
}
