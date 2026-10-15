import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PiiCryptoService } from './pii-crypto.service';

@Module({
  imports: [ConfigModule],
  providers: [PiiCryptoService],
  exports: [PiiCryptoService],
})
export class PrivacyModule {}
