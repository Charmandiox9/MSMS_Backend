import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';

export interface PresignedUpload {
  key: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface PresignedDownload {
  downloadUrl: string;
  expiresIn: number;
}

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly provider: string;
  private readonly bucketName: string | undefined;
  private readonly presignedUrlExpiresIn: number;
  private readonly client: S3Client | undefined;
  private readonly signingClient: S3Client | undefined;

  constructor(private readonly configService: ConfigService) {
    this.provider = this.configService.get<string>('STORAGE_PROVIDER', 'none');
    const isR2 = this.provider === 'r2';
    this.bucketName = this.configService.get<string>(
      isR2 ? 'R2_BUCKET_NAME' : 'S3_BUCKET_NAME',
    );
    this.presignedUrlExpiresIn = this.getExpiresIn();

    if (!['r2', 's3', 'minio'].includes(this.provider)) return;

    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.configService.get<string>(
      isR2 ? 'R2_ACCESS_KEY_ID' : 'S3_ACCESS_KEY',
    );
    const secretAccessKey = this.configService.get<string>(
      isR2 ? 'R2_SECRET_ACCESS_KEY' : 'S3_SECRET_KEY',
    );

    if (
      (isR2 && !accountId) ||
      !accessKeyId ||
      !secretAccessKey ||
      !this.bucketName
    ) {
      throw new Error(
        isR2
          ? 'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET_NAME son obligatorias cuando STORAGE_PROVIDER=r2'
          : 'S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY y S3_BUCKET_NAME son obligatorias para almacenamiento S3',
      );
    }

    const endpoint = isR2
      ? this.configService.get<string>('R2_ENDPOINT')?.trim() ||
        `https://${accountId}.r2.cloudflarestorage.com`
      : this.configService.get<string>('S3_ENDPOINT');
    if (!endpoint) throw new Error('S3_ENDPOINT es obligatorio');
    const publicEndpoint =
      this.configService.get<string>('S3_PUBLIC_ENDPOINT')?.trim() || endpoint;
    const options = {
      region: isR2
        ? 'auto'
        : this.configService.get<string>('S3_REGION', 'us-east-1'),
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      requestHandler: { connectionTimeout: 2000, requestTimeout: 3000 },
    };

    this.client = new S3Client({
      endpoint,
      ...options,
    });
    this.signingClient =
      isR2 || publicEndpoint === endpoint
        ? this.client
        : new S3Client({ ...options, endpoint: publicEndpoint });
  }

  async checkHealth(): Promise<void> {
    if (!this.client || !this.bucketName)
      throw new ServiceUnavailableException('Almacenamiento no configurado');
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
  }

  onModuleDestroy() {
    this.client?.destroy();
    if (this.signingClient !== this.client) this.signingClient?.destroy();
  }

  async createPresignedUpload(
    fileName: string,
    contentType: string,
  ): Promise<PresignedUpload> {
    if (!this.signingClient || !this.bucketName) {
      throw new ServiceUnavailableException(
        'El almacenamiento de objetos no está habilitado en este entorno',
      );
    }

    const key = this.buildObjectKey(fileName);
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.signingClient, command, {
      expiresIn: this.presignedUrlExpiresIn,
    });

    return { key, uploadUrl, expiresIn: this.presignedUrlExpiresIn };
  }

  async createPresignedDownload(key: string): Promise<PresignedDownload> {
    if (!this.signingClient || !this.bucketName) {
      throw new ServiceUnavailableException(
        'El almacenamiento de objetos no está habilitado en este entorno',
      );
    }

    const resolvedKey = await this.resolveExistingKey(key);
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: resolvedKey,
    });
    const downloadUrl = await getSignedUrl(this.signingClient, command, {
      expiresIn: this.presignedUrlExpiresIn,
    });

    return { downloadUrl, expiresIn: this.presignedUrlExpiresIn };
  }

  private async resolveExistingKey(key: string): Promise<string> {
    if (!this.client || !this.bucketName) return key;

    const normalized = key.startsWith('/') ? key.slice(1) : key;

    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: normalized }),
      );
      return normalized;
    } catch {
      if (!normalized.startsWith(`${this.bucketName}/`)) {
        const prefixedKey = `${this.bucketName}/${normalized}`;
        try {
          await this.client.send(
            new HeadObjectCommand({
              Bucket: this.bucketName,
              Key: prefixedKey,
            }),
          );
          return prefixedKey;
        } catch {
          return normalized;
        }
      } else {
        const strippedKey = normalized.replace(
          new RegExp(`^${this.bucketName}/`),
          '',
        );
        try {
          await this.client.send(
            new HeadObjectCommand({
              Bucket: this.bucketName,
              Key: strippedKey,
            }),
          );
          return strippedKey;
        } catch {
          return normalized;
        }
      }
    }
  }

  private buildObjectKey(fileName: string): string {
    const extension = extname(fileName)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    return `uploads/${randomUUID()}${extension}`;
  }

  private getExpiresIn(): number {
    const configured = Number(
      this.configService.get<string>(
        this.provider === 'r2'
          ? 'R2_PRESIGNED_URL_EXPIRES_IN'
          : 'S3_PRESIGNED_URL_EXPIRES_IN',
        '900',
      ),
    );
    return Number.isInteger(configured) && configured > 0 && configured <= 3600
      ? configured
      : 900;
  }
}
