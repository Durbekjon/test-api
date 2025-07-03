import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto, UserDto } from 'src/auth/dto/user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async createUser(registerDto: RegisterDto): Promise<UserDto> {
    registerDto.username = registerDto.username
      .toLocaleLowerCase()
      .trim()
      .replace(/\s+/g, '_');
    const existing = await this.prisma.user.findUnique({
      where: { username: registerDto.username },
    });
    if (existing) throw new ConflictException('Username already exists');
    if (registerDto.role !== 'admin' && registerDto.role !== 'user') {
      throw new BadRequestException('Invalid role');
    }
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        username: registerDto.username,
        password: hashedPassword,
        role: registerDto.role,
      },
    });
    const { password, ...result } = user;
    return result as UserDto;
  }

  async getUsers(userId: string): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany();
    return users
      .map(({ password, ...user }) => user as UserDto)
      .filter((u) => u.id !== userId);
  }

  async getUserById(id: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const { password, ...result } = user;
    return result as UserDto;
  }

  async updateUser(id: string, data: Partial<RegisterDto>): Promise<UserDto> {
    if (data.username) {
      data.username = data.username
        .toLocaleLowerCase()
        .trim()
        .replace(/\s+/g, '_');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (data.username && data.username !== user.username) {
      const existing = await this.prisma.user.findUnique({
        where: { username: data.username },
      });
      if (existing) throw new ConflictException('Username already exists');
    }
    let updateData: any = { ...data };
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    } else {
      delete updateData.password;
    }
    if (data.role && data.role !== 'admin' && data.role !== 'user') {
      throw new BadRequestException('Invalid role');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });
    const { password, ...result } = updated;
    return result as UserDto;
  }

  async deleteUser(id: string): Promise<{ deleted: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.delete({ where: { id } });
    return { deleted: true };
  }
}
