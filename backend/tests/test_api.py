import importlib
import os
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("JWT_SECRET", "testsecret")
    monkeypatch.setenv("JWT_EXP_MINUTES", "10")

    import backend.config as config
    import backend.db as db
    import backend.models as models
    import backend.main as main

    importlib.reload(config)
    importlib.reload(db)
    importlib.reload(models)
    importlib.reload(main)

    return TestClient(main.app)


def register_and_login(client):
    res = client.post("/register", json={"username": "test", "password": "test"})
    assert res.status_code == 200
    token = res.json()["access_token"]
    return token


def test_register_login_flow(client):
    token = register_and_login(client)
    assert token

    res = client.post("/login", json={"username": "test", "password": "test"})
    assert res.status_code == 200


def test_asset_crud_and_summary(client, monkeypatch):
    token = register_and_login(client)

    async def fake_price(symbol, asset_type):
        class Price:
            price_krw = 1000.0
            price_usd = 1.0
            source = "yahoo"
            price_change_pct = 1.5

        return Price()

    async def fake_price_batch(assets):
        class Price:
            price_krw = 1000.0
            price_usd = 1.0
            source = "yahoo"
            price_change_pct = 1.5
        return {symbol: Price() for symbol, _ in assets}

    monkeypatch.setattr("backend.main.get_price_krw", fake_price)
    monkeypatch.setattr("backend.main.get_price_krw_batch", fake_price_batch)

    res = client.post(
        "/assets",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Apple", "symbol": "AAPL", "asset_type": "stock", "quantity": 2},
    )
    assert res.status_code == 200

    res = client.post(
        "/refresh",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["total_krw"] == 2000.0
    assert len(data["assets"]) == 1

    asset_id = data["assets"][0]["id"]
    res = client.delete(
        f"/assets/{asset_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200


def test_update_asset_quantity(client):
    token = register_and_login(client)
    res = client.post(
        "/assets",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Apple", "symbol": "AAPL", "asset_type": "stock", "quantity": 2},
    )
    assert res.status_code == 200
    asset_id = res.json()["id"]

    res = client.put(
        f"/assets/{asset_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"quantity": 5},
    )
    assert res.status_code == 200
    assert res.json()["quantity"] == 5


def test_custom_asset_add(client):
    token = register_and_login(client)
    res = client.post(
        "/assets",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "예금", "symbol": "예금", "asset_type": "예금", "quantity": 3},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["asset_type"] == "예금"
    assert data["last_price_krw"] == 0.0
    assert data["value_krw"] == 0.0


def test_btc_add_uses_upbit_price(client, monkeypatch):
    token = register_and_login(client)

    async def fake_price(_symbol, _asset_type):
        class Price:
            price_krw = 42000000.0
            price_usd = None

        return Price()

    monkeypatch.setattr("backend.main.get_price_krw", fake_price)

    res = client.post(
        "/assets",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Bitcoin", "symbol": "BTC", "asset_type": "crypto", "quantity": 1},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["last_price_krw"] == 42000000.0


def test_kr_stock_add_uses_pykrx_price(client, monkeypatch):
    token = register_and_login(client)

    async def fake_price(_symbol, _asset_type):
        class Price:
            price_krw = 73000.0
            price_usd = None

        return Price()

    monkeypatch.setattr("backend.main.get_price_krw", fake_price)

    res = client.post(
        "/assets",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Samsung", "symbol": "005930", "asset_type": "kr_stock", "quantity": 1},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["last_price_krw"] == 73000.0


def test_cash_asset_add(client):
    token = register_and_login(client)
    res = client.post(
        "/assets",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "현금", "symbol": "CASH", "asset_type": "cash", "quantity": 5},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["asset_type"] == "cash"
    assert data["last_price_krw"] == 0.0
    assert data["value_krw"] == 0.0


def test_daily_totals_and_pagination(client):
    token = register_and_login(client)

    res = client.post(
        "/assets",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "예금", "symbol": "예금", "asset_type": "예금", "quantity": 2},
    )
    assert res.status_code == 200
    asset_id = res.json()["id"]

    import backend.main as main

    db = main.SessionLocal()
    try:
        user = db.scalar(select(main.User).where(main.User.username == "test"))
        assert user
        today = date.today()
        for offset in range(3):
            day = today - timedelta(days=offset)
            main.upsert_daily_total(db, user.id, 10000.0 * (offset + 1), day)
            main.upsert_daily_asset_total(db, user.id, asset_id, 20000.0 * (offset + 1), day)
        db.commit()
    finally:
        db.close()

    res = client.get(
        "/totals?period=daily&limit=2&offset=0",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert len(res.json()) == 2

    res = client.get(
        "/totals/detail?period=daily&limit=2&offset=0",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    payload = res.json()
    assert len(payload["points"]) == 2
    assert payload["assets"][0]["id"] == asset_id

    res = client.get(
        "/totals/detail?period=daily&limit=2&offset=2",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    payload = res.json()
    assert len(payload["points"]) == 1


def test_snapshot_totals_creates_daily_total(client):
    token = register_and_login(client)
    res = client.post(
        "/assets",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "예금",
            "symbol": "예금",
            "asset_type": "예금",
            "quantity": 4,
            "price_krw": 10000.0,
        },
    )
    assert res.status_code == 200

    res = client.post(
        "/totals/snapshot",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200

    res = client.get(
        "/totals?period=daily&limit=1&offset=0",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data[0]["total_krw"] == 40000.0
