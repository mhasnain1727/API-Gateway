import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';

/**
 * Token presence check only. For non-public APIs we require that the request
 * has an Authorization header with format "Bearer <token>". We do NOT verify
 * the JWT signature here — downstream services (e.g. IAM, AuthZ) perform verification.
 */
@Injectable()
export class TokenValidationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TokenValidationMiddleware.name);
  private readonly publicRoutes: string[];
  private readonly publicRoutePatterns: RegExp[];

  constructor(private readonly configService: ConfigService) {
    this.publicRoutes = this.configService.get<string[]>('publicRoutes', []);
    this.publicRoutePatterns = this.configService.get<RegExp[]>('publicRoutePatterns', []);
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Check if route is public
    if (this.isPublicRoute(req.path)) {
      return next();
    }

    // Only check presence of Authorization Bearer token (no JWT verification)
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new UnauthorizedException('Authorization header is missing');
    }

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token || token.trim() === '') {
      throw new UnauthorizedException('Invalid authorization format. Expected: Bearer <token>');
    }

    this.logger.debug('Token presence check passed');
    next();
  }

  private isPublicRoute(path: string): boolean {
    if (this.publicRoutes.includes(path)) {
      return true;
    }
    for (const pattern of this.publicRoutePatterns) {
      if (pattern.test(path)) {
        return true;
      }
    }
    return false;
  }
}
