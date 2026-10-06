import { NextAuthPassportStrategy } from "@/lib/passport/strategies/types";
import { UsersRepository } from "@/modules/users/users.repository";
import { Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { getToken } from "next-auth/jwt";

@Injectable()
export class NextAuthStrategy extends PassportStrategy(NextAuthPassportStrategy, "next-auth") {
  constructor(
    private readonly userRepository: UsersRepository,
    private readonly config: ConfigService
  ) {
    super();
  }

  async authenticate(req: Request) {
    try {
      const nextAuthSecret = this.config.get("next.authSecret", { infer: true });
      const payload = await getToken({ req, secret: nextAuthSecret });

      if (!payload) {
        throw new UnauthorizedException("NextAuthStrategy - Authentication token is missing or invalid.");
      }

      if (!payload.email) {
        throw new UnauthorizedException("NextAuthStrategy - Email not found in the authentication token.");
      }

      // CVE-2026-23478 (GHSA-7hg4-x4pr-3hrg): resolve the user by the token subject, never by its email.
      const userId = Number(payload.sub);
      if (!Number.isInteger(userId) || userId <= 0) {
        throw new UnauthorizedException("NextAuthStrategy - Invalid subject in the authentication token.");
      }
      const user = await this.userRepository.findByIdWithProfile(userId);
      if (!user || user.email.toLowerCase() !== payload.email.toLowerCase()) {
        throw new UnauthorizedException(
          "NextAuthStrategy - User associated with the authentication token not found."
        );
      }

      return this.success(user);
    } catch (error) {
      if (error instanceof Error) return this.error(error);
      return this.error(
        new InternalServerErrorException(
          "NextAuthStrategy - An error occurred while authenticating the request"
        )
      );
    }
  }
}
