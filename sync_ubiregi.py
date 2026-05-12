"""
ユビレジ → Supabase 同期スクリプト
budget-appと同じSupabaseプロジェクトのubiregi_*テーブルに書き込む

使い方:
  1. pip install requests supabase python-dotenv
  2. .env.local に以下を追加:
       UBIREGI_API_TOKEN=your_token
       UBIREGI_ACCOUNT_ID=your_account_id
       SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
  3. python sync_ubiregi.py           # 増分同期
     python sync_ubiregi.py --full    # フル同期（初回）
     python sync_ubiregi.py --since 2024-06-01 --until 2024-06-30  # 再同期
"""

import os
import sys
import time
import argparse
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

load_dotenv(".env.local")

UBIREGI_TOKEN      = os.environ["UBIREGI_API_TOKEN"]
UBIREGI_ACCOUNT_ID = os.environ["UBIREGI_ACCOUNT_ID"]
UBIREGI_BASE_URL   = "https://ubiregi.com/api/3"
SUPABASE_URL       = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY       = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

import requests
from supabase import create_client

supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)


_RETRYABLE = ("ConnectionTerminated", "ConnectError", "RemoteProtocolError", "ReadError", "TimeoutException")

def sb_execute(op, retries=4):
    """Supabase操作をリトライ付きで実行（接続切断・DNS一時失敗対策）"""
    global supabase_client
    for attempt in range(retries):
        try:
            return op()
        except Exception as e:
            err = str(e) + type(e).__name__
            if attempt < retries - 1 and any(k in err for k in _RETRYABLE):
                time.sleep(3 ** attempt)
                supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
            else:
                raise

def _new_session():
    s = requests.Session()
    s.headers.update({
        "X-Ubiregi-Auth-Token": UBIREGI_TOKEN,
        "Accept": "application/json",
    })
    return s

session = _new_session()


# ── API ──────────────────────────────────────────────────────

def api_get(path, params=None, retries=4):
    global session
    time.sleep(0.5)  # レート制御
    for attempt in range(retries):
        try:
            resp = session.get(f"{UBIREGI_BASE_URL}{path}", params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            if attempt < retries - 1:
                time.sleep(3 ** attempt)
                session = _new_session()
            else:
                raise


def paginate(path, key, params=None):
    params = dict(params or {})
    params["count"] = 100
    current_path = path
    while True:
        data = api_get(current_path, params)
        yield from data.get(key, [])
        next_url = data.get("next-url")
        if not next_url:
            break
        current_path = next_url.replace(UBIREGI_BASE_URL, "")
        params = {}


# ── 変換 ─────────────────────────────────────────────────────

def parse_dt(v):
    if not v:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            dt = datetime.strptime(v, fmt)
            if dt.tzinfo is None:
                import pytz
                dt = pytz.timezone("Asia/Tokyo").localize(dt)
            return dt.astimezone(timezone.utc).isoformat()
        except:
            continue
    return None


def to_f(v):
    try:
        return float(v) if v is not None else None
    except:
        return None


# ── 同期処理 ──────────────────────────────────────────────────

def sync_masters():
    print("マスタデータを同期中...")
    acc_id = int(UBIREGI_ACCOUNT_ID)

    # アカウント情報取得（menu_id、cashiers、payment_types を含む）
    acc_data = api_get(f"/accounts/{acc_id}")
    account = acc_data["account"]
    menu_ids = account.get("menus", [])
    menu_id = menu_ids[0] if menu_ids else None

    # カテゴリ（/menus/{menu_id}/categories）
    cats = list(paginate(f"/menus/{menu_id}/categories", "categories")) if menu_id else []
    if cats:
        rows = [{
            "id":         int(c["id"]),
            "account_id": acc_id,
            "name":       c.get("name", ""),
            "parent_id":  None,
            "is_deleted": not bool(c.get("enabled", True)),
            "raw_data":   c,
        } for c in cats]
        supabase_client.table("ubiregi_categories").upsert(rows, on_conflict="id").execute()
        print(f"  カテゴリ: {len(rows)} 件")

    # 商品（/menus/{menu_id}/items）
    items = list(paginate(f"/menus/{menu_id}/items", "items")) if menu_id else []
    if items:
        rows = [{
            "id":          int(m["id"]),
            "account_id":  acc_id,
            "category_id": int(m["category_id"]) if m.get("category_id") else None,
            "name":        m.get("name", ""),
            "price":       to_f(m.get("price")),
            "cost_price":  None,
            "tax_type":    m.get("price_type"),
            "tax_rate":    round(to_f(m.get("vat")) / 100, 6) if to_f(m.get("vat")) is not None else None,
            "is_hidden":   not bool(m.get("enabled", True)),
            "is_deleted":  False,
            "raw_data":    m,
        } for m in items]
        supabase_client.table("ubiregi_menu_items").upsert(rows, on_conflict="id").execute()
        print(f"  商品: {len(rows)} 件")

    # スタッフ（アカウントに埋め込み済み）
    cashiers = account.get("cashiers", [])
    if cashiers:
        rows = [{
            "id":         int(c["id"]),
            "account_id": acc_id,
            "name":       c.get("name", ""),
            "is_deleted": not bool(c.get("enabled", True)),
            "raw_data":   c,
        } for c in cashiers]
        supabase_client.table("ubiregi_cashiers").upsert(rows, on_conflict="id").execute()
        print(f"  スタッフ: {len(cashiers)} 件")

    # 支払方法（アカウントに埋め込み済み）
    payment_types = account.get("payment_types", [])
    if payment_types:
        rows = [{
            "id":             int(p["id"]),
            "account_id":     acc_id,
            "name":           p.get("name", ""),
            "payment_method": p.get("kind"),
            "is_deleted":     not bool(p.get("enabled", True)),
            "raw_data":       p,
        } for p in payment_types]
        supabase_client.table("ubiregi_payment_types").upsert(rows, on_conflict="id").execute()
        print(f"  支払方法: {len(rows)} 件")

    # checkout用の名前ルックアップマップを返す
    item_map = {
        int(m["id"]): {
            "name":          m.get("name", ""),
            "category_id":   int(m["category_id"]) if m.get("category_id") else None,
            "category_name": m.get("category_name"),
        }
        for m in items
    }
    payment_map = {
        int(p["id"]): {"name": p.get("name", ""), "kind": p.get("kind")}
        for p in payment_types
    }
    return item_map, payment_map


def sync_checkouts(since=None, until=None, item_map=None, payment_map=None):
    acc_id = int(UBIREGI_ACCOUNT_ID)
    item_map = item_map or {}
    payment_map = payment_map or {}
    params = {}
    if since:
        params["since"] = since.strftime("%Y-%m-%dT%H:%M:%SZ")
    if until:
        params["until"] = until.strftime("%Y-%m-%dT%H:%M:%SZ")

    total = 0
    for raw in paginate(f"/accounts/{acc_id}/checkouts", "checkouts", params):
        co_id = int(raw["id"])

        taxes = raw.get("taxes", [])
        total_tax = sum(to_f(t.get("tax", 0)) or 0 for t in taxes)
        total_price = to_f(raw.get("price", 0)) or 0

        # 会計ヘッダ
        checkout_row = {
            "id":              co_id,
            "account_id":      acc_id,
            "cashier_id":      int(raw["cashier_id"]) if raw.get("cashier_id") else None,
            "table_name":      raw.get("memo"),
            "subtotal":        round(total_price - total_tax, 2),
            "tax_amount":      total_tax,
            "total":           total_price,
            "discount_amount": to_f(raw.get("modifier", 0)),
            "status":          "closed" if raw.get("status") in ("close", "closed") else (raw.get("status") or "closed"),
            "paid_at":         parse_dt(raw.get("paid_at") or raw.get("created_at")),
            "updated_at":      parse_dt(raw.get("updated_at")),
            "raw_data":        raw,
        }
        sb_execute(lambda row=checkout_row: supabase_client.table("ubiregi_checkouts").upsert(row, on_conflict="id").execute())

        # 明細（DELETE → INSERT）
        sb_execute(lambda: supabase_client.table("ubiregi_checkout_items").delete().eq("checkout_id", co_id).execute())
        line_items = raw.get("items", [])
        if line_items:
            item_rows = []
            for item in line_items:
                mid = int(item["menu_item_id"]) if item.get("menu_item_id") else None
                info = item_map.get(mid, {}) if mid else {}
                qty = to_f(item.get("count", 1)) or 1
                sales_val = to_f(item.get("sales", 0)) or 0
                raw_unit = to_f(item.get("unit_price"))
                unit_price_val = raw_unit if raw_unit is not None else round(sales_val / qty, 2)
                item_rows.append({
                    "id":              int(item["id"]),
                    "checkout_id":     co_id,
                    "account_id":      acc_id,
                    "menu_item_id":    mid,
                    "menu_item_name":  info.get("name", ""),
                    "category_id":     info.get("category_id"),
                    "category_name":   info.get("category_name"),
                    "quantity":        qty,
                    "unit_price":      unit_price_val,
                    "cost_price":      None,
                    "tax_type":        item.get("price_type"),
                    "tax_rate":        round(to_f(item.get("tax_rate")) / 100, 6) if to_f(item.get("tax_rate")) is not None else None,
                    "tax_amount":      to_f(item.get("tax", 0)),
                    "subtotal":        sales_val,
                    "discount_amount": to_f(item.get("discount_sales", 0)),
                    "raw_data":        item,
                })
            # 同一checkout内のitem ID重複を除去
            seen_ids = set()
            deduped = [r for r in item_rows if r["id"] not in seen_ids and not seen_ids.add(r["id"])]
            sb_execute(lambda rows=deduped: supabase_client.table("ubiregi_checkout_items").upsert(rows, on_conflict="id").execute())

        # 支払い
        sb_execute(lambda: supabase_client.table("ubiregi_checkout_payments").delete().eq("checkout_id", co_id).execute())
        payments = raw.get("payments", [])
        if payments:
            pay_rows = []
            for p in payments:
                pt_id = int(p["payment_type_id"]) if p.get("payment_type_id") else None
                pt_info = payment_map.get(pt_id, {}) if pt_id else {}
                pay_rows.append({
                    "checkout_id":       co_id,
                    "account_id":        acc_id,
                    "payment_type_id":   pt_id,
                    "payment_type_name": pt_info.get("name"),
                    "payment_method":    pt_info.get("kind"),
                    "amount":            to_f(p.get("amount", 0)),
                    "raw_data":          p,
                })
            sb_execute(lambda rows=pay_rows: supabase_client.table("ubiregi_checkout_payments").insert(rows).execute())

        total += 1
        if total % 50 == 0:
            print(f"  {total} 件処理済み...")

    print(f"  会計データ: {total} 件完了")
    return total


def get_last_sync():
    """最終成功同期日時を取得"""
    res = supabase_client.table("ubiregi_sync_logs") \
        .select("finished_at") \
        .eq("target", "checkouts") \
        .eq("status", "success") \
        .order("finished_at", desc=True) \
        .limit(1) \
        .execute()
    if res.data:
        return datetime.fromisoformat(res.data[0]["finished_at"])
    return None


def log_sync(sync_type, target, status, fetched=0, upserted=0, error=None, since=None, until=None):
    supabase_client.table("ubiregi_sync_logs").insert({
        "sync_type":        sync_type,
        "target":           target,
        "account_id":       int(UBIREGI_ACCOUNT_ID),
        "status":           status,
        "records_fetched":  fetched,
        "records_upserted": upserted,
        "since_datetime":   since.isoformat() if since else None,
        "until_datetime":   until.isoformat() if until else None,
        "error_message":    str(error)[:500] if error else None,
        "finished_at":      datetime.now(timezone.utc).isoformat(),
    }).execute()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full",  action="store_true", help="全期間フル同期")
    parser.add_argument("--since", help="開始日 YYYY-MM-DD")
    parser.add_argument("--until", help="終了日 YYYY-MM-DD")
    args = parser.parse_args()

    print("=== ユビレジ → Supabase 同期 ===\n")

    # マスタは毎回同期
    item_map, payment_map = sync_masters()

    # 会計データの期間を決定
    since, until = None, None

    if args.since:
        import pytz
        JST = pytz.timezone("Asia/Tokyo")
        since = JST.localize(datetime.strptime(args.since, "%Y-%m-%d")).astimezone(timezone.utc)
        until_date = args.until or args.since
        until = JST.localize(datetime.strptime(until_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)).astimezone(timezone.utc)
        sync_type = "manual"
        print(f"\n会計データ再同期: {args.since} ～ {until_date}")
    elif args.full:
        sync_type = "full"
        print("\n会計データ: フル同期（全期間）")
    else:
        sync_type = "incremental"
        last = get_last_sync()
        if last:
            since = last - timedelta(minutes=10)
            print(f"\n会計データ: 増分同期（{since.strftime('%Y-%m-%d %H:%M')} 以降）")
        else:
            print("\n前回同期なし → フル同期にフォールバック")
            sync_type = "full"

    try:
        n = sync_checkouts(since=since, until=until, item_map=item_map, payment_map=payment_map)
        log_sync(sync_type, "checkouts", "success", fetched=n, upserted=n, since=since, until=until)
        print(f"\n✅ 完了: {n} 件")
    except Exception as e:
        log_sync(sync_type, "checkouts", "error", error=e, since=since, until=until)
        print(f"\n❌ エラー: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
