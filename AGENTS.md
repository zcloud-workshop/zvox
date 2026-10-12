# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
uv sync

# Run the server (with auto-reload)
python main.py
# or
uvicorn app.main:app --reload --port 8000
```

Run regressions with `uv run python -m unittest discover -s tests -v`. Database tests require `TEST_DATABASE_URL` and use temporary schemas. No linter is configured.

## Architecture

ZVox is a FastAPI service for voice cloning using VoxCPM2. All API routes are prefixed with `/api`.

### Layered Structure

| Layer | Path | Responsibility |
| --- | --- | --- |
| API | `app/api/` | HTTP concerns only: param parsing, response models, error codes |
| Services | `app/services/` | Business logic, async orchestration |
| DB | `app/db/` | Raw PostgreSQL via `psycopg`, no ORM, `row_factory = dict_row` |
| Core | `app/core/` | Config (env vars), S3 client init |
| Tools | `app/tools/` | Reusable utilities (URL builders) |
| Models | `app/models/` | Pydantic schemas |

API handlers must not contain business logic -- delegate to `services/`.

### Async Pattern

- API routes are `async def`, blocking DB calls wrapped with `await asyncio.to_thread()`
- Heavy work (TTS inference, S3 upload) runs via `run_in_executor` in `job_worker`
- `services/speaker.py:get_voices` stays sync because its caller `run_job` executes in a thread

### Request Flow

1. `POST /api/jobs` validates speaker, inserts into PostgreSQL, enqueues job_id to `asyncio.Queue`
2. `job_worker` (single consumer) dequeues jobs sequentially -- only one TTS task runs at a time
3. `run_job` loads VoxCPM model (lazy), generates audio, uploads to S3, stores the S3 object key
4. `GET /api/jobs/{id}` generates a presigned URL on-the-fly from the stored key

### Key Design Decisions

- **Sequential job processing**: single `asyncio.Queue` with one worker to avoid GPU memory contention
- **Model lazy loading**: VoxCPM loads on first job, auto-unloads after 3 min idle (`model_idle_watcher`)
- **Dual S3 provider**: `S3_PROVIDER` env var selects `aws` (default credential chain) or `rustfs` (explicit endpoint + keys)
- **Presigned URLs**: only S3 object keys stored in DB; presigned URLs generated per-request with configurable TTL
- **Path templates**: speaker paths use `{id}` placeholders, resolved at runtime via `.format(id=speaker_id)`

### Speaker System

- Speaker metadata lives in `speaker/{id}/vox-data.json` files
- `sync.py` handles bidirectional sync between local `speaker/` dir and S3, then writes to `speakers` table
- All speaker reads go through PostgreSQL, not the filesystem

### Database

- `DATABASE_URL` is required. Use `sslmode=require` when required by the PostgreSQL endpoint.
- PostgreSQL is the only database backend for users, speakers, jobs, and sessions.
- Startup initializes tables and indexes in an existing database; the database and connection user must be created beforehand.
- Job quotas lock the user's row. Admin changes share a transaction advisory lock to protect the last active administrator.

### S3 Key Layout

- Speaker resources: `{S3_SPEAKER_PREFIX}{id}/...`
- TTS output: `{S3_OUTPUT_PREFIX}{job_id}/{job_id}.wav` and `data.json`
