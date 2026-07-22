import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { LoadVisualizationManifestOptions, VisualizationManifest } from '../types';

// --- strict allow-lists, no open strings ---
const SAFE_LOCAL_PATH_RE = /^\/data\/[a-zA-Z0-9_\-\/]+\.(tif|tiff|bin|json)$/;
const DATA_SOURCES = [
  "USGS_3DEP_DEM",
"Sentinel_2_RGB",
"NASA_FIRMS_VIIRS",
"SAM_2_Fire_Perimeter",
"SAM_2_Smoke_Mask",
"Prithvi_Burn_Severity"
] as const;

const manifestSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    $id: { type: 'string' },
    manifest_version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    manifest_created_utc: { type: 'string', format: 'date-time' },
    earthview_visualization_framework: {
      type: 'object',
      properties: {
        scene_configuration: {
          type: 'object',
          properties: {
            projection_model: { enum: ['localized_spherical_patch'] },
            center_coordinates: {
              type: 'object',
              properties: {
                latitude: { type: 'number', minimum: -90, maximum: 90 },
                longitude: { type: 'number', minimum: -180, maximum: 180 },
                altitude_meters: { type: 'number', minimum: 0, maximum: 1_000_000 }
              },
              required: ['latitude','longitude','altitude_meters'],
              additionalProperties: false
            },
            camera_behavior: {
              type: 'object',
              properties: {
                mode: { enum: ['orbital_trackball'] },
                constraints: {
                  type: 'object',
                  properties: {
                    min_pitch_degrees: { type: 'number', minimum: 0, maximum: 90 },
                    max_pitch_degrees: { type: 'number', minimum: 0, maximum: 90 },
                    min_zoom_meters: { type: 'number', minimum: 10, maximum: 100000 },
                    max_zoom_meters: { type: 'number', minimum: 10, maximum: 100000 }
                  },
                  additionalProperties: false
                }
              },
              additionalProperties: false
            }
          },
          required: ['projection_model','center_coordinates'],
          additionalProperties: false
        },
        terrain_engine: {
          type: 'object',
          properties: {
            displacement_mapping: {
              type: 'object',
              properties: {
                source: { enum: ['USGS_3DEP_DEM'] },
                source_url_local: { type: 'string', pattern: '^/data/' },
                vertex_shader_instruction: { enum: ['texture_sample_and_extrude'] },
                vertical_exaggeration_multiplier: { type: 'number', minimum: 0.1, maximum: 5 },
                tessellation_level: { enum: ['dynamic_lod_based_on_camera_distance'] }
              },
              required: ['source','vertex_shader_instruction'],
              additionalProperties: false
            }
          },
          additionalProperties: false
        },
        layer_compositing_pipeline: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              layer_index: { type: 'integer', minimum: 0, maximum: 20 },
              layer_type: { enum: ['base_surface','data_overlay','vector_geometry','semantic_mask'] },
              data_source: { enum: DATA_SOURCES },
              data_source_local: { type: 'string', pattern: '^/data/' },
              data_source_type: { enum: ['raster_cog','flatbuffer_point','flatbuffer_linestrip','voxel_density'] },
              blend_mode: { enum: ['opaque','multiply','additive'] },
              opacity: { type: 'number', minimum: 0, maximum: 1 },
              color_ramp: { enum: ['inferno','viridis'] },
              visible: { type: 'boolean' },
              geometry_style: { type: 'object', additionalProperties: false,
                properties: {
                  primitive: { enum: ['point_sprite','line_strip'] },
                  color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                  bloom_effect: { type: 'boolean' },
                  line_width: { type: 'number', minimum: 0.1, maximum: 10 },
                  pulsate_animation: { type: 'boolean' },
                  max_point_count: { type: 'integer', minimum: 1, maximum: 100000 }
                }
              }
            },
            required: ['layer_index','layer_type','data_source'],
            additionalProperties: false
          }
        },
        atmospheric_and_environmental_effects: {
          type: 'object',
          additionalProperties: false,
          properties: {
            lighting_model: { enum: ['physically_based_rendering'] },
            sun_position: { enum: ['dynamic_based_on_current_utc'] },
            volumetric_smoke: {
              type: 'object', additionalProperties: false,
              properties: {
                data_source: { enum: DATA_SOURCES },
                data_source_local: { type: 'string', pattern: '^/data/' },
                rendering_technique: { enum: ['raymarching_with_density_accumulation'] },
                base_color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                absorption_coefficient: { type: 'number', minimum: 0, maximum: 1 },
                max_density: { type: 'number', minimum: 0, maximum: 2 }
              }
            },
            fire_illumination: {
              type: 'object', additionalProperties: false,
              properties: {
                technique: { enum: ['point_light_arrays_at_firms_coordinates'] },
                intensity: { type: 'number', minimum: 0, maximum: 10 },
                falloff_radius_meters: { type: 'number', minimum: 0, maximum: 10000 },
                max_lights: { type: 'integer', minimum: 1, maximum: 1000 }
              }
            }
          }
        }
      },
      required: ['scene_configuration','layer_compositing_pipeline'],
      additionalProperties: false
    }
  },
  required: ['earthview_visualization_framework','manifest_version'],
  additionalProperties: false
} as const;

function isUrlSafe(manifestUrl: string, allowedOrigins: string[]): URL {
  const url = new URL(manifestUrl, window.location.href);
  // block javascript:, data:, ws:, wss: - manifest itself must be https/http
  if (!['https:','http:'].includes(url.protocol)) {
    throw new Error(`Disallowed protocol: ${url.protocol}`);
  }
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) {
    throw new Error(`Manifest origin not allowed: ${url.origin}`);
  }
  // block path traversal
  if (url.pathname.includes('..')) throw new Error('Path traversal in manifest URL');
  return url;
}

function assertSafeLocalPaths(manifest: any) {
  const layers = manifest?.earthview_visualization_framework?.layer_compositing_pipeline ?? [];
  for (const l of layers) {
    if (l.data_source_local) {
      if (!SAFE_LOCAL_PATH_RE.test(l.data_source_local) || l.data_source_local.includes('..')) {
        throw new Error(`Unsafe data_source_local: ${l.data_source_local}`);
      }
    }
  }
}

export async function loadVisualizationManifest(
  manifestUrl: string,
  options: LoadVisualizationManifestOptions = {}
): Promise<VisualizationManifest> {
  if (!manifestUrl) throw new Error('manifestUrl is required');

  const allowedOrigins = options.allowedOrigins ?? [window.location.origin];
  const safeUrl = isUrlSafe(manifestUrl, allowedOrigins);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;

    const response = await fetch(safeUrl.toString(), {
      mode: options.corsMode ?? 'cors',
      credentials: options.credentials ?? 'omit',
      headers,
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`Failed to fetch manifest: ${response.status}`);

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength,10) > 1_000_000) {
      throw new Error('Manifest too large');
    }

    const text = await response.text();
    if (text.length > 1_000_000) throw new Error('Manifest body too large');

    const manifest = JSON.parse(text);

    // block __proto__ pollution
    if (JSON.stringify(manifest).includes('__proto__')) throw new Error('Invalid manifest content');

    const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: false });
    addFormats(ajv);
    const validate = ajv.compile(manifestSchema);
    if (!validate(manifest)) {
      throw new Error(`Manifest validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    assertSafeLocalPaths(manifest);

    // IMPORTANT: Do NOT embed MAP_KEY, COPERN_USER_ID, COPERN_ACCT_ID here.
    // Those are build-time secrets used to populate /data/ before docker build.
    // If you need them in JS, read from server-side env, never bundle as literal:
    // const firmsKey = import.meta.env.VITE_FIRMS_KEY // still visible - prefer proxy

    return manifest as VisualizationManifest;
  } finally {
    clearTimeout(timeout);
  }
}
