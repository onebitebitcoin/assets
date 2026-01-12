from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=4, max_length=128)


class UserLogin(UserCreate):
    pass


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AssetCreate(BaseModel):
    name: str
    symbol: str
    asset_type: str
    quantity: float = Field(gt=0)


class AssetUpdate(BaseModel):
    quantity: float = Field(gt=0)


class AssetOut(BaseModel):
    id: int
    name: str
    symbol: str
    asset_type: str
    quantity: float
    last_price_krw: Optional[float]
    last_price_usd: Optional[float]
    last_updated: Optional[datetime]
    value_krw: Optional[float]


class SummaryOut(BaseModel):
    total_krw: float
    daily_change_krw: float
    assets: list[AssetOut]
    errors: Optional[list[str]] = None


class TotalPointOut(BaseModel):
    period_start: date
    period_end: date
    total_krw: float


class AssetColumnOut(BaseModel):
    id: int
    name: str
    symbol: str


class AssetValueOut(AssetColumnOut):
    total_krw: float


class TotalPointDetailOut(BaseModel):
    period_start: date
    period_end: date
    total_krw: float
    assets: list[AssetValueOut]


class TotalsDetailOut(BaseModel):
    assets: list[AssetColumnOut]
    points: list[TotalPointDetailOut]
