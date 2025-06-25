import { User } from '@prisma/client';
declare global {
  namespace Express {
    interface UserJwt {
      userId: string;
      username: string;
      role: string;
    }
    interface Request {
      user?: UserJwt;
    }
  }
} 