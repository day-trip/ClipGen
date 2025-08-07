from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, Any


class ModelInterface(ABC):
    """Abstract interface for all model implementations"""

    @abstractmethod
    async def initialize(self, gpu_devices: list[int]) -> None:
        """Initialize the model pipeline on specified GPUs"""
        pass

    @abstractmethod
    async def generate(self, input_data: Dict[str, Any]) -> Path:
        """Generate video from input data, return a path to the output file"""
        pass

    @abstractmethod
    async def cleanup(self) -> None:
        """Clean up resources"""
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Return model identifier"""
        pass
