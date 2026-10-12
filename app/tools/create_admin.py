import argparse
from getpass import getpass

from app.db.database import init_db
from app.services.user import create_user


def main():
    parser = argparse.ArgumentParser(description="Create a ZVox administrator")
    parser.add_argument("username")
    args = parser.parse_args()
    password = getpass("Password: ")
    if password != getpass("Confirm password: "):
        parser.error("Passwords do not match")
    init_db()
    try:
        user = create_user(args.username, password, "admin")
    except ValueError as exc:
        parser.error(str(exc))
    print(f"Created administrator {user['username']}")


if __name__ == "__main__":
    main()
