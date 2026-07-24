#include <emscripten/html5.h>
#include <cstdlib>
#include <cstdint>
#include <vector>

import wildfire.renderer;
import wildfire.buffer_parser;
import wildfire.geosplat;

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

EMSCRIPTEN_KEEPALIVE
unsigned int geosplat_decode(const unsigned char* data, unsigned int byte_length) {
    return wildfire::geosplat::decode(data, byte_length);
}

EMSCRIPTEN_KEEPALIVE
const float* geosplat_data() {
    return wildfire::geosplat::instance_data();
}

EMSCRIPTEN_KEEPALIVE
unsigned int geosplat_count() {
    return wildfire::geosplat::splat_count();
}

EMSCRIPTEN_KEEPALIVE
unsigned int geosplat_floats_per_splat() {
    return wildfire::geosplat::kFloatsPerSplat;
}

EMSCRIPTEN_KEEPALIVE
void geosplat_release() {
    wildfire::geosplat::release();
}

}
