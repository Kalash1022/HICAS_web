# Local MinIO media delivery

The Docker Compose MinIO setup is for local development only. The minio-init
container waits for MinIO, creates the configured bucket if needed, and grants
anonymous download access to that local bucket. This lets browser clients load
the public URLs returned for product images and user avatars.

Start local infrastructure from the backend directory:

~~~powershell
docker compose up -d postgres minio minio-init mailpit
~~~

Use the default local object-storage settings from backend/.env.example:

~~~dotenv
S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_BASE_URL=http://localhost:9000
S3_BUCKET=hicas
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
~~~

The backend connects to MinIO through the Docker network at http://minio:9000
when started by Compose, while S3_PUBLIC_BASE_URL remains reachable by the
browser at http://localhost:9000.

Do not copy the anonymous policy to production. Production bucket access, CDN
delivery, and public-read policy must be provisioned and reviewed by
infrastructure outside the application.
