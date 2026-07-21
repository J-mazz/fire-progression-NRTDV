import Ajv from 'ajv';
import { LoadVisualizationManifestOptions, VisualizationManifest } from '../types';

const manifestSchema = {
  type: 'object',
  properties: {
    earthview_visualization_framework: {
      type: 'object',
      properties: {
        scene_configuration: { type: 'object' },
        layer_compositing_pipeline: { type: 'array' }
      },
      required: ['scene_configuration']
    }
  },
  required: ['earthview_visualization_framework'],
  additionalProperties: true
};

export async function loadVisualizationManifest(
  manifestUrl: string,
  options: LoadVisualizationManifestOptions = {}
): Promise<VisualizationManifest> {
  if (!manifestUrl) {
    throw new Error('manifestUrl is required');
  }

  if (options.allowedOrigins && !isOriginAllowed(manifestUrl, options.allowedOrigins)) {
    throw new Error('Manifest fetch origin not permitted');
  }

  const headers: Record<string, string> = {};
  if (options.authToken) {
    headers.Authorization = `Bearer ${options.authToken}`;
  }

  const response = await fetch(manifestUrl, {
    mode: options.corsMode ?? 'cors',
    credentials: options.credentials ?? 'omit',
    headers
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
  }

  const manifest = (await response.json()) as unknown;
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(manifestSchema);

  if (!validate(manifest)) {
    const errors = validate.errors ? ajv.errorsText(validate.errors) : 'unknown validation error';
    throw new Error(`Manifest JSON Schema validation failed: ${errors}`);
  }

  return manifest as VisualizationManifest;
}

function isOriginAllowed(url: string, allowedOrigins: string[]): boolean {
  const origin = new URL(url, window.location.href).origin;
  return allowedOrigins.includes(origin);
}
