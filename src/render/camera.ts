import type { PerspectiveCamera, Quaternion } from 'three';
import { Matrix4 } from 'three';

/** Matrices and camera parameters shared by every render pass. */
export interface ViewState {
  width: number;
  height: number;
  view: Float32Array;
  proj: Float32Array;
  /** Camera world matrix (view-to-world). */
  cameraWorld: Float32Array;
  /** Container model matrix (local-to-world). */
  model: Float32Array;
  /** view * model */
  modelView: Float32Array;
  /** Inverse of the container rotation as a column-major mat3 (world-to-local). */
  boxInvRot: Float32Array;
  cameraPosition: [number, number, number];
  tanHalfFov: number;
  aspect: number;
  /** Pixels per world unit at view distance 1, for a viewport of `height` pixels. */
  projScale: number;
}

const model = new Matrix4();
const modelView = new Matrix4();
const invRot = new Matrix4();

export function buildViewState(
  camera: PerspectiveCamera,
  boxRotation: Quaternion,
  width: number,
  height: number,
): ViewState {
  camera.updateMatrixWorld();
  model.makeRotationFromQuaternion(boxRotation);
  modelView.multiplyMatrices(camera.matrixWorldInverse, model);
  invRot.copy(model).transpose();
  const e = invRot.elements;
  const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
  return {
    width,
    height,
    view: new Float32Array(camera.matrixWorldInverse.elements),
    proj: new Float32Array(camera.projectionMatrix.elements),
    cameraWorld: new Float32Array(camera.matrixWorld.elements),
    model: new Float32Array(model.elements),
    modelView: new Float32Array(modelView.elements),
    boxInvRot: new Float32Array([e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]]),
    cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
    tanHalfFov,
    aspect: camera.aspect,
    projScale: height / (2 * tanHalfFov),
  };
}
