#!/bin/sh
# §90-0: IP / USER-AGENT TESHISI (PROD). CAPI'ye IP eklemeden ONCE cevaplanmasi ZORUNLU soru:
#   Kaydedilen IP GERCEK MISAFIRIN mi, yoksa CADDY'nin ic docker IP'si mi?
#   Eger ic IP ise (172.x / 10.x / 127.x) -> CAPI'ye eklemek ZARARLI olur:
#   Meta tum eventleri TEK IP'den gorup 'sahte trafik' sayar. ONCE Caddy'nin
#   X-Forwarded-For basligi dogrulanmali.
# KVKK: GERCEK IP EKRANA BASILMAZ. Sadece SAYI ve TIP (ic/dis) raporlanir.
D=republique-db-1
P="docker exec $D psql -U republique -d republique -t -c"

echo "=== 1) IP / UA DOLULUK (son 30 gun) ==="
$P "SELECT count(*) AS toplam, count(*) FILTER (WHERE ip IS NOT NULL AND ip <> '') AS ip_dolu, count(*) FILTER (WHERE user_agent IS NOT NULL AND user_agent <> '') AS ua_dolu, count(DISTINCT ip) AS farkli_ip FROM scans WHERE timestamp >= now() - interval '30 days';"

echo ""
echo "=== 2) IP TIPI - EN KRITIK SORU (deger BASILMAZ) ==="
$P "SELECT count(*) FILTER (WHERE ip LIKE '172.%' OR ip LIKE '10.%' OR ip LIKE '127.%' OR ip LIKE '192.168.%') AS ic_ag_IP_KOTU, count(*) FILTER (WHERE ip IS NOT NULL AND ip <> '' AND ip NOT LIKE '172.%' AND ip NOT LIKE '10.%' AND ip NOT LIKE '127.%' AND ip NOT LIKE '192.168.%') AS gercek_IP_IYI, count(*) FILTER (WHERE ip LIKE '%,%') AS virgullu_XFF_zinciri FROM scans WHERE timestamp >= now() - interval '30 days';"

echo ""
echo "=== 3) OZET ==="
$P "SELECT CASE WHEN count(*) FILTER (WHERE ip IS NULL OR ip='')=count(*) THEN 'IP HIC YOK -> eklenmeli' WHEN count(*) FILTER (WHERE ip LIKE '172.%' OR ip LIKE '10.%' OR ip LIKE '127.%' OR ip LIKE '192.168.%') > 0 THEN 'SORUN - IC AG IP kaydediliyor -> Caddy X-Forwarded-For DUZELTILMELI, CAPI ye IP EKLEME' ELSE 'IYI - gercek IP kaydediliyor -> CAPI ye eklenebilir' END FROM scans WHERE timestamp >= now() - interval '30 days' AND ip IS NOT NULL AND ip <> '';"

echo ""
echo "=== 4) UA ORNEGI (tip bazinda, kisisel veri degil) ==="
$P "SELECT count(*) FILTER (WHERE user_agent ILIKE '%iPhone%') AS iphone, count(*) FILTER (WHERE user_agent ILIKE '%Android%') AS android, count(*) FILTER (WHERE user_agent ILIKE '%Headless%' OR user_agent ILIKE '%Playwright%') AS bot_test FROM scans WHERE timestamp >= now() - interval '30 days';"

echo ""
echo "=== 5) scans TABLOSUNDA BENZERSIZ ID KOLONU VAR MI (event_id icin lazim) ==="
$P "SELECT string_agg(column_name, ' ') FROM information_schema.columns WHERE table_name='scans';"
