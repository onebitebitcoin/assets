from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Annotated

# 로깅 설정을 다른 모듈 import 전에 먼저 수행
import os
_log_dir = os.path.dirname(os.path.abspath(__file__))
_log_file = os.path.join(_log_dir, "debug.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[
        logging.FileHandler(_log_file),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from sqlalchemy import select, and_, text
from sqlalchemy.orm import Session
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from .auth import hash_password, verify_password, create_token
from .config import settings
from .db import Base, engine, get_db, SessionLocal
from .models import User, Asset, DailyTotal, DailyAssetTotal
from .schemas import (
    UserCreate,
    UserLogin,
    Token,
    AssetCreate,
    AssetUpdate,
    AssetOut,
    AssetRefreshOut,
    SummaryOut,
    TotalPointOut,
    AssetColumnOut,
    AssetValueOut,
    TotalPointDetailOut,
    TotalsDetailOut,
)
from .services.pricing import get_price_krw, get_price_krw_batch, get_snapshot_prices, lookup_symbol
SEOUL_TZ = ZoneInfo("Asia/Seoul")


def now_seoul() -> datetime:
    return datetime.now(tz=SEOUL_TZ)


def today_seoul() -> date:
    return datetime.now(tz=SEOUL_TZ).date()

Base.metadata.create_all(bind=engine)
def ensure_assets_columns():
    with engine.begin() as conn:
        columns = [row[1] for row in conn.execute(text("PRAGMA table_info(assets)"))]
        if "last_price_usd" not in columns:
            conn.execute(text("ALTER TABLE assets ADD COLUMN last_price_usd FLOAT"))
        if "last_source" not in columns:
            conn.execute(text("ALTER TABLE assets ADD COLUMN last_source VARCHAR(50)"))


def ensure_daily_totals_columns():
    with engine.begin() as conn:
        columns = [row[1] for row in conn.execute(text("PRAGMA table_info(daily_totals)"))]
        if "snapshot_at" not in columns:
            conn.execute(text("ALTER TABLE daily_totals ADD COLUMN snapshot_at DATETIME"))


ensure_assets_columns()
ensure_daily_totals_columns()

app = FastAPI()
security = HTTPBearer()
scheduler = BackgroundScheduler(timezone=ZoneInfo("Asia/Seoul"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:50001",
        "http://127.0.0.1:50001",
        "https://ubuntu.golden-ghost.ts.net",
        "https://ubuntu.golden-ghost.ts.net:8443",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        username = payload.get("sub")
    except JWTError as exc:
        logger.exception("JWT decode failed")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


@app.exception_handler(Exception)
async def unhandled_exception_handler(_, exc: Exception):
    logger.exception("Unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/register", response_model=Token)
def register(payload: UserCreate, db: Annotated[Session, Depends(get_db)]):
    existing = db.scalar(select(User).where(User.username == payload.username))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    user = User(username=payload.username, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    return Token(access_token=create_token(user.username))


@app.post("/login", response_model=Token)
def login(payload: UserLogin, db: Annotated[Session, Depends(get_db)]):
    user = db.scalar(select(User).where(User.username == payload.username))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return Token(access_token=create_token(user.username))


@app.post("/refresh-token", response_model=Token)
def refresh_token(user: Annotated[User, Depends(get_current_user)]):
    """현재 토큰이 유효한 경우 새 토큰을 발급합니다."""
    return Token(access_token=create_token(user.username))


@app.get("/assets", response_model=list[AssetOut])
def list_assets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    assets = db.scalars(select(Asset).where(Asset.user_id == user.id)).all()
    return [asset_to_out(asset) for asset in assets]


@app.get("/lookup")
async def lookup_stock_symbol(
    symbol: str,
    asset_type: str = "stock",
    user: Annotated[User, Depends(get_current_user)] = None,
):
    """심볼로 종목명 조회

    Args:
        symbol: 종목 심볼 (예: AAPL, 005930)
        asset_type: "stock" (미국주식) 또는 "kr_stock" (한국주식)

    Returns:
        {"symbol": "AAPL", "name": "Apple Inc", "asset_type": "stock"}
    """
    if asset_type not in {"stock", "kr_stock"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="asset_type must be 'stock' or 'kr_stock'"
        )

    result = await lookup_symbol(symbol, asset_type)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Symbol not found: {symbol}"
        )

    return {"symbol": result.symbol, "name": result.name, "asset_type": result.asset_type}


@app.post("/assets", response_model=AssetOut)
async def add_asset(
    payload: AssetCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    asset_type_raw = payload.asset_type.strip()
    asset_type = asset_type_raw.lower()
    if asset_type not in {"stock", "crypto"} and not asset_type_raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Asset type required")
    symbol = payload.symbol.upper()
    if asset_type == "crypto" and symbol != "BTC":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only BTC is supported")
    asset = Asset(
        user_id=user.id,
        name=payload.name,
        symbol=symbol,
        asset_type=asset_type if asset_type in {"stock", "crypto"} else asset_type_raw,
        quantity=payload.quantity,
    )
    if asset_type == "crypto" and symbol == "BTC":
        price = await get_price_krw(symbol, asset_type)
        asset.last_price_krw = price.price_krw
        asset.last_price_usd = price.price_usd
        asset.last_updated = now_seoul()
    elif asset_type == "kr_stock":
        price = await get_price_krw(symbol, asset_type)
        asset.last_price_krw = price.price_krw
        asset.last_updated = now_seoul()
    else:
        if payload.price_krw is not None:
            asset.last_price_krw = payload.price_krw
        if payload.price_usd is not None:
            asset.last_price_usd = payload.price_usd
        if asset.last_price_krw is not None or asset.last_price_usd is not None:
            asset.last_updated = now_seoul()
    if asset_type not in {"stock", "crypto", "kr_stock"} and asset.last_price_krw is None:
        asset.last_price_krw = 0.0
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset_to_out(asset)


@app.delete("/assets/{asset_id}")
def delete_asset(
    asset_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    asset = db.scalar(select(Asset).where(and_(Asset.id == asset_id, Asset.user_id == user.id)))
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    db.delete(asset)
    db.commit()
    return {"ok": True}


@app.put("/assets/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: int,
    payload: AssetUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    asset = db.scalar(select(Asset).where(and_(Asset.id == asset_id, Asset.user_id == user.id)))
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    if payload.name is not None:
        asset.name = payload.name
    if payload.symbol is not None:
        asset.symbol = payload.symbol
    if payload.asset_type is not None:
        asset.asset_type = payload.asset_type
    asset.quantity = payload.quantity
    if payload.price_krw is not None:
        asset.last_price_krw = payload.price_krw
        asset.last_updated = now_seoul()
    db.commit()
    db.refresh(asset)
    return asset_to_out(asset)


@app.post("/assets/{asset_id}/refresh", response_model=AssetRefreshOut)
async def refresh_single_asset(
    asset_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    asset = db.scalar(select(Asset).where(and_(Asset.id == asset_id, Asset.user_id == user.id)))
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    asset_type = asset.asset_type.lower()
    if asset_type not in {"stock", "crypto", "kr_stock"}:
        if asset.last_price_krw is None:
            asset.last_price_krw = 0.0
        asset.last_updated = now_seoul()
        asset.last_source = "직접입력"
    else:
        try:
            price = await get_price_krw(asset.symbol, asset_type)
            asset.last_price_krw = price.price_krw
            asset.last_price_usd = price.price_usd
            asset.last_updated = now_seoul()
            asset.last_source = price.source
        except Exception as exc:
            logger.exception("Price fetch failed for %s", asset.symbol)
            api_name = {"stock": "미국주식 API", "kr_stock": "국내주식 API", "crypto": "비트코인 API"}.get(asset_type, asset_type)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"{asset.symbol} 가격 조회 실패 ({api_name})"
            )

    db.commit()
    db.refresh(asset)
    return AssetRefreshOut(**asset_to_out(asset).model_dump())


@app.post("/refresh", response_model=SummaryOut)
async def refresh_prices(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    assets = db.scalars(select(Asset).where(Asset.user_id == user.id)).all()
    total = 0.0
    asset_totals: list[tuple[Asset, float]] = []
    errors: list[str] = []

    # 외부 API 호출이 필요한 자산과 아닌 자산 분류
    fetch_targets: list[tuple[Asset, str, str]] = []  # (asset, symbol, asset_type)
    for asset in assets:
        asset_type = asset.asset_type.lower()
        if asset_type not in {"stock", "crypto", "kr_stock"}:
            # 직접입력 자산: 외부 API 호출 불필요
            if asset.last_price_krw is None:
                asset.last_price_krw = 0.0
            total += asset.last_price_krw * asset.quantity
            asset_totals.append((asset, asset.last_price_krw * asset.quantity))
            asset.last_source = "직접입력"
        else:
            fetch_targets.append((asset, asset.symbol, asset_type))

    # 병렬로 가격 조회
    if fetch_targets:
        batch_input = [(symbol, asset_type) for _, symbol, asset_type in fetch_targets]
        price_results = await get_price_krw_batch(batch_input)

        now = now_seoul()
        for asset, symbol, asset_type in fetch_targets:
            price = price_results.get(symbol)
            if price:
                asset.last_price_krw = price.price_krw
                asset.last_price_usd = price.price_usd
                asset.last_updated = now
                asset.last_source = price.source
                total += price.price_krw * asset.quantity
                asset_totals.append((asset, price.price_krw * asset.quantity))
            else:
                api_name = {"stock": "미국주식 API", "kr_stock": "국내주식 API", "crypto": "비트코인 API"}.get(asset_type, asset_type)
                errors.append(f"{symbol} 가격 조회 실패 ({api_name})")
                if asset.last_price_krw is not None:
                    total += asset.last_price_krw * asset.quantity
                    asset_totals.append((asset, asset.last_price_krw * asset.quantity))
                else:
                    asset_totals.append((asset, 0.0))

    today = today_seoul()
    upsert_daily_total(db, user.id, total, today)
    for asset, total_krw in asset_totals:
        upsert_daily_asset_total(db, user.id, asset.id, total_krw, today)
    db.commit()

    daily_change = compute_daily_change(user.id, db)
    error_payload = errors if errors else None

    # 마지막 갱신 시간
    last_updated_times = [a.last_updated for a in assets if a.last_updated]
    last_refreshed = max(last_updated_times) if last_updated_times else None

    # 다음 갱신 예정 시간 (30분 간격)
    next_refresh_at = None
    if last_refreshed:
        next_refresh_at = last_refreshed + timedelta(minutes=30)

    # AssetRefreshOut으로 변환 (source는 asset_to_out에서 포함됨)
    asset_outs = [AssetRefreshOut(**asset_to_out(a).model_dump()) for a in assets]

    return SummaryOut(
        total_krw=total,
        daily_change_krw=daily_change,
        assets=asset_outs,
        errors=error_payload,
        last_refreshed=last_refreshed,
        next_refresh_at=next_refresh_at,
    )



@app.get("/summary", response_model=SummaryOut)
def get_summary(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    assets = db.scalars(select(Asset).where(Asset.user_id == user.id)).all()
    total = sum((a.last_price_krw or 0) * a.quantity for a in assets)
    daily_change = compute_daily_change(user.id, db)

    # 마지막 갱신 시간
    last_updated_times = [a.last_updated for a in assets if a.last_updated]
    last_refreshed = max(last_updated_times) if last_updated_times else None

    # 다음 갱신 예정 시간 (30분 간격)
    next_refresh_at = None
    if last_refreshed:
        next_refresh_at = last_refreshed + timedelta(minutes=30)

    # GET /summary는 저장된 데이터 반환 (source는 last_source에서 가져옴)
    asset_outs = [AssetRefreshOut(**asset_to_out(a).model_dump()) for a in assets]

    return SummaryOut(
        total_krw=total,
        daily_change_krw=daily_change,
        assets=asset_outs,
        errors=None,
        last_refreshed=last_refreshed,
        next_refresh_at=next_refresh_at,
    )


@app.get("/totals", response_model=list[TotalPointOut])
def get_totals(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    period: str = "daily",
    limit: int = 12,
    offset: int = 0,
):
    period = period.lower()
    if period not in {"daily", "weekly", "monthly"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid period")
    limit = max(1, min(limit, 120))
    offset = max(0, offset)
    rows = db.scalars(
        select(DailyTotal)
        .where(DailyTotal.user_id == user.id)
        .order_by(DailyTotal.day.desc())
    ).all()
    points = build_period_points(rows, period)
    return points[offset : offset + limit]


@app.get("/totals/detail", response_model=TotalsDetailOut)
def get_totals_detail(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    period: str = "daily",
    limit: int = 10,
    offset: int = 0,
):
    period = period.lower()
    if period not in {"daily", "weekly", "monthly"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid period")
    limit = max(1, min(limit, 120))
    offset = max(0, offset)
    assets = db.scalars(select(Asset).where(Asset.user_id == user.id)).all()
    asset_columns = [AssetColumnOut(id=a.id, name=a.name, symbol=a.symbol) for a in assets]
    asset_ids = [asset.id for asset in assets]
    rows = db.scalars(
        select(DailyTotal)
        .where(DailyTotal.user_id == user.id)
        .order_by(DailyTotal.day.desc())
    ).all()
    points_info = build_period_detail_points(rows, period)
    sliced = points_info[offset : offset + limit]
    points: list[TotalPointDetailOut] = []
    for info in sliced:
        asset_rows = []
        if asset_ids:
            asset_rows = db.scalars(
                select(DailyAssetTotal).where(
                    and_(
                        DailyAssetTotal.user_id == user.id,
                        DailyAssetTotal.day == info["day"],
                        DailyAssetTotal.asset_id.in_(asset_ids),
                    )
                )
            ).all()
        asset_map = {row.asset_id: row.total_krw for row in asset_rows}
        asset_values = [
            AssetValueOut(
                id=asset.id,
                name=asset.name,
                symbol=asset.symbol,
                total_krw=asset_map.get(asset.id, 0.0),
            )
            for asset in assets
        ]
        points.append(
            TotalPointDetailOut(
                period_start=info["period_start"],
                period_end=info["period_end"],
                total_krw=info["total_krw"],
                assets=asset_values,
                snapshot_at=info.get("snapshot_at"),
            )
        )
    return TotalsDetailOut(assets=asset_columns, points=points)


@app.get("/weekly-totals", response_model=list[TotalPointOut])
def get_weekly_totals(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = 12,
    offset: int = 0,
):
    rows = db.scalars(
        select(DailyTotal)
        .where(DailyTotal.user_id == user.id)
        .order_by(DailyTotal.day.desc())
    ).all()
    points = build_period_points(rows, "weekly")
    limit = max(1, min(limit, 120))
    offset = max(0, offset)
    return points[offset : offset + limit]


@app.post("/totals/snapshot", response_model=TotalPointOut)
async def snapshot_totals(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """스냅샷 저장 (자산 유형별 시간대 로직 적용)

    - 한국 주식 (kr_stock): 한국 시간 기준 전일 종가
    - 비트코인 (crypto): 현재 가격 (24시간 거래)
    - 미국 주식 (stock): 장이 열려있으면 현재 가격, 닫혀있으면 마지막 종가
    """
    assets = db.scalars(select(Asset).where(Asset.user_id == user.id)).all()
    today = today_seoul()
    total = 0.0
    asset_totals: list[tuple[Asset, float]] = []

    # 외부 API 호출이 필요한 자산과 아닌 자산 분류
    fetch_targets: list[tuple[Asset, str, str]] = []  # (asset, symbol, asset_type)
    for asset in assets:
        asset_type = asset.asset_type.lower()
        if asset_type not in {"stock", "crypto", "kr_stock"}:
            # 직접입력 자산: 외부 API 호출 불필요
            if asset.last_price_krw is None:
                asset.last_price_krw = 0.0
            asset_value = asset.last_price_krw * asset.quantity
            total += asset_value
            asset_totals.append((asset, asset_value))
        else:
            fetch_targets.append((asset, asset.symbol, asset_type))

    # 스냅샷용 가격 조회 (시간대별 로직 적용)
    if fetch_targets:
        batch_input = [(symbol, asset_type) for _, symbol, asset_type in fetch_targets]
        price_results = await get_snapshot_prices(batch_input)

        now = now_seoul()
        for asset, symbol, asset_type in fetch_targets:
            price = price_results.get(symbol)
            if price:
                asset.last_price_krw = price.price_krw
                asset.last_price_usd = price.price_usd
                asset.last_updated = now
                asset.last_source = price.source
                asset_value = price.price_krw * asset.quantity
                total += asset_value
                asset_totals.append((asset, asset_value))
                logger.info(
                    "[Snapshot] %s: %.0f KRW (%s)",
                    symbol, price.price_krw, price.note
                )
            else:
                # 가격 조회 실패 시 기존 가격 사용
                if asset.last_price_krw is not None:
                    asset_value = asset.last_price_krw * asset.quantity
                    total += asset_value
                    asset_totals.append((asset, asset_value))
                else:
                    asset_totals.append((asset, 0.0))
                logger.warning("[Snapshot] Price fetch failed for %s, using existing price", symbol)

    # 스냅샷 저장
    snapshot_time = now_seoul()
    upsert_daily_total(db, user.id, total, today, snapshot_at=snapshot_time)
    for asset, total_krw in asset_totals:
        upsert_daily_asset_total(db, user.id, asset.id, total_krw, today)
    db.commit()

    logger.info("[Snapshot] Saved for user %d: %.0f KRW on %s at %s", user.id, total, today, snapshot_time)
    return TotalPointOut(period_start=today, period_end=today, total_krw=total)


def compute_daily_change(user_id: int, db: Session) -> float:
    today = today_seoul()
    yesterday = today - timedelta(days=1)
    today_total = db.scalar(
        select(DailyTotal.total_krw).where(
            and_(DailyTotal.user_id == user_id, DailyTotal.day == today)
        )
    )
    yesterday_total = db.scalar(
        select(DailyTotal.total_krw).where(
            and_(DailyTotal.user_id == user_id, DailyTotal.day == yesterday)
        )
    )
    if today_total is None:
        return 0.0
    return today_total - (yesterday_total or 0.0)


def compute_total_for_user(user_id: int, db: Session) -> float:
    assets = db.scalars(select(Asset).where(Asset.user_id == user_id)).all()
    return sum((asset.last_price_krw or 0) * asset.quantity for asset in assets)


def compute_asset_totals(user_id: int, db: Session) -> list[tuple[Asset, float]]:
    assets = db.scalars(select(Asset).where(Asset.user_id == user_id)).all()
    totals: list[tuple[Asset, float]] = []
    for asset in assets:
        asset_type = asset.asset_type.lower()
        if asset_type not in {"stock", "crypto", "kr_stock"} and asset.last_price_krw is None:
            asset.last_price_krw = 0.0
        totals.append((asset, (asset.last_price_krw or 0) * asset.quantity))
    return totals


def upsert_daily_total(db: Session, user_id: int, total: float, day: date, snapshot_at: datetime | None = None) -> None:
    existing = db.scalar(
        select(DailyTotal).where(and_(DailyTotal.user_id == user_id, DailyTotal.day == day))
    )
    if existing:
        existing.total_krw = total
        if snapshot_at:
            existing.snapshot_at = snapshot_at
    else:
        db.add(DailyTotal(user_id=user_id, day=day, total_krw=total, snapshot_at=snapshot_at))


def upsert_daily_asset_total(
    db: Session, user_id: int, asset_id: int, total: float, day: date
) -> None:
    existing = db.scalar(
        select(DailyAssetTotal).where(
            and_(
                DailyAssetTotal.user_id == user_id,
                DailyAssetTotal.asset_id == asset_id,
                DailyAssetTotal.day == day,
            )
        )
    )
    if existing:
        existing.total_krw = total
    else:
        db.add(DailyAssetTotal(user_id=user_id, asset_id=asset_id, day=day, total_krw=total))


def build_period_points(rows: list[DailyTotal], period: str) -> list[TotalPointOut]:
    points: list[TotalPointOut] = []
    seen: set[tuple[int, int]] = set()
    for row in rows:
        if period == "daily":
            points.append(
                TotalPointOut(period_start=row.day, period_end=row.day, total_krw=row.total_krw)
            )
            continue

        if period == "weekly":
            iso_year, iso_week, _ = row.day.isocalendar()
            key = (iso_year, iso_week)
            period_start = row.day - timedelta(days=row.day.weekday())
            period_end = period_start + timedelta(days=6)
        else:
            key = (row.day.year, row.day.month)
            period_start = date(row.day.year, row.day.month, 1)
            last_day = calendar.monthrange(row.day.year, row.day.month)[1]
            period_end = date(row.day.year, row.day.month, last_day)

        if key in seen:
            continue
        seen.add(key)
        points.append(
            TotalPointOut(period_start=period_start, period_end=period_end, total_krw=row.total_krw)
        )
    return points


def build_period_detail_points(rows: list[DailyTotal], period: str) -> list[dict]:
    points: list[dict] = []
    seen: set[tuple[int, int] | date] = set()
    for row in rows:
        if period == "daily":
            key: tuple[int, int] | date = row.day
            period_start = row.day
            period_end = row.day
        elif period == "weekly":
            iso_year, iso_week, _ = row.day.isocalendar()
            key = (iso_year, iso_week)
            period_start = row.day - timedelta(days=row.day.weekday())
            period_end = period_start + timedelta(days=6)
        else:
            key = (row.day.year, row.day.month)
            period_start = date(row.day.year, row.day.month, 1)
            last_day = calendar.monthrange(row.day.year, row.day.month)[1]
            period_end = date(row.day.year, row.day.month, last_day)

        if key in seen:
            continue
        seen.add(key)
        points.append(
            {
                "day": row.day,
                "period_start": period_start,
                "period_end": period_end,
                "total_krw": row.total_krw,
                "snapshot_at": row.snapshot_at,
            }
        )
    return points


def run_daily_snapshot():
    db = SessionLocal()
    try:
        users = db.scalars(select(User)).all()
        today = today_seoul()
        for user in users:
            asset_totals = compute_asset_totals(user.id, db)
            total = sum(total for _, total in asset_totals)
            upsert_daily_total(db, user.id, total, today)
            for asset, total_krw in asset_totals:
                upsert_daily_asset_total(db, user.id, asset.id, total_krw, today)
        db.commit()
    finally:
        db.close()


async def refresh_all_asset_prices():
    """모든 사용자의 자산 가격을 일괄 갱신 (중복 심볼은 1회만 조회)"""
    db = SessionLocal()
    try:
        all_assets = db.scalars(select(Asset)).all()
        if not all_assets:
            logger.info("No assets to refresh")
            return

        # 중복 제거: (symbol, asset_type) 기준
        unique_symbols: dict[tuple[str, str], list[Asset]] = {}
        for asset in all_assets:
            asset_type = asset.asset_type.lower()
            if asset_type not in {"stock", "crypto", "kr_stock"}:
                continue  # 직접입력 자산은 스킵
            key = (asset.symbol, asset_type)
            if key not in unique_symbols:
                unique_symbols[key] = []
            unique_symbols[key].append(asset)

        if not unique_symbols:
            logger.info("No external assets to refresh")
            return

        # 병렬 가격 조회
        batch_input = list(unique_symbols.keys())
        price_results = await get_price_krw_batch(batch_input)

        # 모든 관련 자산에 가격 적용
        now = now_seoul()
        for (symbol, _), assets in unique_symbols.items():
            price = price_results.get(symbol)
            if price:
                for asset in assets:
                    asset.last_price_krw = price.price_krw
                    asset.last_price_usd = price.price_usd
                    asset.last_updated = now

        db.commit()
        logger.info("Scheduled price refresh completed: %d symbols", len(price_results))
    except Exception as exc:
        logger.exception("Scheduled price refresh failed: %s", exc)
        db.rollback()
    finally:
        db.close()


def run_scheduled_price_refresh():
    """스케줄러용 동기 래퍼"""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    loop.run_until_complete(refresh_all_asset_prices())


def asset_to_out(asset: Asset) -> AssetOut:
    value = None
    if asset.last_price_krw is not None:
        value = asset.last_price_krw * asset.quantity
    return AssetOut(
        id=asset.id,
        name=asset.name,
        symbol=asset.symbol,
        asset_type=asset.asset_type,
        quantity=asset.quantity,
        last_price_krw=asset.last_price_krw,
        last_price_usd=asset.last_price_usd,
        last_updated=asset.last_updated,
        value_krw=value,
        source=asset.last_source,
    )


@app.on_event("startup")
def start_scheduler():
    if not scheduler.get_jobs():
        # 기존: 자정 스냅샷
        scheduler.add_job(run_daily_snapshot, CronTrigger(hour=0, minute=0))

        # 신규: 30분마다 가격 갱신
        scheduler.add_job(
            run_scheduled_price_refresh,
            IntervalTrigger(minutes=30),
            id="price_refresh",
            name="30분마다 자산 가격 갱신",
            replace_existing=True
        )
    if not scheduler.running:
        scheduler.start()


@app.on_event("shutdown")
def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown()
