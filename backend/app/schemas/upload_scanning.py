from pydantic import BaseModel


class UploadScanningOut(BaseModel):
    # Whether new uploads are virus-scanned before they are stored. While not,
    # the pages that show someone else's files label them "Not virus-scanned".
    enabled: bool
