import sys
import bcrypt
import getpass

from app.db.images import init_db
from app.db.users import init_users, get_user, create_user


def main():
    if len(sys.argv) < 2:
        print("Usage: python create_user.py <username> [password]")
        sys.exit(1)

    username = sys.argv[1]

    if len(sys.argv) >= 3:
        password = sys.argv[2]
    else:
        password = getpass.getpass(f"Password for '{username}': ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Error: passwords do not match")
            sys.exit(1)

    if not password:
        print("Error: password cannot be empty")
        sys.exit(1)

    init_db()
    init_users()

    if get_user(username):
        print(f"Error: user '{username}' already exists")
        sys.exit(1)

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    create_user(username, password_hash)
    print(f"User '{username}' created successfully")


if __name__ == "__main__":
    main()
