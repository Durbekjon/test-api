import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MinLength,
  IsIn,
  IsOptional,
} from 'class-validator';

export class UserDto {
  @ApiProperty({ example: 'uuid', description: 'User ID' })
  id: string;

  @ApiProperty({ example: 'john_doe', description: 'Username' })
  username: string;

  @ApiProperty({ example: 'admin', description: 'Role (admin or user)' })
  role: string;
}

export class RegisterDto {
  @ApiProperty({
    example: 'john_doe',
    description: 'Username (min 3 characters)',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  username: string;

  @ApiProperty({
    example: 'password123',
    description: 'Password (min 6 characters)',
  })
  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  role: string = 'admin';
}
