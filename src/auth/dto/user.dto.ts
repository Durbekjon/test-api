import { ApiProperty } from '@nestjs/swagger';

export class UserDto {
  @ApiProperty({ example: 'uuid', description: 'User ID' })
  id: string;

  @ApiProperty({ example: 'user1', description: 'Username' })
  username: string;

  @ApiProperty({ example: 'admin', description: 'Role (admin or user)' })
  role: string;
} 