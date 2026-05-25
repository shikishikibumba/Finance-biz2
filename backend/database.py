"""Database layer — Firestore-backed.

Re-exports `db` (Motor-style adapter from firestore_db) and provides
`get_next_sequence` using a Firestore transaction.
"""
import asyncio
from firestore_db import db, _fs  # noqa: F401
from firebase_admin import firestore as _fb_firestore


@_fb_firestore.transactional
def _increment_counter(transaction, ref, name: str) -> int:
    snap = ref.get(transaction=transaction)
    if snap.exists:
        new_val = (snap.to_dict().get("seq") or 0) + 1
        transaction.update(ref, {"seq": new_val})
    else:
        new_val = 1
        transaction.set(ref, {"id": name, "_id": name, "seq": new_val})
    return new_val


async def get_next_sequence(name: str) -> int:
    """Atomically increment the named counter and return the new value."""
    loop = asyncio.get_running_loop()

    def _do():
        ref = _fs.collection("counters").document(name)
        return _increment_counter(_fs.transaction(), ref, name)

    return await loop.run_in_executor(None, _do)
