#!/usr/bin/env python3
import json
import os
import sys
import time
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
            with self.opener.open(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, raw
        except HTTPError as e:
            raw = e.read().decode("utf-8") if e.fp else ""
            return e.code, raw
        except URLError as e:
            return 0, str(e)


def assert_json(status: int, raw: str):
    try:
        return json.loads(raw)
    except Exception:
        die(f"Expected JSON, got status={status}, body={raw[:200]}")


def main() -> int:
    cfg = read_cfg()
    c = Client(cfg)

    def step(name: str, fn):
        print(f"[CRM] {name} ...", end=" ")
        fn()
        print("OK")

    step(
        "health",
        lambda: (
            lambda st, raw: (st == 200 and assert_json(st, raw).get("ok") is True)
            or die(f"health status={st} body={raw[:200]}")
        )(*c.request("GET", "/health")),
    )

    def login():
        st, raw = c.request("POST", "/api/v1/auth/login", {"email": cfg.email, "password": cfg.password})
        if st != 200:
            die(f"login status={st} body={raw[:200]}")
        token = assert_json(st, raw).get("accessToken")
        if not token:
            die(f"missing accessToken: {raw[:200]}")
        c.access_token = token

    step("login", login)

    suffix = int(time.time())
    campaign_name = f"CRM Smoke Campaign {suffix}"

    # Create campaign (2 steps)
    st, raw = c.request("POST", "/api/v1/crm/campaigns", {"name": campaign_name, "stepsCount": 2}, auth=True)
    if st not in (200, 201):
        die(f"create campaign status={st} body={raw[:200]}")
    campaign = assert_json(st, raw).get("campaign") or {}
    campaign_id = campaign.get("id")
    if not campaign_id:
        die("missing campaign.id")

    # Fill templates
    st, raw = c.request(
        "PATCH",
        f"/api/v1/crm/campaigns/{campaign_id}/emails/1",
        {
            "sendTime": "13:00",
            "delayDaysAfter": 1,
            "subjectTemplate": "Hello {{firstName}}",
            "bodyTemplate": "Hi {{firstName}}, about {{hotelName}}."
        },
        auth=True,
    )
    if st != 200:
        die(f"patch email1 status={st} body={raw[:200]}")

    st, raw = c.request(
        "PATCH",
        f"/api/v1/crm/campaigns/{campaign_id}/emails/2",
        {
            "sendTime": "13:00",
            "subjectTemplate": "Last call {{hotelName}}",
            "bodyTemplate": "Final message for {{hotelName}}."
        },
        auth=True,
    )
    if st != 200:
        die(f"patch email2 status={st} body={raw[:200]}")

    # Publish
    st, raw = c.request("POST", f"/api/v1/crm/campaigns/{campaign_id}/publish", {}, auth=True)
    if st != 200:
        die(f"publish campaign status={st} body={raw[:200]}")

    # Create lead
    st, raw = c.request(
        "POST",
        "/api/v1/crm/leads",
        {"hotelName": f"Smoke Hotel {suffix}", "firstName": "Paul", "lastName": "Martin", "email1": f"smoke{suffix}@example.com"},
        auth=True,
    )
    if st not in (200, 201):
        die(f"create lead status={st} body={raw[:200]}")
    lead = assert_json(st, raw).get("lead") or {}
    lead_id = lead.get("id")
    if not lead_id:
        die("missing lead.id")

    # Start campaign for lead
    st, raw = c.request(
        "POST", f"/api/v1/crm/leads/{lead_id}/start-campaign", {"campaignId": campaign_id}, auth=True
    )
    if st not in (200, 201):
        die(f"start campaign status={st} body={raw[:200]}")
    lc = assert_json(st, raw).get("leadCampaign") or {}
    lc_id = lc.get("id")
    if not lc_id:
        die("missing leadCampaign.id")

    # Messages should exist (step 1 scheduled)
    st, raw = c.request("GET", f"/api/v1/crm/lead-campaigns/{lc_id}/messages", auth=True)
    if st != 200:
        die(f"list messages status={st} body={raw[:200]}")
    msgs = assert_json(st, raw).get("messages") or []
    if len(msgs) < 1:
        die("expected at least 1 scheduled message")
    if msgs[0].get("stepIndex") != 1:
        die(f"expected stepIndex=1, got {msgs[0].get('stepIndex')}")

    print(f"[CRM] OK campaign={campaign_id} lead={lead_id} leadCampaign={lc_id} messages={len(msgs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

