from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.routing import Match, Mount
from starlette.staticfiles import StaticFiles


class FrontendMount(Mount):
    def matches(self, scope):
        path = scope["path"].removeprefix(scope.get("root_path", ""))
        if path == "/api" or path.startswith("/api/"):
            return Match.NONE, {}
        return super().matches(scope)


class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or path == "assets" or path.startswith("assets/") or Path(path).suffix:
                raise
            return await super().get_response("index.html", scope)
