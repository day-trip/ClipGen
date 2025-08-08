import logging

def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    return logging.getLogger(__name__)

class GPUMonitor:
    def __init__(self, gpu_devices):
        self.gpu_devices = gpu_devices

    def get_stats(self):
        return {gpu_id: {'memory_used': 0} for gpu_id in self.gpu_devices}