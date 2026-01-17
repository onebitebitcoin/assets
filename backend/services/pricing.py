from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from dataclasses import dataclass
from typing import Optional

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

FINNHUB_BASE_URL = "https://finnhub.io/api/v1"


@dataclass
class PriceResult:
    """가격 조회 결과"""
    price_krw: float
    source: str  # "finnhub" | "stooq" | "upbit" | "pykrx"
    price_usd: Optional[float] = None


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
