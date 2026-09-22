import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';

export class AssignRoleDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i, {
    message: 'roleId must be a UUID-formatted identifier',
  })
  roleId!: string;
}

@Controller('users')
@Roles('SYSTEM_ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 10, @Query('search') search = '', @Query('role') role = '') {
    return this.users.list(Math.max(1, page), Math.min(50, Math.max(1, pageSize)), search.trim(), role.trim());
  }

  @Post(':id/roles')
  assign(@Param('id') userId: string, @Body() body: AssignRoleDto) { return this.users.assignRole(userId, body.roleId); }

  @Delete(':id/roles/:roleId')
  revoke(@Param('id') userId: string, @Param('roleId') roleId: string) { return this.users.revokeRole(userId, roleId); }
}
