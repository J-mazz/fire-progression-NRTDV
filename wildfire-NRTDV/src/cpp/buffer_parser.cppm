module;
#include <vector>
#include <cstdint>
#include <cstring>
#include "flatbuffers_minimal.h"
#include "scene_graph_generated.h"

export module wildfire.buffer_parser;

export bool verify_flatbuffer_payload(const unsigned char* payload_ptr, unsigned int byte_length) {
    if (payload_ptr == nullptr || byte_length == 0u) {
        return false;
    }

    flatbuffers::Verifier verifier(payload_ptr, byte_length);
    if (wildfire::VerifySceneGraphBuffer(verifier)) {
        return true;
    }

    flatbuffers::Verifier verifier2(payload_ptr, byte_length);
    if (wildfire::VerifySizePrefixedSceneGraphBuffer(verifier2)) {
        return true;
    }

    if (byte_length < 4u) {
        return false;
    }

    const uint32_t vertex_count = reinterpret_cast<const uint32_t*>(payload_ptr)[0];
    const unsigned int required_bytes = 4u + vertex_count * 3u * sizeof(float);
    return required_bytes == byte_length;
}

export bool parse_scene_graph_vertices(const unsigned char* payload_ptr, unsigned int byte_length, std::vector<float>& out_vertices) {
    if (!payload_ptr || byte_length == 0u) {
        return false;
    }

    const wildfire::SceneGraph* scene_graph = nullptr;
    flatbuffers::Verifier verifier(payload_ptr, byte_length);
    if (wildfire::VerifySceneGraphBuffer(verifier)) {
        scene_graph = wildfire::GetSceneGraph(payload_ptr);
    } else {
        flatbuffers::Verifier verifier2(payload_ptr, byte_length);
        if (wildfire::VerifySizePrefixedSceneGraphBuffer(verifier2)) {
            scene_graph = wildfire::GetSizePrefixedSceneGraph(payload_ptr);
        }
    }

    if (scene_graph) {
        const wildfire::VertexBuffer* vertex_buffer = scene_graph->vertices();
        if (!vertex_buffer) {
            return false;
        }

        const uint32_t vertex_count = vertex_buffer->vertex_count();
        if (vertex_count == 0u) {
            return false;
        }

        const auto* positions = vertex_buffer->positions();
        if (!positions || positions->size() != vertex_count) {
            return false;
        }

        out_vertices.clear();
        out_vertices.reserve(static_cast<size_t>(vertex_count) * 3u);
        for (uint32_t i = 0; i < vertex_count; ++i) {
            const wildfire::Vec3* position = positions->Get(i);
            if (!position) {
                return false;
            }
            out_vertices.push_back(position->x());
            out_vertices.push_back(position->y());
            out_vertices.push_back(position->z());
        }
        return true;
    }

    if (byte_length < 4u) {
        return false;
    }

    const uint32_t vertex_count = reinterpret_cast<const uint32_t*>(payload_ptr)[0];
    if (vertex_count == 0u) {
        return false;
    }

    const float* source_positions = reinterpret_cast<const float*>(payload_ptr + 4u);
    const size_t total_floats = static_cast<size_t>(vertex_count) * 3u;
    out_vertices.assign(source_positions, source_positions + total_floats);
    return true;
}
