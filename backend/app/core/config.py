from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "TenantVoice API"
    app_env: str = "development"
    api_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:3000"

    supabase_url: str
    supabase_service_role_key: str

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
