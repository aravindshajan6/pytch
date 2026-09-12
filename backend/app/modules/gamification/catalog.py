"""Static game-design data: XP rewards, level curve, badge catalogue."""

from dataclasses import dataclass


class XP:
    MATCH_PLAYED = 100
    MATCH_HOSTED = 50
    RATING_GIVEN = 15
    HERO_SUB = 150
    CLIP_CREATED = 20
    VERIFIED_PLAYMAKER = 500
    WEATHER_SAVE = 40  # host resolved a weather alert


def xp_for_level(level: int) -> int:
    """Total XP needed to reach `level` (L1 = 0, L2 = 100, L3 = 300, L4 = 600, L5 = 1000 …)."""
    return 50 * (level - 1) * level


def level_for_xp(xp: int) -> int:
    level = 1
    while xp >= xp_for_level(level + 1):
        level += 1
    return level


@dataclass(frozen=True)
class BadgeDef:
    code: str
    name: str
    description: str
    icon: str
    rarity: str  # common | rare | epic | legendary


BADGES: dict[str, BadgeDef] = {
    b.code: b
    for b in [
        BadgeDef("first_whistle", "First Whistle", "Play your first match on Pytch", "🏁", "common"),
        BadgeDef("hat_trick", "Hat-trick", "Play 3 matches", "🎩", "common"),
        BadgeDef("regular", "Regular", "Play 10 matches", "📅", "rare"),
        BadgeDef("veteran", "Veteran", "Play 50 matches", "🏟️", "epic"),
        BadgeDef("squad_leader", "Squad Leader", "Host 5 matches", "📣", "rare"),
        BadgeDef("hero_sub", "Hero Sub", "Answer an SOS from the bench", "🦸", "rare"),
        BadgeDef("super_sub", "Super Sub", "Save 5 matches from the bench", "⚡", "epic"),
        BadgeDef("rain_dancer", "Rain Dancer", "Play a match rescued from the rain", "🌧️", "rare"),
        BadgeDef(
            "verified_playmaker",
            "Verified Playmaker",
            "Peer-verified skill, fair play and reliability",
            "✅",
            "legendary",
        ),
        BadgeDef("fair_play_ace", "Fair Play Ace", "Fair play 4.7+ across 10+ ratings", "🤝", "epic"),
        BadgeDef("night_owl", "Night Owl", "Play a match kicking off at 9 PM or later", "🦉", "common"),
        BadgeDef("early_bird", "Early Bird", "Play a match kicking off before 7 AM", "🌅", "common"),
        BadgeDef("highlight_reel", "Highlight Reel", "Pin your first clip to your profile", "🎬", "common"),
        BadgeDef("critic", "Scout", "Rate 20 teammates", "📝", "rare"),
        BadgeDef("on_fire", "On Fire", "Keep a 4-week playing streak", "🔥", "epic"),
    ]
}
