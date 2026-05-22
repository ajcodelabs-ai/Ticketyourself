"""MongoDB client + helpers. Single source of truth for `db`."""
import os
from motor.motor_asyncio import AsyncIOMotorClient

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]


async def close_db_client() -> None:
    _client.close()
