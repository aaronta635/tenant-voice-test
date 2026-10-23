from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, SecretStr


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "TenantVoice API"
    app_env: str = "development"
    api_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:3000"
    # Where the browser app runs: links in emails (password reset) point here.
    frontend_url: str = "http://localhost:3000"

    supabase_url: str
    supabase_service_role_key: str
    # More Supabase project refs (comma-separated) that scripts/seed_provider_demo.py
    # --apply refuses to write demo rows to, beside the shared production project,
    # which it always refuses.
    protected_project_refs: str = ""

    # Whether a first sign-in may take over a users row with its email that no
    # auth user has yet (one the rental web or an import made). Off until a
    # sign-up proves the address is the person's (migration plan §4, #8):
    # registration confirms no email, so whoever signed up first would get it.
    claim_accounts_by_email: bool = False

    deepseek_api_key: SecretStr = SecretStr("")
    deepseek_model: str = "deepseek-flash"
    deepseek_timeout_seconds: float = Field(default=12, ge=1, le=30)

    # Support chat messages a member may send a day (services/support_chat.py),
    # counted with the mobile app's AI chat in mobile_ai_chat_usage.
    support_chat_daily_limit: int = Field(default=30, ge=1, le=1000)

    # The ClamAV daemon (clamd) that scans uploads before they are stored
    # (services/uploads.py). Off while the host is empty: files are then
    # stored unscanned and labelled so (tracker assumption #22).
    clamav_host: str = ""
    clamav_port: int = Field(default=3310, ge=1, le=65535)
    clamav_timeout_seconds: float = Field(default=10, gt=0, le=60)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
