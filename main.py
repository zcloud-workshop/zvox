import argparse
import os

import uvicorn
from dotenv import load_dotenv

if __name__ == "__main__":
    load_dotenv()
    parser = argparse.ArgumentParser(description="Run ZVox")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=os.getenv("PORT", "8000"))
    parser.add_argument("--reload", action="store_true", help="Enable development auto-reload")
    args = parser.parse_args()
    uvicorn.run("app.main:app", host=args.host, port=args.port, reload=args.reload)
