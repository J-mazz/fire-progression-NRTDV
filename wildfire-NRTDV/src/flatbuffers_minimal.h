#ifndef FLATBUFFERS_MINIMAL_H_
#define FLATBUFFERS_MINIMAL_H_

#include <cstddef>
#include <cstdint>

namespace flatbuffers {

class Verifier {
 public:
  Verifier(const uint8_t* buffer, size_t length) : buffer_(buffer), length_(length) {}

  bool VerifyBuffer(size_t required_length) const {
    return buffer_ != nullptr && length_ >= required_length;
  }

  bool VerifySize(size_t required_extra, size_t base_offset) const {
    if (buffer_ == nullptr) {
      return false;
    }
    return length_ >= base_offset + required_extra;
  }

 private:
  const uint8_t* buffer_;
  size_t length_;
};

}  // namespace flatbuffers

#endif  // FLATBUFFERS_MINIMAL_H_
