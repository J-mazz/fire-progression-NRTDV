// shader_manager.cppm - FIXED: exports wildfire::shader_manager namespace
module;
#include <GLES3/gl3.h>
#include <cstdlib>
#include <cstdint>

export module wildfire.shader_manager;

namespace wildfire::shader_manager {

static GLuint compile_shader(GLenum type, const char* source) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, nullptr);
    glCompileShader(shader);

    GLint compiled = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
    if (!compiled) {
        GLint length = 0;
        glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &length);
        if (length > 0) {
            char* buffer = static_cast<char*>(malloc(length));
            glGetShaderInfoLog(shader, length, nullptr, buffer);
            free(buffer);
        }
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

export GLuint create_shader_program() {
    const char* vertex_source = R"GLSL(
        #version 300 es
        layout(location = 0) in vec3 a_position;
        void main() {
            gl_Position = vec4(a_position, 1.0);
        }
    )GLSL";

    const char* fragment_source = R"GLSL(
        #version 300 es
        precision mediump float;
        out vec4 outColor;
        void main() {
            outColor = vec4(1.0, 0.55, 0.12, 1.0);
        }
    )GLSL";

    GLuint vertex_shader = compile_shader(GL_VERTEX_SHADER, vertex_source);
    if (!vertex_shader) return 0;

    GLuint fragment_shader = compile_shader(GL_FRAGMENT_SHADER, fragment_source);
    if (!fragment_shader) {
        glDeleteShader(vertex_shader);
        return 0;
    }

    GLuint program = glCreateProgram();
    glAttachShader(program, vertex_shader);
    glAttachShader(program, fragment_shader);
    glLinkProgram(program);

    GLint linked = 0;
    glGetProgramiv(program, GL_LINK_STATUS, &linked);
    glDeleteShader(vertex_shader);
    glDeleteShader(fragment_shader);

    if (!linked) {
        GLint length = 0;
        glGetProgramiv(program, GL_INFO_LOG_LENGTH, &length);
        if (length > 0) {
            char* buffer = static_cast<char*>(malloc(length));
            glGetProgramInfoLog(program, length, nullptr, buffer);
            free(buffer);
        }
        glDeleteProgram(program);
        return 0;
    }

    return program;
}

} // namespace wildfire::shader_manager
