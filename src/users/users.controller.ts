import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsString, Matches } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';

const UUID_SHAPE_REGEX = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export class AssignRoleDto {
  @IsString()
  @Matches(UUID_SHAPE_REGEX, {
    message: 'roleId must be a UUID-formatted identifier',
  })
  roleId!: string;
}

export class PreloadUserDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(UUID_SHAPE_REGEX, { each: true, message: 'roleIds must contain UUID-formatted identifiers' })
  roleIds!: string[];
}

@Controller('users')
@Roles('SYSTEM_ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('preloads')
  listPreloads() { return this.users.listPreloads(); }

  @Post('preloads')
  preload(@Body() body: PreloadUserDto) { return this.users.preloadUser(body.email, body.roleIds); }

  @Delete('preloads/:id')
  cancelPreload(@Param('id') id: string) { return this.users.cancelPreload(id); }

  @Get()
  list(@Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 10, @Query('search') search = '', @Query('role') role = '') {
    return this.users.list(Math.max(1, page), Math.min(50, Math.max(1, pageSize)), search.trim(), role.trim());
  }

  @Post(':id/roles')
  assign(@Param('id') userId: string, @Body() body: AssignRoleDto) { return this.users.assignRole(userId, body.roleId); }

  @Delete(':id/roles/:roleId')
  revoke(@Param('id') userId: string, @Param('roleId') roleId: string) { return this.users.revokeRole(userId, roleId); }
}
