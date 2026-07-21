export interface SceneConfiguration {
  center_coordinates?: {
    latitude?: number;
    longitude?: number;
    altitude_meters?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface LayerConfig {
  layer_index?: number;
  layer_type?: string;
  data_source?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface VisualizationManifest {
  earthview_visualization_framework: {
    scene_configuration: SceneConfiguration;
    layer_compositing_pipeline?: LayerConfig[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface LoadVisualizationManifestOptions {
  authToken?: string;
  allowedOrigins?: string[];
  corsMode?: RequestMode;
  credentials?: RequestCredentials;
  maxAllocationBytes?: number;
  wsSubprotocols?: string[];
}

export interface RendererOptions {
  maxAllocationBytes?: number;
  wsSubprotocols?: string[];
  allowedOrigins?: string[];
}

export interface EmscriptenModule {
  cwrap(identifier: string, returnType: string | null, argTypes?: string[]): (...args: any[]) => any;
  HEAPU8: Uint8Array;
}
