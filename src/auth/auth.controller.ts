import { Controller, Post, UseGuards, Request, Body, Get, Req, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './local-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { UserDto } from './dto/user.dto';
import { CurrentUser, JwtUser } from './current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiOperation({ summary: 'User login, returns JWT' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 201, description: 'JWT access token', schema: { example: { access_token: 'jwt.token.here' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async login(@CurrentUser() user: JwtUser, @Body() _body: LoginDto) {
    return this.authService.login(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get current user info' })
  @ApiResponse({ status: 200, type: UserDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@CurrentUser() user: JwtUser) {
    return this.authService.getMe(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/tests')
  @ApiOperation({ summary: 'Get all tests uploaded by the current user' })
  @ApiResponse({ status: 200, description: 'List of tests', schema: { example: [{ id: '...', title: '...', createdAt: '...', questionCount: 10 }] } })
  async getMyTests(@CurrentUser() user: JwtUser) {
    return this.authService.getMyTests(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/results')
  @ApiOperation({ summary: 'Get all test submissions by the current user' })
  @ApiResponse({ status: 200, description: 'List of submissions', schema: { example: [{ submissionId: '...', testTitle: '...', correct: 8, total: 10, submittedAt: '...' }] } })
  async getMyResults(@CurrentUser() user: JwtUser) {
    return this.authService.getMyResults(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/stats')
  @ApiOperation({ summary: 'Get summary stats for the current user' })
  @ApiResponse({ status: 200, description: 'User stats', schema: { example: { totalTestsTaken: 5, averageScore: 8.2, highestScore: 10, lowestScore: 6 } } })
  async getMyStats(@CurrentUser() user: JwtUser) {
    return this.authService.getMyStats(user.userId);
  }
}
