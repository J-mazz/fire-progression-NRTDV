"""Project GPU selection and strict ONNX Runtime CUDA session helpers."""

from __future__ import annotations

import os
from pathlib import Path


def cuda_device_index() -> int:
    return int(os.environ.get("WILDFIRE_CUDA_DEVICE_INDEX", "0"))


def vulkan_device_index() -> int:
    return int(os.environ.get("WILDFIRE_VULKAN_DEVICE_INDEX", "1"))


def preload_onnx_cuda_libraries() -> None:
    import onnxruntime as ort

    # Search uv-installed NVIDIA wheels first, then the system CUDA toolkit.
    ort.preload_dlls(cuda=True, cudnn=True, directory="")
    cuda_lib = Path("/usr/local/cuda-13.3/targets/x86_64-linux/lib")
    if cuda_lib.is_dir():
        ort.preload_dlls(cuda=True, cudnn=False, directory=str(cuda_lib))


def create_cuda_session(model: str | bytes, **options):
    import onnxruntime as ort

    preload_onnx_cuda_libraries()
    available = ort.get_available_providers()
    if "CUDAExecutionProvider" not in available:
        raise RuntimeError(f"CUDAExecutionProvider unavailable; providers={available}")

    provider_options = {
        "device_id": cuda_device_index(),
        "arena_extend_strategy": "kNextPowerOfTwo",
        "cudnn_conv_algo_search": "HEURISTIC",
        "use_tf32": 1,
        **options,
    }
    session = ort.InferenceSession(
        model,
        providers=[("CUDAExecutionProvider", provider_options)],
    )
    if session.get_providers()[0] != "CUDAExecutionProvider":
        raise RuntimeError(f"ONNX Runtime fell back from CUDA: {session.get_providers()}")
    return session
