from app.modules.gamification.catalog import level_for_xp, xp_for_level


async def test_health_and_meta(client):
    health = (await client.get("/health")).json()
    assert health == {"status": "ok", "db": True, "redis": True}

    meta = (await client.get("/api/v1/meta")).json()
    assert meta["split_window_minutes"] == 30
    assert meta["sub_discount_pct"] == 20
    assert {s["key"] for s in meta["sports"]} >= {"football", "badminton"}


def test_level_curve():
    assert xp_for_level(1) == 0
    assert xp_for_level(2) == 100
    assert level_for_xp(0) == 1
    assert level_for_xp(299) == 2
    assert level_for_xp(300) == 3
