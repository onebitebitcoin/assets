from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from dataclasses import dataclass
from typing import Optional
from zoneinfo import ZoneInfo

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

FINNHUB_BASE_URL = "https://finnhub.io/api/v1"
NY_TZ = ZoneInfo("America/New_York")
SEOUL_TZ = ZoneInfo("Asia/Seoul")


def is_us_market_open() -> bool:
    """NYSE 정규 거래 시간 여부 확인: 미국 동부 9:30 AM - 4:00 PM (주말 제외)"""
    now_ny = datetime.now(NY_TZ)
    if now_ny.weekday() >= 5:  # 주말
        return False
    market_open = now_ny.replace(hour=9, minute=30, second=0, microsecond=0)
    market_close = now_ny.replace(hour=16, minute=0, second=0, microsecond=0)
    return market_open <= now_ny < market_close


@dataclass
class PriceResult:
    """가격 조회 결과"""
    price_krw: float
    source: str  # "finnhub" | "stooq" | "upbit" | "pykrx"
    price_usd: Optional[float] = None


@dataclass
class SnapshotPriceResult:
    """스냅샷용 가격 조회 결과"""
    price_krw: float
    source: str  # "finnhub" | "stooq" | "upbit" | "pykrx"
    price_usd: Optional[float] = None
    note: Optional[str] = None  # 가격 조회 방식 설명 (예: "전일 종가", "실시간")


async def fetch_usd_krw_rate(client: httpx.AsyncClient) -> float:
    """USD/KRW 환율 조회"""
    primary_url = "https://open.er-api.com/v6/latest/USD"
    try:
        response = await client.get(primary_url, timeout=10)
        response.raise_for_status()
        data = response.json()
        rates = data.get("rates")
        if not rates or "KRW" not in rates:
            logger.warning("Primary FX missing rates field: %s", str(data)[:200])
            raise ValueError("Missing rates from open.er-api.com")
        rate = float(rates["KRW"])
        logger.info("USD/KRW rate from open.er-api.com: %.2f", rate)
        return rate
    except Exception as exc:
        logger.warning("Primary FX source failed: %s", exc)

    # Fallback: frankfurter.app
    fallback_url = "https://api.frankfurter.app/latest"
    fallback_params = {"from": "USD", "to": "KRW"}
    fallback_response = await client.get(fallback_url, params=fallback_params, timeout=10)
    fallback_response.raise_for_status()
    fallback_data = fallback_response.json()
    rates = fallback_data.get("rates")
    if not rates or "KRW" not in rates:
        logger.warning("Fallback FX missing rates field: %s", str(fallback_data)[:200])
        raise ValueError("Missing rates from frankfurter.app")
    rate = float(rates["KRW"])
    logger.info("USD/KRW rate from frankfurter.app: %.2f", rate)
    return rate


async def _fetch_from_finnhub(symbol: str, client: httpx.AsyncClient) -> Optional[float]:
    """Finnhub API에서 미국주식 가격 조회

    Returns:
        USD 가격 또는 None (실패 시)
    """
    if not settings.finnhub_api_key:
        logger.debug("[Finnhub] API key not configured")
        return None

    url = f"{FINNHUB_BASE_URL}/quote"
    params = {"symbol": symbol, "token": settings.finnhub_api_key}

    try:
        response = await client.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        price = data.get("c", 0)
        if price == 0:
            logger.warning("[Finnhub] No data for %s (c=0)", symbol)
            return None

        price = float(price)
        logger.info("[Finnhub] %s: %.2f USD", symbol, price)
        return price
    except Exception as exc:
        logger.warning("[Finnhub] Failed for %s: %s", symbol, exc)
        return None


async def _fetch_from_stooq(symbol: str, client: httpx.AsyncClient) -> Optional[float]:
    """Stooq API에서 미국주식 가격 조회

    Returns:
        USD 가격 또는 None (실패 시)
    """
    url = "https://stooq.com/q/l/"
    stooq_symbol = f"{symbol.lower()}.us"
    params = {"s": stooq_symbol, "f": "sd2t2ohlcv", "h": "", "e": "csv"}

    try:
        response = await client.get(url, params=params, timeout=10)
        response.raise_for_status()
        text = response.text.strip()
        lines = text.splitlines()

        if len(lines) < 2:
            logger.warning("[Stooq] Insufficient data for %s: %s", symbol, text[:200])
            return None

        headers = [h.strip().lower() for h in lines[0].split(",")]
        values = [v.strip() for v in lines[1].split(",")]

        if len(headers) != len(values):
            logger.warning("[Stooq] Header/value mismatch for %s", symbol)
            return None

        data = dict(zip(headers, values))
        close_value = data.get("close")

        if not close_value or close_value == "N/D":
            logger.warning("[Stooq] N/D for %s", symbol)
            return None

        price = float(close_value)
        logger.info("[Stooq] %s: %.2f USD", symbol, price)
        return price
    except Exception as exc:
        logger.warning("[Stooq] Failed for %s: %s", symbol, exc)
        return None


async def fetch_stock_usd_price(symbol: str, client: httpx.AsyncClient) -> tuple[float, str]:
    """미국주식 USD 가격 조회 (Finnhub 1차, Stooq 2차)

    Returns:
        (USD 가격, 소스) 튜플

    Raises:
        ValueError: 모든 소스에서 실패 시
    """
    # 1차: Finnhub
    price = await _fetch_from_finnhub(symbol, client)
    if price is not None:
        return price, "finnhub"

    # 2차: Stooq
    price = await _fetch_from_stooq(symbol, client)
    if price is not None:
        return price, "stooq"

    raise ValueError(f"All price sources failed for {symbol}")


async def fetch_btc_krw_price(client: httpx.AsyncClient) -> float:
    """Upbit에서 BTC 원화 가격 조회"""
    url = "https://api.upbit.com/v1/ticker"
    params = {"markets": "KRW-BTC"}
    response = await client.get(url, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()
    price = float(data[0]["trade_price"])
    logger.info("[Upbit] BTC: %.0f KRW", price)
    return price


def _fetch_krx_close_price(symbol: str) -> float:
    """pykrx에서 한국주식 종가 조회 (동기 함수)"""
    from pykrx import stock

    today = date.today()
    for offset in range(0, 7):
        target_date = today - timedelta(days=offset)
        day = target_date.strftime("%Y%m%d")
        data = stock.get_market_ohlcv_by_date(day, day, symbol)
        if data is None or data.empty:
            continue
        close = data["종가"].iloc[-1]
        logger.info("[pykrx] %s: %.0f KRW", symbol, close)
        return float(close)
    raise ValueError(f"No price data for {symbol}")


def _fetch_krx_previous_close_price(symbol: str, reference_date: date) -> float:
    """pykrx에서 한국주식 전일 종가 조회 (동기 함수)

    Args:
        symbol: 종목 코드
        reference_date: 기준일 (한국 시간)

    Returns:
        기준일의 전일 종가 (1~7일 전까지 탐색)
    """
    from pykrx import stock

    # 기준일 전일부터 탐색 (주말/공휴일 고려)
    for offset in range(1, 8):
        target_date = reference_date - timedelta(days=offset)
        day = target_date.strftime("%Y%m%d")
        data = stock.get_market_ohlcv_by_date(day, day, symbol)
        if data is None or data.empty:
            continue
        close = data["종가"].iloc[-1]
        logger.info("[pykrx] %s previous close on %s: %.0f KRW", symbol, day, close)
        return float(close)
    raise ValueError(f"No previous close price data for {symbol}")


async def fetch_kr_stock_krw_price(symbol: str) -> float:
    """한국주식 원화 가격 조회"""
    # Remove exchange suffix (.KS, .KQ) if present
    clean_symbol = symbol.split('.')[0]
    price = await asyncio.to_thread(_fetch_krx_close_price, clean_symbol)
    return price


async def get_price_krw(symbol: str, asset_type: str) -> PriceResult:
    """자산 유형별 가격 조회

    Args:
        symbol: 자산 심볼
        asset_type: "stock", "kr_stock", "crypto" 중 하나

    Returns:
        PriceResult 객체
    """
    async with httpx.AsyncClient() as client:
        if asset_type == "stock":
            usd_price, source = await fetch_stock_usd_price(symbol, client)
            rate = await fetch_usd_krw_rate(client)
            return PriceResult(
                price_krw=usd_price * rate,
                source=source,
                price_usd=usd_price,
            )

        if asset_type == "kr_stock":
            krw_price = await fetch_kr_stock_krw_price(symbol)
            return PriceResult(price_krw=krw_price, source="pykrx")

        if asset_type == "crypto" and symbol.upper() == "BTC":
            btc_price = await fetch_btc_krw_price(client)
            return PriceResult(price_krw=btc_price, source="upbit")

    raise ValueError(f"Unsupported asset type or symbol: {asset_type}/{symbol}")


async def get_price_krw_batch(assets: list[tuple[str, str]]) -> dict[str, PriceResult]:
    """여러 자산의 가격을 병렬로 조회

    Args:
        assets: [(symbol, asset_type), ...] 형태의 리스트

    Returns:
        {symbol: PriceResult} 딕셔너리. 실패한 경우 해당 키 없음.
    """
    results: dict[str, PriceResult] = {}

    # 자산 유형별 분류
    us_stock_symbols: list[str] = []
    other_assets: list[tuple[str, str]] = []

    for symbol, asset_type in assets:
        if asset_type == "stock":
            us_stock_symbols.append(symbol)
        else:
            other_assets.append((symbol, asset_type))

    async with httpx.AsyncClient() as client:
        # 1. 미국 주식: 병렬 조회
        if us_stock_symbols:
            # 환율 먼저 조회
            try:
                rate = await fetch_usd_krw_rate(client)
            except Exception as exc:
                logger.error("Failed to fetch USD/KRW rate: %s", exc)
                rate = None

            if rate:
                async def fetch_single_stock(symbol: str) -> tuple[str, Optional[PriceResult]]:
                    # 1차: Finnhub
                    price = await _fetch_from_finnhub(symbol, client)
                    if price is not None:
                        return symbol, PriceResult(
                            price_krw=price * rate,
                            source="finnhub",
                            price_usd=price,
                        )
                    # 2차: Stooq
                    price = await _fetch_from_stooq(symbol, client)
                    if price is not None:
                        return symbol, PriceResult(
                            price_krw=price * rate,
                            source="stooq",
                            price_usd=price,
                        )
                    return symbol, None

                tasks = [fetch_single_stock(symbol) for symbol in us_stock_symbols]
                stock_results = await asyncio.gather(*tasks)

                for symbol, result in stock_results:
                    if result is not None:
                        results[symbol] = result
                    else:
                        logger.warning("All sources failed for %s", symbol)

        # 2. 기타 자산 (한국주식, 암호화폐): 개별 조회
        async def fetch_single_other(symbol: str, asset_type: str) -> tuple[str, Optional[PriceResult]]:
            try:
                if asset_type == "kr_stock":
                    krw_price = await fetch_kr_stock_krw_price(symbol)
                    return symbol, PriceResult(price_krw=krw_price, source="pykrx")
                elif asset_type == "crypto" and symbol.upper() == "BTC":
                    btc_price = await fetch_btc_krw_price(client)
                    return symbol, PriceResult(price_krw=btc_price, source="upbit")
                else:
                    return symbol, None
            except Exception as exc:
                logger.warning("Price fetch failed for %s: %s", symbol, exc)
                return symbol, None

        if other_assets:
            tasks = [fetch_single_other(symbol, asset_type) for symbol, asset_type in other_assets]
            other_results = await asyncio.gather(*tasks)
            for symbol, result in other_results:
                if result is not None:
                    results[symbol] = result

    # 결과 요약 로그
    source_counts: dict[str, int] = {}
    for r in results.values():
        source_counts[r.source] = source_counts.get(r.source, 0) + 1
    logger.info("Batch price fetch completed: %s", source_counts)

    return results


async def get_snapshot_prices(assets: list[tuple[str, str]]) -> dict[str, SnapshotPriceResult]:
    """스냅샷용 가격 조회 (자산 유형별 시간대 로직 적용)

    자산 유형별 가격 조회 방식:
    - kr_stock (한국 주식): 한국 시간 기준 전일 종가
    - crypto (암호화폐): 현재 가격 (24시간 거래)
    - stock (미국 주식): 장이 열려있으면 현재 가격, 닫혀있으면 마지막 종가

    Args:
        assets: [(symbol, asset_type), ...] 형태의 리스트

    Returns:
        {symbol: SnapshotPriceResult} 딕셔너리. 실패한 경우 해당 키 없음.
    """
    results: dict[str, SnapshotPriceResult] = {}
    today_kr = datetime.now(SEOUL_TZ).date()
    us_market_open = is_us_market_open()

    # 자산 유형별 분류
    kr_stock_symbols: list[str] = []
    us_stock_symbols: list[str] = []
    crypto_symbols: list[str] = []

    for symbol, asset_type in assets:
        if asset_type == "kr_stock":
            kr_stock_symbols.append(symbol)
        elif asset_type == "stock":
            us_stock_symbols.append(symbol)
        elif asset_type == "crypto":
            crypto_symbols.append(symbol)

    async with httpx.AsyncClient() as client:
        # 1. 한국 주식: 전일 종가 조회
        async def fetch_kr_stock_previous(symbol: str) -> tuple[str, Optional[SnapshotPriceResult]]:
            try:
                clean_symbol = symbol.split('.')[0]
                price = await asyncio.to_thread(
                    _fetch_krx_previous_close_price, clean_symbol, today_kr
                )
                return symbol, SnapshotPriceResult(
                    price_krw=price,
                    source="pykrx",
                    note="전일 종가",
                )
            except Exception as exc:
                logger.warning("[Snapshot] KR stock previous close failed for %s: %s", symbol, exc)
                return symbol, None

        # 2. 미국 주식: 장 열림 여부에 따라 현재 가격 또는 마지막 종가
        rate: Optional[float] = None
        if us_stock_symbols:
            try:
                rate = await fetch_usd_krw_rate(client)
            except Exception as exc:
                logger.error("[Snapshot] Failed to fetch USD/KRW rate: %s", exc)

        async def fetch_us_stock(symbol: str) -> tuple[str, Optional[SnapshotPriceResult]]:
            if rate is None:
                return symbol, None
            try:
                # Finnhub 1차, Stooq 2차
                price = await _fetch_from_finnhub(symbol, client)
                source = "finnhub"
                if price is None:
                    price = await _fetch_from_stooq(symbol, client)
                    source = "stooq"
                if price is None:
                    return symbol, None
                note = "실시간" if us_market_open else "마지막 종가"
                return symbol, SnapshotPriceResult(
                    price_krw=price * rate,
                    source=source,
                    price_usd=price,
                    note=note,
                )
            except Exception as exc:
                logger.warning("[Snapshot] US stock failed for %s: %s", symbol, exc)
                return symbol, None

        # 3. 암호화폐: 현재 가격
        async def fetch_crypto(symbol: str) -> tuple[str, Optional[SnapshotPriceResult]]:
            try:
                if symbol.upper() == "BTC":
                    price = await fetch_btc_krw_price(client)
                    return symbol, SnapshotPriceResult(
                        price_krw=price,
                        source="upbit",
                        note="실시간",
                    )
                return symbol, None
            except Exception as exc:
                logger.warning("[Snapshot] Crypto failed for %s: %s", symbol, exc)
                return symbol, None

        # 병렬 실행
        all_tasks = []
        all_tasks.extend([fetch_kr_stock_previous(s) for s in kr_stock_symbols])
        all_tasks.extend([fetch_us_stock(s) for s in us_stock_symbols])
        all_tasks.extend([fetch_crypto(s) for s in crypto_symbols])

        if all_tasks:
            task_results = await asyncio.gather(*all_tasks)
            for symbol, result in task_results:
                if result is not None:
                    results[symbol] = result

    # 결과 요약 로그
    source_counts: dict[str, int] = {}
    for r in results.values():
        source_counts[r.source] = source_counts.get(r.source, 0) + 1
    logger.info("[Snapshot] Price fetch completed: %s (US market open: %s)", source_counts, us_market_open)

    return results
