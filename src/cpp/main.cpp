#include <emscripten/html5.h>
#include <cstdlib>
#include <cstdint>
#include <vector>

import wildfire.renderer;
import wildfire.buffer_parser;

extern "C" {

EMSCRIPTEN_KEEPALIVE
void* ext_allocate_wasm_buffer(size_t size) {
    return malloc(size);
}

EMSCRIPTEN_KEEPALIVE
void ext_free_wasm_buffer(void* ptr) {
    free(ptr);
}

EMSCRIPTEN_KEEPALIVE
int initialize_webgl_context(const char* canvas_selector) {
    return wildfire::renderer::initialize_webgl_context(canvas_selector);
}

EMSCRIPTEN_KEEPALIVE
int ingest_flatbuffer_stream(unsigned char* payload_ptr, unsigned int byte_length) {
    if (wildfire::renderer::is_context_lost() || payload_ptr == nullptr || byte_length == 0u) {
        return 0;
    }

    if (!wildfire::buffer_parser::verify_flatbuffer_payload(payload_ptr, byte_length)) {
        return 0;
    }

    std::vector<float> vertex_data;
    if (!wildfire::buffer_parser::parse_scene_graph_vertices(payload_ptr, byte_length, vertex_data)) {
        return 0;
    }

    return wildfire::renderer::update_geometry_from_vertices(vertex_data);
}

EMSCRIPTEN_KEEPALIVE
void render_frame() {
    wildfire::renderer::render_frame();
}

}
