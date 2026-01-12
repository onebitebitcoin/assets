from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, Date
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    assets: Mapped[list["Asset"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    totals: Mapped[list["DailyTotal"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    symbol: Mapped[str] = mapped_column(String(20))
    asset_type: Mapped[str] = mapped_column(String(10))  # stock | crypto
    quantity: Mapped[float] = mapped_column(Float)
    last_price_krw: Mapped[Optional[float]] = mapped_column(Float, default=None)
    last_price_usd: Mapped[Optional[float]] = mapped_column(Float, default=None)
    last_updated: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)

    user: Mapped[User] = relationship(back_populates="assets")


class DailyTotal(Base):
    __tablename__ = "daily_totals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    day: Mapped[date] = mapped_column(Date)
    total_krw: Mapped[float] = mapped_column(Float)

    user: Mapped[User] = relationship(back_populates="totals")


class DailyAssetTotal(Base):
    __tablename__ = "daily_asset_totals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"), index=True)
    day: Mapped[date] = mapped_column(Date)
    total_krw: Mapped[float] = mapped_column(Float)
