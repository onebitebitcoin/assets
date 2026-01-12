import httpx
import pytest

from backend.services import pricing
from backend.services.pricing import fetch_stock_usd_price


@pytest.mark.anyio
async def test_fetch_stock_usd_price_tsla():
    async with httpx.AsyncClient() as client:
        try:
            price = await fetch_stock_usd_price("TSLA", client)
        except httpx.HTTPStatusError as exc:
            if exc.response is not None and exc.response.status_code == 429:
                pytest.skip("Yahoo Finance rate limited (429).")
            raise

    assert price > 0


@pytest.mark.anyio
async def test_fetch_usd_krw_rate_primary():
    pricing._cache.clear()
    class DummyResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"rates": {"KRW": 1350.5}}

    class DummyClient:
        async def get(self, *_args, **_kwargs):
            return DummyResponse()

    rate = await pricing.fetch_usd_krw_rate(DummyClient())
    assert rate == 1350.5


@pytest.mark.anyio
async def test_get_price_krw_stock(monkeypatch):
    pricing._cache.clear()
    async def fake_stock_price(_symbol, _client):
        return 10.0

    async def fake_rate(_client):
        return 1200.0

    monkeypatch.setattr(pricing, "fetch_stock_usd_price", fake_stock_price)
    monkeypatch.setattr(pricing, "fetch_usd_krw_rate", fake_rate)

    result = await pricing.get_price_krw("AAPL", "stock")
    assert result.price_krw == 12000.0
    assert result.price_usd == 10.0


@pytest.mark.anyio
async def test_get_price_krw_btc(monkeypatch):
    pricing._cache.clear()
    async def fake_btc_price(_client):
        return 41000000.0

    monkeypatch.setattr(pricing, "fetch_btc_krw_price", fake_btc_price)
    result = await pricing.get_price_krw("BTC", "crypto")
    assert result.price_krw == 41000000.0
