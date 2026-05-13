"""
ユビレジ → Supabase 同期スクリプト

使い方:
  pip install requests supabase python-dotenv

  # 単一店舗（.env.localのデフォルトを使用）
  python sync_ubiregi.py
  python sync_ubiregi.py --full

  # 店舗を指定して実行
  python sync_ubiregi.py --full --token TOKEN --account-id 12345

  # 全店舗を一括同期（.env.localにSTORE_N_TOKEN / STORE_N_ACCOUNT_ID を設定）
  python sync_ubiregi.py --full --all-stores

.env.local に設定する変数:
  # デフォルト店舗（後方互換）
  UBIREGI_API_TOKEN=...
  UBIREGI_ACCOUNT_ID=...

  # 追加店舗
  UBIREGI_STORE_2_TOKEN=...
  UBIREGI_STORE_2_ACCOUNT_ID=...
  UBIREGI_STORE_3_TOKEN=...
  UBIREGI_STORE_3_ACCOUNT_ID=...

  SUPABASE_SERVICE_ROLE_KEY=...
  NEXT_PUBLIC_SUPABASE_URL=...
"""

import os
import sys
import time
import argparse
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

load_dotenv(".env.local")

UBIREGI_BASE_URL = "https://ubiregi.com/api/3"
SUPABASE_URL     = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY     = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

import requests
from supabase import create_client

supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)


_RETRYABLE = ("ConnectionTerminated", "ConnectError", "RemoteProtocolError", "ReadError", "TimeoutException", "57014", "statement timeout")

def sb_execute(op, retries=4):
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


def make_session(token):
    s = requests.Session()
    s.headers.update({
        "X-Ubiregi-Auth-Token": token,
        "Accept": "application/json",
    })
    return s


def api_get(session, path, params=None, retries=4):
    time.sleep(0.5)
    for attempt in range(retries):
        try:
            resp = session.get(f"{UBIREGI_BASE_URL}{path}", params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            if attempt < retries - 1:
                time.sleep(3 ** attempt)
            else:
                raise


def paginate(session, path, key, params=None):
    params = dict(params or {})
    params["count"] = 100
    current_path = path
    while True:
        data = api_get(session, current_path, params)
        yield from data.get(key, [])
        next_url = data.get("next-url")
        if not next_url:
            break
        current_path = next_url.replace(UBIREGI_BASE_URL, "")
        params = {}


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


def sync_masters(session, acc_id):
    print(f"  マスタデータを同期中 (account_id={acc_id})...")

    acc_data = api_get(session, f"/accounts/{acc_id}")
    account  = acc_data["account"]
    menu_ids = account.get("menus", [])
    menu_id  = menu_ids[0] if menu_ids else None

    cats = list(paginate(session, f"/menus/{menu_id}/categories", "categories")) if menu_id else []
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
        print(f"    カテゴリ: {len(rows)} 件")

    items = list(paginate(session, f"/menus/{menu_id}/items", "items")) if menu_id else []
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
        print(f"    商品: {len(rows)} 件")

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
        print(f"    スタッフ: {len(cashiers)} 件")

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
        print(f"    支払方法: {len(rows)} 件")

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


def sync_checkouts(session, acc_id, since=None, until=None, item_map=None, payment_map=None):
    item_map    = item_map    or {}
    payment_map = payment_map or {}
    params      = {}
    if since:
        params["since"] = since.strftime("%Y-%m-%dT%H:%M:%SZ")
    if until:
        params["until"] = until.strftime("%Y-%m-%dT%H:%M:%SZ")

    total = 0
    for raw in paginate(session, f"/accounts/{acc_id}/checkouts", "checkouts", params):
        co_id = int(raw["id"])

        taxes      = raw.get("taxes", [])
        total_tax  = sum(to_f(t.get("tax", 0)) or 0 for t in taxes)
        total_price = to_f(raw.get("price", 0)) or 0

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
            seen_ids = set()
            deduped = [r for r in item_rows if r["id"] not in seen_ids and not seen_ids.add(r["id"])]
            sb_execute(lambda rows=deduped: supabase_client.table("ubiregi_checkout_items").upsert(rows, on_conflict="id").execute())

        sb_execute(lambda: supabase_client.table("ubiregi_checkout_payments").delete().eq("checkout_id", co_id).execute())
        payments = raw.get("payments", [])
        if payments:
            pay_rows = []
            for p in payments:
                pt_id   = int(p["payment_type_id"]) if p.get("payment_type_id") else None
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
            print(f"    {total} 件処理済み...")

    return total


def parse_db_dt(ts):
    """DB返却タイムスタンプ用（Python 3.9 fromisoformat 制限回避: Z・5桁μs・+HH:MM）"""
    import re
    if not ts:
        return None
    ts = re.sub(r'\.(\d+)', lambda m: '.' + (m.group(1) + '000000')[:6], ts)
    ts = ts.rstrip('Z')
    ts = re.sub(r'[+-]\d{2}:\d{2}$', '', ts)
    return datetime.fromisoformat(ts).replace(tzinfo=timezone.utc)


def get_last_sync(acc_id):
    res = supabase_client.table("ubiregi_sync_logs") \
        .select("finished_at") \
        .eq("target", "checkouts") \
        .eq("account_id", acc_id) \
        .eq("status", "success") \
        .order("finished_at", desc=True) \
        .limit(1) \
        .execute()
    if res.data:
        return parse_db_dt(res.data[0]["finished_at"])
    return None


def log_sync(sync_type, target, acc_id, status, fetched=0, upserted=0, error=None, since=None, until=None):
    supabase_client.table("ubiregi_sync_logs").insert({
        "sync_type":        sync_type,
        "target":           target,
        "account_id":       acc_id,
        "status":           status,
        "records_fetched":  fetched,
        "records_upserted": upserted,
        "since_datetime":   since.isoformat() if since else None,
        "until_datetime":   until.isoformat() if until else None,
        "error_message":    str(error)[:500] if error else None,
        "finished_at":      datetime.now(timezone.utc).isoformat(),
    }).execute()


def get_store_configs():
    """全店舗の設定を収集（デフォルト + STORE_N）"""
    stores = []
    default_token = os.environ.get("UBIREGI_API_TOKEN")
    default_acc   = os.environ.get("UBIREGI_ACCOUNT_ID")
    if default_token and default_acc:
        stores.append({"token": default_token, "account_id": int(default_acc)})

    for n in range(2, 20):
        token  = os.environ.get(f"UBIREGI_STORE_{n}_TOKEN")
        acc_id = os.environ.get(f"UBIREGI_STORE_{n}_ACCOUNT_ID")
        if token and acc_id:
            stores.append({"token": token, "account_id": int(acc_id)})

    return stores


def sync_store(token, acc_id, sync_type, since, until):
    print(f"\n{'='*50}")
    print(f"店舗同期: account_id={acc_id}")
    print(f"{'='*50}")
    session = make_session(token)

    item_map, payment_map = sync_masters(session, acc_id)

    print(f"  会計データ同期中 (account_id={acc_id})...")
    try:
        n = sync_checkouts(
            session, acc_id,
            since=since, until=until,
            item_map=item_map, payment_map=payment_map
        )
        log_sync(sync_type, "checkouts", acc_id, "success", fetched=n, upserted=n, since=since, until=until)
        print(f"  ✅ 完了: {n} 件")
        return n
    except Exception as e:
        log_sync(sync_type, "checkouts", acc_id, "error", error=e, since=since, until=until)
        print(f"  ❌ エラー: {e}")
        return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full",       action="store_true", help="全期間フル同期")
    parser.add_argument("--all-stores", action="store_true", help="全店舗を一括同期")
    parser.add_argument("--token",      help="APIトークン（指定時は--account-idも必須）")
    parser.add_argument("--account-id", type=int, dest="account_id", help="account_id")
    parser.add_argument("--since",      help="開始日 YYYY-MM-DD")
    parser.add_argument("--until",      help="終了日 YYYY-MM-DD")
    args = parser.parse_args()

    print("=== ユビレジ → Supabase 同期 ===\n")

    # 期間を決定
    since, until = None, None
    if args.since:
        import pytz
        JST   = pytz.timezone("Asia/Tokyo")
        since = JST.localize(datetime.strptime(args.since, "%Y-%m-%d")).astimezone(timezone.utc)
        until_date = args.until or args.since
        until = JST.localize(datetime.strptime(until_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)).astimezone(timezone.utc)
        sync_type = "manual"
        print(f"期間: {args.since} ～ {until_date}")
    elif args.full:
        sync_type = "full"
        print("モード: フル同期（全期間）")
    else:
        sync_type = "incremental"

    # 対象店舗を決定
    if args.token and args.account_id:
        stores = [{"token": args.token, "account_id": args.account_id}]
    elif args.all_stores:
        stores = get_store_configs()
        if not stores:
            print("❌ .env.local に店舗設定がありません")
            sys.exit(1)
        print(f"対象店舗: {len(stores)} 店舗")
    else:
        token  = os.environ.get("UBIREGI_API_TOKEN")
        acc_id = os.environ.get("UBIREGI_ACCOUNT_ID")
        if not token or not acc_id:
            print("❌ UBIREGI_API_TOKEN / UBIREGI_ACCOUNT_ID が設定されていません")
            sys.exit(1)
        stores = [{"token": token, "account_id": int(acc_id)}]

    total_all = 0
    for store in stores:
        token  = store["token"]
        acc_id = store["account_id"]

        if sync_type == "incremental":
            last = get_last_sync(acc_id)
            if last:
                since = last - timedelta(minutes=10)
                print(f"\naccount_id={acc_id}: 増分同期（{since.strftime('%Y-%m-%d %H:%M')} 以降）")
            else:
                print(f"\naccount_id={acc_id}: 前回同期なし → フル同期")
                sync_type = "full"

        total_all += sync_store(token, acc_id, sync_type, since, until)

    print(f"\n{'='*50}")
    print(f"全店舗完了: 合計 {total_all} 件")


if __name__ == "__main__":
    main()
