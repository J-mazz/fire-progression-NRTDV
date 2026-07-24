// renderer.cppm - FIXED: correct module order + namespace
module;
#include <emscripten/html5.h>
#include <GLES3/gl3.h>
#include <vector>
#include <string>
#include <cstdint>
#include <cstdlib>

export module wildfire.renderer;
import wildfire.shader_manager;

struct Geometry {
    uint32_t vertex_count;
    GLuint vao;
    GLuint vbo;
};

static Geometry g_geometry = {0, 0, 0};
static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE g_context = 0;
static GLuint g_shader_program = 0;
static bool g_context_ready = false;
static bool g_context_lost = false;
static std::string g_canvas_selector = "#canvas";

static void destroy_geometry() {
    if (g_geometry.vbo != 0) {
        glDeleteBuffers(1, &g_geometry.vbo);
        g_geometry.vbo = 0;
    }
    if (g_geometry.vao != 0) {
        glDeleteVertexArrays(1, &g_geometry.vao);
        g_geometry.vao = 0;
    }
    g_geometry.vertex_count = 0;
}

static void ensure_geometry_vbo() {
    if (g_geometry.vao == 0) glGenVertexArrays(1, &g_geometry.vao);
    if (g_geometry.vbo == 0) glGenBuffers(1, &g_geometry.vbo);
    glBindVertexArray(g_geometry.vao);
    glBindBuffer(GL_ARRAY_BUFFER, g_geometry.vbo);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 0, reinterpret_cast<void*>(0));
    glBindVertexArray(0);
}

static void main_loop_callback(void* /*arg*/) {
    if (!g_context_ready) return;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    GLint width = 0, height = 0;
    emscripten_get_canvas_element_size(g_canvas_selector.c_str(), &width, &height);
    glViewport(0, 0, width, height);
    glClearColor(0.05f, 0.08f, 0.12f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    if (g_geometry.vertex_count > 0 && g_geometry.vao != 0) {
        glUseProgram(g_shader_program);
        glBindVertexArray(g_geometry.vao);
        glDrawArrays(GL_TRIANGLES, 0, g_geometry.vertex_count);
        glBindVertexArray(0);
    }
}

static bool context_lost_callback(int, const void*, void*) {
    g_context_lost = true; g_context_ready = false;
    destroy_geometry();
    if (g_shader_program != 0) { glDeleteProgram(g_shader_program); g_shader_program = 0; }
    return true;
}

static bool context_restored_callback(int, const void*, void*) {
    if (emscripten_webgl_make_context_current(g_context) != EMSCRIPTEN_RESULT_SUCCESS) return false;
    g_shader_program = wildfire::shader_manager::create_shader_program();
    destroy_geometry();
    g_context_lost = false; g_context_ready = true;
    return true;
}

export namespace wildfire::renderer {

    int initialize_webgl_context(const char* canvas_selector) {
        if (canvas_selector != nullptr && canvas_selector[0] != '\0') {
            g_canvas_selector = canvas_selector;
        }
        EmscriptenWebGLContextAttributes attrs;
        emscripten_webgl_init_context_attributes(&attrs);
        attrs.alpha = false; attrs.depth = true; attrs.stencil = false;
        attrs.antialias = true; attrs.majorVersion = 2; attrs.minorVersion = 0;
        g_context = emscripten_webgl_create_context(g_canvas_selector.c_str(), &attrs);
        if (g_context <= 0) return 0;
        if (emscripten_webgl_make_context_current(g_context) != EMSCRIPTEN_RESULT_SUCCESS) return 0;
        g_shader_program = wildfire::shader_manager::create_shader_program();
        if (g_shader_program == 0) return 0;
        emscripten_set_webglcontextlost_callback(g_canvas_selector.c_str(), nullptr, false, context_lost_callback);
        emscripten_set_webglcontextrestored_callback(g_canvas_selector.c_str(), nullptr, false, context_restored_callback);
        g_context_ready = true;
        emscripten_set_main_loop_arg(main_loop_callback, nullptr, 0, 1);
        return 1;
    }

    int update_geometry_from_vertices(const std::vector<float>& v) {
        if (g_context_lost || v.empty()) return 0;
        destroy_geometry(); ensure_geometry_vbo();
        glBindVertexArray(g_geometry.vao);
        glBindBuffer(GL_ARRAY_BUFFER, g_geometry.vbo);
        glBufferData(GL_ARRAY_BUFFER, v.size()*sizeof(float), v.data(), GL_STATIC_DRAW);
        glBindVertexArray(0);
        g_geometry.vertex_count = static_cast<uint32_t>(v.size()/3);
        return g_geometry.vertex_count > 0 ? 1 : 0;
    }

    void render_frame() { if (!g_context_ready || g_geometry.vertex_count==0u) return; main_loop_callback(nullptr); }
    bool is_context_lost() { return g_context_lost; }
    bool is_context_ready() { return g_context_ready; }

} // namespace wildfire::renderer
