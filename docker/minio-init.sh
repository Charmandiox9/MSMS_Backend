#!/bin/sh
set -eu
attempt=0
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 2
done
mc mb --ignore-existing "local/$S3_BUCKET_NAME" >/dev/null
mc anonymous set none "local/$S3_BUCKET_NAME" >/dev/null
mc admin user add local "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
cat >/tmp/marsys-policy.json <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetBucketLocation","s3:ListBucket"],"Resource":["arn:aws:s3:::$S3_BUCKET_NAME"]},{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":["arn:aws:s3:::$S3_BUCKET_NAME/*"]}]}
EOF
mc admin policy create local marsys-app /tmp/marsys-policy.json >/dev/null
mc admin policy attach local marsys-app --user "$S3_ACCESS_KEY" >/dev/null
echo 'Bucket privado y cuenta de aplicación preparados.'
