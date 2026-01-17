import logging
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file="backend/.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./backend.db"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_exp_minutes: int = 60 * 24
    finnhub_api_key: str = ""


settings = Settings()

# 시작 시 설정 값 로깅
logger.info("[CONFIG] finnhub_api_key: %s (len=%d)",
            "SET" if settings.finnhub_api_key else "NOT SET",
            len(settings.finnhub_api_key) if settings.finnhub_api_key else 0)
