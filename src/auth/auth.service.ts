import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { UserDto } from './dto/user.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return null;
    // Don't return password
    const { password: _, ...result } = user;
    return result;
  }

  async login(user: any) {
    const payload = { username: user.username, sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async getMe(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const { password, ...result } = user;
    return result as UserDto;
  }

  async getMyTests(userId: string) {
    // If you want to track uploader, add a createdBy field to Test. For now, return all tests (or filter if field exists)
    // Placeholder: return all tests
    const tests = await this.prisma.test.findMany({
      orderBy: { createdAt: 'desc' },
      include: { questions: true },
    });
    return tests.map(t => ({
      id: t.id,
      title: t.name,
      createdAt: t.createdAt,
      questionCount: t.questions.length,
    }));
  }

  async getMyResults(userId: string) {
    const submissions = await this.prisma.testSubmission.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { test: true },
    });
    return submissions.map(s => ({
      submissionId: s.id,
      testTitle: s.test?.name || '',
      correct: s.correctCount,
      total: Array.isArray(s.answers) ? s.answers.length : 0,
      submittedAt: s.createdAt,
    }));
  }

  async getMyStats(userId: string) {
    const submissions = await this.prisma.testSubmission.findMany({ where: { userId } });
    const totalTestsTaken = submissions.length;
    const scores = submissions.map(s => s.correctCount);
    const averageScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const highestScore = scores.length ? Math.max(...scores) : 0;
    const lowestScore = scores.length ? Math.min(...scores) : 0;
    return {
      totalTestsTaken,
      averageScore: Number(averageScore.toFixed(2)),
      highestScore,
      lowestScore,
    };
  }
}
