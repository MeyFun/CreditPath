import logging
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_JWT_SECRET = "dev-only-change-this-secret-before-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_name: str = "CreditPath API"
    environment: str = "demo"
    database_url: str = "postgresql+psycopg://creditpath:creditpath_demo@db:5432/creditpath"
    jwt_secret: str = ""
    access_token_minutes: int = 60
    cors_origins: str = "http://localhost:8080,http://127.0.0.1:8080"
    login_rate_limit: int = 5
    # Мягкий лимит на логин со всех IP: тормозит распределённый перебор, но не даёт
    # заблокировать чужой аккаунт парой попыток. Блок снимается по окончании окна.
    login_user_rate_limit: int = 20
    login_rate_window_seconds: int = 300
    demo_password: str = "DemoPass123!"
    seed_demo: bool = True

    registry_url: str = "http://registry-mock:8000"
    bki_url: str = "http://bki-mock:8000"
    external_timeout_seconds: float = 4.0
    external_retries: int = 2

    upload_dir: str = "/data/uploads"
    max_upload_mb: int = 10
    log_level: str = "INFO"
    scoring_config_path: Path = Field(default=BASE_DIR / "scoring_config.yaml")
    # После рестарта дожимать заявки, застрявшие на автоматических этапах. В тестах выключено.
    resume_pipelines: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def resolve_jwt_secret(value: str) -> str:
    # Секрет из репозитория позволил бы любому подписать токен администратора.
    # Если он не задан, генерируем случайный: токены просто сбросятся при рестарте.
    if value and value != DEFAULT_JWT_SECRET:
        return value
    logging.getLogger("creditpath.config").warning("JWT_SECRET не задан: сгенерирован случайный секрет процесса")
    return secrets.token_urlsafe(32)


settings = get_settings()
settings.jwt_secret = resolve_jwt_secret(settings.jwt_secret)
