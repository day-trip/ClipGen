from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, Optional

@dataclass
class InferenceRequest:
    job_id: str
    user_id: str
    input_data: Dict[str, Any]  # JSON from job table
    s3_bucket: str

@dataclass
class InferenceResult:
    job_id: str
    video_path: Path
    processing_time: float
    metadata: Optional[Dict[str, Any]] = None
