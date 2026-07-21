# Build Environment Notes

- Emscripten is required to build the WASM pipeline, but `emcc` is not installed in the current environment.
- The `build.sh` script now attempts to generate FlatBuffers C++ headers from `src/scene_graph.fbs` if `flatc` is available.
- A placeholder `src/scene_graph_generated.h` exists for the generated FlatBuffers bindings.
- Runtime assumes zero-copy GPU uploads from the WASM heap via `glBufferData`.
- WebGL context loss and restoration callbacks are implemented.
