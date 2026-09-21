import { Resolver, Query } from '@nestjs/graphql';
import { Public } from './auth/decorators/public.decorator';

@Resolver()
export class AppResolver {
  @Public()
  @Query(() => String)
  hello(): string {
    return 'Hello World!';
  }
}
