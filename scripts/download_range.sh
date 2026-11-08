#!/bin/bash
# Chunked Range download with per-chunk verification (direct GET of these
# UN URLs intermittently returns the SPA HTML page with 404; Range 206 is reliable).
# Usage: download_range.sh <url> <outfile>
set -u
URL="$1"; OUT="$2"
CHUNK=8388608
LEN=$(curl -sI "$URL" | awk 'BEGIN{IGNORECASE=1} /^Content-Length:/{print $2}' | tr -d '\r' | tail -1)
if [ -z "$LEN" ]; then echo "no content-length for $URL"; exit 1; fi
echo "$OUT total=$LEN"
WORK="${OUT}.parts"; mkdir -p "$WORK"
start=0; idx=0
while [ $start -lt $LEN ]; do
  end=$((start+CHUNK-1)); [ $end -ge $LEN ] && end=$((LEN-1))
  want=$((end-start+1)); part="$WORK/$(printf %04d $idx)"
  ok=0
  for try in 1 2 3 4 5 6; do
    if [ -f "$part" ] && [ "$(stat -c%s "$part")" = "$want" ]; then ok=1; break; fi
    code=$(curl -s -m 300 -r ${start}-${end} -o "$part" -w "%{http_code}" "$URL")
    sz=$(stat -c%s "$part" 2>/dev/null || echo 0)
    if [ "$code" = "206" ] && [ "$sz" = "$want" ]; then ok=1; break; fi
    echo "chunk $idx try $try code=$code size=$sz want=$want, retry"; sleep 2
  done
  [ $ok = 1 ] || { echo "chunk $idx FAILED"; exit 1; }
  echo "chunk $idx ok ($want bytes)"
  start=$((end+1)); idx=$((idx+1))
done
cat "$WORK"/* > "$OUT"
rm -rf "$WORK"
sz=$(stat -c%s "$OUT")
echo "$OUT assembled size=$sz expected=$LEN"
[ "$sz" = "$LEN" ] && gzip -t "$OUT" && echo "GZIP_OK $OUT"
