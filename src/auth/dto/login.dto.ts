import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'user1', description: 'Username' })
  @IsString()
  username: string;

  @ApiProperty({ example: 'password123', description: 'Password' })
  @IsString()
  password: string;
} 