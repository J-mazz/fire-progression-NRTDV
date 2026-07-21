import * as flatbuffers from 'flatbuffers';
import { SceneGraph } from '../../../vendor/wildfire/scene-graph.js';
import { VertexBuffer } from '../../../vendor/wildfire/vertex-buffer.js';
import { Vec3 } from '../../../vendor/wildfire/vec3.js';

export function buildSceneGraphFromFloatArray(floatArray: Float32Array): ArrayBuffer {
  const vertexCount = Math.floor(floatArray.length / 3);
  const builder = new flatbuffers.Builder(1024);
  const positions: flatbuffers.Offset[] = new Array(vertexCount);

  for (let i = 0; i < vertexCount; ++i) {
    const x = floatArray[i * 3 + 0];
    const y = floatArray[i * 3 + 1];
    const z = floatArray[i * 3 + 2];
    positions[i] = Vec3.createVec3(builder, x, y, z);
  }

  const positionsVector = VertexBuffer.createPositionsVector(builder, positions);
  const vertexBuffer = VertexBuffer.createVertexBuffer(builder, vertexCount, positionsVector);
  const sceneGraph = SceneGraph.createSceneGraph(builder, vertexBuffer);
  SceneGraph.finishSceneGraphBuffer(builder, sceneGraph);

  return builder.asUint8Array().buffer;
}

export function floatArrayToLegacyPayload(floatArray: Float32Array): ArrayBuffer {
  const vertexCount = Math.floor(floatArray.length / 3);
  const buffer = new ArrayBuffer(4 + vertexCount * 3 * 4);
  const view = new DataView(buffer);
  view.setUint32(0, vertexCount, true);
  const floats = new Float32Array(buffer, 4, vertexCount * 3);
  floats.set(floatArray.subarray(0, vertexCount * 3));
  return buffer;
}

export function tryInterpretBinaryAsWasmPayload(ab: ArrayBuffer): ArrayBuffer | null {
  if (!(ab instanceof ArrayBuffer)) {
    return null;
  }

  if (ab.byteLength >= 4) {
    const dv = new DataView(ab);
    const count = dv.getUint32(0, true);
    const expectedBytes = 4 + count * 3 * 4;
    if (expectedBytes === ab.byteLength) {
      return ab;
    }
  }

  if (ab.byteLength % 12 === 0) {
    return buildSceneGraphFromFloatArray(new Float32Array(ab));
  }

  return null;
}

export function extractPositionsFromJson(obj: unknown): Float32Array | null {
  if (obj === null || obj === undefined) {
    return null;
  }

  const candidates: string[] = ['positions', 'vertices', 'coords', 'points', 'data'];
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    for (const key of candidates) {
      const value = (obj as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return normalizeJsonPositions(value);
      }
    }
  }

  if (Array.isArray(obj)) {
    return normalizeJsonPositions(obj);
  }

  return null;
}

function normalizeJsonPositions(value: unknown[]): Float32Array | null {
  if (value.length === 0) {
    return null;
  }

  if (typeof value[0] === 'number') {
    return new Float32Array(value as number[]);
  }

  if (Array.isArray(value[0])) {
    const coordinates = value as unknown[][];
    const flat = new Float32Array(coordinates.length * 3);
    let index = 0;
    for (const item of coordinates) {
      if (!Array.isArray(item)) {
        continue;
      }
      flat[index++] = Number(item[0] ?? 0);
      flat[index++] = Number(item[1] ?? 0);
      flat[index++] = Number(item[2] ?? 0);
    }
    return flat;
  }

  return null;
}
