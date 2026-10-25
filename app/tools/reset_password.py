import argparse
import sys
from getpass import getpass

from app.services.user import reset_password_by_username


def main():
    parser = argparse.ArgumentParser(description="Reset a ZVox user's password")
    parser.add_argument("username")
    args = parser.parse_args()
    password = getpass("New password: ")
    if password != getpass("Confirm password: "):
        parser.error("Passwords do not match")
    try:
        user = reset_password_by_username(args.username, password)
    except ValueError as exc:
        parser.error(str(exc))
    print(f"Reset password for {user['username']}; existing sessions and API keys were revoked")
    if not user["is_active"]:
        print(f"Warning: {user['username']} is disabled and cannot log in until an admin re-enables it", file=sys.stderr)


if __name__ == "__main__":
    main()
