from pydantic import BaseModel


class UploadOut(BaseModel):
    url: str
    path: str
    content_type: str
    size: int
