"""Turf-camera recordings and highlight clips (FEATURE_ANALYSIS §5).

A clip is a non-destructive `[start_s, end_s]` window over the recording's source footage
(media-fragment playback on the client) — no transcoding in the MVP.
"""

import asyncio
import json
import uuid
from collections.abc import Sequence
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import ColumnElement, delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, Conflict, Forbidden, NotFound
from app.core.logging import logger
from app.core.pagination import Page
from app.core.redis import get_redis
from app.core.timeutils import utcnow
from app.modules.gamification.catalog import XP
from app.modules.gamification.models import XpEvent
from app.modules.gamification.service import award_badge, award_xp, get_stats_for_update
from app.modules.highlights.models import Clip, ClipLike, Recording
from app.modules.highlights.schemas import ClipOut, CreateClipRequest, RecordingOut, RecordingSummary
from app.modules.lobbies.models import Lobby, LobbyMember
from app.modules.notifications.service import notify
from app.modules.users.models import User
from app.modules.users.schemas import UserPublic
from app.realtime.publisher import lobby_channel, publish_on_commit

CLIP_XP_PREFIX = "Clipped"
VIEW_KEY_PREFIX = "pytch:clip-view:"
VIEW_DEDUP_SECONDS = 24 * 3600
PROCESS_DELAY = timedelta(seconds=20)
STUCK_AFTER = timedelta(minutes=10)
BATCH = 10
MAX_TAGS = 5
TAG_LEN = 30
DURATION_EPSILON = 0.5


class NotMember(AppError):
    code, status_code, message = "NOT_MEMBER", 403, "Only players from this match can do that"


class LimitReached(AppError):
    code, status_code, message = "LIMIT_REACHED", 409, "You can pin up to 3 clips"


class InvalidClip(AppError):
    code, status_code, message = "VALIDATION_ERROR", 422, "Invalid clip"


# ───────────────────────────── footage library ─────────────────────────────
def _media_root() -> Path:
    return Path(settings.media_dir)


@lru_cache(maxsize=1)
def footage_library() -> tuple[dict[str, Any], ...]:
    """Demo footage from `media/footage/manifest.json` (falls back to scanning *.mp4)."""
    root = _media_root() / "footage"
    manifest = root / "manifest.json"
    items: list[dict[str, Any]] = []
    if manifest.exists():
        try:
            items = [i for i in json.loads(manifest.read_text()) if (root / i["file"]).exists()]
        except (ValueError, KeyError, TypeError):
            logger.warning("highlights: unreadable footage manifest %s", manifest)
    if not items:
        items = [{"file": p.name, "thumbnail": f"{p.stem}.jpg"} for p in sorted(root.glob("*.mp4"))]
    return tuple(items)


def _media_url(*parts: str) -> str:
    return "/".join([settings.media_url_prefix.rstrip("/"), *parts])


async def probe_duration(path: Path) -> float | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        return round(float(out.decode().strip()), 2)
    except (OSError, ValueError, TimeoutError):
        return None


def pick_footage(lobby_id: uuid.UUID) -> dict[str, Any] | None:
    library = footage_library()
    if not library:
        return None
    return library[lobby_id.int % len(library)]


async def footage_for(lobby_id: uuid.UUID) -> tuple[str, str | None, float] | None:
    """(video_url, thumbnail_url, duration_s) for a lobby's recording."""
    item = pick_footage(lobby_id)
    if item is None:
        return None
    root = _media_root()
    duration = item.get("duration_s") or await probe_duration(root / "footage" / item["file"])
    if not duration:
        return None
    thumb = item.get("thumbnail")
    thumb_url = _media_url("thumbs", thumb) if thumb and (root / "thumbs" / thumb).exists() else None
    return _media_url("footage", item["file"]), thumb_url, float(duration)


# ───────────────────────────── read models ─────────────────────────────
def _participant_ids(lobby: Lobby) -> set[uuid.UUID]:
    return {m.user_id for m in lobby.members if m.status == "paid"} | {lobby.host_id}


def _can_see(lobby: Lobby, viewer_id: uuid.UUID | None) -> bool:
    """Footage (and clips) of a private match: its participants only."""
    return lobby.visibility == "public" or (viewer_id is not None and viewer_id in _participant_ids(lobby))


def _visible_to(viewer_id: uuid.UUID | None) -> ColumnElement[bool]:
    """SQL mirror of `_can_see` (the query must join Recording → Lobby)."""
    if viewer_id is None:
        return Lobby.visibility == "public"
    participant = or_(
        Lobby.host_id == viewer_id,
        exists(select(LobbyMember.id).where(LobbyMember.lobby_id == Lobby.id, LobbyMember.user_id == viewer_id,
                                            LobbyMember.status == "paid")),
    )
    return or_(Lobby.visibility == "public", participant)


def _clips_of_visible_lobbies(viewer_id: uuid.UUID | None):
    return (
        select(Clip)
        .join(Recording, Recording.id == Clip.recording_id)
        .join(Lobby, Lobby.id == Recording.lobby_id)
        .where(_visible_to(viewer_id))
    )


async def _liked_ids(db: AsyncSession, viewer_id: uuid.UUID | None, clip_ids: Sequence[uuid.UUID]) -> set[uuid.UUID]:
    if viewer_id is None or not clip_ids:
        return set()
    rows = await db.scalars(
        select(ClipLike.clip_id).where(ClipLike.user_id == viewer_id, ClipLike.clip_id.in_(list(clip_ids)))
    )
    return set(rows.all())


def _clip_out(clip: Clip, liked: set[uuid.UUID]) -> ClipOut:
    recording = clip.recording
    lobby = recording.lobby
    return ClipOut(
        id=clip.id,
        recording_id=clip.recording_id,
        owner=UserPublic.from_user(clip.user),
        title=clip.title,
        start_s=clip.start_s,
        end_s=clip.end_s,
        video_url=recording.video_url or "",
        thumbnail_url=recording.thumbnail_url,
        tags=list(clip.tags or []),
        is_pinned=clip.is_pinned,
        likes_count=clip.likes_count,
        liked_by_me=clip.id in liked,
        views=clip.views,
        turf_name=lobby.turf.name,
        sport=lobby.sport,  # type: ignore[arg-type]
        created_at=clip.created_at,
    )


async def clip_outs(db: AsyncSession, clips: Sequence[Clip], viewer_id: uuid.UUID | None) -> list[ClipOut]:
    liked = await _liked_ids(db, viewer_id, [c.id for c in clips])
    return [_clip_out(c, liked) for c in clips]


async def recording_outs(db: AsyncSession, recordings: Sequence[Recording], viewer: User) -> list[RecordingOut]:
    if not recordings:
        return []
    from app.modules.lobbies.service import lobby_summaries

    summaries = {s.id: s for s in await lobby_summaries(db, [r.lobby for r in recordings])}
    clips = (
        await db.scalars(
            select(Clip)
            .where(Clip.recording_id.in_([r.id for r in recordings]))
            .order_by(Clip.likes_count.desc(), Clip.created_at.desc())
        )
    ).unique().all()
    outs = await clip_outs(db, clips, viewer.id)
    by_recording: dict[uuid.UUID, list[ClipOut]] = {}
    for out in outs:
        by_recording.setdefault(out.recording_id, []).append(out)
    return [
        RecordingOut(
            id=r.id,
            lobby_id=r.lobby_id,
            status=r.status,  # type: ignore[arg-type]
            video_url=r.video_url if r.status == "ready" else None,
            thumbnail_url=r.thumbnail_url,
            duration_s=r.duration_s,
            ready_at=r.ready_at,
            lobby=summaries[r.lobby_id],
            clips=by_recording.get(r.id, []),
        )
        for r in recordings
    ]


async def recording_summary_for_lobby(db: AsyncSession, lobby_id: uuid.UUID) -> RecordingSummary | None:
    recording = await db.scalar(select(Recording).where(Recording.lobby_id == lobby_id))
    if recording is None:
        return None
    return RecordingSummary(
        id=recording.id,
        status=recording.status,  # type: ignore[arg-type]
        thumbnail_url=recording.thumbnail_url,
        ready_at=recording.ready_at,
    )


async def pinned_clips_for_user(db: AsyncSession, user_id: uuid.UUID, viewer_id: uuid.UUID | None) -> list[ClipOut]:
    clips = (
        await db.scalars(
            _clips_of_visible_lobbies(viewer_id)
            .where(Clip.user_id == user_id, Clip.is_pinned.is_(True))
            .order_by(Clip.created_at.desc())
        )
    ).unique().all()
    return await clip_outs(db, clips, viewer_id)


# ───────────────────────────── recordings ─────────────────────────────
async def my_recordings(db: AsyncSession, user: User) -> list[RecordingOut]:
    recordings = (
        await db.scalars(
            select(Recording)
            .join(Lobby, Lobby.id == Recording.lobby_id)
            .where(
                or_(
                    Lobby.host_id == user.id,
                    Recording.lobby_id.in_(
                        select(LobbyMember.lobby_id).where(
                            LobbyMember.user_id == user.id, LobbyMember.status == "paid"
                        )
                    ),
                )
            )
            .order_by(Lobby.start_at.desc())
        )
    ).unique().all()
    return await recording_outs(db, recordings, user)


async def _get_recording(db: AsyncSession, recording_id: uuid.UUID) -> Recording:
    recording = await db.get(Recording, recording_id)
    if recording is None:
        raise NotFound("Recording not found")
    return recording


async def get_recording(db: AsyncSession, recording_id: uuid.UUID, user: User) -> RecordingOut:
    recording = await _get_recording(db, recording_id)
    lobby = recording.lobby
    if lobby.visibility != "public" and user.id not in _participant_ids(lobby):
        raise NotFound("Recording not found")
    return (await recording_outs(db, [recording], user))[0]


def _clean_tags(tags: Sequence[str]) -> list[str]:
    out: list[str] = []
    for tag in tags:
        tag = " ".join(tag.split())[:TAG_LEN]
        if tag and tag.lower() not in {t.lower() for t in out}:
            out.append(tag)
    return out[:MAX_TAGS]


async def create_clip(db: AsyncSession, recording_id: uuid.UUID, user: User, body: CreateClipRequest) -> ClipOut:
    recording = await _get_recording(db, recording_id)
    if user.id not in _participant_ids(recording.lobby):
        raise NotMember("Only players from this match can clip it")
    if recording.status != "ready" or not recording.duration_s:
        raise Conflict("The recording is still processing — try again in a moment")
    length = body.end_s - body.start_s
    if length < 1 or length > settings.max_clip_seconds:
        raise InvalidClip(f"Clips must be between 1 and {settings.max_clip_seconds} seconds long")
    if body.end_s > recording.duration_s + DURATION_EPSILON:
        raise InvalidClip(
            "Clip runs past the end of the recording", details={"duration_s": recording.duration_s}
        )
    clip = Clip(
        id=uuid.uuid4(),
        recording_id=recording.id,
        user_id=user.id,
        title=body.title.strip(),
        start_s=round(body.start_s, 2),
        end_s=round(min(body.end_s, recording.duration_s), 2),
        tags=_clean_tags(body.tags),
        is_pinned=False,
        likes_count=0,
        views=0,
        created_at=utcnow(),
    )
    clip.recording = recording
    clip.user = user
    db.add(clip)
    # XP once per recording per player — deleting and re-creating clips earns nothing more
    await get_stats_for_update(db, user.id)  # per-user mutex so parallel creates can't both pass the check
    already = await db.scalar(
        select(XpEvent.id).where(XpEvent.user_id == user.id, XpEvent.ref_id == recording.id,
                                 XpEvent.reason.startswith(CLIP_XP_PREFIX)).limit(1)
    )
    if already is None:
        await award_xp(db, user.id, XP.CLIP_CREATED, f"{CLIP_XP_PREFIX} “{clip.title}”"[:80], recording.id)
    await db.commit()
    return _clip_out(clip, set())


async def _get_clip(db: AsyncSession, clip_id: uuid.UUID, viewer: User | None = None) -> Clip:
    """Load a clip; with `viewer`, a private match's clip is 404 for anyone but its participants."""
    clip = await db.get(Clip, clip_id)
    if clip is None or (viewer is not None and not _can_see(clip.recording.lobby, viewer.id)):
        raise NotFound("Clip not found")
    return clip


async def delete_clip(db: AsyncSession, clip_id: uuid.UUID, user: User) -> None:
    clip = await _get_clip(db, clip_id, user)
    if clip.user_id != user.id:
        raise Forbidden("You can only delete your own clips")
    await db.delete(clip)
    await db.commit()


async def feed(
    db: AsyncSession,
    viewer: User,
    *,
    sort: Literal["trending", "recent"],
    sport: str | None,
    limit: int,
    offset: int,
) -> Page[ClipOut]:
    """Public highlights feed — clips from public matches only (private footage stays with its players)."""
    base = (
        select(Clip)
        .join(Recording, Recording.id == Clip.recording_id)
        .join(Lobby, Lobby.id == Recording.lobby_id)
        .where(Recording.status == "ready", Lobby.visibility == "public")
    )
    if sport:
        base = base.where(Lobby.sport == sport)
    total = await db.scalar(select(func.count()).select_from(base.with_only_columns(Clip.id).subquery())) or 0
    if sort == "trending":
        age_hours = func.extract("epoch", func.now() - Clip.created_at) / 3600.0
        score = (Clip.likes_count * 3 + Clip.views * 0.2 + 1) / func.power(func.greatest(age_hours, 0) + 2, 1.2)
        ordered = base.order_by(score.desc(), Clip.created_at.desc())
    else:
        ordered = base.order_by(Clip.created_at.desc())
    clips = (await db.scalars(ordered.limit(limit).offset(offset))).unique().all()
    return Page[ClipOut](items=await clip_outs(db, clips, viewer.id), total=total, limit=limit, offset=offset)


async def user_clips(db: AsyncSession, user_id: uuid.UUID, viewer: User) -> list[ClipOut]:
    """A player's clips — private-match clips only for that match's participants."""
    clips = (
        await db.scalars(
            _clips_of_visible_lobbies(viewer.id)
            .where(Clip.user_id == user_id)
            .order_by(Clip.is_pinned.desc(), Clip.created_at.desc())
        )
    ).unique().all()
    return await clip_outs(db, clips, viewer.id)


async def _reload_clip_out(db: AsyncSession, clip_id: uuid.UUID, viewer_id: uuid.UUID) -> ClipOut:
    clip = await db.scalar(select(Clip).where(Clip.id == clip_id).execution_options(populate_existing=True))
    if clip is None:
        raise NotFound("Clip not found")
    return (await clip_outs(db, [clip], viewer_id))[0]


async def like(db: AsyncSession, clip_id: uuid.UUID, user: User) -> ClipOut:
    await _get_clip(db, clip_id, user)
    inserted = await db.scalar(
        insert(ClipLike)
        .values(clip_id=clip_id, user_id=user.id, created_at=utcnow())
        .on_conflict_do_nothing()
        .returning(ClipLike.clip_id)
    )
    if inserted is not None:
        await db.execute(update(Clip).where(Clip.id == clip_id).values(likes_count=Clip.likes_count + 1))
    await db.commit()
    return await _reload_clip_out(db, clip_id, user.id)


async def unlike(db: AsyncSession, clip_id: uuid.UUID, user: User) -> ClipOut:
    await _get_clip(db, clip_id, user)
    removed = await db.scalar(
        delete(ClipLike).where(ClipLike.clip_id == clip_id, ClipLike.user_id == user.id).returning(ClipLike.clip_id)
    )
    if removed is not None:
        await db.execute(
            update(Clip).where(Clip.id == clip_id).values(likes_count=func.greatest(Clip.likes_count - 1, 0))
        )
    await db.commit()
    return await _reload_clip_out(db, clip_id, user.id)


async def set_pinned(db: AsyncSession, clip_id: uuid.UUID, user: User, pinned: bool) -> ClipOut:
    clip = await _get_clip(db, clip_id, user)
    if clip.user_id != user.id:
        raise Forbidden("You can only pin your own clips")
    if clip.is_pinned != pinned:
        await get_stats_for_update(db, user.id)  # per-user mutex for the pin limit
        if pinned:
            count = await db.scalar(
                select(func.count()).select_from(Clip).where(Clip.user_id == user.id, Clip.is_pinned.is_(True))
            ) or 0
            if count >= settings.max_pinned_clips:
                raise LimitReached(f"You can pin up to {settings.max_pinned_clips} clips — unpin one first")
            clip.is_pinned = True
            await award_badge(db, user.id, "highlight_reel")
        else:
            clip.is_pinned = False
        await db.commit()
    return (await clip_outs(db, [clip], user.id))[0]


async def add_view(db: AsyncSession, clip_id: uuid.UUID, viewer: User) -> int:
    """Count a view: once per viewer per clip per VIEW_DEDUP_SECONDS, never the owner's own views."""
    clip = await _get_clip(db, clip_id, viewer)
    if clip.user_id == viewer.id:
        return int(clip.views)
    fresh = await get_redis().set(f"{VIEW_KEY_PREFIX}{clip.id}:{viewer.id}", "1", nx=True, ex=VIEW_DEDUP_SECONDS)
    if not fresh:
        return int(clip.views)
    views = await db.scalar(update(Clip).where(Clip.id == clip_id).values(views=Clip.views + 1).returning(Clip.views))
    if views is None:
        raise NotFound("Clip not found")
    await db.commit()
    return int(views)


# ───────────────────────────── pipeline ─────────────────────────────
async def schedule_recording(db: AsyncSession, lobby_id: uuid.UUID) -> bool:
    """`match.completed` → queue the recording if the match was recorded. Caller commits."""
    lobby = await db.get(Lobby, lobby_id)
    if lobby is None or not lobby.recorded:
        return False
    now = utcnow()
    result = await db.execute(
        insert(Recording)
        .values(
            id=uuid.uuid4(), lobby_id=lobby.id, pitch_id=lobby.pitch_id, status="scheduled",
            process_after=now + PROCESS_DELAY, created_at=now,
        )
        .on_conflict_do_nothing(index_elements=[Recording.lobby_id])
        .returning(Recording.id)
    )
    return result.scalar_one_or_none() is not None


async def claim_due(db: AsyncSession) -> list[uuid.UUID]:
    """scheduled (due) / stuck processing → processing. Commits the claim."""
    now = utcnow()
    rows = (
        await db.scalars(
            select(Recording)
            .where(
                or_(
                    (Recording.status == "scheduled") & (Recording.process_after <= now),
                    (Recording.status == "processing") & (Recording.process_after <= now - STUCK_AFTER),
                )
            )
            .order_by(Recording.process_after)
            .limit(BATCH)
            .with_for_update(of=Recording, skip_locked=True)
        )
    ).unique().all()
    for recording in rows:
        recording.status = "processing"
        recording.process_after = now
    await db.commit()
    return [r.id for r in rows]


async def finish_recording(db: AsyncSession, recording_id: uuid.UUID) -> bool:
    recording = await db.scalar(
        select(Recording).where(Recording.id == recording_id).with_for_update(of=Recording)
    )
    if recording is None or recording.status != "processing":
        await db.rollback()
        return False
    footage = await footage_for(recording.lobby_id)
    lobby = recording.lobby
    if footage is None:
        recording.status = "failed"
        logger.warning("highlights: no footage available for recording %s", recording.id)
        await db.commit()
        return False
    recording.video_url, recording.thumbnail_url, recording.duration_s = footage
    recording.status = "ready"
    recording.ready_at = utcnow()
    data = {
        "recording_id": recording.id,
        "lobby_id": lobby.id,
        "url": f"/app/highlights/recordings/{recording.id}",
    }
    for uid in _participant_ids(lobby):
        await notify(
            db, uid, "recording_ready", "🎬 Your match footage is ready",
            f"Relive “{lobby.title}” — clip your best moments and pin them to your profile.", data,
        )
    publish_on_commit(
        db, lobby_channel(lobby.id), "lobby.updated", {"lobby_id": str(lobby.id), "reason": "recording", "actor": None}
    )
    await db.commit()
    return True
