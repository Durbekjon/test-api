import { Controller, Post, UseGuards, Request, Body, Get, Req, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
// import { LocalAuthGuard } from './local-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { ApiTags, ApiOperation, ApiBody, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserDto, RegisterDto } from './dto/user.dto';
import { CurrentUser, JwtUser } from './current-user.decorator';
import { Roles } from './roles.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ 
    status: 201, 
    description: 'Admin registered successfully', 
    schema: { 
      example: { 
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        user: {
          id: 'uuid',
          username: 'john_doe',
          role: 'admin'
        }
      } 
    } 
  })
    
  @ApiResponse({ status: 409, description: 'Username already exists' })
  async register(@Body() registerDto: RegisterDto) {
    registerDto.role = 'admin';
    return this.authService.register(registerDto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful', 
    schema: { 
      example: { 
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        user: {
          id: 'uuid',
          username: 'john_doe',
          role: 'user'
        }
      } 
    } 
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('user')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Roles('admin')
  @ApiOperation({ summary: 'Create new user' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'User created successfully', schema: { example: { id: 'uuid', username: 'john_doe', role: 'user' } } })
  @ApiResponse({ status: 409, description: 'Username already exists' })
  async createUser(@Body() registerDto: RegisterDto) {
    return this.authService.createUser(registerDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile', type: UserDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@CurrentUser() user: JwtUser) {
    return this.authService.getProfile(user);
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
