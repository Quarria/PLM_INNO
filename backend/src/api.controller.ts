import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Request, Response } from 'express';
import { BadRequestException } from '@nestjs/common';
import { ApiService } from './api.service';
import { Permission, Public, Roles } from './auth.guard';

type AuthedRequest = Request & { user: { sub: string; id?: string; username: string; displayName: string; roles: string[]; permissions: string[] } };
const actor = (req: AuthedRequest) => ({ id: req.user.sub, username: req.user.username, displayName: req.user.displayName, roles: req.user.roles, permissions: req.user.permissions });

@Controller()
export class ApiController {
  constructor(private api: ApiService) {}

  @Public() @Get('health') health() { return this.api.health(); }
  @Public() @Post('auth/login') login(@Body() body: any) { return this.api.login(String(body.username || ''), String(body.password || '')); }

  @Get('auth/me') me(@Req() req: AuthedRequest) { const { sub, ...user } = req.user; return { id: sub, ...user }; }

  @Get('products-page') productsPage(@Query() query: Record<string, string>) { return this.api.listProductsPage(query); }
  @Get('product-options') productOptions(@Query() query: Record<string, string>) { return this.api.searchProductOptions(query); }
  @Get('products') products() { return this.api.listProducts(); }
  @Roles('admin', 'business') @Permission('catalog:write') @Post('products') createProduct(@Body() body: any, @Req() req: AuthedRequest) { return this.api.createProduct(body, actor(req)); }
  @Roles('admin', 'business') @Permission('catalog:write') @Delete('products/:id') deleteProduct(@Param('id') id: string, @Req() req: AuthedRequest) { return this.api.deleteProduct(id, actor(req)); }
  @Roles('admin', 'business') @Permission('catalog:write') @Patch('products/:id') updateProduct(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.api.updateProduct(id, body, actor(req)); }
  @Roles('admin', 'business') @Put('variants/:id/base-price') @Permission('price:manage') basePrice(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.api.updateBasePrice(id, body, actor(req)); }
  @Get('base-prices') basePrices(@Req() req: AuthedRequest) { return this.api.listBasePrices(actor(req)); }
  @Roles('admin', 'business') @Permission('catalog:write') @Put('variants/:id/components') components(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.api.setBom(id, body.components, actor(req)); }

  @Get('customers') customers() { return this.api.listCustomers(); }
  @Roles('admin', 'business') @Permission('catalog:write') @Post('customers') customer(@Body() body: any, @Req() req: AuthedRequest) { return this.api.createCustomer(body, actor(req)); }
  @Roles('admin', 'business') @Permission('catalog:write') @Patch('customers/:id') updateCustomer(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.api.updateCustomer(id, body, actor(req)); }
  @Get('brands') brands() { return this.api.listBrands(); }
  @Roles('admin', 'business') @Permission('catalog:write') @Post('brands') brand(@Body() body: any, @Req() req: AuthedRequest) { return this.api.createBrand(body, actor(req)); }
  @Roles('admin', 'business') @Permission('catalog:write') @Patch('brands/:id') updateBrand(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.api.updateBrand(id, body, actor(req)); }

  @Roles('admin', 'business') @Get('rules') rules() { return this.api.listRules(); }
  @Roles('admin', 'business') @Permission('price:manage') @Post('rules') createRule(@Body() body: any, @Req() req: AuthedRequest) { return this.api.saveRule(body, actor(req)); }
  @Roles('admin', 'business') @Permission('price:manage') @Delete('rules/:id') deleteRule(@Param('id') id: string, @Req() req: AuthedRequest) { return this.api.deleteRule(id, actor(req)); }
  @Roles('admin', 'business') @Permission('price:manage') @Put('rules/:id') updateRule(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.api.saveRule(body, actor(req), id); }

  @Roles('admin', 'business') @Permission('quote:create') @Post('quotes') createQuote(@Body() body: any, @Req() req: AuthedRequest) { return this.api.createQuote(body, actor(req)); }
  @Get('quotes') quotes() { return this.api.listQuotes(); }
  @Get('quotes/:id') quote(@Param('id') id: string) { return this.api.getQuote(id); }
  @Roles('admin', 'business') @Permission('quote:create') @Post('quotes/:id/submit') submitQuote(@Param('id') id: string, @Req() req: AuthedRequest) { return this.api.submitQuote(id, actor(req)); }
  @Roles('admin', 'business') @Permission('quote:create') @Post('quotes/:id/recalculate') recalculateQuote(@Param('id') id: string, @Req() req: AuthedRequest) { return this.api.recalculateQuote(id, actor(req)); }
  @Permission('quote:confirm') @Put('quotes/:id/items/:itemId/prices') changeQuotePrices(@Param('id') id: string, @Param('itemId') itemId: string, @Body() body: any, @Req() req: AuthedRequest) { return this.api.changeQuotePrices(id, itemId, body, actor(req)); }
  @Roles('admin', 'business') @Permission('quote:create') @Delete('quotes/:id') deleteQuote(@Param('id') id: string, @Req() req: AuthedRequest) { return this.api.removeQuote(id, actor(req), 'delete'); }
  @Roles('admin', 'business') @Permission('quote:create') @Post('quotes/:id/void') voidQuote(@Param('id') id: string, @Req() req: AuthedRequest) { return this.api.removeQuote(id, actor(req), 'void'); }
  @Permission('quote:confirm') @Post('quotes/:id/items/:itemId/confirm') confirm(@Param('id') id: string, @Param('itemId') itemId: string, @Req() req: AuthedRequest) { return this.api.confirmItem(id, itemId, actor(req)); }
  @Roles('admin', 'business') @Permission('quote:create') @Patch('quotes/:id/terms') terms(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.api.updateTerms(id, body, actor(req)); }
  @Roles('admin', 'business') @Permission('quote:create') @Post('quotes/:id/duplicate') duplicate(@Param('id') id: string, @Req() req: AuthedRequest) { return this.api.duplicateQuote(id, actor(req)); }
  @Permission('quote:create') @Post('quotes/export') async export(@Body() body: any, @Res() res: Response) {
    const file = await this.api.exportQuotes(body.ids || []);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plm-quotes.xlsx"');
    res.send(file);
  }

  @Roles('admin') @Get('admin/roles') roles() { return this.api.listRoles(); }
  @Roles('admin') @Patch('admin/roles/:id') updateRole(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.api.updateRole(id, body, actor(req)); }
  @Roles('admin') @Get('admin/users') users() { return this.api.listUsers(); }
  @Roles('admin') @Post('admin/users') createUser(@Body() body: any, @Req() req: AuthedRequest) { return this.api.createUser(body, actor(req)); }

  @Roles('admin', 'business') @Permission('catalog:write') @Post('products/image') @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, callback) => {
        const directory = process.env.MEDIA_DIR || join(process.cwd(), 'data', 'media');
        mkdirSync(directory, { recursive: true }); callback(null, directory);
      },
      filename: (_req, file, callback) => {
        const extension = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/png' ? '.png' : '.webp';
        callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
  })) uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('仅支持 JPEG、PNG 或 WebP 图片，且不超过 5 MB');
    return { path: `/media/${file.filename}` };
  }
}
