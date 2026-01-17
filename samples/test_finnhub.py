"""
Finnhub API 테스트 스크립트
- 단일 종목 조회
- 여러 종목 병렬 조회 (asyncio)
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

# backend/.env 파일 로드
env_path = Path(__file__).parent.parent / "backend" / ".env"
load_dotenv(env_path)

FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY")
FINNHUB_BASE_URL = "https://finnhub.io/api/v1"


def check_api_key():
    """API 키 확인"""
    if not FINNHUB_API_KEY:
        print("오류: FINNHUB_API_KEY가 설정되지 않았습니다.")
        print(f"backend/.env 파일에 FINNHUB_API_KEY를 추가해주세요.")
        print(f"확인한 경로: {env_path}")
        sys.exit(1)
    print(f"API 키 로드 완료: {FINNHUB_API_KEY[:8]}...")


async def fetch_single_quote(symbol: str, client: httpx.AsyncClient) -> Optional[dict]:
    """단일 종목 가격 조회"""
    url = f"{FINNHUB_BASE_URL}/quote"
    params = {"symbol": symbol, "token": FINNHUB_API_KEY}

    try:
        response = await client.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        # 유효한 응답인지 확인 (c=0이면 데이터 없음)
        if data.get("c", 0) == 0:
            print(f"[{symbol}] 데이터 없음 (시장 마감 또는 잘못된 심볼)")
            return None

        return {
            "symbol": symbol,
            "current_price": data.get("c"),      # 현재 가격
            "change": data.get("d"),             # 변동가
            "change_percent": data.get("dp"),    # 변동률(%)
            "high": data.get("h"),               # 당일 고가
            "low": data.get("l"),                # 당일 저가
            "open": data.get("o"),               # 시가
            "prev_close": data.get("pc"),        # 전일 종가
            "timestamp": data.get("t"),          # 타임스탬프
        }
    except httpx.HTTPStatusError as e:
        print(f"[{symbol}] HTTP 오류: {e.response.status_code}")
        return None
    except Exception as e:
        print(f"[{symbol}] 오류: {e}")
        return None


async def fetch_multiple_quotes(symbols: list[str]) -> dict[str, dict]:
    """
    여러 종목 가격을 병렬로 조회

    Finnhub은 배치 API를 지원하지 않으므로 asyncio로 병렬 요청
    """
    results = {}

    async with httpx.AsyncClient() as client:
        tasks = [fetch_single_quote(symbol, client) for symbol in symbols]
        responses = await asyncio.gather(*tasks)

        for response in responses:
            if response:
                results[response["symbol"]] = response

    return results


def print_quote(quote: dict):
    """주식 정보 출력"""
    print(f"\n{'='*50}")
    print(f"  {quote['symbol']}")
    print(f"{'='*50}")
    print(f"  현재 가격:   ${quote['current_price']:.2f}")
    print(f"  변동:       ${quote['change']:+.2f} ({quote['change_percent']:+.2f}%)")
    print(f"  시가:       ${quote['open']:.2f}")
    print(f"  고가:       ${quote['high']:.2f}")
    print(f"  저가:       ${quote['low']:.2f}")
    print(f"  전일 종가:  ${quote['prev_close']:.2f}")


async def main():
    check_api_key()

    # 테스트할 종목들
    symbols = ["TSLA", "META", "AAPL", "MSFT", "NVDA", "GOOG"]

    print("\n" + "=" * 60)
    print("  Finnhub API 테스트 - 여러 종목 병렬 조회")
    print("=" * 60)
    print(f"\n조회할 종목: {', '.join(symbols)}")

    # 여러 종목 병렬 조회
    print("\n[병렬 조회 시작...]")
    results = await fetch_multiple_quotes(symbols)

    if not results:
        print("\n조회된 데이터가 없습니다.")
        return

    # 결과 출력
    print(f"\n총 {len(results)}개 종목 조회 성공:")
    for symbol in symbols:
        if symbol in results:
            print_quote(results[symbol])

    # 요약
    print("\n" + "=" * 60)
    print("  요약")
    print("=" * 60)
    print(f"  {'종목':<8} {'현재가':>12} {'변동률':>10}")
    print(f"  {'-'*8} {'-'*12} {'-'*10}")
    for symbol in symbols:
        if symbol in results:
            q = results[symbol]
            print(f"  {symbol:<8} ${q['current_price']:>10.2f} {q['change_percent']:>+9.2f}%")


if __name__ == "__main__":
    asyncio.run(main())
