import { IsIn, IsString, MaxLength } from 'class-validator';

export class TermsQueryDto {
  @IsIn(['es', 'en'])
  locale!: 'es' | 'en';
}

export class AcceptTermsDto extends TermsQueryDto {
  @IsString()
  @MaxLength(40)
  version!: string;
}
