"""SAM-2 image-embedding backends.

The hiera image encoder dominates SAM-2 cost and — unlike the prompt decoder —
does not depend on the prompts, so one Sentinel scene can be encoded once and
reused by every hotspot frame that resolves to it.

Two backends are available:

* ``OnnxCudaEncoder`` runs the exported encoder graph (``.models/sam2/encoder.onnx``)
  through ONNX Runtime's CUDA execution provider. This is the intended production
  path: torch stays pinned to the CPU wheel for pre/post-processing while the
  encoder runs on the GPU.
* ``TorchEncoder`` calls ``Sam2Model.get_image_embeddings`` directly. It is the
  fallback for machines without a usable CUDA stack.

Both return the three-level feature pyramid as a list of torch tensors, which is
exactly what ``Sam2Model.forward(image_embeddings=...)`` consumes.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

DEFAULT_ENCODER_ONNX = Path(".models/sam2/encoder.onnx")
EXPECTED_PYRAMID_LEVELS = 3


class TorchEncoder:
    """Runs the encoder through transformers on whatever device torch has."""

    name = "torch"

    def __init__(self, model):
        self._model = model

    def encode(self, pixel_values: torch.Tensor) -> list[torch.Tensor]:
        with torch.inference_mode():
            return list(self._model.get_image_embeddings(pixel_values))


class OnnxCudaEncoder:
    """Runs the exported encoder graph on the CUDA execution provider."""

    name = "onnxruntime-cuda"

    def __init__(self, session, input_name: str, output_names: list[str], input_shape):
        self._session = session
        self._input_name = input_name
        self._output_names = output_names
        self._input_shape = input_shape

    def encode(self, pixel_values: torch.Tensor) -> list[torch.Tensor]:
        array = pixel_values.detach().cpu().contiguous().numpy()
        if array.dtype != np.float32:
            array = array.astype(np.float32, copy=False)
        _check_shape(self._input_shape, array.shape)
        outputs = self._session.run(self._output_names, {self._input_name: array})
        return [torch.from_numpy(output) for output in outputs]


def _check_shape(expected, actual) -> None:
    """Fixed dimensions in the exported graph must match; symbolic ones are free."""
    if len(expected) != len(actual):
        raise RuntimeError(f"encoder.onnx expects rank {len(expected)}, got {len(actual)}")
    for axis, (want, have) in enumerate(zip(expected, actual)):
        if isinstance(want, int) and want > 0 and want != have:
            raise RuntimeError(
                f"encoder.onnx expects {expected} but the processor produced {actual} (axis {axis})"
            )


def build_encoder(model, onnx_path: Path | None = None, require_gpu: bool = False):
    """Prefer the CUDA ONNX encoder; fall back to torch unless ``require_gpu``.

    ``require_gpu`` exists for the scheduled service: silently dropping to a CPU
    encoder turns a minutes-long run into an hours-long one, so it should fail
    loudly instead.
    """
    path = Path(onnx_path) if onnx_path is not None else DEFAULT_ENCODER_ONNX

    if not path.is_file():
        if require_gpu:
            raise RuntimeError(f"--require-gpu was set but the encoder graph is missing: {path}")
        print(f"SAM-2 encoder: {path} not found; using torch on CPU.")
        return TorchEncoder(model)

    try:
        from gpu_runtime import create_cuda_session

        session = create_cuda_session(str(path))
        spec = session.get_inputs()[0]
        outputs = [output.name for output in session.get_outputs()]
        if len(outputs) != EXPECTED_PYRAMID_LEVELS:
            raise RuntimeError(
                f"encoder.onnx exposes {len(outputs)} outputs; expected {EXPECTED_PYRAMID_LEVELS} pyramid levels"
            )
        print(f"SAM-2 encoder: ONNX Runtime CUDA session on {path} (outputs: {', '.join(outputs)}).")
        return OnnxCudaEncoder(session, spec.name, outputs, tuple(spec.shape))
    except Exception as error:  # noqa: BLE001 - any failure means no usable GPU encoder
        if require_gpu:
            raise RuntimeError(f"--require-gpu was set but the CUDA encoder is unavailable: {error}") from error
        print(f"SAM-2 encoder: falling back to torch ({error}).")
        return TorchEncoder(model)
