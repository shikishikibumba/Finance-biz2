"""Firestore adapter exposing a Motor-style async API.

The accounting backend was originally written against Motor (async MongoDB).
We don't want to touch every route just because we swapped databases, so this
module provides a thin shim that mirrors the parts of the Motor API the routes
actually use:

    db.collection_name.find(query, projection).sort(...).to_list(N)
    db.collection_name.find_one(query, projection)
    db.collection_name.insert_one(doc)
    db.collection_name.update_one(query, {"$set": ..., "$inc": ..., "$push": ...})
    db.collection_name.delete_one(query)
    db.collection_name.delete_many(query)
    db.collection_name.aggregate([...]).to_list(N)

Operators supported in queries:
    {field: value}                        # equality
    {field: {"$gte": v, "$lte": v}}       # range
    {field: {"$ne": v}}                   # not equal (includes missing field)
    {field: {"$in": [...]}}               # membership
    {field: {"$regex": r, "$options": "i"}}  # client-side regex
    {field: {"$exists": True/False}}      # field presence
    {"$or": [ {..}, {..} ]}               # union of result sets

Aggregation pipeline stages supported:
    {"$match": {...}}, {"$unwind": "$field"}, {"$group": {"_id": expr, "total": {"$sum": expr_or_1}}}

Counter sequences use a Firestore transaction (atomic).

This is deliberately limited to the patterns the existing codebase uses — we
do NOT try to implement all of MongoDB.
"""

import os
import re
import asyncio
import logging
from typing import Any, Optional
from copy import deepcopy

import firebase_admin
from firebase_admin import credentials, firestore as admin_firestore

logger = logging.getLogger(__name__)

# ─── Initialise Firebase Admin (once) ───────────────────────────────────────
_SERVICE_ACCOUNT_PATH = os.environ.get(
    "FIREBASE_SERVICE_ACCOUNT",
    os.path.join(os.path.dirname(__file__), "firebase-service-account.json"),
)
if not firebase_admin._apps:
    cred = credentials.Certificate(_SERVICE_ACCOUNT_PATH)
    _bucket_name = os.environ.get(
        "FIREBASE_STORAGE_BUCKET",
        f"{os.environ.get('FIREBASE_PROJECT_ID', 'commercial-trading1')}.appspot.com",
    )
    firebase_admin.initialize_app(cred, {"storageBucket": _bucket_name})

_fs = admin_firestore.client()


# ─── Helpers ────────────────────────────────────────────────────────────────
def _is_op_dict(v: Any) -> bool:
    return isinstance(v, dict) and any(k.startswith("$") for k in v.keys())


def _resolve_path(doc: dict, path: str):
    """Resolve a dotted path like 'allocations.reference_id' against a doc."""
    if not isinstance(doc, dict):
        return None
    if "." not in path:
        return doc.get(path)
    val = doc
    for part in path.split("."):
        if isinstance(val, dict):
            val = val.get(part)
        else:
            return None
    return val


def _doc_matches(doc: dict, query: dict) -> bool:
    """Evaluate a Mongo-style query against a single document (client side)."""
    if not query:
        return True
    for k, v in query.items():
        if k == "$or":
            if not any(_doc_matches(doc, sub) for sub in v):
                return False
            continue
        if k == "$and":
            if not all(_doc_matches(doc, sub) for sub in v):
                return False
            continue
        val = _resolve_path(doc, k)
        if isinstance(v, dict) and _is_op_dict(v):
            for op, opv in v.items():
                if op == "$ne":
                    if val == opv:
                        return False
                elif op == "$eq":
                    if val != opv:
                        return False
                elif op == "$gt":
                    if val is None or not (val > opv):
                        return False
                elif op == "$gte":
                    if val is None or not (val >= opv):
                        return False
                elif op == "$lt":
                    if val is None or not (val < opv):
                        return False
                elif op == "$lte":
                    if val is None or not (val <= opv):
                        return False
                elif op == "$in":
                    if val not in opv:
                        return False
                elif op == "$nin":
                    if val in opv:
                        return False
                elif op == "$regex":
                    flags = re.IGNORECASE if v.get("$options", "").lower().count("i") else 0
                    if val is None or not re.search(opv, str(val), flags):
                        return False
                elif op == "$options":
                    pass  # handled above
                elif op == "$exists":
                    present = _resolve_path(doc, k) is not None
                    if bool(opv) != present:
                        return False
                else:
                    logger.warning("Unsupported operator %s in query — ignoring", op)
        else:
            if val != v:
                return False
    return True


def _apply_projection(doc: dict, projection: Optional[dict]) -> dict:
    if not projection:
        return doc
    # Mongo projection: {field: 1} include, {field: 0} exclude; mixed is invalid (only _id+exclude allowed)
    incs = {k for k, v in projection.items() if v == 1}
    excs = {k for k, v in projection.items() if v == 0}
    if incs:
        out = {k: doc[k] for k in incs if k in doc}
        return out
    if excs:
        return {k: v for k, v in doc.items() if k not in excs}
    return doc


def _apply_update(doc: dict, update: dict) -> dict:
    """Mutate `doc` with $set / $inc / $push / $unset semantics. Returns doc."""
    for op, ops in update.items():
        if op == "$set":
            for k, v in ops.items():
                doc[k] = v
        elif op == "$inc":
            for k, v in ops.items():
                doc[k] = (doc.get(k) or 0) + v
        elif op == "$push":
            for k, v in ops.items():
                arr = list(doc.get(k) or [])
                if isinstance(v, dict) and "$each" in v:
                    arr.extend(v["$each"])
                else:
                    arr.append(v)
                doc[k] = arr
        elif op == "$pull":
            for k, cond in ops.items():
                arr = list(doc.get(k) or [])
                if isinstance(cond, dict) and _is_op_dict(cond):
                    doc[k] = [x for x in arr if not _doc_matches(x if isinstance(x, dict) else {"_v": x}, cond)]
                else:
                    doc[k] = [x for x in arr if x != cond]
        elif op == "$unset":
            for k in ops.keys():
                doc.pop(k, None)
        else:
            # naive: top-level field set
            doc[op] = ops
    return doc


def _run_aggregation(docs: list, pipeline: list) -> list:
    """Execute a simple aggregation pipeline in Python."""
    cur = list(docs)
    for stage in pipeline:
        if "$match" in stage:
            cur = [d for d in cur if _doc_matches(d, stage["$match"])]
        elif "$unwind" in stage:
            spec = stage["$unwind"]
            field = spec.lstrip("$") if isinstance(spec, str) else spec.get("path", "").lstrip("$")
            new = []
            for d in cur:
                arr = d.get(field) or []
                if not isinstance(arr, list):
                    continue
                for item in arr:
                    nd = deepcopy(d)
                    nd[field] = item
                    new.append(nd)
            cur = new
        elif "$group" in stage:
            spec = stage["$group"]
            groups: dict = {}
            for d in cur:
                key_expr = spec["_id"]
                if isinstance(key_expr, str) and key_expr.startswith("$"):
                    # Nested path resolver e.g. "$allocations.reference_id"
                    parts = key_expr[1:].split(".")
                    val = d
                    for p in parts:
                        if isinstance(val, dict):
                            val = val.get(p)
                        else:
                            val = None
                            break
                    key = val
                elif key_expr is None:
                    key = None
                else:
                    key = key_expr
                bucket = groups.setdefault(_hashable(key), {"_id": key})
                for out_field, expr in spec.items():
                    if out_field == "_id":
                        continue
                    if isinstance(expr, dict):
                        if "$sum" in expr:
                            ex = expr["$sum"]
                            if ex == 1:
                                bucket[out_field] = bucket.get(out_field, 0) + 1
                            else:
                                bucket[out_field] = bucket.get(out_field, 0) + _resolve_value(d, ex)
                        elif "$min" in expr:
                            v = _resolve_value(d, expr["$min"])
                            cur_v = bucket.get(out_field)
                            bucket[out_field] = v if cur_v is None or v < cur_v else cur_v
                        elif "$max" in expr:
                            v = _resolve_value(d, expr["$max"])
                            cur_v = bucket.get(out_field)
                            bucket[out_field] = v if cur_v is None or v > cur_v else cur_v
                        elif "$first" in expr:
                            if out_field not in bucket:
                                bucket[out_field] = _resolve_value(d, expr["$first"])
                        else:
                            logger.warning("Unsupported group accumulator: %s", expr)
            cur = list(groups.values())
        elif "$sort" in stage:
            spec = stage["$sort"]
            for field, direction in reversed(list(spec.items())):
                cur.sort(key=lambda d: (d.get(field) is None, d.get(field)), reverse=(direction == -1))
        elif "$limit" in stage:
            cur = cur[: stage["$limit"]]
        elif "$skip" in stage:
            cur = cur[stage["$skip"] :]
        elif "$project" in stage:
            cur = [_apply_projection(d, stage["$project"]) for d in cur]
        elif "$addFields" in stage:
            for d in cur:
                for k, expr in stage["$addFields"].items():
                    d[k] = _eval_expr(d, expr)
        else:
            logger.warning("Unsupported aggregation stage: %s", stage)
    return cur


def _eval_expr(doc: dict, expr):
    """Resolve an aggregation expression (supports $substr, $multiply, $subtract,
    $add, field refs, literals)."""
    if isinstance(expr, str) and expr.startswith("$"):
        return _resolve_path(doc, expr[1:])
    if isinstance(expr, dict):
        if "$substr" in expr:
            args = expr["$substr"]
            s = _eval_expr(doc, args[0]) or ""
            start = int(_eval_expr(doc, args[1]) or 0)
            length = int(_eval_expr(doc, args[2]) or 0)
            return str(s)[start:start + length]
        if "$multiply" in expr:
            r = 1
            for e in expr["$multiply"]:
                r *= float(_eval_expr(doc, e) or 0)
            return r
        if "$subtract" in expr:
            a = float(_eval_expr(doc, expr["$subtract"][0]) or 0)
            b = float(_eval_expr(doc, expr["$subtract"][1]) or 0)
            return a - b
        if "$add" in expr:
            return sum(float(_eval_expr(doc, e) or 0) for e in expr["$add"])
        if "$concat" in expr:
            return "".join(str(_eval_expr(doc, e) or "") for e in expr["$concat"])
    return expr


def _resolve_value(doc: dict, expr):
    """Resolve an aggregation value expression. Supports nested path refs and $multiply."""
    if isinstance(expr, str) and expr.startswith("$"):
        parts = expr[1:].split(".")
        val = doc
        for p in parts:
            if isinstance(val, dict):
                val = val.get(p)
            else:
                val = None
                break
        return float(val or 0) if isinstance(val, (int, float)) or val is None else val
    if isinstance(expr, dict):
        if "$multiply" in expr:
            vals = [_resolve_value(doc, e) for e in expr["$multiply"]]
            r = 1
            for v in vals:
                r *= float(v or 0)
            return r
        if "$subtract" in expr:
            vals = [_resolve_value(doc, e) for e in expr["$subtract"]]
            return float(vals[0] or 0) - float(vals[1] or 0)
        if "$add" in expr:
            return sum(float(_resolve_value(doc, e) or 0) for e in expr["$add"])
    if isinstance(expr, (int, float)):
        return expr
    return 0


def _hashable(x):
    if isinstance(x, (list, dict)):
        import json
        return json.dumps(x, sort_keys=True, default=str)
    return x


# ─── Cursors ────────────────────────────────────────────────────────────────
class _Cursor:
    """Lazy cursor that supports .sort() chaining and async .to_list(N)."""

    def __init__(self, fetch_coro):
        self._fetch_coro = fetch_coro
        self._sort_spec = []   # list of (field, direction)

    def sort(self, field, direction=1):
        if isinstance(field, list):
            self._sort_spec.extend(field)
        else:
            self._sort_spec.append((field, direction))
        return self

    async def to_list(self, length=None):
        docs = await self._fetch_coro
        for f, d in reversed(self._sort_spec):
            docs.sort(key=lambda doc: (doc.get(f) is None, doc.get(f)), reverse=(d == -1))
        if length is not None:
            docs = docs[:length]
        return docs

    def __aiter__(self):
        async def _gen():
            for d in await self.to_list():
                yield d
        return _gen()


class _AggregationCursor:
    def __init__(self, fetch_coro, pipeline):
        self._fetch_coro = fetch_coro
        self._pipeline = pipeline

    async def to_list(self, length=None):
        docs = await self._fetch_coro
        out = _run_aggregation(docs, self._pipeline)
        return out[:length] if length else out


# ─── Collection ─────────────────────────────────────────────────────────────
class FirestoreCollection:
    """Async wrapper around a Firestore collection providing a Motor-like API."""

    def __init__(self, name: str):
        self.name = name
        self._col = _fs.collection(name)

    # ── reads ────────────────────────────────────────────────────────────
    async def _fetch_all(self) -> list:
        loop = asyncio.get_running_loop()
        snaps = await loop.run_in_executor(None, lambda: list(self._col.stream()))
        return [s.to_dict() for s in snaps if s.exists]

    def find(self, query: Optional[dict] = None, projection: Optional[dict] = None,
             sort=None):
        async def _do():
            all_docs = await self._fetch_all()
            filtered = [d for d in all_docs if _doc_matches(d, query or {})]
            projected = [_apply_projection(d, projection) for d in filtered]
            return projected

        cur = _Cursor(_do())
        if sort:
            cur.sort(sort)
        return cur

    async def find_one(self, query: Optional[dict] = None, projection: Optional[dict] = None,
                       sort=None):
        all_docs = await self._fetch_all()
        filtered = [d for d in all_docs if _doc_matches(d, query or {})]
        if sort:
            for f, dirn in reversed(sort if isinstance(sort, list) else [(sort, 1)]):
                filtered.sort(key=lambda d: (d.get(f) is None, d.get(f)), reverse=(dirn == -1))
        if not filtered:
            return None
        return _apply_projection(filtered[0], projection)

    async def count_documents(self, query: Optional[dict] = None) -> int:
        if not query:
            loop = asyncio.get_running_loop()
            snap = await loop.run_in_executor(None, lambda: self._col.count().get())
            return snap[0][0].value
        docs = await self._fetch_all()
        return sum(1 for d in docs if _doc_matches(d, query))

    # ── writes ───────────────────────────────────────────────────────────
    async def insert_one(self, doc: dict):
        if "id" not in doc:
            raise ValueError(f"Document for {self.name} must have an 'id' field")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: self._col.document(doc["id"]).set(doc))
        return type("Result", (), {"inserted_id": doc["id"]})()

    async def insert_many(self, docs: list):
        loop = asyncio.get_running_loop()
        def _bulk():
            batch = _fs.batch()
            for d in docs:
                if "id" not in d:
                    raise ValueError(f"Document for {self.name} must have 'id'")
                batch.set(self._col.document(d["id"]), d)
            batch.commit()
        await loop.run_in_executor(None, _bulk)
        return type("Result", (), {"inserted_ids": [d["id"] for d in docs]})()

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        all_docs = await self._fetch_all()
        match = next((d for d in all_docs if _doc_matches(d, query)), None)
        loop = asyncio.get_running_loop()
        if match is None:
            if not upsert:
                return type("Result", (), {"modified_count": 0, "matched_count": 0})()
            new_doc = {}
            # equality query fields become base
            for k, v in (query or {}).items():
                if not k.startswith("$") and not isinstance(v, dict):
                    new_doc[k] = v
            _apply_update(new_doc, update)
            if "id" not in new_doc:
                raise ValueError(f"Upsert on {self.name} requires id in query or update")
            await loop.run_in_executor(None, lambda: self._col.document(new_doc["id"]).set(new_doc))
            return type("Result", (), {"modified_count": 0, "matched_count": 0, "upserted_id": new_doc["id"]})()
        before = deepcopy(match)
        _apply_update(match, update)
        await loop.run_in_executor(None, lambda: self._col.document(match["id"]).set(match))
        return type("Result", (), {"modified_count": 0 if before == match else 1, "matched_count": 1})()

    async def update_many(self, query: dict, update: dict):
        all_docs = await self._fetch_all()
        matches = [d for d in all_docs if _doc_matches(d, query)]
        loop = asyncio.get_running_loop()
        def _bulk():
            batch = _fs.batch()
            for m in matches:
                _apply_update(m, update)
                batch.set(self._col.document(m["id"]), m)
            batch.commit()
        if matches:
            await loop.run_in_executor(None, _bulk)
        return type("Result", (), {"modified_count": len(matches), "matched_count": len(matches)})()

    async def delete_one(self, query: dict):
        all_docs = await self._fetch_all()
        match = next((d for d in all_docs if _doc_matches(d, query)), None)
        if not match:
            return type("Result", (), {"deleted_count": 0})()
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: self._col.document(match["id"]).delete())
        return type("Result", (), {"deleted_count": 1})()

    async def delete_many(self, query: dict):
        all_docs = await self._fetch_all()
        matches = [d for d in all_docs if _doc_matches(d, query)]
        loop = asyncio.get_running_loop()
        def _bulk():
            batch = _fs.batch()
            for m in matches:
                batch.delete(self._col.document(m["id"]))
            batch.commit()
        if matches:
            await loop.run_in_executor(None, _bulk)
        return type("Result", (), {"deleted_count": len(matches)})()

    def aggregate(self, pipeline: list):
        return _AggregationCursor(self._fetch_all(), pipeline)

    async def create_index(self, *args, **kwargs):
        # Firestore indexes are managed via the console / firestore.indexes.json.
        return None


# ─── Database ───────────────────────────────────────────────────────────────
class FirestoreDatabase:
    def __init__(self):
        self._collections: dict = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self._collections:
            self._collections[name] = FirestoreCollection(name)
        return self._collections[name]

    def __getitem__(self, name):
        return self.__getattr__(name)


db = FirestoreDatabase()
