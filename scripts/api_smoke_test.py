#!/usr/bin/env python3
import json
import os
import sys
import time
from datetime import date, timedelta
from dataclasses import dataclass
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener


@dataclass
class Cfg:
    base_url: str
    email: str
    password: str


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def read_cfg() -> Cfg:
    base_url = os.getenv("FECO_API_BASE", "http://localhost:3001").rstrip("/") + "/"
    email = os.getenv("FECO_EMAIL", "").strip().lower()
    password = os.getenv("FECO_PASSWORD", "").strip()
    if not email:
        die("Missing FECO_EMAIL")
    if not password:
        die("Missing FECO_PASSWORD")
    return Cfg(base_url=base_url, email=email, password=password)


class Client:
    def __init__(self, cfg: Cfg):
        self.cfg = cfg
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))
        self.access_token = None

    def request(self, method: str, path: str, json_body=None, auth: bool = False):
        url = urljoin(self.cfg.base_url, path.lstrip("/"))
        data = None
        headers = {}
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if auth:
            if not self.access_token:
                die("Internal: missing access token")
            headers["Authorization"] = f"Bearer {self.access_token}"
        req = Request(url, method=method, data=data, headers=headers)
        try:
            with self.opener.open(req, timeout=10) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, raw
        except HTTPError as e:
            raw = e.read().decode("utf-8") if e.fp else ""
            return e.code, raw
        except URLError as e:
            return 0, str(e)

    def request_raw(self, method: str, path: str, body: bytes, content_type: str, auth: bool = False):
        url = urljoin(self.cfg.base_url, path.lstrip("/"))
        headers = {"Content-Type": content_type}
        if auth:
            if not self.access_token:
                die("Internal: missing access token")
            headers["Authorization"] = f"Bearer {self.access_token}"
        req = Request(url, method=method, data=body, headers=headers)
        try:
            with self.opener.open(req, timeout=20) as resp:
                raw = resp.read()
                return resp.status, raw, dict(resp.headers)
        except HTTPError as e:
            raw = e.read() if e.fp else b""
            return e.code, raw, {}
        except URLError as e:
            return 0, str(e).encode("utf-8"), {}


def build_multipart(fields, files):
    boundary = "----fecoBoundary" + str(int(time.time() * 1000))
    parts = []
    for (k, v) in (fields or {}).items():
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
        parts.append(str(v).encode())
        parts.append(b"\r\n")
    for f in files or []:
        fieldname = f["fieldname"]
        filename = f["filename"]
        content_type = f["content_type"]
        data = f["data"]
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(
            f'Content-Disposition: form-data; name="{fieldname}"; filename="{filename}"\r\n'.encode()
        )
        parts.append(f"Content-Type: {content_type}\r\n\r\n".encode())
        parts.append(data)
        parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    return body, f"multipart/form-data; boundary={boundary}"


def assert_json(status: int, raw: str):
    try:
        return json.loads(raw)
    except Exception:
        die(f"Expected JSON, got status={status}, body={raw[:200]}")


def main() -> int:
    cfg = read_cfg()
    c = Client(cfg)
    errors = []
    ctx = {}

    def step(name: str, fn):
        print(f"[TEST] {name} ...", end=" ")
        try:
            fn()
            print("OK")
        except Exception as e:
            print("FAIL")
            errors.append((name, str(e)))

    # 0) health
    def s0():
        st, raw = c.request("GET", "/health")
        if st != 200:
            raise RuntimeError(f"health status={st} body={raw[:200]}")
        body = assert_json(st, raw)
        if body.get("ok") is not True:
            raise RuntimeError(f"health ok!=true: {body}")

    # 1) login
    def s1():
        st, raw = c.request("POST", "/api/v1/auth/login", {"email": cfg.email, "password": cfg.password})
        if st != 200:
            raise RuntimeError(f"login status={st} body={raw[:200]}")
        body = assert_json(st, raw)
        token = body.get("accessToken")
        if not token:
            raise RuntimeError(f"missing accessToken: {body}")
        c.access_token = token

    # 2) me (bearer)
    def s2():
        st, raw = c.request("GET", "/api/v1/auth/me", auth=True)
        if st != 200:
            raise RuntimeError(f"me status={st} body={raw[:200]}")
        body = assert_json(st, raw)
        if body.get("user", {}).get("email") != cfg.email:
            raise RuntimeError(f"me email mismatch: {body}")

    # 3) refresh (cookie)
    def s3():
        st, raw = c.request("POST", "/api/v1/auth/refresh")
        if st != 200:
            raise RuntimeError(f"refresh status={st} body={raw[:200]}")
        body = assert_json(st, raw)
        token = body.get("accessToken")
        if not token:
            raise RuntimeError(f"missing accessToken on refresh: {body}")
        c.access_token = token

    # 4) create hotel + structure + bulk rooms
    def s4():
        suffix = int(time.time())
        st, raw = c.request("POST", "/api/v1/hotels", {"name": f"SmokeTest Hotel {suffix}"}, auth=True)
        if st not in (200, 201):
            raise RuntimeError(f"create hotel status={st} body={raw[:200]}")
        hotel = assert_json(st, raw).get("hotel") or {}
        hotel_id = hotel.get("id")
        if not hotel_id:
            raise RuntimeError(f"missing hotel.id: {hotel}")
        ctx["hotel_id"] = hotel_id

        st, raw = c.request("POST", "/api/v1/hotels", {"name": f"SmokeTest Other Hotel {suffix}"}, auth=True)
        if st not in (200, 201):
            raise RuntimeError(f"create other hotel status={st} body={raw[:200]}")
        other = assert_json(st, raw).get("hotel") or {}
        other_hotel_id = other.get("id")
        if not other_hotel_id:
            raise RuntimeError(f"missing other hotel.id: {other}")
        ctx["other_hotel_id"] = other_hotel_id

        st, raw = c.request("POST", f"/api/v1/hotels/{hotel_id}/buildings", {"name": "Building A"}, auth=True)
        if st not in (200, 201):
            raise RuntimeError(f"create building status={st} body={raw[:200]}")
        building = assert_json(st, raw).get("building") or {}
        building_id = building.get("id")
        if not building_id:
            raise RuntimeError(f"missing building.id: {building}")

        st, raw = c.request("POST", f"/api/v1/buildings/{building_id}/floors", {"nameOrNumber": "2"}, auth=True)
        if st not in (200, 201):
            raise RuntimeError(f"create floor status={st} body={raw[:200]}")
        floor = assert_json(st, raw).get("floor") or {}
        floor_id = floor.get("id")
        if not floor_id:
            raise RuntimeError(f"missing floor.id: {floor}")
        ctx["floor_id"] = floor_id

        st, raw = c.request(
            "POST",
            f"/api/v1/floors/{floor_id}/rooms/bulk",
            {"start": 201, "count": 10, "surface": "BOTH", "sqft": 420},
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"bulk rooms status={st} body={raw[:200]}")
        body = assert_json(st, raw)
        if body.get("createdCount") is None:
            raise RuntimeError(f"missing createdCount: {body}")

        st, raw = c.request("POST", f"/api/v1/floors/{floor_id}/spaces", {"name": "Main Corridor", "sqft": 1200}, auth=True)
        if st not in (200, 201):
            raise RuntimeError(f"create space status={st} body={raw[:200]}")
        space = assert_json(st, raw).get("space") or {}
        space_id = space.get("id")
        if not space_id:
            raise RuntimeError(f"missing space.id: {space}")
        ctx["space_id"] = space_id

        st, raw = c.request("GET", f"/api/v1/floors/{floor_id}/rooms", auth=True)
        if st != 200:
            raise RuntimeError(f"list rooms status={st} body={raw[:200]}")
        rooms = assert_json(st, raw).get("rooms") or []
        if len(rooms) < 1:
            raise RuntimeError("rooms list empty")
        ctx["room_id"] = rooms[0].get("id")

        # Patch structure fields (notes/sortOrder + cleaning schedule)
        st, raw = c.request(
            "PATCH",
            f"/api/v1/floors/{floor_id}",
            {"notes": "Smoke notes", "sortOrder": 2},
            auth=True,
        )
        if st != 200:
            raise RuntimeError(f"patch floor status={st} body={raw[:200]}")

        st, raw = c.request(
            "PATCH",
            f"/api/v1/rooms/{ctx['room_id']}",
            {"cleaningFrequency": 183, "lastCleaned": int(time.time() * 1000), "notes": "Smoke room"},
            auth=True,
        )
        if st != 200:
            raise RuntimeError(f"patch room status={st} body={raw[:200]}")

        st, raw = c.request(
            "PATCH",
            f"/api/v1/spaces/{space_id}",
            {"type": "CORRIDOR", "cleaningFrequency": 183},
            auth=True,
        )
        if st != 200:
            raise RuntimeError(f"patch space status={st} body={raw[:200]}")

        # Contracts: create (admin) + fetch/accept via token (public)
        st, raw = c.request(
            "POST",
            f"/api/v1/hotels/{hotel_id}/contracts",
            {
                "hotelName": f"SmokeTest Hotel {suffix}",
                "contact": {"name": "Smoke Manager", "email": "smoke.manager@example.com", "cc": []},
                "pricing": {
                    "basePrices": {"BOTH": 65, "CARPET": 45, "TILE": 40},
                    "penaltyPrices": {"BOTH": 75, "CARPET": 55, "TILE": 50},
                    "contractPrices": {"BOTH": 65, "CARPET": 45, "TILE": 40},
                    "advantagePrices": {"BOTH": 60, "CARPET": 42, "TILE": 38},
                    "sqftPrices": {"CARPET": 0, "TILE": 0},
                },
                "roomsMinPerSession": 10,
                "roomsMaxPerSession": 20,
                "roomsPerSession": 12,
                "frequency": "YEARLY",
                "surfaceType": "BOTH",
                "appliedTier": "Contract",
                "appliedPricePerRoom": 65,
                "otherSurfaces": {"carpetSqft": 0, "tileSqft": 0},
                "totalPerSession": 780,
                "notes": "Smoke contract",
                "sentAt": date.today().isoformat(),
            },
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create contract status={st} body={raw[:200]}")
        contract = assert_json(st, raw).get("contract") or {}
        contract_id = contract.get("id")
        contract_token = contract.get("token")
        if not contract_id or not contract_token:
            raise RuntimeError(f"missing contract id/token: {contract}")
        ctx["contract_id"] = contract_id

        st, raw = c.request("GET", f"/api/v1/contracts/by-token/{contract_token}")
        if st != 200:
            raise RuntimeError(f"get contract by token status={st} body={raw[:200]}")
        by_token = assert_json(st, raw).get("contract") or {}
        if by_token.get("id") != contract_id:
            raise RuntimeError(f"contract token lookup mismatch: {by_token}")

        st, raw = c.request(
            "POST",
            f"/api/v1/contracts/by-token/{contract_token}/accept",
            {"signedBy": "Smoke Hotel Manager"},
        )
        if st != 200:
            raise RuntimeError(f"accept contract by token status={st} body={raw[:200]}")
        accepted = assert_json(st, raw).get("contract") or {}
        if accepted.get("status") != "ACCEPTED" or accepted.get("signedBy") != "Smoke Hotel Manager":
            raise RuntimeError(f"contract not accepted: {accepted}")

        st, raw = c.request("GET", f"/api/v1/hotels/{hotel_id}/contracts", auth=True)
        if st != 200:
            raise RuntimeError(f"list contracts status={st} body={raw[:200]}")
        contracts = assert_json(st, raw).get("contracts") or []
        if not any(cc.get("id") == contract_id for cc in contracts):
            raise RuntimeError("created contract not found in list")

        # Create a task (hotel internal)
        # Create staff member
        st, raw = c.request(
            "POST",
            f"/api/v1/hotels/{hotel_id}/staff",
            {"firstName": "Maria", "lastName": "Lopez", "phone": "+1 305-555-0111", "notes": "Smoke"},
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create staff status={st} body={raw[:200]}")
        staff = assert_json(st, raw).get("staff") or {}
        staff_id = staff.get("id")
        staff_token = staff.get("token")
        if not staff_id or not staff_token:
            raise RuntimeError(f"missing staff id/token: {staff}")
        ctx["staff_id"] = staff_id

        st, raw = c.request(
            "POST",
            f"/api/v1/hotels/{hotel_id}/tasks",
            {
                "category": "TASK",
                "status": "OPEN",
                "type": "OTHER",
                "priority": "NORMAL",
                "description": "Smoke test task",
                "locations": [{"label": "Room 201"}],
                "assignedStaffId": staff_id,
                "actorRole": "hotel_manager",
            },
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create task status={st} body={raw[:200]}")
        task = assert_json(st, raw).get("task") or {}
        task_id = task.get("id")
        if not task_id:
            raise RuntimeError(f"missing task.id: {task}")
        ctx["task_id"] = task_id

        # Add event (note)
        st, raw = c.request(
            "POST",
            f"/api/v1/tasks/{task_id}/events",
            {"action": "NOTE_ADDED", "note": "Smoke test note", "actorRole": "hotel_manager"},
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"add task event status={st} body={raw[:200]}")
        ev = assert_json(st, raw).get("event") or {}
        if not ev.get("id"):
            raise RuntimeError(f"missing event.id: {ev}")

        # Patch task via legacy alias (should accept db id too)
        st, raw = c.request(
            "PATCH",
            f"/api/v1/tasks/by-legacy/{task_id}",
            {"assignedStaffId": staff_id, "status": "IN_PROGRESS"},
            auth=True,
        )
        if st != 200:
            raise RuntimeError(f"patch task (by-legacy) status={st} body={raw[:200]}")

        # Add event via legacy alias
        st, raw = c.request(
            "POST",
            f"/api/v1/tasks/by-legacy/{task_id}/events",
            {"action": "NOTE_ADDED", "note": "Smoke test note (legacy)", "actorRole": "hotel_manager"},
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"add task event (by-legacy) status={st} body={raw[:200]}")

        # List tasks
        st, raw = c.request("GET", f"/api/v1/hotels/{hotel_id}/tasks", auth=True)
        if st != 200:
            raise RuntimeError(f"list tasks status={st} body={raw[:200]}")
        tasks = assert_json(st, raw).get("tasks") or []
        if not any(t.get("id") == task_id for t in tasks):
            raise RuntimeError("created task not found in list")

        # Staff tasks
        st, raw = c.request("GET", f"/api/v1/staff/{staff_id}/tasks?hotelId={hotel_id}", auth=True)
        if st != 200:
            raise RuntimeError(f"list staff tasks status={st} body={raw[:200]}")
        staff_tasks = assert_json(st, raw).get("tasks") or []
        if not any(t.get("id") == task_id for t in staff_tasks):
            raise RuntimeError("created task not found in staff tasks")

        # Upload attachment (photo)
        # 1x1 transparent PNG
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc`\x00\x00\x00\x02"
            b"\x00\x01\xe2!\xbc3\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        body, ctype = build_multipart(
            fields={"actorRole": "hotel_staff"},
            files=[
                {
                    "fieldname": "file",
                    "filename": "smoke.png",
                    "content_type": "image/png",
                    "data": png,
                }
            ],
        )
        st, rawb, headers = c.request_raw(
            "POST",
            f"/api/v1/tasks/{task_id}/attachments",
            body=body,
            content_type=ctype,
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"upload attachment status={st} body={rawb[:200]}")
        bodyj = json.loads(rawb.decode("utf-8"))
        att = bodyj.get("attachment") or {}
        url = att.get("url")
        if not url:
            raise RuntimeError(f"missing attachment.url: {bodyj}")

        # Upload via legacy alias as well (should accept db id too)
        st, rawb2, headers = c.request_raw(
            "POST",
            f"/api/v1/tasks/by-legacy/{task_id}/attachments",
            body=body,
            content_type=ctype,
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"upload attachment (by-legacy) status={st} body={rawb2[:200]}")

        # Download attachment file
        st, rawfile, headers = c.request_raw("GET", url, body=b"", content_type="application/octet-stream", auth=True)
        if st != 200:
            raise RuntimeError(f"download attachment status={st} body={rawfile[:120]}")
        ct = (headers.get("Content-Type") or headers.get("content-type") or "")
        if "image/webp" not in ct:
            raise RuntimeError(f"unexpected content-type: {ct}")
        if len(rawfile) < 10:
            raise RuntimeError("downloaded file too small")

        # List attachments
        st, raw = c.request("GET", f"/api/v1/tasks/{task_id}/attachments", auth=True)
        if st != 200:
            raise RuntimeError(f"list attachments status={st} body={raw[:200]}")
        atts = assert_json(st, raw).get("attachments") or []
        if not any(a.get("url") == url for a in atts):
            raise RuntimeError("uploaded attachment not found in list")

        # Delete attachment
        attachment_id = att.get("id")
        st, raw = c.request("DELETE", f"/api/v1/tasks/{task_id}/attachments/{attachment_id}", auth=True)
        if st != 200:
            raise RuntimeError(f"delete attachment status={st} body={raw[:200]}")
        if assert_json(st, raw).get("ok") is not True:
            raise RuntimeError(f"delete attachment not ok: {raw[:120]}")

        # File should now 404
        st, rawfile, headers = c.request_raw("GET", url, body=b"", content_type="application/octet-stream", auth=True)
        if st != 404:
            raise RuntimeError(f"expected 404 after delete, got {st}")

    # 5) reservations + planning primitives
    def s5():
        hotel_id = ctx.get("hotel_id")
        room_id = ctx.get("room_id")
        space_id = ctx.get("space_id")
        if not hotel_id or not room_id or not space_id:
            raise RuntimeError("missing context from previous step")

        proposed_date = (date.today() + timedelta(days=10)).isoformat()
        report_year = int(proposed_date.split("-")[0])
        suffix = int(time.time())

        # Create reservation
        st, raw = c.request(
            "POST",
            f"/api/v1/hotels/{hotel_id}/reservations",
            {
                "hotelId": hotel_id,
                "roomIds": [room_id],
                "spaceIds": [space_id],
                "roomNotes": {room_id: "Deep clean"},
                "spaceNotes": {space_id: "High traffic"},
                "surfaceDefault": "BOTH",
                "roomSurfaceOverrides": {room_id: "CARPET"},
                "notesGlobal": "Smoke global",
                "notesOrg": "Smoke hotel",
                "durationMinutes": 180,
                "proposedDate": proposed_date,
                "proposedStart": "09:00",
            },
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create reservation status={st} body={raw[:200]}")
        reservation = assert_json(st, raw).get("reservation") or {}
        reservation_id = reservation.get("id")
        token = reservation.get("token")
        if not reservation_id or not token:
            raise RuntimeError(f"missing reservation id/token: {reservation}")

        # Get by token (public)
        st, raw = c.request("GET", f"/api/v1/reservations/by-token/{token}")
        if st != 200:
            raise RuntimeError(f"get reservation by token status={st} body={raw[:200]}")
        by_token = assert_json(st, raw).get("reservation") or {}
        if by_token.get("id") != reservation_id:
            raise RuntimeError(f"token lookup mismatch: {by_token}")

        # Hotel approves via token (limited patch)
        st, raw = c.request("PATCH", f"/api/v1/reservations/by-token/{token}", {"statusHotel": "APPROVED", "notesOrg": "Hotel approved"})
        if st != 200:
            raise RuntimeError(f"patch by token status={st} body={raw[:200]}")
        patched = assert_json(st, raw).get("reservation") or {}
        if patched.get("statusHotel") != "APPROVED":
            raise RuntimeError(f"statusHotel not approved: {patched}")

        # Admin approves via auth
        st, raw = c.request("PATCH", f"/api/v1/reservations/{reservation_id}", {"statusAdmin": "APPROVED"}, auth=True)
        if st != 200:
            raise RuntimeError(f"admin approve status={st} body={raw[:200]}")
        approved = assert_json(st, raw).get("reservation") or {}
        if approved.get("statusAdmin") != "APPROVED":
            raise RuntimeError(f"statusAdmin not approved: {approved}")

        # List reservations by hotel
        st, raw = c.request("GET", f"/api/v1/hotels/{hotel_id}/reservations", auth=True)
        if st != 200:
            raise RuntimeError(f"list reservations status={st} body={raw[:200]}")
        reservations = assert_json(st, raw).get("reservations") or []
        if not any(r.get("id") == reservation_id for r in reservations):
            raise RuntimeError("created reservation not found in list")

        # Blocked slots lifecycle (admin-only) + legacyId upsert
        block_legacy = f"block_smoke_{suffix}"
        st, raw = c.request(
            "POST",
            "/api/v1/blocked-slots",
            {"legacyId": block_legacy, "date": proposed_date, "start": "08:00", "end": "12:00", "note": "Smoke block"},
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create blocked slot status={st} body={raw[:200]}")
        slot = assert_json(st, raw).get("blockedSlot") or {}
        slot_id = slot.get("id")
        if not slot_id:
            raise RuntimeError(f"missing blockedSlot.id: {slot}")

        st, raw = c.request(
            "POST",
            "/api/v1/blocked-slots",
            {"legacyId": block_legacy, "date": proposed_date, "start": "08:30", "end": "12:30", "note": "Smoke block (updated)"},
            auth=True,
        )
        if st != 200:
            raise RuntimeError(f"upsert blocked slot status={st} body={raw[:200]}")
        slot2 = assert_json(st, raw).get("blockedSlot") or {}
        if slot2.get("id") != slot_id:
            raise RuntimeError("blocked slot upsert changed id")

        st, raw = c.request("GET", "/api/v1/blocked-slots", auth=True)
        if st != 200:
            raise RuntimeError(f"list blocked slots status={st} body={raw[:200]}")
        slots = assert_json(st, raw).get("blockedSlots") or []
        if not any(s.get("id") == slot_id for s in slots):
            raise RuntimeError("blocked slot not found in list")

        st, raw = c.request("DELETE", f"/api/v1/blocked-slots/{block_legacy}", auth=True)
        if st != 200:
            raise RuntimeError(f"delete blocked slot status={st} body={raw[:200]}")
        if assert_json(st, raw).get("ok") is not True:
            raise RuntimeError("delete blocked slot not ok")

        # Technicians + sessions
        tech_legacy = f"tech_smoke_{suffix}"
        st, raw = c.request(
            "POST",
            "/api/v1/technicians",
            {"legacyId": tech_legacy, "name": "Smoke Tech", "phone": "+1 555-0100"},
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create technician status={st} body={raw[:200]}")
        tech = assert_json(st, raw).get("technician") or {}
        tech_id = tech.get("id")
        if not tech_id:
            raise RuntimeError(f"missing technician.id: {tech}")

        st, raw = c.request(
            "POST",
            "/api/v1/technicians",
            {"legacyId": tech_legacy, "name": "Smoke Tech Updated", "phone": "+1 555-0100"},
            auth=True,
        )
        if st != 200:
            raise RuntimeError(f"upsert technician status={st} body={raw[:200]}")
        tech2 = assert_json(st, raw).get("technician") or {}
        if tech2.get("id") != tech_id:
            raise RuntimeError("technician upsert changed id")

        session_legacy = f"session_smoke_{suffix}"
        st, raw = c.request(
            "POST",
            f"/api/v1/hotels/{hotel_id}/sessions",
            {
                "legacyId": session_legacy,
                "hotelId": hotel_id,
                "roomIds": [room_id],
                "date": proposed_date,
                "start": "13:00",
                "end": "16:00",
                "technicianId": tech_id,
            },
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create session status={st} body={raw[:200]}")
        session = assert_json(st, raw).get("session") or {}
        session_id = session.get("id")
        if not session_id:
            raise RuntimeError(f"missing session.id: {session}")

        st, raw = c.request("GET", f"/api/v1/hotels/{hotel_id}/sessions", auth=True)
        if st != 200:
            raise RuntimeError(f"list sessions status={st} body={raw[:200]}")
        sessions = assert_json(st, raw).get("sessions") or []
        if not any(s.get("id") == session_id for s in sessions):
            raise RuntimeError("created session not found in list")

        st, raw = c.request("DELETE", f"/api/v1/hotels/{hotel_id}/sessions/{session_legacy}", auth=True)
        if st != 200:
            raise RuntimeError(f"delete session status={st} body={raw[:200]}")
        if assert_json(st, raw).get("ok") is not True:
            raise RuntimeError("delete session not ok")

        st, raw = c.request("DELETE", f"/api/v1/technicians/{tech_legacy}", auth=True)
        if st != 200:
            raise RuntimeError(f"delete technician status={st} body={raw[:200]}")
        if assert_json(st, raw).get("ok") is not True:
            raise RuntimeError("delete technician not ok")

        # Cancel reservation (admin)
        st, raw = c.request("POST", f"/api/v1/reservations/{reservation_id}/cancel", {"by": "admin", "reason": "Smoke cancel"}, auth=True)
        if st != 200:
            raise RuntimeError(f"cancel reservation status={st} body={raw[:200]}")
        cancelled = assert_json(st, raw).get("reservation") or {}
        if cancelled.get("statusAdmin") != "CANCELLED" or cancelled.get("statusHotel") != "CANCELLED":
            raise RuntimeError(f"reservation not cancelled: {cancelled}")

        # Delete reservation (admin)
        st, raw = c.request("DELETE", f"/api/v1/reservations/{reservation_id}", auth=True)
        if st != 200:
            raise RuntimeError(f"delete reservation status={st} body={raw[:200]}")
        if assert_json(st, raw).get("ok") is not True:
            raise RuntimeError("delete reservation not ok")

        # Reports (annual + roadmap) should work for the approved reservation.
        # Create another approved reservation for the roadmap date (since we just deleted the first one).
        st, raw = c.request(
            "POST",
            f"/api/v1/hotels/{hotel_id}/reservations",
            {
                "hotelId": hotel_id,
                "roomIds": [room_id],
                "spaceIds": [space_id],
                "surfaceDefault": "BOTH",
                "roomSurfaceOverrides": {room_id: "CARPET"},
                "notesGlobal": "Roadmap global",
                "notesOrg": "Roadmap org",
                "durationMinutes": 120,
                "proposedDate": proposed_date,
                "proposedStart": "10:30",
            },
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create reservation (roadmap) status={st} body={raw[:200]}")
        reservation2 = assert_json(st, raw).get("reservation") or {}
        reservation2_id = reservation2.get("id")
        token2 = reservation2.get("token")
        if not reservation2_id or not token2:
            raise RuntimeError(f"missing reservation2 id/token: {reservation2}")

        st, raw = c.request("PATCH", f"/api/v1/reservations/by-token/{token2}", {"statusHotel": "APPROVED"})
        if st != 200:
            raise RuntimeError(f"hotel approve (roadmap) status={st} body={raw[:200]}")
        st, raw = c.request("PATCH", f"/api/v1/reservations/{reservation2_id}", {"statusAdmin": "APPROVED"}, auth=True)
        if st != 200:
            raise RuntimeError(f"admin approve (roadmap) status={st} body={raw[:200]}")

        st, raw = c.request("GET", f"/api/v1/reports/annual?hotelId={hotel_id}&year={report_year}", auth=True)
        if st != 200:
            raise RuntimeError(f"annual report status={st} body={raw[:200]}")
        annual = assert_json(st, raw)
        if annual.get("hotelId") != hotel_id:
            raise RuntimeError("annual report hotelId mismatch")

        st, raw = c.request("GET", f"/api/v1/reports/roadmap?hotelId={hotel_id}&date={proposed_date}", auth=True)
        if st != 200:
            raise RuntimeError(f"roadmap report status={st} body={raw[:200]}")
        roadmap = assert_json(st, raw)
        if roadmap.get("hotelId") != hotel_id or roadmap.get("date") != proposed_date:
            raise RuntimeError("roadmap report mismatch")
        resv_items = roadmap.get("reservations") or []
        if not isinstance(resv_items, list) or len(resv_items) < 1:
            raise RuntimeError("roadmap reservations empty")

    # 6) contracts + pricing defaults
    def s6():
        hotel_id = ctx.get("hotel_id")
        if not hotel_id:
            raise RuntimeError("missing hotel context")

        # Pricing defaults (created lazily)
        st, raw = c.request("GET", "/api/v1/pricing/defaults", auth=True)
        if st != 200:
            raise RuntimeError(f"get pricing defaults status={st} body={raw[:200]}")
        defaults = assert_json(st, raw).get("defaults") or {}
        if defaults.get("organizationId") is None:
            raise RuntimeError(f"pricing defaults missing org: {defaults}")

        # Create contract
        st, raw = c.request(
            "POST",
            f"/api/v1/hotels/{hotel_id}/contracts",
            {
                "hotelId": hotel_id,
                "hotelName": "Smoke Contract Hotel",
                "contact": {"name": "Jane Smith", "email": "jane@hotel.com", "cc": ["ops@hotel.com"]},
                "pricing": {
                    "basePrices": {"BOTH": 65, "CARPET": 45, "TILE": 40},
                    "penaltyPrices": {"BOTH": 75, "CARPET": 55, "TILE": 50},
                    "contractPrices": {"BOTH": 65, "CARPET": 45, "TILE": 40},
                    "advantagePrices": {"BOTH": 60, "CARPET": 42, "TILE": 38},
                    "sqftPrices": {"CARPET": 0, "TILE": 0},
                },
                "roomsMinPerSession": 10,
                "roomsMaxPerSession": 20,
                "roomsPerSession": 15,
                "frequency": "YEARLY",
                "surfaceType": "BOTH",
                "appliedTier": "Contract",
                "appliedPricePerRoom": 65,
                "otherSurfaces": {"carpetSqft": 0, "tileSqft": 0},
                "totalPerSession": 975,
                "notes": "Smoke contract notes",
            },
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create contract status={st} body={raw[:200]}")
        contract = assert_json(st, raw).get("contract") or {}
        contract_id = contract.get("id")
        token = contract.get("token")
        if not contract_id or not token:
            raise RuntimeError(f"missing contract id/token: {contract}")

        # List contracts by hotel
        st, raw = c.request("GET", f"/api/v1/hotels/{hotel_id}/contracts", auth=True)
        if st != 200:
            raise RuntimeError(f"list contracts status={st} body={raw[:200]}")
        contracts = assert_json(st, raw).get("contracts") or []
        if not any(ct.get("id") == contract_id for ct in contracts):
            raise RuntimeError("created contract not found in list")

        # Public lookup by token
        st, raw = c.request("GET", f"/api/v1/contracts/by-token/{token}")
        if st != 200:
            raise RuntimeError(f"get contract by token status={st} body={raw[:200]}")
        by_token = assert_json(st, raw).get("contract") or {}
        if by_token.get("id") != contract_id:
            raise RuntimeError(f"contract token lookup mismatch: {by_token}")

        # Accept contract via token
        st, raw = c.request("POST", f"/api/v1/contracts/by-token/{token}/accept", {"signedBy": "Smoke Signer"})
        if st != 200:
            raise RuntimeError(f"accept contract status={st} body={raw[:200]}")
        accepted = assert_json(st, raw).get("contract") or {}
        if accepted.get("status") != "ACCEPTED":
            raise RuntimeError(f"contract not accepted: {accepted}")

        # Cleanup (admin delete)
        st, raw = c.request("DELETE", f"/api/v1/contracts/{contract_id}", auth=True)
        if st != 200:
            raise RuntimeError(f"delete contract status={st} body={raw[:200]}")
        if assert_json(st, raw).get("ok") is not True:
            raise RuntimeError("delete contract not ok")

    # 7) incidents (compat endpoints)
    def s7():
        hotel_id = ctx.get("hotel_id")
        staff_id = ctx.get("staff_id")
        if not hotel_id or not staff_id:
            raise RuntimeError("missing hotel/staff context")

        st, raw = c.request(
            "POST",
            f"/api/v1/hotels/{hotel_id}/incidents",
            {
                "room": "Room 201",
                "type": "OTHER",
                "priority": "NORMAL",
                "description": "Smoke incident",
                "assignedStaffId": staff_id,
                "actorRole": "hotel_manager",
            },
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create incident status={st} body={raw[:200]}")
        incident = assert_json(st, raw).get("incident") or {}
        incident_id = incident.get("id")
        if not incident_id:
            raise RuntimeError(f"missing incident.id: {incident}")
        if incident.get("category") != "INCIDENT":
            raise RuntimeError(f"incident category mismatch: {incident.get('category')}")

        # List incidents by hotel
        st, raw = c.request("GET", f"/api/v1/hotels/{hotel_id}/incidents", auth=True)
        if st != 200:
            raise RuntimeError(f"list incidents status={st} body={raw[:200]}")
        incidents = assert_json(st, raw).get("incidents") or []
        if not any(i.get("id") == incident_id for i in incidents):
            raise RuntimeError("created incident not found in list")

        # Add incident event
        st, raw = c.request(
            "POST",
            f"/api/v1/incidents/{incident_id}/events",
            {"action": "NOTE_ADDED", "note": "Smoke incident note", "actorRole": "hotel_manager"},
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"add incident event status={st} body={raw[:200]}")
        ev = assert_json(st, raw).get("event") or {}
        if not ev.get("id"):
            raise RuntimeError(f"missing incident event id: {ev}")

        # Get incident detail
        st, raw = c.request("GET", f"/api/v1/incidents/{incident_id}", auth=True)
        if st != 200:
            raise RuntimeError(f"get incident status={st} body={raw[:200]}")
        detail = assert_json(st, raw).get("incident") or {}
        if detail.get("id") != incident_id:
            raise RuntimeError("incident detail mismatch")

        # Staff incidents
        st, raw = c.request("GET", f"/api/v1/staff/{staff_id}/incidents?hotelId={hotel_id}", auth=True)
        if st != 200:
            raise RuntimeError(f"list staff incidents status={st} body={raw[:200]}")
        staff_incidents = assert_json(st, raw).get("incidents") or []
        if not any(i.get("id") == incident_id for i in staff_incidents):
            raise RuntimeError("incident not found in staff incidents")

    # 8) migration endpoints (shadow mode)
    def s8():
        # Export localStorage-shaped payload
        st, raw = c.request("GET", "/api/v1/migration/localstorage/export", auth=True)
        if st != 200:
            raise RuntimeError(f"migration export status={st} body={raw[:200]}")
        exported = assert_json(st, raw).get("data") or {}
        if exported.get("version") != 1:
            raise RuntimeError(f"unexpected export version: {exported.get('version')}")
        if not isinstance(exported.get("hotels"), dict):
            raise RuntimeError("exported.hotels is not an object")

        # Import it back (idempotent upsert)
        st, raw = c.request("POST", "/api/v1/migration/localstorage/import", json_body=exported, auth=True)
        if st != 200:
            raise RuntimeError(f"migration import status={st} body={raw[:200]}")
        body = assert_json(st, raw)
        if body.get("ok") is not True:
            raise RuntimeError(f"migration import not ok: {body}")

    # 9) hotel-scoped user auth + access control
    def s9():
        hotel_id = ctx.get("hotel_id")
        other_hotel_id = ctx.get("other_hotel_id")
        if not hotel_id or not other_hotel_id:
            raise RuntimeError("missing hotel context")

        email = f"hotel_admin_{int(time.time())}@example.com"
        password = "ScopedPass123$"

        st, raw = c.request(
            "POST",
            "/api/v1/users",
            {"email": email, "password": password, "role": "HOTEL_ADMIN", "hotelScopeId": hotel_id},
            auth=True,
        )
        if st not in (200, 201):
            raise RuntimeError(f"create scoped user status={st} body={raw[:200]}")
        created_user = assert_json(st, raw).get("user") or {}
        if created_user.get("hotelScopeId") != hotel_id:
            raise RuntimeError(f"user scope mismatch: {created_user}")

        scoped = Client(cfg)
        st, raw = scoped.request("POST", "/api/v1/auth/login", {"email": email, "password": password})
        if st != 200:
            raise RuntimeError(f"scoped login status={st} body={raw[:200]}")
        scoped.access_token = assert_json(st, raw).get("accessToken")
        if not scoped.access_token:
            raise RuntimeError("scoped missing access token")

        st, raw = scoped.request("GET", "/api/v1/auth/me", auth=True)
        if st != 200:
            raise RuntimeError(f"scoped me status={st} body={raw[:200]}")
        me = assert_json(st, raw).get("user") or {}
        if me.get("role") != "HOTEL_ADMIN":
            raise RuntimeError(f"scoped role mismatch: {me}")
        if me.get("hotelScopeId") != hotel_id:
            raise RuntimeError(f"scoped hotelScopeId mismatch: {me}")

        st, raw = scoped.request("GET", "/api/v1/hotels", auth=True)
        if st != 200:
            raise RuntimeError(f"scoped list hotels status={st} body={raw[:200]}")
        hotels = assert_json(st, raw).get("hotels") or []
        if len(hotels) != 1 or hotels[0].get("id") != hotel_id:
            raise RuntimeError(f"scoped hotels list not restricted: {hotels}")

        st, raw = scoped.request("GET", f"/api/v1/hotels/{other_hotel_id}/tasks", auth=True)
        if st != 403:
            raise RuntimeError(f"expected 403 on other hotel tasks, got {st} body={raw[:200]}")

        # Scoped migration export/import should work for the scoped hotel only.
        st, raw = scoped.request("GET", "/api/v1/migration/localstorage/export", auth=True)
        if st != 200:
            raise RuntimeError(f"scoped migration export status={st} body={raw[:200]}")
        exported = assert_json(st, raw).get("data") or {}
        hotels_obj = exported.get("hotels") or {}
        if not isinstance(hotels_obj, dict) or len(hotels_obj.keys()) != 1:
            raise RuntimeError(f"scoped export hotels not restricted: {list(hotels_obj.keys())}")

        # Change hotel name (allowed within scope) and import.
        only_key = list(hotels_obj.keys())[0]
        hotels_obj[only_key]["name"] = "Scoped Hotel Renamed"
        exported["hotels"] = hotels_obj
        st, raw = scoped.request("POST", "/api/v1/migration/localstorage/import", json_body=exported, auth=True)
        if st != 200:
            raise RuntimeError(f"scoped migration import status={st} body={raw[:200]}")
        if assert_json(st, raw).get("ok") is not True:
            raise RuntimeError("scoped migration import not ok")

    step("health", s0)
    step("login", s1)
    step("me", s2)
    step("refresh", s3)
    step("create structure + task flow", s4)
    step("reservations + planning", s5)
    step("contracts + pricing", s6)
    step("incidents", s7)
    step("migration shadow endpoints", s8)
    step("scoped user access", s9)

    if errors:
        print("\nErrors:", file=sys.stderr)
        for name, err in errors:
            print(f"- {name}: {err}", file=sys.stderr)
        return 1

    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
