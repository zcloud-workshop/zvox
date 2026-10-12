import argparse
import json
import sys

from app.services.model import check_model, ensure_model, get_download_status


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare the local VoxCPM2 model")
    parser.add_argument("--check", action="store_true", help="Check local files without downloading")
    args = parser.parse_args()
    try:
        if args.check:
            print(json.dumps(get_download_status(), ensure_ascii=False))
            return 0 if check_model() else 1
        path = ensure_model()
    except Exception as exc:
        print(f"Could not prepare model: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"status": "ready", "path": path}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
