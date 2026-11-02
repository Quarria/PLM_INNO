import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { User } from './entities';

export const PUBLIC_ROUTE = 'publicRoute';
export const REQUIRED_ROLES = 'requiredRoles';
export const REQUIRED_PERMISSION = 'requiredPermission';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES, roles);
export const Permission = (permission: string) => SetMetadata(REQUIRED_PERMISSION, permission);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector, private db: DataSource) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('请先登录');
    let tokenPayload: any;
    try { tokenPayload = await this.jwt.verifyAsync<any>(token); }
    catch { throw new UnauthorizedException('登录状态已失效，请重新登录'); }
    const user = await this.db.getRepository(User).findOne({ where: { id: tokenPayload.sub, active: true }, relations: { roles: true } });
    if (!user) throw new UnauthorizedException('账号已停用或不存在');
    request.user = { sub: user.id, username: user.username, displayName: user.displayName, roles: user.roles.map((r) => r.name), permissions: [...new Set(user.roles.flatMap((r) => r.permissions || []))] };
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]);
    if (required?.length && !required.some((role) => request.user.roles?.includes(role))) throw new ForbiddenException('当前账号没有此操作权限');
    const permission = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION, [context.getHandler(), context.getClass()]);
    const allowed = request.user.permissions?.includes('*') || request.user.permissions?.includes(permission || '');
    if (permission && !allowed) throw new ForbiddenException('当前账号没有此操作权限');
    return true;
  }
}
